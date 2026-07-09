const bcrypt = require('bcrypt');
const { getSupabase, shouldSyncPasswordsToSheet } = require('./supabaseClient');
const { cacheGet, cacheSet, cacheDeletePrefix } = require('./cache');
const {
  syncStudentPasswordToSheet,
  readSheetPortalLoginsForClass,
  invalidateSheetPortalLoginCache,
  canReadSheetPortalLogins
} = require('./studentPasswordSync');
const {
  isMissingLoginPasswordColumn,
  queryStudents
} = require('./supabaseStudentColumns');

const PORTAL_LOGINS_CACHE_SEC = 300;

const BCRYPT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

function mapStudentRow(row) {
  if (!row) return null;
  return {
    studentId: String(row.id),
    name: String(row.name || ''),
    classId: String(row.class_id || '')
  };
}

async function findStudentByLogin(loginId, password) {
  const db = getSupabase();
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) {
    throw new Error('Enter login ID and password.');
  }

  const { data, error } = await db
    .from('students')
    .select('id, name, class_id, status, login_id, password_hash')
    .ilike('login_id', loginId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Database error.');
  if (!data) throw new Error('Login ID or password is incorrect.');

  const ok = await verifyPassword(password, data.password_hash);
  if (!ok) throw new Error('Login ID or password is incorrect.');

  if (String(data.status || '').trim() !== 'Enrolled') {
    throw new Error('This account is not active.');
  }

  return mapStudentRow(data);
}

async function getStudentById(studentId) {
  const db = getSupabase();
  const { data, error } = await db
    .from('students')
    .select('id, name, class_id, status')
    .eq('id', String(studentId))
    .maybeSingle();

  if (error) throw new Error(error.message || 'Database error.');
  return data;
}

async function lookupStudentName(studentId, classId) {
  const db = getSupabase();
  let q = db.from('students').select('name').eq('id', String(studentId));
  if (classId) q = q.eq('class_id', String(classId));
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message || 'Database error.');
  return data ? String(data.name || '') : '';
}

async function getClassNameMap() {
  const db = getSupabase();
  const { data, error } = await db.from('classes').select('id, name');
  if (error) throw new Error(error.message || 'Database error.');
  const map = {};
  (data || []).forEach(function(row) {
    const id = String(row.id || '').trim();
    if (id) map[id] = String(row.name || id);
  });
  return map;
}

async function getClassLabel(classId) {
  const db = getSupabase();
  const { data, error } = await db
    .from('classes')
    .select('name')
    .eq('id', String(classId))
    .maybeSingle();
  if (error) throw new Error(error.message || 'Database error.');
  return data ? String(data.name || classId) : String(classId);
}

async function getInitialClasses() {
  const db = getSupabase();
  const { data, error } = await db
    .from('classes')
    .select('id, name, schedule_type, allowed_days')
    .order('name');
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).map(function(row) {
    return {
      id: row.id,
      name: row.name,
      scheduleType: row.schedule_type || '',
      allowedDays: Array.isArray(row.allowed_days) ? row.allowed_days : []
    };
  });
}

async function setPortalPassword(studentId, plainPassword, options) {
  const db = getSupabase();
  plainPassword = String(plainPassword || '');
  const opts = options || {};
  const password_hash = plainPassword ? await hashPassword(plainPassword) : '';

  const updatePayload = { password_hash: password_hash };
  if (plainPassword) updatePayload.login_password = plainPassword;

  let { error } = await db
    .from('students')
    .update(updatePayload)
    .eq('id', String(studentId));

  if (error && isMissingLoginPasswordColumn(error)) {
    ({ error } = await db
      .from('students')
      .update({ password_hash: password_hash })
      .eq('id', String(studentId)));
  }

  if (error) throw new Error(error.message || 'Could not update password.');

  invalidateSheetPortalLoginCache();

  let sheetSync = { synced: false };
  if (opts.syncSheet !== false && plainPassword && shouldSyncPasswordsToSheet()) {
    try {
      sheetSync = await syncStudentPasswordToSheet(studentId, plainPassword);
    } catch (e) {
      console.error('syncStudentPasswordToSheet', studentId, e.message || e);
      sheetSync = { synced: false, reason: 'sheet_error' };
    }
  }
  return { ok: true, sheetSync: sheetSync };
}

