const fs = require('fs');
const path = require('path');
const {
  TEACHER_LIST_SHEET,
  TEACHER_PROFILE_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const PROFILE_COL = {
  teacherId: 0,
  photoPath: 1,
  dateOfBirth: 2,
  gender: 3,
  nationality: 4,
  phone: 5,
  email: 6,
  address: 7,
  emergencyContact: 8,
  emergencyPhone: 9,
  title: 10,
  hireDate: 11,
  education: 12,
  notes: 13,
  updatedAt: 14,
  preferredName: 15
};

const PROFILE_HEADERS = [
  'TeacherID', 'PhotoPath', 'DateOfBirth', 'Gender', 'Nationality',
  'Phone', 'Email', 'Address', 'EmergencyContact', 'EmergencyPhone',
  'Title', 'HireDate', 'Education', 'Notes', 'UpdatedAt', 'PreferredName'
];

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'teachers');

function isoNow() {
  return new Date().toISOString();
}

function emptyProfile(teacherId) {
  return {
    teacherId: String(teacherId || ''),
    photoPath: '',
    dateOfBirth: '',
    gender: '',
    nationality: '',
    phone: '',
    email: '',
    address: '',
    emergencyContact: '',
    emergencyPhone: '',
    title: '',
    hireDate: '',
    education: '',
    notes: '',
    updatedAt: '',
    preferredName: ''
  };
}

/** Display name for students/parents/login: preferred name, else full name. */
function teacherDisplayName(fullName, preferredName) {
  const preferred = String(preferredName || '').trim();
  if (preferred) return preferred;
  return String(fullName || '').trim();
}

function rowToProfile(row) {
  if (!row || !row[PROFILE_COL.teacherId]) return null;
  return {
    teacherId: String(row[PROFILE_COL.teacherId]),
    photoPath: String(row[PROFILE_COL.photoPath] || '').trim(),
    dateOfBirth: String(row[PROFILE_COL.dateOfBirth] || ''),
    gender: String(row[PROFILE_COL.gender] || ''),
    nationality: String(row[PROFILE_COL.nationality] || ''),
    phone: String(row[PROFILE_COL.phone] || ''),
    email: String(row[PROFILE_COL.email] || ''),
    address: String(row[PROFILE_COL.address] || ''),
    emergencyContact: String(row[PROFILE_COL.emergencyContact] || ''),
    emergencyPhone: String(row[PROFILE_COL.emergencyPhone] || ''),
    title: String(row[PROFILE_COL.title] || ''),
    hireDate: String(row[PROFILE_COL.hireDate] || ''),
    education: String(row[PROFILE_COL.education] || ''),
    notes: String(row[PROFILE_COL.notes] || ''),
    updatedAt: String(row[PROFILE_COL.updatedAt] || ''),
    preferredName: String(row[PROFILE_COL.preferredName] || '').trim()
  };
}

function profileToRow(profile) {
  return [
    profile.teacherId,
    profile.photoPath || '',
    profile.dateOfBirth || '',
    profile.gender || '',
    profile.nationality || '',
    profile.phone || '',
    profile.email || '',
    profile.address || '',
    profile.emergencyContact || '',
    profile.emergencyPhone || '',
    profile.title || '',
    profile.hireDate || '',
    profile.education || '',
    profile.notes || '',
    profile.updatedAt || '',
    profile.preferredName || ''
  ];
}

async function ensureTeacherProfileSheet() {
  await ensureSheet(TEACHER_PROFILE_SHEET, PROFILE_HEADERS);
  try {
    const rows = await getSheetRows(TEACHER_PROFILE_SHEET);
    const header = rows[0] || [];
    if (String(header[PROFILE_COL.preferredName] || '') !== 'PreferredName') {
      await updateRange(TEACHER_PROFILE_SHEET, 'A1:P1', [PROFILE_HEADERS]);
    }
  } catch (_) {
    /* best-effort header migration */
  }
}

async function loadProfileMap(opts) {
  if (!(opts && opts.skipEnsure)) {
    await ensureTeacherProfileSheet();
  }
  const rows = await getSheetRows(TEACHER_PROFILE_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const p = rowToProfile(rows[i]);
    if (p) map[p.teacherId] = p;
  }
  return map;
}

