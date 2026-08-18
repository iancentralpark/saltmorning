'use strict';

const {
  STUDENT_LIST_SHEET,
  PARENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  ADMIN_LIST_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const FLAGS_SHEET = 'Account_Flags';
/** AccountKey, Role, AccountId, MustChangePassword, UpdatedAt, TokenVersion, Active */
const HEADERS = [
  'AccountKey', 'Role', 'AccountId', 'MustChangePassword', 'UpdatedAt', 'TokenVersion', 'Active'
];

const WEAK_PASSWORDS = new Set([
  'changeme123', 'changeme', 'password', 'password1', 'password123', '1234', '12345', '123456', 'temp', 'tmp',
  // Hardcoded seed defaults for leadership/admin accounts (see adminService.js) — never
  // let these persist past first login, since they're visible in this repo's source.
  'admin123', 'principal123', 'head123'
]);

/** Default password an admin reset falls back to when none is supplied. */
const DEFAULT_RESET_PASSWORD = 'password123';

function accountKey(role, accountId) {
  return String(role || '') + ':' + String(accountId || '');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeFlagRole(role) {
  if (role === 'principal' || role === 'staff') return 'teacher';
  return String(role || '');
}

async function ensureFlagsSheet() {
  await ensureSheet(FLAGS_SHEET, HEADERS);
}

function isWeakPassword(password, loginId) {
  const p = String(password || '').trim().toLowerCase();
  if (!p) return true;
  if (WEAK_PASSWORDS.has(p)) return true;
  if (loginId && p === String(loginId).trim().toLowerCase()) return true;
  return false;
}

function parseFlagRow(row) {
  if (!row || !row[0]) return null;
  const activeRaw = String(row[6] == null ? 'Y' : row[6]).trim();
  const active = !(
    activeRaw.toUpperCase() === 'N' ||
    activeRaw.toLowerCase() === 'false' ||
    activeRaw === '0'
  );
  return {
    accountKey: String(row[0]),
    role: String(row[1] || ''),
    accountId: String(row[2] || ''),
    mustChange:
      String(row[3] || '').toUpperCase() === 'Y' ||
      String(row[3] || '').toLowerCase() === 'true' ||
      String(row[3] || '') === '1',
    updatedAt: String(row[4] || ''),
    tokenVersion: Number(row[5]) || 0,
    active
  };
}

async function getFlagRecord(role, accountId) {
  await ensureFlagsSheet();
  const key = accountKey(normalizeFlagRole(role), accountId);
  const rows = await getSheetRows(FLAGS_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== key) continue;
    return { record: parseFlagRow(rows[i]), rowIndex: i + 1, rows };
  }
  return { record: null, rowIndex: -1, rows };
}

async function upsertFlag(role, accountId, patch) {
  await ensureFlagsSheet();
  role = normalizeFlagRole(role);
  const key = accountKey(role, accountId);
  const { record, rowIndex } = await getFlagRecord(role, accountId);
  const next = {
    mustChange: record ? record.mustChange : false,
    tokenVersion: record ? record.tokenVersion : 0,
    active: record ? record.active : true
  };
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'mustChange')) {
    next.mustChange = !!patch.mustChange;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'tokenVersion')) {
    next.tokenVersion = Number(patch.tokenVersion) || 0;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'active')) {
    next.active = patch.active !== false;
  }
  const row = [
    key,
    role,
    String(accountId),
    next.mustChange ? 'Y' : 'N',
    nowIso(),
    String(next.tokenVersion),
    next.active ? 'Y' : 'N'
  ];
  if (rowIndex > 0) {
    await updateRange(FLAGS_SHEET, `A${rowIndex}:G${rowIndex}`, [row]);
  } else {
    await appendRows(FLAGS_SHEET, [row]);
  }
  invalidateSheetRowsCache(FLAGS_SHEET);
  return parseFlagRow(row);
}

async function getMustChange(role, accountId) {
  const { record } = await getFlagRecord(role, accountId);
  return !!(record && record.mustChange);
}

async function setMustChange(role, accountId, mustChange) {
  return upsertFlag(role, accountId, { mustChange: !!mustChange });
}

async function getTokenVersion(role, accountId) {
  const { record } = await getFlagRecord(role, accountId);
  return record ? (Number(record.tokenVersion) || 0) : 0;
}

async function bumpTokenVersion(role, accountId) {
  const { record } = await getFlagRecord(role, accountId);
  const next = (record ? Number(record.tokenVersion) || 0 : 0) + 1;
  await upsertFlag(role, accountId, { tokenVersion: next });
  return next;
}

