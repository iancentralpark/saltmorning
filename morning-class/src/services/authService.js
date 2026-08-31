const {
  STUDENT_LIST_SHEET,
  PARENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  ADMIN_LIST_SHEET
} = require('../config');
const { getSheetRows, updateRange } = require('../sheets');
const { signToken } = require('../auth/tokenAuth');
const {
  resolveMustChangePassword,
  setMustChange,
  adminResetPassword,
  getTokenVersion,
  bumpTokenVersion,
  isAccountActive,
  normalizeFlagRole
} = require('./accountFlagsService');

const MIN_PASSWORD_LEN = 4;

/** Sheet + column map for self-service password changes (0-based cols). */
const PASSWORD_TARGETS = {
  student: { sheet: STUDENT_LIST_SHEET, idCol: 0, passwordCol: 5, idKey: 'studentId', a1Col: 'F' },
  parent: { sheet: PARENT_LIST_SHEET, idCol: 0, passwordCol: 4, idKey: 'parentId', a1Col: 'E' },
  teacher: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'teacherId', a1Col: 'D' },
  principal: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'principalId', a1Col: 'D' },
  staff: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'teacherId', a1Col: 'D' },
  admin: { sheet: ADMIN_LIST_SHEET, idCol: 0, passwordCol: 3, idKey: 'adminId', a1Col: 'D' }
};

