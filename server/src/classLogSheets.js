const { google } = require('googleapis');
const { CLASS_LOG_SPREADSHEET_ID } = require('./config');
const { getServiceAccountAuthOptions } = require('./googleCredentials');

let sheetsApi = null;
let sheetMetaCache = null;

async function getClassLogSheetsApi() {
  if (sheetsApi) return sheetsApi;
  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) throw new Error('Google credentials not configured');
  const auth = new google.auth.GoogleAuth(authOpts);
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

async function getClassLogMeta() {
  if (sheetMetaCache) return sheetMetaCache;
  const sheets = await getClassLogSheetsApi();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CLASS_LOG_SPREADSHEET_ID });
  sheetMetaCache = meta.data;
  return sheetMetaCache;
}

async function getClassLogSheetId(tabName) {
  const meta = await getClassLogMeta();
  const sheet = (meta.sheets || []).find(s => s.properties.title === tabName);
  if (!sheet) throw new Error('Class log tab not found: ' + tabName);
  return sheet.properties.sheetId;
}

function tabRange(tabName, a1) {
  const safe = tabName.replace(/'/g, "''");
  return `'${safe}'!${a1}`;
}

async function getClassLogValues(tabName, a1) {
  const sheets = await getClassLogSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CLASS_LOG_SPREADSHEET_ID,
    range: tabRange(tabName, a1),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return res.data.values || [];
}

const _colACache = new Map();
const COL_A_CACHE_TTL_MS = 60000;

async function getClassLogColumnA(tabName, maxRows = 200) {
  const key = String(tabName) + ':' + maxRows;
  const hit = _colACache.get(key);
  if (hit && (Date.now() - hit.at) < COL_A_CACHE_TTL_MS) {
    return hit.rows;
  }
  const rows = await getClassLogValues(tabName, `A1:A${maxRows}`);
  _colACache.set(key, { at: Date.now(), rows });
  return rows;
}

function invalidateClassLogColumnACache(tabName) {
  if (!tabName) {
    _colACache.clear();
    return;
  }
  const prefix = String(tabName) + ':';
  for (const key of _colACache.keys()) {
    if (key.startsWith(prefix)) _colACache.delete(key);
  }
}

async function updateClassLogRange(tabName, a1, values) {
  const sheets = await getClassLogSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: CLASS_LOG_SPREADSHEET_ID,
    range: tabRange(tabName, a1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
  // Column A may have changed (names / month headers).
  if (/^A\d/i.test(String(a1)) || /^A\d+:A\d+$/i.test(String(a1))) {
    invalidateClassLogColumnACache(tabName);
  }
}

async function batchClassLogUpdate(requests) {
  if (!requests.length) return;
  const sheets = await getClassLogSheetsApi();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CLASS_LOG_SPREADSHEET_ID,
    requestBody: { requests }
  });
}

function colLetter(colIndex0) {
  let n = colIndex0 + 1;
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function a1Cell(row1, col0) {
  return colLetter(col0) + row1;
}

module.exports = {
  getClassLogValues,
  getClassLogColumnA,
  invalidateClassLogColumnACache,
  updateClassLogRange,
  batchClassLogUpdate,
  getClassLogSheetId,
  colLetter,
  a1Cell
};