async function isAccountActive(role, accountId) {
  const { record } = await getFlagRecord(role, accountId);
  if (!record) return true;
  return record.active !== false;
}

async function setAccountActive(role, accountId, active) {
  const result = await upsertFlag(role, accountId, { active: active !== false });
  if (active === false) {
    await bumpTokenVersion(role, accountId);
  }
  return result;
}

function generateTempPassword() {
  return DEFAULT_RESET_PASSWORD;
}

const PASSWORD_TARGETS = {
  student: { sheet: STUDENT_LIST_SHEET, idCol: 0, passwordCol: 5, a1Col: 'F', loginCol: 4 },
  parent: { sheet: PARENT_LIST_SHEET, idCol: 0, passwordCol: 4, a1Col: 'E', loginCol: 3 },
  teacher: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, a1Col: 'D', loginCol: 2 },
  principal: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, a1Col: 'D', loginCol: 2 },
  staff: { sheet: TEACHER_LIST_SHEET, idCol: 0, passwordCol: 3, a1Col: 'D', loginCol: 2 },
  admin: { sheet: ADMIN_LIST_SHEET, idCol: 0, passwordCol: 3, a1Col: 'D', loginCol: 2 }
};

/**
 * Admin sets a new password for an account and optionally forces change on next login.
 */
async function adminResetPassword(payload) {
  let role = String(payload.role || '').trim().toLowerCase();
  if (role === 'faculty') role = 'teacher';
  const accountId = String(payload.accountId || payload.id || '').trim();
  const target = PASSWORD_TARGETS[role];
  if (!target) throw Object.assign(new Error('Unsupported role for reset.'), { status: 400 });
  if (!accountId) throw Object.assign(new Error('Account id required.'), { status: 400 });

  let newPassword = String(payload.newPassword || '').trim();
  if (!newPassword) newPassword = generateTempPassword();
  if (newPassword.length < 4) {
    throw Object.assign(new Error('Password must be at least 4 characters.'), { status: 400 });
  }
  const forceChange = payload.forceChange !== false;

  const rows = await getSheetRows(target.sheet, { skipCache: true });
  let rowIndex = -1;
  let loginId = '';
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][target.idCol] || '').trim() !== accountId) continue;
    rowIndex = i;
    loginId = String(rows[i][target.loginCol] || '');
    break;
  }
  if (rowIndex < 0) throw Object.assign(new Error('Account not found.'), { status: 404 });

  const sheetRow = rowIndex + 1;
  await updateRange(target.sheet, target.a1Col + sheetRow, [[newPassword]]);
  const flagRole = normalizeFlagRole(role);
  await setMustChange(flagRole, accountId, forceChange);
  await bumpTokenVersion(flagRole, accountId);
  await setAccountActive(flagRole, accountId, true);

  try {
    const { writeAudit } = require('./auditService');
    await writeAudit({
      actorRole: 'admin',
      action: 'password_reset',
      entityType: flagRole,
      entityId: accountId,
      detail: { loginId, forceChange }
    });
  } catch (_) { /* optional */ }

  return {
    ok: true,
    role,
    accountId,
    loginId,
    temporaryPassword: newPassword,
    mustChangePassword: forceChange
  };
}

async function resolveMustChangePassword(role, accountId, password, loginId) {
  const normalizedRole = normalizeFlagRole(role);
  if (!(await isAccountActive(normalizedRole, accountId))) {
    throw Object.assign(new Error('This account is deactivated.'), { status: 403 });
  }
  if (isWeakPassword(password, loginId)) return true;
  return getMustChange(normalizedRole, accountId);
}

async function assertSessionTokenVersion(session) {
  if (!session || !session.role) return false;
  const role = normalizeFlagRole(session.role);
  const accountId = session.adminId || session.teacherId || session.parentId ||
    session.studentId || session.principalId || '';
  if (!accountId) return true;
  if (!(await isAccountActive(role, accountId))) return false;
  const current = await getTokenVersion(role, accountId);
  const tokenTv = Number(session.tv);
  if (!Number.isFinite(tokenTv)) {
    // Legacy tokens without tv — accept until next password change bumps version to >0
    return current === 0;
  }
  return tokenTv === current;
}

module.exports = {
  FLAGS_SHEET,
  DEFAULT_RESET_PASSWORD,
  isWeakPassword,
  getMustChange,
  setMustChange,
  getTokenVersion,
  bumpTokenVersion,
  isAccountActive,
  setAccountActive,
  adminResetPassword,
  resolveMustChangePassword,
  assertSessionTokenVersion,
  generateTempPassword,
  normalizeFlagRole
};