async function issueToken(role, accountId, payload) {
  const flagRole = normalizeFlagRole(role);
  const tv = await getTokenVersion(flagRole, accountId).catch(() => 0);
  return signToken(Object.assign({}, payload, { tv: Number(tv) || 0 }));
}

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
    const mustChangePassword = await resolveMustChangePassword(
      'student', profile.studentId, password, loginId
    );
    return {
      token: await issueToken('student', profile.studentId, {
        role: 'student',
        studentId: profile.studentId,
        classId: profile.classId,
        name: profile.name,
        mustChangePassword: !!mustChangePassword
      }),
      profile: Object.assign({}, profile, { mustChangePassword: !!mustChangePassword }),
      mustChangePassword: !!mustChangePassword
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
  const mustChangePassword = await resolveMustChangePassword(
    'parent', profile.parentId, password, loginId
  );
  return {
    token: await issueToken('parent', profile.parentId, {
      role: 'parent',
      parentId: profile.parentId,
      studentId: profile.studentId,
      classId: profile.classId,
      name: profile.name,
      mustChangePassword: !!mustChangePassword
    }),
    profile: Object.assign({}, profile, { mustChangePassword: !!mustChangePassword }),
    mustChangePassword: !!mustChangePassword
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
    token: await issueToken('parent', profile.parentId, {
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

  const {
    parsePermissions,
    presetsForTitle,
    normalizeTitle,
    portalRoleForFaculty,
    upgradePermissions
  } = require('./staffPermissionService');

  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() !== loginId) continue;
    if (String(rows[i][3] || '').trim() !== password) continue;
    const staffTitle = normalizeTitle(rows[i][5], 'Teacher');
    const teacherId = String(rows[i][0]);
    const fullName = String(rows[i][1] || '');
    let preferredName = '';
    let displayName = fullName;
    try {
      const { getTeacherProfileRecord, teacherDisplayName } = require('./teacherRegistryService');
      const tp = await getTeacherProfileRecord(teacherId, { skipEnsure: true });
      preferredName = String((tp && tp.preferredName) || '').trim();
      displayName = teacherDisplayName(fullName, preferredName);
    } catch (_) {
      displayName = fullName;
    }

    let permissions = upgradePermissions(staffTitle, parsePermissions(rows[i][7]));
    if (!permissions.length) permissions = presetsForTitle(staffTitle);
    const portalRole = portalRoleForFaculty(staffTitle, permissions);

    const profile = {
      teacherId,
      name: displayName,
      fullName,
      preferredName,
      homeroomClassId: String(rows[i][4] || '').trim(),
      staffRole: staffTitle,
      staffTitle,
      headTeacherId: String(rows[i][6] || '').trim(),
      permissions,
      portalRole
    };

    const mustChangePassword = await resolveMustChangePassword(
      'teacher', teacherId, password, loginId
    );
    const mcp = !!mustChangePassword;
    profile.mustChangePassword = mcp;

    if (portalRole === 'principal') {
      return {
        token: await issueToken('teacher', profile.teacherId, {
          role: 'principal',
          principalId: profile.teacherId,
          teacherId: profile.teacherId,
          name: profile.name,
          staffRole: staffTitle,
          staffTitle,
          permissions,
          mustChangePassword: mcp
        }),
        profile: Object.assign({}, profile, { principalId: profile.teacherId }),
        mustChangePassword: mcp
      };
    }

    if (portalRole === 'staff') {
      return {
        token: await issueToken('teacher', profile.teacherId, {
          role: 'staff',
          teacherId: profile.teacherId,
          staffId: profile.teacherId,
          name: profile.name,
          staffRole: staffTitle,
          staffTitle,
          permissions,
          mustChangePassword: mcp
        }),
        profile,
        mustChangePassword: mcp
      };
    }

    return {
      token: await issueToken('teacher', profile.teacherId, {
        role: 'teacher',
        teacherId: profile.teacherId,
        name: profile.name,
        staffRole: staffTitle,
        staffTitle,
        headTeacherId: profile.headTeacherId,
        permissions,
        mustChangePassword: mcp
      }),
      profile,
      mustChangePassword: mcp
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
    const mustChangePassword = await resolveMustChangePassword(
      'admin', profile.adminId, password, loginId
    );
    const mcp = !!mustChangePassword;
    return {
      token: await issueToken('admin', profile.adminId, {
        role: 'admin',
        adminId: profile.adminId,
        name: profile.name,
        permissions: ['*'],
        mustChangePassword: mcp
      }),
      profile: Object.assign({}, profile, { permissions: ['*'], portalRole: 'admin', mustChangePassword: mcp }),
      mustChangePassword: mcp
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

  const rows = await getSheetRows(target.sheet, { skipCache: true });
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][target.idCol] || '').trim() === accountId) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) {
    // Principal/staff tokens may carry principalId while the sheet key is teacherId
    if ((role === 'principal' || role === 'staff') && session.teacherId) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][target.idCol] || '').trim() === String(session.teacherId)) {
          rowIndex = i;
          break;
        }
      }
    }
  }
  if (rowIndex < 0) throw new Error('Account not found.');

  const stored = String(rows[rowIndex][target.passwordCol] || '').trim();
  if (stored !== current) throw new Error('Current password is incorrect.');

  const sheetRow = rowIndex + 1; // 1-based including header
  await updateRange(target.sheet, target.a1Col + sheetRow, [[next]]);
  const flagRole = normalizeFlagRole(role);
  const resolvedId = (role === 'principal' || role === 'staff')
    ? String(session.teacherId || accountId)
    : accountId;
  let newTv = 0;
  try {
    await setMustChange(flagRole, resolvedId, false);
    newTv = await bumpTokenVersion(flagRole, resolvedId);
  } catch (_) { /* optional */ }

  const tokenPayload = Object.assign({}, session, {
    mustChangePassword: false,
    tv: newTv,
    exp: undefined
  });
  delete tokenPayload.exp;
  const token = await issueToken(flagRole === 'teacher' && (role === 'principal' || role === 'staff')
    ? 'teacher'
    : role,
  resolvedId,
  Object.assign({}, tokenPayload, { role }));

  try {
    const { writeAuditFromSession } = require('./auditService');
    await writeAuditFromSession(session, 'password_change', flagRole, resolvedId, {});
  } catch (_) { /* optional */ }

  return { ok: true, role, mustChangePassword: false, token };
}

async function logoutSession(session) {
  if (!session || !session.role) return { ok: true };
  const role = normalizeFlagRole(session.role);
  const accountId = session.adminId || session.teacherId || session.parentId ||
    session.studentId || session.principalId || '';
  if (accountId) {
    await bumpTokenVersion(role, accountId).catch(() => 0);
  }
  try {
    const { writeAuditFromSession } = require('./auditService');
    await writeAuditFromSession(session, 'logout', role, accountId, {});
  } catch (_) { /* optional */ }
  return { ok: true };
}

module.exports = {
  loginStudent,
  loginParent,
  loginTeacher,
  loginAdmin,
  loginUnified,
  switchParentActiveChild,
  changePassword,
  logoutSession,
  adminResetPassword
};
