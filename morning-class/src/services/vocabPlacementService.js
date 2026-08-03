/**
 * Vocab Placement + AI Deep-Dive.
 * V-Lox Adaptive Test: dynamic step size by question index, symmetric +/- ,
 * immediate next-item difficulty from updated ability, final = round(ability).
 */
const { isGeminiConfigured, askGemini, formatGeminiClientError } = require('./geminiService');

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
/** @deprecated use PLACEMENT_MAX */
const PLACEMENT_QUESTION_COUNT = 18;
const PLACEMENT_MIN = 12;
const PLACEMENT_MAX = 18;
const PLACEMENT_STABLE_WINDOW = 4;
/** Late-phase step is ±0.25 — a quiet window of 0.5 is reachable */
const PLACEMENT_STABLE_RANGE = 0.5;
const DEFAULT_PLACEMENT_START = 4;

/** Soft widen when exact Math.round(ability) grade has few words */
const PLACEMENT_PICK_RADIUS = 1;
/** Misses this far above ability get a softened wrong penalty (50% of step) */
const HARD_MISS_GAP = 0.75;

/**
 * Placement question types.
 * Easy types can be gamed via morphology / surface cues at higher grades.
 * Hard types force meaning knowledge (synonym, antonym, polysemy, sense cloze).
 */
const PLACEMENT_EASY_TYPES = { meaning: 1, whichWord: 1 };
const PLACEMENT_HARD_TYPES = { synonym: 1, antonym: 1, secondaryMeaning: 1, senseCloze: 1 };
const PLACEMENT_ALL_TYPES = [
  'meaning',
  'sentence',
  'whichWord',
  'synonym',
  'antonym',
  'secondaryMeaning',
  'senseCloze'
];

/**
 * Ability-weighted type mix. Higher ability → fewer morphology-friendly items.
 * Weights are relative; unavailable types for a word fall through at build time.
 */
function placementTypeWeights(abilityGrade) {
  const a = Number(abilityGrade);
  const ability = Number.isFinite(a) ? a : DEFAULT_PLACEMENT_START;
  if (ability < 4) {
    return { meaning: 40, whichWord: 35, sentence: 25 };
  }
  if (ability < 7) {
    return {
      meaning: 22,
      whichWord: 18,
      sentence: 22,
      synonym: 22,
      antonym: 16
    };
  }
  if (ability < 10) {
    return {
      meaning: 10,
      whichWord: 8,
      sentence: 18,
      synonym: 20,
      antonym: 14,
      secondaryMeaning: 15,
      senseCloze: 15
    };
  }
  return {
    meaning: 5,
    whichWord: 5,
    sentence: 12,
    synonym: 20,
    antonym: 16,
    secondaryMeaning: 22,
    senseCloze: 20
  };
}

function pickWeightedPlacementType(abilityGrade, rng) {
  const weights = placementTypeWeights(abilityGrade);
  const entries = Object.keys(weights).map(function (k) {
    return { type: k, w: Math.max(0, Number(weights[k]) || 0) };
  }).filter(function (e) { return e.w > 0; });
  const total = entries.reduce(function (s, e) { return s + e.w; }, 0);
  if (!total) return 'meaning';
  let r = (typeof rng === 'function' ? rng() : Math.random()) * total;
  for (let i = 0; i < entries.length; i++) {
    r -= entries[i].w;
    if (r <= 0) return entries[i].type;
  }
  return entries[entries.length - 1].type;
}

function isHardPlacementType(type) {
  return !!PLACEMENT_HARD_TYPES[String(type || '')];
}

function isEasyPlacementType(type) {
  return !!PLACEMENT_EASY_TYPES[String(type || '')];
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeSchoolGrade(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < GRADE_MIN || n > GRADE_MAX) return null;
  return n;
}

function placementStartAbility(raw) {
  return normalizeSchoolGrade(raw) != null
    ? normalizeSchoolGrade(raw)
    : DEFAULT_PLACEMENT_START;
}

