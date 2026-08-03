const crypto = require('crypto');
const { isGeminiConfigured, askGemini } = require('./geminiService');
const { getSheetRows, appendRows, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const HISTORY_SHEET = 'English_Buddy_History';
const FLAGS_SHEET = 'English_Buddy_Flags';
const HISTORY_HEADERS = ['MessageID', 'CreatedAt', 'ClassID', 'StudentID', 'Role', 'Body'];
const FLAG_HEADERS = ['FlagID', 'CreatedAt', 'ClassID', 'StudentID', 'Type', 'Detail', 'Resolved'];

const DAILY_LIMIT = 50;
const MAX_PROMPT = 800;
const MAX_HISTORY = 40;
const STRIKE_LIMIT = 3;
const HISTORY_DAYS = 14;

const usage = new Map();
const strikes = new Map();
const locks = new Map();

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function usageKey(studentId) {
  return String(studentId) + ':' + todaySeoul();
}

function strikeKey(studentId) {
  return 'strike:' + usageKey(studentId);
}

function lockKey(studentId) {
  return 'lock:' + usageKey(studentId);
}

async function ensureBuddySheets() {
  await ensureSheet(HISTORY_SHEET, HISTORY_HEADERS);
  await ensureSheet(FLAGS_SHEET, FLAG_HEADERS);
}

function getBuddyStatus(studentId) {
  const key = usageKey(studentId);
  const used = usage.get(key) || 0;
  const strikeCount = strikes.get(strikeKey(studentId)) || 0;
  const locked = !!locks.get(lockKey(studentId)) || strikeCount >= STRIKE_LIMIT;
  return {
    configured: isGeminiConfigured(),
    dailyLimit: DAILY_LIMIT,
    usedToday: used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    abuseLocked: locked,
    abuseStrikes: strikeCount,
    abuseStrikeLimit: STRIKE_LIMIT
  };
}

function inspectMessage(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  const flags = [];
  if (/ignore (all |previous )?instructions|system prompt|jailbreak/i.test(t)) {
    flags.push('injection');
  }
  if (/\b(fuck|shit|bitch|asshole|cunt)\b/i.test(lower)) {
    flags.push('profanity');
  }
  if (t.length >= 12 && !/[aeiouAEIOU가-힣]/.test(t) && /[a-zA-Z]{8,}/.test(t)) {
    flags.push('gibberish');
  }
  if ((t.match(/(.)\1{6,}/) || []).length) {
    flags.push('spam');
  }
  return flags;
}

async function flagAbuse(studentId, classId, types, detail) {
  await ensureBuddySheets();
  const type = (types || []).join(',') || 'abuse';
  await appendRows(FLAGS_SHEET, [[
    'flag_' + crypto.randomBytes(5).toString('hex'),
    new Date().toISOString(),
    String(classId || ''),
    String(studentId || ''),
    type,
    String(detail || '').slice(0, 200),
    'FALSE'
  ]]);
  invalidateSheetRowsCache(FLAGS_SHEET);

  const sk = strikeKey(studentId);
  const next = (strikes.get(sk) || 0) + 1;
  strikes.set(sk, next);
  if (next >= STRIKE_LIMIT) locks.set(lockKey(studentId), true);
  return next;
}

async function unlockBuddy(studentId) {
  locks.delete(lockKey(studentId));
  strikes.set(strikeKey(studentId), 0);
  return getBuddyStatus(studentId);
}

async function refillBuddyUsage(studentId) {
  usage.set(usageKey(studentId), 0);
  return getBuddyStatus(studentId);
}

async function appendHistory(studentId, classId, role, body) {
  await ensureBuddySheets();
  const id = 'buddy_' + crypto.randomBytes(6).toString('hex');
  const at = new Date().toISOString();
  await appendRows(HISTORY_SHEET, [[
    id, at, String(classId || ''), String(studentId || ''), role, String(body || '').slice(0, 4000)
  ]]);
  invalidateSheetRowsCache(HISTORY_SHEET);
  return { id, createdAt: at, classId, studentId, role, text: body };
}

async function getBuddyChatHistory(studentId, classId) {
  await ensureBuddySheets();
  const sid = String(studentId);
  const cid = String(classId || '');
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - HISTORY_DAYS);
  const since = cutoff.toISOString();
  const rows = await getSheetRows(HISTORY_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][3]) !== sid) continue;
    if (cid && String(rows[i][2]) !== cid) continue;
    const createdAt = String(rows[i][1] || '');
    if (createdAt && createdAt < since) continue;
    const role = String(rows[i][4] || '');
    const text = String(rows[i][5] || '');
    if ((role !== 'user' && role !== 'assistant' && role !== 'buddy') || !text) continue;
    out.push({
      id: String(rows[i][0] || ''),
      createdAt,
      classId: String(rows[i][2] || ''),
      studentId: sid,
      role: role === 'assistant' ? 'buddy' : role,
      text
    });
  }
  out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return out.slice(-MAX_HISTORY);
}

