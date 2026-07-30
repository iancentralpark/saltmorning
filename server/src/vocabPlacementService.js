/**
 * Vocab Placement + AI Deep-Dive (DB-free first).
 * Scoring helpers can run server-side for consistency; deep-dive uses Gemini when configured.
 */
const { isGeminiConfigured, askGemini, formatGeminiClientError } = require('./geminiService');

// Grade 1-12 <-> gamified tier name, 1:1 ladder (replaces the old frequency-1..6000 bands).
const TIER_BANDS = [
  { id: 1, name: 'Rookie', gradeLevel: 1, label: 'Grade 1' },
  { id: 2, name: 'Iron', gradeLevel: 2, label: 'Grade 2' },
  { id: 3, name: 'Bronze', gradeLevel: 3, label: 'Grade 3' },
  { id: 4, name: 'Silver', gradeLevel: 4, label: 'Grade 4' },
  { id: 5, name: 'Gold', gradeLevel: 5, label: 'Grade 5' },
  { id: 6, name: 'Platinum', gradeLevel: 6, label: 'Grade 6' },
  { id: 7, name: 'Emerald', gradeLevel: 7, label: 'Grade 7' },
  { id: 8, name: 'Diamond', gradeLevel: 8, label: 'Grade 8' },
  { id: 9, name: 'Ascendant', gradeLevel: 9, label: 'Grade 9' },
  { id: 10, name: 'Master', gradeLevel: 10, label: 'Grade 10' },
  { id: 11, name: 'Grandmaster', gradeLevel: 11, label: 'Grade 11' },
  { id: 12, name: 'Legend', gradeLevel: 12, label: 'Grade 12' }
];

const GRADE_MIN = 1;
const GRADE_MAX = 12;
const PLACEMENT_QUESTION_COUNT = 12;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function tierForGrade(grade) {
  const g = clamp(Math.round(Number(grade) || GRADE_MIN), GRADE_MIN, GRADE_MAX);
  return TIER_BANDS[g - 1];
}

/**
 * Adaptive ability update after one item, on a discrete Grade 1-12 scale.
 * Keep the caller-side value as a float for smooth convergence; round only
 * when picking a question's target grade or reporting the final result.
 * @param {number} abilityGrade estimated grade level (1-12, float)
 * @param {{ correct: boolean, seconds: number, questionType: string }} item
 */
function updateAbility(abilityGrade, item) {
  let ability = clamp(Number(abilityGrade) || 6, GRADE_MIN - 0.5, GRADE_MAX + 0.5);
  const correct = !!(item && item.correct);
  const seconds = Math.max(0.5, Number(item && item.seconds) || 8);
  const type = String((item && item.questionType) || 'meaning');

  let step = 0.55;
  if (type === 'cloze') step = 0.6;
  if (type === 'nuance') step = 0.7;

  // Speed bonus: fast correct → jump further; slow wrong → smaller retreat
  const fast = seconds <= 6;
  const slow = seconds >= 18;
  if (correct) {
    ability += step * (fast ? 1.25 : slow ? 0.75 : 1);
  } else {
    ability -= step * (fast ? 0.9 : slow ? 1.15 : 1);
  }
  return clamp(Math.round(ability * 100) / 100, GRADE_MIN - 0.5, GRADE_MAX + 0.5);
}

function nextTargetFreq(abilityGrade, questionIndex) {
  // Slight oscillation early, converge later
  const wobble = questionIndex < 4 ? ((questionIndex % 2) * 0.4 - 0.2) : 0;
  return clamp(Math.round((Number(abilityGrade) || 6) + wobble), GRADE_MIN, GRADE_MAX);
}

/**
 * Score a finished placement session.
 * @param {{ answers: Array<{ correct: boolean, seconds?: number, questionType?: string, frequencyLevel?: number }> }} payload
 *   `frequencyLevel` on each answer is actually the Grade (1-12) that question targeted;
 *   kept as the wire field name for client backward-compat.
 */
function scorePlacement(payload) {
  const answers = Array.isArray(payload && payload.answers) ? payload.answers : [];
  let ability = 6;
  const trail = [];

  for (let i = 0; i < answers.length; i++) {
    ability = updateAbility(ability, answers[i]);
    trail.push({
      index: i,
      abilityGrade: ability,
      correct: !!(answers[i] && answers[i].correct)
    });
  }

  // Blend with highest correctly answered grade
  let peakCorrect = 0;
  answers.forEach(function (a) {
    if (a && a.correct && Number(a.frequencyLevel) > peakCorrect) {
      peakCorrect = Number(a.frequencyLevel);
    }
  });
  if (peakCorrect > 0) {
    ability = clamp(Math.round((ability * 0.7 + peakCorrect * 0.3) * 100) / 100, GRADE_MIN, GRADE_MAX);
  }

  const correctCount = answers.filter(function (a) { return a && a.correct; }).length;
  const accuracy = answers.length ? correctCount / answers.length : 0;
  const gradeLevel = clamp(Math.round(ability), GRADE_MIN, GRADE_MAX);
  const tier = tierForGrade(gradeLevel);

  return {
    ok: true,
    questionCount: answers.length || PLACEMENT_QUESTION_COUNT,
    correctCount: correctCount,
    accuracy: Math.round(accuracy * 1000) / 10,
    abilityGrade: ability,
    gradeLevel: gradeLevel,
    tier: tier,
    trail: trail,
    message: 'Start at Grade ' + gradeLevel + ' (' + tier.name + ').'
  };
}

