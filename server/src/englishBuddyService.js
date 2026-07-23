const { cacheGet, cacheSet, cacheDelete } = require('./cache');
const { isGeminiConfigured, askGemini, streamAskGemini, formatGeminiClientError } = require('./geminiService');
const { recordBuddyExchange } = require('./englishBuddyHistoryService');
const { getEnrolledStudents } = require('./homeworkService');
const { isSupabaseEnabled } = require('./supabaseClient');

const DAILY_LIMIT = 100;
const MAX_PROMPT = 800;
const BUDDY_VOCAB_MODEL = process.env.ENGLISH_BUDDY_MODEL || 'gemini-2.5-flash-lite';
const BUDDY_ESSAY_MODEL = process.env.ENGLISH_BUDDY_ESSAY_MODEL || 'gemini-2.5-flash';
const BUDDY_HISTORY_MAX = 5;
const BUDDY_ESSAY_HISTORY_MAX = 50;
const BUDDY_TIMEOUT_MS = 45000;
const TEACHER_BUDDY_ID = 'TEACHER';
const TEACHER_BUDDY_CLASS = 'TEACHER';

function pickBuddyModel(text, history) {
  return isEssaySession(text, history) ? BUDDY_ESSAY_MODEL : BUDDY_VOCAB_MODEL;
}

function buddyGeminiOptions(model, text, history, studentFirstName) {
  const essaySession = isEssaySession(text, history);
  return {
    systemInstruction: buildBuddySystemInstruction(studentFirstName),
    model: model,
    thinkingBudget: 0,
    maxOutputTokens: 280,
    temperature: 0.4,
    timeoutMs: BUDDY_TIMEOUT_MS,
    skipQuotaSleep: true,
    skipGeminiQueue: true,
    overloadRetries: 1,
    overloadRetryDelayMs: 2000,
    audience: 'student',
    fallbackModels: essaySession
      ? ['gemini-2.5-flash-lite']
      : ['gemini-2.5-flash']
  };
}

function teacherBuddyGeminiOptions(model, text, history) {
  return {
    systemInstruction: buildTeacherBuddySystemInstruction(),
    model: model,
    thinkingBudget: 0,
    maxOutputTokens: 420,
    temperature: 0.4,
    timeoutMs: BUDDY_TIMEOUT_MS,
    skipQuotaSleep: true,
    skipGeminiQueue: true,
    overloadRetries: 1,
    overloadRetryDelayMs: 2000,
    audience: 'teacher',
    fallbackModels: isEssaySession(text, history)
      ? ['gemini-2.5-flash-lite']
      : ['gemini-2.5-flash']
  };
}

function formatBuddyGeminiError(errorMsg) {
  return formatGeminiClientError(errorMsg, { audience: 'student' });
}

function preferredFirstName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const latin = parts.filter(function(t) { return /^[A-Za-z]/.test(t); });
  // "Bella Kim" → Bella; "호윤혁 Ethan" / "김벨라 Bella" → Ethan / Bella
  if (latin.length) return latin[0];
  return parts[0];
}

async function resolveStudentFirstName(studentId, classId) {
  try {
    let full = '';
    if (isSupabaseEnabled()) {
      const { lookupStudentName } = require('./supabaseStudentService');
      full = await lookupStudentName(studentId, classId);
    }
    if (!full) {
      const { lookupStudentName } = require('./messageService');
      full = await lookupStudentName(studentId, classId);
    }
    return preferredFirstName(full);
  } catch (err) {
    console.error('resolveStudentFirstName', err.message || err);
    return '';
  }
}

