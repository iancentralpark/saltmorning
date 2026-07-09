const { MAKEUP_SHEET, TIMEZONE } = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRow } = require('./sheets');
const { formatDateTimeNow, formatSheetDate } = require('./dateUtils');
const { cacheDeletePrefix } = require('./cache');
const { getEnrolledStudents } = require('./homeworkService');

const HEADERS = [
  'MakeupID', 'ClassID', 'StudentID', 'StudentName', 'Date',
  'StartTime', 'EndTime', 'DurationHours', 'Notes', 'Status', 'RecordedAt'
];

const STATUS_SCHEDULED = 'Scheduled';
const STATUS_COMPLETED = 'Completed';
const STATUS_CANCELLED = 'Cancelled';
const KNOWN_STATUSES = [STATUS_SCHEDULED, STATUS_COMPLETED, STATUS_CANCELLED];

function parseTimeToMinutes(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function calcDurationHours(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null || end <= start) return null;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function todayStr() {
  return formatSheetDate(new Date(), TIMEZONE);
}

function resolveMakeupStatus(dateStr, status, options) {
  options = options || {};
  const s = String(status || '').trim();
  if (options.explicitStatus && KNOWN_STATUSES.includes(s)) return s;
  if (s === STATUS_CANCELLED) return STATUS_CANCELLED;
  if (String(dateStr) > todayStr()) return STATUS_SCHEDULED;
  return STATUS_COMPLETED;
}

function rowToLesson(row) {
  const statusCell = String(row[9] || '').trim();
  let status;
  let recordedAt;
  if (KNOWN_STATUSES.includes(statusCell)) {
    status = statusCell;
    recordedAt = String(row[10] || '');
  } else {
    recordedAt = statusCell;
    status = resolveMakeupStatus(String(row[4] || ''), '', {});
  }
  return {
    makeupId: String(row[0] || ''),
    classId: String(row[1] || ''),
    studentId: String(row[2] || ''),
    studentName: String(row[3] || ''),
    dateStr: String(row[4] || ''),
    startTime: String(row[5] || ''),
    endTime: String(row[6] || ''),
    durationHours: Number(row[7]) || 0,
    notes: String(row[8] || ''),
    status,
    recordedAt
  };
}

function formatMakeupEventDescription(lesson) {
  const notes = String(lesson.notes || '').trim();
  return 'Makeup: ' + lesson.studentName + ' · ' + lesson.startTime + '–' + lesson.endTime +
    (notes ? ' — ' + notes : '');
}

function makeupToEvent(lesson) {
  return {
    eventId: lesson.makeupId,
    eventDate: lesson.dateStr,
    description: formatMakeupEventDescription(lesson),
    type: 'makeup',
    makeupId: lesson.makeupId,
    studentId: lesson.studentId,
    studentName: lesson.studentName,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    status: lesson.status
  };
}

async function ensureMakeupSheet() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
  let data;
  try {
    data = await getSheetRows(MAKEUP_SHEET, { skipCache: true });
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
        requests: [{ addSheet: { properties: { title: MAKEUP_SHEET } } }]
      }
    });
    await appendRows(MAKEUP_SHEET, [HEADERS]);
    return;
  }
  if (!data.length) {
    await appendRows(MAKEUP_SHEET, [HEADERS]);
    return;
  }
  if (String(data[0][0]) !== 'MakeupID') return;
  if (String(data[0][9] || '') !== 'Status') {
    await updateRange(MAKEUP_SHEET, 'J1:K1', [['Status', 'RecordedAt']]);
  }
}

async function findMakeupRowIndex(makeupId) {
  makeupId = String(makeupId || '').trim();
  if (!makeupId) return -1;
  const data = await getSheetRows(MAKEUP_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === makeupId) return i + 1;
  }
  return -1;
}

async function listClassStudents(classId) {
  const students = await getEnrolledStudents(classId);
  return students.map(s => ({ id: s.id, name: s.name }));
}

async function getMakeupLessons(classId, studentId, options) {
  options = options || {};
  classId = String(classId || '');
  studentId = studentId != null ? String(studentId) : '';
  const statusFilter = options.status ? String(options.status) : '';
  let data;
  try {
    data = await getSheetRows(MAKEUP_SHEET);
  } catch (e) {
    return [];
  }
  if (!data.length) return [];

  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    if (studentId && String(data[i][2]) !== studentId) continue;
    const lesson = rowToLesson(data[i]);
    if (statusFilter && lesson.status !== statusFilter) continue;
    rows.push(lesson);
  }
  rows.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return a.dateStr < b.dateStr ? 1 : -1;
    return a.startTime < b.startTime ? 1 : -1;
  });
  return rows;
}

async function getMakeupLessonsForMonth(classId, monthPrefix) {
  const all = await getMakeupLessons(classId, '');
  return all.filter(m => String(m.dateStr).slice(0, 7) === monthPrefix);
}

async function getUpcomingMakeupEvents(classId) {
  const today = todayStr();
  const lessons = await getMakeupLessons(classId, '');
  return lessons
    .filter(m => m.status === STATUS_SCHEDULED && m.dateStr >= today)
    .map(makeupToEvent);
}

async function getScheduledMakeups(classId, studentId) {
  return getMakeupLessons(classId, studentId, { status: STATUS_SCHEDULED });
}

async function getScheduledMakeupsForMonth(classId, year, month) {
  const monthPrefix = year + '-' + String(month).padStart(2, '0');
  const lessons = await getMakeupLessons(classId, '');
  return lessons
    .filter(m => m.status === STATUS_SCHEDULED && String(m.dateStr).slice(0, 7) === monthPrefix)
    .map(makeupToEvent);
}