function mockDeepDive(word, focus) {
  const w = String(word || 'this word');
  const f = String(focus || 'nuance');
  return {
    ok: true,
    source: 'mock',
    word: w,
    focus: f,
    explanation:
      'Think of "' + w + '" as a precise tool, not a decoration. ' +
      'Pay attention to the company it keeps — nearby verbs and prepositions usually reveal the intended sense. ' +
      'If two readings both fit, prefer the one that matches the tone of the paragraph (casual, academic, or technical).',
    examples: [
      'In a clear context: use "' + w + '" once, then paraphrase instead of repeating.',
      'Contrast pair: try swapping "' + w + '" with a near-synonym and hear which sentence still sounds natural.'
    ]
  };
}

/**
 * AI on-demand deep dive for a word card.
 */
async function deepDiveWord(opts) {
  opts = opts || {};
  const word = String(opts.word || '').trim();
  const partOfSpeech = String(opts.partOfSpeech || '').trim();
  const focus = String(opts.focus || 'nuance').trim() || 'nuance';
  const levelHint = String(opts.levelHint || '').trim();
  const studentLevel = String(opts.studentLevel || '').trim();

  if (!word) throw new Error('word is required.');

  if (!isGeminiConfigured()) {
    return mockDeepDive(word, focus);
  }

  const system =
    'You are a precise English vocabulary coach for students. ' +
    'Reply in clear English only (no other languages). ' +
    'Be concise: 2–4 short paragraphs max, then 2 example sentences. ' +
    'Focus on meaning, nuance, and natural use. Avoid fluff.';

  const user =
    'Word: ' + word + (partOfSpeech ? ' (' + partOfSpeech + ')' : '') + '\n' +
    'Focus: ' + focus + '\n' +
    (levelHint ? 'Card level context: ' + levelHint + '\n' : '') +
    (studentLevel ? 'Student tier: ' + studentLevel + '\n' : '') +
    'Explain the nuance or usage the student is stuck on. Then give exactly 2 natural example sentences.';

  try {
    const result = await askGemini(user, [], {
      model: process.env.VOCAB_DEEP_DIVE_MODEL || process.env.ENGLISH_BUDDY_MODEL || 'gemini-2.5-flash-lite',
      systemInstruction: system,
      temperature: 0.55,
      maxOutputTokens: 700
    });
    const text = String((result && (result.answer || result.text)) || '').trim();
    if (!text || (result && result.ok === false)) return mockDeepDive(word, focus);

    // Soft-split examples if model numbered them
    const examples = [];
    const lines = text.split(/\n+/);
    const body = [];
    lines.forEach(function (line) {
      const m = line.match(/^\s*(?:[-*]|\d+[.)])\s*(.+)$/);
      if (m && /[.!?]"?$/.test(m[1]) && examples.length < 2) {
        examples.push(m[1].trim());
      } else {
        body.push(line);
      }
    });

    return {
      ok: true,
      source: 'gemini',
      word: word,
      focus: focus,
      explanation: (body.join('\n').trim() || text).slice(0, 2500),
      examples: examples.slice(0, 2)
    };
  } catch (err) {
    console.error('deepDiveWord', formatGeminiClientError(err) || err.message || err);
    const fallback = mockDeepDive(word, focus);
    fallback.warning = 'AI temporarily unavailable; showing a structured fallback.';
    return fallback;
  }
}

function getPlacementMeta() {
  return {
    questionCount: PLACEMENT_QUESTION_COUNT,
    gradeMin: GRADE_MIN,
    gradeMax: GRADE_MAX,
    tiers: TIER_BANDS,
    questionTypes: ['meaning', 'cloze'],
    dbFree: false
  };
}

module.exports = {
  TIER_BANDS,
  GRADE_MIN,
  GRADE_MAX,
  PLACEMENT_QUESTION_COUNT,
  tierForGrade,
  updateAbility,
  nextTargetFreq,
  scorePlacement,
  deepDiveWord,
  getPlacementMeta
};
