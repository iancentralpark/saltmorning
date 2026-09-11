const { google } = require('googleapis');
const { SPREADSHEET_ID } = require('./config');
const { getServiceAccountAuthOptions } = require('./googleCredentials');

let sheetsApi = null;
let sheetIdCache = null;
const sheetRowsCache = new Map();
const inFlightRows = new Map();
const knownSheets = new Set();
const CACHE_SEC = 600;
const META_CACHE_SEC = 600;

let metaCache = null;
let metaExpires = 0;
let metaInFlight = null;

function invalidateSheetRowsCache(sheetName) {
  if (sheetName) sheetRowsCache.delete(sheetName);
  else sheetRowsCache.clear();
}

function invalidateSheetIdCache() {
  sheetIdCache = null;
  metaCache = null;
  metaExpires = 0;
}

function isQuotaError(err) {
  const msg = String((err && err.message) || err || '');
  return err && (err.code === 429 || /quota exceeded/i.test(msg));
}

async function withRetry(fn, retries) {
  const max = retries == null ? 5 : retries;
  let lastErr;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isQuotaError(err) || attempt >= max - 1) throw err;
      // Longer backoff for Sheets read-quota bursts (login walks several sheets).
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

async function getSheetsApi() {
  if (sheetsApi) return sheetsApi;
  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) throw new Error('Google credentials not configured');
  const auth = new google.auth.GoogleAuth(authOpts);
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

async function getSpreadsheetMeta(force) {
  if (!force && metaCache && Date.now() < metaExpires) return metaCache;
  if (metaInFlight) return metaInFlight;
  metaInFlight = (async () => {
    try {
      const sheets = await getSheetsApi();
      const res = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID }));
      metaCache = res.data;
      metaExpires = Date.now() + META_CACHE_SEC * 1000;
      for (const sh of metaCache.sheets || []) {
        knownSheets.add(sh.properties.title);
      }
      return metaCache;
    } finally {
      metaInFlight = null;
    }
  })();
  return metaInFlight;
}

async function ensureSheet(sheetName, headers) {
  // Roster sheets are virtualized in Postgres once backfilled — skip Google create.
  if (shouldUseRosterBridge(sheetName)) return;
  if (knownSheets.has(sheetName)) return;
  const meta = await getSpreadsheetMeta();
  const existing = new Set((meta.sheets || []).map((s) => s.properties.title));
  if (existing.has(sheetName)) {
    knownSheets.add(sheetName);
    return;
  }
  const sheets = await getSheetsApi();
  await withRetry(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  }));
  invalidateSheetIdCache();
  knownSheets.add(sheetName);
  if (headers && headers.length) {
    await appendRows(sheetName, [headers]);
  }
}

async function getSheetIdMap() {
  if (sheetIdCache) return sheetIdCache;
  const meta = await getSpreadsheetMeta();
  sheetIdCache = {};
  for (const sh of meta.sheets || []) {
    sheetIdCache[sh.properties.title] = sh.properties.sheetId;
  }
  return sheetIdCache;
}

function sheetRange(sheetName, a1) {
  const safe = sheetName.replace(/'/g, "''");
  return a1 ? `'${safe}'!${a1}` : `'${safe}'`;
}

async function fetchSheetRows(sheetName) {
  const sheets = await getSheetsApi();
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  }));
  return res.data.values || [[]];
}

function shouldUseRosterBridge(sheetName, options) {
  if (options && options.forceGoogle) return false;
  try {
    const { isOpsRosterReady } = require('./db/boot');
    const { isRosterSheet } = require('./db/rosterBridge');
    return !!(isOpsRosterReady() && isRosterSheet(sheetName));
  } catch (_) {
    return false;
  }
}

