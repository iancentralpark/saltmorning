const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  STUDENT_LIST_SHEET,
  STUDENT_PROFILE_SHEET,
  STUDENT_PROFILE_FIELDS_SHEET,
  CLASS_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getTeacherClasses, getClassRoster } = require('./teacherPortalService');

const LIST_COL = {
  studentId: 0, name: 1, classId: 2, status: 3, loginId: 4, loginPassword: 5
};

const PROFILE_COL = {
  studentId: 0, photoPath: 1, dateOfBirth: 2, gender: 3, nationality: 4,
  address: 5, phone: 6, email: 7, parentName: 8, parentPhone: 9, parentEmail: 10,
  emergencyContact: 11, emergencyPhone: 12, previousSchool: 13, gradeLevel: 14,
  enrolledDate: 15, notes: 16, updatedAt: 17
};

const PROFILE_HEADERS = [
  'StudentID', 'PhotoPath', 'DateOfBirth', 'Gender', 'Nationality',
  'Address', 'Phone', 'Email', 'ParentName', 'ParentPhone', 'ParentEmail',
  'EmergencyContact', 'EmergencyPhone', 'PreviousSchool', 'GradeLevel',
  'EnrolledDate', 'Notes', 'UpdatedAt'
];

const FIELD_COL = { fieldId: 0, studentId: 1, section: 2, label: 3, value: 4, sortOrder: 5 };
const FIELD_HEADERS = ['FieldID', 'StudentID', 'Section', 'Label', 'Value', 'SortOrder'];

const SECTION_TEMPLATES = {
  gradebook: [
    'Previous school grades', 'Placement level', 'ESL level',
    'Reading level', 'Math level', 'Notes'
  ],
  schedule: [
    'Preferred days', 'Transport method', 'Pickup person',
    'Special schedule', 'Attendance notes'
  ],
  medical: [
    'Allergies', 'Medications', 'Medical conditions',
    'Dietary restrictions', 'Doctor name', 'Doctor phone', 'Notes'
  ]
};

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'students');

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function emptyTemplates() {
  const out = {};
  Object.keys(SECTION_TEMPLATES).forEach((section) => {
    out[section] = SECTION_TEMPLATES[section].map((label, i) => ({
      fieldId: '', label, value: '', sortOrder: i
    }));
  });
  return out;
}

function rowToListStudent(row) {
  if (!row || !row[LIST_COL.studentId]) return null;
  return {
    studentId: String(row[LIST_COL.studentId]),
    name: String(row[LIST_COL.name] || ''),
    classId: String(row[LIST_COL.classId] || '').trim(),
    status: String(row[LIST_COL.status] || 'Enrolled').trim() || 'Enrolled',
    loginId: String(row[LIST_COL.loginId] || ''),
    hasPassword: Boolean(String(row[LIST_COL.loginPassword] || '').trim())
  };
}

function rowToProfile(row) {
  if (!row || !row[PROFILE_COL.studentId]) return null;
  return {
    studentId: String(row[PROFILE_COL.studentId]),
    photoPath: String(row[PROFILE_COL.photoPath] || '').trim(),
    dateOfBirth: String(row[PROFILE_COL.dateOfBirth] || ''),
    gender: String(row[PROFILE_COL.gender] || ''),
    nationality: String(row[PROFILE_COL.nationality] || ''),
    address: String(row[PROFILE_COL.address] || ''),
    phone: String(row[PROFILE_COL.phone] || ''),
    email: String(row[PROFILE_COL.email] || ''),
    parentName: String(row[PROFILE_COL.parentName] || ''),
    parentPhone: String(row[PROFILE_COL.parentPhone] || ''),
    parentEmail: String(row[PROFILE_COL.parentEmail] || ''),
    emergencyContact: String(row[PROFILE_COL.emergencyContact] || ''),
    emergencyPhone: String(row[PROFILE_COL.emergencyPhone] || ''),
    previousSchool: String(row[PROFILE_COL.previousSchool] || ''),
    gradeLevel: String(row[PROFILE_COL.gradeLevel] || ''),
    enrolledDate: String(row[PROFILE_COL.enrolledDate] || ''),
    notes: String(row[PROFILE_COL.notes] || ''),
    updatedAt: String(row[PROFILE_COL.updatedAt] || '')
  };
}

function profileToRow(profile) {
  return [
    profile.studentId,
    profile.photoPath || '',
    profile.dateOfBirth || '',
    profile.gender || '',
    profile.nationality || '',
    profile.address || '',
    profile.phone || '',
    profile.email || '',
    profile.parentName || '',
    profile.parentPhone || '',
    profile.parentEmail || '',
    profile.emergencyContact || '',
    profile.emergencyPhone || '',
    profile.previousSchool || '',
    profile.gradeLevel || '',
    profile.enrolledDate || '',
    profile.notes || '',
    profile.updatedAt || isoNow()
  ];
}

