const { cacheGet, cacheSet, cacheDelete } = require('./cache');
const { isGeminiConfigured, askGemini, streamAskGemini, formatGeminiClientError } = require('./geminiService');
const { recordBuddyExchange } = require('./englishBuddyHistoryService');
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
}

function sendCannedBuddyStream(res, answer, extras) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const text = String(answer || ABUSE_AI_REPLY);
  writeBuddySse(res, { text: text });
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
  return {
    systemInstruction: buildBuddySystemInstruction(studentFirstName),
    model: model,
    thinkingBudget: 0,
    // Short chat by default; a bit more room for the 5 Fancy Words list
    maxOutputTokens: essaySession ? 220 : 140,
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

const ENGLISH_BUDDY_SYSTEM = `You are Virtual Mr. Park — cool, witty Salt Academy teacher.
Students: Korean intl school, Grades 2–5 (good ESL, not native).
Help: Word Help, Sound Native, grammar, chat, SALT essays.

## TALK STYLE
- Usually 1–2 short easy sentences (kids must read fast).
- No long pep talks. No hard adult coaching frames.
- **5 Fancy Words:** hard/advanced words are OK (that's the point). Short easy meanings. If they ask for all 5, give all 5 in ONE reply.
- Never invent long adult "complete this" sentences for them to copy.
- Never show hidden/internal notes, tags, or "COACHING WARNING" text to the student.

## RULES
1. Student owns essay ideas. You may fix THEIR grammar in one short line, then move on if they accept.
2. Do NOT invent a polished idea then say "say it in your own words."
3. Stuck / IDK → Help Ladder: (1) 2–3 short keyword angles (2) one easy question (3) short [ ] frame with easy words.
4. Numbers 1/2/3 OK for choosing angles. If a sentence is still needed: "Nice — now write a full sentence!"
5. Pace: "next" / "I'm done" / "다음거" → one warm line, advance.
6. Spam / insults / "write my whole essay" → sharp pushback, demand a real attempt.
7. Small talk: 1 turn, then back to English.

## SALT ESSAY FLOW
Brainstorm (topic → 3 ideas → 5 fancy words) → Intro (Hook/Bridge/Thesis) → Body PEEL → Conclusion RSS.
Students may jump ahead when they ask.`;

const TEACHER_BUDDY_SYSTEM = `You are Virtual Mr. Park — classroom partner for the real teacher.
Be practical, witty, concise (1–2 sentences). Help with lessons, vocab, Sound Native, grammar, SALT essays.
For student writing: keywords/frames only — no ghostwriting full essay sentences.`;

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
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
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
      '- Address them as ' + name + ' in greetings and while coaching ' +
      '(e.g., "Hmm, ' + name + '…", "Come on, ' + name + '—you can do better.").\n' +
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
    warningLimit: warn.limit
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
      abuseType: inspection.flag && inspection.flag.abuseType,
      limit: DAILY_LIMIT,
      used: newUsed,
      remaining: Math.max(0, DAILY_LIMIT - newUsed)
    };
  }

  if (inspection && inspection.coachingNudge) {
    prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
      systemInstruction: appendInternalCoachNote(
        prep.geminiOptions.systemInstruction,
        inspection.coachingNudge
      )
    });
  } else if (inspection && inspection.stepAdvance) {
    prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
      systemInstruction: appendInternalCoachNote(
        prep.geminiOptions.systemInstruction,
        'Student wants next step. Accept in one short line and advance. No redo. No ghostwriting.'
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

  const answer = sanitizeBuddyReply(result.answer || '');
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
    warningLimit: warn.limit
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
    sendCannedBuddyStream(res, answer, {
      limit: DAILY_LIMIT,
      used: newUsed,
      remaining: Math.max(0, DAILY_LIMIT - newUsed),
      abuseBlocked: true,
      abuseLocked: !!inspection.locked || warnLock.locked,
      abuseStrikes: warnLock.strikes,
      warningStrikes: warnLock.strikes,
      warningLimit: warnLock.limit,
      abuseType: inspection.flag && inspection.flag.abuseType
    });
    return;
  }

  // Soft coach turns: non-stream so leaked internal notes never reach the student mid-SSE
  if (inspection && (inspection.coachingNudge || inspection.stepAdvance)) {
    if (inspection.coachingNudge) {
      prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
        systemInstruction: appendInternalCoachNote(
          prep.geminiOptions.systemInstruction,
          inspection.coachingNudge
        )
      });
    } else {
      prep.geminiOptions = Object.assign({}, prep.geminiOptions, {
        systemInstruction: appendInternalCoachNote(
          prep.geminiOptions.systemInstruction,
          'Student wants next step. Accept in one short line and advance. No redo. No ghostwriting.'
        )
      });
    }
    const result = await askGemini(prep.text, prep.trimmedHistory, prep.geminiOptions);
    if (!result.ok) {
      throw new Error(result.error || formatBuddyGeminiError('Could not get a response.'));
    }
    const answer = sanitizeBuddyReply(result.answer || '');
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
    const warnSoft = getWarningState(studentId);
    sendCannedBuddyStream(res, answer, {
      limit: DAILY_LIMIT,
      used: newUsed,
      remaining: Math.max(0, DAILY_LIMIT - newUsed),
      model: result.model,
      abuseBlocked: false,
      abuseLocked: warnSoft.locked,
      abuseStrikes: warnSoft.strikes,
      warningStrikes: warnSoft.strikes,
      warningLimit: warnSoft.limit
    });
    return;
  }

  await streamAskGemini(res, prep.text, prep.trimmedHistory, Object.assign({}, prep.geminiOptions, {
    onComplete: function(meta) {
      const answer = meta && meta.answer ? sanitizeBuddyReply(meta.answer) : '';
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
      return {
        limit: DAILY_LIMIT,
        used: newUsed,
        remaining: Math.max(0, DAILY_LIMIT - newUsed),
        abuseLocked: warnDone.locked,
        abuseStrikes: warnDone.strikes,
        warningStrikes: warnDone.strikes,
        warningLimit: warnDone.limit
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