function validateMakeupFields(classId, studentId, dateStr, startTime, endTime) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  dateStr = String(dateStr || '').trim();
  startTime = String(startTime || '').trim();
  endTime = String(endTime || '').trim();
  if (!classId || !studentId || !dateStr) {
    throw new Error('Class, student, and date are required.');
  }
  if (!startTime || !endTime) {
    throw new Error('Start and end time are required (HH:mm).');
  }
  const durationHours = calcDurationHours(startTime, endTime);
  if (durationHours == null) {
    throw new Error('End time must be after start time.');
  }
  return { classId, studentId, dateStr, startTime, endTime, durationHours };
}

function bumpSidebarCache() {
  cacheDeletePrefix('sidebar_v1_');
}

async function saveMakeupLesson(classId, studentId, studentName, dateStr, startTime, endTime, notes, options) {
  options = options || {};
  notes = String(notes || '').trim();
  const v = validateMakeupFields(classId, studentId, dateStr, startTime, endTime);
  const status = resolveMakeupStatus(v.dateStr, options.status, {
    explicitStatus: !!options.explicitStatus
  });

  if (!studentName) {
    const students = await getEnrolledStudents(v.classId);
    const found = students.find(s => String(s.id) === v.studentId);
    studentName = found ? found.name : v.studentId;
  }

  await ensureMakeupSheet();
  const makeupId = 'MU_' + v.classId + '_' + Date.now();
  const recordedAt = formatDateTimeNow(TIMEZONE);
  await appendRows(MAKEUP_SHEET, [[
    makeupId, v.classId, v.studentId, studentName, v.dateStr,
    v.startTime, v.endTime, v.durationHours, notes, status, recordedAt
  ]]);
  bumpSidebarCache();

  const verb = status === STATUS_SCHEDULED ? 'Makeup scheduled' : 'Makeup recorded';
  return {
    makeupId,
    status,
    message: verb + ': ' + studentName + ' · ' + v.dateStr + ' · ' +
      v.startTime + '–' + v.endTime + ' (' + v.durationHours + 'h)',
    durationHours: v.durationHours
  };
}

async function updateMakeupLesson(makeupId, fields) {
  fields = fields || {};
  const row = await findMakeupRowIndex(makeupId);
  if (row < 0) throw new Error('Makeup record not found.');

  const data = await getSheetRows(MAKEUP_SHEET, { skipCache: true });
  const current = rowToLesson(data[row - 1]);
  const classId = String(fields.classId != null ? fields.classId : current.classId);
  const studentId = String(fields.studentId != null ? fields.studentId : current.studentId);
  let studentName = String(fields.studentName != null ? fields.studentName : current.studentName);
  const dateStr = String(fields.dateStr != null ? fields.dateStr : current.dateStr);
  const startTime = String(fields.startTime != null ? fields.startTime : current.startTime);
  const endTime = String(fields.endTime != null ? fields.endTime : current.endTime);
  const notes = String(fields.notes != null ? fields.notes : current.notes);
  const status = resolveMakeupStatus(
    dateStr,
    fields.status != null ? fields.status : current.status,
    { explicitStatus: !!fields.explicitStatus }
  );
  const v = validateMakeupFields(classId, studentId, dateStr, startTime, endTime);

  if (!studentName || fields.studentId != null) {
    const students = await getEnrolledStudents(v.classId);
    const found = students.find(s => String(s.id) === v.studentId);
    studentName = found ? found.name : v.studentId;
  }

  await updateRange(MAKEUP_SHEET, `A${row}:K${row}`, [[
    current.makeupId,
    v.classId,
    v.studentId,
    studentName,
    v.dateStr,
    v.startTime,
    v.endTime,
    v.durationHours,
    notes,
    status,
    current.recordedAt || formatDateTimeNow(TIMEZONE)
  ]]);
  bumpSidebarCache();

  const verb = status === STATUS_SCHEDULED ? 'Makeup schedule updated' : 'Makeup updated';
  return {
    makeupId: current.makeupId,
    status,
    message: verb + ': ' + studentName + ' · ' + v.dateStr + ' · ' +
      v.startTime + '–' + v.endTime + ' (' + v.durationHours + 'h)',
    durationHours: v.durationHours
  };
}

async function deleteMakeupLesson(makeupId) {
  const row = await findMakeupRowIndex(makeupId);
  if (row < 0) throw new Error('Makeup record not found.');
  const data = await getSheetRows(MAKEUP_SHEET, { skipCache: true });
  const current = rowToLesson(data[row - 1]);
  await deleteRow(MAKEUP_SHEET, row);
  bumpSidebarCache();
  return {
    makeupId: current.makeupId,
    message: 'Makeup deleted: ' + current.studentName + ' · ' + current.dateStr
  };
}

async function setMakeupStatus(makeupId, status) {
  status = String(status || '').trim();
  if (!KNOWN_STATUSES.includes(status)) {
    throw new Error('Invalid makeup status.');
  }
  return updateMakeupLesson(makeupId, { status, explicitStatus: true });
}

module.exports = {
  listClassStudents,
  getMakeupLessons,
  getMakeupLessonsForMonth,
  getUpcomingMakeupEvents,
  getScheduledMakeups,
  getScheduledMakeupsForMonth,
  saveMakeupLesson,
  updateMakeupLesson,
  deleteMakeupLesson,
  setMakeupStatus,
  calcDurationHours,
  formatMakeupEventDescription,
  STATUS_SCHEDULED,
  STATUS_COMPLETED,
  STATUS_CANCELLED
};
