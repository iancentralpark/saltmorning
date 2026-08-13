'use strict';

const crypto = require('crypto');
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
const HEADERS = ['AccountKey', 'Role', 'AccountId', 'MustChangePassword', 'UpdatedAt'];

const WEAK_PASSWORDS = new Set([
  'changeme123', 'changeme', 'password', 'password1', '1234', '12345', '123456', 'temp', 'tmp'
]);

function accountKey(role, accountId) {
  return String(role || '') + ':' + String(accountId || '');
}

function nowIso() {
  return new Date().toISOString();
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

async function getMustChange(role, accountId) {
  await ensureFlagsSheet();
  const key = accountKey(role, accountId);
  const rows = await getSheetRows(FLAGS_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      return String(rows[i][3] || '').toUpperCase() === 'Y' ||
        String(rows[i][3] || '').toLowerCase() === 'true' ||
        String(rows[i][3] || '') === '1';
    }
  }
  return false;
}

async function setMustChange(role, accountId, mustChange) {
  await ensureFlagsSheet();
  const key = accountKey(role, accountId);
  const flag = mustChange ? 'Y' : 'N';
  const rows = await getSheetRows(FLAGS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== key) continue;
    const row = [key, String(role), String(accountId), flag, nowIso()];
    await updateRange(FLAGS_SHEET, `A${i + 1}:E${i + 1}`, [row]);
    invalidateSheetRowsCache(FLAGS_SHEET);
    return;
  }
  await appendRows(FLAGS_SHEET, [[key, String(role), String(accountId), flag, nowIso()]]);
  invalidateSheetRowsCache(FLAGS_SHEET);
}

function generateTempPassword() {
  return 'Tmp-' + crypto.randomBytes(3).toString('hex');
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
  await setMustChange(role === 'principal' || role === 'staff' ? 'teacher' : role, accountId, forceChange);

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
  const normalizedRole = (role === 'principal' || role === 'staff') ? 'teacher' : role;
  if (isWeakPassword(password, loginId)) return true;
  return getMustChange(normalizedRole, accountId);
}

module.exports = {
  FLAGS_SHEET,
  isWeakPassword,
  getMustChange,
  setMustChange,
  adminResetPassword,
  resolveMustChangePassword,
  generateTempPassword
};
