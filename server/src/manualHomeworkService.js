const { MANUAL_PENDING_SHEET, TIMEZONE } = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRows } = require('./sheets');
const { formatDateTimeNow, formatDateInTz } = require('./dateUtils');

const MANUAL_PREFIX = 'MPH_';

function isManualPendingId(itemId) {
  return String(itemId || '').startsWith(MANUAL_PREFIX);
}

async function ensureManualPendingSheet() {
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

async function completeManualPending(pendingId) {
  await ensureManualPendingSheet();
  const row = await findManualRow(pendingId);
  if (row < 0) throw new Error('Manual pending item not found.');
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  const studentId = String(data[row - 1][2]);
  await deleteRows(MANUAL_PENDING_SHEET, [row]);
  return { message: 'Marked complete.', studentId };
}

async function setManualPendingFixNote(pendingId, fixNote) {
  await ensureManualPendingSheet();
  fixNote = String(fixNote || '').trim();
  const row = await findManualRow(pendingId);
  if (row < 0) throw new Error('Manual pending item not found.');
  await updateRange(MANUAL_PENDING_SHEET, `G${row}`, [[fixNote]]);
  const data = await getSheetRows(MANUAL_PENDING_SHEET);
  const studentId = String(data[row - 1][2]);
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

async function getManualPendingCountsByClass(classId) {
  const byStudent = await readManualPendingForClass(classId);
  const counts = {};
  Object.keys(byStudent).forEach(sid => {
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
