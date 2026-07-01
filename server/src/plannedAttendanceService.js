const {
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows } = require('./sheets');
const { formatDateTimeNow, formatSheetDate } = require('./dateUtils');
const { upsertAttendanceRecord } = require('./attendanceService');
const { getActiveLeavesByClass } = require('./leaveService');
const { getHolidaysForMonth } = require('./holiday');
const { cacheDeletePrefix } = require('./cache');

const STATUS_ACTIVE = 'Active';
const STATUS_CANCELLED = 'Cancelled';
const TYPE_ABSENT = '결석';
const TYPE_TARDY = '지각';

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

function parseYearMonth(dateStr) {
  const p = String(dateStr).split('-');
  return { year: Number(p[0]), month: Number(p[1]) };
}

async function ensurePlannedSheet() {
  let data;
  try {
    data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
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
        requests: [{ addSheet: { properties: { title: STUDENT_PLANNED_ATTENDANCE_SHEET } } }]
      }
    });
    await appendRows(STUDENT_PLANNED_ATTENDANCE_SHEET, [[
      'NoticeID', 'StudentID', 'Name', 'ClassID', 'Date', 'Type', 'Note', 'Status', 'CreatedAt'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'NoticeID') {
    if (!data.length) {
      await appendRows(STUDENT_PLANNED_ATTENDANCE_SHEET, [[
        'NoticeID', 'StudentID', 'Name', 'ClassID', 'Date', 'Type', 'Note', 'Status', 'CreatedAt'
      ]]);
    }
  }
}

function parsePlannedRow(row) {
  return {
    noticeId: String(row[0]),
    studentId: String(row[1]),
    name: String(row[2] || ''),
    classId: String(row[3]),
    dateStr: formatSheetDate(row[4]),
    type: String(row[5] || ''),
    note: String(row[6] || ''),
    status: String(row[7] || ''),
    createdAt: String(row[8] || '')
  };
}

function findStudentRow(data, classId, studentId) {
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(studentId)) continue;
    if (String(data[i][2]) !== String(classId)) continue;
    return i;
  }
  return -1;
}

async function getClassAllowedDays(classId) {
  const data = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(classId)) {
      return String(data[i][3] || '1,2,3,4,5')
        .split(',')
        .map(n => Number(n))
        .filter(n => !isNaN(n));
    }
  }
  return [1, 2, 3, 4, 5];
}

function isClassDay(dateStr, allowedDays, holiday) {
  if (holiday) return false;
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  return !allowedDays.length || allowedDays.includes(dow);
}

async function getPlannedByClassAndDate(classId, dateStr) {
  await ensurePlannedSheet();
  classId = String(classId);
  dateStr = normalizeDateStr(dateStr);
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) continue;
    const rowDate = formatSheetDate(data[i][4]);
    if (rowDate !== dateStr) continue;
    const item = parsePlannedRow(data[i]);
    map[item.studentId] = {
      noticeId: item.noticeId,
      type: item.type,
      note: item.note
    };
  }
  return map;
}

async function listPlannedAttendance(classId, studentId) {
  await ensurePlannedSheet();
  classId = String(classId || '');
  studentId = String(studentId || '');
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const items = [];
  const today = formatSheetDate(new Date());
  for (let i = 1; i < data.length; i++) {
    if (classId && String(data[i][3]) !== classId) continue;
    if (studentId && String(data[i][1]) !== studentId) continue;
    const item = parsePlannedRow(data[i]);
    if (item.status !== STATUS_ACTIVE) continue;
    if (compareDateStr(item.dateStr, today) < 0) continue;
    items.push(item);
  }
  items.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return a.dateStr < b.dateStr ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return items;
}

