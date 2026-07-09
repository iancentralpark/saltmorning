const crypto = require('crypto');
const {
  MESSAGES_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, batchUpdateRanges } = require('../sheets');
const { getTeacherClasses } = require('./teacherPortalService');
const { getClassRoster } = require('./teacherPortalService');

const MAX_BODY = 500;
const COL = {
  id: 0, created: 1, threadId: 2, threadType: 3, classId: 4, studentId: 5,
  studentName: 6, senderRole: 7, senderId: 8, senderName: 9, body: 10,
  targetAudience: 11, readAt: 12, deleted: 13
};

const HEADERS = [
  'MessageId', 'CreatedAt', 'ThreadId', 'ThreadType', 'ClassId', 'StudentId', 'StudentName',
  'SenderRole', 'SenderId', 'SenderName', 'Body', 'TargetAudience', 'ReadAt', 'DeletedAt'
];

function isoNow() {
  return new Date().toISOString();
}

function newMessageId() {
  return 'msg_' + crypto.randomBytes(8).toString('hex');
}

function studentThreadId(studentId) {
  return 'stu_' + String(studentId);
}

function adminThreadId(teacherId) {
  return 'adm_' + String(teacherId);
}

function targetAudienceFor(senderRole, threadType) {
  if (threadType === 'admin') {
    return senderRole === 'admin' ? 'teacher' : 'admin';
  }
  if (senderRole === 'teacher' || senderRole === 'admin') return 'family';
  return 'teacher';
}

function rowToMessage(row) {
  if (!row || !row[COL.id]) return null;
  if (String(row[COL.deleted] || '').trim()) return null;

  const threadId = String(row[COL.threadId] || '').trim();
  const studentId = String(row[COL.studentId] || '').trim();
  const legacySender = String(row[COL.senderRole] || row[5] || '').trim();

  const msg = {
    messageId: String(row[COL.id]),
    createdAt: String(row[COL.created] || ''),
    threadId: threadId || (studentId ? studentThreadId(studentId) : ''),
    threadType: String(row[COL.threadType] || 'student').trim() || 'student',
    classId: String(row[COL.classId] || '').trim(),
    studentId,
    studentName: String(row[COL.studentName] || '').trim(),
    senderRole: String(row[COL.senderRole] || '').trim(),
    senderId: String(row[COL.senderId] || '').trim(),
    senderName: String(row[COL.senderName] || '').trim(),
    body: String(row[COL.body] || '').trim(),
    targetAudience: String(row[COL.targetAudience] || '').trim(),
    readAt: String(row[COL.readAt] || '').trim(),
    sender: String(row[COL.senderRole] || legacySender || '').trim()
  };

  if (!msg.threadId && studentId) {
    msg.threadId = studentThreadId(studentId);
  }

  if (!msg.targetAudience) {
    msg.targetAudience = targetAudienceFor(msg.senderRole, msg.threadType);
  }
  msg.read = !!msg.readAt;
  return msg;
}

function audienceForRole(role) {
  if (role === 'student' || role === 'parent') return 'family';
  if (role === 'teacher') return 'teacher';
  if (role === 'admin') return 'admin';
  return '';
}

function isIncomingForRole(msg, role) {
  const aud = audienceForRole(role);
  if (!aud) return false;
  if (msg.senderRole === role) return false;
  if (msg.readAt) return false;
  return msg.targetAudience === aud;
}

let messageSchemaReady = false;

