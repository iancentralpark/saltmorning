/**
 * Vocab Booster — Promotion Test (BO3 tier-up challenge).
 *
 * Reach 400 promotion score → status AVAILABLE (no instant promote).
 * Best-of-3 rounds: 10 questions, pass at 8/10.
 * 2 wins → promote; 2 losses → fail to 360 and re-lock.
 */
'use strict';

const {
  getStudentState,
  tenantId,
  pickWordsForGrade,
  PROMOTE_AT
} = require('./vocabLearningService');
const { tierForGrade, GRADE_MIN, GRADE_MAX } = require('./vocabPlacementService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

const PASS_CORRECT = 8;
const TOTAL_Q = 10;
const WINS_TO_PROMOTE = 2;
const LOSSES_TO_FAIL = 2;
const FAIL_SCORE = 360;
const SHIELD_ON_PROMOTE = 3;
const SPEED_SECONDS = 8;

const STATUS = {
  LOCKED: 'LOCKED',
  AVAILABLE: 'AVAILABLE',
  IN_PROGRESS: 'IN_PROGRESS',
  PASSED: 'PASSED',
  FAILED: 'FAILED'
};

function requireDb() {
  if (!isSupabaseEnabled()) throw new Error('Supabase is required for Promotion Test.');
  return getSupabase();
}

function normalizeStatus(raw) {
  const s = String(raw || STATUS.LOCKED).toUpperCase();
  return Object.prototype.hasOwnProperty.call(STATUS, s) ? s : STATUS.LOCKED;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function uniquePush(list, value) {
  const v = String(value || '').trim();
  if (!v) return;
  if (list.indexOf(v) >= 0) return;
  list.push(v);
}

function misspellings(word) {
  const w = String(word || '').trim();
  const out = [];
  if (w.length < 3) {
    uniquePush(out, w + w.slice(-1));
    uniquePush(out, w + 'e');
    uniquePush(out, w.slice(0, -1) || w + 'a');
    return out;
  }
  // swap two adjacent letters
  for (let i = 0; i < w.length - 1 && out.length < 6; i++) {
    const chars = w.split('');
    const tmp = chars[i];
    chars[i] = chars[i + 1];
    chars[i + 1] = tmp;
    const s = chars.join('');
    if (s !== w) uniquePush(out, s);
  }
  // drop a middle letter
  if (w.length > 3) uniquePush(out, w.slice(0, 2) + w.slice(3));
  // double a vowel/consonant
  uniquePush(out, w.slice(0, 2) + w[1] + w.slice(2));
  uniquePush(out, w + 's');
  return out.filter((x) => x.toLowerCase() !== w.toLowerCase());
}

function wordDef(row) {
  return String((row && (row.simple_definition || row.korean_meaning)) || '').trim();
}

function asList(val) {
  if (Array.isArray(val)) return val.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return asList(parsed);
    } catch (e) { /* ignore */ }
    return val.split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function buildSpellingQuestion(word, pool) {
  const correct = String(word.word || '').trim();
  const choices = [correct];
  misspellings(correct).forEach((m) => {
    if (choices.length >= 4) return;
    uniquePush(choices, m);
  });
  (pool || []).forEach((p) => {
    if (choices.length >= 4) return;
    const other = String(p.word || '').trim();
    if (other && other.toLowerCase() !== correct.toLowerCase()) uniquePush(choices, other);
  });
  while (choices.length < 4) uniquePush(choices, correct + String(choices.length));
  const def = wordDef(word) || ('the word for “' + correct + '”');
  return {
    type: 'spelling',
    prompt: 'Spell the word that means:\n' + def,
    correct,
    choices: shuffle(choices.slice(0, 4)),
    wordId: word.word_id,
    word: correct,
    timeLimitSec: null
  };
}

function buildSynAntQuestion(word, pool, preferAnt) {
  const syns = asList(word.synonyms).filter(
    (s) => s.toLowerCase() !== String(word.word || '').toLowerCase()
  );
  const ants = asList(word.antonyms).filter(
    (s) => s.toLowerCase() !== String(word.word || '').toLowerCase()
  );
  const useAnt = preferAnt && ants.length > 0 ? true : syns.length === 0 && ants.length > 0;
  const correct = useAnt ? ants[0] : syns[0];
  if (!correct) return null;

  const distractors = [];
  (useAnt ? syns : ants).forEach((x) => uniquePush(distractors, x));
  (pool || []).forEach((p) => {
    asList(p.synonyms).concat(asList(p.antonyms)).concat([p.word]).forEach((x) => {
      if (distractors.length >= 6) return;
      if (String(x).toLowerCase() === correct.toLowerCase()) return;
      uniquePush(distractors, x);
    });
  });
  while (distractors.length < 3) uniquePush(distractors, correct + distractors.length);

  const choices = shuffle([correct].concat(shuffle(distractors).slice(0, 3)));
  return {
    type: useAnt ? 'antonym' : 'synonym',
    prompt: useAnt
      ? ('Which is an antonym of “' + word.word + '”?')
      : ('Which is a synonym of “' + word.word + '”?'),
    correct,
    choices,
    wordId: word.word_id,
    word: word.word,
    timeLimitSec: null
  };
}

function buildSpeedQuestion(word, pool) {
  const def = wordDef(word) || String(word.word || '');
  const correct = String(word.word || '').trim();
  const choices = [correct];
  (pool || []).forEach((p) => {
    if (choices.length >= 4) return;
    const other = String(p.word || '').trim();
    if (other && other.toLowerCase() !== correct.toLowerCase()) uniquePush(choices, other);
  });
  while (choices.length < 4) uniquePush(choices, correct + choices.length);
  return {
    type: 'speed',
    prompt: 'Speed round! Which word means:\n' + def,
    correct,
    choices: shuffle(choices.slice(0, 4)),
    wordId: word.word_id,
    word: correct,
    timeLimitSec: SPEED_SECONDS
  };
}

async function loadWordPool(gradeLevel) {
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(gradeLevel) || 6)));
  // Prefer richer rows for syn/ant
  const db = requireDb();
  const lo = Math.max(GRADE_MIN, grade - 1);
  const hi = Math.min(GRADE_MAX, grade + 1);
  const { data, error } = await db
    .from('vocab_words')
    .select(
      'word_id,word,grade_level,tier_name,simple_definition,korean_meaning,example_sentence,cloze_question,wrong_options,synonyms,antonyms,part_of_speech'
    )
    .eq('active', true)
    .gte('grade_level', lo)
    .lte('grade_level', hi)
    .limit(120);
  if (error) throw new Error(error.message);
  let pool = data || [];
  if (pool.length < 20) {
    const extra = await pickWordsForGrade(grade, 40, pool.map((w) => w.word_id));
    extra.forEach((w) => {
      if (!pool.some((p) => p.word_id === w.word_id)) pool.push(w);
    });
  }
  return shuffle(pool);
}