async function ensureRegistrySheets() {
  await ensureSheet(STUDENT_PROFILE_SHEET, PROFILE_HEADERS);
  await ensureSheet(STUDENT_PROFILE_FIELDS_SHEET, FIELD_HEADERS);
}

async function getClassNameMap() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id) map[id] = String(rows[i][1] || id);
  }
  return map;
}

async function nextStudentId() {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  let max = 0;
  for (let i = 1; i < rows.length; i++) {
    const m = String(rows[i][0] || '').match(/^S(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'S' + String(max + 1).padStart(3, '0');
}

async function loadProfileMap() {
  await ensureRegistrySheets();
  const rows = await getSheetRows(STUDENT_PROFILE_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const p = rowToProfile(rows[i]);
    if (p) map[p.studentId] = p;
  }
  return map;
}

async function loadFieldsForStudent(studentId) {
  await ensureRegistrySheets();
  const rows = await getSheetRows(STUDENT_PROFILE_FIELDS_SHEET);
  const grouped = { gradebook: [], schedule: [], medical: [] };
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][FIELD_COL.studentId]) !== String(studentId)) continue;
    const section = String(rows[i][FIELD_COL.section] || '').trim();
    if (!grouped[section]) continue;
    grouped[section].push({
      fieldId: String(rows[i][FIELD_COL.fieldId] || ''),
      label: String(rows[i][FIELD_COL.label] || ''),
      value: String(rows[i][FIELD_COL.value] || ''),
      sortOrder: Number(rows[i][FIELD_COL.sortOrder]) || 0,
      rowIndex: i + 1
    });
  }
  Object.keys(grouped).forEach((section) => {
    grouped[section].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    if (!grouped[section].length) {
      grouped[section] = emptyTemplates()[section];
    }
  });
  return grouped;
}

function mergeStudentSummary(listRow, profile, classNames) {
  const base = rowToListStudent(listRow);
  if (!base) return null;
  const p = profile || {};
  return {
    ...base,
    className: base.classId ? (classNames[base.classId] || base.classId) : '—',
    photoPath: p.photoPath || '',
    gradeLevel: p.gradeLevel || '',
    parentName: p.parentName || ''
  };
}

async function listStudents(options) {
  options = options || {};
  const classFilter = options.classId ? String(options.classId) : '';
  const statusFilter = options.status ? String(options.status) : '';
  const query = String(options.q || '').trim().toLowerCase();
  const studentIdSet = options.studentIds ? new Set(options.studentIds.map(String)) : null;

  const [listRows, profileMap, classNames] = await Promise.all([
    getSheetRows(STUDENT_LIST_SHEET),
    loadProfileMap(),
    getClassNameMap()
  ]);

  const students = [];
  for (let i = 1; i < listRows.length; i++) {
    const base = rowToListStudent(listRows[i]);
    if (!base) continue;
    if (studentIdSet && !studentIdSet.has(base.studentId)) continue;
    if (classFilter && base.classId !== classFilter) continue;
    if (statusFilter && base.status !== statusFilter) continue;
    if (query) {
      const hay = [base.studentId, base.name, base.classId, base.loginId].join(' ').toLowerCase();
      if (!hay.includes(query)) continue;
    }
    students.push(mergeStudentSummary(listRows[i], profileMap[base.studentId], classNames));
  }
  students.sort((a, b) => a.name.localeCompare(b.name));
  return students;
}

async function getStudent(studentId) {
  studentId = String(studentId || '').trim();
  if (!studentId) throw new Error('Student ID is required.');

  const [listRows, profileMap, classNames, fields] = await Promise.all([
    getSheetRows(STUDENT_LIST_SHEET),
    loadProfileMap(),
    getClassNameMap(),
    loadFieldsForStudent(studentId)
  ]);

  let listRow = null;
  for (let i = 1; i < listRows.length; i++) {
    if (String(listRows[i][LIST_COL.studentId]) === studentId) {
      listRow = listRows[i];
      break;
    }
  }
  if (!listRow) throw new Error('Student not found.');

  const summary = mergeStudentSummary(listRow, profileMap[studentId], classNames);
  const profile = profileMap[studentId] || {
    studentId,
    photoPath: '',
    dateOfBirth: '', gender: '', nationality: '',
    address: '', phone: '', email: '',
    parentName: '', parentPhone: '', parentEmail: '',
    emergencyContact: '', emergencyPhone: '',
    previousSchool: '', gradeLevel: '', enrolledDate: '', notes: '', updatedAt: ''
  };

  return {
    ...summary,
    profile,
    fields,
    sectionTemplates: SECTION_TEMPLATES
  };
}

