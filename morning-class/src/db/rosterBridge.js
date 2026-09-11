'use strict';

/**
 * Present roster Postgres tables as virtual Sheets so existing services
 * (auth, registries, portals) keep working without a full rewrite.
 * Writes upsert by primary id (col 0). Never touches grade tables.
 */

const { query, table } = require('./pool');
const {
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  STUDENT_PROFILE_SHEET,
  STUDENT_PROFILE_FIELDS_SHEET,
  TEACHER_LIST_SHEET,
  TEACHER_PROFILE_SHEET,
  CLASS_TEACHERS_SHEET,
  PARENT_LIST_SHEET,
  PARENT_STUDENTS_SHEET
} = require('../config');

const HEADERS = {
  [CLASS_LIST_SHEET]: ['ClassID', 'Name', 'ScheduleType', 'AllowedDays'],
  [STUDENT_LIST_SHEET]: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'],
  [STUDENT_PROFILE_SHEET]: [
    'StudentID', 'PhotoPath', 'DateOfBirth', 'Gender', 'Nationality',
    'Address', 'Phone', 'Email', 'ParentName', 'ParentPhone', 'ParentEmail',
    'EmergencyContact', 'EmergencyPhone', 'PreviousSchool', 'GradeLevel',
    'EnrolledDate', 'Notes', 'UpdatedAt'
  ],
  [STUDENT_PROFILE_FIELDS_SHEET]: ['FieldID', 'StudentID', 'Section', 'Label', 'Value', 'SortOrder'],
  [TEACHER_LIST_SHEET]: [
    'TeacherID', 'Name', 'LoginID', 'LoginPassword', 'HomeroomClassID',
    'StaffRole', 'HeadTeacherID', 'Permissions'
  ],
  [TEACHER_PROFILE_SHEET]: [
    'TeacherID', 'PhotoPath', 'DateOfBirth', 'Gender', 'Nationality',
    'Phone', 'Email', 'Address', 'EmergencyContact', 'EmergencyPhone',
    'Title', 'HireDate', 'Education', 'Notes', 'UpdatedAt', 'PreferredName'
  ],
  [CLASS_TEACHERS_SHEET]: ['ClassID', 'TeacherID', 'AssignmentType', 'Subject'],
  [PARENT_LIST_SHEET]: ['ParentID', 'StudentID', 'Name', 'LoginID', 'LoginPassword', 'Phone', 'Email'],
  [PARENT_STUDENTS_SHEET]: ['LinkID', 'ParentID', 'StudentID', 'Relationship', 'IsPrimary', 'LinkedAt']
};

function isRosterSheet(sheetName) {
  return Object.prototype.hasOwnProperty.call(HEADERS, sheetName);
}

