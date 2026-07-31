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
    .select('id, name, schedule_type, allowed_days, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).map(function(row) {
    return {
      id: row.id,
      name: row.name,
      scheduleType: row.schedule_type || '',
      allowedDays: Array.isArray(row.allowed_days) ? row.allowed_days : [],
      sortOrder: row.sort_order != null ? Number(row.sort_order) || 0 : 0
    };
  });
}

async function nextClassSortOrder() {
  const db = getSupabase();
  const { data, error } = await db
    .from('classes')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message || 'Database error.');
  const max = data && data[0] && data[0].sort_order != null ? Number(data[0].sort_order) : -1;
  return (Number.isFinite(max) ? max : -1) + 1;
}

function normalizeAllowedDays(raw) {
  const days = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = {};
  days.forEach(function(d) {
    const n = Math.round(Number(d));
    if (!Number.isFinite(n) || n < 0 || n > 6) return;
    if (seen[n]) return;
    seen[n] = true;
    out.push(n);
  });
  out.sort(function(a, b) { return a - b; });
  return out;
}

function scheduleTypeForDays(days) {
  const key = (days || []).slice().sort(function(a, b) { return a - b; }).join(',');
  const map = {
    '1,2,3,4,5': '주 5일',
    '1,3': '월수',
    '2,4': '화목',
    '1,3,5': '월수금'
  };
  return map[key] || 'Custom';
}

