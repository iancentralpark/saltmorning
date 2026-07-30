const crypto = require('crypto');
const { MESSAGES_SHEET, CLASS_LIST_SHEET, STUDENT_LIST_SHEET, SPREADSHEET_ID } = require('./config');
const {
  getSheetRows,
  getSheetIdMap,
  appendRows,
  updateRange,
  batchUpdateRanges,
  invalidateSheetRowsCache,
  invalidateSheetIdCache
} = require('./sheets');
const { getServiceAccountAuthOptions } = require('./googleCredentials');
const { sendStudentMessageTelegram } = require('./telegramNotify');

const HEADERS = [
  'MessageId', 'CreatedAt', 'ClassId', 'StudentId', 'StudentName',
  'Sender', 'Body', 'ReadAt', 'DeletedAt'
];
const COL = {
  id: 0, created: 1, classId: 2, studentId: 3, name: 4,
  sender: 5, body: 6, read: 7, deleted: 8
};
const MAX_BODY = 500;

let messagesReady = false;

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
    readAt: readAt,
    read: !!readAt
  };
}

async function ensureMessagesSheet() {
  if (messagesReady) return;

  const idMap = await getSheetIdMap();
  if (idMap[MESSAGES_SHEET] == null) {
    const { google } = require('googleapis');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: MESSAGES_SHEET } } }]
        }
      });
      invalidateSheetIdCache();
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/already exists/i.test(msg)) {
        invalidateSheetIdCache();
      } else {
        throw e;
      }
    }
    const refreshed = await getSheetIdMap();
    if (refreshed[MESSAGES_SHEET] == null) {
      throw new Error('Could not create or find sheet: ' + MESSAGES_SHEET);
    }
  }

  let data;
  try {
    data = await getSheetRows(MESSAGES_SHEET);
  } catch (e) {
    throw new Error('Could not read messages sheet: ' + (e.message || e));
  }

  if (!data.length) {
    await appendRows(MESSAGES_SHEET, [HEADERS]);
    messagesReady = true;
    return;
  }
  if (String(data[0][0] || '') !== HEADERS[0]) {
    await updateRange(MESSAGES_SHEET, 'A1', [HEADERS]);
  }
  messagesReady = true;
}

async function loadActiveMessages() {
  await ensureMessagesSheet();
  const data = await getSheetRows(MESSAGES_SHEET);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const msg = rowToMessage(data[i]);
    if (msg) out.push(Object.assign({}, msg, { rowIndex: i + 1 }));
  }
  return out;
}

async function appendMessage(fields) {
  const row = [
    newMessageId(),
    isoNow(),
    String(fields.classId),
    String(fields.studentId),
    String(fields.studentName || ''),
    fields.sender,
    fields.body,
    '',
    ''
  ];
  await appendRows(MESSAGES_SHEET, [row]);
  return rowToMessage(row);
}

async function lookupStudentName(studentId, classId) {
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(studentId)) continue;
    if (classId && String(data[i][2]) !== String(classId)) continue;
    return String(data[i][1] || '');
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
  return String(classId);
}

