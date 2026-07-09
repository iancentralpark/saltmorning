const { MANUAL_PENDING_SHEET, TIMEZONE } = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRows, invalidateSheetRowsCache } = require('./sheets');
const { formatDateTimeNow, formatDateInTz } = require('./dateUtils');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

const MANUAL_PREFIX = 'MPH_';

function isManualPendingId(itemId) {
  return String(itemId || '').startsWith(MANUAL_PREFIX);
}

async function ensureManualPendingSheet() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
  let data;
  try {
    data = await getSheetRows(MANUAL_PENDING_SHEET);
  } catch (e) {
    const { google } = require('googleapis');
    const { SPREADSHEET_ID } = require('./config');
    const { getServiceAccountAuthOptions } = require('./googleCredentials');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: MANUAL_PENDING_SHEET } } }]
      }
    });
    await appendRows(MANUAL_PENDING_SHEET, [[
      'PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'PendingID') {
    if (!data.length) {
      await appendRows(MANUAL_PENDING_SHEET, [[
        'PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'
      ]]);
    }
  }
}

function manualRowToEntry(row) {
  const createdAt = String(row[5] || '');
  const datePart = createdAt.split(' ')[0] || formatDateInTz(new Date(), TIMEZONE);
  return {
    itemId: String(row[0]),
    pendingId: String(row[0]),
    isManual: true,
    homeworkId: '',
    sortOrder: 0,
    title: String(row[3] || ''),
    description: String(row[4] || ''),
    bundleTitle: 'Teacher added',
    assignedDate: datePart,
    completed: false,
    completedAt: '',
    fixNote: row[6] ? String(row[6]) : ''
  };
}

async function readManualPendingForClass(classId) {
  await ensureManualPendingSheet();
  classId = String(classId);
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  const byStudent = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const sid = String(data[i][2]);
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push(manualRowToEntry(data[i]));
  }
  return byStudent;
}

async function addManualPendingHomework(classId, studentId, title, description) {
  await ensureManualPendingSheet();
  classId = String(classId);
  studentId = String(studentId);
  title = String(title || '').trim();
  description = String(description || '').trim();
  if (!title) throw new Error('Homework title is required.');
  const pendingId = MANUAL_PREFIX + classId + '_' + studentId + '_' + Date.now();
  const createdAt = formatDateTimeNow(TIMEZONE);
  await appendRows(MANUAL_PENDING_SHEET, [[
    pendingId, classId, studentId, title, description, createdAt, ''
  ]]);
  const pendingCount = await countManualPendingForStudent(classId, studentId);
  return {
    message: 'Pending homework added.',
    pendingId,
    studentId,
    pendingCount,
    item: manualRowToEntry([pendingId, classId, studentId, title, description, createdAt, ''])
  };
}

async function findManualRow(pendingId) {
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(pendingId)) return i + 1;
  }
  return -1;
}

function afterManualHomeworkWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(MANUAL_PENDING_SHEET);
}

async function completeManualPending(pendingId, classId) {
  await ensureManualPendingSheet();
  pendingId = String(pendingId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('homework_manual_pending')
      .select('student_id, class_id')
      .eq('pending_id', pendingId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!data) throw new Error('Manual pending item not found.');
    const studentId = String(data.student_id);
    const resolvedClassId = classId || String(data.class_id || '');
    const { error } = await db.from('homework_manual_pending').delete().eq('pending_id', pendingId);
    if (error) throw new Error(error.message);
    afterManualHomeworkWrite(resolvedClassId);
    return { message: 'Marked complete.', studentId };
  }
  const row = await findManualRow(pendingId);
  if (row < 0) throw new Error('Manual pending item not found.');
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  const studentId = String(data[row - 1][2]);
  const resolvedClassId = classId || String(data[row - 1][1] || '');
  await deleteRows(MANUAL_PENDING_SHEET, [row]);
  afterManualHomeworkWrite(resolvedClassId);
  return { message: 'Marked complete.', studentId };
}

async function setManualPendingFixNote(pendingId, fixNote, classId) {
  await ensureManualPendingSheet();
  fixNote = String(fixNote || '').trim();
  pendingId = String(pendingId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('homework_manual_pending')
      .select('student_id, class_id')
      .eq('pending_id', pendingId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!data) throw new Error('Manual pending item not found.');
    const { error } = await db.from('homework_manual_pending').update({ fix_note: fixNote }).eq('pending_id', pendingId);
    if (error) throw new Error(error.message);
    afterManualHomeworkWrite(classId || String(data.class_id || ''));
    return {
      message: fixNote ? 'Fix note saved.' : 'Fix note cleared.',
      studentId: String(data.student_id),
      itemId: pendingId,
      fixNote
    };
  }
  const row = await findManualRow(pendingId);
  if (row < 0) throw new Error('Manual pending item not found.');
  await updateRange(MANUAL_PENDING_SHEET, `G${row}`, [[fixNote]]);
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  const studentId = String(data[row - 1][2]);
  afterManualHomeworkWrite(classId || String(data[row - 1][1] || ''));
  return {
    message: fixNote ? 'Fix note saved.' : 'Fix note cleared.',
    studentId,
    itemId: pendingId,
    fixNote
  };
}

async function deleteManualPending(pendingId) {
  return completeManualPending(pendingId);
}

async function countManualPendingForStudent(classId, studentId) {
  const byStudent = await readManualPendingForClass(classId);
  return (byStudent[String(studentId)] || []).length;
}

function buildManualPendingCountsFromRows(data, classId) {
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(classId)) continue;
    const sid = String(data[i][2]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

async function getManualPendingCountsByClass(classId, ctx) {
  classId = String(classId);
  if (ctx && typeof ctx.sheetRows === 'function') {
    const data = await ctx.sheetRows(MANUAL_PENDING_SHEET);
    return buildManualPendingCountsFromRows(data, classId);
  }
  const byStudent = await readManualPendingForClass(classId);
  const counts = {};
  Object.keys(byStudent).forEach(function(sid) {
    counts[sid] = byStudent[sid].length;
  });
  return counts;
}

module.exports = {
  isManualPendingId,
  readManualPendingForClass,
  addManualPendingHomework,
  completeManualPending,
  setManualPendingFixNote,
  deleteManualPending,
  countManualPendingForStudent,
  getManualPendingCountsByClass
};
