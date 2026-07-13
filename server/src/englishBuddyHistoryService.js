const crypto = require('crypto');
const { ENGLISH_BUDDY_HISTORY_SHEET, ENGLISH_BUDDY_HISTORY_DAYS, ENGLISH_BUDDY_HISTORY_MAX } = require('./config');
const { getSheetRows, appendRows, deleteRow, invalidateSheetRowsCache } = require('./sheets');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

const MAX_BODY_LEN = 4000;

function isoNow() {
  return new Date().toISOString();
}

function newBuddyMessageId() {
  return 'buddy_' + crypto.randomBytes(8).toString('hex');
}

function cutoffIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (Number(days) || ENGLISH_BUDDY_HISTORY_DAYS));
  return d.toISOString();
}

function normalizeBody(text) {
  const body = String(text || '').trim();
  if (!body) return '';
  return body.length > MAX_BODY_LEN ? body.slice(0, MAX_BODY_LEN) : body;
}

function rowToBuddyMessage(row) {
  if (!row) return null;
  const role = String(row.role || row[4] || '').trim();
  const body = String(row.body != null ? row.body : row[5] || '').trim();
  if (role !== 'user' && role !== 'assistant') return null;
  if (!body) return null;
  return {
    id: String(row.id || row[0] || ''),
    createdAt: String(row.created_at || row[1] || ''),
    classId: String(row.class_id || row[2] || ''),
    studentId: String(row.student_id || row[3] || ''),
    role: role,
    text: body
  };
}

async function readBuddyHistoryFromSheet(studentId, classId) {
  const sid = String(studentId);
  const cid = String(classId || '');
  const since = cutoffIso(ENGLISH_BUDDY_HISTORY_DAYS);
  const data = await getSheetRows(ENGLISH_BUDDY_HISTORY_SHEET);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[3]) !== sid) continue;
    if (cid && String(row[2]) !== cid) continue;
    const createdAt = String(row[1] || '');
    if (createdAt && createdAt < since) continue;
    const msg = rowToBuddyMessage({
      id: row[0],
      created_at: row[1],
      class_id: row[2],
      student_id: row[3],
      role: row[4],
      body: row[5]
    });
    if (msg) out.push(msg);
  }
  out.sort(function(a, b) {
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
  if (out.length > ENGLISH_BUDDY_HISTORY_MAX) {
    return out.slice(out.length - ENGLISH_BUDDY_HISTORY_MAX);
  }
  return out;
}

async function pruneBuddyHistorySheet(studentId) {
  const sid = String(studentId);
  const since = cutoffIso(ENGLISH_BUDDY_HISTORY_DAYS);
  const data = await getSheetRows(ENGLISH_BUDDY_HISTORY_SHEET);
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (String(row[3]) !== sid) continue;
    const createdAt = String(row[1] || '');
    if (createdAt && createdAt < since) {
      await deleteRow(ENGLISH_BUDDY_HISTORY_SHEET, i + 1);
    }
  }
  invalidateSheetRowsCache(ENGLISH_BUDDY_HISTORY_SHEET);
}

async function appendBuddyHistorySheet(studentId, classId, role, body) {
  body = normalizeBody(body);
  if (!body) return null;
  const row = [
    newBuddyMessageId(),
    isoNow(),
    String(classId || ''),
    String(studentId),
    role,
    body
  ];
  await appendRows(ENGLISH_BUDDY_HISTORY_SHEET, [row]);
  invalidateSheetRowsCache(ENGLISH_BUDDY_HISTORY_SHEET);
  return rowToBuddyMessage({
    id: row[0],
    created_at: row[1],
    class_id: row[2],
    student_id: row[3],
    role: row[4],
    body: row[5]
  });
}

async function pruneBuddyHistorySupabase(studentId) {
  const db = getSupabase();
  const { error } = await db.from('english_buddy_messages')
    .delete()
    .eq('student_id', String(studentId))
    .lt('created_at', cutoffIso(ENGLISH_BUDDY_HISTORY_DAYS));
  if (error) throw new Error(error.message);
}

async function getBuddyChatHistory(studentId, classId) {
  studentId = String(studentId);
  classId = String(classId || '');

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('english_buddy_messages')
      .select('id, class_id, student_id, role, body, created_at')
      .eq('student_id', studentId)
      .gte('created_at', cutoffIso(ENGLISH_BUDDY_HISTORY_DAYS))
      .order('created_at', { ascending: true })
      .limit(ENGLISH_BUDDY_HISTORY_MAX);
    if (error) throw new Error(error.message);
    pruneBuddyHistorySupabase(studentId).catch(function(err) {
      console.error('prune english_buddy_messages', err.message || err);
    });
    const messages = (data || []).map(function(row) {
      return rowToBuddyMessage(row);
    }).filter(Boolean);
    return {
      retentionDays: ENGLISH_BUDDY_HISTORY_DAYS,
      messages: messages
    };
  }

  await pruneBuddyHistorySheet(studentId).catch(function(err) {
    console.error('prune English_Buddy_History sheet', err.message || err);
  });
  return {
    retentionDays: ENGLISH_BUDDY_HISTORY_DAYS,
    messages: await readBuddyHistoryFromSheet(studentId, classId)
  };
}

async function appendBuddyMessage(studentId, classId, role, body) {
  studentId = String(studentId);
  classId = String(classId || '');
  body = normalizeBody(body);
  if (!body) return null;
  if (role !== 'user' && role !== 'assistant') return null;

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const row = {
      id: newBuddyMessageId(),
      class_id: classId,
      student_id: studentId,
      role: role,
      body: body,
      created_at: isoNow()
    };
    const { data, error } = await db.from('english_buddy_messages')
      .insert(row)
      .select('id, class_id, student_id, role, body, created_at')
      .single();
    if (error) throw new Error(error.message);
    pruneBuddyHistorySupabase(studentId).catch(function(err) {
      console.error('prune english_buddy_messages', err.message || err);
    });
    return rowToBuddyMessage(data);
  }

  return appendBuddyHistorySheet(studentId, classId, role, body);
}

async function recordBuddyExchange(studentId, classId, userText, assistantText) {
  const userMsg = normalizeBody(userText);
  const assistantMsg = normalizeBody(assistantText);
  if (!userMsg || !assistantMsg) return;
  await appendBuddyMessage(studentId, classId, 'user', userMsg);
  await appendBuddyMessage(studentId, classId, 'assistant', assistantMsg);
}

module.exports = {
  getBuddyChatHistory,
  recordBuddyExchange,
  ENGLISH_BUDDY_HISTORY_DAYS
};
