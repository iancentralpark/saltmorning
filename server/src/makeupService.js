const { MAKEUP_SHEET } = require('./config');
const { getSheetRows, appendRows } = require('./sheets');
const { formatDateTimeNow } = require('./dateUtils');
const { TIMEZONE } = require('./config');
const { getEnrolledStudents } = require('./homeworkService');

const HEADERS = [
  'MakeupID', 'ClassID', 'StudentID', 'StudentName', 'Date',
  'StartTime', 'EndTime', 'DurationHours', 'Notes', 'RecordedAt'
];

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

async function ensureMakeupSheet() {
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
  if (!data.length || String(data[0][0]) !== 'MakeupID') {
    if (!data.length) await appendRows(MAKEUP_SHEET, [HEADERS]);
  }
}

async function listClassStudents(classId) {
  const students = await getEnrolledStudents(classId);
  return students.map(s => ({ id: s.id, name: s.name }));
}

async function getMakeupLessons(classId, studentId) {
  classId = String(classId || '');
  studentId = studentId != null ? String(studentId) : '';
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
    rows.push({
      makeupId: String(data[i][0] || ''),
      classId: String(data[i][1] || ''),
      studentId: String(data[i][2] || ''),
      studentName: String(data[i][3] || ''),
      dateStr: String(data[i][4] || ''),
      startTime: String(data[i][5] || ''),
      endTime: String(data[i][6] || ''),
      durationHours: Number(data[i][7]) || 0,
      notes: String(data[i][8] || ''),
      recordedAt: String(data[i][9] || '')
    });
  }
  rows.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return a.dateStr < b.dateStr ? 1 : -1;
    return a.startTime < b.startTime ? 1 : -1;
  });
  return rows;
}

async function saveMakeupLesson(classId, studentId, studentName, dateStr, startTime, endTime, notes) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  dateStr = String(dateStr || '').trim();
  startTime = String(startTime || '').trim();
  endTime = String(endTime || '').trim();
  notes = String(notes || '').trim();

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

  if (!studentName) {
    const students = await getEnrolledStudents(classId);
    const found = students.find(s => String(s.id) === studentId);
    studentName = found ? found.name : studentId;
  }

  await ensureMakeupSheet();
  const makeupId = 'MU_' + classId + '_' + Date.now();
  const recordedAt = formatDateTimeNow(TIMEZONE);
  await appendRows(MAKEUP_SHEET, [[
    makeupId, classId, studentId, studentName, dateStr,
    startTime, endTime, durationHours, notes, recordedAt
  ]]);

  return {
    makeupId,
    message: 'Makeup recorded: ' + studentName + ' · ' + dateStr + ' · ' +
      startTime + '–' + endTime + ' (' + durationHours + 'h)',
    durationHours
  };
}

module.exports = {
  listClassStudents,
  getMakeupLessons,
  saveMakeupLesson,
  calcDurationHours
};
