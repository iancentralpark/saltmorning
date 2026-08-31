#!/usr/bin/env node
/**
 * One-time backfill: Google Sheets → Salt Morning ops DB (Railway Postgres).
 * Never writes to Mr.Park Supabase.
 *
 *   node scripts/backfill-sheets-to-ops-db.js
 *   node scripts/backfill-sheets-to-ops-db.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { getSheetRows } = require('../src/sheets');
const { isOpsDbEnabled, table, query } = require('../src/db/pool');
const { formatSheetDate } = require('../src/dateUtils');

const APPLY = process.argv.includes('--apply');

async function backfillDollars() {
  const bal = await getSheetRows('Dollar_Balances').catch(() => []);
  const tx = await getSheetRows('Dollar_Transactions').catch(() => []);
  let balances = 0;
  let txs = 0;
  for (let i = 1; i < bal.length; i++) {
    if (!bal[i][0]) continue;
    balances += 1;
    if (!APPLY) continue;
    await query(
      'INSERT INTO ' + table('dollar_balances') +
        ' (student_id, balance, updated_at) VALUES ($1, $2, now())' +
        ' ON CONFLICT (student_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()',
      [String(bal[i][0]), Number(bal[i][1]) || 0]
    );
  }
  for (let i = 1; i < tx.length; i++) {
    if (!tx[i][2]) continue;
    txs += 1;
    if (!APPLY) continue;
    await query(
      'INSERT INTO ' + table('dollar_transactions') +
        ' (created_at, class_id, student_id, amount, new_balance, reason)' +
        ' VALUES ($1::timestamptz, $2, $3, $4, $5, $6)',
      [
        tx[i][0] || new Date().toISOString(),
        String(tx[i][1] || ''),
        String(tx[i][2]),
        Number(tx[i][3]) || 0,
        Number(tx[i][4]) || 0,
        String(tx[i][5] || '')
      ]
    );
  }
  return { balances, txs };
}

async function backfillAttendance() {
  const rows = await getSheetRows('Attendance_Data').catch(() => []);
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][2]) continue;
    n += 1;
    if (!APPLY) continue;
    await query(
      'INSERT INTO ' + table('attendance_records') +
        ' (record_date, class_id, student_id, attendance, note, excuse, updated_at)' +
        ' VALUES ($1::date, $2, $3, $4, $5, $6, now())' +
        ' ON CONFLICT (record_date, class_id, student_id) DO UPDATE SET' +
        ' attendance = EXCLUDED.attendance, note = EXCLUDED.note, excuse = EXCLUDED.excuse, updated_at = now()',
      [
        formatSheetDate(rows[i][0]),
        String(rows[i][1] || ''),
        String(rows[i][2]),
        String(rows[i][3] || ''),
        String(rows[i][4] || ''),
        String(rows[i][5] || '')
      ]
    );
  }
  return { rows: n };
}

async function backfillMessages() {
  const rows = await getSheetRows('Student_Messages').catch(() => []);
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0] || rows[i][13]) continue;
    n += 1;
    if (!APPLY) continue;
    await query(
      'INSERT INTO ' + table('messenger_messages') +
        ' (message_id, created_at, thread_id, thread_type, class_id, student_id, student_name,' +
        ' sender_role, sender_id, sender_name, body, target_audience, read_at)' +
        ' VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,' +
        ' CASE WHEN $13 = \'\' THEN NULL ELSE $13::timestamptz END)' +
        ' ON CONFLICT (message_id) DO NOTHING',
      [
        String(rows[i][0]),
        rows[i][1] || new Date().toISOString(),
        String(rows[i][2] || ''),
        String(rows[i][3] || 'student'),
        String(rows[i][4] || ''),
        String(rows[i][5] || ''),
        String(rows[i][6] || ''),
        String(rows[i][7] || ''),
        String(rows[i][8] || ''),
        String(rows[i][9] || ''),
        String(rows[i][10] || ''),
        String(rows[i][11] || ''),
        String(rows[i][12] || '')
      ]
    );
  }
  return { rows: n };
}

async function backfillNotices() {
  const rows = await getSheetRows('Parent_Attendance_Notices').catch(() => []);
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    n += 1;
    if (!APPLY) continue;
    await query(
      'INSERT INTO ' + table('parent_attendance_notices') +
        ' (notice_id, notice_date, student_id, parent_id, notice_type, note, created_at, updated_at)' +
        ' VALUES ($1,$2::date,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz)' +
        ' ON CONFLICT (notice_date, student_id) DO UPDATE SET' +
        ' notice_type = EXCLUDED.notice_type, note = EXCLUDED.note, parent_id = EXCLUDED.parent_id',
      [
        String(rows[i][0]),
        formatSheetDate(rows[i][1]),
        String(rows[i][2]),
        String(rows[i][3] || ''),
        String(rows[i][4] || ''),
        String(rows[i][5] || ''),
        rows[i][6] || new Date().toISOString(),
        rows[i][7] || new Date().toISOString()
      ]
    );
  }
  return { rows: n };
}

async function main() {
  if (!isOpsDbEnabled()) {
    console.error('DATABASE_URL not set — refuse to run.');
    process.exit(1);
  }
  console.log(APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to write)');
  console.log('dollars', await backfillDollars());
  console.log('attendance', await backfillAttendance());
  console.log('messages', await backfillMessages());
  console.log('notices', await backfillNotices());
  console.log('done');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
