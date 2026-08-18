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
const { TRANSACTIONS_SHEET } = require('./dollarService');
const { getRecentBuddyActivity } = require('./englishBuddyService');
const { getRecentVocabActivity } = require('./vocabShared');
const {
  listTeachersWithProfiles,
  upsertTeacherProfile,
  getTeacherDetail,
  deleteTeacherRecord
} = require('./teacherRegistryService');
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
  return listTeachersWithProfiles();
}

async function getTeacher(teacherId) {
  return getTeacherDetail(teacherId);
}

async function deleteTeacher(teacherId, session) {
  return deleteTeacherRecord(teacherId, session);
}

async function saveTeacher(payload) {
  const {
    normalizeTitle,
    parsePermissions,
    serializePermissions,
    presetsForTitle,
    STAFF_TITLES
  } = require('./staffPermissionService');
  const { invalidateSheetRowsCache } = require('../sheets');

  const teacherId = String(payload.teacherId || '').trim() || newId('T');
  const name = String(payload.name || '').trim();
  const loginId = String(payload.loginId || '').trim();
  const password = String(payload.password || '').trim();
  const homeroomClassId = String(payload.homeroomClassId || '').trim();
  const staffTitle = normalizeTitle(payload.staffTitle || payload.staffRole || 'Teacher');
  const staffRole = staffTitle;
  const headTeacherId = String(payload.headTeacherId || '').trim();
  if (!name || !loginId) throw new Error('Name and login ID are required.');
  if (!STAFF_TITLES.some((t) => t.toLowerCase() === staffTitle.toLowerCase())) {
    throw new Error('Invalid staff title.');
  }

  const data = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  // Ensure Permissions column header exists (col H)
  if (data[0] && String(data[0][7] || '') !== 'Permissions') {
    const headers = (data[0] || []).slice();
    while (headers.length < 8) headers.push('');
    headers[5] = headers[5] || 'StaffRole';
    headers[6] = headers[6] || 'HeadTeacherID';
    headers[7] = 'Permissions';
    await updateRange(TEACHER_LIST_SHEET, 'A1:H1', [headers.slice(0, 8)]);
  }

  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === teacherId) { found = i + 1; break; }
    if (String(data[i][2]) === loginId && String(data[i][0]) !== teacherId) {
      throw new Error('Login ID already in use.');
    }
  }
  const existingPwd = found > 0 ? String(data[found - 1][3] || '') : '';
  const existingHead = found > 0 ? String(data[found - 1][6] || '') : '';
  const existingPerms = found > 0 ? String(data[found - 1][7] || '') : '';
  let permissions;
  if (payload.permissions != null) {
    permissions = parsePermissions(payload.permissions);
    if (!permissions.length) permissions = presetsForTitle(staffTitle);
  } else if (existingPerms) {
    permissions = parsePermissions(existingPerms);
    if (!permissions.length) permissions = presetsForTitle(staffTitle);
  } else {
    permissions = presetsForTitle(staffTitle);
  }
  const row = [
    teacherId,
    name,
    loginId,
    password || existingPwd || 'changeme123',
    homeroomClassId,
    staffRole,
    headTeacherId || existingHead || '',
    serializePermissions(permissions)
  ];
  if (found > 0) {
    await updateRange(TEACHER_LIST_SHEET, `A${found}:H${found}`, [row]);
  } else {
    if (!password) throw new Error('Password required for new teacher.');
    await appendRows(TEACHER_LIST_SHEET, [row]);
  }
  invalidateSheetRowsCache(TEACHER_LIST_SHEET);

  const profile = await upsertTeacherProfile(teacherId, {
    dateOfBirth: payload.dateOfBirth,
    gender: payload.gender,
    nationality: payload.nationality,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    emergencyContact: payload.emergencyContact,
    emergencyPhone: payload.emergencyPhone,
    title: payload.title,
    hireDate: payload.hireDate,
    education: payload.education,
    notes: payload.notes,
    preferredName: payload.preferredName
  }, { keepPhoto: true });

  const { teacherDisplayName } = require('./teacherRegistryService');
  const preferredName = profile.preferredName || '';
  return {
    teacherId,
    name,
    preferredName,
    displayName: teacherDisplayName(name, preferredName),
    loginId,
    homeroomClassId,
    staffRole,
    staffTitle,
    headTeacherId: headTeacherId || existingHead || '',
    permissions,
    profile,
    photoPath: profile.photoPath || ''
  };
}