async function getPlannedAttendanceCalendar(classId, studentId, year, month) {
  year = Number(year);
  month = Number(month);
  if (!classId || !studentId) throw new Error('classId and studentId are required.');
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('year and month (1–12) are required.');
  }

  const allowedDays = await getClassAllowedDays(classId);
  const holidays = await getHolidaysForMonth(year, month);
  const plannedList = await listPlannedAttendance(classId, studentId);
  const plannedByDate = {};
  for (let i = 0; i < plannedList.length; i++) {
    const p = plannedList[i];
    plannedByDate[p.dateStr] = {
      noticeId: p.noticeId,
      type: p.type,
      note: p.note
    };
  }

  const numDays = new Date(year, month, 0).getDate();
  const days = {};
  for (let d = 1; d <= numDays; d++) {
    const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const holiday = holidays[dateStr] || '';
    const classDay = isClassDay(dateStr, allowedDays, holiday);
    days[dateStr] = {
      holiday,
      classDay,
      offDay: !classDay,
      planned: plannedByDate[dateStr] || null
    };
  }

  return { year, month, classId, studentId, allowedDays, days };
}

async function assertClassDay(classId, dateStr) {
  const allowedDays = await getClassAllowedDays(classId);
  const ym = parseYearMonth(dateStr);
  const holidays = await getHolidaysForMonth(ym.year, ym.month);
  const holiday = holidays[dateStr] || '';
  if (!isClassDay(dateStr, allowedDays, holiday)) {
    if (holiday) throw new Error('Cannot plan attendance on a public holiday.');
    throw new Error('This date is not a scheduled class day for this class.');
  }
}

async function createPlannedAttendance(classId, studentId, dateStr, type, note) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  dateStr = normalizeDateStr(dateStr);
  type = String(type || '').trim();
  note = String(note || '').trim();
  if (!classId || !studentId) throw new Error('classId and studentId are required.');
  if (type !== TYPE_ABSENT && type !== TYPE_TARDY) {
    throw new Error('Type must be Absent or Tardy.');
  }

  const listData = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const rowIndex = findStudentRow(listData, classId, studentId);
  if (rowIndex < 0) throw new Error('Student not found in this class.');
  const status = String(listData[rowIndex][3] || '').trim();
  if (status !== 'Enrolled') throw new Error('Only enrolled students can receive advance notice.');

  await assertClassDay(classId, dateStr);

  await ensurePlannedSheet();
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== studentId || String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) continue;
    if (formatSheetDate(data[i][4]) === dateStr) {
      throw new Error('Advance notice already exists for this date. Remove it first to change.');
    }
  }

  const name = String(listData[rowIndex][1] || '').trim();
  const noticeId = 'PN_' + classId + '_' + studentId + '_' + Date.now();
  const createdAt = formatDateTimeNow(TIMEZONE);
  await appendRows(STUDENT_PLANNED_ATTENDANCE_SHEET, [[
    noticeId, studentId, name, classId, dateStr, type, note, STATUS_ACTIVE, createdAt
  ]]);

  const today = formatSheetDate(new Date());
  if (compareDateStr(dateStr, today) <= 0) {
    const leaveMap = await getActiveLeavesByClass(classId, dateStr);
    if (!leaveMap[studentId]) {
      await upsertAttendanceRecord(classId, studentId, dateStr, type, 0);
    }
  }

  cacheDeletePrefix('sidebar_v1_');
  const typeLabel = type === TYPE_TARDY ? 'Tardy' : 'Absent';
  return {
    noticeId,
    studentId,
    name,
    classId,
    dateStr,
    type,
    message: name + ': ' + typeLabel + ' advance notice saved for ' + dateStr + '.'
  };
}

async function cancelPlannedAttendance(noticeId) {
  await ensurePlannedSheet();
  noticeId = String(noticeId || '').trim();
  if (!noticeId) throw new Error('noticeId is required.');

  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== noticeId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) {
      throw new Error('This advance notice is not active.');
    }
    await updateRange(
      STUDENT_PLANNED_ATTENDANCE_SHEET,
      'H' + (i + 1),
      [[STATUS_CANCELLED]]
    );
    cacheDeletePrefix('sidebar_v1_');
    const item = parsePlannedRow(data[i]);
    return {
      noticeId,
      studentId: item.studentId,
      classId: item.classId,
      message: 'Advance notice removed for ' + item.dateStr + '.'
    };
  }
  throw new Error('Advance notice not found.');
}

module.exports = {
  STATUS_ACTIVE,
  TYPE_ABSENT,
  TYPE_TARDY,
  getPlannedByClassAndDate,
  listPlannedAttendance,
  getPlannedAttendanceCalendar,
  createPlannedAttendance,
  cancelPlannedAttendance
};
