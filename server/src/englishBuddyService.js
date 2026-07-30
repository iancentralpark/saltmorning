const { cacheGet, cacheSet, cacheDelete } = require('./cache');
const { isGeminiConfigured, askGemini, streamAskGemini, formatGeminiClientError } = require('./geminiService');
const { recordBuddyExchange, getBuddyChatRevision } = require('./englishBuddyHistoryService');
const {
  evaluateAndFlagBuddyAbuse,
  inspectIncomingBuddyMessage,
  ABUSE_AI_REPLY,
  ABUSE_LOCK_REPLY,
  isBuddyAbuseLocked,
  getAbuseStrikeState,
  getWarningState,
  stripAbuseGuardFromHistory
} = require('./englishBuddyAbuseService');
const { getEssayCoachHint } = require('./englishBuddyEssayCoach');
const { getEnrolledStudents } = require('./homeworkService');
const { isSupabaseEnabled } = require('./supabaseClient');

function recordBuddyExchangeAndAbuse(studentId, classId, history, userText, assistantText) {
  return recordBuddyExchange(studentId, classId, userText, assistantText)
    .then(function() {
      return evaluateAndFlagBuddyAbuse(studentId, classId, history, userText, assistantText);
    })
    .catch(function(err) {
      console.error('recordBuddyExchangeAndAbuse', err.message || err);
    });
}

function writeBuddySse(res, payload) {
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
  if (typeof res.flush === 'function') {
    try { res.flush(); } catch (e) { /* ignore */ }
  }
}

