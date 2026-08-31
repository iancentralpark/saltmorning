'use strict';

/**
 * Dollars — Salt Morning ops DB (Railway Postgres schema salt_morning).
 * Does NOT use Mr.Park Supabase dollar_balances / dollar_transactions.
 * Sheets kept as optional async mirror for emergency inspection only.
 */

const { getSheetRows, updateRange, appendRows, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const {
  isOpsDbEnabled,
  table,
  query,
  withStudentLock
} = require('../db/pool');

const BALANCES_SHEET = 'Dollar_Balances';
const TRANSACTIONS_SHEET = 'Dollar_Transactions';
const BALANCE_HEADERS = ['StudentID', 'Balance'];
const TX_HEADERS = ['Timestamp', 'ClassID', 'StudentID', 'Amount', 'NewBalance', 'Reason'];

const studentLocks = new Map();

function withMemoryLock(studentId, fn) {
  const key = String(studentId);
  const prev = studentLocks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  studentLocks.set(key, next);
  return next.finally(() => {
    if (studentLocks.get(key) === next) studentLocks.delete(key);
  });
}

async function ensureDollarSheets() {
  await ensureSheet(BALANCES_SHEET, BALANCE_HEADERS);
  await ensureSheet(TRANSACTIONS_SHEET, TX_HEADERS);
}

async function mirrorToSheets(studentId, classId, amount, newBalance, reason) {
  if (process.env.DOLLARS_SHEET_MIRROR === 'false') return;
  try {
    await ensureDollarSheets();
    const data = await getSheetRows(BALANCES_SHEET, { skipCache: true });
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(studentId)) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow !== -1) {
      await updateRange(BALANCES_SHEET, `B${foundRow}`, [[newBalance]]);
    } else {
      await appendRows(BALANCES_SHEET, [[studentId, newBalance]]);
    }
    await appendRows(TRANSACTIONS_SHEET, [[
      new Date().toISOString(), classId, studentId, amount, newBalance, reason
    ]]);
    invalidateSheetRowsCache(BALANCES_SHEET);
    invalidateSheetRowsCache(TRANSACTIONS_SHEET);
  } catch (e) {
    console.warn('[dollars] sheet mirror failed:', e.message);
  }
}

async function getStudentDollarBalance(studentId) {
  studentId = String(studentId);
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT balance FROM ' + table('dollar_balances') + ' WHERE student_id = $1',
      [studentId]
    );
    return Number(r.rows[0] && r.rows[0].balance) || 0;
  }
  await ensureDollarSheets();
  const data = await getSheetRows(BALANCES_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentId) return Number(data[i][1]) || 0;
  }
  return 0;
}

async function listStudentTransactions(studentId, limit) {
  studentId = String(studentId);
  const max = Number(limit) || 20;
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT created_at, class_id, student_id, amount, new_balance, reason FROM ' +
        table('dollar_transactions') +
        ' WHERE student_id = $1 ORDER BY created_at DESC LIMIT $2',
      [studentId, max]
    );
    return r.rows.map((row) => ({
      at: row.created_at ? new Date(row.created_at).toISOString() : '',
      classId: String(row.class_id || ''),
      studentId,
      amount: Number(row.amount) || 0,
      newBalance: Number(row.new_balance) || 0,
      reason: String(row.reason || '')
    }));
  }
  await ensureDollarSheets();
  const data = await getSheetRows(TRANSACTIONS_SHEET);
  const out = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][2]) !== studentId) continue;
    out.push({
      at: String(data[i][0] || ''),
      classId: String(data[i][1] || ''),
      studentId,
      amount: Number(data[i][3]) || 0,
      newBalance: Number(data[i][4]) || 0,
      reason: String(data[i][5] || '')
    });
    if (out.length >= max) break;
  }
  return out;
}

async function getStudentDollars(studentId) {
  const [balance, transactions] = await Promise.all([
    getStudentDollarBalance(studentId),
    listStudentTransactions(studentId, 15)
  ]);
  return { available: true, balance, transactions };
}

async function applyDollarAdjustment(classId, studentId, amount, reason) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error('Enter a valid dollar adjustment (cannot be 0).');
  }
  studentId = String(studentId);
  classId = String(classId || '');
  const r = String(reason || '').trim() || 'manual-adjust';

  if (isOpsDbEnabled()) {
    const result = await withStudentLock(studentId, async (client) => {
      const cur = await client.query(
        'SELECT balance FROM ' + table('dollar_balances') + ' WHERE student_id = $1 FOR UPDATE',
        [studentId]
      );
      const current = Number(cur.rows[0] && cur.rows[0].balance) || 0;
      const newBalance = current + amt;
      await client.query(
        'INSERT INTO ' + table('dollar_balances') +
          ' (student_id, balance, updated_at) VALUES ($1, $2, now())' +
          ' ON CONFLICT (student_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()',
        [studentId, newBalance]
      );
      await client.query(
        'INSERT INTO ' + table('dollar_transactions') +
          ' (created_at, class_id, student_id, amount, new_balance, reason)' +
          ' VALUES (now(), $1, $2, $3, $4, $5)',
        [classId, studentId, amt, newBalance, r]
      );
      return { studentId, balance: newBalance, amount: amt, reason: r };
    });
    // Fire-and-forget sheet mirror (does not block user)
    mirrorToSheets(studentId, classId, amt, result.balance, r);
    return result;
  }

  // Legacy Sheets path with in-process lock
  return withMemoryLock(studentId, async () => {
    await ensureDollarSheets();
    const data = await getSheetRows(BALANCES_SHEET, { skipCache: true });
    let foundRow = -1;
    let current = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === studentId) {
        foundRow = i + 1;
        current = Number(data[i][1]) || 0;
        break;
      }
    }
    const newBalance = current + amt;
    if (foundRow !== -1) {
      await updateRange(BALANCES_SHEET, `B${foundRow}`, [[newBalance]]);
    } else {
      await appendRows(BALANCES_SHEET, [[studentId, newBalance]]);
    }
    await appendRows(TRANSACTIONS_SHEET, [[
      new Date().toISOString(), classId, studentId, amt, newBalance, r
    ]]);
    invalidateSheetRowsCache(BALANCES_SHEET);
    invalidateSheetRowsCache(TRANSACTIONS_SHEET);
    return { studentId, balance: newBalance, amount: amt, reason: r };
  });
}

async function listClassDollarBalances(classId, roster) {
  const students = Array.isArray(roster) ? roster : [];
  if (isOpsDbEnabled()) {
    const ids = students.map((s) => s.studentId);
    let map = {};
    if (ids.length) {
      const r = await query(
        'SELECT student_id, balance FROM ' + table('dollar_balances') +
          ' WHERE student_id = ANY($1::text[])',
        [ids]
      );
      r.rows.forEach((row) => {
        map[String(row.student_id)] = Number(row.balance) || 0;
      });
    }
    return students.map((s) => ({
      studentId: s.studentId,
      name: s.name,
      balance: map[s.studentId] || 0
    }));
  }
  await ensureDollarSheets();
  const balances = await getSheetRows(BALANCES_SHEET);
  const map = {};
  for (let i = 1; i < balances.length; i++) {
    map[String(balances[i][0])] = Number(balances[i][1]) || 0;
  }
  return students.map((s) => ({
    studentId: s.studentId,
    name: s.name,
    balance: map[s.studentId] || 0
  }));
}

module.exports = {
  ensureDollarSheets,
  getStudentDollarBalance,
  listStudentTransactions,
  getStudentDollars,
  applyDollarAdjustment,
  listClassDollarBalances,
  BALANCES_SHEET,
  TRANSACTIONS_SHEET
};
