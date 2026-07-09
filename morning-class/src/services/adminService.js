const {
  ADMIN_LIST_SHEET,
  TEACHER_LIST_SHEET,
  CLASS_LIST_SHEET,
  CLASS_TEACHERS_SHEET,
  ATTENDANCE_SHEET,
  GRADES_DAILY_SHEET,
  LESSON_PLANS_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  MESSAGES_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const { formatSheetDate } = require('../dateUtils');
const { listAllGradeTerms, saveGradeTerm, ensureGradeSheets } = require('./gradeWeightService');
const crypto = require('crypto');

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

async function ensureAdminSheet() {
  const { getSheetsApi } = require('../sheets');
  const sheets = await getSheetsApi();
  const { SPREADSHEET_ID } = require('../config');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  if (!existing.has(ADMIN_LIST_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: ADMIN_LIST_SHEET } } }] }
    });
    const { invalidateSheetIdCache } = require('../sheets');
    invalidateSheetIdCache();
    await appendRows(ADMIN_LIST_SHEET, [[
      'AdminID', 'Name', 'LoginID', 'LoginPassword'
    ], [
      'A001', 'Salt Admin', 'admin', 'admin123'
    ]]);
  }
}

async function listClasses() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push({ classId: String(rows[i][0]), name: String(rows[i][1] || '') });
  }
  return out;
}

async function listTeachers() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push({
      teacherId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      loginId: String(rows[i][2] || ''),
      homeroomClassId: String(rows[i][4] || ''),
      staffRole: String(rows[i][5] || 'Teacher')
    });
  }
  return out;
}

async function saveTeacher(payload) {
  const teacherId = String(payload.teacherId || '').trim() || newId('T');
  const name = String(payload.name || '').trim();
  const loginId = String(payload.loginId || '').trim();
  const password = String(payload.password || '').trim();
  const homeroomClassId = String(payload.homeroomClassId || '').trim();
  const staffRole = String(payload.staffRole || 'Teacher').trim();
  if (!name || !loginId) throw new Error('Name and login ID are required.');

  const data = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === teacherId) { found = i + 1; break; }
    if (String(data[i][2]) === loginId && String(data[i][0]) !== teacherId) {
      throw new Error('Login ID already in use.');
    }
  }
  const existingPwd = found > 0 ? String(data[found - 1][3] || '') : '';
  const row = [teacherId, name, loginId, password || existingPwd || 'changeme123', homeroomClassId, staffRole];
  if (found > 0) {
    await updateRange(TEACHER_LIST_SHEET, `A${found}:F${found}`, [row]);
  } else {
    if (!password) throw new Error('Password required for new teacher.');
    await appendRows(TEACHER_LIST_SHEET, [row]);
  }
  return { teacherId, name, loginId, homeroomClassId, staffRole };
}