async function getThread(classId, studentId, limit) {
  const max = Math.min(Number(limit) || 50, 100);
  const msgs = await loadActiveMessages();
  const thread = msgs.filter(function(m) {
    return m.classId === String(classId) && m.studentId === String(studentId);
  });
  thread.sort(function(a, b) { return a.createdAt.localeCompare(b.createdAt); });
  const slice = thread.length > max ? thread.slice(-max) : thread;
  return slice.map(function(m) {
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
  const msgs = await loadActiveMessages();
  const now = isoNow();
  const updates = [];
  msgs.forEach(function(m) {
    if (m.classId !== String(classId)) return;
    if (m.studentId !== String(studentId)) return;
    if (m.sender !== targetSender) return;
    if (m.read) return;
    updates.push({
      sheetName: MESSAGES_SHEET,
      a1: 'H' + m.rowIndex,
      values: [[now]]
    });
  });
  if (!updates.length) return 0;
  await batchUpdateRanges(updates);
  return updates.length;
}

async function getStudentUnreadCount(studentId, classId) {
  const msgs = await loadActiveMessages();
  return msgs.filter(function(m) {
    return m.classId === String(classId) &&
      m.studentId === String(studentId) &&
      m.sender === 'teacher' &&
      !m.read;
  }).length;
}

async function getClassNameMap() {
  const data = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    if (id) map[id] = String(data[i][1] || id);
  }
  return map;
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
  const msgs = await loadActiveMessages();
  return buildInboxEntries(msgs, classId);
}

async function getGlobalInbox() {
  const msgs = await loadActiveMessages();
  const entries = buildInboxEntries(msgs, '');
  const classNames = await getClassNameMap();
  return entries.map(function(row) {
    return Object.assign({}, row, {
      className: classNames[row.classId] || row.classId
    });
  });
}

async function getUnreadTotalForClass(classId) {
  const inbox = await getInboxForClass(classId);
  return inbox.reduce(function(sum, row) { return sum + (row.unreadCount || 0); }, 0);
}

async function getUnreadTotalGlobal() {
  const inbox = await getGlobalInbox();
  return inbox.reduce(function(sum, row) { return sum + (row.unreadCount || 0); }, 0);
}

async function mirrorSheetMessageToSupabase(msg) {
  if (!msg || !msg.messageId) return { ok: false, skipped: true };
  const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
  if (!isSupabaseEnabled()) return { ok: false, skipped: true };
  const db = getSupabase();
  const { error } = await db.from('messages').upsert({
    id: msg.messageId,
    created_at: msg.createdAt || isoNow(),
    class_id: String(msg.classId || ''),
    student_id: String(msg.studentId || ''),
    student_name: String(msg.studentName || ''),
    sender: String(msg.sender || ''),
    body: String(msg.body || ''),
    read_at: msg.readAt || null,
    deleted_at: null
  }, { onConflict: 'id' });
  if (error) {
    throw new Error('mirror sheet→supabase failed: ' + (error.message || error));
  }
  return { ok: true, messageId: msg.messageId };
}

/**
 * Copy recent Student_Messages rows into Supabase so teacher UI never misses
 * Telegram-notified messages that only landed on Sheets.
 */
async function reconcileSheetMessagesToSupabase(options) {
  const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
  if (!isSupabaseEnabled()) return { ok: false, skipped: true, upserted: 0 };
  const hours = Math.max(1, Number(options && options.hours) || 72);
  const cutoff = Date.now() - hours * 3600 * 1000;
  let sheetMsgs = [];
  try {
    sheetMsgs = await loadActiveMessages();
  } catch (err) {
    console.warn('[messages] reconcile: could not read Sheets', err.message || err);
    return { ok: false, skipped: false, upserted: 0, error: err.message || String(err) };
  }
  const recent = sheetMsgs.filter(function(m) {
    const t = Date.parse(m.createdAt || '');
    return !isNaN(t) && t >= cutoff;
  });
  if (!recent.length) return { ok: true, upserted: 0, checked: 0 };

  const db = getSupabase();
  const ids = recent.map(function(m) { return m.messageId; });
  const { data: existing, error: existErr } = await db
    .from('messages')
    .select('id')
    .in('id', ids);
  if (existErr) {
    throw new Error('reconcile lookup failed: ' + (existErr.message || existErr));
  }
  const have = {};
  (existing || []).forEach(function(r) { have[String(r.id)] = true; });
  const missing = recent.filter(function(m) { return !have[m.messageId]; });
  let upserted = 0;
  for (let i = 0; i < missing.length; i++) {
    await mirrorSheetMessageToSupabase(missing[i]);
    upserted += 1;
  }
  if (upserted > 0) {
    console.warn('[messages] reconcile backfilled ' + upserted + ' Sheets-only message(s) into Supabase');
  }
  return { ok: true, checked: recent.length, missing: missing.length, upserted: upserted };
}

async function studentSendMessage(studentId, classId, studentName, body) {
  // Hard redirect: teacher UI reads Supabase. Never Telegram from Sheets-only writes.
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    console.error('[messages] Sheets studentSendMessage hit while Supabase enabled — redirecting to Supabase');
    return require('./supabaseMessageService').studentSendMessage(studentId, classId, studentName, body);
  }

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
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    console.error('[messages] Sheets teacherSendMessage hit while Supabase enabled — redirecting to Supabase');
    return require('./supabaseMessageService').teacherSendMessage(classId, studentId, studentName, body);
  }

  body = normalizeBody(body);
  const name = studentName || await lookupStudentName(studentId, classId);
  const msg = await appendMessage({
    classId: classId,
    studentId: studentId,
    studentName: name,
    sender: 'teacher',
    body: body
  });
  return msg;
}