async function getTeacherProfileRecord(teacherId, opts) {
  const map = await loadProfileMap(opts);
  return map[String(teacherId)] || emptyProfile(teacherId);
}

async function upsertTeacherProfile(teacherId, profilePayload, opts) {
  teacherId = String(teacherId || '').trim();
  if (!teacherId) throw new Error('Teacher ID is required.');
  await ensureTeacherProfileSheet();

  const existing = await getTeacherProfileRecord(teacherId);
  const keepPhoto = opts && opts.keepPhoto !== false;
  const next = Object.assign(emptyProfile(teacherId), existing, {
    teacherId,
    dateOfBirth: String(profilePayload.dateOfBirth != null ? profilePayload.dateOfBirth : existing.dateOfBirth || ''),
    gender: String(profilePayload.gender != null ? profilePayload.gender : existing.gender || ''),
    nationality: String(profilePayload.nationality != null ? profilePayload.nationality : existing.nationality || ''),
    phone: String(profilePayload.phone != null ? profilePayload.phone : existing.phone || ''),
    email: String(profilePayload.email != null ? profilePayload.email : existing.email || ''),
    address: String(profilePayload.address != null ? profilePayload.address : existing.address || ''),
    emergencyContact: String(profilePayload.emergencyContact != null ? profilePayload.emergencyContact : existing.emergencyContact || ''),
    emergencyPhone: String(profilePayload.emergencyPhone != null ? profilePayload.emergencyPhone : existing.emergencyPhone || ''),
    title: String(profilePayload.title != null ? profilePayload.title : existing.title || ''),
    hireDate: String(profilePayload.hireDate != null ? profilePayload.hireDate : existing.hireDate || ''),
    education: String(profilePayload.education != null ? profilePayload.education : existing.education || ''),
    notes: String(profilePayload.notes != null ? profilePayload.notes : existing.notes || ''),
    preferredName: String(profilePayload.preferredName != null ? profilePayload.preferredName : existing.preferredName || '').trim(),
    photoPath: keepPhoto ? (existing.photoPath || '') : String(profilePayload.photoPath || existing.photoPath || ''),
    updatedAt: isoNow()
  });

  if (profilePayload.photoPath != null && !keepPhoto) {
    next.photoPath = String(profilePayload.photoPath || '');
  }

  const rows = await getSheetRows(TEACHER_PROFILE_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][PROFILE_COL.teacherId]) === teacherId) {
      found = i + 1;
      break;
    }
  }
  const row = profileToRow(next);
  if (found > 0) {
    await updateRange(TEACHER_PROFILE_SHEET, `A${found}:P${found}`, [row]);
  } else {
    await appendRows(TEACHER_PROFILE_SHEET, [row]);
  }
  invalidateSheetRowsCache(TEACHER_PROFILE_SHEET);
  return next;
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function photoPathFor(teacherId, ext) {
  return '/uploads/teachers/' + teacherId + ext;
}

function localPhotoPath(teacherId, ext) {
  return path.join(UPLOAD_DIR, teacherId + ext);
}

async function assertTeacherExists(teacherId) {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(teacherId)) return true;
  }
  throw new Error('Teacher not found.');
}

function facultyFromListRow(row) {
  const {
    normalizeTitle,
    parsePermissions,
    presetsForTitle,
    upgradePermissions
  } = require('./staffPermissionService');
  const staffTitle = normalizeTitle(row[5], 'Teacher');
  let permissions = upgradePermissions(staffTitle, parsePermissions(row[7]));
  if (!permissions.length) permissions = presetsForTitle(staffTitle);
  return {
    teacherId: String(row[0] || ''),
    name: String(row[1] || ''),
    loginId: String(row[2] || ''),
    homeroomClassId: String(row[4] || ''),
    staffRole: staffTitle,
    staffTitle,
    headTeacherId: String(row[6] || '').trim(),
    permissions,
    hasPassword: Boolean(String(row[3] || '').trim())
  };
}

