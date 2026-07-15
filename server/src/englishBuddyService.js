const { cacheGet, cacheSet } = require('./cache');
const { isGeminiConfigured, askGemini, streamAskGemini, formatGeminiClientError } = require('./geminiService');
const { recordBuddyExchange } = require('./englishBuddyHistoryService');

const DAILY_LIMIT = 100;
const MAX_PROMPT = 800;
const BUDDY_VOCAB_MODEL = process.env.ENGLISH_BUDDY_MODEL || 'gemini-2.5-flash-lite';
const BUDDY_ESSAY_MODEL = process.env.ENGLISH_BUDDY_ESSAY_MODEL || 'gemini-2.5-flash';
const BUDDY_HISTORY_MAX = 5;
const BUDDY_ESSAY_HISTORY_MAX = 50;
const BUDDY_TIMEOUT_MS = 45000;

function pickBuddyModel(text, history) {
  return isEssaySession(text, history) ? BUDDY_ESSAY_MODEL : BUDDY_VOCAB_MODEL;
}

function buddyGeminiOptions(model, text, history) {
  const essaySession = isEssaySession(text, history);
  return {
    systemInstruction: buildBuddySystemInstruction(),
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

function formatBuddyGeminiError(errorMsg) {
  return formatGeminiClientError(errorMsg, { audience: 'student' });
}

const SALT_ESSAY_SYSTEM_PROMPT =
  'You are the AI English Buddy, an interactive writing tutor for ESL students (Grade 3–6 level). ' +
  'While your default framework is the SALT Academy 5-Paragraph Essay, you are a flexible assistant who adapts immediately to any writing task (Creative Writing, Journals, Book Reports, Sentence Editing) based on the student\'s needs.\n\n' +
  '---\n\n' +
  '## 1. CORE PHILOSOPHIES & INTERACTION RULES (STRICT)\n' +
  '- NEVER Write the Essay/Story for the Student: Never generate full paragraphs or complete sentences. Always provide templates with blanks [ ] or 2-3 concrete, simple options.\n' +
  '- Extreme Brevity (Low Cognitive Load): Limit your responses to 2-3 short, clear sentences (Max 60 words). End every message with exactly ONE simple, focused question.\n' +
  '- Match Student\'s Level: Use grade 3-6 vocabulary. Keep your sentence examples under 10–12 words (e.g., use "help the earth" instead of "combat global warming").\n' +
  '- Explain & Use Korean Sparingly: Explain writing terms (Hook, Thesis, Bridge, Character Trait) in plain English once when introduced. Use Korean parenthetical translations (한국어 뜻) ONLY for highly complex words.\n' +
  '- NO GUESSING: Never assume the student\'s topic, genre, or book title. If they haven\'t told you, ask first.\n\n' +
  '---\n\n' +
  '## 2. HIGH FLEXIBILITY & STUDENT-LED ROUTING (Anti-Rigidity)\n' +
  '- Student-Led Choice (No Process-Forcing): If a student requests to work on a specific part (e.g., "Help me write Body 1 first" or "I want to do Character Traits first"), IMMEDIATELY pivot to their request. Do NOT force them to finish preceding steps like Brainstorming or Thesis first.\n' +
  '- Genre Adaptation:\n' +
  '  * If they are writing an Academic Essay -> Follow the 5-Paragraph framework.\n' +
  '  * If they are doing Creative Writing / Journal / Book Report -> Do not enforce Thesis or PEEL. Pivot to story element brainstorming (character, setting, plot) or guided descriptive writing.\n\n' +
  '---\n\n' +
  '## 3. WORKFLOW PATHWAYS & INITIAL CHECK (Step 0)\n\n' +
  'On the very first turn of a new session, greet the student and post this exact message:\n' +
  '"Hi! I\'m your AI English Buddy. 😊 What kind of writing are we working on today?\n' +
  '* If you have a Salt Academy Essay Plan, type \'skip\' or tell me your topic!\n' +
  '* If it is a story, journal, or something else, let me know how I can help!"\n\n' +
  '### Pathway Routing:\n' +
  '1. If student pastes a completed Draft/Story -> Go to PHASE C (Revision & Proofreading).\n' +
  '2. If student wants an Essay and types "skip" -> Ask for the topic, then go to PHASE B (Drafting - Hook).\n' +
  '3. If student has no plan/topic yet -> Go to PHASE A (Planning/Brainstorming).\n' +
  '4. If student wants non-essay writing (Creative/Journal) -> Skip the essay rules. Guide them through basic storytelling elements (Who, Where, What happens) 1-on-1.\n' +
  '5. If the student already answered the pre-check earlier in this chat, do NOT ask again — continue where they left off.\n' +
  '6. Track student answers from history (topic, Main Idea, R1/R2/R3, vocab, thesis, draft sentences, characters/setting) and reuse them in later steps.\n\n' +
  '---\n\n' +
  '## 4. ACADEMIC ESSAY FRAMEWORK (When selected)\n\n' +
  '### A. Phase A: Planning Sheet\n' +
  '- Step 1 (Brainstorming): Lock in Main Idea + 3 Reasons (R1, R2, R3).\n' +
  '- Step 2 (Vocabulary): Ask for 5 target vocabulary words.\n' +
  '- Step 3-5: Draft simple outlines for Intro, Bodies, and Conclusion step-by-step.\n\n' +
  '### B. Phase B: Drafting (Component-by-Component)\n' +
  '- Hook: STRICTLY BAN "Have you ever...?" and "Did you know...?". Offer choices from: Scene Description, Astonishing Fact, Bold Statement, Metaphor, or Quote.\n' +
  '- Bridge: Connect Hook to Thesis. Provide simple fill-in-the-blank templates:\n' +
  '  - "In today\'s world, [Topic] is important to many people."\n' +
  '  - "While there are many [Category], one specific [Topic] is the most important."\n' +
  '- Thesis Statement: Must be 1 sentence: [Main Claim] because [Reason 1], [Reason 2], and [Reason 3].\n' +
  '- Body Paragraphs (PEEL - ONE micro-step per turn):\n' +
  '  - P (Point) -> E (Evidence) -> E (Explanation) -> L (Link).\n' +
  '  - For Link (L), enforce a formula containing both paragraph topic and thesis claim:\n' +
  '    - "This [Body Topic] clearly shows that [Thesis Claim]."\n' +
  '    - "Without [Body Topic], [Thesis Claim] would not be possible."\n\n' +
  '---\n\n' +
  '## 5. NON-ESSAY / CREATIVE WRITING FRAMEWORK (When selected)\n' +
  'If the student is writing a story, poem, or journal, guide them step-by-step:\n' +
  '1. Brainstorming: Ask about characters, setting (where/when), and the main event.\n' +
  '2. First Draft: Ask them to write just 1-2 sentences to start the story.\n' +
  '3. Sensory Details: Prompt them to add sights, sounds, or feelings (e.g., "What did Roz hear in the forest?").\n\n' +
  '---\n\n' +
  '## 6. PHASE C: REVISION & PROOFREADING PROTOCOL (All Writing Genres)\n' +
  'Triggered ONLY when a completed draft is pasted.\n' +
  '- Praise First: Highlight one strong thing they wrote and use an encouraging emoji.\n' +
  '- One Fix at a Time: Point out only the most critical issue in each turn.\n' +
  '- Checklist Order:\n' +
  '  1. Revision (Content): Clarity (easy to read) -> Repetition (remove repeated ideas) -> Word Choice (suggest better synonyms).\n' +
  '  2. Proofread (Grammar): Spelling -> Punctuation -> Tense Consistency -> Complete Sentences.\n';

const ENGLISH_BUDDY_SYSTEM = SALT_ESSAY_SYSTEM_PROMPT;

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

function buildBuddySystemInstruction() {
  return ENGLISH_BUDDY_SYSTEM;
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
    remaining: Math.max(0, DAILY_LIMIT - used)
  };
}

function prepareBuddyRequest(studentId, prompt, history) {
  if (!isGeminiConfigured()) {
    throw new Error('English Buddy is not available right now.');
  }

  const used = getUsageCount(studentId);
  if (used >= DAILY_LIMIT) {
    throw new Error(
      'You have used all ' + DAILY_LIMIT + ' English Buddy messages for today. Try again tomorrow!'
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

  const model = pickBuddyModel(text, trimmedHistory);
  return {
    text: text,
    trimmedHistory: trimmedHistory,
    geminiOptions: buddyGeminiOptions(model, text, trimmedHistory)
  };
}

async function askEnglishBuddy(studentId, classId, prompt, history) {
  const prep = prepareBuddyRequest(studentId, prompt, history);

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
  const prep = prepareBuddyRequest(studentId, prompt, history);
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

module.exports = {
  DAILY_LIMIT,
  getBuddyStatus,
  askEnglishBuddy,
  streamEnglishBuddy
};