async function nextClassId() {
  const db = getSupabase();
  const { data, error } = await db.from('classes').select('id');
  if (error) throw new Error(error.message || 'Database error.');
  let max = 0;
  (data || []).forEach(function(row) {
    const m = String(row.id || '').match(/^C(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'C' + String(max + 1).padStart(3, '0');
}

async function countStudentsInClass(classId) {
  const db = getSupabase();
  const { count, error } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('class_id', String(classId));
  if (error) throw new Error(error.message || 'Database error.');
  return Number(count) || 0;
}

async function listManagedClasses() {
  const classes = await getInitialClasses();
  const out = [];
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    let studentCount = 0;
    try {
      studentCount = await countStudentsInClass(cls.id);
    } catch (e) { /* ignore */ }
    out.push(Object.assign({}, cls, { studentCount: studentCount }));
  }
  return out;
}

async function createClass(opts) {
  const db = getSupabase();
  opts = opts || {};
  const name = String(opts.name || '').trim();
  if (!name) throw new Error('Class name is required.');
  if (name.length > 80) throw new Error('Class name is too long (max 80 characters).');

  const allowedDays = normalizeAllowedDays(opts.allowedDays);
  if (!allowedDays.length) {
    throw new Error('Pick at least one class day (Mon–Sun).');
  }
  const scheduleType = String(opts.scheduleType || '').trim() || scheduleTypeForDays(allowedDays);
  const id = String(opts.id || '').trim() || await nextClassId();
  const sortOrder = opts.sortOrder != null && Number.isFinite(Number(opts.sortOrder))
    ? Math.max(0, Math.round(Number(opts.sortOrder)))
    : await nextClassSortOrder();

  const row = {
    id: id,
    name: name,
    schedule_type: scheduleType,
    allowed_days: allowedDays,
    sort_order: sortOrder,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db
    .from('classes')
    .insert(row)
    .select('id, name, schedule_type, allowed_days, sort_order')
    .maybeSingle();
  if (error) {
    if (/duplicate|unique/i.test(error.message || '')) {
      throw new Error('A class with that ID already exists.');
    }
    throw new Error(error.message || 'Could not create class.');
  }
  return {
    id: data.id,
    name: data.name,
    scheduleType: data.schedule_type || '',
    allowedDays: Array.isArray(data.allowed_days) ? data.allowed_days : allowedDays,
    sortOrder: data.sort_order != null ? Number(data.sort_order) || sortOrder : sortOrder
  };
}

async function updateClass(classId, opts) {
  const db = getSupabase();
  classId = String(classId || '').trim();
  if (!classId) throw new Error('classId is required.');
  opts = opts || {};

  const patch = { updated_at: new Date().toISOString() };
  if (opts.name != null) {
    const name = String(opts.name || '').trim();
    if (!name) throw new Error('Class name is required.');
    if (name.length > 80) throw new Error('Class name is too long (max 80 characters).');
    patch.name = name;
  }
  if (opts.allowedDays != null) {
    const allowedDays = normalizeAllowedDays(opts.allowedDays);
    if (!allowedDays.length) throw new Error('Pick at least one class day (Mon–Sun).');
    patch.allowed_days = allowedDays;
    patch.schedule_type = String(opts.scheduleType || '').trim() || scheduleTypeForDays(allowedDays);
  } else if (opts.scheduleType != null) {
    patch.schedule_type = String(opts.scheduleType || '').trim();
  }

  const { data, error } = await db
    .from('classes')
    .update(patch)
    .eq('id', classId)
    .select('id, name, schedule_type, allowed_days, sort_order')
    .maybeSingle();
  if (error) throw new Error(error.message || 'Could not update class.');
  if (!data) throw new Error('Class not found.');
  return {
    id: data.id,
    name: data.name,
    scheduleType: data.schedule_type || '',
    allowedDays: Array.isArray(data.allowed_days) ? data.allowed_days : [],
    sortOrder: data.sort_order != null ? Number(data.sort_order) || 0 : 0
  };
}

async function reorderClasses(classIds) {
  const db = getSupabase();
  const orderedIds = (Array.isArray(classIds) ? classIds : [])
    .map(function(id) { return String(id || '').trim(); })
    .filter(Boolean);
  if (!orderedIds.length) throw new Error('classIds are required.');

  const existing = await getInitialClasses();
  const existingIds = existing.map(function(c) { return String(c.id); });
  const existingSet = new Set(existingIds);
  for (let i = 0; i < orderedIds.length; i++) {
    if (!existingSet.has(orderedIds[i])) {
      throw new Error('Unknown class: ' + orderedIds[i]);
    }
  }
  const finalOrder = orderedIds.slice();
  existingIds.forEach(function(id) {
    if (finalOrder.indexOf(id) < 0) finalOrder.push(id);
  });

  for (let i = 0; i < finalOrder.length; i++) {
    const { error } = await db
      .from('classes')
      .update({ sort_order: i, updated_at: new Date().toISOString() })
      .eq('id', finalOrder[i]);
    if (error) throw new Error(error.message || 'Could not save class order.');
  }

  return {
    ok: true,
    classIds: finalOrder,
    message: 'Class order saved.'
  };
}

async function deleteClass(classId) {
  const db = getSupabase();
  classId = String(classId || '').trim();
  if (!classId) throw new Error('classId is required.');

  const studentCount = await countStudentsInClass(classId);
  if (studentCount > 0) {
    const err = new Error(
      'This class still has ' + studentCount + ' student' + (studentCount === 1 ? '' : 's') +
      '. Move or withdraw them first, then delete the class.'
    );
    err.code = 'CLASS_HAS_STUDENTS';
    err.studentCount = studentCount;
    throw err;
  }

  // Best-effort cleanup of class-scoped settings that would block delete.
  try {
    await db.from('vocab_class_settings').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }
  try {
    await db.from('class_rules').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }
  try {
    await db.from('class_announcements').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }
  try {
    await db.from('class_events').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }
  try {
    await db.from('class_textbooks').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }
  try {
    await db.from('classroom_map').delete().eq('class_id', classId);
  } catch (e) { /* ignore */ }

  const { error } = await db.from('classes').delete().eq('id', classId);
  if (error) {
    throw new Error(
      'Could not delete class. Related records may still exist (homework, attendance, tickets, etc.). ' +
      (error.message || '')
    );
  }
  return { ok: true, id: classId };
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
  } else if (error && plainPassword) {
    // Hash update may still succeed even if login_password was rejected.
    const hashOnly = await db
      .from('students')
      .update({ password_hash: password_hash })
      .eq('id', String(studentId));
    if (!hashOnly.error) {
      const plainOnly = await db
        .from('students')
        .update({ login_password: plainPassword })
        .eq('id', String(studentId));
      error = plainOnly.error || null;
      if (error) {
        console.warn('setPortalPassword login_password write failed', studentId, error.message || error);
        error = null;
      }
    } else {
      error = hashOnly.error;
    }
  }

  if (error) throw new Error(error.message || 'Could not update password.');

  invalidateSheetPortalLoginCache();
  cacheDeletePrefix('portal_logins_v1_');

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
  // Always merge sheet logins so empty Supabase login_password still shows the
  // Student_List value (and stays current once password changes sync to sheet).
  if (await canReadSheetPortalLogins()) {
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
  listManagedClasses,
  createClass,
  updateClass,
  reorderClasses,
  deleteClass,
  setPortalPassword,
  listPortalLoginsForClass,
  resetPortalPasswordByTeacher,
  changeStudentPassword
};