async function saveStudent(payload) {
  await ensureRegistrySheets();

  let studentId = String(payload.studentId || '').trim();
  const isNew = !studentId;
  if (!studentId) studentId = await nextStudentId();

  const name = String(payload.name || '').trim();
  const classId = String(payload.classId || '').trim();
  const status = String(payload.status || 'Enrolled').trim() || 'Enrolled';
  const loginId = String(payload.loginId || '').trim();
  const password = String(payload.password || '').trim();

  if (!name) throw new Error('Student name is required.');

  const listRows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  let listRowIndex = -1;
  for (let i = 1; i < listRows.length; i++) {
    const rowId = String(listRows[i][LIST_COL.studentId] || '');
    if (rowId === studentId) { listRowIndex = i + 1; continue; }
    if (loginId && String(listRows[i][LIST_COL.loginId]) === loginId && rowId !== studentId) {
      throw new Error('Login ID already in use.');
    }
  }

  const existingPwd = listRowIndex > 0 ? String(listRows[listRowIndex - 1][LIST_COL.loginPassword] || '') : '';
  const listRow = [
    studentId, name, classId, status,
    loginId || (isNew ? studentId.toLowerCase() : String(listRows[listRowIndex - 1][LIST_COL.loginId] || '')),
    password || existingPwd || (isNew ? 'changeme123' : existingPwd)
  ];

  if (listRowIndex > 0) {
    await updateRange(STUDENT_LIST_SHEET, `A${listRowIndex}:F${listRowIndex}`, [listRow]);
  } else {
    await appendRows(STUDENT_LIST_SHEET, [listRow]);
  }
  invalidateSheetRowsCache(STUDENT_LIST_SHEET);

  const profilePayload = payload.profile || {};
  const profileMap = await loadProfileMap();
  const existing = profileMap[studentId] || { studentId, photoPath: '' };
  const profile = {
    studentId,
    photoPath: existing.photoPath || '',
    dateOfBirth: String(profilePayload.dateOfBirth || ''),
    gender: String(profilePayload.gender || ''),
    nationality: String(profilePayload.nationality || ''),
    address: String(profilePayload.address || ''),
    phone: String(profilePayload.phone || ''),
    email: String(profilePayload.email || ''),
    parentName: String(profilePayload.parentName || ''),
    parentPhone: String(profilePayload.parentPhone || ''),
    parentEmail: String(profilePayload.parentEmail || ''),
    emergencyContact: String(profilePayload.emergencyContact || ''),
    emergencyPhone: String(profilePayload.emergencyPhone || ''),
    previousSchool: String(profilePayload.previousSchool || ''),
    gradeLevel: String(profilePayload.gradeLevel || ''),
    enrolledDate: String(profilePayload.enrolledDate || ''),
    notes: String(profilePayload.notes || ''),
    updatedAt: isoNow()
  };

  const profileRows = await getSheetRows(STUDENT_PROFILE_SHEET, { skipCache: true });
  let profileRowIndex = -1;
  for (let i = 1; i < profileRows.length; i++) {
    if (String(profileRows[i][PROFILE_COL.studentId]) === studentId) {
      profileRowIndex = i + 1;
      break;
    }
  }
  const profileRow = profileToRow(profile);
  if (profileRowIndex > 0) {
    await updateRange(STUDENT_PROFILE_SHEET, `A${profileRowIndex}:R${profileRowIndex}`, [profileRow]);
  } else {
    await appendRows(STUDENT_PROFILE_SHEET, [profileRow]);
  }
  invalidateSheetRowsCache(STUDENT_PROFILE_SHEET);

  if (payload.fields) {
    await saveStudentFields(studentId, payload.fields);
  }

  return getStudent(studentId);
}