const ENGLISH_BUDDY_SYSTEM =
  'You are Virtual Mr. Park — the same Mr. Park who teaches these students at SALT Academy. ' +
  'Speak as their real classroom teacher: warm, encouraging, clear, and a little playful. ' +
  'You are NOT an "AI tutor", chatbot, or generic English Buddy. Never say you are an AI, a bot, or a virtual assistant. ' +
  'If asked, you are Mr. Park (helping them with writing right now).\n\n' +
  'Tone:\n' +
  '- Talk like a caring teacher ("Hmm, Bella…", "Nice try!", "Let\'s fix this together."). ' +
  '- Use the student\'s first name naturally: greet with it on the first reply, and weave it into later replies sometimes (not every single sentence).\n' +
  '- Keep English simple for ESL students (Grade 3–6 / middle school).\n\n' +
  'While your default framework is the SALT Academy 5-Paragraph Essay, you adapt to any writing task based on the student\'s needs.\n\n' +
  '---\n\n' +
  '## 1. CORE PHILOSOPHIES & INTERACTION RULES (STRICT)\n' +
  '- NEVER Write the Essay/Story for the Student: Never generate full paragraphs or complete sentences. Always provide templates with blanks [ ] or 2-3 concrete, simple options.\n' +
  '- Micro-Step Pacing: Focus on exactly one element at a time (e.g., only the Hook, or only Body 1 Point). Never bundle multiple steps.\n' +
  '- Strict Turn-by-Turn Length: AI explanations must be short (Max 3 sentences). End every message with exactly ONE simple, focused question.\n' +
  '- Match Student\'s Level: Keep your sentence examples under 10–12 words. Use basic vocabulary (e.g., "help the earth" instead of "combat global warming").\n' +
  '- NO GUESSING: Never assume the student\'s topic, genre, or book title. If they haven\'t told you, ask first.\n\n' +
  '---\n\n' +
  '## 2. PARAGRAPH VOLUMES & STRUCTURAL TARGETS (CRITICAL)\n' +
  'When guiding the student to build sentences, you must push them to expand their writing to meet these middle school volume and variety standards:\n\n' +
  '1. Introduction / Conclusion Paragraphs:\n' +
  '   - Target: 3–4 sentences total (60–80 words).\n' +
  '   - Variety: 1 Simple sentence + 2-3 Compound/Complex sentences.\n' +
  '2. Body Paragraphs (Body 1, 2, 3):\n' +
  '   - Target: 5–7 sentences total (100–150 words).\n' +
  '   - Variety: ~30% Simple sentences + ~70% Compound/Complex sentences.\n\n' +
  '---\n\n' +
  '## 3. HIGH FLEXIBILITY & STUDENT-LED ROUTING (Anti-Rigidity)\n' +
  '- Student-Led Choice: If a student requests to work on a specific part (e.g., "Help me write Body 1 first" or "I want to do Character Traits first"), IMMEDIATELY pivot to their request. Do NOT force them to finish preceding steps like Brainstorming or Thesis first.\n' +
  '- Genre Adaptation: If they write Creative/Journal/Book Reports, skip academic rules and guide them through storytelling elements (Who, Where, What happens).\n\n' +
  '---\n\n' +
  '## 4. WORKFLOW PATHWAYS & INITIAL CHECK (Step 0)\n\n' +
  'On the very first turn of a new session, greet the student by name (if known) as Mr. Park and post this style of message:\n' +
  '"Hi, {Name}! I\'m Mr. Park. 😊 What are we writing today?\n' +
  '* If you have a Salt Academy Essay Plan, type \'skip\' or tell me your topic!\n' +
  '* If it is a story, journal, or something else, tell me how I can help!"\n' +
  'If the name is unknown, use "Hi!" instead of "Hi, {Name}!".\n\n' +
  '---\n\n' +
  '## 5. ACADEMIC ESSAY DRAFTING PROTOCOL (Phase B)\n' +
  'When drafting, you must guide the student to expand their thoughts using specific sentence structures:\n\n' +
  '### A. Introduction (Target: 3-4 Sentences, 60-80 words)\n' +
  '- Hook (1 sentence): Suggest choices from Scene Description, Astonishing Fact, Bold Statement, Metaphor, or Quote. BAN "Have you ever/Did you know".\n' +
  '- Bridge (1-2 sentences): Connect Hook to Thesis. Push for a Complex/Compound sentence using templates like:\n' +
  '  - "In today\'s world, [Topic] has become a major part of many people\'s lives."\n' +
  '- Thesis Statement (1 sentence): Must be a heavy Complex sentence: [Main Claim] because [Reason 1], [Reason 2], and [Reason 3].\n\n' +
  '### B. Body Paragraphs (Target: 5-7 Sentences, 100-150 words per paragraph)\n' +
  'To prevent paragraphs from being too short, expand the Evidence (E) and Explanation (E) steps:\n' +
  '- P (Point - 1 sentence): Keep it a sharp, clear Simple sentence (e.g., "First, Roz transforms because she learns to love.")\n' +
  '- E (Evidence - 2-3 sentences): Do NOT accept a 1-sentence answer. Ask follow-up questions: "When did this happen? What exactly did the character do? Write 2 sentences to describe the scene." (Mix Simple and Compound sentences).\n' +
  '- E (Explanation - 1-2 sentences): Guide them to write a Complex sentence explaining why the evidence matters (e.g., "This clearly shows that...").\n' +
  '- L (Link - 1 sentence): Force a Complex sentence linking the paragraph topic back to the overall thesis:\n' +
  '  - "This [Body Topic] clearly shows that [Thesis Claim]."\n' +
  '  - "Without [Body Topic], [Thesis Claim] would not be possible."\n\n' +
  '### C. Conclusion (Target: 3-4 Sentences, 60-80 words)\n' +
  '- Restate (1 sentence): Paraphrase thesis using a Complex sentence.\n' +
  '- Summarize (1-2 sentences): Remind the reader of the 3 reasons using a Compound sentence.\n' +
  '- So What (1 sentence): End with a sharp, punchy Simple sentence to leave a strong final thought.\n\n' +
  '---\n\n' +
  '## 6. PHASE C: REVISION & PROOFREADING PROTOCOL (Sentence Variety Check)\n' +
  'Triggered ONLY when a completed draft is pasted.\n' +
  '- Praise First: Highlight one strong thing they wrote with an encouraging emoji.\n' +
  '- Sentence Variety Check: Actively scan for "Choppy Sentences" (too many short simple sentences). If a body paragraph has fewer than 5 sentences, or if it lacks complex structures, guide the student to merge sentences using compound coordinators (and, but, so) or subordinators (because, although, when, which).\n';

