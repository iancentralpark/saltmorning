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

async function loginParent(loginId, password, opts) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  opts = opts || {};
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const {
    findParentByLogin,
    listChildrenForParent,
    pickActiveChild,
    ensureParentStudentsSheet
  } = require('./parentRegistryService');

  await ensureParentStudentsSheet();
  const parent = await findParentByLogin(loginId);
  if (!parent || String(parent.password || '').trim() !== password) {
    throw new Error('Login ID or password is incorrect.');
  }

  let children = await listChildrenForParent(parent.parentId);
  if (!children.length && parent.legacyStudentId) {
    children = [{
      studentId: parent.legacyStudentId,
      name: '',
      classId: '',
      status: 'Enrolled',
      relationship: 'Guardian',
      isPrimary: true
    }];
  }
  if (!children.length) {
    throw new Error('This parent account has no linked students. Ask the school office to link a child.');
  }

  const active = pickActiveChild(children, opts.studentId);
  const studentRows = await getSheetRows(STUDENT_LIST_SHEET);
  let classId = String(active.classId || '');
  let studentName = String(active.name || '');
  let status = String(active.status || '');
  for (let j = 1; j < studentRows.length; j++) {
    if (String(studentRows[j][0]) !== active.studentId) continue;
    classId = String(studentRows[j][2] || '');
    studentName = String(studentRows[j][1] || '');
    status = String(studentRows[j][3] || '');
    break;
  }
  if (status && status !== 'Enrolled') {
    // Allow if another enrolled child exists
    const enrolled = children.find((c) => {
      if (c.studentId === active.studentId) return false;
      return true;
    });
    if (!enrolled && status !== 'Enrolled') {
      throw new Error('This account is not active.');
    }
  }

  const childSummaries = children.map((c) => ({
    studentId: c.studentId,
    name: c.name || c.studentId,
    classId: c.classId || '',
    relationship: c.relationship || 'Guardian',
    isPrimary: !!c.isPrimary
  }));
  // Enrich names/classIds from sheet for all children
  for (const ch of childSummaries) {
    for (let j = 1; j < studentRows.length; j++) {
      if (String(studentRows[j][0]) !== ch.studentId) continue;
      ch.name = String(studentRows[j][1] || ch.name);
      ch.classId = String(studentRows[j][2] || ch.classId);
      break;
    }
  }

  const profile = {
    parentId: parent.parentId,
    name: parent.name || 'Parent',
    studentId: active.studentId,
    studentName,
    classId,
    children: childSummaries
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

async function switchParentActiveChild(session, studentId) {
  studentId = String(studentId || '').trim();
  if (!session || !session.parentId) throw new Error('Login required.');
  if (!studentId) throw new Error('Student ID is required.');

  const {
    parentHasStudent,
    listChildrenForParent,
    pickActiveChild,
    getParentRecord,
    ensureParentStudentsSheet
  } = require('./parentRegistryService');

  await ensureParentStudentsSheet();
  const ok = await parentHasStudent(session.parentId, studentId);
  if (!ok) throw new Error('That student is not linked to this parent account.');

  const parent = await getParentRecord(session.parentId);
  if (!parent) throw new Error('Parent account not found.');

  const children = await listChildrenForParent(session.parentId);
  const active = pickActiveChild(children, studentId);
  if (!active) throw new Error('Student not found.');

  const studentRows = await getSheetRows(STUDENT_LIST_SHEET);
  let classId = active.classId || '';
  let studentName = active.name || '';
  for (let j = 1; j < studentRows.length; j++) {
    if (String(studentRows[j][0]) !== active.studentId) continue;
    classId = String(studentRows[j][2] || '');
    studentName = String(studentRows[j][1] || '');
    break;
  }

  const childSummaries = [];
  for (const c of children) {
    let name = c.name || c.studentId;
    let cid = c.classId || '';
    for (let j = 1; j < studentRows.length; j++) {
      if (String(studentRows[j][0]) !== c.studentId) continue;
      name = String(studentRows[j][1] || name);
      cid = String(studentRows[j][2] || cid);
      break;
    }
    childSummaries.push({
      studentId: c.studentId,
      name,
      classId: cid,
      relationship: c.relationship || 'Guardian',
      isPrimary: !!c.isPrimary
    });
  }

  const profile = {
    parentId: parent.parentId,
    name: parent.name || session.name || 'Parent',
    studentId: active.studentId,
    studentName,
    classId,
    children: childSummaries
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

async function loginTeacher(loginId, password) {
  loginId = String(loginId || '').trim();
  password = String(password || '').trim();
  if (!loginId || !password) throw new Error('Enter login ID and password.');

  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() !== loginId) continue;
    if (String(rows[i][3] || '').trim() !== password) continue;
    const staffRole = String(rows[i][5] || 'Teacher').trim();
    const teacherId = String(rows[i][0]);
    const fullName = String(rows[i][1] || '');
    let preferredName = '';
    let displayName = fullName;
    try {
      const { getTeacherProfileRecord, teacherDisplayName } = require('./teacherRegistryService');
      // Read-only: skip sheet ensure/header writes during login (quota-sensitive).
      const tp = await getTeacherProfileRecord(teacherId, { skipEnsure: true });
      preferredName = String((tp && tp.preferredName) || '').trim();
      displayName = teacherDisplayName(fullName, preferredName);
    } catch (_) {
      displayName = fullName;
    }
    const profile = {
      teacherId,
      name: displayName,
      fullName,
      preferredName,
      homeroomClassId: String(rows[i][4] || '').trim(),
      staffRole,
      headTeacherId: String(rows[i][6] || '').trim()
    };

    // Principal accounts live on Teacher_List but use the admin portal.
    if (/^principal$/i.test(staffRole)) {
      return {
        token: signToken({
          role: 'principal',
          principalId: profile.teacherId,
          teacherId: profile.teacherId,
          name: profile.name,
          staffRole: 'Principal'
        }),
        profile: Object.assign({}, profile, { principalId: profile.teacherId })
      };
    }

    return {
      token: signToken({
        role: 'teacher',
        teacherId: profile.teacherId,
        name: profile.name,
        staffRole: profile.staffRole,
        headTeacherId: profile.headTeacherId
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

  // Do not call ensureAdminSheet() here — login should be read-only and
  // avoid extra meta/write traffic that burns Sheets quota.
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
  // Teacher first: most frequent portal users; avoids Admin_List ensure/reads
  // when the account is a teacher (and skips parent/student sheet walks).
  const attempts = [
    { role: 'teacher', fn: loginTeacher },
    { role: 'admin', fn: loginAdmin },
    { role: 'parent', fn: loginParent },
    { role: 'student', fn: loginStudent }
  ];
  let lastError = 'Login ID or password is incorrect.';
  let quotaHit = false;
  for (const a of attempts) {
    try {
      const result = await a.fn(loginId, password);
      // loginTeacher may return principal
      const role = (result.token && require('../auth/tokenAuth').verifyToken(result.token).role) || a.role;
      return { ...result, role };
    } catch (e) {
      lastError = e.message || lastError;
      if (/quota exceeded/i.test(String(e.message || ''))) {
        quotaHit = true;
        break;
      }
      // Only continue when credentials simply don't match this role sheet
      if (!/incorrect|not active/i.test(String(e.message || ''))) {
        throw e;
      }
    }
  }
  if (quotaHit) {
    throw new Error('The school directory is busy right now. Please wait a moment and try logging in again.');
  }
  throw new Error(lastError);
}

module.exports = {
  loginStudent,
  loginParent,
  loginTeacher,
  loginAdmin,
  loginUnified,
  switchParentActiveChild
};