function buildRoundQuestions(pool) {
  const schedule = []
    .concat(Array(4).fill('spelling'))
    .concat(Array(3).fill('synant'))
    .concat(Array(3).fill('speed'));
  const types = shuffle(schedule);
  const used = new Set();
  const questions = [];
  let antFlip = false;

  types.forEach((kind) => {
    let tries = 0;
    while (tries < 30 && questions.length < TOTAL_Q) {
      tries += 1;
      const word = pool[Math.floor(Math.random() * pool.length)];
      if (!word || used.has(word.word_id)) continue;
      let q = null;
      if (kind === 'spelling') q = buildSpellingQuestion(word, pool);
      else if (kind === 'synant') {
        q = buildSynAntQuestion(word, pool, antFlip);
        antFlip = !antFlip;
        if (!q) q = buildSpellingQuestion(word, pool);
      } else q = buildSpeedQuestion(word, pool);
      if (!q) continue;
      used.add(word.word_id);
      questions.push(Object.assign({ index: questions.length }, q));
      break;
    }
  });

  while (questions.length < TOTAL_Q && pool.length) {
    const word = pool[questions.length % pool.length];
    const q = buildSpellingQuestion(word, pool);
    q.index = questions.length;
    questions.push(q);
  }
  return questions.slice(0, TOTAL_Q);
}