async function getMonitoringFeed(options) {
  const classFilter = options && options.classId ? String(options.classId) : '';
  const typeFilter = options && options.type ? String(options.type) : '';
  const limit = Number(options && options.limit) || 80;

  const nameMaps = { student: {}, teacher: {}, class: {} };
  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  const students = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < students.length; i++) {
    nameMaps.student[String(students[i][0])] = String(students[i][1] || '');
  }
  nameMaps.teacher = await teacherDisplayNameMap().catch(() => ({}));
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

  try {
    const txs = await getSheetRows(TRANSACTIONS_SHEET);
    for (let i = 1; i < txs.length; i++) {
      const classId = String(txs[i][1] || '');
      if (classFilter && classId && classId !== classFilter) continue;
      const studentId = String(txs[i][2] || '');
      const amt = Number(txs[i][3]) || 0;
      items.push({
        type: 'dollar',
        at: String(txs[i][0] || ''),
        date: String(txs[i][0] || '').slice(0, 10),
        classId,
        className: nameMaps.class[classId] || classId,
        studentId,
        studentName: nameMaps.student[studentId] || studentId,
        summary: (amt > 0 ? '+' : '') + amt + ' · bal ' + (txs[i][4] || '') +
          (txs[i][5] ? ' — ' + txs[i][5] : '')
      });
    }
  } catch (e) { /* dollar sheet may not exist yet */ }

  try {
    const hwLogs = await getSheetRows('Homework_Log');
    for (let i = 1; i < hwLogs.length; i++) {
      const classId = String(hwLogs[i][1] || '');
      if (classFilter && classId && classId !== classFilter) continue;
      items.push({
        type: 'homework',
        at: String(hwLogs[i][6] || hwLogs[i][2] || ''),
        date: String(hwLogs[i][2] || '').slice(0, 10),
        classId,
        className: nameMaps.class[classId] || classId,
        studentId: '',
        studentName: '',
        summary: 'Posted: ' + String(hwLogs[i][3] || 'Homework')
      });
    }
    const hwComp = await getSheetRows('Homework_Completion');
    for (let i = 1; i < hwComp.length; i++) {
      if (String(hwComp[i][2] || '').toUpperCase() !== 'TRUE' && hwComp[i][2] !== true) continue;
      const studentId = String(hwComp[i][1] || '');
      const at = String(hwComp[i][3] || '');
      items.push({
        type: 'homework',
        at,
        date: at.slice(0, 10),
        classId: classFilter || '',
        className: classFilter ? (nameMaps.class[classFilter] || classFilter) : '',
        studentId,
        studentName: nameMaps.student[studentId] || studentId,
        summary: 'Completed item ' + String(hwComp[i][0] || '') +
          (hwComp[i][4] ? ' — ' + hwComp[i][4] : '')
      });
    }
  } catch (e) { /* homework sheets may not exist yet */ }

  try {
    const buddyActs = await getRecentBuddyActivity(80);
    for (const b of buddyActs) {
      if (classFilter && b.classId && b.classId !== classFilter) continue;
      items.push({
        type: 'english_buddy',
        at: b.at,
        date: String(b.at || '').slice(0, 10),
        classId: b.classId,
        className: nameMaps.class[b.classId] || b.classId,
        studentId: b.studentId,
        studentName: nameMaps.student[b.studentId] || b.studentId,
        summary: 'Buddy: ' + (b.summary || '')
      });
    }
  } catch (e) { /* buddy history may not exist yet */ }

  try {
    const vocabActs = await getRecentVocabActivity(80);
    for (const v of vocabActs) {
      items.push({
        type: 'vocab',
        at: v.at,
        date: String(v.at || '').slice(0, 10),
        classId: classFilter || '',
        className: '',
        studentId: v.studentId,
        studentName: nameMaps.student[v.studentId] || v.studentId,
        summary: (v.kind || 'vocab') + ': ' + (v.wordId || '') + (v.correct ? ' ✓' : ' ✗')
      });
    }
  } catch (e) { /* vocab may not exist yet */ }

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

/**
 * Ensure demo Principal + Head Teacher accounts exist on Teacher_List.
 * Also backfills HeadTeacherID on regular teachers that have none assigned.
 */
