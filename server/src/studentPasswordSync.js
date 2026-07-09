const { google } = require('googleapis');
const { SPREADSHEET_ID, STUDENT_LIST_SHEET } = require('./config');
const { getServiceAccountAuthOptions } = require('./googleCredentials');
const { cacheGet, cacheSet, cacheDelete, cacheDeletePrefix } = require('./cache');

const PORTAL_SHEET_CACHE_KEY = 'portal_sheet_logins_v1';
const PORTAL_SHEET_CACHE_SEC = 600;

let sheetsApi = null;

async function getSheetsApi() {
  if (sheetsApi) return sheetsApi;
  const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
  if (!authOpts) return null;
  const auth = new google.auth.GoogleAuth(authOpts);
  sheetsApi = google.sheets({ version: 'v4', auth });
  return sheetsApi;
}

function sheetTabRange(a1) {
  const safe = STUDENT_LIST_SHEET.replace(/'/g, "''");
  return "'" + safe + "'!" + a1;
}

async function findStudentListRow1(studentId) {
  const sheets = await getSheetsApi();
  if (!sheets) return -1;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTabRange('A:A'),
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rows = res.data.values || [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === String(studentId)) return i + 1;
  }
  return -1;
}

async function syncStudentPasswordToSheet(studentId, plainPassword) {
  const sheets = await getSheetsApi();
  if (!sheets) return { synced: false, reason: 'no_google_credentials' };

  const row1 = await findStudentListRow1(studentId);
  if (row1 < 0) return { synced: false, reason: 'student_not_in_sheet' };

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTabRange('F' + row1),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[String(plainPassword || '')]] }
  });
  invalidateSheetPortalLoginCache();
  return { synced: true, row: row1 };
}

function invalidateSheetPortalLoginCache() {
  cacheDelete(PORTAL_SHEET_CACHE_KEY);
  cacheDeletePrefix('portal_logins_v1_');
}

async function readAllSheetPortalLogins() {
  const cached = cacheGet(PORTAL_SHEET_CACHE_KEY);
  if (cached) return cached;

  const sheets = await getSheetsApi();
  if (!sheets) return {};

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetTabRange('A:F'),
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rows = res.data.values || [];
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = String(row[0] || '').trim();
    if (!id) continue;
    map[id] = {
      classId: String(row[2] || '').trim(),
      status: String(row[3] || '').trim(),
      loginId: String(row[4] || '').trim(),
      loginPassword: String(row[5] || '').trim()
    };
  }
  cacheSet(PORTAL_SHEET_CACHE_KEY, map, PORTAL_SHEET_CACHE_SEC);
  return map;
}

/**
 * Plain-text portal logins from Student_List (cols A–F), keyed by student id.
 * Used when Supabase login_password column is missing or empty.
 */
async function readSheetPortalLoginsForClass(classId) {
  const all = await readAllSheetPortalLogins();
  const wantClass = String(classId || '').trim();
  const map = {};
  Object.keys(all).forEach(function(id) {
    const row = all[id];
    if (wantClass && row.classId !== wantClass) return;
    if (row.status !== 'Enrolled') return;
    map[id] = {
      loginId: row.loginId,
      loginPassword: row.loginPassword
    };
  });
  return map;
}

async function canReadSheetPortalLogins() {
  return !!(await getSheetsApi());
}

async function warmSheetPortalLoginCache() {
  return readAllSheetPortalLogins();
}

module.exports = {
  syncStudentPasswordToSheet,
  findStudentListRow1,
  readSheetPortalLoginsForClass,
  invalidateSheetPortalLoginCache,
  warmSheetPortalLoginCache,
  canReadSheetPortalLogins
};
