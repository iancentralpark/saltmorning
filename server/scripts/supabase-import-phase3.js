#!/usr/bin/env node
/**
 * One-time import: Google Sheets → Supabase (Phase 3)
 *
 * Prerequisites: run 003_phase3_all.sql in Supabase SQL Editor
 *
 * Usage:
 *   cd server && npm run supabase:import-phase3
 *   cd server && npm run supabase:import-phase3 -- --dry-run
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { getSupabase } = require('../src/supabaseClient');
const { getSheetRows } = require('../src/sheets');
const {
  TEXTBOOK_SHEETS,
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  CHAMBIT_WEEK_SHEET,
  LUCKY_DRAW_SHEET,
  LUCKY_DRAW_TIERS_SHEET,
  LUCKY_DRAW_PRIZES_SHEET,
  MANUAL_PENDING_SHEET,
  STUDENT_WITHDRAWN_SHEET,
  STUDENT_LEAVE_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  MAKEUP_SHEET
} = require('../src/config');
const { formatSheetDate } = require('../src/dateUtils');

const dryRun = process.argv.includes('--dry-run');

function formatDate(raw) {
  return formatSheetDate(raw) || null;
}

function sheetBool(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 'Y' || val === 'Yes';
}

function isActiveFlag(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '' || v === 'y' || v === 'yes' || v === 'true' || v === '1';
}

async function upsertBatch(db, table, payload, onConflict, label) {
  console.log(label + ':', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const batchSize = 200;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const { error } = await db.from(table).upsert(chunk, { onConflict: onConflict });
    if (error) throw new Error(label + ' batch ' + i + ': ' + error.message);
  }
  return payload.length;
}

async function insertBatch(db, table, payload, label) {
  console.log(label + ':', payload.length);
  if (dryRun || !payload.length) return payload.length;
  const { error } = await db.from(table).insert(payload);
  if (error) throw new Error(label + ': ' + error.message);
  return payload.length;
}

async function importWithdrawn(db) {
  const rows = await getSheetRows(STUDENT_WITHDRAWN_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const withdrawalId = String(rows[i][0] || '').trim();
    if (!withdrawalId) continue;
    payload.push({
      withdrawal_id: withdrawalId,
      student_id: String(rows[i][1] || ''),
      name: String(rows[i][2] || ''),
      class_id: String(rows[i][3] || ''),
      login_id: String(rows[i][4] || ''),
      login_password: String(rows[i][5] || ''),
      previous_status: String(rows[i][6] || ''),
      withdrawn_at: rows[i][7] ? new Date(rows[i][7]).toISOString() : null
    });
  }
  return upsertBatch(db, 'students_withdrawn', payload, 'withdrawal_id', 'students_withdrawn');
}

async function importLeaves(db) {
  const rows = await getSheetRows(STUDENT_LEAVE_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const leaveId = String(rows[i][0] || '').trim();
    if (!leaveId) continue;
    payload.push({
      leave_id: leaveId,
      student_id: String(rows[i][1] || ''),
      name: String(rows[i][2] || ''),
      class_id: String(rows[i][3] || ''),
      start_date: formatDate(rows[i][4]),
      end_date: formatDate(rows[i][5]),
      reason: String(rows[i][6] || ''),
      status: String(rows[i][7] || 'Active'),
      created_at: rows[i][8] ? new Date(rows[i][8]).toISOString() : null,
      ended_at: rows[i][9] ? new Date(rows[i][9]).toISOString() : null
    });
  }
  return upsertBatch(db, 'student_leaves', payload, 'leave_id', 'student_leaves');
}

async function importPlanned(db) {
  const rows = await getSheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const noticeId = String(rows[i][0] || '').trim();
    if (!noticeId) continue;
    payload.push({
      notice_id: noticeId,
      student_id: String(rows[i][1] || ''),
      name: String(rows[i][2] || ''),
      class_id: String(rows[i][3] || ''),
      notice_date: formatDate(rows[i][4]),
      notice_type: String(rows[i][5] || ''),
      note: String(rows[i][6] || ''),
      status: String(rows[i][7] || ''),
      created_at: rows[i][8] ? new Date(rows[i][8]).toISOString() : null
    });
  }
  return upsertBatch(db, 'student_planned_attendance', payload, 'notice_id', 'student_planned_attendance');
}

async function importManualPending(db) {
  const rows = await getSheetRows(MANUAL_PENDING_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const pendingId = String(rows[i][0] || '').trim();
    if (!pendingId) continue;
    payload.push({
      pending_id: pendingId,
      class_id: String(rows[i][1] || ''),
      student_id: String(rows[i][2] || ''),
      title: String(rows[i][3] || ''),
      description: String(rows[i][4] || ''),
      created_at: rows[i][5] ? new Date(rows[i][5]).toISOString() : null,
      fix_note: String(rows[i][6] || '')
    });
  }
  return upsertBatch(db, 'homework_manual_pending', payload, 'pending_id', 'homework_manual_pending');
}

async function importTextbooks(db) {
  const books = await getSheetRows(TEXTBOOK_SHEETS.BOOKS, { skipCache: true });
  const bookPayload = [];
  for (let i = 1; i < books.length; i++) {
    const id = String(books[i][0] || '').trim();
    if (!id) continue;
    bookPayload.push({
      textbook_id: id,
      class_id: String(books[i][1] || ''),
      name: String(books[i][2] || ''),
      book_type: String(books[i][3] || ''),
      unit_type: String(books[i][4] || 'chapter'),
      total_units: Number(books[i][5]) || 0,
      start_date: formatDate(books[i][6]),
      status: String(books[i][7] || 'Active'),
      completed_at: books[i][8] ? new Date(books[i][8]).toISOString() : null
    });
  }
  await upsertBatch(db, 'class_textbooks', bookPayload, 'textbook_id', 'class_textbooks');

  const prog = await getSheetRows(TEXTBOOK_SHEETS.PROGRESS, { skipCache: true });
  const progPayload = [];
  for (let i = 1; i < prog.length; i++) {
    const d = formatDate(prog[i][0]);
    const classId = String(prog[i][1] || '');
    const textbookId = String(prog[i][2] || '');
    if (!d || !classId || !textbookId) continue;
    progPayload.push({
      record_date: d,
      class_id: classId,
      textbook_id: textbookId,
      position: Number(prog[i][3]) || 0
    });
  }
  await upsertBatch(db, 'textbook_progress', progPayload, 'record_date,class_id,textbook_id', 'textbook_progress');

  const queue = await getSheetRows(TEXTBOOK_SHEETS.QUEUE, { skipCache: true });
  const queuePayload = [];
  for (let i = 1; i < queue.length; i++) {
    const queueId = String(queue[i][0] || '').trim();
    if (!queueId) continue;
    queuePayload.push({
      queue_id: queueId,
      class_id: String(queue[i][1] || ''),
      sort_order: Number(queue[i][2]) || 0,
      name: String(queue[i][3] || ''),
      book_type: String(queue[i][4] || ''),
      unit_type: String(queue[i][5] || 'chapter'),
      total_units: Number(queue[i][6]) || 0,
      created_at: queue[i][7] ? new Date(queue[i][7]).toISOString() : null
    });
  }
  return upsertBatch(db, 'textbook_queue', queuePayload, 'queue_id', 'textbook_queue');
}

async function importSidebar(db) {
  const rules = await getSheetRows(RULES_SHEET, { skipCache: true });
  const rulesPayload = [];
  for (let i = 1; i < rules.length; i++) {
    const classId = String(rules[i][0] || '').trim();
    if (!classId) continue;
    rulesPayload.push({
      class_id: classId,
      rules: String(rules[i][1] || ''),
      updated_at: rules[i][2] ? new Date(rules[i][2]).toISOString() : null
    });
  }
  await upsertBatch(db, 'class_rules', rulesPayload, 'class_id', 'class_rules');

  const ann = await getSheetRows(ANNOUNCE_SHEET, { skipCache: true });
  const annPayload = [];
  for (let i = 1; i < ann.length; i++) {
    const classId = String(ann[i][0] || '').trim();
    if (!classId) continue;
    annPayload.push({
      class_id: classId,
      body: String(ann[i][1] || ''),
      updated_at: ann[i][2] ? new Date(ann[i][2]).toISOString() : null
    });
  }
  await upsertBatch(db, 'class_announcements', annPayload, 'class_id', 'class_announcements');

  const events = await getSheetRows(EVENTS_SHEET, { skipCache: true });
  const eventPayload = [];
  for (let i = 1; i < events.length; i++) {
    const eventId = String(events[i][0] || '').trim();
    if (!eventId) continue;
    eventPayload.push({
      event_id: eventId,
      class_id: String(events[i][1] || ''),
      event_date: formatDate(events[i][2]),
      description: String(events[i][3] || ''),
      created_at: events[i][4] ? new Date(events[i][4]).toISOString() : null
    });
  }
  await upsertBatch(db, 'class_events', eventPayload, 'event_id', 'class_events');

  const lib = await getSheetRows(LIBRARY_SHEET, { skipCache: true });
  const libPayload = [];
  for (let i = 1; i < lib.length; i++) {
    const bookId = String(lib[i][0] || '').trim();
    if (!bookId) continue;
    libPayload.push({
      book_id: bookId,
      class_id: String(lib[i][1] || ''),
      student_id: String(lib[i][2] || ''),
      title: String(lib[i][3] || ''),
      status: String(lib[i][4] || 'Pending'),
      created_at: lib[i][5] ? new Date(lib[i][5]).toISOString() : null,
      returned_at: lib[i][6] ? new Date(lib[i][6]).toISOString() : null
    });
  }
  await upsertBatch(db, 'library_books', libPayload, 'book_id', 'library_books');

  const vid = await getSheetRows(VIDEO_SHEET, { skipCache: true });
  const vidPayload = [];
  for (let i = 1; i < vid.length; i++) {
    const classId = String(vid[i][0] || '').trim();
    if (!classId) continue;
    vidPayload.push({
      class_id: classId,
      video_url: String(vid[i][1] || ''),
      updated_at: vid[i][2] ? new Date(vid[i][2]).toISOString() : null
    });
  }
  return upsertBatch(db, 'class_video', vidPayload, 'class_id', 'class_video');
}

async function importChambit(db) {
  const daily = await getSheetRows(CHAMBIT_DAILY_SHEET, { skipCache: true });
  const dailyPayload = [];
  for (let i = 1; i < daily.length; i++) {
    const d = formatDate(daily[i][0]);
    const classId = String(daily[i][1] || '');
    const studentId = String(daily[i][2] || '');
    if (!d || !classId || !studentId) continue;
    dailyPayload.push({ record_date: d, class_id: classId, student_id: studentId });
  }
  await upsertBatch(db, 'chambit_daily', dailyPayload, 'record_date,class_id,student_id', 'chambit_daily');

  const combo = await getSheetRows(CHAMBIT_COMBO_SHEET, { skipCache: true });
  const comboPayload = [];
  for (let i = 1; i < combo.length; i++) {
    const studentId = String(combo[i][0] || '').trim();
    if (!studentId) continue;
    comboPayload.push({
      student_id: studentId,
      combo_count: Number(combo[i][1]) || 0,
      updated_at: combo[i][2] ? new Date(combo[i][2]).toISOString() : null
    });
  }
  await upsertBatch(db, 'chambit_combo', comboPayload, 'student_id', 'chambit_combo');

  const week = await getSheetRows(CHAMBIT_WEEK_SHEET, { skipCache: true });
  const weekPayload = [];
  for (let i = 1; i < week.length; i++) {
    const studentId = String(week[i][0] || '').trim();
    const weekKey = String(week[i][1] || '').trim();
    if (!studentId || !weekKey) continue;
    weekPayload.push({
      student_id: studentId,
      week_key: weekKey,
      awarded_at: week[i][2] ? new Date(week[i][2]).toISOString() : null
    });
  }
  return upsertBatch(db, 'chambit_week_awards', weekPayload, 'student_id,week_key', 'chambit_week_awards');
}

async function importLuckyDraw(db) {
  const tiers = await getSheetRows(LUCKY_DRAW_TIERS_SHEET, { skipCache: true });
  const tierPayload = [];
  for (let i = 1; i < tiers.length; i++) {
    const tierId = String(tiers[i][0] || '').trim();
    if (!tierId) continue;
    tierPayload.push({
      tier_id: tierId,
      tier_name: String(tiers[i][1] || ''),
      weight: Number(tiers[i][2]) || 0,
      sort_order: Number(tiers[i][3]) || 0,
      active: isActiveFlag(tiers[i][4])
    });
  }
  await upsertBatch(db, 'lucky_draw_tiers', tierPayload, 'tier_id', 'lucky_draw_tiers');

  const prizes = await getSheetRows(LUCKY_DRAW_PRIZES_SHEET, { skipCache: true });
  const prizePayload = [];
  for (let i = 1; i < prizes.length; i++) {
    const tierId = String(prizes[i][0] || '').trim();
    if (!tierId) continue;
    prizePayload.push({
      tier_id: tierId,
      prize_text: String(prizes[i][1] || ''),
      sort_order: Number(prizes[i][2]) || 0,
      active: isActiveFlag(prizes[i][3])
    });
  }
  await upsertBatch(db, 'lucky_draw_prizes', prizePayload, 'tier_id,sort_order', 'lucky_draw_prizes');

  const tickets = await getSheetRows(LUCKY_DRAW_SHEET, { skipCache: true });
  const ticketPayload = [];
  for (let i = 1; i < tickets.length; i++) {
    const ticketId = String(tickets[i][0] || '').trim();
    if (!ticketId) continue;
    ticketPayload.push({
      ticket_id: ticketId,
      class_id: String(tickets[i][1] || ''),
      student_id: String(tickets[i][2] || ''),
      tier: String(tickets[i][3] || ''),
      prize_text: String(tickets[i][4] || ''),
      drawn_at: tickets[i][5] ? new Date(tickets[i][5]).toISOString() : null
    });
  }
  return insertBatch(db, 'lucky_draw_tickets', ticketPayload, 'lucky_draw_tickets');
}

async function importMakeup(db) {
  const rows = await getSheetRows(MAKEUP_SHEET, { skipCache: true });
  const payload = [];
  for (let i = 1; i < rows.length; i++) {
    const makeupId = String(rows[i][0] || '').trim();
    if (!makeupId) continue;
    payload.push({
      makeup_id: makeupId,
      class_id: String(rows[i][1] || ''),
      student_id: String(rows[i][2] || ''),
      student_name: String(rows[i][3] || ''),
      lesson_date: formatDate(rows[i][4]),
      lesson_time: String(rows[i][5] || ''),
      note: String(rows[i][6] || ''),
      status: String(rows[i][7] || 'Scheduled'),
      created_at: rows[i][8] ? new Date(rows[i][8]).toISOString() : null
    });
  }
  return upsertBatch(db, 'makeup_lessons', payload, 'makeup_id', 'makeup_lessons');
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  const db = getSupabase();
  const prevEnabled = process.env.SUPABASE_ENABLED;
  process.env.SUPABASE_ENABLED = 'false';

  console.log(dryRun ? 'DRY RUN — reads Sheets only' : 'Importing Phase 3 data to Supabase…');

  try {
    const stats = {
      students_withdrawn: await importWithdrawn(db),
      student_leaves: await importLeaves(db),
      student_planned_attendance: await importPlanned(db),
      homework_manual_pending: await importManualPending(db),
      textbooks: await importTextbooks(db),
      sidebar: await importSidebar(db),
      chambit: await importChambit(db),
      lucky_draw: await importLuckyDraw(db),
      makeup_lessons: await importMakeup(db)
    };
    console.log('Done.', stats);
    if (!dryRun) {
      console.log('\nPhase 3 live. Class log (separate spreadsheet) still uses Google Sheets.');
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
