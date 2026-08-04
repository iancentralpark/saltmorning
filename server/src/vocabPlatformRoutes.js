/**
 * Central Vocab Booster platform admin API (/api/vocab/platform/*).
 * Auth: platform admin password → session cookie / Bearer token.
 */
'use strict';

const express = require('express');
const {
  issuePlatformAdminLogin,
  setPlatformAdminCookie,
  clearPlatformAdminCookie,
  requirePlatformAdminAuth,
  readPlatformAdminTokenFromRequest,
  verifyPlatformAdminToken
} = require('./vocabPlatformAuth');
const {
  listTenants,
  getTenantById,
  createTenant,
  updateTenant,
  rotateTenantApiSecret,
  getPlatformAnalytics
} = require('./vocabTenantService');
const {
  listPacks,
  getPack,
  createPack,
  updatePack,
  deletePack,
  setPackWords,
  addWordsToPackByGrade,
  listTenantPacks,
  setTenantPacks
} = require('./vocabCurriculumService');
const {
  getWordBankStats,
  listWords,
  bulkUpsertWords
} = require('./vocabLearningService');

const router = express.Router();

function asyncHandler(fn) {
  return function wrapped(req, res) {
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error(req.method, req.originalUrl, e);
      const status = e.statusCode || 500;
      res.status(status).json({ error: e.message || 'Server error' });
    });
  };
}

router.post('/login', asyncHandler(async (req, res) => {
  const token = issuePlatformAdminLogin(req.body && req.body.password);
  setPlatformAdminCookie(res, req, token);
  res.json({ ok: true, token });
}));

router.post('/logout', (req, res) => {
  clearPlatformAdminCookie(res, req);
  res.json({ ok: true });
});

router.get('/session', (req, res) => {
  const token = readPlatformAdminTokenFromRequest(req);
  const session = verifyPlatformAdminToken(token);
  if (!session) return res.status(401).json({ error: 'Platform admin login required.' });
  res.json({ ok: true, token });
});

router.use(requirePlatformAdminAuth);

router.get('/analytics', asyncHandler(async (req, res) => {
  res.json(await getPlatformAnalytics());
}));

router.get('/tenants', asyncHandler(async (req, res) => {
  const tenants = await listTenants();
  res.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      publicKey: t.publicKey,
      features: t.features,
      active: t.active,
      hasSecret: !!t.secretHash
    }))
  });
}));

router.post('/tenants', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await createTenant({
    id: body.id,
    name: body.name,
    publicKey: body.publicKey,
    features: body.features,
    active: body.active
  });
  res.status(201).json({
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      publicKey: result.tenant.publicKey,
      features: result.tenant.features,
      active: result.tenant.active,
      hasSecret: true
    },
    secret: result.secret,
    warning: 'Store this API secret now — it will not be shown again.'
  });
}));

router.patch('/tenants/:tenantId', asyncHandler(async (req, res) => {
  const tenant = await updateTenant(req.params.tenantId, req.body || {});
  res.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      publicKey: tenant.publicKey,
      features: tenant.features,
      active: tenant.active,
      hasSecret: !!tenant.secretHash
    }
  });
}));

router.post('/tenants/:tenantId/rotate-secret', asyncHandler(async (req, res) => {
  const result = await rotateTenantApiSecret(req.params.tenantId);
  res.json({
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      publicKey: result.tenant.publicKey,
      features: result.tenant.features,
      active: result.tenant.active,
      hasSecret: true
    },
    secret: result.secret,
    warning: 'Store this API secret now — it will not be shown again.'
  });
}));

router.get('/tenants/:tenantId/packs', asyncHandler(async (req, res) => {
  res.json({ packs: await listTenantPacks(req.params.tenantId) });
}));

router.put('/tenants/:tenantId/packs', asyncHandler(async (req, res) => {
  const packIds = (req.body && req.body.packIds) || [];
  res.json({ packs: await setTenantPacks(req.params.tenantId, packIds) });
}));

router.get('/packs', asyncHandler(async (req, res) => {
  res.json({ packs: await listPacks() });
}));

router.post('/packs', asyncHandler(async (req, res) => {
  res.status(201).json({ pack: await createPack(req.body || {}) });
}));

router.get('/packs/:packId', asyncHandler(async (req, res) => {
  const pack = await getPack(req.params.packId);
  if (!pack) return res.status(404).json({ error: 'Pack not found' });
  res.json({ pack });
}));

router.patch('/packs/:packId', asyncHandler(async (req, res) => {
  res.json({ pack: await updatePack(req.params.packId, req.body || {}) });
}));

router.delete('/packs/:packId', asyncHandler(async (req, res) => {
  res.json(await deletePack(req.params.packId));
}));

router.put('/packs/:packId/words', asyncHandler(async (req, res) => {
  const wordIds = (req.body && req.body.wordIds) || [];
  res.json(await setPackWords(req.params.packId, wordIds));
}));

router.post('/packs/:packId/words/by-grade', asyncHandler(async (req, res) => {
  const gradeLevel = req.body && req.body.gradeLevel;
  res.json(await addWordsToPackByGrade(req.params.packId, gradeLevel));
}));

router.get('/words/stats', asyncHandler(async (req, res) => {
  res.json(await getWordBankStats());
}));

router.get('/words', asyncHandler(async (req, res) => {
  res.json(await listWords({
    search: req.query.search,
    limit: req.query.limit,
    offset: req.query.offset
  }));
}));

router.post('/words/bulk', asyncHandler(async (req, res) => {
  const words = (req.body && req.body.words) || req.body;
  res.json(await bulkUpsertWords(Array.isArray(words) ? words : []));
}));

router.get('/tenants/:tenantId', asyncHandler(async (req, res) => {
  const tenant = await getTenantById(req.params.tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const packs = await listTenantPacks(tenant.id);
  res.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      publicKey: tenant.publicKey,
      features: tenant.features,
      active: tenant.active,
      hasSecret: !!tenant.secretHash
    },
    packs
  });
}));

module.exports = router;
