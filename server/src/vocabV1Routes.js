/**
 * Vocab Booster public multi-tenant API (v1).
 *
 * Auth modes:
 *  - Student session JWT (minted via POST /session with tenant API secret)
 *  - Tenant API secret (server-to-server mint + admin overview)
 */
'use strict';

const express = require('express');
const {
  getPlacementMeta,
  scorePlacement,
  deepDiveWord,
  nextTargetFreq,
  updateAbility,
  shouldStopPlacement
} = require('./vocabPlacementService');
const {
  runWithTenantContext,
  savePlacementResult,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  getStudentVocabSummary,
  getClassOverview,
  buildPlacementItem
} = require('./vocabLearningService');
const {
  readBearerToken,
  getTenantById,
  getTenantByPublicKey,
  verifyTenantApiSecret,
  signStudentSession,
  verifyStudentSession,
  skipLuckyDrawForTenant
} = require('./vocabTenantService');

const router = express.Router();

function asyncHandler(fn) {
  return function wrapped(req, res) {
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error(req.method, req.originalUrl, e);
      const status = e.statusCode || (e.message && /required|invalid|login/i.test(e.message) ? 400 : 500);
      res.status(status).json({ error: e.message || 'Server error' });
    });
  };
}

function runAsTenant(tenant, fn) {
  return runWithTenantContext(
    {
      tenantId: tenant.id,
      skipLuckyDraw: skipLuckyDrawForTenant(tenant),
      features: tenant.features || {}
    },
    fn
  );
}

async function resolveTenantFromSecretRequest(req) {
  const secret = readBearerToken(req) || String(req.headers['x-vocab-secret'] || '').trim();
  const tenantId = String(
    req.headers['x-vocab-tenant-id'] ||
      (req.body && req.body.tenantId) ||
      (req.query && req.query.tenantId) ||
      ''
  ).trim();
  const publicKey = String(
    req.headers['x-vocab-public-key'] ||
      (req.body && req.body.publicKey) ||
      (req.query && req.query.publicKey) ||
      ''
  ).trim();

  if (!secret) {
    const err = new Error('Tenant API secret required (Authorization: Bearer <secret>).');
    err.statusCode = 401;
    throw err;
  }

  const tenant = await verifyTenantApiSecret(secret, {
    tenantId: tenantId || undefined,
    publicKey: publicKey || undefined
  });
  if (!tenant) {
    // If only secret was sent, try matching by scanning is not allowed — require id or public key.
    if (!tenantId && !publicKey) {
      const err = new Error('Provide X-Vocab-Tenant-Id or X-Vocab-Public-Key with the API secret.');
      err.statusCode = 401;
      throw err;
    }
    const err = new Error('Invalid tenant credentials.');
    err.statusCode = 401;
    throw err;
  }
  return tenant;
}

async function requireStudentSession(req, res, next) {
  try {
    const token = readBearerToken(req);
    const session = verifyStudentSession(token);
    if (!session) {
      return res.status(401).json({ error: 'Valid Vocab session required.' });
    }
    const tenant = await getTenantById(session.tenantId);
    if (!tenant || !tenant.active) {
      return res.status(401).json({ error: 'Tenant inactive or unknown.' });
    }
    req.vocabSession = session;
    req.vocabTenant = tenant;
    next();
  } catch (e) {
    console.error('requireStudentSession', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
}

function withStudentTenant(handler) {
  return asyncHandler(async (req, res) => {
    await runAsTenant(req.vocabTenant, () => handler(req, res));
  });
}

/** Health / discovery for embed boot (no auth). */
router.get('/meta', asyncHandler(async (req, res) => {
  const publicKey = String(req.query.publicKey || '').trim();
  let tenant = null;
  if (publicKey) {
    tenant = await getTenantByPublicKey(publicKey);
    if (!tenant || !tenant.active) {
      return res.status(404).json({ error: 'Unknown public key.' });
    }
  }
  res.json({
    api: 'vocab-booster',
    version: 1,
    placement: getPlacementMeta(),
    tenant: tenant
      ? {
          id: tenant.id,
          name: tenant.name,
          publicKey: tenant.publicKey,
          features: tenant.features
        }
      : null
  });
}));

/**
 * Mint a student session JWT (host server → central).
 * Auth: tenant API secret + tenant id or public key.
 */
router.post('/session', asyncHandler(async (req, res) => {
  const tenant = await resolveTenantFromSecretRequest(req);
  const body = req.body || {};
  const studentId = String(body.studentId || '').trim();
  const classId = String(body.classId || '').trim();
  if (!studentId || !classId) {
    return res.status(400).json({ error: 'studentId and classId are required.' });
  }
  const minted = signStudentSession({
    tenantId: tenant.id,
    studentId,
    classId,
    name: body.name
  });

  let summary = null;
  try {
    summary = await runAsTenant(tenant, () =>
      getStudentVocabSummary(studentId, classId)
    );
  } catch (e) {
    console.warn('v1 session summary', e.message || e);
  }

  res.json({
    token: minted.token,
    expiresAt: minted.expiresAt,
    session: minted.session,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      publicKey: tenant.publicKey,
      features: tenant.features
    },
    summary
  });
}));

/** Validate embed JWT → summary (same shape as legacy /student/vocab/summary). */
router.get('/session', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  const summary = await getStudentVocabSummary(studentId, classId);
  res.json({
    session: {
      tenantId: req.vocabSession.tenantId,
      studentId,
      classId,
      name: req.vocabSession.name,
      exp: req.vocabSession.exp
    },
    tenant: {
      id: req.vocabTenant.id,
      name: req.vocabTenant.name,
      publicKey: req.vocabTenant.publicKey,
      features: req.vocabTenant.features
    },
    summary
  });
}));