/** Soft-delete entire thread on Sheets (DeletedAt). Supabase path hard-deletes. */
async function deleteThread(classId, studentId) {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    return require('./supabaseMessageService').deleteThread(classId, studentId);
  }

  const cid = String(classId || '').trim();
  const sid = String(studentId || '').trim();
  if (!cid || !sid) throw new Error('classId and studentId are required.');
  await ensureMessagesSheet();
  const data = await getSheetRows(MESSAGES_SHEET);
  const now = isoNow();
  const updates = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.classId] || '') !== cid) continue;
    if (String(data[i][COL.studentId] || '') !== sid) continue;
    if (String(data[i][COL.deleted] || '').trim()) continue;
    updates.push({
      sheetName: MESSAGES_SHEET,
      a1: 'I' + (i + 1),
      values: [[now]]
    });
  }
  if (updates.length) {
    await batchUpdateRanges(updates);
    invalidateSheetRowsCache(MESSAGES_SHEET);
  }
  return { ok: true, deleted: updates.length };
}

let sheetApiWarned = false;
let cachedSheetApi = null;

function sheetMessageApi() {
  if (!sheetApiWarned) {
    sheetApiWarned = true;
    console.warn('[messages] Supabase disabled — using Google Sheets Student_Messages (legacy)');
  }
  if (!cachedSheetApi) {
    cachedSheetApi = {
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
      teacherSendMessage,
      deleteThread
    };
  }
  return cachedSheetApi;
}

/** Resolve at call-time so a boot race / missing env cannot permanently stick to Sheets. */
function getMessageApi() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return require('./supabaseMessageService');
  return sheetMessageApi();
}

module.exports = {
  ensureMessagesSheet: function() { return getMessageApi().ensureMessagesSheet(); },
  getClassLabel: function(classId) { return getMessageApi().getClassLabel(classId); },
  getThread: function(classId, studentId, limit) {
    return getMessageApi().getThread(classId, studentId, limit);
  },
  markMessagesRead: function(classId, studentId, reader) {
    return getMessageApi().markMessagesRead(classId, studentId, reader);
  },
  getStudentUnreadCount: function(studentId, classId) {
    return getMessageApi().getStudentUnreadCount(studentId, classId);
  },
  getInboxForClass: function(classId) { return getMessageApi().getInboxForClass(classId); },
  getGlobalInbox: function() { return getMessageApi().getGlobalInbox(); },
  getUnreadTotalForClass: function(classId) {
    return getMessageApi().getUnreadTotalForClass(classId);
  },
  getUnreadTotalGlobal: function() { return getMessageApi().getUnreadTotalGlobal(); },
  studentSendMessage: function(studentId, classId, studentName, body) {
    return getMessageApi().studentSendMessage(studentId, classId, studentName, body);
  },
  teacherSendMessage: function(classId, studentId, studentName, body) {
    return getMessageApi().teacherSendMessage(classId, studentId, studentName, body);
  },
  deleteThread: function(classId, studentId) {
    return getMessageApi().deleteThread(classId, studentId);
  },
  reconcileSheetMessagesToSupabase: reconcileSheetMessagesToSupabase,
  mirrorSheetMessageToSupabase: mirrorSheetMessageToSupabase
};