async function getSheetRows(sheetName, options) {
  if (shouldUseRosterBridge(sheetName, options)) {
    const { readSheet } = require('./db/rosterBridge');
    return readSheet(sheetName);
  }

  const skipCache = options && (options.skipCache || options.skipCache);
  if (!skipCache) {
    const cached = sheetRowsCache.get(sheetName);
    if (cached && Date.now() < cached.expires) return cached.data;

    const pending = inFlightRows.get(sheetName);
    if (pending) return pending;
  }

  const task = (async () => {
    try {
      const data = await fetchSheetRows(sheetName);
      if (!skipCache) {
        sheetRowsCache.set(sheetName, { data, expires: Date.now() + CACHE_SEC * 1000 });
      }
      return data;
    } catch (err) {
      // Prefer a stale cache over failing login/portals when quota is exhausted.
      if (isQuotaError(err)) {
        const stale = sheetRowsCache.get(sheetName);
        if (stale && stale.data) return stale.data;
      }
      throw err;
    }
  })();

  if (!skipCache) {
    inFlightRows.set(sheetName, task);
    try {
      return await task;
    } finally {
      inFlightRows.delete(sheetName);
    }
  }
  return task;
}

/** Serialize all Sheets writes to reduce quota bursts / races (single process). */
let writeChain = Promise.resolve();
function enqueueWrite(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function updateRange(sheetName, a1, values) {
  if (shouldUseRosterBridge(sheetName)) {
    const { writeRange } = require('./db/rosterBridge');
    return writeRange(sheetName, a1, values || []);
  }
  return enqueueWrite(async () => {
    const sheets = await getSheetsApi();
    await withRetry(() => sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetRange(sheetName, a1),
      valueInputOption: 'RAW',
      requestBody: { values }
    }));
    invalidateSheetRowsCache(sheetName);
  });
}

async function appendRows(sheetName, rows) {
  if (shouldUseRosterBridge(sheetName)) {
    const { appendSheetRows } = require('./db/rosterBridge');
    return appendSheetRows(sheetName, rows || []);
  }
  return enqueueWrite(async () => {
    const sheets = await getSheetsApi();
    await withRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetRange(sheetName, 'A1'),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows }
    }));
    invalidateSheetRowsCache(sheetName);
  });
}

async function batchUpdateRanges(updates) {
  if (!updates || !updates.length) return;
  const rosterUpdates = [];
  const sheetUpdates = [];
  for (const u of updates) {
    if (shouldUseRosterBridge(u.sheetName)) rosterUpdates.push(u);
    else sheetUpdates.push(u);
  }
  for (const u of rosterUpdates) {
    const { writeRange } = require('./db/rosterBridge');
    await writeRange(u.sheetName, u.a1, u.values || []);
  }
  if (!sheetUpdates.length) return;
  return enqueueWrite(async () => {
    const sheets = await getSheetsApi();
    const touched = new Set();
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: sheetUpdates.map((u) => ({
          range: sheetRange(u.sheetName, u.a1),
          values: u.values
        }))
      }
    }));
    sheetUpdates.forEach((u) => touched.add(u.sheetName));
    touched.forEach((name) => invalidateSheetRowsCache(name));
  });
}

/** Delete 1-based sheet rows (highest index first). */
async function deleteRows(sheetName, rowIndices1Based) {
  if (shouldUseRosterBridge(sheetName)) {
    const { deleteSheetRows } = require('./db/rosterBridge');
    return deleteSheetRows(sheetName, rowIndices1Based);
  }
  const indices = (rowIndices1Based || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => b - a);
  if (!indices.length) return;
  const idMap = await getSheetIdMap();
  const sheetId = idMap[sheetName];
  if (sheetId == null) throw new Error('Sheet not found: ' + sheetName);
  const sheets = await getSheetsApi();
  await withRetry(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: indices.map((row) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: row - 1,
            endIndex: row
          }
        }
      }))
    }
  }));
  invalidateSheetRowsCache(sheetName);
}

async function deleteRow(sheetName, rowIndex1Based) {
  await deleteRows(sheetName, [rowIndex1Based]);
}

module.exports = {
  getSheetRows,
  getSheetsApi,
  getSheetIdMap,
  getSpreadsheetMeta,
  ensureSheet,
  updateRange,
  appendRows,
  batchUpdateRanges,
  deleteRow,
  deleteRows,
  invalidateSheetRowsCache,
  invalidateSheetIdCache
};