function publicStatus(state) {
  const status = normalizeStatus(state && state.promotion_test_status);
  const wins = Math.max(0, Math.round(Number(state && state.test_wins) || 0));
  const losses = Math.max(0, Math.round(Number(state && state.test_losses) || 0));
  const score = Number(state && state.promotion_score) || 0;
  const grade = state && state.grade_level != null ? Number(state.grade_level) : null;
  const canStart =
    (status === STATUS.AVAILABLE || status === STATUS.IN_PROGRESS) &&
    grade != null &&
    grade < GRADE_MAX;
  return {
    status,
    wins,
    losses,
    winsNeeded: WINS_TO_PROMOTE,
    lossesLimit: LOSSES_TO_FAIL,
    canStart,
    unlockedAt: (state && state.promotion_test_unlocked_at) || null,
    notifyUnlock: !!(state && state.promotion_test_notify_unlock),
    notifyRetry: !!(state && state.promotion_test_notify_retry),
    promotionScore: score,
    promotionScoreMax: PROMOTE_AT,
    passCorrect: PASS_CORRECT,
    totalQuestions: TOTAL_Q,
    speedSeconds: SPEED_SECONDS,
    failScore: FAIL_SCORE,
    gradeLevel: grade,
    tierName: (state && state.tier_name) || null
  };
}

async function getPromotionTestStatus(studentId) {
  const state = (await getStudentState(studentId)) || {};
  return publicStatus(state);
}

async function persistStatePatch(studentId, patch) {
  const db = requireDb();
  const row = Object.assign(
    {
      tenant_id: tenantId(),
      student_id: String(studentId),
      updated_at: new Date().toISOString()
    },
    patch
  );
  const { error } = await db
    .from('vocab_student_state')
    .upsert(row, { onConflict: 'tenant_id,student_id' });
  if (error) throw new Error(error.message);
}