async function listPortalLoginsForClass(classId, options) {
  const opts = options || {};
  const classKey = String(classId || '').trim();
  const cacheKey = 'portal_logins_v1_' + classKey;
  if (!opts.skipCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const db = getSupabase();
  const data = await queryStudents(db, {
    classId: classKey,
    status: 'Enrolled',
    orderBy: 'name'
  });

  let sheetById = {};
  const needsSheet = data.some(function(row) {
    return !String(row.login_password || '').trim() || !String(row.login_id || '').trim();
  });
  if (needsSheet && await canReadSheetPortalLogins()) {
    try {
      sheetById = await readSheetPortalLoginsForClass(classKey);
    } catch (e) {
      console.error('readSheetPortalLoginsForClass', e.message || e);
    }
  }

  const result = data.map(function(row) {
    const sid = String(row.id);
    const sheet = sheetById[sid] || {};
    const loginPassword = String(row.login_password || '').trim()
      || String(sheet.loginPassword || '');
    const loginId = String(row.login_id || '').trim()
      || String(sheet.loginId || '');
    return {
      studentId: sid,
      name: String(row.name || ''),
      loginId: loginId,
      loginPassword: loginPassword,
      hasPassword: !!loginPassword
    };
  });

  cacheSet(cacheKey, result, PORTAL_LOGINS_CACHE_SEC);
  return result;
}

async function resetPortalPasswordByTeacher(studentId, newPassword) {
  newPassword = String(newPassword || '').trim();
  if (!newPassword) throw new Error('Enter a new password.');
  if (newPassword.length < 4) throw new Error('Password must be at least 4 characters.');

  const db = getSupabase();
  const { data, error } = await db
    .from('students')
    .select('id, status')
    .eq('id', String(studentId))
    .maybeSingle();
  if (error) throw new Error(error.message || 'Database error.');
  if (!data) throw new Error('Student not found.');
  if (String(data.status || '').trim() !== 'Enrolled') {
    throw new Error('This account is not active.');
  }

  await setPortalPassword(studentId, newPassword, { syncSheet: true });
  return {
    ok: true,
    studentId: String(studentId),
    loginPassword: newPassword,
    message: 'Password reset.'
  };
}

async function changeStudentPassword(studentId, currentPassword, newPassword) {
  currentPassword = String(currentPassword || '').trim();
  newPassword = String(newPassword || '').trim();
  if (!currentPassword || !newPassword) {
    throw new Error('Enter current and new password.');
  }
  if (newPassword.length < 4) {
    throw new Error('New password must be at least 4 characters.');
  }
  if (currentPassword === newPassword) {
    throw new Error('New password must be different from your current password.');
  }

  const db = getSupabase();
  const { data, error } = await db
    .from('students')
    .select('id, status, password_hash')
    .eq('id', String(studentId))
    .maybeSingle();

  if (error) throw new Error(error.message || 'Database error.');
  if (!data) throw new Error('Student not found.');
  if (String(data.status || '').trim() !== 'Enrolled') {
    throw new Error('This account is not active.');
  }

  const ok = await verifyPassword(currentPassword, data.password_hash);
  if (!ok) throw new Error('Current password is incorrect.');

  await setPortalPassword(studentId, newPassword, { syncSheet: true });
  return { ok: true, message: 'Password updated.' };
}

module.exports = {
  hashPassword,
  verifyPassword,
  findStudentByLogin,
  getStudentById,
  lookupStudentName,
  getClassNameMap,
  getClassLabel,
  getInitialClasses,
  setPortalPassword,
  listPortalLoginsForClass,
  resetPortalPasswordByTeacher,
  changeStudentPassword
};
