const {
  STUDENT_LEAVE_SHEET,
  STUDENT_LIST_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows } = require('./sheets');
const { formatDateTimeNow, formatSheetDate, chambitAddDays } = require('./dateUtils');
const { cacheDeletePrefix } = require('./cache');

const LEAVE_STATUS_ACTIVE = 'Active';
const LEAVE_STATUS_ENDED = 'Ended';
const LEAVE_STATUS_CANCELLED = 'Cancelled';

function normalizeDateStr(value) {
  const s = formatSheetDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD.');
  }
  return s;
}

function compareDateStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isDateInLeaveRange(dateStr, startDate, endDate) {
  dateStr = normalizeDateStr(dateStr);
  startDate = normalizeDateStr(startDate);
  endDate = normalizeDateStr(endDate);
  return compareDateStr(dateStr, startDate) >= 0 && compareDateStr(dateStr, endDate) <= 0;
}

function rangesOverlap(startA, endA, startB, endB) {
  return compareDateStr(startA, endB) <= 0 && compareDateStr(startB, endA) <= 0;
}

function eachDateInRange(startDate, endDate, fn) {
  let cur = normalizeDateStr(startDate);
  const end = normalizeDateStr(endDate);
  while (compareDateStr(cur, end) <= 0) {
    fn(cur);
    cur = chambitAddDays(cur, 1);
  }
}

async function ensureLeaveSheet() {
  let data;
  try {
    data = await getSheetRows(STUDENT_LEAVE_SHEET);
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
        requests: [{ addSheet: { properties: { title: STUDENT_LEAVE_SHEET } } }]
      }
    });
    await appendRows(STUDENT_LEAVE_SHEET, [[
      'LeaveID', 'StudentID', 'Name', 'ClassID', 'StartDate', 'EndDate', 'Reason', 'Status', 'CreatedAt', 'EndedAt'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'LeaveID') {
    if (!data.length) {
      await appendRows(STUDENT_LEAVE_SHEET, [[
        'LeaveID', 'StudentID', 'Name', 'ClassID', 'StartDate', 'EndDate', 'Reason', 'Status', 'CreatedAt', 'EndedAt'
      ]]);
    }
  }
}

function parseLeaveRow(row) {
  return {
    leaveId: String(row[0]),
    studentId: String(row[1]),
    name: String(row[2] || ''),
    classId: String(row[3]),
    startDate: formatSheetDate(row[4]),
    endDate: formatSheetDate(row[5]),
    reason: String(row[6] || ''),
    status: String(row[7] || ''),
    createdAt: String(row[8] || ''),
    endedAt: String(row[9] || '')
  };
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

async function getActiveLeavesByClass(classId, dateStr) {
  const all = await getAllActiveLeavesByClass(classId);
  dateStr = normalizeDateStr(dateStr);
  const map = {};
  for (const studentId of Object.keys(all)) {
    const leave = all[studentId];
    if (isDateInLeaveRange(dateStr, leave.startDate, leave.endDate)) {
      map[studentId] = leave;
    }
  }
  return map;
}

/** Active leave records for a class (not filtered by a specific date). */
async function getAllActiveLeavesByClass(classId) {
  await ensureLeaveSheet();
  classId = String(classId);
  const today = formatSheetDate(new Date());
  const data = await getSheetRows(STUDENT_LEAVE_SHEET);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== LEAVE_STATUS_ACTIVE) continue;
    const leave = parseLeaveRow(data[i]);
    if (compareDateStr(leave.endDate, today) < 0) continue;
    map[leave.studentId] = {
      leaveId: leave.leaveId,
      startDate: leave.startDate,
      endDate: leave.endDate,
      reason: leave.reason
    };
  }
  return map;
}

async function listStudentLeaves(classId, studentId) {
  await ensureLeaveSheet();
  classId = String(classId || '');
  studentId = String(studentId || '');
  const data = await getSheetRows(STUDENT_LEAVE_SHEET);
  const leaves = [];
  for (let i = 1; i < data.length; i++) {
    if (classId && String(data[i][3]) !== classId) continue;
    if (studentId && String(data[i][1]) !== studentId) continue;
    leaves.push(parseLeaveRow(data[i]));
  }
  leaves.sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return leaves;
}

