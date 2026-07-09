const { google } = require('googleapis');
const { SPREADSHEET_ID } = require('./config');
const { getServiceAccountAuthOptions } = require('./googleCredentials');
const { isSupabaseEnabled } = require('./supabaseClient');
const supabaseAdapter = require('./supabaseSheetAdapter');
const filteredRows = require('./supabaseFilteredRows');

let sheetsApi = null;
let sheetIdCache = null;
const sheetRowsCache = new Map();
const SHEET_ROWS_CACHE_SEC = 300;

function invalidateSheetRowsCache(sheetName) {
  if (sheetName) sheetRowsCache.delete(sheetName);
  else sheetRowsCache.clear();
}

async function getSheetsApi() {
  if (sheetsApi) return sheetsApi;
  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) throw new Error('Google credentials not configured');
  const auth = new google.auth.GoogleAuth(authOpts);
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

async function getSheetIdMap() {
  if (sheetIdCache) return sheetIdCache;
  const sheets = await getSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  sheetIdCache = {};
  for (const sh of meta.data.sheets || []) {
    sheetIdCache[sh.properties.title] = sh.properties.sheetId;
  }
  return sheetIdCache;
}

function sheetRange(sheetName, a1) {
  const safe = sheetName.replace(/'/g, "''");
  return a1 ? `'${safe}'!${a1}` : `'${safe}'`;
}

async function getSheetRows(sheetName, options) {
  const skipCache = options && options.skipCache;
  const cached = sheetRowsCache.get(sheetName);
  if (!skipCache && cached && Date.now() < cached.expires) {
    return cached.data;
  }

  let data;
  if (supabaseAdapter.usesSupabaseSheet(sheetName)) {
    data = await supabaseAdapter.getRows(sheetName);
  } else {
    const sheets = await getSheetsApi();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetRange(sheetName),
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    data = res.data.values || [[]];
  }

  sheetRowsCache.set(sheetName, {
    data,
    expires: Date.now() + SHEET_ROWS_CACHE_SEC * 1000
  });
  return data;
}

async function updateRange(sheetName, a1, values) {
  if (supabaseAdapter.usesSupabaseSheet(sheetName)) {
    await supabaseAdapter.updateRange(sheetName, a1, values);
    invalidateSheetRowsCache(sheetName);
    return;
  }

  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
  invalidateSheetRowsCache(sheetName);
}

async function appendRows(sheetName, rows) {
  if (supabaseAdapter.usesSupabaseSheet(sheetName)) {
    await supabaseAdapter.appendRows(sheetName, rows);
    invalidateSheetRowsCache(sheetName);
    return;
  }

  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, 'A:Z'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
  invalidateSheetRowsCache(sheetName);
}

async function deleteRows(sheetName, rowIndices1Based) {
  if (!rowIndices1Based.length) return;
  if (supabaseAdapter.usesSupabaseSheet(sheetName)) {
    await supabaseAdapter.deleteRows(sheetName, rowIndices1Based);
    invalidateSheetRowsCache(sheetName);
    return;
  }

  const idMap = await getSheetIdMap();
  const sheetId = idMap[sheetName];
  if (sheetId == null) throw new Error('Sheet not found: ' + sheetName);
  const sorted = [...rowIndices1Based].sort((a, b) => b - a);
  const requests = sorted.map(row => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: row - 1,
        endIndex: row
      }
    }
  }));
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });
  invalidateSheetRowsCache(sheetName);
}

async function deleteRow(sheetName, rowIndex1Based) {
  await deleteRows(sheetName, [rowIndex1Based]);
}

function invalidateSheetIdCache() {
  sheetIdCache = null;
}

async function batchUpdateRanges(updates) {
  if (!updates.length) return;
  const supabaseUpdates = updates.filter(function(u) {
    return supabaseAdapter.usesSupabaseSheet(u.sheetName);
  });
  const sheetUpdates = updates.filter(function(u) {
    return !supabaseAdapter.usesSupabaseSheet(u.sheetName);
  });
  for (const u of supabaseUpdates) {
    await supabaseAdapter.updateRange(u.sheetName, u.a1, u.values);
    invalidateSheetRowsCache(u.sheetName);
  }
  if (!sheetUpdates.length) return;

  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: sheetUpdates.map(function(u) {
        return { range: sheetRange(u.sheetName, u.a1), values: u.values };
      })
    }
  });
  const names = new Set(sheetUpdates.map(function(u) { return u.sheetName; }));
  names.forEach(function(name) { invalidateSheetRowsCache(name); });
}

async function buildRequestContext(classId, options) {
  const idStr = String(classId);
  const rowCache = {};
  const opts = options || {};
  const useFiltered = opts.supabaseFilter && isSupabaseEnabled();
  const filterOpts = useFiltered ? { dateStr: opts.dateStr || '', _cache: {} } : null;

  async function sheetRows(name) {
    if (!rowCache[name]) {
      if (filterOpts) {
        const filtered = await filteredRows.getRowsFiltered(name, idStr, filterOpts);
        rowCache[name] = filtered != null
          ? filtered
          : await getSheetRows(name);
      } else {
        rowCache[name] = await getSheetRows(name);
      }
    }
    return rowCache[name];
  }

  return { classId: idStr, sheetRows };
}

module.exports = {
  getSheetRows,
  getSheetIdMap,
  updateRange,
  appendRows,
  deleteRow,
  deleteRows,
  batchUpdateRanges,
  buildRequestContext,
  invalidateSheetRowsCache,
  invalidateSheetIdCache
};
