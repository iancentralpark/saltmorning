const crypto = require('crypto');
const { getSupabase } = require('./supabaseClient');
const { lookupStudentName, getClassNameMap, getClassLabel } = require('./supabaseStudentService');
const { sendStudentMessageTelegram } = require('./telegramNotify');
const { cacheGet, cacheSet, cacheGetVersioned, cacheSetVersioned, cacheDeletePrefix } = require('./cache');

const MAX_BODY = 500;
const INBOX_CACHE_SEC = 2;
const RECENT_MESSAGE_LIMIT = 300;
const INBOX_MESSAGE_LIMIT = 5000;
let messageCacheGeneration = 0;

function isoNow() {
  return new Date().toISOString();
}

function newMessageId() {
  return 'msg_' + crypto.randomBytes(8).toString('hex');
}

function normalizeBody(body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('Message cannot be empty.');
  if (text.length > MAX_BODY) {
    throw new Error('Message is too long (max ' + MAX_BODY + ' characters).');
  }
  return text;
}

function isTransientDbError(err) {
  const msg = String((err && err.message) || err || '');
  return /timeout|upstream|522|503|ECONNRESET|ETIMEDOUT|fetch failed|disconnect/i.test(msg);
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function withDbRetry(fn, attempts) {
  attempts = attempts || 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i >= attempts - 1) throw err;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

function rowToMessage(row) {
  if (!row || !row.id) return null;
  if (row.deleted_at) return null;
  const readAt = row.read_at ? String(row.read_at) : '';
  return {
    messageId: String(row.id),
    createdAt: String(row.created_at || ''),
    classId: String(row.class_id || ''),
    studentId: String(row.student_id || ''),
    studentName: String(row.student_name || ''),
    sender: String(row.sender || ''),
    body: String(row.body || ''),
    readAt: readAt,
    read: !!readAt
  };
}

function invalidateMessageCaches() {
  messageCacheGeneration += 1;
  cacheDeletePrefix('msg_inbox_');
  cacheDeletePrefix('msg_unread_');
  cacheDeletePrefix('msg_thread_');
}

async function loadInboxMessages(classId) {
  const db = getSupabase();
  let q = db
    .from('messages')
    .select('id, created_at, class_id, student_id, student_name, sender, body, read_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(INBOX_MESSAGE_LIMIT);
  if (classId) q = q.eq('class_id', String(classId));
  const { data, error } = await withDbRetry(function() { return q; });
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).map(rowToMessage).filter(Boolean);
}

async function loadRecentMessages(classId) {
  const db = getSupabase();
  let q = db
    .from('messages')
    .select('id, created_at, class_id, student_id, student_name, sender, body, read_at, deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(RECENT_MESSAGE_LIMIT);
  if (classId) q = q.eq('class_id', String(classId));
  const { data, error } = await withDbRetry(function() { return q; });
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).map(rowToMessage).filter(Boolean);
}

async function appendMessage(fields) {
  const db = getSupabase();
  const row = {
    id: newMessageId(),
    created_at: isoNow(),
    class_id: String(fields.classId),
    student_id: String(fields.studentId),
    student_name: String(fields.studentName || ''),
    sender: fields.sender,
    body: fields.body,
    read_at: null,
    deleted_at: null
  };
  const { data, error } = await withDbRetry(function() {
    return db.from('messages').insert(row).select('*').single();
  });
  if (error) throw new Error(error.message || 'Could not save message.');
  invalidateMessageCaches();
  return rowToMessage(data);
}

async function getThread(classId, studentId, limit) {
  const max = Math.min(Number(limit) || 50, 100);
  // Always read from DB — in-memory thread cache is unsafe on multi-instance hosts.
  const db = getSupabase();
  const { data, error } = await withDbRetry(function() {
    return db
      .from('messages')
      .select('id, created_at, class_id, student_id, student_name, sender, body, read_at, deleted_at')
      .eq('class_id', String(classId))
      .eq('student_id', String(studentId))
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(max);
  });
  if (error) throw new Error(error.message || 'Database error.');
  return (data || []).slice().reverse().map(function(row) {
    const m = rowToMessage(row);
    return {
      messageId: m.messageId,
      createdAt: m.createdAt,
      sender: m.sender,
      body: m.body,
      read: m.read,
      readAt: m.readAt
    };
  });
}

async function markMessagesRead(classId, studentId, reader) {
  const targetSender = reader === 'teacher' ? 'student' : 'teacher';
  const db = getSupabase();
  const now = isoNow();
  const { data, error } = await withDbRetry(function() {
    return db
      .from('messages')
      .update({ read_at: now })
      .eq('class_id', String(classId))
      .eq('student_id', String(studentId))
      .eq('sender', targetSender)
      .is('read_at', null)
      .is('deleted_at', null)
      .select('id');
  });
  if (error) throw new Error(error.message || 'Database error.');
  const count = (data || []).length;
  if (count > 0) invalidateMessageCaches();
  return count;
}

async function getStudentUnreadCount(studentId, classId) {
  const cacheKey = 'msg_unread_student_' + String(classId) + '_' + String(studentId);
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;

  const db = getSupabase();
  const { count, error } = await withDbRetry(function() {
    return db
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', String(classId))
      .eq('student_id', String(studentId))
      .eq('sender', 'teacher')
      .is('read_at', null)
      .is('deleted_at', null);
  });
  if (error) throw new Error(error.message || 'Database error.');
  const n = count || 0;
  cacheSet(cacheKey, n, 15);
  return n;
}

function buildInboxEntries(msgs, classIdFilter) {
  const byKey = {};
  msgs.filter(function(m) {
    return !classIdFilter || m.classId === String(classIdFilter);
  }).forEach(function(m) {
    const key = m.classId + '|' + m.studentId;
    if (!byKey[key]) {
      byKey[key] = {
        classId: m.classId,
        studentId: m.studentId,
        studentName: m.studentName,
        unreadCount: 0,
        lastMessage: '',
        lastAt: '',
        lastSender: ''
      };
    }
    const entry = byKey[key];
    if (m.studentName) entry.studentName = m.studentName;
    if (m.sender === 'student' && !m.read) entry.unreadCount++;
    if (!entry.lastAt || m.createdAt > entry.lastAt) {
      entry.lastAt = m.createdAt;
      entry.lastMessage = m.body;
      entry.lastSender = m.sender;
    }
  });
  return Object.values(byKey).sort(function(a, b) {
    return (b.lastAt || '').localeCompare(a.lastAt || '');
  });
}

async function getInboxForClass(classId) {
  const cacheKey = 'msg_inbox_class_' + String(classId);
  const gen = messageCacheGeneration;
  const cached = cacheGetVersioned(cacheKey, gen);
  if (cached) return cached;

  const msgs = await loadInboxMessages(classId);
  const inbox = buildInboxEntries(msgs, classId);
  if (gen === messageCacheGeneration) {
    cacheSetVersioned(cacheKey, inbox, INBOX_CACHE_SEC, gen);
  }
  return inbox;
}

async function getGlobalInbox() {
  const cacheKey = 'msg_inbox_global';
  const gen = messageCacheGeneration;
  const cached = cacheGetVersioned(cacheKey, gen);
  if (cached) return cached;

  const classNames = await getClassNameMap();
  const msgs = await loadInboxMessages('');
  const entries = buildInboxEntries(msgs, '').map(function(row) {
    return Object.assign({}, row, {
      className: classNames[row.classId] || row.classId
    });
  });
  if (gen === messageCacheGeneration) {
    cacheSetVersioned(cacheKey, entries, INBOX_CACHE_SEC, gen);
  }
  return entries;
}

async function countUnreadStudentMessages(classId) {
  const db = getSupabase();
  let q = db
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('sender', 'student')
    .is('read_at', null)
    .is('deleted_at', null);
  if (classId) q = q.eq('class_id', String(classId));
  const { count, error } = await withDbRetry(function() { return q; });
  if (error) throw new Error(error.message || 'Database error.');
  return count || 0;
}

async function getUnreadTotalForClass(classId) {
  const cacheKey = 'msg_unread_class_' + String(classId);
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;
  const n = await countUnreadStudentMessages(classId);
  cacheSet(cacheKey, n, 15);
  return n;
}

async function getUnreadTotalGlobal() {
  const cacheKey = 'msg_unread_global';
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;
  const n = await countUnreadStudentMessages('');
  cacheSet(cacheKey, n, 15);
  return n;
}

async function studentSendMessage(studentId, classId, studentName, body) {
  body = normalizeBody(body);
  const name = studentName || await lookupStudentName(studentId, classId);
  const msg = await appendMessage({
    classId: classId,
    studentId: studentId,
    studentName: name,
    sender: 'student',
    body: body
  });
  try {
    const classLabel = await getClassLabel(classId);
    await sendStudentMessageTelegram({ studentName: name, classLabel: classLabel, body: body });
  } catch (e) {
    console.error('Telegram notify', e);
  }
  return msg;
}

async function teacherSendMessage(classId, studentId, studentName, body) {
  body = normalizeBody(body);
  const name = studentName || await lookupStudentName(studentId, classId);
  return appendMessage({
    classId: classId,
    studentId: studentId,
    studentName: name,
    sender: 'teacher',
    body: body
  });
}

async function ensureMessagesSheet() {
  /* no-op — Supabase tables created via migration */
}

module.exports = {
  ensureMessagesSheet,
  getClassLabel,
  getThread,
  markMessagesRead,
  getStudentUnreadCount,
  getInboxForClass,
  getGlobalInbox,
  getUnreadTotalForClass,
  getUnreadTotalGlobal,
  studentSendMessage,
  teacherSendMessage
};
