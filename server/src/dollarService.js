const { DOLLAR_SHEETS } = require('./config');
const { getSheetRows, updateRange, appendRows, invalidateSheetRowsCache } = require('./sheets');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

function afterDollarWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(DOLLAR_SHEETS.BALANCES);
  invalidateSheetRowsCache(DOLLAR_SHEETS.TRANSACTIONS);
}

async function getStudentDollarBalance(studentId) {
  studentId = String(studentId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('dollar_balances')
      .select('balance')
      .eq('student_id', studentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Number(data?.balance) || 0;
  }
  const data = await getSheetRows(DOLLAR_SHEETS.BALANCES);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === studentId) {
      return Number(data[i][1]) || 0;
    }
  }
  return 0;
}

async function applyDollarAdjustment(classId, studentId, amount, reason) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error('Enter a valid dollar adjustment (cannot be 0).');
  }

  studentId = String(studentId);
  classId = String(classId);
  const r = (reason && String(reason).trim()) ? String(reason).trim() : 'manual-adjust';

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const current = await getStudentDollarBalance(studentId);
    const newBalance = current + amt;
    const { error: balErr } = await db.from('dollar_balances').upsert({
      student_id: studentId,
      balance: newBalance
    }, { onConflict: 'student_id' });
    if (balErr) throw new Error(balErr.message);
    const { error: txErr } = await db.from('dollar_transactions').insert({
      created_at: new Date().toISOString(),
      class_id: classId,
      student_id: studentId,
      amount: amt,
      new_balance: newBalance,
      reason: r
    });
    if (txErr) throw new Error(txErr.message);
    afterDollarWrite(classId);
    return { studentId, newBalance };
  }

  const data = await getSheetRows(DOLLAR_SHEETS.BALANCES);
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
    await updateRange(DOLLAR_SHEETS.BALANCES, `B${foundRow}`, [[newBalance]]);
  } else {
    await appendRows(DOLLAR_SHEETS.BALANCES, [[studentId, newBalance]]);
  }

  await appendRows(DOLLAR_SHEETS.TRANSACTIONS, [[new Date().toISOString(), classId, studentId, amt, newBalance, r]]);
  afterDollarWrite(classId);
  return { studentId, newBalance };
}

module.exports = { getStudentDollarBalance, applyDollarAdjustment };