async function startPromotionTest(studentId, classId) {
  const state = (await getStudentState(studentId)) || {};
  if (!state.placement_at) {
    const err = new Error('Finish Placement before the Promotion Test.');
    err.statusCode = 400;
    throw err;
  }
  let status = normalizeStatus(state.promotion_test_status);
  const score = Number(state.promotion_score) || 0;
  if (status === STATUS.LOCKED && score >= PROMOTE_AT) {
    status = STATUS.AVAILABLE;
  }
  if (status !== STATUS.AVAILABLE && status !== STATUS.IN_PROGRESS) {
    const err = new Error('Promotion Test is locked. Reach ' + PROMOTE_AT + ' points first.');
    err.statusCode = 409;
    err.code = 'PROMO_TEST_LOCKED';
    throw err;
  }
  const grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(state.grade_level) || 6)));
  if (grade >= GRADE_MAX) {
    const err = new Error('Already at the top tier.');
    err.statusCode = 400;
    throw err;
  }

  const wins = Math.max(0, Math.round(Number(state.test_wins) || 0));
  const losses = Math.max(0, Math.round(Number(state.test_losses) || 0));
  const roundNumber = wins + losses + 1;
  if (roundNumber > 3) {
    const err = new Error('Promotion Test series already finished.');
    err.statusCode = 409;
    throw err;
  }

  const pool = await loadWordPool(grade);
  const questions = buildRoundQuestions(pool);
  const db = requireDb();
  const insert = {
    tenant_id: tenantId(),
    student_id: String(studentId),
    round_number: roundNumber,
    wins_before: wins,
    losses_before: losses,
    grade_level: grade,
    tier_name: state.tier_name || tierForGrade(grade).name,
    questions,
    status: 'open'
  };
  const { data, error } = await db
    .from('vocab_promotion_test_rounds')
    .insert(insert)
    .select('id,round_number,created_at')
    .maybeSingle();
  if (error) throw new Error(error.message);

  await persistStatePatch(studentId, {
    class_id: classId || state.class_id || null,
    grade_level: grade,
    tier_name: state.tier_name || tierForGrade(grade).name,
    placement_at: state.placement_at,
    placement_accuracy: state.placement_accuracy,
    promotion_score: Math.min(PROMOTE_AT, score),
    promotion_shield_count: state.promotion_shield_count || 0,
    promotion_test_status: STATUS.IN_PROGRESS,
    test_wins: wins,
    test_losses: losses,
    promotion_test_unlocked_at: state.promotion_test_unlocked_at || new Date().toISOString(),
    rating_score: state.rating_score
  });

  // Client must not see correct answers in cleartext beyond choices — strip `correct`? 
  // Daily test keeps correct for client grading of some flows; we grade server-side so omit correct.
  const clientQuestions = questions.map((q) => ({
    index: q.index,
    type: q.type,
    prompt: q.prompt,
    choices: q.choices,
    wordId: q.wordId,
    word: q.type === 'spelling' ? undefined : undefined,
    timeLimitSec: q.timeLimitSec
  }));

  console.log(
    '[Promotion Test] User:',
    studentId,
    '| Round:',
    roundNumber,
    '| Start | Wins/Losses',
    wins + '/' + losses
  );

  return {
    roundId: data.id,
    roundNumber,
    wins,
    losses,
    gradeLevel: grade,
    tierName: state.tier_name || tierForGrade(grade).name,
    passCorrect: PASS_CORRECT,
    totalQuestions: TOTAL_Q,
    questions: clientQuestions,
    status: publicStatus(
      Object.assign({}, state, {
        promotion_test_status: STATUS.IN_PROGRESS,
        test_wins: wins,
        test_losses: losses
      })
    )
  };
}