async function getTeacherDetail(teacherId) {
  teacherId = String(teacherId || '').trim();
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  let teacher = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== teacherId) continue;
    teacher = facultyFromListRow(rows[i]);
    break;
  }
  if (!teacher) throw new Error('Teacher not found.');
  const profile = await getTeacherProfileRecord(teacherId);
  const preferredName = profile.preferredName || '';
  const displayName = teacherDisplayName(teacher.name, preferredName);
  return {
    ...teacher,
    preferredName,
    displayName,
    profile,
    photoPath: profile.photoPath || ''
  };
}

async function listTeachersWithProfiles() {
  const [listRows, profileMap] = await Promise.all([
    getSheetRows(TEACHER_LIST_SHEET),
    loadProfileMap()
  ]);
  const out = [];
  for (let i = 1; i < listRows.length; i++) {
    if (!listRows[i][0]) continue;
    const teacherId = String(listRows[i][0]);
    const profile = profileMap[teacherId] || emptyProfile(teacherId);
    const base = facultyFromListRow(listRows[i]);
    const preferredName = profile.preferredName || '';
    out.push({
      ...base,
      preferredName,
      displayName: teacherDisplayName(base.name, preferredName),
      photoPath: profile.photoPath || '',
      title: profile.title || '',
      phone: profile.phone || '',
      email: profile.email || '',
      profile
    });
  }
  return out;
}

/** Map of teacherId → preferred name (fallback: full name). */
async function teacherDisplayNameMap() {
  let profileMap = {};
  try {
    // Read-only: avoid ensure/header writes on hot display paths (quota).
    profileMap = await loadProfileMap({ skipEnsure: true });
  } catch (_) {
    profileMap = {};
  }
  const listRows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < listRows.length; i++) {
    const teacherId = String(listRows[i][0] || '');
    if (!teacherId) continue;
    const profile = profileMap[teacherId];
    map[teacherId] = teacherDisplayName(
      listRows[i][1],
      profile && profile.preferredName
    );
  }
  return map;
}

async function saveTeacherPhoto(teacherId, file) {
  teacherId = String(teacherId || '').trim();
  if (!teacherId) throw new Error('Teacher ID is required.');
  if (!file || !file.buffer) throw new Error('Photo file is required.');
  await assertTeacherExists(teacherId);

  const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  const ext = allowed[file.mimetype];
  if (!ext) throw new Error('Photo must be JPEG, PNG, or WebP.');

  ensureUploadDir();
  ['.jpg', '.png', '.webp'].forEach((e) => {
    const p = localPhotoPath(teacherId, e);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  fs.writeFileSync(localPhotoPath(teacherId, ext), file.buffer);
  const webPath = photoPathFor(teacherId, ext);

  const profile = await upsertTeacherProfile(teacherId, { photoPath: webPath }, { keepPhoto: false });
  return { teacherId, photoPath: profile.photoPath };
}

async function deleteTeacherRecord(teacherId) {
  teacherId = String(teacherId || '').trim();
  if (!teacherId) throw new Error('Teacher ID is required.');
  await ensureTeacherProfileSheet();

  const listRows = await getSheetRows(TEACHER_LIST_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < listRows.length; i++) {
    if (String(listRows[i][0]) === teacherId) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error('Teacher not found.');
  await updateRange(TEACHER_LIST_SHEET, `A${found}:H${found}`, [['', '', '', '', '', '', '', '']]);
  invalidateSheetRowsCache(TEACHER_LIST_SHEET);

  const profileRows = await getSheetRows(TEACHER_PROFILE_SHEET, { skipCache: true });
  for (let i = 1; i < profileRows.length; i++) {
    if (String(profileRows[i][0]) !== teacherId) continue;
    await updateRange(TEACHER_PROFILE_SHEET, `A${i + 1}:P${i + 1}`, [new Array(16).fill('')]);
    break;
  }
  invalidateSheetRowsCache(TEACHER_PROFILE_SHEET);
  return { deleted: true, teacherId };
}

module.exports = {
  ensureTeacherProfileSheet,
  emptyProfile,
  teacherDisplayName,
  teacherDisplayNameMap,
  getTeacherProfileRecord,
  upsertTeacherProfile,
  getTeacherDetail,
  listTeachersWithProfiles,
  saveTeacherPhoto,
  deleteTeacherRecord
};