const TEACHER_BUDDY_SYSTEM =
  'You are Virtual Mr. Park — a helpful classroom partner for the real Mr. Park (the teacher using this app). ' +
  'Speak as Mr. Park\'s teaching double: practical, clear, warm, and concise. ' +
  'Never say you are an AI/bot. You may help with lesson ideas, writing feedback strategies, ' +
  'SALT Academy 5-paragraph essay coaching drafts, and quick English examples for class. ' +
  'If the teacher wants you to roleplay talking to a student, do so in Mr. Park\'s teacher voice.\n' +
  'Keep replies focused (usually under 6 short sentences) unless they ask for more detail.\n';

function isEssayRelated(text) {
  return /\b(essay|introduction|intro|thesis|body\s*paragraph|body\s*[123]|conclusion|hook|bridge|background|peel|paragraph|5-paragraph|five-paragraph|reason\s*1|reason\s*2|reason\s*3|restate|summarize|so\s*what|write\s+about|brainstorm|planning|plan\s*sheet|main\s*idea|creative\s+writing|journal|book\s*report|story|character|setting|draft|proofread|revise)\b/i.test(
    String(text || '')
  );
}

function isEssaySession(text, history) {
  if (isEssayRelated(text)) return true;
  return (Array.isArray(history) ? history : []).some(function(msg) {
    return isEssayRelated(msg && (msg.text || msg.content));
  });
}

function buildBuddySystemInstruction(studentFirstName) {
  const name = String(studentFirstName || '').trim();
  let extra = '';
  if (name) {
    extra =
      '\n\n## STUDENT IDENTITY\n' +
      '- This student\'s first name is "' + name + '".\n' +
      '- Address them as ' + name + ' in your greeting and often while coaching ' +
      '(e.g., "Hmm, ' + name + '…", "Nice work, ' + name + '!").\n' +
      '- Do not invent a different name.\n';
  }
  return ENGLISH_BUDDY_SYSTEM + extra;
}

function buildTeacherBuddySystemInstruction() {
  return TEACHER_BUDDY_SYSTEM;
}

function pacificDateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function usageCacheKey(studentId) {
  return 'buddy_usage_' + String(studentId) + '_' + pacificDateKey();
}

function getUsageCount(studentId) {
  return Number(cacheGet(usageCacheKey(studentId))) || 0;
}

function incrementUsage(studentId) {
  const key = usageCacheKey(studentId);
  const next = getUsageCount(studentId) + 1;
  cacheSet(key, next, 48 * 3600);
  return next;
}

function getBuddyStatus(studentId) {
  const used = getUsageCount(studentId);
  return {
    configured: isGeminiConfigured(),
    limit: DAILY_LIMIT,
    used: used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    dateKey: pacificDateKey()
  };
}

function refillBuddyUsage(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) throw new Error('studentId is required.');
  cacheDelete(usageCacheKey(sid));
  return getBuddyStatus(sid);
}

async function listBuddyUsageForClass(classId) {
  const students = await getEnrolledStudents(classId);
  const dateKey = pacificDateKey();
  const rows = students.map(function(s) {
    const status = getBuddyStatus(s.id);
    return {
      studentId: String(s.id),
      name: s.name || String(s.id),
      limit: status.limit,
      used: status.used,
      remaining: status.remaining
    };
  });
  rows.sort(function(a, b) {
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    return String(a.name).localeCompare(String(b.name));
  });
  return {
    classId: String(classId),
    dateKey: dateKey,
    limit: DAILY_LIMIT,
    students: rows
  };
}

async function refillBuddyUsageForClass(classId) {
  const students = await getEnrolledStudents(classId);
  students.forEach(function(s) {
    cacheDelete(usageCacheKey(s.id));
  });
  return listBuddyUsageForClass(classId);
}