function tierForGrade(grade) {
  const g = clamp(Math.round(Number(grade) || GRADE_MIN), GRADE_MIN, GRADE_MAX);
  return TIER_BANDS[g - 1];
}

function readItemGrade(item) {
  const raw = item && (item.frequencyLevel != null ? item.frequencyLevel : item.targetGrade);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Dynamic step size by 1-based question number.
 * Q1–5: ±1.2 | Q6–12: ±0.6 | Q13+: ±0.25
 */
function stepSizeForQuestion(questionNumber) {
  const n = Math.max(1, Math.round(Number(questionNumber) || 1));
  if (n <= 5) return 1.2;
  if (n <= 12) return 0.6;
  return 0.25;
}

/** Normalize 0-based questionIndex → 1-based question number */
function questionNumberFromItem(item) {
  if (item && item.questionNumber != null && Number.isFinite(Number(item.questionNumber))) {
    return Math.max(1, Math.round(Number(item.questionNumber)));
  }
  if (item && item.questionIndex != null && Number.isFinite(Number(item.questionIndex))) {
    return Math.max(1, Math.round(Number(item.questionIndex)) + 1);
  }
  return 1;
}

function formatPlacementLog(detail) {
  const q = detail.questionNumber;
  const g = detail.itemGrade != null ? detail.itemGrade : '?';
  const ox = detail.correct ? 'O' : 'X';
  const stepSigned = detail.delta >= 0 ? ('+' + detail.delta) : String(detail.delta);
  return '[Q' + q + '] 난이도: Grade ' + g + ' | 정답여부: ' + ox +
    ' | ability: ' + detail.prev + ' -> ' + detail.ability + ' (Step: ' + stepSigned + ')';
}

/**
 * Adaptive ability update after one item.
 * - Symmetric +/- using dynamic step size
 * - Hard misses (item >> ability) soften wrong penalty to 50% of step
 *   EXCEPT hard question types (synonym/antonym/polysemy) — full penalty
 * - Easy morphology-friendly types give reduced credit at high ability
 */
function updateAbilityDetailed(abilityGrade, item) {
  const prev = clamp(Number(abilityGrade) || DEFAULT_PLACEMENT_START, GRADE_MIN - 0.5, GRADE_MAX + 0.5);
  const correct = !!(item && item.correct);
  const itemGrade = readItemGrade(item);
  const questionNumber = questionNumberFromItem(item);
  const step = stepSizeForQuestion(questionNumber);
  const qType = item && (item.questionType || item.type) || '';
  const hard = isHardPlacementType(qType);
  const easy = isEasyPlacementType(qType);

  let delta = 0;
  if (correct) {
    // High-ability kids can fake meaning/whichWord via word shape — less credit.
    if (easy && prev >= 7) delta = step * 0.65;
    else if (hard) delta = step * 1.05; // slight extra confidence for real meaning mastery
    else delta = step;
  } else if (!hard && itemGrade != null && itemGrade > prev + HARD_MISS_GAP) {
    // Much harder than current ability — soften wrong penalty to 50% of step
    delta = -step * 0.5;
  } else {
    delta = -step;
  }

  delta = Math.round(delta * 100) / 100;
  const ability = clamp(Math.round((prev + delta) * 100) / 100, GRADE_MIN - 0.5, GRADE_MAX + 0.5);
  return {
    ability: ability,
    prev: prev,
    step: step,
    delta: delta,
    correct: correct,
    itemGrade: itemGrade,
    questionNumber: questionNumber,
    questionType: qType || null,
    hardType: hard
  };
}

function updateAbility(abilityGrade, item) {
  return updateAbilityDetailed(abilityGrade, item).ability;
}

/**
 * Next item target = Math.round(ability). No floor-only bias, no hard grade clamp.
 */
function nextTargetFreq(abilityGrade) {
  const ability = Number(abilityGrade);
  const base = Number.isFinite(ability) ? ability : DEFAULT_PLACEMENT_START;
  return clamp(Math.round(base), GRADE_MIN, GRADE_MAX);
}

function shouldStopPlacement(abilityTrail) {
  const n = Array.isArray(abilityTrail) ? abilityTrail.length : 0;
  if (n >= PLACEMENT_MAX) return true;
  if (n < PLACEMENT_MIN) return false;
  const window = abilityTrail.slice(-PLACEMENT_STABLE_WINDOW);
  if (window.length < PLACEMENT_STABLE_WINDOW) return false;
  const lo = Math.min.apply(null, window);
  const hi = Math.max.apply(null, window);
  return (hi - lo) <= PLACEMENT_STABLE_RANGE;
}

function scorePlacement(payload) {
  const answers = Array.isArray(payload && payload.answers) ? payload.answers : [];
  const startRaw = payload && (payload.startAbility != null ? payload.startAbility : payload.schoolGrade);
  const startAbility = placementStartAbility(startRaw);
  let ability = startAbility;
  const trail = [];

  for (let i = 0; i < answers.length; i++) {
    const ans = Object.assign({}, answers[i], {
      questionIndex: answers[i] && answers[i].questionIndex != null
        ? answers[i].questionIndex
        : i
    });
    const detail = updateAbilityDetailed(ability, ans);
    ability = detail.ability;
    console.log(formatPlacementLog(detail));
    trail.push({
      index: i,
      abilityGrade: ability,
      correct: detail.correct,
      step: detail.step,
      delta: detail.delta,
      itemGrade: detail.itemGrade
    });
  }

  const correctCount = answers.filter(function (a) { return a && a.correct; }).length;
  const accuracy = answers.length ? correctCount / answers.length : 0;
  // Final result = rounded converged ability only (no peak blend / accuracy ceiling)
  const gradeLevel = clamp(Math.round(ability), GRADE_MIN, GRADE_MAX);
  const tier = tierForGrade(gradeLevel);

  return {
    ok: true,
    questionCount: answers.length || PLACEMENT_QUESTION_COUNT,
    correctCount: correctCount,
    accuracy: Math.round(accuracy * 1000) / 10,
    abilityGrade: ability,
    startAbility: startAbility,
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
    questionMin: PLACEMENT_MIN,
    questionMax: PLACEMENT_MAX,
    gradeMin: GRADE_MIN,
    gradeMax: GRADE_MAX,
    pickRadius: PLACEMENT_PICK_RADIUS,
    stepSizes: { early: 1.2, mid: 0.6, late: 0.25 },
    tiers: TIER_BANDS,
    questionTypes: PLACEMENT_ALL_TYPES.slice(),
    typeWeightsByAbility: {
      low: placementTypeWeights(3),
      mid: placementTypeWeights(5.5),
      high: placementTypeWeights(8),
      elite: placementTypeWeights(11)
    },
    dbFree: false
  };
}

module.exports = {
  TIER_BANDS,
  GRADE_MIN,
  GRADE_MAX,
  PLACEMENT_QUESTION_COUNT,
  PLACEMENT_MIN,
  PLACEMENT_MAX,
  DEFAULT_PLACEMENT_START,
  PLACEMENT_PICK_RADIUS,
  HARD_MISS_GAP,
  PLACEMENT_ALL_TYPES,
  PLACEMENT_HARD_TYPES,
  PLACEMENT_EASY_TYPES,
  /** @deprecated soft pick radius only; kept for callers */
  MAX_ITEM_GRADE_DISTANCE: PLACEMENT_PICK_RADIUS,
  tierForGrade,
  normalizeSchoolGrade,
  placementStartAbility,
  stepSizeForQuestion,
  updateAbility,
  updateAbilityDetailed,
  formatPlacementLog,
  nextTargetFreq,
  shouldStopPlacement,
  scorePlacement,
  deepDiveWord,
  getPlacementMeta,
  placementTypeWeights,
  pickWeightedPlacementType,
  isHardPlacementType,
  isEasyPlacementType
};
