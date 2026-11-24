'use strict';

/**
 * Salty — English / grammar tutor for content-only classes.
 * Claude replies in Salty's warm teacher voice; STT/TTS reuse Oral Debrief.
 * Conversations are stored in Postgres for teachers to review.
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table } = require('../db/pool');
const { isClaudeConfigured, askGemini } = require('./geminiService');
const { portalForClass } = require('./contentPortalService');
const { getClassRoster } = require('./teacherPortalService');

const DAILY_LIMIT = 40;
const MAX_PROMPT = 800;
const MAX_REPLY = 700;
const MAX_HISTORY = 40;
const CONTEXT_TURNS = 12;

const WELCOME_KO =
  '영어나 문법 모르는 게 있으면 솔티한테 다 물어봐! ' +
  'Ask me anything about English or grammar — type or tap the mic.';

const SYSTEM =
  'You are Salty, a warm middle-school English teacher character at Salt Morning Academy. ' +
  'Students ask you about English, especially grammar (also vocabulary and natural expressions). ' +
  'Be friendly, clear, and encouraging. Never say you are an AI, bot, or language model — you are Salty. ' +
  'If the student writes in Korean, answer in Korean and keep English examples short. ' +
  'If the student writes in English, answer in simple English (you may add a brief Korean gloss when helpful). ' +
  'Give a direct explanation with 1–2 short examples. Do not write a full homework essay or complete assignment for them — guide and hint instead. ' +
  'Keep each reply under 5 short sentences so it can be read aloud. No bullet walls, no markdown headings.';

const usage = new Map();

function newId() {
  return 'stm_' + crypto.randomBytes(6).toString('hex');
}

function httpError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function usageKey(studentId) {
  return String(studentId) + ':' + todaySeoul();
}

function claudeModel() {
  return String(
    process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

function getStatus(studentId) {
  const used = usage.get(usageKey(studentId)) || 0;
  return {
    configured: isClaudeConfigured() && isOpsDbEnabled(),
    dailyLimit: DAILY_LIMIT,
    usedToday: used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    stt: true,
    tts: true,
    welcome: WELCOME_KO
  };
}

function bumpUsage(studentId) {
  const key = usageKey(studentId);
  usage.set(key, (usage.get(key) || 0) + 1);
}

async function assertContentStudent(classId) {
  const portal = await portalForClass(classId);
  if (!portal.isContent) {
    throw httpError(403, 'Salty is only available in content classes.');
  }
  return portal;
}

function rowToMessage(r) {
  return {
    id: r.id,
    classId: r.class_id,
    studentId: r.student_id,
    role: r.role === 'assistant' ? 'salty' : r.role,
    text: r.body,
    source: r.source || 'text',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null
  };
}

async function listMessages(classId, studentId, opts) {
  opts = opts || {};
  if (!isOpsDbEnabled()) return [];
  const limit = Math.min(Number(opts.limit) || MAX_HISTORY, 200);
  const r = await query(
    'SELECT id, class_id, student_id, role, body, source, created_at FROM ' + table('salty_tutor_messages') +
      ' WHERE class_id = $1 AND student_id = $2 ORDER BY created_at ASC LIMIT $3',
    [String(classId), String(studentId), limit]
  );
  return r.rows.map(rowToMessage);
}

async function appendMessage(classId, studentId, role, body, source) {
  if (!isOpsDbEnabled()) throw httpError(503, 'Database is not configured.');
  const id = newId();
  const text = String(body || '').trim().slice(0, 4000);
  if (!text) throw httpError(400, 'Empty message.');
  await query(
    'INSERT INTO ' + table('salty_tutor_messages') +
      ' (id, class_id, student_id, role, body, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
    [id, String(classId), String(studentId), role, text, source || 'text']
  );
  return {
    id,
    classId: String(classId),
    studentId: String(studentId),
    role,
    text,
    source: source || 'text',
    createdAt: Date.now()
  };
}

async function ensureWelcome(classId, studentId) {
  const existing = await listMessages(classId, studentId, { limit: 1 });
  if (existing.length) return existing;
  const welcome = await appendMessage(classId, studentId, 'salty', WELCOME_KO, 'welcome');
  return [welcome];
}

async function getHistoryForStudent(studentId, classId) {
  await assertContentStudent(classId);
  const messages = await ensureWelcome(classId, studentId);
  return { messages, status: getStatus(studentId) };
}

async function askSalty(studentId, classId, message, opts) {
  opts = opts || {};
  message = String(message || '').trim();
  if (!message) throw httpError(400, 'Type a message or speak first.');
  if (message.length > MAX_PROMPT) throw httpError(400, 'Message is too long.');

  await assertContentStudent(classId);
  if (!isOpsDbEnabled()) throw httpError(503, 'Database is not configured.');
  if (!isClaudeConfigured()) throw httpError(503, 'Salty is not available right now.');

  const status0 = getStatus(studentId);
  if (status0.remaining <= 0) {
    throw httpError(429, 'Daily limit reached. Try again tomorrow.');
  }

  await ensureWelcome(classId, studentId);
  const history = await listMessages(classId, studentId);
  const recent = history.slice(-CONTEXT_TURNS);

  const transcript = recent
    .map((h) => (h.role === 'salty' ? 'Salty' : 'Student') + ': ' + h.text)
    .join('\n');
  const prompt =
    (transcript ? transcript + '\n' : '') +
    'Student: ' + message + '\n' +
    'Salty:';

  const result = await askGemini(prompt, {
    provider: 'claude',
    noGeminiFallback: true,
    systemInstruction: SYSTEM,
    temperature: 0.45,
    maxOutputTokens: 700,
    model: claudeModel()
  });
  let reply = String((result && (result.answer || result.text)) || result || '').trim();
  reply = reply.replace(/^Salty:\s*/i, '').trim();
  if (!reply) throw httpError(502, 'Salty had nothing to say. Try again.');
  if (reply.length > MAX_REPLY) reply = reply.slice(0, MAX_REPLY - 1).trim() + '…';

  const source = opts.source === 'voice' ? 'voice' : 'text';
  const userMsg = await appendMessage(classId, studentId, 'student', message, source);
  const saltyMsg = await appendMessage(classId, studentId, 'salty', reply, 'text');
  bumpUsage(studentId);

  return {
    reply,
    message: userMsg,
    salty: saltyMsg,
    status: getStatus(studentId)
  };
}