async function getActiveLeaveRecord(classId, studentId) {
  const leaves = await listStudentLeaves(classId, studentId);
  const today = formatSheetDate(new Date());
  for (let i = 0; i < leaves.length; i++) {
    const leave = leaves[i];
    if (leave.status !== LEAVE_STATUS_ACTIVE) continue;
    if (compareDateStr(leave.endDate, today) < 0) continue;
    return leave;
  }
  return null;
}

async function backfillLeaveAttendance(classId, studentId, startDate, endDate) {
  const { batchUpsertAttendanceRecords } = require('./attendanceService');
  const records = [];
  eachDateInRange(startDate, endDate, (dateStr) => {
    records.push({
      dateStr,
      studentId: String(studentId),
      attendance: '휴원',
      vocabScore: 0
    });
  });
  await batchUpsertAttendanceRecords(classId, records);
}

async function startStudentLeave(classId, studentId, startDate, endDate, reason) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  startDate = normalizeDateStr(startDate);
  endDate = normalizeDateStr(endDate);
  reason = String(reason || '').trim();
  if (!classId || !studentId) throw new Error('classId and studentId are required.');
  if (compareDateStr(endDate, startDate) < 0) {
    throw new Error('End date must be on or after start date.');
  }

  const listData = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const rowIndex = findStudentRow(listData, classId, studentId);
  if (rowIndex < 0) throw new Error('Student not found in this class.');
  const status = String(listData[rowIndex][3] || '').trim();
  if (status === 'Withdrawn') throw new Error('Withdrawn students cannot be placed on leave.');
  if (status !== 'Enrolled') throw new Error('Only enrolled students can take leave.');

  const existing = await listStudentLeaves(classId, studentId);
  for (let i = 0; i < existing.length; i++) {
    const leave = existing[i];
    if (leave.status !== LEAVE_STATUS_ACTIVE) continue;
    if (rangesOverlap(startDate, endDate, leave.startDate, leave.endDate)) {
      throw new Error('This leave overlaps an existing active leave (' + leave.startDate + ' – ' + leave.endDate + ').');
    }
  }

  const name = String(listData[rowIndex][1] || '').trim();
  const leaveId = 'LV_' + classId + '_' + studentId + '_' + Date.now();
  const createdAt = formatDateTimeNow(TIMEZONE);
  await ensureLeaveSheet();
  await appendRows(STUDENT_LEAVE_SHEET, [[
    leaveId, studentId, name, classId, startDate, endDate, reason, LEAVE_STATUS_ACTIVE, createdAt, ''
  ]]);
  await backfillLeaveAttendance(classId, studentId, startDate, endDate);
  try {
    const { backfillLeaveInClassLog } = require('./classLogService');
    await backfillLeaveInClassLog(classId, name, startDate, endDate);
  } catch (e) {
    console.warn('Class log leave backfill:', e.message);
  }
  cacheDeletePrefix('sidebar_v1_');

  return {
    leaveId,
    studentId,
    name,
    classId,
    startDate,
    endDate,
    reason,
    message: name + ' is on leave from ' + startDate + ' to ' + endDate + '.'
  };
}

async function endStudentLeave(leaveId) {
  await ensureLeaveSheet();
  leaveId = String(leaveId || '').trim();
  if (!leaveId) throw new Error('leaveId is required.');

  const data = await getSheetRows(STUDENT_LEAVE_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== leaveId) continue;
    const status = String(data[i][7] || '').trim();
    if (status !== LEAVE_STATUS_ACTIVE) {
      throw new Error('This leave is not active.');
    }
    const endedAt = formatDateTimeNow(TIMEZONE);
    await updateRange(STUDENT_LEAVE_SHEET, 'H' + (i + 1) + ':J' + (i + 1), [[LEAVE_STATUS_ENDED, data[i][8], endedAt]]);
    cacheDeletePrefix('sidebar_v1_');
    const leave = parseLeaveRow(data[i]);
    return {
      leaveId,
      studentId: leave.studentId,
      classId: leave.classId,
      message: leave.name + '\'s leave has ended.'
    };
  }
  throw new Error('Leave record not found.');
}

module.exports = {
  LEAVE_STATUS_ACTIVE,
  isDateInLeaveRange,
  getActiveLeavesByClass,
  getAllActiveLeavesByClass,
  listStudentLeaves,
  getActiveLeaveRecord,
  startStudentLeave,
  endStudentLeave
};
