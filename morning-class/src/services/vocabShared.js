/**
 * Salt Morning Class — Vocab Booster bridge to Mr. Park's shared engine + Supabase DB.
 * Same word bank / placement / SRS / quest engine. Lucky Draw disabled.
 *
 * IMPORTANT: Morning Class student/class IDs (S001, C001, …) collide with Mr. Park's.
 * All vocab_* rows for this app are stored under the `mc:` prefix.
 */
'use strict';

const path = require('path');
const { applyDollarAdjustment } = require('./dollarService');
const { getClassRoster } = require('./teacherPortalService');

const VENDOR_SRC = process.env.VOCAB_CORE_PATH ||
  path.resolve(__dirname, '../vendor/mrpark-vocab');

/** Prefix that scopes Morning Class rows inside the shared Supabase vocab tables. */
const VOCAB_ID_PREFIX = String(process.env.VOCAB_ID_PREFIX || 'mc:').trim() || 'mc:';

let wired = false;
let learning = null;
let placement = null;

function toVocabId(id) {
  const s = String(id == null ? '' : id).trim();
  if (!s) return s;
  if (s.startsWith(VOCAB_ID_PREFIX)) return s;
  return VOCAB_ID_PREFIX + s;
}

function fromVocabId(id) {
  const s = String(id == null ? '' : id).trim();
  if (s.startsWith(VOCAB_ID_PREFIX)) return s.slice(VOCAB_ID_PREFIX.length);
  return s;
}

function parseSchoolGrade(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.round(Number(String(raw).replace(/[^0-9.]/g, '')));
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return n;
}

async function resolveStudentSchoolGrade(localStudentId) {
  try {
    const { getStudent } = require('./studentRegistryService');
    const student = await getStudent(localStudentId);
    const schoolGrade = parseSchoolGrade(
      (student && student.profile && student.profile.gradeLevel) ||
      (student && student.gradeLevel)
    );
    return { schoolGrade };
  } catch (e) {
    return { schoolGrade: null };
  }
}

function wire() {
  if (wired) return;
  // eslint-disable-next-line import/no-dynamic-require
  learning = require(path.join(VENDOR_SRC, 'vocabLearningService.js'));
  // eslint-disable-next-line import/no-dynamic-require
  placement = require(path.join(VENDOR_SRC, 'vocabPlacementService.js'));

  process.env.VOCAB_SKIP_LUCKY_DRAW = 'true';
  learning.configureVocabLearning({
    skipLuckyDraw: true,
    grantLuckyReward: async () => null,
    // Dollars live in Morning Class Sheets — always use local (unprefixed) IDs.
    applyDollarAdjustment: async (classId, studentId, amount, reason) =>
      applyDollarAdjustment(fromVocabId(classId), fromVocabId(studentId), amount, reason),
    getEnrolledStudents: async (classId) => {
      const roster = await getClassRoster(fromVocabId(classId));
      return roster.map((s) => ({
        // Engine queries vocab_* with scoped ids…
        id: toVocabId(s.studentId),
        studentId: toVocabId(s.studentId),
        name: s.name,
        // …while UI still wants the Sheets id.
        localStudentId: s.studentId
      }));
    },
    getStudentSchoolGrade: async (scopedStudentId) =>
      resolveStudentSchoolGrade(fromVocabId(scopedStudentId))
  });
  wired = true;
}

function api() {
  wire();
  return learning;
}

function placementApi() {
  wire();
  return placement;
}

async function getStudentVocabSummary(studentId, classId) {
  return api().getStudentVocabSummary(toVocabId(studentId), toVocabId(classId));
}

/** Lightweight placement gate — one Supabase row read, no Sheets / mastery. */
async function isPlacementDone(studentId) {
  const state = await api().getStudentState(toVocabId(studentId));
  return !!(state && state.placement_at);
}

async function getDailyQueue(studentId, classId) {
  return api().getDailyQueue(toVocabId(studentId), toVocabId(classId));
}

async function recordReview(studentId, classId, wordId, correct) {
  return api().recordReview(toVocabId(studentId), toVocabId(classId), wordId, correct);
}

async function recordDailyTestResult(studentId, classId, correctCount, totalCount, answers) {
  const sid = toVocabId(studentId);
  const cid = toVocabId(classId);
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (!a || !a.wordId || !a.correct) continue;
      try {
        await api().recordReview(sid, cid, a.wordId, true);
      } catch (err) {
        console.warn('daily-test answer sync', err.message || err);
      }
    }
  }
  return api().recordDailyTestResult(sid, cid, correctCount, totalCount, answers);
}

async function buildPlacementItem(opts) {
  return api().buildPlacementItem(opts);
}

async function savePlacementResult(studentId, classId, payload) {
  const result = payload && payload.gradeLevel != null
    ? payload
    : placementApi().scorePlacement(payload || {});
  await api().savePlacementResult(toVocabId(studentId), toVocabId(classId), result);
  return result;
}

