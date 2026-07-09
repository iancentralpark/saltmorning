const {
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET,
  TIMEZONE
} = require('../config');
const { getSheetRows, updateRange, appendRows } = require('../sheets');
const { formatDateTimeNow, formatSheetDate, todayStr } = require('../dateUtils');
const { getHolidaysForMonth } = require('../holiday');

const STATUS_ACTIVE = 'Active';
const STATUS_CANCELLED = 'Cancelled';
const TYPE_ABSENT = '결석';
const TYPE_TARDY = '지각';

function normalizeDateStr(value) {
  const s = formatSheetDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date format.');
  return s;
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

function datesInRange(startStr, endStr) {
  startStr = normalizeDateStr(startStr);
  endStr = normalizeDateStr(endStr);
  if (endStr < startStr) throw new Error('End date must be on or after start date.');
  const dates = [];
  const cursor = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    dates.push(y + '-' + m + '-' + d);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function getClassAllowedDays(classId) {
  const data = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(classId)) {
      return String(data[i][3] || '1,2,3,4,5')
        .split(',')
        .map((n) => Number(n))
        .filter((n) => !isNaN(n));
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
  classId = String(classId);
  dateStr = normalizeDateStr(dateStr);
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) continue;
    if (formatSheetDate(data[i][4]) !== dateStr) continue;
    const item = parsePlannedRow(data[i]);
    map[item.studentId] = {
      noticeId: item.noticeId,
      type: item.type,
      note: item.note
    };
  }
  return map;
}

async function getPlannedForClassMonth(classId, year, month) {
  classId = String(classId);
  const monthPrefix = year + '-' + String(month).padStart(2, '0');
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) continue;
    const dateStr = formatSheetDate(data[i][4]);
    if (!dateStr.startsWith(monthPrefix)) continue;
    const item = parsePlannedRow(data[i]);
    if (!map[dateStr]) map[dateStr] = {};
    map[dateStr][item.studentId] = { type: item.type, note: item.note };
  }
  return map;
}

async function listPlannedAttendance(classId, studentId) {
  classId = String(classId || '');
  studentId = String(studentId || '');
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const items = [];
  const today = todayStr();
  for (let i = 1; i < data.length; i++) {
    if (classId && String(data[i][3]) !== classId) continue;
    if (studentId && String(data[i][1]) !== studentId) continue;
    const item = parsePlannedRow(data[i]);
    if (item.status !== STATUS_ACTIVE) continue;
    if (item.dateStr < today) continue;
    items.push(item);
  }
  items.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.noticeId.localeCompare(b.noticeId));
  return items;
}

async function getPlannedAttendanceCalendar(classId, studentId, year, month) {
  year = Number(year);
  month = Number(month);
  if (!classId || !studentId) throw new Error('classId and studentId are required.');

  const allowedDays = await getClassAllowedDays(classId);
  const holidays = await getHolidaysForMonth(year, month);
  const plannedList = await listPlannedAttendance(classId, studentId);
  const plannedByDate = {};
  plannedList.forEach((p) => {
    plannedByDate[p.dateStr] = { noticeId: p.noticeId, type: p.type, note: p.note };
  });

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
  const ym = dateStr.split('-');
  const holidays = await getHolidaysForMonth(Number(ym[0]), Number(ym[1]));
  const holiday = holidays[dateStr] || '';
  if (!isClassDay(dateStr, allowedDays, holiday)) {
    if (holiday) throw new Error('Cannot plan on a public holiday.');
    throw new Error('This date is not a scheduled class day.');
  }
}

async function resolveStudent(classId, studentId) {
  const listData = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  for (let i = 1; i < listData.length; i++) {
    if (String(listData[i][0]) !== studentId || String(listData[i][2]) !== classId) continue;
    if (String(listData[i][3] || '').trim() !== 'Enrolled') {
      throw new Error('Only enrolled students can receive advance notice.');
    }
    return String(listData[i][1] || '');
  }
  throw new Error('Student not found in this class.');
}

