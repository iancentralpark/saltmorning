const {
  STUDENT_LIST_SHEET,
  STUDENT_WITHDRAWN_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRows } = require('./sheets');
const { formatDateTimeNow, formatSheetDate } = require('./dateUtils');
const { cacheDelete, cacheDeletePrefix } = require('./cache');

const STATUS_COL = 3;
const LOGIN_ID_COL = 4;
const LOGIN_PW_COL = 5;

async function ensureWithdrawnSheet() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
  let data;
  try {
    data = await getSheetRows(STUDENT_WITHDRAWN_SHEET);
  } catch (e) {
    const { google } = require('googleapis');
    const { SPREADSHEET_ID } = require('./config');
    const { getServiceAccountAuthOptions } = require('./googleCredentials');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: STUDENT_WITHDRAWN_SHEET } } }]
      }
    });
    await appendRows(STUDENT_WITHDRAWN_SHEET, [[
      'WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'WithdrawalID') {
    if (!data.length) {
      await appendRows(STUDENT_WITHDRAWN_SHEET, [[
        'WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'
      ]]);
    }
  }
}

function findStudentRow(data, classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== studentId) continue;
    if (String(data[i][2]) !== classId) continue;
    return i;
  }
  return -1;
}

function invalidateStudentCaches_(classId) {
  const { invalidateWorkCache } = require('./workCacheService');
  invalidateWorkCache(classId);
  cacheDeletePrefix('sidebar_v1_');
  cacheDelete('classes_v1');
  cacheDelete('portal_logins_v1_' + classId);
}

async function withdrawStudent(classId, studentId) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  if (!classId || !studentId) {
    throw new Error('classId and studentId are required.');
  }

  const data = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const rowIndex = findStudentRow(data, classId, studentId);
  if (rowIndex < 0) {
    throw new Error('Student not found in this class.');
  }

  const row = data[rowIndex];
  const status = String(row[STATUS_COL] || '').trim();
  if (status === 'Withdrawn') {
    throw new Error('Student is already withdrawn.');
  }
  if (status !== 'Enrolled') {
    throw new Error('Only enrolled students can be withdrawn.');
  }

  const name = String(row[1] || '').trim();
  const loginId = String(row[LOGIN_ID_COL] || '').trim();
  const loginPassword = String(row[LOGIN_PW_COL] || '').trim();
  const withdrawnAt = formatDateTimeNow(TIMEZONE);
  const withdrawalId = 'WDR_' + classId + '_' + studentId + '_' + Date.now();
  const sheetRow = rowIndex + 1;

  await updateRange(STUDENT_LIST_SHEET, 'D' + sheetRow, [['Withdrawn']]);
  await ensureWithdrawnSheet();
  await appendRows(STUDENT_WITHDRAWN_SHEET, [[
    withdrawalId,
    studentId,
    name,
    classId,
    loginId,
    loginPassword,
    status,
    withdrawnAt
  ]]);

  invalidateStudentCaches_(classId);

  try {
    const { backfillWithdrawnInClassLog } = require('./classLogService');
    const wd = formatSheetDate(withdrawnAt);
    await backfillWithdrawnInClassLog(classId, name, wd);
  } catch (e) {
    console.warn('Class log withdraw backfill:', e.message);
  }

  return {
    withdrawalId,
    studentId,
    name,
    classId,
    withdrawnAt,
    message: name + ' has been withdrawn from the class.'
  };
}

async function listWithdrawnStudents(classId) {
  await ensureWithdrawnSheet();
  classId = String(classId || '').trim();
  const data = await getSheetRows(STUDENT_WITHDRAWN_SHEET, { skipCache: true });
  const students = [];
  for (let i = 1; i < data.length; i++) {
    if (classId && String(data[i][3]) !== classId) continue;
    students.push({
      withdrawalId: String(data[i][0]),
      studentId: String(data[i][1]),
      name: String(data[i][2] || ''),
      classId: String(data[i][3] || ''),
      loginId: String(data[i][4] || ''),
      previousStatus: String(data[i][6] || 'Enrolled'),
      withdrawnAt: String(data[i][7] || '')
    });
  }
  students.sort((a, b) => {
    if (a.withdrawnAt !== b.withdrawnAt) return a.withdrawnAt < b.withdrawnAt ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return { students };
}

/**
 * Restore a withdrawn student to Enrolled and clear 퇴원 class-log marks
 * written at withdrawal time. Past dollars/tickets/chambit history stay intact.
 */
async function reinstateStudent(classId, studentId) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  if (!classId || !studentId) {
    throw new Error('classId and studentId are required.');
  }

  const data = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const rowIndex = findStudentRow(data, classId, studentId);
  if (rowIndex < 0) {
    throw new Error('Student not found in this class.');
  }

  const row = data[rowIndex];
  const name = String(row[1] || '').trim();
  const status = String(row[STATUS_COL] || '').trim();
  if (status !== 'Withdrawn') {
    throw new Error(name + ' is not withdrawn (status: ' + (status || 'unknown') + ').');
  }

  await ensureWithdrawnSheet();
  const wData = await getSheetRows(STUDENT_WITHDRAWN_SHEET, { skipCache: true });
  let withdrawnAt = '';
  let previousStatus = 'Enrolled';
  const rowsToDelete = [];
  for (let i = 1; i < wData.length; i++) {
    if (String(wData[i][1]) !== studentId) continue;
    if (String(wData[i][3]) !== classId) continue;
    rowsToDelete.push(i + 1);
    const at = String(wData[i][7] || '');
    if (!withdrawnAt || at > withdrawnAt) {
      withdrawnAt = at;
      const prev = String(wData[i][6] || '').trim();
      previousStatus = prev && prev !== 'Withdrawn' ? prev : 'Enrolled';
    }
  }

  await updateRange(STUDENT_LIST_SHEET, 'D' + (rowIndex + 1), [[previousStatus]]);

  if (rowsToDelete.length) {
    await deleteRows(STUDENT_WITHDRAWN_SHEET, rowsToDelete.slice().sort(function(a, b) { return b - a; }));
  }

  invalidateStudentCaches_(classId);

  const fromDate = formatSheetDate(withdrawnAt) || formatSheetDate(formatDateTimeNow(TIMEZONE));
  try {
    const { clearWithdrawnMarksInClassLog } = require('./classLogService');
    await clearWithdrawnMarksInClassLog(classId, name, fromDate);
  } catch (e) {
    console.warn('Class log reinstate cleanup:', e.message);
  }

  return {
    studentId,
    name,
    classId,
    status: previousStatus,
    withdrawnAt: fromDate,
    message: name + ' has been restored to the class.'
  };
}

module.exports = { withdrawStudent, listWithdrawnStudents, reinstateStudent };