async function ensureMessageSchema() {
  if (messageSchemaReady) return;
  const data = await getSheetRows(MESSAGES_SHEET);
  if (!data.length) {
    await appendRows(MESSAGES_SHEET, [HEADERS]);
    messageSchemaReady = true;
    return;
  }

  const header = (data[0] || []).map((c) => String(c || '').trim());
  const isLegacy = header[5] === 'Sender' && !header.includes('ThreadId');

  if (isLegacy) {
    const newRows = [HEADERS];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r || !r[0]) continue;
      const studentId = String(r[3] || '');
      const sender = String(r[5] || '');
      newRows.push([
        String(r[0]), String(r[1] || ''), studentThreadId(studentId), 'student',
        String(r[2] || ''), studentId, String(r[4] || ''), sender, '', '',
        String(r[6] || ''), targetAudienceFor(sender, 'student'),
        String(r[7] || ''), String(r[8] || '')
      ]);
    }
    await updateRange(MESSAGES_SHEET, 'A1:N' + newRows.length, newRows);
    messageSchemaReady = true;
    return;
  }

  const needed = ['ThreadId', 'ThreadType', 'SenderRole', 'TargetAudience'];
  if (needed.every((h) => header.includes(h))) {
    messageSchemaReady = true;
    return;
  }

  const newHeader = header.slice();
  while (newHeader.length < HEADERS.length) newHeader.push('');
  HEADERS.forEach((h, idx) => { if (!newHeader[idx]) newHeader[idx] = h; });
  await updateRange(MESSAGES_SHEET, 'A1:N1', [newHeader.slice(0, HEADERS.length)]);
  messageSchemaReady = true;
}

async function loadAllMessages() {
  await ensureMessageSchema();
  const data = await getSheetRows(MESSAGES_SHEET);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const msg = rowToMessage(data[i]);
    if (!msg) continue;
    out.push(Object.assign({}, msg, { rowIndex: i + 1 }));
  }
  return out;
}

async function getClassLabel(classId) {
  const data = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(classId)) return String(data[i][1] || classId);
  }
  return classId;
}

async function lookupStudentName(studentId) {
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(studentId)) return String(data[i][1] || '');
  }
  return '';
}

async function teacherCanAccessStudent(teacherId, studentId, classId) {
  const { homeroom, assigned } = await getTeacherClasses(teacherId);
  const classIds = new Set();
  homeroom.forEach((c) => classIds.add(c.classId));
  assigned.forEach((c) => classIds.add(c.classId));
  if (classId && classIds.has(classId)) return true;
  for (const cid of classIds) {
    const roster = await getClassRoster(cid);
    if (roster.some((s) => s.studentId === String(studentId))) return true;
  }
  return false;
}

async function appendMessage(payload) {
  await ensureMessageSchema();
  const body = String(payload.body || '').trim();
  if (!body) throw new Error('Message cannot be empty.');
  if (body.length > MAX_BODY) throw new Error('Message is too long.');

  const threadType = payload.threadType || 'student';
  const threadId = payload.threadId ||
    (threadType === 'admin' ? adminThreadId(payload.senderId) : studentThreadId(payload.studentId));
  const senderRole = payload.senderRole || payload.sender || 'student';
  const targetAudience = payload.targetAudience || targetAudienceFor(senderRole, threadType);

  const row = [
    newMessageId(),
    isoNow(),
    threadId,
    threadType,
    String(payload.classId || ''),
    String(payload.studentId || ''),
    String(payload.studentName || ''),
    senderRole,
    String(payload.senderId || ''),
    String(payload.senderName || ''),
    body,
    targetAudience,
    '',
    ''
  ];
  await appendRows(MESSAGES_SHEET, [row]);
  return rowToMessage(row);
}

async function markThreadRead(threadId, role) {
  const aud = audienceForRole(role);
  if (!aud) return 0;
  const data = await getSheetRows(MESSAGES_SHEET);
  const now = isoNow();
  const updates = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.threadId] || '') !== String(threadId)) continue;
    const msg = rowToMessage(data[i]);
    if (!msg || msg.readAt) continue;
    if (msg.targetAudience !== aud) continue;
    updates.push({ sheetName: MESSAGES_SHEET, a1: 'M' + (i + 1), values: [[now]] });
  }
  if (updates.length) await batchUpdateRanges(updates);
  return updates.length;
}

function summarizeThread(messages, threadMeta) {
  const sorted = messages.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = sorted[sorted.length - 1];
  return Object.assign({}, threadMeta, {
    lastMessage: last ? last.body.slice(0, 80) : '',
    lastAt: last ? last.createdAt : '',
    lastSenderRole: last ? last.senderRole : '',
    messageCount: sorted.length
  });
}

