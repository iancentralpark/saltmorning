const {
  STUDENT_LIST_SHEET,
  PARENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  ADMIN_LIST_SHEET
} = require('../config');
const { getSheetRows } = require('../sheets');
const { signToken } = require('../auth/tokenAuth');

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

module.exports = { loginStudent, loginParent, loginTeacher, loginAdmin };