async function ensureLeadershipAccounts() {
  await ensureAdminSheet();
  const { invalidateSheetRowsCache } = require('../sheets');
  const { presetsForTitle, serializePermissions } = require('./staffPermissionService');
  const rows = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  const desiredHeaders = [
    'TeacherID', 'Name', 'LoginID', 'LoginPassword',
    'HomeroomClassID', 'StaffRole', 'HeadTeacherID', 'Permissions'
  ];
  if (!rows.length) {
    await appendRows(TEACHER_LIST_SHEET, [desiredHeaders]);
  } else {
    const headers = rows[0].slice();
    while (headers.length < 8) headers.push('');
    let dirty = false;
    desiredHeaders.forEach((h, i) => {
      if (String(headers[i] || '').trim() !== h) {
        headers[i] = h;
        dirty = true;
      }
    });
    if (dirty) {
      await updateRange(TEACHER_LIST_SHEET, 'A1:H1', [headers.slice(0, 8)]);
    }
  }

  const data = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  const byLogin = {};
  const byRole = {};
  for (let i = 1; i < data.length; i++) {
    const login = String(data[i][2] || '').trim().toLowerCase();
    const role = String(data[i][5] || 'Teacher').trim();
    if (login) byLogin[login] = { rowIndex: i + 1, row: data[i] };
    const rk = role.toLowerCase();
    if (!byRole[rk]) byRole[rk] = [];
    byRole[rk].push({ rowIndex: i + 1, row: data[i] });
  }

  async function upsertAccount(spec) {
    const existing = byLogin[spec.loginId.toLowerCase()] ||
      (byRole[spec.staffRole.toLowerCase()] && byRole[spec.staffRole.toLowerCase()][0]);
    const permJson = serializePermissions(presetsForTitle(spec.staffRole));
    if (existing) {
      const r = existing.row;
      const teacherId = String(r[0]);
      const row = [
        teacherId,
        String(r[1] || spec.name),
        String(r[2] || spec.loginId),
        String(r[3] || spec.password),
        String(r[4] || ''),
        spec.staffRole,
        String(r[6] || ''),
        String(r[7] || '').trim() || permJson
      ];
      await updateRange(TEACHER_LIST_SHEET, `A${existing.rowIndex}:H${existing.rowIndex}`, [row]);
      return teacherId;
    }
    const teacherId = spec.teacherId;
    await appendRows(TEACHER_LIST_SHEET, [[
      teacherId, spec.name, spec.loginId, spec.password, '', spec.staffRole, '', permJson
    ]]);
    return teacherId;
  }

  const principalId = await upsertAccount({
    teacherId: 'T_PRINCIPAL',
    name: 'Salt Principal',
    loginId: 'principal',
    password: 'principal123',
    staffRole: 'Principal'
  });

  const headId = await upsertAccount({
    teacherId: 'T_HEAD',
    name: 'Salt Head Teacher',
    loginId: 'head',
    password: 'head123',
    staffRole: 'Head Teacher'
  });

  // Assign Head Teacher to teachers that have none (skip Principal / Head themselves).
  invalidateSheetRowsCache(TEACHER_LIST_SHEET);
  const fresh = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  for (let i = 1; i < fresh.length; i++) {
    const tid = String(fresh[i][0] || '');
    const role = String(fresh[i][5] || 'Teacher').trim();
    if (!tid || tid === headId || tid === principalId) continue;
    if (/^principal$/i.test(role) || /head\s*teacher/i.test(role)) continue;
    const currentHead = String(fresh[i][6] || '').trim();
    if (currentHead) continue;
    const row = [
      tid,
      String(fresh[i][1] || ''),
      String(fresh[i][2] || ''),
      String(fresh[i][3] || ''),
      String(fresh[i][4] || ''),
      role || 'Teacher',
      headId,
      String(fresh[i][7] || '')
    ];
    await updateRange(TEACHER_LIST_SHEET, `A${i + 1}:H${i + 1}`, [row]);
  }
  invalidateSheetRowsCache(TEACHER_LIST_SHEET);
  return { principalId, headId };
}

module.exports = {
  ensureAdminSheet,
  ensureLeadershipAccounts,
  listClasses,
  listTeachers,
  getTeacher,
  saveTeacher,
  deleteTeacher,
  listAllGradeTerms,
  saveGradeTerm,
  getMonitoringFeed,
  getAdminOverview
};