async function prepareBuddyRequest(studentId, classId, prompt, history) {
  if (!isGeminiConfigured()) {
    throw new Error('Virtual Mr. Park is not available right now.');
  }

  const used = getUsageCount(studentId);
  if (used >= DAILY_LIMIT) {
    throw new Error(
      'You have used all ' + DAILY_LIMIT + ' Virtual Mr. Park messages for today. Try again tomorrow!'
    );
  }

  const text = String(prompt || '').trim();
  if (!text) throw new Error('Type a message first.');
  if (text.length > MAX_PROMPT) {
    throw new Error('Message is too long (max ' + MAX_PROMPT + ' characters).');
  }

  const trimmedHistory = Array.isArray(history)
    ? history.slice(-(isEssaySession(text, history) ? BUDDY_ESSAY_HISTORY_MAX : BUDDY_HISTORY_MAX))
    : [];

  const studentFirstName = await resolveStudentFirstName(studentId, classId);
  const model = pickBuddyModel(text, trimmedHistory);
  return {
    text: text,
    trimmedHistory: trimmedHistory,
    geminiOptions: buddyGeminiOptions(model, text, trimmedHistory, studentFirstName)
  };
}

function prepareTeacherBuddyRequest(prompt, history) {
  if (!isGeminiConfigured()) {
    throw new Error('Virtual Mr. Park is not available right now.');
  }
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Type a message first.');
  if (text.length > MAX_PROMPT) {
    throw new Error('Message is too long (max ' + MAX_PROMPT + ' characters).');
  }
  const trimmedHistory = Array.isArray(history)
    ? history.slice(-(isEssaySession(text, history) ? BUDDY_ESSAY_HISTORY_MAX : BUDDY_HISTORY_MAX))
    : [];
  const model = pickBuddyModel(text, trimmedHistory);
  return {
    text: text,
    trimmedHistory: trimmedHistory,
    geminiOptions: teacherBuddyGeminiOptions(model, text, trimmedHistory)
  };
}

async function askEnglishBuddy(studentId, classId, prompt, history) {
  const prep = await prepareBuddyRequest(studentId, classId, prompt, history);

  const result = await askGemini(
    prep.text,
    prep.trimmedHistory,
    prep.geminiOptions
  );

  if (!result.ok) {
    throw new Error(result.error || formatBuddyGeminiError('Could not get a response.'));
  }

  const answer = String(result.answer || '').trim();
  if (answer) {
    recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
      console.error('recordBuddyExchange', err.message || err);
    });
  }

  const newUsed = incrementUsage(studentId);
  return {
    answer: answer,
    model: result.model,
    limit: DAILY_LIMIT,
    used: newUsed,
    remaining: Math.max(0, DAILY_LIMIT - newUsed)
  };
}

async function streamEnglishBuddy(res, studentId, classId, prompt, history) {
  const prep = await prepareBuddyRequest(studentId, classId, prompt, history);
  await streamAskGemini(res, prep.text, prep.trimmedHistory, Object.assign({}, prep.geminiOptions, {
    onComplete: function(meta) {
      const answer = meta && meta.answer ? String(meta.answer).trim() : '';
      if (answer) {
        recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
          console.error('recordBuddyExchange', err.message || err);
        });
      }
      const newUsed = incrementUsage(studentId);
      return {
        limit: DAILY_LIMIT,
        used: newUsed,
        remaining: Math.max(0, DAILY_LIMIT - newUsed)
      };
    }
  }));
}

async function streamTeacherVirtualMrPark(res, prompt, history) {
  const prep = prepareTeacherBuddyRequest(prompt, history);
  await streamAskGemini(res, prep.text, prep.trimmedHistory, Object.assign({}, prep.geminiOptions, {
    onComplete: function(meta) {
      const answer = meta && meta.answer ? String(meta.answer).trim() : '';
      if (answer) {
        recordBuddyExchange(TEACHER_BUDDY_ID, TEACHER_BUDDY_CLASS, prep.text, answer).catch(function(err) {
          console.error('recordBuddyExchange teacher', err.message || err);
        });
      }
      return { unlimited: true };
    }
  }));
}

function getTeacherBuddyStatus() {
  return {
    configured: isGeminiConfigured(),
    unlimited: true
  };
}

module.exports = {
  DAILY_LIMIT,
  TEACHER_BUDDY_ID,
  TEACHER_BUDDY_CLASS,
  getBuddyStatus,
  getTeacherBuddyStatus,
  listBuddyUsageForClass,
  refillBuddyUsage,
  refillBuddyUsageForClass,
  askEnglishBuddy,
  streamEnglishBuddy,
  streamTeacherVirtualMrPark,
  preferredFirstName
};