async function listForClass(classId) {
  classId = String(classId || '');
  await assertContentStudent(classId);
  const roster = await getClassRoster(classId);
  if (!isOpsDbEnabled()) {
    return {
      students: roster.map((s) => ({
        studentId: s.studentId,
        name: s.name,
        messageCount: 0,
        studentTurns: 0,
        lastAt: null,
        lastPreview: ''
      }))
    };
  }

  const r = await query(
    'SELECT student_id, ' +
      'COUNT(*)::int AS message_count, ' +
      "COUNT(*) FILTER (WHERE role = 'student')::int AS student_turns, " +
      'MAX(created_at) AS last_at ' +
      'FROM ' + table('salty_tutor_messages') +
      ' WHERE class_id = $1 GROUP BY student_id',
    [classId]
  );
  const byId = new Map(r.rows.map((row) => [String(row.student_id), row]));

  const lastBodies = await query(
    'SELECT DISTINCT ON (student_id) student_id, body, created_at FROM ' + table('salty_tutor_messages') +
      ' WHERE class_id = $1 ORDER BY student_id, created_at DESC',
    [classId]
  );
  const previewById = new Map(
    lastBodies.rows.map((row) => [String(row.student_id), String(row.body || '').slice(0, 120)])
  );

  const students = roster.map((s) => {
    const sid = String(s.studentId || s.id || '');
    const row = byId.get(sid);
    return {
      studentId: sid,
      name: s.name || sid,
      messageCount: row ? Number(row.message_count) || 0 : 0,
      studentTurns: row ? Number(row.student_turns) || 0 : 0,
      lastAt: row && row.last_at ? new Date(row.last_at).getTime() : null,
      lastPreview: previewById.get(sid) || ''
    };
  });
  students.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0) || String(a.name).localeCompare(String(b.name)));
  return { students };
}

async function historyForTeacher(classId, studentId) {
  await assertContentStudent(classId);
  const roster = await getClassRoster(classId);
  const st = roster.find((s) => String(s.studentId || s.id) === String(studentId));
  if (!st) throw httpError(404, 'Student not in this class.');
  const messages = await listMessages(classId, studentId, { limit: 200 });
  return {
    studentId: String(studentId),
    name: st.name || studentId,
    messages,
    status: getStatus(studentId)
  };
}

module.exports = {
  WELCOME_KO,
  getStatus,
  getHistoryForStudent,
  askSalty,
  listForClass,
  historyForTeacher,
  ensureWelcome,
  MAX_PROMPT
};
