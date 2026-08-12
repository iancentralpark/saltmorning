const {
  STUDENT_LIST_SHEET,
  PARENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  ADMIN_LIST_SHEET
} = require('../config');
const { getSheetRows, updateRange } = require('../sheets');
const { signToken } = require('../auth/tokenAuth');

const MIN_PASSWORD_LEN = 4;

/** Sheet + column map for self-service password changes (0-based cols). */
const PASSWORD_TARGETS = {
  student: { sheet: STUDENT_LIST_SHEET, idCol: 0, passwordCol: 5, idKey: 'studentId', a1Col: 'F' },
  parent: { sheet: PARENT_LIST_SHEET, idCol: 0, passwordCol: 4, idKey: 'parentId', a1Col: 'E' },
  teacher: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'teacherId', a1Col: 'D' },
  admin: { sheet: ADMIN_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'adminId', a1Col: 'D' }
};

async function loginStudent(loginId, password) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][4] || '').trim() !== loginId) continue;
    if (String(rows[i][5] || '').trim() !== password) continue;
    if (String(rows[i][3] || '').trim() !== 'Enrolled') {
      throw new Error('This account is not active.');
    }
    const profile = {
      studentId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      classId: String(rows[i][2] || '')
    };
    return {
      token: signToken({
        role: 'student',
        studentId: profile.studentId,
        classId: profile.classId,
        name: profile.name
      }),
      profile
    };
  }
  throw new Error('Login ID or password is incorrect.');
}

async function loginParent(loginId, password) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const rows = await getSheetRows(PARENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][3] || '').trim() !== loginId) continue;
    if (String(rows[i][4] || '').trim() !== password) continue;
    const studentId = String(rows[i][1] || '');
    const studentRows = await getSheetRows(STUDENT_LIST_SHEET);
    let classId = '';
    let studentName = '';
    for (let j = 1; j < studentRows.length; j++) {
      if (String(studentRows[j][0]) === studentId) {
        classId = String(studentRows[j][2] || '');
        studentName = String(studentRows[j][1] || '');
        break;
      }
    }
    const profile = {
      parentId: String(rows[i][0]),
      name: String(rows[i][2] || ''),
      studentId,
      studentName,
      classId
    };
    return {
      token: signToken({
        role: 'parent',
        parentId: profile.parentId,
        studentId: profile.studentId,
        classId: profile.classId,
        name: profile.name
      }),
      profile
    };
  }
  throw new Error('Login ID or password is incorrect.');
}

async function loginTeacher(loginId, password) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() !== loginId) continue;
    if (String(rows[i][3] || '').trim() !== password) continue;
    const profile = {
      teacherId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      homeroomClassId: String(rows[i][4] || '').trim(),
      staffRole: String(rows[i][5] || 'Teacher').trim()
    };
    return {
      token: signToken({
        role: 'teacher',
        teacherId: profile.teacherId,
        name: profile.name,
        staffRole: profile.staffRole
      }),
      profile
    };
  }
  throw new Error('Login ID or password is incorrect.');
}

async function loginAdmin(loginId, password) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const { ensureAdminSheet } = require('./adminService');
  await ensureAdminSheet();
  const rows = await getSheetRows(ADMIN_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() !== loginId) continue;
    if (String(rows[i][3] || '').trim() !== password) continue;
    const profile = {
      adminId: String(rows[i][0]),
      name: String(rows[i][1] || 'Admin')
    };
    return {
      token: signToken({
        role: 'admin',
        adminId: profile.adminId,
        name: profile.name
      }),
      profile
    };
  }
  throw new Error('Login ID or password is incorrect.');
}

async function loginUnified(loginId, password) {
  const attempts = [
    { role: 'admin', fn: loginAdmin },
    { role: 'teacher', fn: loginTeacher },
    { role: 'parent', fn: loginParent },
    { role: 'student', fn: loginStudent }
  ];
  let lastError = 'Login ID or password is incorrect.';
  for (const a of attempts) {
    try {
      const result = await a.fn(loginId, password);
      return { ...result, role: a.role };
    } catch (e) {
      lastError = e.message || lastError;
      // Only continue when credentials simply don't match this role sheet
      if (!/incorrect|not active/i.test(String(e.message || ''))) {
        throw e;
      }
    }
  }
  throw new Error(lastError);
}

/**
 * Change password for the signed-in account (any role).
 * @param {object} session — verified token payload (req.session)
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} [confirmPassword]
 */
async function changePassword(session, currentPassword, newPassword, confirmPassword) {
  const role = session && session.role;
  const target = PASSWORD_TARGETS[role];
  if (!target) throw new Error('This account cannot change password here.');

  const current = String(currentPassword || '').trim();
  const next = String(newPassword || '').trim();
  const confirm = confirmPassword == null ? next : String(confirmPassword || '').trim();
  if (!current || !next) throw new Error('Enter your current and new password.');
  if (next.length < MIN_PASSWORD_LEN) {
    throw new Error('New password must be at least ' + MIN_PASSWORD_LEN + ' characters.');
  }
  if (next !== confirm) throw new Error('New password and confirmation do not match.');
  if (next === current) throw new Error('New password must be different from the current one.');

  const accountId = String(session[target.idKey] || '').trim();
  if (!accountId) throw new Error('Login required.');

  if (role === 'admin') {
    const { ensureAdminSheet } = require('./adminService');
    await ensureAdminSheet();
  }

  const rows = await getSheetRows(target.sheet, { skipCache: true });
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][target.idCol] || '').trim() === accountId) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) throw new Error('Account not found.');

  const stored = String(rows[rowIndex][target.passwordCol] || '').trim();
  if (stored !== current) throw new Error('Current password is incorrect.');

  const sheetRow = rowIndex + 1; // 1-based including header
  await updateRange(target.sheet, target.a1Col + sheetRow, [[next]]);
  return { ok: true, role };
}

module.exports = {
  loginStudent,
  loginParent,
  loginTeacher,
  loginAdmin,
  loginUnified,
  changePassword
};