async function listThreadsForSession(session) {
  const all = await loadAllMessages();
  const role = session.role;
  const threads = [];

  if (role === 'student') {
    const tid = studentThreadId(session.studentId);
    const msgs = all.filter((m) => m.threadId === tid);
    threads.push(summarizeThread(msgs, {
      threadId: tid,
      threadType: 'student',
      title: 'My teacher',
      subtitle: await getClassLabel(session.classId),
      classId: session.classId,
      studentId: session.studentId,
      studentName: session.name,
      unread: msgs.filter((m) => isIncomingForRole(m, role)).length
    }));
  } else if (role === 'parent') {
    const tid = studentThreadId(session.studentId);
    const msgs = all.filter((m) => m.threadId === tid);
    const sname = await lookupStudentName(session.studentId);
    threads.push(summarizeThread(msgs, {
      threadId: tid,
      threadType: 'student',
      title: "Child's teacher",
      subtitle: sname + ' · ' + await getClassLabel(session.classId),
      classId: session.classId,
      studentId: session.studentId,
      studentName: sname,
      unread: msgs.filter((m) => isIncomingForRole(m, role)).length
    }));
  } else if (role === 'teacher') {
    const { homeroom, assigned } = await getTeacherClasses(session.teacherId);
    const classIds = new Set();
    homeroom.forEach((c) => classIds.add(c.classId));
    assigned.forEach((c) => classIds.add(c.classId));
    const seenStudents = new Set();

    for (const classId of classIds) {
      const roster = await getClassRoster(classId);
      const className = await getClassLabel(classId);
      for (const st of roster) {
        if (seenStudents.has(st.studentId)) continue;
        seenStudents.add(st.studentId);
        const tid = studentThreadId(st.studentId);
        const msgs = all.filter((m) => m.threadId === tid);
        threads.push(summarizeThread(msgs, {
          threadId: tid,
          threadType: 'student',
          title: st.name,
          subtitle: className,
          classId,
          studentId: st.studentId,
          studentName: st.name,
          unread: msgs.filter((m) => isIncomingForRole(m, role)).length
        }));
      }
    }

    const adminTid = adminThreadId(session.teacherId);
    const adminMsgs = all.filter((m) => m.threadId === adminTid);
    threads.push(summarizeThread(adminMsgs, {
      threadId: adminTid,
      threadType: 'admin',
      title: 'Salt Admin',
      subtitle: 'School office',
      classId: '',
      studentId: '',
      studentName: '',
      unread: adminMsgs.filter((m) => isIncomingForRole(m, role)).length
    }));

    threads.sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      return String(b.lastAt).localeCompare(String(a.lastAt));
    });
  } else if (role === 'admin') {
    const studentThreads = new Map();
    all.forEach((m) => {
      if (m.threadType !== 'student' || !m.studentId) return;
      if (!studentThreads.has(m.threadId)) studentThreads.set(m.threadId, []);
      studentThreads.get(m.threadId).push(m);
    });

    const studentThreadEntries = Array.from(studentThreads.entries());
    for (const [tid, msgs] of studentThreadEntries) {
      const sample = msgs[0];
      const classLabel = await getClassLabel(sample.classId);
      threads.push(summarizeThread(msgs, {
        threadId: tid,
        threadType: 'student',
        title: sample.studentName || sample.studentId,
        subtitle: classLabel,
        classId: sample.classId,
        studentId: sample.studentId,
        studentName: sample.studentName,
        unread: msgs.filter((m) => isIncomingForRole(m, role)).length
      }));
    }

    const teacherRows = await getSheetRows(TEACHER_LIST_SHEET);
    for (let i = 1; i < teacherRows.length; i++) {
      const teacherId = String(teacherRows[i][0] || '');
      const teacherName = String(teacherRows[i][1] || '');
      if (!teacherId) continue;
      const tid = adminThreadId(teacherId);
      const msgs = all.filter((m) => m.threadId === tid);
      threads.push(summarizeThread(msgs, {
        threadId: tid,
        threadType: 'admin',
        title: teacherName || teacherId,
        subtitle: 'Staff',
        classId: '',
        studentId: '',
        studentName: '',
        teacherId,
        unread: msgs.filter((m) => isIncomingForRole(m, role)).length
      }));
    }

    threads.sort((a, b) => {
      if (b.unread !== a.unread) return b.unread - a.unread;
      return String(b.lastAt).localeCompare(String(a.lastAt));
    });
  }

  const unreadTotal = threads.reduce((s, t) => s + (t.unread || 0), 0);
  return { threads, unreadTotal };
}