async function hasActivePlanned(classId, studentId, dateStr) {
  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== studentId || String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) continue;
    if (formatSheetDate(data[i][4]) === dateStr) return true;
  }
  return false;
}

async function createPlannedAttendanceOne(classId, studentId, name, dateStr, type, note) {
  const noticeId = 'PN_' + classId + '_' + studentId + '_' + dateStr.replace(/-/g, '') + '_' + Date.now();
  await appendRows(STUDENT_PLANNED_ATTENDANCE_SHEET, [[
    noticeId, studentId, name, classId, dateStr, type, note, STATUS_ACTIVE, formatDateTimeNow(TIMEZONE)
  ]]);

  if (dateStr <= todayStr()) {
    const { upsertStudentRecord } = require('./attendanceService');
    await upsertStudentRecord(classId, studentId, dateStr, type, '', '');
  }

  return { noticeId, dateStr };
}

async function createPlannedAttendance(classId, studentId, startDateStr, endDateStr, type, note) {
  classId = String(classId).trim();
  studentId = String(studentId).trim();
  startDateStr = normalizeDateStr(startDateStr);
  endDateStr = normalizeDateStr(endDateStr || startDateStr);
  type = String(type || '').trim();
  note = String(note || '').trim();
  if (!classId || !studentId) throw new Error('classId and studentId are required.');
  if (type !== TYPE_ABSENT && type !== TYPE_TARDY) {
    throw new Error('Type must be Absent or Tardy.');
  }

  const name = await resolveStudent(classId, studentId);
  const allowedDays = await getClassAllowedDays(classId);
  const allDates = datesInRange(startDateStr, endDateStr);
  const holidaysByMonth = {};

  const created = [];
  const skipped = [];

  for (const dateStr of allDates) {
    const ym = dateStr.split('-');
    const y = Number(ym[0]);
    const m = Number(ym[1]);
    const monthKey = y + '-' + m;
    if (!holidaysByMonth[monthKey]) {
      holidaysByMonth[monthKey] = await getHolidaysForMonth(y, m);
    }
    const holiday = holidaysByMonth[monthKey][dateStr] || '';
    if (!isClassDay(dateStr, allowedDays, holiday)) {
      skipped.push({ dateStr, reason: holiday ? 'holiday' : 'not a class day' });
      continue;
    }
    if (await hasActivePlanned(classId, studentId, dateStr)) {
      skipped.push({ dateStr, reason: 'already planned' });
      continue;
    }
    const row = await createPlannedAttendanceOne(classId, studentId, name, dateStr, type, note);
    created.push(row);
  }

  if (!created.length) {
    throw new Error('No class days in this range could be planned. Check dates and existing notices.');
  }

  const rangeLabel = created.length === 1
    ? created[0].dateStr
    : created[0].dateStr + ' → ' + created[created.length - 1].dateStr;

  return {
    created,
    skipped,
    studentId,
    name,
    classId,
    type,
    note,
    message: name + ': ' + (type === TYPE_TARDY ? 'tardy' : 'absent') + ' planned for ' + created.length + ' class day(s) (' + rangeLabel + ').'
  };
}

async function cancelPlannedAttendance(noticeId) {
  noticeId = String(noticeId || '').trim();
  if (!noticeId) throw new Error('noticeId is required.');

  const data = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== noticeId) continue;
    if (String(data[i][7]) !== STATUS_ACTIVE) throw new Error('This notice is not active.');
    await updateRange(STUDENT_PLANNED_ATTENDANCE_SHEET, 'H' + (i + 1), [[STATUS_CANCELLED]]);
    const item = parsePlannedRow(data[i]);
    return { noticeId, message: 'Removed advance notice for ' + item.dateStr + '.' };
  }
  throw new Error('Advance notice not found.');
}

module.exports = {
  TYPE_ABSENT,
  TYPE_TARDY,
  getPlannedByClassAndDate,
  getPlannedForClassMonth,
  listPlannedAttendance,
  getPlannedAttendanceCalendar,
  createPlannedAttendance,
  cancelPlannedAttendance
};