async function submitPromotionTest(studentId, payload) {
  payload = payload || {};
  const roundId = String(payload.roundId || '').trim();
  const answers = Array.isArray(payload.answers) ? payload.answers : [];
  if (!roundId) {
    const err = new Error('roundId required');
    err.statusCode = 400;
    throw err;
  }

  const db = requireDb();
  const { data: round, error } = await db
    .from('vocab_promotion_test_rounds')
    .select('*')
    .eq('id', roundId)
    .eq('tenant_id', tenantId())
    .eq('student_id', String(studentId))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!round) {
    const err = new Error('Round not found');
    err.statusCode = 404;
    throw err;
  }
  if (round.status !== 'open') {
    const err = new Error('Round already submitted');
    err.statusCode = 409;
    throw err;
  }

  const questions = Array.isArray(round.questions) ? round.questions : [];
  let correctCount = 0;
  const graded = questions.map((q, i) => {
    const ans = answers.find((a) => Number(a.index) === i) || answers[i] || {};
    const given = String(ans.answer || ans.selected || '').trim();
    const ok = given.toLowerCase() === String(q.correct || '').trim().toLowerCase();
    if (ok) correctCount += 1;
    return {
      index: i,
      type: q.type,
      wordId: q.wordId,
      correct: q.correct,
      answer: given,
      isCorrect: ok
    };
  });
  const passed = correctCount >= PASS_CORRECT;

  let wins = Math.max(0, Math.round(Number(round.wins_before) || 0));
  let losses = Math.max(0, Math.round(Number(round.losses_before) || 0));
  if (passed) wins += 1;
  else losses += 1;

  const state = (await getStudentState(studentId)) || {};
  let grade = Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(Number(state.grade_level) || round.grade_level || 6)));
  let score = Number(state.promotion_score) || PROMOTE_AT;
  let shield = Math.max(0, Math.round(Number(state.promotion_shield_count) || 0));
  let nextStatus = STATUS.IN_PROGRESS;
  let seriesResult = null;
  let promoted = null;

  if (wins >= WINS_TO_PROMOTE) {
    grade = Math.min(GRADE_MAX, grade + 1);
    score = 0;
    shield = SHIELD_ON_PROMOTE;
    nextStatus = STATUS.LOCKED;
    seriesResult = 'promoted';
    promoted = 'up';
    wins = 0;
    losses = 0;
  } else if (losses >= LOSSES_TO_FAIL) {
    score = FAIL_SCORE;
    nextStatus = STATUS.LOCKED;
    seriesResult = 'failed';
    wins = 0;
    losses = 0;
  } else {
    nextStatus = STATUS.AVAILABLE;
    seriesResult = 'continue';
  }

  const tier = tierForGrade(grade);
  await db
    .from('vocab_promotion_test_rounds')
    .update({
      answers: graded,
      correct_count: correctCount,
      passed,
      status: 'submitted',
      submitted_at: new Date().toISOString()
    })
    .eq('id', roundId);

  await persistStatePatch(studentId, {
    class_id: state.class_id || null,
    grade_level: grade,
    tier_name: tier.name,
    placement_at: state.placement_at,
    placement_accuracy: state.placement_accuracy,
    rating_score: state.rating_score,
    promotion_score: score,
    promotion_shield_count: shield,
    promotion_test_status: nextStatus,
    test_wins: wins,
    test_losses: losses,
    promotion_test_unlocked_at: state.promotion_test_unlocked_at,
    promotion_test_notify_unlock: false,
    promotion_test_notify_retry: seriesResult === 'failed',
    last_active_at: new Date().toISOString()
  });

  console.log(
    '[Promotion Test] User:',
    studentId,
    '| Round:',
    round.round_number,
    '| Result:',
    passed ? 'Pass' : 'Fail',
    '(' + correctCount + '/' + TOTAL_Q + ')',
    '| Wins/Losses',
    wins + '/' + losses,
    seriesResult ? '| Series: ' + seriesResult : ''
  );

  const fresh = await getStudentState(studentId);
  return {
    roundId,
    roundNumber: round.round_number,
    correctCount,
    total: TOTAL_Q,
    passed,
    wins,
    losses,
    seriesResult,
    promoted,
    gradeLevel: grade,
    tierName: tier.name,
    promotionScore: score,
    shieldCount: shield,
    status: publicStatus(fresh || {})
  };
}

async function ackPromotionTest(studentId, payload) {
  payload = payload || {};
  const state = (await getStudentState(studentId)) || {};
  const patch = {
    class_id: state.class_id || null,
    grade_level: state.grade_level,
    tier_name: state.tier_name,
    placement_at: state.placement_at,
    placement_accuracy: state.placement_accuracy,
    rating_score: state.rating_score,
    promotion_score: state.promotion_score,
    promotion_shield_count: state.promotion_shield_count,
    promotion_test_status: normalizeStatus(state.promotion_test_status),
    test_wins: state.test_wins || 0,
    test_losses: state.test_losses || 0,
    promotion_test_unlocked_at: state.promotion_test_unlocked_at
  };
  if (payload.unlock !== false) patch.promotion_test_notify_unlock = false;
  if (payload.retry !== false) patch.promotion_test_notify_retry = false;
  await persistStatePatch(studentId, patch);
  const fresh = await getStudentState(studentId);
  return { ok: true, status: publicStatus(fresh || {}) };
}

module.exports = {
  STATUS,
  PASS_CORRECT,
  TOTAL_Q,
  WINS_TO_PROMOTE,
  LOSSES_TO_FAIL,
  FAIL_SCORE,
  SHIELD_ON_PROMOTE,
  SPEED_SECONDS,
  publicStatus,
  getPromotionTestStatus,
  startPromotionTest,
  submitPromotionTest,
  ackPromotionTest
};