/** Alias used by embed path rewrite of /student/vocab/summary */
router.get('/summary', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  res.json(await getStudentVocabSummary(studentId, classId));
}));

router.get('/placement/meta', requireStudentSession, withStudentTenant(async (req, res) => {
  res.json(getPlacementMeta());
}));

router.post('/placement/score', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  const result = scorePlacement(req.body || {});
  try {
    await savePlacementResult(studentId, classId, result);
  } catch (persistErr) {
    console.error('v1 savePlacementResult', persistErr.message || persistErr);
    result.persisted = false;
  }
  res.json(result);
}));

router.post('/placement/next', requireStudentSession, withStudentTenant(async (req, res) => {
  const body = req.body || {};
  const ability = updateAbility(body.abilityGrade, {
    correct: !!body.correct,
    seconds: body.seconds,
    questionType: body.questionType,
    frequencyLevel: body.frequencyLevel != null ? body.frequencyLevel : body.targetGrade
  });
  const abilityTrail = Array.isArray(body.abilityTrail)
    ? body.abilityTrail.map(Number).concat([ability])
    : [ability];
  res.json({
    abilityGrade: ability,
    nextTargetGrade: nextTargetFreq(ability, Number(body.questionIndex) || 0),
    stop: shouldStopPlacement(abilityTrail),
    abilityTrail
  });
}));

router.post('/placement/item', requireStudentSession, withStudentTenant(async (req, res) => {
  const body = req.body || {};
  const item = await buildPlacementItem({
    abilityGrade: body.abilityGrade,
    questionIndex: body.questionIndex,
    avoidWordIds: body.avoidWordIds,
    abilityTrail: body.abilityTrail
  });
  res.json(item);
}));

router.post('/deep-dive', requireStudentSession, withStudentTenant(async (req, res) => {
  const body = req.body || {};
  res.json(await deepDiveWord({
    word: body.word,
    partOfSpeech: body.partOfSpeech || body.part_of_speech,
    focus: body.focus,
    levelHint: body.levelHint,
    studentLevel: body.studentLevel
  }));
}));

router.get('/daily-queue', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  res.json(await getDailyQueue(studentId, classId));
}));

router.post('/review', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  const body = req.body || {};
  res.json(await recordReview(studentId, classId, body.wordId, !!body.correct));
}));

router.post('/daily-test/submit', requireStudentSession, withStudentTenant(async (req, res) => {
  const { studentId, classId } = req.vocabSession;
  const body = req.body || {};
  if (Array.isArray(body.answers)) {
    for (const a of body.answers) {
      if (!a || !a.wordId || !a.correct) continue;
      try {
        await recordReview(studentId, classId, a.wordId, true);
      } catch (err) {
        console.warn('v1 daily-test answer sync', err.message || err);
      }
    }
  }
  res.json(await recordDailyTestResult(
    studentId,
    classId,
    body.correctCount,
    body.totalCount,
    body.answers
  ));
}));

/** Tenant admin overview (server-to-server with API secret). */
router.get('/admin/overview', asyncHandler(async (req, res) => {
  const tenant = await resolveTenantFromSecretRequest(req);
  const classId = String(req.query.classId || '').trim();
  if (!classId) return res.status(400).json({ error: 'classId query required.' });
  const overview = await runAsTenant(tenant, () => getClassOverview(classId));
  res.json({ tenant: { id: tenant.id, name: tenant.name }, overview });
}));

module.exports = router;