function colToIndex(col) {
  let n = 0;
  const s = String(col || '').toUpperCase();
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function parseA1(a1) {
  const m = String(a1 || '').trim().match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
  if (!m) return null;
  return {
    c1: colToIndex(m[1]),
    r1: Number(m[2]),
    c2: colToIndex(m[3] || m[1]),
    r2: Number(m[4] || m[2])
  };
}

async function loadClasses() {
  const r = await query(
    'SELECT class_id, name, schedule_type, allowed_days FROM ' + table('classes') +
      ' ORDER BY class_id'
  );
  return r.rows.map((row) => [
    row.class_id, row.name, row.schedule_type, row.allowed_days
  ]);
}

async function loadStudents() {
  const r = await query(
    'SELECT student_id, name, class_id, status, login_id, login_password FROM ' +
      table('students') + ' ORDER BY student_id'
  );
  return r.rows.map((row) => [
    row.student_id, row.name, row.class_id, row.status, row.login_id, row.login_password
  ]);
}

async function loadStudentProfiles() {
  const r = await query(
    'SELECT student_id, photo_path, date_of_birth, gender, nationality, address, phone, email,' +
      ' parent_name, parent_phone, parent_email, emergency_contact, emergency_phone,' +
      ' previous_school, grade_level, enrolled_date, notes, updated_at FROM ' +
      table('student_profiles') + ' ORDER BY student_id'
  );
  return r.rows.map((row) => [
    row.student_id, row.photo_path, row.date_of_birth, row.gender, row.nationality,
    row.address, row.phone, row.email, row.parent_name, row.parent_phone, row.parent_email,
    row.emergency_contact, row.emergency_phone, row.previous_school, row.grade_level,
    row.enrolled_date, row.notes,
    row.updated_at ? new Date(row.updated_at).toISOString() : ''
  ]);
}

async function loadStudentFields() {
  const r = await query(
    'SELECT field_id, student_id, section, label, value, sort_order FROM ' +
      table('student_profile_fields') + ' ORDER BY student_id, sort_order, field_id'
  );
  return r.rows.map((row) => [
    row.field_id, row.student_id, row.section, row.label, row.value, String(row.sort_order)
  ]);
}

async function loadTeachers() {
  const r = await query(
    'SELECT teacher_id, name, login_id, login_password, homeroom_class_ids, staff_role,' +
      ' head_teacher_id, permissions_json FROM ' + table('teachers') + ' ORDER BY teacher_id'
  );
  return r.rows.map((row) => [
    row.teacher_id, row.name, row.login_id, row.login_password, row.homeroom_class_ids,
    row.staff_role, row.head_teacher_id, row.permissions_json
  ]);
}

async function loadTeacherProfiles() {
  const r = await query(
    'SELECT teacher_id, photo_path, date_of_birth, gender, nationality, phone, email, address,' +
      ' emergency_contact, emergency_phone, title, hire_date, education, notes, updated_at,' +
      ' preferred_name FROM ' + table('teacher_profiles') + ' ORDER BY teacher_id'
  );
  return r.rows.map((row) => [
    row.teacher_id, row.photo_path, row.date_of_birth, row.gender, row.nationality,
    row.phone, row.email, row.address, row.emergency_contact, row.emergency_phone,
    row.title, row.hire_date, row.education, row.notes,
    row.updated_at ? new Date(row.updated_at).toISOString() : '',
    row.preferred_name
  ]);
}

async function loadClassTeachers() {
  const r = await query(
    'SELECT class_id, teacher_id, assignment_type, subject FROM ' + table('class_teachers') +
      ' ORDER BY class_id, teacher_id, assignment_type, subject'
  );
  return r.rows.map((row) => [
    row.class_id, row.teacher_id, row.assignment_type, row.subject
  ]);
}

async function loadParents() {
  const r = await query(
    'SELECT parent_id, legacy_student_id, name, login_id, login_password, phone, email FROM ' +
      table('parents') + ' ORDER BY parent_id'
  );
  return r.rows.map((row) => [
    row.parent_id, row.legacy_student_id, row.name, row.login_id, row.login_password,
    row.phone, row.email
  ]);
}

async function loadParentLinks() {
  const r = await query(
    'SELECT link_id, parent_id, student_id, relationship, is_primary, linked_at FROM ' +
      table('parent_students') + ' ORDER BY parent_id, student_id'
  );
  return r.rows.map((row) => [
    row.link_id, row.parent_id, row.student_id, row.relationship,
    row.is_primary ? 'true' : 'false',
    row.linked_at ? new Date(row.linked_at).toISOString() : ''
  ]);
}

const LOADERS = {
  [CLASS_LIST_SHEET]: loadClasses,
  [STUDENT_LIST_SHEET]: loadStudents,
  [STUDENT_PROFILE_SHEET]: loadStudentProfiles,
  [STUDENT_PROFILE_FIELDS_SHEET]: loadStudentFields,
  [TEACHER_LIST_SHEET]: loadTeachers,
  [TEACHER_PROFILE_SHEET]: loadTeacherProfiles,
  [CLASS_TEACHERS_SHEET]: loadClassTeachers,
  [PARENT_LIST_SHEET]: loadParents,
  [PARENT_STUDENTS_SHEET]: loadParentLinks
};

async function readSheet(sheetName) {
  const header = HEADERS[sheetName];
  const loader = LOADERS[sheetName];
  if (!header || !loader) throw new Error('Unknown roster sheet: ' + sheetName);
  const rows = await loader();
  return [header.slice(), ...rows];
}

function s(row, i) {
  return String((row && row[i]) != null ? row[i] : '').trim();
}

async function upsertClass(row) {
  const classId = s(row, 0);
  if (!classId) return;
  await query(
    'INSERT INTO ' + table('classes') +
      ' (class_id, name, schedule_type, allowed_days, updated_at)' +
      ' VALUES ($1,$2,$3,$4,now())' +
      ' ON CONFLICT (class_id) DO UPDATE SET name = EXCLUDED.name,' +
      ' schedule_type = EXCLUDED.schedule_type, allowed_days = EXCLUDED.allowed_days,' +
      ' updated_at = now()',
    [classId, s(row, 1), s(row, 2) || 'Mon-Fri', s(row, 3) || '1,2,3,4,5']
  );
}

async function upsertStudent(row) {
  const studentId = s(row, 0);
  if (!studentId) return;
  await query(
    'INSERT INTO ' + table('students') +
      ' (student_id, name, class_id, status, login_id, login_password, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,now())' +
      ' ON CONFLICT (student_id) DO UPDATE SET name = EXCLUDED.name, class_id = EXCLUDED.class_id,' +
      ' status = EXCLUDED.status, login_id = EXCLUDED.login_id,' +
      ' login_password = EXCLUDED.login_password, updated_at = now()',
    [studentId, s(row, 1), s(row, 2), s(row, 3) || 'Enrolled', s(row, 4), s(row, 5)]
  );
}

async function upsertStudentProfile(row) {
  const studentId = s(row, 0);
  if (!studentId) return;
  await query(
    'INSERT INTO ' + table('student_profiles') +
      ' (student_id, photo_path, date_of_birth, gender, nationality, address, phone, email,' +
      ' parent_name, parent_phone, parent_email, emergency_contact, emergency_phone,' +
      ' previous_school, grade_level, enrolled_date, notes, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())' +
      ' ON CONFLICT (student_id) DO UPDATE SET' +
      ' photo_path = EXCLUDED.photo_path, date_of_birth = EXCLUDED.date_of_birth,' +
      ' gender = EXCLUDED.gender, nationality = EXCLUDED.nationality, address = EXCLUDED.address,' +
      ' phone = EXCLUDED.phone, email = EXCLUDED.email, parent_name = EXCLUDED.parent_name,' +
      ' parent_phone = EXCLUDED.parent_phone, parent_email = EXCLUDED.parent_email,' +
      ' emergency_contact = EXCLUDED.emergency_contact, emergency_phone = EXCLUDED.emergency_phone,' +
      ' previous_school = EXCLUDED.previous_school, grade_level = EXCLUDED.grade_level,' +
      ' enrolled_date = EXCLUDED.enrolled_date, notes = EXCLUDED.notes, updated_at = now()',
    [
      studentId, s(row, 1), s(row, 2), s(row, 3), s(row, 4), s(row, 5), s(row, 6), s(row, 7),
      s(row, 8), s(row, 9), s(row, 10), s(row, 11), s(row, 12), s(row, 13), s(row, 14),
      s(row, 15), s(row, 16)
    ]
  );
}

async function upsertStudentField(row) {
  const fieldId = s(row, 0);
  if (!fieldId) return;
  await query(
    'INSERT INTO ' + table('student_profile_fields') +
      ' (field_id, student_id, section, label, value, sort_order)' +
      ' VALUES ($1,$2,$3,$4,$5,$6)' +
      ' ON CONFLICT (field_id) DO UPDATE SET student_id = EXCLUDED.student_id,' +
      ' section = EXCLUDED.section, label = EXCLUDED.label, value = EXCLUDED.value,' +
      ' sort_order = EXCLUDED.sort_order',
    [fieldId, s(row, 1), s(row, 2), s(row, 3), s(row, 4), Number(row[5]) || 0]
  );
}

async function upsertTeacher(row) {
  const teacherId = s(row, 0);
  if (!teacherId) return;
  await query(
    'INSERT INTO ' + table('teachers') +
      ' (teacher_id, name, login_id, login_password, homeroom_class_ids, staff_role,' +
      ' head_teacher_id, permissions_json, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())' +
      ' ON CONFLICT (teacher_id) DO UPDATE SET name = EXCLUDED.name, login_id = EXCLUDED.login_id,' +
      ' login_password = EXCLUDED.login_password, homeroom_class_ids = EXCLUDED.homeroom_class_ids,' +
      ' staff_role = EXCLUDED.staff_role, head_teacher_id = EXCLUDED.head_teacher_id,' +
      ' permissions_json = EXCLUDED.permissions_json, updated_at = now()',
    [
      teacherId, s(row, 1), s(row, 2), s(row, 3), s(row, 4),
      s(row, 5) || 'Teacher', s(row, 6), s(row, 7)
    ]
  );
}

async function upsertTeacherProfile(row) {
  const teacherId = s(row, 0);
  if (!teacherId) return;
  await query(
    'INSERT INTO ' + table('teacher_profiles') +
      ' (teacher_id, photo_path, date_of_birth, gender, nationality, phone, email, address,' +
      ' emergency_contact, emergency_phone, title, hire_date, education, notes, preferred_name, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())' +
      ' ON CONFLICT (teacher_id) DO UPDATE SET' +
      ' photo_path = EXCLUDED.photo_path, date_of_birth = EXCLUDED.date_of_birth,' +
      ' gender = EXCLUDED.gender, nationality = EXCLUDED.nationality, phone = EXCLUDED.phone,' +
      ' email = EXCLUDED.email, address = EXCLUDED.address,' +
      ' emergency_contact = EXCLUDED.emergency_contact, emergency_phone = EXCLUDED.emergency_phone,' +
      ' title = EXCLUDED.title, hire_date = EXCLUDED.hire_date, education = EXCLUDED.education,' +
      ' notes = EXCLUDED.notes, preferred_name = EXCLUDED.preferred_name, updated_at = now()',
    [
      teacherId, s(row, 1), s(row, 2), s(row, 3), s(row, 4), s(row, 5), s(row, 6), s(row, 7),
      s(row, 8), s(row, 9), s(row, 10), s(row, 11), s(row, 12), s(row, 13), s(row, 15)
    ]
  );
}

async function upsertClassTeacher(row) {
  const classId = s(row, 0);
  const teacherId = s(row, 1);
  if (!classId || !teacherId) return;
  await query(
    'INSERT INTO ' + table('class_teachers') +
      ' (class_id, teacher_id, assignment_type, subject) VALUES ($1,$2,$3,$4)' +
      ' ON CONFLICT (class_id, teacher_id, assignment_type, subject) DO NOTHING',
    [classId, teacherId, s(row, 2) || 'Subject', s(row, 3)]
  );
}

async function upsertParent(row) {
  const parentId = s(row, 0);
  if (!parentId) return;
  await query(
    'INSERT INTO ' + table('parents') +
      ' (parent_id, legacy_student_id, name, login_id, login_password, phone, email, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,now())' +
      ' ON CONFLICT (parent_id) DO UPDATE SET legacy_student_id = EXCLUDED.legacy_student_id,' +
      ' name = EXCLUDED.name, login_id = EXCLUDED.login_id, login_password = EXCLUDED.login_password,' +
      ' phone = EXCLUDED.phone, email = EXCLUDED.email, updated_at = now()',
    [parentId, s(row, 1), s(row, 2), s(row, 3), s(row, 4), s(row, 5), s(row, 6)]
  );
}

async function upsertParentLink(row) {
  const linkId = s(row, 0);
  if (!linkId) return;
  const isPrimary = String(row[4] || '').toLowerCase() === 'true';
  await query(
    'INSERT INTO ' + table('parent_students') +
      ' (link_id, parent_id, student_id, relationship, is_primary, linked_at)' +
      ' VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()))' +
      ' ON CONFLICT (link_id) DO UPDATE SET parent_id = EXCLUDED.parent_id,' +
      ' student_id = EXCLUDED.student_id, relationship = EXCLUDED.relationship,' +
      ' is_primary = EXCLUDED.is_primary',
    [linkId, s(row, 1), s(row, 2), s(row, 3) || 'Guardian', isPrimary, s(row, 5) || null]
  );
}

const UPSERTS = {
  [CLASS_LIST_SHEET]: upsertClass,
  [STUDENT_LIST_SHEET]: upsertStudent,
  [STUDENT_PROFILE_SHEET]: upsertStudentProfile,
  [STUDENT_PROFILE_FIELDS_SHEET]: upsertStudentField,
  [TEACHER_LIST_SHEET]: upsertTeacher,
  [TEACHER_PROFILE_SHEET]: upsertTeacherProfile,
  [CLASS_TEACHERS_SHEET]: upsertClassTeacher,
  [PARENT_LIST_SHEET]: upsertParent,
  [PARENT_STUDENTS_SHEET]: upsertParentLink
};

async function deleteById(sheetName, id) {
  id = String(id || '').trim();
  if (!id) return;
  const map = {
    [CLASS_LIST_SHEET]: ['classes', 'class_id'],
    [STUDENT_LIST_SHEET]: ['students', 'student_id'],
    [STUDENT_PROFILE_SHEET]: ['student_profiles', 'student_id'],
    [STUDENT_PROFILE_FIELDS_SHEET]: ['student_profile_fields', 'field_id'],
    [TEACHER_LIST_SHEET]: ['teachers', 'teacher_id'],
    [TEACHER_PROFILE_SHEET]: ['teacher_profiles', 'teacher_id'],
    [PARENT_LIST_SHEET]: ['parents', 'parent_id'],
    [PARENT_STUDENTS_SHEET]: ['parent_students', 'link_id']
  };
  if (sheetName === CLASS_TEACHERS_SHEET) {
    // Composite key — delete by matching virtual row handled in deleteRows
    return;
  }
  const spec = map[sheetName];
  if (!spec) return;
  await query('DELETE FROM ' + table(spec[0]) + ' WHERE ' + spec[1] + ' = $1', [id]);
}

async function deleteClassTeacherRow(row) {
  await query(
    'DELETE FROM ' + table('class_teachers') +
      ' WHERE class_id = $1 AND teacher_id = $2 AND assignment_type = $3 AND subject = $4',
    [s(row, 0), s(row, 1), s(row, 2) || 'Subject', s(row, 3)]
  );
}

async function writeRange(sheetName, a1, values) {
  const parsed = parseA1(a1);
  if (!parsed) throw new Error('Unsupported roster range: ' + a1);
  const upsert = UPSERTS[sheetName];
  if (!upsert) throw new Error('Unknown roster sheet write: ' + sheetName);

  // Header-only writes are no-ops (schema is fixed).
  if (parsed.r1 === 1 && parsed.r2 === 1) return;

  const current = await readSheet(sheetName);
  const width = (HEADERS[sheetName] || []).length;

  for (let r = parsed.r1; r <= parsed.r2; r++) {
    if (r === 1) continue; // skip header
    const valueRow = values[r - parsed.r1] || [];
    const existing = (current[r - 1] || []).slice();
    while (existing.length < width) existing.push('');
    for (let c = parsed.c1; c <= parsed.c2; c++) {
      const vi = c - parsed.c1;
      if (vi >= 0 && vi < valueRow.length) existing[c] = valueRow[vi];
    }
    await upsert(existing);
  }
}

async function appendSheetRows(sheetName, rows) {
  const upsert = UPSERTS[sheetName];
  if (!upsert) throw new Error('Unknown roster sheet append: ' + sheetName);
  for (const row of rows || []) {
    // Skip accidental header re-appends
    if (HEADERS[sheetName] && s(row, 0) === HEADERS[sheetName][0]) continue;
    await upsert(row);
  }
}

async function deleteSheetRows(sheetName, rowIndices1Based) {
  const current = await readSheet(sheetName);
  const indices = (rowIndices1Based || [])
    .map((n) => Number(n))
    .filter((n) => n > 1)
    .sort((a, b) => b - a);
  for (const rowNum of indices) {
    const row = current[rowNum - 1];
    if (!row) continue;
    if (sheetName === CLASS_TEACHERS_SHEET) {
      await deleteClassTeacherRow(row);
    } else {
      await deleteById(sheetName, row[0]);
    }
  }
}

module.exports = {
  isRosterSheet,
  readSheet,
  writeRange,
  appendSheetRows,
  deleteSheetRows,
  HEADERS
};