async function getClassVocabOverview(classId) {
  const overview = await api().getClassOverview(toVocabId(classId));
  const students = (overview.students || []).map((s) => {
    const placementDone = !!(s.placementAt || s.tierName || s.gradeLevel);
    const localId = s.localStudentId || fromVocabId(s.studentId);
    return {
      studentId: localId,
      name: s.name,
      placementDone,
      gradeLevel: placementDone ? s.gradeLevel : null,
      tierName: placementDone ? s.tierName : null,
      tier: placementDone ? s.tierName : null,
      streak: Number(s.streakDays || 0),
      streakDays: Number(s.streakDays || 0),
      longestStreak: Number(s.longestStreak || 0),
      questDone: !!s.todayTestPassed,
      todayTestPassed: !!s.todayTestPassed,
      todayStudied: Number(s.todayStudied || 0),
      todayTarget: Number(s.todayTarget || 0),
      todayTestScore: s.todayTestScore,
      ratingScore: s.ratingScore,
      promotionScore: s.promotionScore,
      promotionScoreMax: s.promotionScoreMax,
      shieldCount: s.shieldCount,
      placementAt: s.placementAt || null
    };
  });
  return { students, settings: overview.settings };
}

async function overrideStudentVocab(studentId, classId, opts) {
  opts = opts || {};
  const sid = toVocabId(studentId);
  const cid = toVocabId(classId);
  let resetPlacement;
  if (opts.resetPlacement === true) resetPlacement = true;
  else if (opts.placementDone === true) resetPlacement = false;
  else resetPlacement = opts.resetPlacement !== false;

  await api().overrideStudentState(sid, {
    gradeLevel: opts.gradeLevel,
    resetPlacement
  });

  if (opts.placementDone === true && !resetPlacement) {
    const state = await api().getStudentState(sid);
    if (state && !state.placement_at) {
      const grade = opts.gradeLevel != null
        ? opts.gradeLevel
        : (state.grade_level || placementApi().DEFAULT_PLACEMENT_START);
      const tier = placementApi().tierForGrade(grade);
      await api().savePlacementResult(sid, cid, {
        gradeLevel: grade,
        tier,
        accuracy: state.placement_accuracy || 0
      });
    }
  }
  return getStudentVocabSummary(studentId, classId);
}

function scorePlacement(answersOrPayload) {
  if (Array.isArray(answersOrPayload)) {
    return placementApi().scorePlacement({ answers: answersOrPayload });
  }
  return placementApi().scorePlacement(answersOrPayload || {});
}

function processPlacementNext(body) {
  const p = placementApi();
  body = body || {};
  const ability = p.updateAbility(body.abilityGrade, {
    correct: !!body.correct,
    seconds: body.seconds,
    questionType: body.questionType,
    frequencyLevel: body.frequencyLevel != null ? body.frequencyLevel : body.targetGrade
  });
  const abilityTrail = Array.isArray(body.abilityTrail)
    ? body.abilityTrail.map(Number).concat([ability])
    : [ability];
  return {
    abilityGrade: ability,
    nextTargetGrade: p.nextTargetFreq(ability, Number(body.questionIndex) || 0),
    stop: p.shouldStopPlacement(abilityTrail),
    abilityTrail
  };
}

async function deepDiveWord(payload) {
  return placementApi().deepDiveWord(payload || {});
}

function getPlacementMeta() {
  return placementApi().getPlacementMeta();
}

async function getRecentVocabActivity(limit) {
  try {
    wire();
    const { getSupabase, isSupabaseEnabled } = require(path.join(VENDOR_SRC, 'supabaseClient.js'));
    if (!isSupabaseEnabled()) return [];
    const db = getSupabase();
    const { data, error } = await db
      .from('vocab_daily_progress')
      .select('student_id, quest_date, test_passed, test_score, sessions_completed, updated_at')
      .like('student_id', VOCAB_ID_PREFIX + '%')
      .order('updated_at', { ascending: false })
      .limit(Number(limit) || 50);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      at: row.updated_at || row.quest_date,
      studentId: fromVocabId(row.student_id),
      wordId: '',
      correct: !!row.test_passed,
      kind: row.test_passed ? 'quest_pass' : 'quest_attempt'
    }));
  } catch (e) {
    console.warn('getRecentVocabActivity', e.message || e);
    return [];
  }
}

module.exports = {
  wire,
  toVocabId,
  fromVocabId,
  VOCAB_ID_PREFIX,
  getStudentVocabSummary,
  isPlacementDone,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  buildPlacementItem,
  savePlacementResult,
  getClassVocabOverview,
  overrideStudentVocab,
  scorePlacement,
  processPlacementNext,
  deepDiveWord,
  getPlacementMeta,
  getRecentVocabActivity,
  VENDOR_SRC,
  SERVER_SRC: VENDOR_SRC
};
