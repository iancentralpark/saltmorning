#!/usr/bin/env node
/**
 * One-time import: Google Sheets → Supabase (Phase 2)
 *
 * Prerequisites:
 *   1. Run 001_phase1.sql, 002_phase2_dollars_attendance.sql, 003_phase2_homework.sql
 *   2. Phase 1 import already done (classes + students)
 *   3. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env
 *
 * Usage:
 *   cd server && npm run supabase:import-phase2
 *   cd server && npm run supabase:import-phase2 -- --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { getSupabase } = require('../src/supabaseClient');
const { getSheetRows } = require('../src/sheets');
const {
  DOLLAR_SHEETS,
  HOMEWORK_SHEETS,
  ATTENDANCE_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../src/config');
const { formatSheetDate } = require('../src/dateUtils');

const dryRun = process.argv.includes('--dry-run');

let validClassIds = null;
let validStudentIds = null;

async function loadValidIds() {
  if (validClassIds) return;
  const classRows = await getSheetRows(CLASS_LIST_SHEET, { skipCache: true });
  const studentRows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  validClassIds = new Set();
  validStudentIds = new Set();
  for (let i = 1; i < classRows.length; i++) {
    const id = String(classRows[i][0] || '').trim();
    if (id) validClassIds.add(id);
  }
  for (let i = 1; i < studentRows.length; i++) {
    const id = String(studentRows[i][0] || '').trim();
    if (id) validStudentIds.add(id);
  }
}

function isValidClassStudent(classId, studentId) {
  return validClassIds.has(classId) && validStudentIds.has(studentId);
}

function formatDate(raw) {
  const s = formatSheetDate(raw);
  return s || null;
}

function sheetBool(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 'Y' || val === 'Yes';
}

function parseIso(raw) {
  if (raw == null || raw === '') return null;
  const direct = new Date(raw);
  if (!isNaN(direct.getTime())) return direct.toISOString();
  const sheet = formatDate(raw);
  if (sheet) {
    const d = new Date(sheet + 'T12:00:00');
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

async function importDollarBalances(db) {
  const rows = await getSheetRows(DOLLAR_SHEETS.BALANCES, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const studentId = String(rows[i][0] || '').trim();
    if (!studentId) continue;
    payload.push({ student_id: studentId, balance: Number(rows[i][1]) || 0 });
  }
  console.log('dollar_balances:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const { error } = await db.from('dollar_balances').upsert(payload, { onConflict: 'student_id' });
  if (error) throw new Error('dollar_balances: ' + error.message);
  return payload.length;
}

async function importDollarTransactions(db) {
  const rows = await getSheetRows(DOLLAR_SHEETS.TRANSACTIONS, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const studentId = String(rows[i][2] || '').trim();
    const classId = String(rows[i][1] || '').trim() || null;
    if (!studentId || !validStudentIds.has(studentId)) continue;
    if (classId && !validClassIds.has(classId)) continue;
    payload.push({
      created_at: parseIso(rows[i][0]) || new Date().toISOString(),
      class_id: String(rows[i][1] || '').trim() || null,
      student_id: studentId,
      amount: Number(rows[i][3]) || 0,
      new_balance: Number(rows[i][4]) || 0,
      reason: String(rows[i][5] || '')
    });
  }
  console.log('dollar_transactions:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const { error } = await db.from('dollar_transactions').insert(payload);
  if (error) throw new Error('dollar_transactions: ' + error.message);
  return payload.length;
}

async function importAttendance(db) {
  const rows = await getSheetRows(ATTENDANCE_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const recordDate = formatDate(rows[i][0]);
    const classId = String(rows[i][1] || '').trim();
    const studentId = String(rows[i][2] || '').trim();
    if (!recordDate || !classId || !studentId) continue;
    if (!isValidClassStudent(classId, studentId)) continue;
    payload.push({
      record_date: recordDate,
      class_id: classId,
      student_id: studentId,
      attendance: String(rows[i][3] || ''),
      vocab_score: rows[i][4] === '' || rows[i][4] == null ? null : Number(rows[i][4])
    });
  }
  console.log('attendance_records:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const { error } = await db.from('attendance_records').upsert(chunk, {
      onConflict: 'record_date,class_id,student_id'
    });
    if (error) throw new Error('attendance batch ' + i + ': ' + error.message);
  }
  return payload.length;
}

async function importClassroomMap(db) {
  const rows = await getSheetRows(HOMEWORK_SHEETS.MAP, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const classId = String(rows[i][0] || '').trim();
    if (!classId) continue;
    payload.push({
      class_id: classId,
      course_id: String(rows[i][1] || ''),
      course_name: String(rows[i][2] || '')
    });
  }
  console.log('classroom_map:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const { error } = await db.from('classroom_map').upsert(payload, { onConflict: 'class_id' });
  if (error) throw new Error('classroom_map: ' + error.message);
  return payload.length;
}

async function importHomeworkLog(db) {
  const rows = await getSheetRows(HOMEWORK_SHEETS.LOG, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const homeworkId = String(rows[i][0] || '').trim();
    const classId = String(rows[i][1] || '').trim();
    const assignedDate = formatDate(rows[i][2]);
    if (!homeworkId || !classId || !assignedDate) continue;
    if (!validClassIds.has(classId)) continue;
    payload.push({
      homework_id: homeworkId,
      class_id: classId,
      assigned_date: assignedDate,
      title: String(rows[i][3] || ''),
      description: String(rows[i][4] || ''),
      classroom_work_id: String(rows[i][5] || ''),
      posted_at: parseIso(rows[i][6])
    });
  }
  console.log('homework_log:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const { error } = await db.from('homework_log').upsert(payload, { onConflict: 'homework_id' });
  if (error) throw new Error('homework_log: ' + error.message);
  return payload.length;
}

async function importHomeworkItems(db) {
  const logRows = await getSheetRows(HOMEWORK_SHEETS.LOG, { skipCache: true });
  const validHomeworkIds = new Set();
  for (let i = 1; i < logRows.length; i++) {
    const homeworkId = String(logRows[i][0] || '').trim();
    const classId = String(logRows[i][1] || '').trim();
    if (homeworkId && validClassIds.has(classId)) validHomeworkIds.add(homeworkId);
  }

  const rows = await getSheetRows(HOMEWORK_SHEETS.ITEMS, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const itemId = String(rows[i][0] || '').trim();
    const homeworkId = String(rows[i][1] || '').trim();
    if (!itemId || !homeworkId) continue;
    if (!validHomeworkIds.has(homeworkId)) continue;
    payload.push({
      item_id: itemId,
      homework_id: homeworkId,
      sort_order: Number(rows[i][2]) || 0,
      title: String(rows[i][3] || ''),
      description: String(rows[i][4] || ''),
      target_student_ids: String(rows[i][5] || '')
    });
  }
  console.log('homework_items:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const { error } = await db.from('homework_items').upsert(chunk, { onConflict: 'item_id' });
    if (error) throw new Error('homework_items batch ' + i + ': ' + error.message);
  }
  return payload.length;
}

async function importHomeworkCompletion(db) {
  const itemRows = await getSheetRows(HOMEWORK_SHEETS.ITEMS, { skipCache: true });
  const validItemIds = new Set();
  const logRows = await getSheetRows(HOMEWORK_SHEETS.LOG, { skipCache: true });
  const validHomeworkIds = new Set();
  for (let i = 1; i < logRows.length; i++) {
    const homeworkId = String(logRows[i][0] || '').trim();
    const classId = String(logRows[i][1] || '').trim();
    if (homeworkId && validClassIds.has(classId)) validHomeworkIds.add(homeworkId);
  }
  for (let i = 1; i < itemRows.length; i++) {
    const itemId = String(itemRows[i][0] || '').trim();
    const homeworkId = String(itemRows[i][1] || '').trim();
    if (itemId && validHomeworkIds.has(homeworkId)) validItemIds.add(itemId);
  }

  const rows = await getSheetRows(HOMEWORK_SHEETS.COMPLETION, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const itemId = String(rows[i][0] || '').trim();
    const studentId = String(rows[i][1] || '').trim();
    if (!itemId || !studentId) continue;
    if (!validItemIds.has(itemId) || !validStudentIds.has(studentId)) continue;
    payload.push({
      item_id: itemId,
      student_id: studentId,
      completed: sheetBool(rows[i][2]),
      completed_at: parseIso(rows[i][3]),
      fix_note: String(rows[i][4] || '')
    });
  }
  console.log('homework_completion:', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const { error } = await db.from('homework_completion').upsert(chunk, {
      onConflict: 'item_id,student_id'
    });
    if (error) throw new Error('homework_completion batch ' + i + ': ' + error.message);
  }
  return payload.length;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  // Cache Supabase client before disabling adapter (reads must come from Sheets)
  const db = getSupabase();
  const prevEnabled = process.env.SUPABASE_ENABLED;
  process.env.SUPABASE_ENABLED = 'false';

  console.log(dryRun ? 'DRY RUN — reads Sheets only, no Supabase writes' : 'Importing Phase 2 data to Supabase…');

  try {
    await loadValidIds();
    const stats = {
      dollar_balances: await importDollarBalances(db),
      dollar_transactions: await importDollarTransactions(db),
      attendance_records: await importAttendance(db),
      classroom_map: await importClassroomMap(db),
      homework_log: await importHomeworkLog(db),
      homework_items: await importHomeworkItems(db),
      homework_completion: await importHomeworkCompletion(db)
    };

    console.log('Done.', stats);
    if (!dryRun) {
      console.log('\nPhase 2 live: dollars, attendance, homework now use Supabase when env is set.');
      console.log('Homework_Manual_Pending and other sheets still on Google Sheets.');
    }
  } finally {
    if (prevEnabled === undefined) delete process.env.SUPABASE_ENABLED;
    else process.env.SUPABASE_ENABLED = prevEnabled;
  }
}

main().catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
