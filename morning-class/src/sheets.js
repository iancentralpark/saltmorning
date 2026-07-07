const { google } = require('googleapis');
const { SPREADSHEET_ID } = require('./config');
const { getServiceAccountAuthOptions } = require('./googleCredentials');

let sheetsApi = null;
let sheetIdCache = null;
const sheetRowsCache = new Map();
const CACHE_SEC = 120;

function invalidateSheetRowsCache(sheetName) {
  if (sheetName) sheetRowsCache.delete(sheetName);
  else sheetRowsCache.clear();
}

function invalidateSheetIdCache() {
  sheetIdCache = null;
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

  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  const data = res.data.values || [[]];
  sheetRowsCache.set(sheetName, { data, expires: Date.now() + CACHE_SEC * 1000 });
  return data;
}

async function updateRange(sheetName, a1, values) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, a1),
    valueInputOption: 'RAW',
    requestBody: { values }
  });
  invalidateSheetRowsCache(sheetName);
}

async function appendRows(sheetName, rows) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(sheetName, 'A1'),
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
  invalidateSheetRowsCache(sheetName);
}

module.exports = {
  getSheetRows,
  getSheetIdMap,
  updateRange,
  appendRows,
  invalidateSheetRowsCache,
  invalidateSheetIdCache
};