function sleepMs(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Send a finished (sanitized) reply as SSE chunks so the client can type it out.
 * Real Gemini streaming was dropped to block Hangul mid-stream; this restores the UX.
 */
async function sendCannedBuddyStream(res, answer, extras) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const text = String(answer || ABUSE_AI_REPLY);
  const chunkSize = 2;
  const delayMs = 14;
  for (let i = 0; i < text.length; i += chunkSize) {
    writeBuddySse(res, { text: text.slice(i, i + chunkSize) });
    if (i + chunkSize < text.length) await sleepMs(delayMs);
  }
  writeBuddySse(res, Object.assign({
    done: true,
    answer: text,
    model: 'abuse-guard',
    abuseBlocked: true
  }, extras || {}));
  res.end();
}

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
  let systemInstruction = buildBuddySystemInstruction(studentFirstName);
  if (essaySession) {
    systemInstruction = appendInternalCoachNote(systemInstruction, ESSAY_COACH_NOTE);
  }
  return {
    systemInstruction: systemInstruction,
    model: model,
    thinkingBudget: 0,
    // Short chat by default; a bit more room for SALT frames
    maxOutputTokens: essaySession ? 280 : 140,
    temperature: 0.35,
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

const ENGLISH_BUDDY_SYSTEM = `You are Virtual Mr. Park — a cool, witty, and direct teacher at Salt Academy.
You help ESL students (Grades 2–6) with English: Salt Academy essays, vocab, sounding native, grammar, and educational questions.
Talk like a real supportive teacher (1–2 short sentences max). Never sound like a rigid bot or interrogator!

## BRANDING
- The school name is "Salt Academy". Say Salt Academy or Salt.
- NEVER write "SALT" in all caps in student-facing chat.

## LANGUAGE
- Reply in easy ENGLISH only. Never write Hangul/Korean.
- If they write Hangul/Korean script: do NOT answer the content — remind them ("Hey — English with me! Please type in English.").
- Latin letters / romanization (e.g. "gae ddong burl le") is NOT Hangul. Ask for the English word/name — NEVER say "English with me" for romanization.
- English "I don't know" / "I do not know" / idk / dunno (and typos) is NOT Korean. Use THE 3-STEP HELP LADDER. NEVER say "English with me" or "Please type in English" for English IDK / stuck messages.
- Educational questions (even if not about English) → answer helpfully in simple English, then offer a tiny English tip when natural.

## FIRST CONTACT / GREETING
- On a fresh chat or a hello: greet by name — "Hi! {Name}! How can I help you today?"
- Then wait for what they need (essay, word, sounding native, or other).

## THE GOLDEN RULE: IDEAS YES, GHOSTWRITING NO
1. NEVER write a complete, ready-to-copy sentence for the student (Hook, Bridge, Thesis, Body, Conclusion).
2. NEVER say "How about: \`Full sentence here.\`" or "Locked in!" with a sentence YOU invented.
3. NEVER offer a numbered list of finished sentences (BAD: \`1. "Global warming is…" 2. "Our planet…"\`). That is ghostwriting.
4. If they type keywords/fragments, ask THEM to type one full sentence — do not polish it into a finished sentence for them.
5. Grammar fix is OK only AFTER they typed a full sentence, and keep it tiny (1 tip). Still prefer they retype.
6. DO NOT scold if they struggle or skip — guide smoothly.

## THE 3-STEP HELP LADDER (When stuck / "I don't know")
DO NOT drop full sentences. Climb the ladder:

- LEVEL 1: 2–3 short keywords/angles only (not full sentences).
- LEVEL 2: One simple question that makes THEM think.
- LEVEL 3: Bracket frame with EMPTY blanks — they must type the finished line.
  └ Good: \`Global warming is a [big/serious] problem that [does what?].\` → "Type your sentence!"
  └ Bad: \`Global warming is an important problem that is changing our planet.\`

*Numbers 1/2/3…:* OK only for picking STYLE NAMES, brainstorm keywords, or fancy words — NEVER for picking among finished sentences you wrote.

## SENTENCE STYLE FIRST (Hook / Bridge / Thesis / PEEL / Conclusion)
Before they write a sentence:
1. Offer a short numbered STYLE MENU — style NAMES only (3–5 options).
2. Let them choose (number or name).
3. THEN guide writing for that style with keywords, one tip, or an empty [bracket frame]. They must type the sentence.

### Hook style menu (example — names only, NO full sentences)
1. Shocking fact / surprising number
2. Imagine this… (paint a scene)
3. Onomatopoeia / sound word
4. Question
5. Bold statement

After they pick e.g. "bold statement":
- GOOD: "Nice — bold statement! Try keywords like: happening now / not future / we must act. Type your Hook!"
- GOOD: \`[Big claim about global warming] is happening [now / every day].\` → "Fill it in!"
- BAD: listing three ready-made Hook sentences for them to copy.

### Bridge / Thesis / PEEL / Conclusion
Same rule: style or angle names first → then keywords/[frames] only. Never finished copy-ready lines.

## 5 FANCY WORDS (hard rule)
- Offer EXACTLY 5 fancy words (numbered 1–5). Never 6, never 10, never "pick five from a long list."
- Each word: one short meaning in parentheses.
- Ask them to pick which ones they want, or confirm all five.

## FLEXIBLE TEACHER BEHAVIOR
- Pace Control: "next" / "I'm done" / "skip" / jump to Hook, Body, Conclusion → one short accept line, then help at THAT step (style menu first if they need to write).
- Small Talk: one fun turn, then back to work.
- Insults: witty authority ("Whoa — be nice."), then continue the task. Never say Warning/Strike text. Never say "English with me" / "Please type in English" unless they used Hangul.
- Word Help / Sound Native / general English: short help — no essay unless they ask.
- Never say "Warning N/3" or "Strike N/3" in chat. Server/UI handles that.

## Salt Academy ESSAY FLOW (guide the Salt Academy planning sheet naturally)
1. Topic shared → ask: "Shall we brainstorm 3 ideas, or did you already finish planning?"
2. If the topic is too broad: help pick a clearer side / more specific topic BEFORE 3 body ideas.
3. Brainstorm: 3 body ideas as keywords/short phrases. Soft hints OK ("If I were you…") — keywords only.
4. Already planned → confirm 3 ideas, continue.
5. After 3 ideas → EXACTLY 5 Fancy Words, then Hook → Bridge → Thesis (separate). Each: STYLE MENU (names) → choose → keywords/[frame] → THEY type.
6. Body ×3 PEEL — Point, Evidence, Explanation, Link. Style/angle hints + frames only. Aim ~6–7 sentences per body, gradually.
7. After Body 3 → Conclusion (RSS). Style menu → choose → they write.`;

const ESSAY_COACH_NOTE =
  'ESSAY MODE — GOLDEN RULE is absolute: NEVER write finished ready-to-copy sentences. NEVER give a numbered list of complete Hooks/Bridges/Theses for them to pick and copy. ' +
  'Style menus = STYLE NAMES only (shocking fact / Imagine this / question / bold statement / etc.). After they choose a style: keywords or empty [bracket frames] only, then "Type your sentence!" ' +
  'Salt Academy essay flow: topic → brainstorm/planned → narrow if broad → 3 ideas → 5 Fancy Words → Hook→Bridge→Thesis (style first) → PEEL (~6–7 sentences) → Conclusion. ' +
  'If stuck: Help Ladder L1→L2→L3. If they pick a number after YOU ghostwrote full sentences: do NOT lock it in — apologize briefly, give a [frame], make THEM invent the line. ' +
  'Never invent Warning/Strike text.';

const TEACHER_BUDDY_SYSTEM = `You are Virtual Mr. Park — classroom partner for the real teacher.
Be practical, witty, concise (1–2 sentences). Help with lessons, vocab, Sound Native, grammar, Salt Academy essays, educational questions.
Ideas/keywords/[frames] only — never ghostwrite complete essay sentences. Never offer numbered lists of finished sentences.
Fancy words lists: exactly 5 words.
Essay: style-name menus first, then keywords/frames; Hook/Bridge/Thesis separate; PEEL bodies ~6–7 sentences.`;

function sanitizeBuddyReply(text) {
  let t = String(text || '');
  if (!t) return '';
  t = t.replace(/<mrpark_internal\b[^>]*>[\s\S]*?<\/mrpark_internal>/gi, '');
  t = t.replace(/<\/?mrpark_internal\b[^>]*>/gi, '');
  t = t.replace(/^#{1,3}\s*COACHING WARNING[\s\S]*?(?=\n[A-Za-z]|\n#|$)/gim, '');
  t = t.replace(/^#{1,3}\s*PACE CONTROL[\s\S]*?(?=\n[A-Za-z]|\n#|$)/gim, '');
  t = t.replace(/^\s*THIS TURN:[^\n]*\n?/gim, '');
  t = t.replace(/^\s*The student is stuck \(IDK\)[^\n]*\n?/gim, '');
  t = t.replace(/^\s*Use HELP LADDER[^\n]*\n?/gim, '');
  t = t.replace(/^\s*No finished essay sentence\.[^\n]*\n?/gim, '');
  // Strip invented warning badges if the model ignores instructions
  t = t.replace(/\bWarning\s*\d\s*\/\s*\d\b/gi, '');
  t = t.replace(/\bStrike\s*\d\s*\/\s*\d\b/gi, '');
  // Zero Hangul in student-facing replies
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(t)) {
    return "Hey — English with me! What's up?";
  }
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** True when soft-flag was English IDK / stuck (not Hangul). */
function isEnglishIdkInspection(inspection) {
  const kind =
    inspection &&
    inspection.evaluation &&
    inspection.evaluation.metrics &&
    inspection.evaluation.metrics.essayLazyKind;
  if (kind && /^IDK_/i.test(String(kind))) return true;
  const reasons =
    (inspection && inspection.evaluation && inspection.evaluation.reasons) || [];
  return reasons.indexOf('IDK_STREAK') >= 0;
}

/** Gemini sometimes mis-fires the Korean reminder on English "I don't know". */
function looksLikeKoreanReminderReply(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/english with me/i.test(t) && /type in english|not korean|write.*(in )?english/i.test(t)) {
    return true;
  }
  if (/^english only[!.,\s]/i.test(t) && /not korean|type in english/i.test(t)) {
    return true;
  }
  return false;
}

function isLatinOnlyUserText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(t)) return false;
  return /[A-Za-z]/.test(t);
}

