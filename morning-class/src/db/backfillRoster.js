'use strict';

/**
 * One-time copy of roster master sheets → salt_morning Postgres.
 * Safe to re-run: INSERT ON CONFLICT DO NOTHING.
 * Does not modify grade tables.
 */

const { isOpsDbEnabled, query, table } = require('./pool');
// Alias kept explicit — pool export is isOpsDbEnabled.
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

const META_KEY = 'roster_backfilled';

async function getMeta(key) {
  const r = await query(
    'SELECT value FROM ' + table('meta') + ' WHERE key = $1',
    [key]
  );
  return r.rows[0] ? String(r.rows[0].value || '') : '';
}

async function setMeta(key, value) {
  await query(
    'INSERT INTO ' + table('meta') +
      ' (key, value, updated_at) VALUES ($1, $2, now())' +
      ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [key, String(value)]
  );
}

async function insertIgnore(tableName, columns, rows) {
  if (!rows.length) return 0;
  const chunkSize = 150;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params = [];
    const values = chunk.map((row, idx) => {
      const start = idx * columns.length;
      row.forEach((v) => params.push(v));
      return '(' + columns.map((_, c) => '$' + (start + c + 1)).join(', ') + ')';
    });
    const r = await query(
      'INSERT INTO ' + table(tableName) + ' (' + columns.join(', ') + ') VALUES ' +
        values.join(', ') + ' ON CONFLICT DO NOTHING',
      params
    );
    inserted += r.rowCount || 0;
  }
  return inserted;
}

function dedupe(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (key) map.set(key, row);
  });
  return Array.from(map.values());
}

async function readSheetRows(sheetName) {
  try {
    const { getSheetRows } = require('../sheets');
    // Force Google path during backfill — bridge must not recurse into PG.
    return await getSheetRows(sheetName, { skipCache: true, forceGoogle: true });
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (/Unable to parse range|Unable to find|not found/i.test(msg)) {
      console.warn('[ops-db] sheet missing ' + sheetName + ':', msg);
      return [];
    }
    throw e;
  }
}

function cell(row, i) {
  return String((row && row[i]) || '').trim();
}

