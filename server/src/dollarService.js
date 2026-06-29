const { DOLLAR_SHEETS } = require('./config');
const { getSheetRows, updateRange, appendRows } = require('./sheets');

async function applyDollarAdjustment(classId, studentId, amount, reason) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error('Enter a valid dollar adjustment (cannot be 0).');
  }

  const data = await getSheetRows(DOLLAR_SHEETS.BALANCES);
  let foundRow = -1;
  let current = 0;
  studentId = String(studentId);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentId) {
      foundRow = i + 1;
      current = Number(data[i][1]) || 0;
      break;
    }
  }

  const newBalance = current + amt;
  if (foundRow !== -1) {
    await updateRange(DOLLAR_SHEETS.BALANCES, `B${foundRow}`, [[newBalance]]);
  } else {
    await appendRows(DOLLAR_SHEETS.BALANCES, [[studentId, newBalance]]);
  }

  const r = (reason && String(reason).trim()) ? String(reason).trim() : 'manual-adjust';
  await appendRows(DOLLAR_SHEETS.TRANSACTIONS, [[new Date().toISOString(), classId, studentId, amt, newBalance, r]]);

  return { studentId, newBalance };
}

module.exports = { applyDollarAdjustment };