async function getThreadMessages(threadId, session) {
  await assertThreadAccess(threadId, session);
  const all = await loadAllMessages();
  const messages = all
    .filter((m) => m.threadId === String(threadId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return messages;
}

async function assertThreadAccess(threadId, session) {
  const role = session.role;
  threadId = String(threadId);

  if (role === 'student') {
    if (threadId !== studentThreadId(session.studentId)) throw new Error('Access denied.');
    return;
  }
  if (role === 'parent') {
    if (threadId !== studentThreadId(session.studentId)) throw new Error('Access denied.');
    return;
  }
  if (role === 'teacher') {
    if (threadId === adminThreadId(session.teacherId)) return;
    if (threadId.startsWith('stu_')) {
      const studentId = threadId.slice(4);
      const all = await loadAllMessages();
      const sample = all.find((m) => m.threadId === threadId);
      const classId = sample ? sample.classId : '';
      const ok = await teacherCanAccessStudent(session.teacherId, studentId, classId);
      if (!ok) throw new Error('Access denied.');
      return;
    }
    throw new Error('Access denied.');
  }
  if (role === 'admin') return;
  throw new Error('Access denied.');
}

async function sendThreadMessage(threadId, session, body) {
  await assertThreadAccess(threadId, session);
  threadId = String(threadId);
  const role = session.role;

  if (threadId.startsWith('adm_')) {
    const teacherId = threadId.slice(4);
    return appendMessage({
      threadId,
      threadType: 'admin',
      senderRole: role === 'admin' ? 'admin' : 'teacher',
      senderId: role === 'admin' ? session.adminId : session.teacherId,
      senderName: session.name,
      body
    });
  }

  const studentId = threadId.startsWith('stu_') ? threadId.slice(4) : session.studentId;
  let classId = session.classId || '';
  let studentName = session.name || '';

  if (role === 'parent') {
    studentName = await lookupStudentName(studentId);
  } else if (role === 'teacher' || role === 'admin') {
    const all = await loadAllMessages();
    const sample = all.find((m) => m.threadId === threadId);
    if (sample) {
      classId = sample.classId;
      studentName = sample.studentName;
    } else {
      studentName = await lookupStudentName(studentId);
      const rows = await getSheetRows(STUDENT_LIST_SHEET);
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(studentId)) {
          classId = String(rows[i][2] || '');
          studentName = String(rows[i][1] || studentName);
          break;
        }
      }
    }
  }

  return appendMessage({
    threadId,
    threadType: 'student',
    classId,
    studentId,
    studentName: role === 'parent' ? studentName : studentName,
    senderRole: role,
    senderId: session[role + 'Id'] || session.studentId || session.teacherId || session.adminId || '',
    senderName: role === 'parent' ? (session.name + ' (parent)') : session.name,
    body
  });
}

async function getUnreadCount(session) {
  const { unreadTotal } = await listThreadsForSession(session);
  return unreadTotal;
}

// Legacy adapters
async function loadMessagesForStudent(studentId) {
  const all = await loadAllMessages();
  return all
    .filter((m) => m.threadId === studentThreadId(studentId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function sendMessage(payload) {
  const sender = payload.sender || payload.senderRole || 'student';
  return appendMessage({
    threadType: 'student',
    classId: payload.classId,
    studentId: payload.studentId,
    studentName: payload.studentName,
    senderRole: sender,
    senderId: payload.senderId || '',
    senderName: payload.senderName || '',
    body: payload.body
  });
}

async function markMessagesRead(studentId, senderFilter) {
  const tid = studentThreadId(studentId);
  const role = senderFilter === 'teacher' ? 'student' : 'student';
  return markThreadRead(tid, role);
}

module.exports = {
  HEADERS,
  studentThreadId,
  adminThreadId,
  ensureMessageSchema,
  listThreadsForSession,
  getThreadMessages,
  sendThreadMessage,
  markThreadRead,
  getUnreadCount,
  loadMessagesForStudent,
  sendMessage,
  markMessagesRead,
  lookupStudentName,
  getClassLabel
};
