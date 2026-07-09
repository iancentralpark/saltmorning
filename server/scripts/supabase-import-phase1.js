#!/usr/bin/env node
/**
 * One-time import: Google Sheets → Supabase (Phase 1)
 *
 * Prerequisites:
 *   1. Run server/supabase/migrations/001_phase1.sql in Supabase SQL Editor
 *   2. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in server/.env
 *   3. Google Sheets credentials still required (reads source data)
 *
 * Usage:
 *   cd server && npm run supabase:import-phase1
 *   cd server && npm run supabase:import-phase1 -- --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { getSupabase, isSupabaseEnabled } = require('../src/supabaseClient');
const { hashPassword } = require('../src/supabaseStudentService');
const { getSheetRows } = require('../src/sheets');
const {
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  MESSAGES_SHEET
} = require('../src/config');

const dryRun = process.argv.includes('--dry-run');

function parseAllowedDays(raw) {
  return String(raw || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => !isNaN(n));
}

function parseIsoDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

async function importClasses(db) {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (!id) continue;
    payload.push({
      id,
      name: String(rows[i][1] || id),
      schedule_type: String(rows[i][2] || '') || null,
      allowed_days: parseAllowedDays(rows[i][3])
    });
  }
  console.log('classes:', payload.length);
  if (dryRun) return payload.length;
  const { error } = await db.from('classes').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error('classes: ' + error.message);
  return payload.length;
}

async function importStudents(db) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (!id) continue;
    const loginId = String(rows[i][4] || '').trim() || id.toLowerCase();
    const plainPw = String(rows[i][5] || '').trim();
    if (!plainPw) {
      console.warn('student row', i + 1, id, '— no password; portal login disabled until set');
    }
    payload.push({
      id,
      name: String(rows[i][1] || id),
      class_id: String(rows[i][2] || '').trim(),
      status: String(rows[i][3] || 'Enrolled').trim() || 'Enrolled',
      login_id: loginId,
      login_password: plainPw,
      password_hash: await hashPassword(plainPw || ('no-portal-' + id + '-' + Date.now()))
    });
  }
  console.log('students:', payload.length);
  if (dryRun) return payload.length;
  const { error } = await db.from('students').upsert(payload, { onConflict: 'id' });
  if (error) throw new Error('students: ' + error.message);
  return payload.length;
}

async function importMessages(db) {
  const rows = await getSheetRows(MESSAGES_SHEET);
  const header = rows[0] || [];
  const hasThreadCols = String(header[2] || '').trim() === 'ThreadId';
  const col = hasThreadCols
    ? { id: 0, created: 1, classId: 4, studentId: 5, name: 6, sender: 7, body: 10, read: 12, deleted: 13 }
    : { id: 0, created: 1, classId: 2, studentId: 3, name: 4, sender: 5, body: 6, read: 7, deleted: 8 };

  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][col.id] || '').trim();
    if (!id) continue;
    const sender = String(rows[i][col.sender] || '').trim().toLowerCase();
    if (sender !== 'student' && sender !== 'teacher') {
      console.warn('skip message row', i + 1, '(invalid sender:', rows[i][col.sender] + ')');
      continue;
    }
    const deleted = String(rows[i][col.deleted] || '').trim();
    payload.push({
      id,
      created_at: parseIsoDate(rows[i][col.created]),
      class_id: String(rows[i][col.classId] || '').trim(),
      student_id: String(rows[i][col.studentId] || '').trim(),
      student_name: String(rows[i][col.name] || ''),
      sender,
      body: String(rows[i][col.body] || ''),
      read_at: String(rows[i][col.read] || '').trim() || null,
      deleted_at: deleted || null
    });
  }
  console.log('messages:', payload.length);
  if (dryRun) return payload.length;
  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const { error } = await db.from('messages').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error('messages batch ' + i + ': ' + error.message);
  }
  return payload.length;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }
  const db = getSupabase();
  const prevEnabled = process.env.SUPABASE_ENABLED;
  process.env.SUPABASE_ENABLED = 'false';

  console.log(dryRun ? 'DRY RUN — no writes' : 'Importing Phase 1 data to Supabase…');
  try {
    const nClasses = await importClasses(db);
    const nStudents = await importStudents(db);
    const nMessages = await importMessages(db);
    console.log('Done.', { classes: nClasses, students: nStudents, messages: nMessages });
    if (!dryRun) {
      console.log('\nNext: restart Railway / local server. Login + messages now use Supabase.');
      console.log('Sheets remain as backup; they are not auto-synced in Phase 1.');
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
