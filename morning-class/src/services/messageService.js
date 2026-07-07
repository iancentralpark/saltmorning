const crypto = require('crypto');
const {
  MESSAGES_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');

const HEADERS = [
  'MessageId', 'CreatedAt', 'ClassId', 'StudentId', 'StudentName',
  'Sender', 'Body', 'ReadAt', 'DeletedAt'
];
const COL = { id: 0, created: 1, classId: 2, studentId: 3, name: 4, sender: 5, body: 6, read: 7, deleted: 8 };
const MAX_BODY = 500;

function isoNow() {
  return new Date().toISOString();
}

function newMessageId() {
  return 'msg_' + crypto.randomBytes(8).toString('hex');
}

function rowToMessage(row) {
  if (!row || !row[COL.id]) return null;
  if (String(row[COL.deleted] || '').trim()) return null;
  const readAt = String(row[COL.read] || '').trim();
  return {
    messageId: String(row[COL.id]),
    createdAt: String(row[COL.created] || ''),
    classId: String(row[COL.classId] || ''),
    studentId: String(row[COL.studentId] || ''),
    studentName: String(row[COL.name] || ''),
    sender: String(row[COL.sender] || ''),
    body: String(row[COL.body] || ''),
    readAt,
    read: !!readAt
  };
}

async function loadMessagesForStudent(studentId) {
  const data = await getSheetRows(MESSAGES_SHEET);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const msg = rowToMessage(data[i]);
    if (!msg || msg.studentId !== String(studentId)) continue;
    out.push(Object.assign({}, msg, { rowIndex: i + 1 }));
  }
  out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return out;
}

async function sendMessage({ classId, studentId, studentName, sender, body }) {
  body = String(body || '').trim();
  if (!body) throw new Error('Message cannot be empty.');
  if (body.length > MAX_BODY) throw new Error('Message is too long.');

  const row = [newMessageId(), isoNow(), String(classId), String(studentId), String(studentName || ''), sender, body, '', ''];
  await appendRows(MESSAGES_SHEET, [row]);
  return rowToMessage(row);
}

async function markMessagesRead(studentId, senderFilter) {
  const data = await getSheetRows(MESSAGES_SHEET);
  const now = isoNow();
  const updates = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.studentId]) !== String(studentId)) continue;
    if (senderFilter && String(data[i][COL.sender]) !== senderFilter) continue;
    if (String(data[i][COL.read] || '').trim()) continue;
    if (String(data[i][COL.deleted] || '').trim()) continue;
    updates.push({ row: i + 1 });
  }
  for (const u of updates) {
    await updateRange(MESSAGES_SHEET, `H${u.row}`, [[now]]);
  }
  return updates.length;
}

async function lookupStudentName(studentId) {
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(studentId)) {
      return String(data[i][1] || '');
    }
  }
  return '';
}

async function getClassLabel(classId) {
  const data = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(classId)) {
      return String(data[i][1] || classId);
    }
  }
  return classId;
}

module.exports = {
  HEADERS,
  loadMessagesForStudent,
  sendMessage,
  markMessagesRead,
  lookupStudentName,
  getClassLabel
};