async function saveStudentFields(studentId, fieldsBySection) {
  await ensureRegistrySheets();
  const allRows = await getSheetRows(STUDENT_PROFILE_FIELDS_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    if (String(allRows[i][FIELD_COL.studentId]) !== String(studentId)) {
      kept.push(allRows[i]);
    }
  }

  const newFieldRows = [];
  Object.keys(SECTION_TEMPLATES).forEach((section) => {
    const items = fieldsBySection[section] || [];
    items.forEach((item, idx) => {
      const label = String(item.label || '').trim();
      const value = String(item.value || '').trim();
      if (!label && !value) return;
      newFieldRows.push([
        String(item.fieldId || '').trim() || newId('fld'),
        studentId,
        section,
        label || 'Field',
        value,
        String(Number(item.sortOrder) || idx)
      ]);
    });
  });

  const combined = kept.concat(newFieldRows);
  const oldDataRowCount = Math.max(0, allRows.length - 1);

  if (!combined.length && !oldDataRowCount) return;

  if (!oldDataRowCount && combined.length) {
    await appendRows(STUDENT_PROFILE_FIELDS_SHEET, combined);
  } else {
    const rowWidth = FIELD_HEADERS.length;
    const maxRows = Math.max(oldDataRowCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(rowWidth).fill(''));
    }
    await updateRange(STUDENT_PROFILE_FIELDS_SHEET, `A2:F${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(STUDENT_PROFILE_FIELDS_SHEET);
}

async function getTeacherStudentIds(teacherId) {
  const { homeroom, assigned } = await getTeacherClasses(teacherId);
  const classIds = new Set();
  (homeroom || []).forEach((c) => classIds.add(c.classId));
  (assigned || []).forEach((c) => classIds.add(c.classId));

  const ids = new Set();
  for (const classId of classIds) {
    const roster = await getClassRoster(classId);
    roster.forEach((s) => ids.add(s.studentId));
  }
  return ids;
}

async function teacherCanViewStudent(teacherId, studentId) {
  const ids = await getTeacherStudentIds(teacherId);
  return ids.has(String(studentId));
}

async function listStudentsForTeacher(teacherId, options) {
  const ids = await getTeacherStudentIds(teacherId);
  return listStudents({
    ...options,
    studentIds: Array.from(ids)
  });
}

async function getStudentForTeacher(teacherId, studentId) {
  const ok = await teacherCanViewStudent(teacherId, studentId);
  if (!ok) throw new Error('You do not have access to this student.');
  return getStudent(studentId);
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function photoPathFor(studentId, ext) {
  return '/uploads/students/' + studentId + ext;
}

function localPhotoPath(studentId, ext) {
  return path.join(UPLOAD_DIR, studentId + ext);
}

async function saveStudentPhoto(studentId, file) {
  studentId = String(studentId || '').trim();
  if (!studentId) throw new Error('Student ID is required.');
  if (!file || !file.buffer) throw new Error('Photo file is required.');

  const listRows = await getSheetRows(STUDENT_LIST_SHEET);
  let found = false;
  for (let i = 1; i < listRows.length; i++) {
    if (String(listRows[i][LIST_COL.studentId]) === studentId) { found = true; break; }
  }
  if (!found) throw new Error('Student not found.');

  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  const ext = allowed[file.mimetype];
  if (!ext) throw new Error('Photo must be JPEG, PNG, or WebP.');

  ensureUploadDir();
  ['.jpg', '.png', '.webp'].forEach((e) => {
    const p = localPhotoPath(studentId, e);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  fs.writeFileSync(localPhotoPath(studentId, ext), file.buffer);
  const webPath = photoPathFor(studentId, ext);

  await ensureRegistrySheets();
  const profileMap = await loadProfileMap();
  const existing = profileMap[studentId];
  const profile = existing || {
    studentId, photoPath: '', dateOfBirth: '', gender: '', nationality: '',
    address: '', phone: '', email: '', parentName: '', parentPhone: '', parentEmail: '',
    emergencyContact: '', emergencyPhone: '', previousSchool: '', gradeLevel: '',
    enrolledDate: '', notes: '', updatedAt: ''
  };
  profile.photoPath = webPath;
  profile.updatedAt = isoNow();

  const profileRows = await getSheetRows(STUDENT_PROFILE_SHEET, { skipCache: true });
  let profileRowIndex = -1;
  for (let i = 1; i < profileRows.length; i++) {
    if (String(profileRows[i][PROFILE_COL.studentId]) === studentId) {
      profileRowIndex = i + 1;
      break;
    }
  }
  const row = profileToRow(profile);
  if (profileRowIndex > 0) {
    await updateRange(STUDENT_PROFILE_SHEET, `A${profileRowIndex}:R${profileRowIndex}`, [row]);
  } else {
    await appendRows(STUDENT_PROFILE_SHEET, [row]);
  }
  invalidateSheetRowsCache(STUDENT_PROFILE_SHEET);

  return { studentId, photoPath: webPath };
}

module.exports = {
  SECTION_TEMPLATES,
  ensureRegistrySheets,
  listStudents,
  getStudent,
  saveStudent,
  saveStudentFields,
  listStudentsForTeacher,
  getStudentForTeacher,
  teacherCanViewStudent,
  saveStudentPhoto,
  getTeacherStudentIds
};
