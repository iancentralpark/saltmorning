const { getSheetRows, updateRange, appendRows, ensureSheet, invalidateSheetRowsCache } = require('../sheets');

const BALANCES_SHEET = 'Dollar_Balances';
const TRANSACTIONS_SHEET = 'Dollar_Transactions';

const BALANCE_HEADERS = ['StudentID', 'Balance'];
const TX_HEADERS = ['Timestamp', 'ClassID', 'StudentID', 'Amount', 'NewBalance', 'Reason'];

async function ensureDollarSheets() {
  await ensureSheet(BALANCES_SHEET, BALANCE_HEADERS);
  await ensureSheet(TRANSACTIONS_SHEET, TX_HEADERS);
}

async function getStudentDollarBalance(studentId) {
  await ensureDollarSheets();
  studentId = String(studentId);
  const data = await getSheetRows(BALANCES_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentId) return Number(data[i][1]) || 0;
  }
  return 0;
}

async function listStudentTransactions(studentId, limit) {
  await ensureDollarSheets();
  studentId = String(studentId);
  const max = Number(limit) || 20;
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
  await ensureDollarSheets();
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error('Enter a valid dollar adjustment (cannot be 0).');
  }

  studentId = String(studentId);
  classId = String(classId || '');
  const r = String(reason || '').trim() || 'manual-adjust';

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
}

async function listClassDollarBalances(classId, roster) {
  await ensureDollarSheets();
  const students = Array.isArray(roster) ? roster : [];
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
