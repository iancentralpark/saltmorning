const { DOLLAR_SHEETS } = require('./config');
const { getSheetRows, updateRange, appendRows, invalidateSheetRowsCache } = require('./sheets');
const { invalidateWorkCache } = require('./workCacheService');
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

async function applyDollarAdjustmentsBatch(classId, adjustments, reason) {
  const list = (Array.isArray(adjustments) ? adjustments : []).filter(function(adj) {
    const amt = Number(adj && adj.amount);
    return adj && adj.studentId && Number.isFinite(amt) && amt !== 0;
  });
  if (!list.length) return [];

  classId = String(classId);
  const r = (reason && String(reason).trim()) ? String(reason).trim() : 'manual-adjust';

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const ids = list.map(function(adj) { return String(adj.studentId); });
    const { data: balances, error: balReadErr } = await db.from('dollar_balances')
      .select('student_id, balance')
      .in('student_id', ids);
    if (balReadErr) throw new Error(balReadErr.message);

    const balanceMap = {};
    (balances || []).forEach(function(row) {
      balanceMap[String(row.student_id)] = Number(row.balance) || 0;
    });

    const upserts = [];
    const txs = [];
    const results = [];
    const now = new Date().toISOString();

    list.forEach(function(adj) {
      const sid = String(adj.studentId);
      const amt = Number(adj.amount);
      const current = balanceMap[sid] || 0;
      const newBalance = current + amt;
      balanceMap[sid] = newBalance;
      upserts.push({ student_id: sid, balance: newBalance });
      txs.push({
        created_at: now,
        class_id: classId,
        student_id: sid,
        amount: amt,
        new_balance: newBalance,
        reason: r
      });
      results.push({ studentId: sid, newBalance: newBalance });
    });

    const { error: upErr } = await db.from('dollar_balances').upsert(upserts, { onConflict: 'student_id' });
    if (upErr) throw new Error(upErr.message);
    const { error: txErr } = await db.from('dollar_transactions').insert(txs);
    if (txErr) throw new Error(txErr.message);
    afterDollarWrite(classId);
    return results;
  }

  const results = [];
  for (let i = 0; i < list.length; i++) {
    const adj = list[i];
    results.push(await applyDollarAdjustment(classId, adj.studentId, adj.amount, r));
  }
  return results;
}

module.exports = { getStudentDollarBalance, applyDollarAdjustment, applyDollarAdjustmentsBatch };