function buildIdkMisfireFallbackReply() {
  return (
    "No problem — let's keep it simple.\n\n" +
    '1. Renewable energy\n' +
    '2. Recycling / less waste\n' +
    '3. Protecting nature\n\n' +
    'Pick one idea in English (even one word)!'
  );
}

function buildRomanizationFallbackReply() {
  return "Got it — what's the English name for that? Type one English word!";
}

/** After Gemini: fix IDK / romanization / disrespect misfires that say "English with me". */
function repairBuddyReply(inspection, userText, answer) {
  let cleaned = String(answer || '').trim();
  if (!cleaned) return cleaned;

  if (isEnglishIdkInspection(inspection) && looksLikeKoreanReminderReply(cleaned)) {
    return buildIdkMisfireFallbackReply();
  }

  if (isLatinOnlyUserText(userText) && looksLikeKoreanReminderReply(cleaned)) {
    return buildRomanizationFallbackReply();
  }

  // Strip "Please type in English" tacked onto otherwise-OK replies for Latin input
  if (isLatinOnlyUserText(userText)) {
    const stripped = cleaned
      .replace(/\s*Hey\s*[—\-–]+\s*English with me[!!.]?\s*(Please type in English\.?)?/gi, '')
      .replace(/\s*Please type in English\.?/gi, '')
      .replace(/\s*English only[!!.]?\s*Write your message in English[^.]*\./gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!stripped) {
      if (isEnglishIdkInspection(inspection)) return buildIdkMisfireFallbackReply();
      return buildRomanizationFallbackReply();
    }
    cleaned = stripped;
  }

  return cleaned;
}

