/**
 * Salt Morning Class — Vocab Booster bridge to the shared multi-tenant engine.
 *
 * Architecture:
 * - Source of truth: Mr.Park Railway `server/src/vocab*` (sync via `npm run vocab:sync`)
 * - Runtime core: `src/vendor/mrpark-vocab` + shared Supabase, scoped by VOCAB_TENANT_ID
 * - Dollars: Salt Morning Sheets via dollarService adapter
 * - Lucky Draw: disabled (VOCAB_SKIP_LUCKY_DRAW)
 * - Sheets Vocab_* + auto-promote-at-400: RETIRED (see deprecated vocabService.js stub)
 *
 * Engine gaps for Mr.Park Vocab chat (not this repo path):
 * - Dual-Process / stealth-review product surfaces (if still missing upstream)
 * - Sunday dollar dungeon
 * - Full /api/vocab/v1 thin-proxy including promotion-test/*
 */
'use strict';

const path = require('path');
const { applyDollarAdjustment } = require('./dollarService');
const { getClassRoster } = require('./teacherPortalService');

const VENDOR_SRC = process.env.VOCAB_CORE_PATH ||
  path.resolve(__dirname, '../vendor/mrpark-vocab');

const TENANT_ID = String(process.env.VOCAB_TENANT_ID || 'salt-morning').trim() || 'salt-morning';

let wired = false;
let learning = null;
let placement = null;

function parseSchoolGrade(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.round(Number(String(raw).replace(/[^0-9.]/g, '')));
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return n;
}