async function backfillRosterFromSheets() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };
  if ((await getMeta(META_KEY)) === '1') {
    return { ok: true, skipped: true };
  }

  const [
    classRaw, studentRaw, sProfileRaw, sFieldRaw,
    teacherRaw, tProfileRaw, classTeachRaw, parentRaw, parentLinkRaw
  ] = await Promise.all([
    readSheetRows(CLASS_LIST_SHEET),
    readSheetRows(STUDENT_LIST_SHEET),
    readSheetRows(STUDENT_PROFILE_SHEET),
    readSheetRows(STUDENT_PROFILE_FIELDS_SHEET),
    readSheetRows(TEACHER_LIST_SHEET),
    readSheetRows(TEACHER_PROFILE_SHEET),
    readSheetRows(CLASS_TEACHERS_SHEET),
    readSheetRows(PARENT_LIST_SHEET),
    readSheetRows(PARENT_STUDENTS_SHEET)
  ]);

  const classes = [];
  for (let i = 1; i < classRaw.length; i++) {
    const row = classRaw[i] || [];
    const classId = cell(row, 0);
    if (!classId) continue;
    classes.push([
      classId,
      cell(row, 1),
      cell(row, 2) || 'Mon-Fri',
      cell(row, 3) || '1,2,3,4,5'
    ]);
  }

  const students = [];
  for (let i = 1; i < studentRaw.length; i++) {
    const row = studentRaw[i] || [];
    const studentId = cell(row, 0);
    if (!studentId) continue;
    students.push([
      studentId,
      cell(row, 1),
      cell(row, 2),
      cell(row, 3) || 'Enrolled',
      cell(row, 4),
      cell(row, 5)
    ]);
  }

  const studentProfiles = [];
  for (let i = 1; i < sProfileRaw.length; i++) {
    const row = sProfileRaw[i] || [];
    const studentId = cell(row, 0);
    if (!studentId) continue;
    studentProfiles.push([
      studentId,
      cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4),
      cell(row, 5), cell(row, 6), cell(row, 7), cell(row, 8),
      cell(row, 9), cell(row, 10), cell(row, 11), cell(row, 12),
      cell(row, 13), cell(row, 14), cell(row, 15), cell(row, 16),
      cell(row, 17) || new Date().toISOString()
    ]);
  }

  const studentFields = [];
  for (let i = 1; i < sFieldRaw.length; i++) {
    const row = sFieldRaw[i] || [];
    const fieldId = cell(row, 0);
    const studentId = cell(row, 1);
    if (!fieldId || !studentId) continue;
    studentFields.push([
      fieldId,
      studentId,
      cell(row, 2),
      cell(row, 3),
      cell(row, 4),
      Number(row[5]) || 0
    ]);
  }

  const teachers = [];
  for (let i = 1; i < teacherRaw.length; i++) {
    const row = teacherRaw[i] || [];
    const teacherId = cell(row, 0);
    if (!teacherId) continue;
    teachers.push([
      teacherId,
      cell(row, 1),
      cell(row, 2),
      cell(row, 3),
      cell(row, 4),
      cell(row, 5) || 'Teacher',
      cell(row, 6),
      cell(row, 7)
    ]);
  }

  const teacherProfiles = [];
  for (let i = 1; i < tProfileRaw.length; i++) {
    const row = tProfileRaw[i] || [];
    const teacherId = cell(row, 0);
    if (!teacherId) continue;
    teacherProfiles.push([
      teacherId,
      cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4),
      cell(row, 5), cell(row, 6), cell(row, 7), cell(row, 8),
      cell(row, 9), cell(row, 10), cell(row, 11), cell(row, 12),
      cell(row, 13), cell(row, 14) || new Date().toISOString(),
      cell(row, 15)
    ]);
  }

  const classTeachers = [];
  for (let i = 1; i < classTeachRaw.length; i++) {
    const row = classTeachRaw[i] || [];
    const classId = cell(row, 0);
    const teacherId = cell(row, 1);
    if (!classId || !teacherId) continue;
    classTeachers.push([
      classId,
      teacherId,
      cell(row, 2) || 'Subject',
      cell(row, 3)
    ]);
  }

  const parents = [];
  for (let i = 1; i < parentRaw.length; i++) {
    const row = parentRaw[i] || [];
    const parentId = cell(row, 0);
    if (!parentId) continue;
    parents.push([
      parentId,
      cell(row, 1),
      cell(row, 2),
      cell(row, 3),
      cell(row, 4),
      cell(row, 5),
      cell(row, 6)
    ]);
  }

  const parentLinks = [];
  for (let i = 1; i < parentLinkRaw.length; i++) {
    const row = parentLinkRaw[i] || [];
    const linkId = cell(row, 0);
    const parentId = cell(row, 1);
    const studentId = cell(row, 2);
    if (!linkId || !parentId || !studentId) continue;
    const isPrimary = String(row[4] || '').toLowerCase() === 'true';
    let linkedAt = cell(row, 5);
    if (!linkedAt) linkedAt = new Date().toISOString();
    parentLinks.push([
      linkId,
      parentId,
      studentId,
      cell(row, 3) || 'Guardian',
      isPrimary,
      linkedAt
    ]);
  }

  const copied = {
    classes: await insertIgnore(
      'classes',
      ['class_id', 'name', 'schedule_type', 'allowed_days'],
      dedupe(classes, (r) => r[0])
    ),
    students: await insertIgnore(
      'students',
      ['student_id', 'name', 'class_id', 'status', 'login_id', 'login_password'],
      dedupe(students, (r) => r[0])
    ),
    studentProfiles: await insertIgnore(
      'student_profiles',
      [
        'student_id', 'photo_path', 'date_of_birth', 'gender', 'nationality',
        'address', 'phone', 'email', 'parent_name', 'parent_phone', 'parent_email',
        'emergency_contact', 'emergency_phone', 'previous_school', 'grade_level',
        'enrolled_date', 'notes', 'updated_at'
      ],
      dedupe(studentProfiles, (r) => r[0])
    ),
    studentFields: await insertIgnore(
      'student_profile_fields',
      ['field_id', 'student_id', 'section', 'label', 'value', 'sort_order'],
      dedupe(studentFields, (r) => r[0])
    ),
    teachers: await insertIgnore(
      'teachers',
      [
        'teacher_id', 'name', 'login_id', 'login_password', 'homeroom_class_ids',
        'staff_role', 'head_teacher_id', 'permissions_json'
      ],
      dedupe(teachers, (r) => r[0])
    ),
    teacherProfiles: await insertIgnore(
      'teacher_profiles',
      [
        'teacher_id', 'photo_path', 'date_of_birth', 'gender', 'nationality',
        'phone', 'email', 'address', 'emergency_contact', 'emergency_phone',
        'title', 'hire_date', 'education', 'notes', 'updated_at', 'preferred_name'
      ],
      dedupe(teacherProfiles, (r) => r[0])
    ),
    classTeachers: await insertIgnore(
      'class_teachers',
      ['class_id', 'teacher_id', 'assignment_type', 'subject'],
      dedupe(classTeachers, (r) => r[0] + '|' + r[1] + '|' + r[2] + '|' + r[3])
    ),
    parents: await insertIgnore(
      'parents',
      [
        'parent_id', 'legacy_student_id', 'name', 'login_id', 'login_password',
        'phone', 'email'
      ],
      dedupe(parents, (r) => r[0])
    ),
    parentLinks: await insertIgnore(
      'parent_students',
      ['link_id', 'parent_id', 'student_id', 'relationship', 'is_primary', 'linked_at'],
      dedupe(parentLinks, (r) => r[0])
    )
  };

  await setMeta(META_KEY, '1');
  return {
    ok: true,
    copied,
    scanned: {
      classes: classes.length,
      students: students.length,
      teachers: teachers.length,
      parents: parents.length
    }
  };
}

module.exports = { backfillRosterFromSheets };