function appendInternalCoachNote(systemInstruction, note) {
  const tip = String(note || '').trim();
  if (!tip) return String(systemInstruction || '');
  return (
    String(systemInstruction || '') +
    '\n\n<mrpark_internal hidden_from_student>\n' +
    'Do NOT write this tag or this note in your reply. Obey it silently.\n' +
    tip +
    '\n</mrpark_internal>'
  );
}

/** Abuse inspect nudges win; essay coach fills step/copy/process hints (no strikes). */
function mergeBuddyCoachHints(inspection, history, userText) {
  const essayHint = getEssayCoachHint(history, userText);
  return {
    coachingNudge: (inspection && inspection.coachingNudge) || essayHint.coachingNudge || '',
    stepAdvance: !!(inspection && inspection.stepAdvance) || essayHint.stepAdvance
  };
}

function isEssayRelated(text) {
  return /\b(essay|salt|introduction|intro|thesis|body\s*paragraph|body\s*[123]|conclusion|hook|bridge|background|peel|paragraph|5-paragraph|five-paragraph|reason\s*1|reason\s*2|reason\s*3|restate|summarize|so\s*what|write\s+about|brainstorm|planning|plan\s*sheet|main\s*idea|creative\s+writing|journal|book\s*report|story|character|setting|draft|proofread|revise)\b/i.test(
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
      '- Address them as ' + name + ' naturally, like in class ' +
      '(e.g., "Hi! ' + name + '! How can I help you today?", "Hmm, ' + name + '…").\n' +
      '- Never explain how you know their name. Never say you are a program or AI.\n' +
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
  const warn = getWarningState(studentId);
  return {
    configured: isGeminiConfigured(),
    limit: DAILY_LIMIT,
    used: used,
    remaining: Math.max(0, DAILY_LIMIT - used),
    dateKey: pacificDateKey(),
    abuseLocked: !!warn.locked,
    abuseStrikes: warn.strikes,
    abuseStrikeLimit: warn.limit,
    warningStrikes: warn.strikes,
    warningLimit: warn.limit,
    freezeActive: !!warn.freezeActive,
    freezeRemainingSec: warn.freezeRemainingSec || 0,
    softFreezeCount: warn.softFreezeCount || 0,
    softFreezeLimit: warn.softFreezeLimit || 3,
    chatRevision: getBuddyChatRevision(studentId)
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

async function listBuddyMonitorRoster() {
  const { getInitialData } = require('./initialService');
  const initial = await getInitialData().catch(function() {
    return { classes: [] };
  });
  const classes = (initial && initial.classes) || [];
  const dateKey = pacificDateKey();
  const rows = [];

  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    const classId = String(cls.id);
    const className = cls.name || classId;
    const students = await getEnrolledStudents(classId).catch(function() {
      return [];
    });
    students.forEach(function(s) {
      const status = getBuddyStatus(s.id);
      const warn = getWarningState(s.id);
      rows.push({
        studentId: String(s.id),
        name: s.name || String(s.id),
        classId: classId,
        className: className,
        limit: status.limit,
        used: status.used,
        remaining: status.remaining,
        locked: !!warn.locked,
        strikes: warn.strikes || 0,
        strikeLimit: warn.limit || 3
      });
    });
  }

  rows.sort(function(a, b) {
    if (!!a.locked !== !!b.locked) return a.locked ? -1 : 1;
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    const byClass = String(a.className).localeCompare(String(b.className));
    if (byClass) return byClass;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    dateKey: dateKey,
    limit: DAILY_LIMIT,
    students: rows
  };
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
  const cleanHistory = stripAbuseGuardFromHistory(trimmedHistory).map(function(m) {
    if (!m) return m;
    const role = String(m.role || '');
    const raw = m.text != null ? m.text : m.content;
    if (role !== 'assistant') return m;
    return Object.assign({}, m, { text: sanitizeBuddyReply(raw) });
  }).filter(function(m) {
    return !!(m && String((m.text != null ? m.text : m.content) || '').trim());
  });
  return {
    text: text,
    trimmedHistory: cleanHistory,
    geminiOptions: buddyGeminiOptions(model, text, cleanHistory, studentFirstName),
    abuseLocked: isBuddyAbuseLocked(studentId)
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

  const inspection = await inspectIncomingBuddyMessage(
    studentId,
    classId,
    prep.trimmedHistory,
    prep.text
  ).catch(function(err) {
    console.error('inspectIncomingBuddyMessage', err.message || err);
    return { flagged: false, immediate: false };
  });

  if (inspection && inspection.immediate) {
    const answer = String(inspection.aiReply || ABUSE_AI_REPLY).trim();
    recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
      console.error('recordBuddyExchange abuse', err.message || err);
    });
    const alreadyLocked = !!inspection.locked && !inspection.flag;
    const newUsed = alreadyLocked ? getUsageCount(studentId) : incrementUsage(studentId);
    const warn = getWarningState(studentId);
    return {
      answer: answer,
      model: 'abuse-guard',
      abuseBlocked: true,
      abuseLocked: !!inspection.locked || warn.locked,
      abuseStrikes: warn.strikes,
      warningStrikes: warn.strikes,
      warningLimit: warn.limit,
      freezeActive: !!(inspection.freezeActive || warn.freezeActive),
      freezeRemainingSec:
        inspection.freezeRemainingSec != null
          ? inspection.freezeRemainingSec
          : warn.freezeRemainingSec || 0,
      softFreezeCount: warn.softFreezeCount || 0,
      softFreezeLimit: warn.softFreezeLimit || 3,
      abuseType: inspection.flag && inspection.flag.abuseType,
      limit: DAILY_LIMIT,
      used: newUsed,
      remaining: Math.max(0, DAILY_LIMIT - newUsed)
    };
  }

  const coachHints = mergeBuddyCoachHints(inspection, prep.trimmedHistory, prep.text);
  if (coachHints.coachingNudge) {
    prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
      systemInstruction: appendInternalCoachNote(
        prep.geminiOptions.systemInstruction,
        coachHints.coachingNudge
      )
    });
  }

  const result = await askGemini(
    prep.text,
    prep.trimmedHistory,
    prep.geminiOptions
  );

  if (!result.ok) {
    throw new Error(result.error || formatBuddyGeminiError('Could not get a response.'));
  }

  const answer = repairBuddyReply(
    inspection,
    prep.text,
    sanitizeBuddyReply(result.answer || '')
  );
  if (answer) {
    if (!(inspection && inspection.flagged)) {
      recordBuddyExchangeAndAbuse(studentId, classId, prep.trimmedHistory, prep.text, answer);
    } else {
      recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
        console.error('recordBuddyExchange', err.message || err);
      });
    }
  }

  const newUsed = incrementUsage(studentId);
  const warn = getWarningState(studentId);
  return {
    answer: answer,
    model: result.model,
    limit: DAILY_LIMIT,
    used: newUsed,
    remaining: Math.max(0, DAILY_LIMIT - newUsed),
    abuseLocked: warn.locked,
    abuseStrikes: warn.strikes,
    warningStrikes: warn.strikes,
    warningLimit: warn.limit,
    freezeActive: !!warn.freezeActive,
    freezeRemainingSec: warn.freezeRemainingSec || 0,
    softFreezeCount: warn.softFreezeCount || 0,
    softFreezeLimit: warn.softFreezeLimit || 3
  };
}