async function resolveStudentSchoolGrade(studentId) {
  try {
    const { getStudent } = require('./studentRegistryService');
    const student = await getStudent(studentId);
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
  process.env.VOCAB_TENANT_ID = TENANT_ID;
  learning.configureVocabLearning({
    tenantId: TENANT_ID,
    skipLuckyDraw: true,
    grantLuckyReward: async () => null,
    applyDollarAdjustment: async (classId, studentId, amount, reason) =>
      applyDollarAdjustment(classId, studentId, amount, reason),
    getEnrolledStudents: async (classId) => {
      const roster = await getClassRoster(classId);
      return roster.map((s) => ({
        id: s.studentId,
        studentId: s.studentId,
        name: s.name,
        localStudentId: s.studentId
      }));
    },
    getStudentSchoolGrade: resolveStudentSchoolGrade
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
  return api().getStudentVocabSummary(studentId, classId);
}

async function isPlacementDone(studentId) {
  const state = await api().getStudentState(studentId);
  return !!(state && state.placement_at);
}

async function getDailyQueue(studentId, classId) {
  return api().getDailyQueue(studentId, classId);
}

async function recordReview(studentId, classId, wordId, correct) {
  return api().recordReview(studentId, classId, wordId, correct);
}

async function recordDailyTestResult(studentId, classId, correctCount, totalCount, answers) {
  if (Array.isArray(answers)) {
    for (const a of answers) {
      if (!a || !a.wordId || !a.correct) continue;
      try {
        await api().recordReview(studentId, classId, a.wordId, true);
      } catch (err) {
        console.warn('daily-test answer sync', err.message || err);
      }
    }
  }
  return api().recordDailyTestResult(studentId, classId, correctCount, totalCount, answers);
}

async function buildPlacementItem(opts) {
  return api().buildPlacementItem(opts);
}

async function savePlacementResult(studentId, classId, payload) {
  const result = payload && payload.gradeLevel != null
    ? payload
    : placementApi().scorePlacement(payload || {});
  await api().savePlacementResult(studentId, classId, result);
  return result;
}

async function getClassVocabOverview(classId) {
  const overview = await api().getClassOverview(classId);
  const students = (overview.students || []).map((s) => {
    const placementDone = !!(s.placementAt || s.tierName || s.gradeLevel);
    return {
      studentId: s.localStudentId || s.studentId,
      name: s.name,
      placementDone,
      gradeLevel: placementDone ? s.gradeLevel : null,
      tierName: placementDone ? s.tierName : null,
      tierLabel: placementDone ? s.tierLabel : null,
      tier: placementDone ? (s.tierLabel || s.tierName) : null,
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
  let resetPlacement;
  if (opts.resetPlacement === true) resetPlacement = true;
  else if (opts.placementDone === true) resetPlacement = false;
  else resetPlacement = opts.resetPlacement !== false;

  await api().overrideStudentState(studentId, {
    gradeLevel: opts.gradeLevel,
    resetPlacement
  });

  if (opts.placementDone === true && !resetPlacement) {
    const state = await api().getStudentState(studentId);
    if (state && !state.placement_at) {
      const grade = opts.gradeLevel != null
        ? opts.gradeLevel
        : (state.grade_level || placementApi().DEFAULT_PLACEMENT_START);
      const tier = placementApi().tierForGrade(grade);
      await api().savePlacementResult(studentId, classId, {
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

function promoApi() {
  wire();
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(VENDOR_SRC, 'vocabPromotionTestService.js'));
}

async function getPromotionTestStatus(studentId) {
  return promoApi().getPromotionTestStatus(studentId);
}

async function startPromotionTest(studentId, classId) {
  return promoApi().startPromotionTest(studentId, classId);
}

async function submitPromotionTest(studentId, payload) {
  return promoApi().submitPromotionTest(studentId, payload);
}

async function ackPromotionTest(studentId, payload) {
  return promoApi().ackPromotionTest(studentId, payload);
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
      .eq('tenant_id', TENANT_ID)
      .order('updated_at', { ascending: false })
      .limit(Number(limit) || 50);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      at: row.updated_at || row.quest_date,
      studentId: row.student_id,
      wordId: '',
      correct: !!row.test_passed,
      kind: row.test_passed ? 'quest_pass' : 'quest_attempt'
    }));
  } catch (e) {
    console.warn('getRecentVocabActivity', e.message || e);
    return [];
  }
}

/** Admin/ops diagnostics for Vocab engine wiring. */
async function getVocabEngineInfo() {
  wire();
  let supabaseOk = false;
  let errMsg = null;
  try {
    const { getSupabase, isSupabaseEnabled } = require(path.join(VENDOR_SRC, 'supabaseClient.js'));
    if (!isSupabaseEnabled()) {
      return {
        ok: false,
        tenantId: TENANT_ID,
        engine: 'vendor/mrpark-vocab',
        error: 'Supabase disabled'
      };
    }
    const db = getSupabase();
    const { error } = await db
      .from('vocab_student_state')
      .select('student_id')
      .eq('tenant_id', TENANT_ID)
      .limit(1);
    if (error) throw new Error(error.message);
    supabaseOk = true;
  } catch (e) {
    errMsg = e.message || String(e);
  }
  return {
    ok: supabaseOk,
    tenantId: TENANT_ID,
    engine: 'vendor/mrpark-vocab',
    vendorPath: VENDOR_SRC,
    skipLuckyDraw: true,
    sheetsVocabRetired: true,
    autoPromoteAt400: false,
    promotionTest: true,
    centralApiBase: String(process.env.VOCAB_CENTRAL_API_BASE || '').trim() || null,
    engineGaps: [
      'Dual-Process / stealth-review surfaces (confirm in Mr.Park engine chat)',
      'Sunday dollar dungeon (Mr.Park engine chat)',
      'Complete /api/vocab/v1 proxy including promotion-test (Mr.Park engine chat)'
    ],
    error: errMsg
  };
}

module.exports = {
  wire,
  TENANT_ID,
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
  getPromotionTestStatus,
  startPromotionTest,
  submitPromotionTest,
  ackPromotionTest,
  getVocabEngineInfo,
  VENDOR_SRC,
  SERVER_SRC: VENDOR_SRC
};
