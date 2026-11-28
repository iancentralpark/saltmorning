'use strict';

/** /api/sat — SAT question bank: PDF import and review. Mounted behind requireRole('teacher', 'admin'). */

const express = require('express');
const satImport = require('./services/sat/satImportService');
const satQuestions = require('./services/sat/satQuestionService');
const satExtract = require('./services/sat/satExtract');
const taxonomy = require('./services/sat/satTaxonomy');
const { isAdminPortalRole } = require('./auth/tokenAuth');

const router = express.Router();

function userKey(req) {
  const s = req.session || {};
  return String(s.teacherId || s.adminId || s.userId || s.email || 'anon');
}

function fail(res, e, fallback) {
  const status = e && e.statusCode ? e.statusCode : 500;
  if (status >= 500) console.warn('[sat]', e && e.message);
  res.status(status).json({ error: (e && e.statusCode && e.message) || fallback || '요청을 처리하지 못했습니다.' });
}

function sendImage(res, image) {
  res.set('Content-Type', image.mime || 'image/png');
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(image.data);
}

router.get('/meta', (req, res) => {
  res.json({
    taxonomy: taxonomy.publicTaxonomy(),
    difficulties: taxonomy.DIFFICULTIES,
    chunkBytes: satImport.CHUNK_BYTES,
    maxPdfBytes: satImport.MAX_PDF_BYTES,
    sampleUnits: satImport.SAMPLE_UNITS,
    claudeConfigured: satExtract.isConfigured(),
    model: satExtract.model()
  });
});

// --- imports ---------------------------------------------------------------

router.get('/imports', async (req, res) => {
  try {
    res.json({ jobs: await satImport.listJobs() });
  } catch (e) { fail(res, e, '가져오기 목록을 불러오지 못했습니다.'); }
});

router.post('/imports', async (req, res) => {
  try {
    res.json(await satImport.createJob(req.body || {}, userKey(req)));
  } catch (e) { fail(res, e, '업로드를 시작하지 못했습니다.'); }
});

router.put(
  '/imports/:id/chunks/:idx',
  express.raw({ type: () => true, limit: satImport.CHUNK_BYTES + 1024 }),
  async (req, res) => {
    try {
      res.json(await satImport.putChunk(req.params.id, req.params.idx, req.body));
    } catch (e) { fail(res, e, '파일 조각을 저장하지 못했습니다.'); }
  }
);

router.post('/imports/:id/complete', async (req, res) => {
  try {
    res.json(await satImport.completeUpload(req.params.id));
  } catch (e) { fail(res, e, '업로드를 마치지 못했습니다.'); }
});

router.get('/imports/:id', async (req, res) => {
  try {
    res.json(await satImport.publicJob(req.params.id));
  } catch (e) { fail(res, e); }
});

router.post('/imports/:id/start', async (req, res) => {
  try {
    res.json(await satImport.startJob(req.params.id));
  } catch (e) { fail(res, e, '변환을 시작하지 못했습니다.'); }
});

router.post('/imports/:id/pause', async (req, res) => {
  try {
    res.json(await satImport.pauseJob(req.params.id));
  } catch (e) { fail(res, e); }
});

router.post('/imports/:id/retry-failed', async (req, res) => {
  try {
    res.json(await satImport.retryFailed(req.params.id));
  } catch (e) { fail(res, e); }
});

router.get('/imports/:id/failed', async (req, res) => {
  try {
    res.json({ units: await satImport.failedUnits(req.params.id) });
  } catch (e) { fail(res, e); }
});

router.delete('/imports/:id', async (req, res) => {
  try {
    const job = await satImport.publicJob(req.params.id);
    const role = req.session && req.session.role;
    if (!isAdminPortalRole(role) && job.createdBy !== userKey(req)) {
      return res.status(403).json({ error: '올린 사람이나 관리자만 삭제할 수 있습니다.' });
    }
    res.json(await satImport.deleteJob(req.params.id));
  } catch (e) { fail(res, e, '삭제하지 못했습니다.'); }
});

router.get('/imports/:id/pages/:page', async (req, res) => {
  try {
    sendImage(res, await satImport.pageImage(req.params.id, req.params.page, req.query.edge));
  } catch (e) { fail(res, e, '원본 쪽을 불러오지 못했습니다.'); }
});

// --- questions -------------------------------------------------------------

router.get('/questions', async (req, res) => {
  try {
    res.json(await satQuestions.listQuestions(req.query || {}));
  } catch (e) { fail(res, e, '문항 목록을 불러오지 못했습니다.'); }
});

router.post('/questions/approve-clean', async (req, res) => {
  try {
    res.json(await satQuestions.approveClean(req.body || {}, userKey(req)));
  } catch (e) { fail(res, e); }
});

router.get('/questions/:id', async (req, res) => {
  try {
    res.json(await satQuestions.getQuestion(req.params.id));
  } catch (e) { fail(res, e); }
});

router.put('/questions/:id', async (req, res) => {
  try {
    res.json(await satQuestions.updateQuestion(req.params.id, req.body || {}));
  } catch (e) { fail(res, e, '저장하지 못했습니다.'); }
});

router.post('/questions/:id/status', async (req, res) => {
  try {
    res.json(await satQuestions.setStatus(req.params.id, String((req.body || {}).status || ''), userKey(req)));
  } catch (e) { fail(res, e); }
});

router.post('/questions/:id/reconvert', async (req, res) => {
  try {
    res.json(await satImport.reconvertQuestion(req.params.id));
  } catch (e) { fail(res, e, '다시 변환하지 못했습니다.'); }
});

router.post('/questions/:id/assets', async (req, res) => {
  try {
    res.json(await satQuestions.cropAsset(req.params.id, req.body || {}));
  } catch (e) { fail(res, e, '그림을 저장하지 못했습니다.'); }
});

router.delete('/questions/:id/assets/:ref', async (req, res) => {
  try {
    res.json(await satQuestions.deleteAsset(req.params.id, req.params.ref));
  } catch (e) { fail(res, e); }
});

router.get('/assets/:id', async (req, res) => {
  try {
    sendImage(res, await satQuestions.assetData(req.params.id));
  } catch (e) { fail(res, e); }
});

module.exports = router;
