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
  const max = retries == null ? 3 : retries;
  let lastErr;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isQuotaError(err) || attempt >= max - 1) throw err;
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
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

async function getSheetRows(sheetName, options) {
  const skipCache = options && options.skipCache;
  if (!skipCache) {
    const cached = sheetRowsCache.get(sheetName);
    if (cached && Date.now() < cached.expires) return cached.data;

    const pending = inFlightRows.get(sheetName);
    if (pending) return pending;
  }

  const task = (async () => {
    const data = await fetchSheetRows(sheetName);
    if (!skipCache) {
      sheetRowsCache.set(sheetName, { data, expires: Date.now() + CACHE_SEC * 1000 });
    }
    return data;
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

async function updateRange(sheetName, a1, values) {
  const sheets = await getSheetsApi();
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, a1),
    valueInputOption: 'RAW',
    requestBody: { values }
  }));
  invalidateSheetRowsCache(sheetName);
}

async function appendRows(sheetName, rows) {
  const sheets = await getSheetsApi();
  await withRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, 'A1'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  }));
  invalidateSheetRowsCache(sheetName);
}

async function batchUpdateRanges(updates) {
  if (!updates || !updates.length) return;
  const sheets = await getSheetsApi();
  const touched = new Set();
  await withRetry(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({
        range: sheetRange(u.sheetName, u.a1),
        values: u.values
      }))
    }
  }));
  updates.forEach((u) => touched.add(u.sheetName));
  touched.forEach((name) => invalidateSheetRowsCache(name));
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
  invalidateSheetRowsCache,
  invalidateSheetIdCache
};