async function getMonitoringFeed(options) {
  const classFilter = options && options.classId ? String(options.classId) : '';
  const typeFilter = options && options.type ? String(options.type) : '';
  const limit = Number(options && options.limit) || 80;

  const nameMaps = { student: {}, teacher: {}, class: {} };
  const students = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < students.length; i++) {
    nameMaps.student[String(students[i][0])] = String(students[i][1] || '');
  }
  const teachers = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < teachers.length; i++) {
    nameMaps.teacher[String(teachers[i][0])] = String(teachers[i][1] || '');
  }
  const classes = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < classes.length; i++) {
    nameMaps.class[String(classes[i][0])] = String(classes[i][1] || '');
  }

  const items = [];

  const att = await getSheetRows(ATTENDANCE_SHEET);
  for (let i = 1; i < att.length; i++) {
    const classId = String(att[i][1]);
    if (classFilter && classId !== classFilter) continue;
    const studentId = String(att[i][2]);
    items.push({
      type: 'attendance',
      at: formatSheetDate(att[i][0]) + 'T12:00:00',
      date: formatSheetDate(att[i][0]),
      classId,
      className: nameMaps.class[classId] || classId,
      studentId,
      studentName: nameMaps.student[studentId] || studentId,
      summary: String(att[i][3] || '') + (att[i][5] ? ' (excuse)' : '')
    });
  }

  const grades = await getSheetRows(GRADES_DAILY_SHEET);
  for (let i = 1; i < grades.length; i++) {
    const classId = String(grades[i][1]);
    if (classFilter && classId !== classFilter) continue;
    const studentId = String(grades[i][2]);
    items.push({
      type: 'grade',
      at: String(grades[i][10] || grades[i][4] || ''),
      date: formatSheetDate(grades[i][4]),
      classId,
      className: nameMaps.class[classId] || classId,
      studentId,
      studentName: nameMaps.student[studentId] || studentId,
      summary: String(grades[i][3]) + ' · ' + String(grades[i][7]) + ' ' + grades[i][5] + '/' + grades[i][6]
    });
  }

  const plans = await getSheetRows(LESSON_PLANS_SHEET);
  for (let i = 1; i < plans.length; i++) {
    const classId = String(plans[i][2]);
    if (classFilter && classId !== classFilter) continue;
    const teacherId = String(plans[i][1]);
    items.push({
      type: 'lesson_plan',
      at: String(plans[i][13] || plans[i][11] || ''),
      date: formatSheetDate(plans[i][14] || plans[i][4]),
      classId,
      className: nameMaps.class[classId] || classId,
      teacherId,
      teacherName: nameMaps.teacher[teacherId] || teacherId,
      summary: String(plans[i][5] || '') + ' · ' + String(plans[i][3]) + ' · ' + String(plans[i][10] || '')
    });
  }

  const planned = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  for (let i = 1; i < planned.length; i++) {
    if (String(planned[i][7]) !== 'Active') continue;
    const classId = String(planned[i][3]);
    if (classFilter && classId !== classFilter) continue;
    items.push({
      type: 'planned_absence',
      at: String(planned[i][8] || planned[i][4] || ''),
      date: formatSheetDate(planned[i][4]),
      classId,
      className: nameMaps.class[classId] || classId,
      studentId: String(planned[i][1]),
      studentName: String(planned[i][2] || ''),
      summary: String(planned[i][5]) + (planned[i][6] ? ' — ' + planned[i][6] : '')
    });
  }

  const msgs = await getSheetRows(MESSAGES_SHEET);
  const header = (msgs[0] || []).map((c) => String(c || '').trim());
  const legacy = header[5] === 'Sender' && !header.includes('ThreadId');
  for (let i = 1; i < msgs.length; i++) {
    const row = msgs[i];
    if (!row || !row[0]) continue;
    const deletedAt = legacy ? String(row[8] || '') : String(row[13] || '');
    if (deletedAt) continue;
    const threadType = legacy ? 'student' : String(row[3] || 'student');
    if (threadType === 'admin') continue;
    const classId = legacy ? String(row[2] || '') : String(row[4] || '');
    if (classFilter && classId && classId !== classFilter) continue;
    const studentId = legacy ? String(row[3] || '') : String(row[5] || '');
    const studentName = legacy ? String(row[4] || '') : String(row[6] || '');
    const sender = legacy ? String(row[5] || '') : String(row[7] || row[9] || '');
    const body = legacy ? String(row[6] || '') : String(row[10] || '');
    items.push({
      type: 'message',
      at: String(row[1] || ''),
      date: String(row[1] || '').slice(0, 10),
      classId,
      className: nameMaps.class[classId] || classId,
      studentId,
      studentName,
      summary: sender + ': ' + body.slice(0, 80)
    });
  }

  let filtered = items;
  if (typeFilter) filtered = filtered.filter((it) => it.type === typeFilter);
  filtered.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return filtered.slice(0, limit);
}

async function getAdminOverview() {
  await ensureGradeSheets();
  await ensureAdminSheet();
  const [classes, teachers, terms] = await Promise.all([
    listClasses(),
    listTeachers(),
    listAllGradeTerms()
  ]);
  const feed = await getMonitoringFeed({ limit: 40 });
  return { classes, teachers, terms, feed };
}

module.exports = {
  ensureAdminSheet,
  listClasses,
  listTeachers,
  saveTeacher,
  listAllGradeTerms,
  saveGradeTerm,
  getMonitoringFeed,
  getAdminOverview
};
