const { isGeminiConfigured, askGemini } = require('./geminiService');

const DAILY_LIMIT = 50;
const MAX_PROMPT = 800;
const usage = new Map();

function usageKey(studentId) {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  return studentId + ':' + day;
}

function getBuddyStatus(studentId) {
  const key = usageKey(studentId);
  const used = usage.get(key) || 0;
  return {
    configured: isGeminiConfigured(),
    dailyLimit: DAILY_LIMIT,
    usedToday: used,
    remaining: Math.max(0, DAILY_LIMIT - used)
  };
}

const SYSTEM =
  'You are AI English Buddy for SALT Academy Morning Class students. ' +
  'Use simple, encouraging English. Help with vocabulary and essay structure. ' +
  'Never write full essays for the student — only hints and short examples. ' +
  'Keep replies under 5 short sentences.';

async function askEnglishBuddy(studentId, message, history) {
  if (!isGeminiConfigured()) {
    throw new Error('AI English Buddy is not available right now.');
  }
  const key = usageKey(studentId);
  const used = usage.get(key) || 0;
  if (used >= DAILY_LIMIT) {
    throw new Error('Daily limit reached. Try again tomorrow.');
  }

  message = String(message || '').trim();
  if (!message) throw new Error('Type a message first.');
  if (message.length > MAX_PROMPT) throw new Error('Message is too long.');

  let prompt = message;
  if (Array.isArray(history) && history.length) {
    const recent = history.slice(-4);
    prompt = recent.map((h) => `${h.role}: ${h.text}`).join('\n') + '\nstudent: ' + message;
  }

  const reply = await askGemini(prompt, {
    systemInstruction: SYSTEM,
    model: 'gemini-2.5-flash-lite'
  });
  usage.set(key, used + 1);
  return { reply, status: getBuddyStatus(studentId) };
}

module.exports = { getBuddyStatus, askEnglishBuddy };
