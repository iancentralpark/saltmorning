#!/usr/bin/env node
/**
 * Copy LoginPassword from Google Sheet → students.login_password in Supabase.
 * Run after 005_students_login_password.sql migration.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { getSupabase } = require('../src/supabaseClient');
const { STUDENT_LIST_SHEET } = require('../src/config');
const { hashPassword } = require('../src/supabaseStudentService');

async function main() {
  const db = getSupabase();
  const prev = process.env.SUPABASE_ENABLED;
  process.env.SUPABASE_ENABLED = 'false';
  const { getSheetRows } = require('../src/sheets');
  const rows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  process.env.SUPABASE_ENABLED = prev;

  let updated = 0;
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    const plain = String(rows[i][5] || '').trim();
    if (!id || !plain) continue;
    const { error } = await db
      .from('students')
      .update({
        login_password: plain,
        password_hash: await hashPassword(plain)
      })
      .eq('id', id);
    if (error) {
      console.warn('skip', id, error.message);
      continue;
    }
    updated++;
    console.log('updated', id, rows[i][1]);
  }
  console.log('Done. login_password backfilled for', updated, 'students');
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