const SYSTEM =
  'You are English Buddy for SALT Academy Morning Class students. ' +
  'Use simple, encouraging English. Help with vocabulary and essay structure. ' +
  'Never write full essays for the student — only hints and short examples. ' +
  'Keep replies under 5 short sentences. If the student is rude, stay calm and redirect.';

async function askEnglishBuddy(studentId, classId, message, history) {
  message = String(message || '').trim();
  if (!message) throw new Error('Type a message first.');
  if (message.length > MAX_PROMPT) throw new Error('Message is too long.');

  const status0 = getBuddyStatus(studentId);
  if (status0.abuseLocked) {
    throw new Error('English Buddy is locked for today. Ask your teacher to unlock.');
  }

  const abuseTypes = inspectMessage(message);
  if (abuseTypes.length) {
    const strikeCount = await flagAbuse(studentId, classId, abuseTypes, message);
    const canned = strikeCount >= STRIKE_LIMIT
      ? 'English Buddy is locked for today because of repeated misuse. Ask your teacher to unlock.'
      : 'Please keep messages respectful and on-topic. Warning ' + strikeCount + '/' + STRIKE_LIMIT + '.';
    await appendHistory(studentId, classId, 'user', message);
    await appendHistory(studentId, classId, 'assistant', canned);
    return {
      reply: canned,
      abuseBlocked: true,
      status: getBuddyStatus(studentId)
    };
  }

  if (!isGeminiConfigured()) {
    throw new Error('English Buddy is not available right now.');
  }
  if (status0.remaining <= 0) {
    throw new Error('Daily limit reached. Try again tomorrow.');
  }

  let prompt = message;
  const hist = Array.isArray(history) && history.length
    ? history
    : await getBuddyChatHistory(studentId, classId);
  const recent = hist.slice(-6).map((h) => ({
    role: h.role === 'buddy' || h.role === 'assistant' ? 'buddy' : 'student',
    text: h.text
  }));
  if (recent.length) {
    prompt = recent.map((h) => h.role + ': ' + h.text).join('\n') + '\nstudent: ' + message;
  }

  const reply = await askGemini(prompt, {
    systemInstruction: SYSTEM,
    model: 'gemini-2.5-flash-lite'
  });

  usage.set(usageKey(studentId), (usage.get(usageKey(studentId)) || 0) + 1);
  await appendHistory(studentId, classId, 'user', message);
  await appendHistory(studentId, classId, 'assistant', String(reply.answer || reply.text || reply));

  return { reply: String(reply.answer || reply.text || reply), status: getBuddyStatus(studentId) };
}

async function listBuddyMonitorForClass(classId) {
  await ensureBuddySheets();
  classId = String(classId || '');
  const roster = await getClassRoster(classId);
  const students = roster.map((s) => {
    const status = getBuddyStatus(s.studentId);
    return {
      studentId: s.studentId,
      name: s.name,
      used: status.usedToday,
      remaining: status.remaining,
      limit: status.dailyLimit,
      locked: status.abuseLocked,
      strikes: status.abuseStrikes
    };
  });

  const flags = await getSheetRows(FLAGS_SHEET);
  const openFlags = [];
  for (let i = 1; i < flags.length; i++) {
    if (String(flags[i][2]) !== classId) continue;
    if (String(flags[i][6] || '').toUpperCase() === 'TRUE') continue;
    openFlags.push({
      flagId: String(flags[i][0] || ''),
      at: String(flags[i][1] || ''),
      studentId: String(flags[i][3] || ''),
      type: String(flags[i][4] || ''),
      detail: String(flags[i][5] || '')
    });
  }
  openFlags.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return { students, flags: openFlags.slice(0, 40), dateKey: todaySeoul() };
}

async function getRecentBuddyActivity(limit) {
  await ensureBuddySheets();
  const rows = await getSheetRows(HISTORY_SHEET);
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][4]) !== 'user') continue;
    items.push({
      at: String(rows[i][1] || ''),
      classId: String(rows[i][2] || ''),
      studentId: String(rows[i][3] || ''),
      summary: String(rows[i][5] || '').slice(0, 80)
    });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items.slice(0, limit || 50);
}

module.exports = {
  HISTORY_SHEET,
  FLAGS_SHEET,
  ensureBuddySheets,
  getBuddyStatus,
  askEnglishBuddy,
  getBuddyChatHistory,
  listBuddyMonitorForClass,
  unlockBuddy,
  refillBuddyUsage,
  getRecentBuddyActivity
};