async function streamEnglishBuddy(res, studentId, classId, prompt, history) {
  const prep = await prepareBuddyRequest(studentId, classId, prompt, history);

  const inspection = await inspectIncomingBuddyMessage(
    studentId,
    classId,
    prep.trimmedHistory,
    prep.text
  ).catch(function(err) {
    console.error('inspectIncomingBuddyMessage', err.message || err);
    return { flagged: false, immediate: false };
  });

  if (inspection && inspection.immediate) {
    const answer = String(inspection.aiReply || ABUSE_AI_REPLY).trim();
    recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
      console.error('recordBuddyExchange abuse', err.message || err);
    });
    const alreadyLocked = !!inspection.locked && !inspection.flag;
    const newUsed = alreadyLocked ? getUsageCount(studentId) : incrementUsage(studentId);
    const warnLock = getWarningState(studentId);
    await sendCannedBuddyStream(res, answer, {
      limit: DAILY_LIMIT,
      used: newUsed,
      remaining: Math.max(0, DAILY_LIMIT - newUsed),
      abuseBlocked: true,
      abuseLocked: !!inspection.locked || warnLock.locked,
      abuseStrikes: warnLock.strikes,
      warningStrikes: warnLock.strikes,
      warningLimit: warnLock.limit,
      freezeActive: !!(inspection.freezeActive || warnLock.freezeActive),
      freezeRemainingSec:
        inspection.freezeRemainingSec != null
          ? inspection.freezeRemainingSec
          : warnLock.freezeRemainingSec || 0,
      softFreezeCount: warnLock.softFreezeCount || 0,
      softFreezeLimit: warnLock.softFreezeLimit || 3,
      abuseType: inspection.flag && inspection.flag.abuseType
    });
    return;
  }

  const coachHints = mergeBuddyCoachHints(inspection, prep.trimmedHistory, prep.text);
  if (coachHints.coachingNudge || coachHints.stepAdvance) {
    prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
      systemInstruction: appendInternalCoachNote(
        prep.geminiOptions.systemInstruction,
        coachHints.coachingNudge
      )
    });
  } else if (!isEssaySession(prep.text, prep.trimmedHistory)) {
    prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
      systemInstruction: appendInternalCoachNote(
        prep.geminiOptions.systemInstruction,
        'English only (no Hangul). Casual chat, Word Help, Sound Native, and educational questions are fine — do not force an essay unless they ask.'
      )
    });
  }

  // Non-stream + sanitize: guarantees no Korean tokens reach the student mid-SSE
  const result = await askGemini(prep.text, prep.trimmedHistory, prep.geminiOptions);
  if (!result.ok) {
    throw new Error(result.error || formatBuddyGeminiError('Could not get a response.'));
  }
  const answer = repairBuddyReply(
    inspection,
    prep.text,
    sanitizeBuddyReply(result.answer || '')
  );
  if (answer) {
    if (!(inspection && inspection.flagged)) {
      recordBuddyExchangeAndAbuse(studentId, classId, prep.trimmedHistory, prep.text, answer);
    } else {
      recordBuddyExchange(studentId, classId, prep.text, answer).catch(function(err) {
        console.error('recordBuddyExchange', err.message || err);
      });
    }
  }
  const newUsed = incrementUsage(studentId);
  const warnDone = getWarningState(studentId);
  await sendCannedBuddyStream(res, answer, {
    limit: DAILY_LIMIT,
    used: newUsed,
    remaining: Math.max(0, DAILY_LIMIT - newUsed),
    model: result.model,
    abuseBlocked: false,
    abuseLocked: warnDone.locked,
    abuseStrikes: warnDone.strikes,
    warningStrikes: warnDone.strikes,
    warningLimit: warnDone.limit,
    freezeActive: !!warnDone.freezeActive,
    freezeRemainingSec: warnDone.freezeRemainingSec || 0,
    softFreezeCount: warnDone.softFreezeCount || 0,
    softFreezeLimit: warnDone.softFreezeLimit || 3
  });
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
  listBuddyMonitorRoster,
  refillBuddyUsage,
  refillBuddyUsageForClass,
  askEnglishBuddy,
  streamEnglishBuddy,
  streamTeacherVirtualMrPark,
  preferredFirstName
};
