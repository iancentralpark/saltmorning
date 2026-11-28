'use strict';

/** /api/sat — SAT question bank: PDF import and review. Mounted behind requireRole('teacher', 'admin'). */

const express = require('express');
const satImport = require('./services/sat/satImportService');
const satQuestions = require('./services/sat/satQuestionService');
const satExtract = require('./services/sat/satExtract');
const satExam = require('./services/sat/satExamService');
const satStats = require('./services/sat/satStatsService');
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

// --- test sets, assignments, and results ----------------------------------

function examUser(req) {
  const s = req.session || {};
  return { role: s.role, key: userKey(req), name: String(s.name || s.teacherName || '선생님') };
}

async function classesFor(req) {
  const portal = require('./services/teacherPortalService');
  if (req.session.role === 'teacher') {
    const data = await portal.getTeacherClasses(req.session.teacherId);
    const seen = new Map();
    []
      .concat(data.homeroom || [], data.assigned || [])
      .forEach((c) => { if (!seen.has(c.classId)) seen.set(c.classId, { classId: c.classId, className: c.className }); });
    return Array.from(seen.values()).sort((a, b) => a.className.localeCompare(b.className));
  }
  const names = await portal.getClassNameMap();
  return Object.keys(names)
    .map((id) => ({ classId: id, className: names[id] }))
    .sort((a, b) => a.className.localeCompare(b.className));
}

async function assertClassAccess(req, classId) {
  const list = await classesFor(req);
  const hit = list.find((c) => c.classId === String(classId));
  if (!hit) throw Object.assign(new Error('이 반을 맡고 있지 않습니다.'), { statusCode: 403 });
  return hit;
}

router.get('/sets', async (req, res) => {
  try {
    res.json({ sets: await satExam.listSets(), pool: await satExam.poolSummary() });
  } catch (e) { fail(res, e, '세트 목록을 불러오지 못했습니다.'); }
});

router.post('/sets', async (req, res) => {
  try {
    res.json(await satExam.createSet(req.body || {}, userKey(req)));
  } catch (e) { fail(res, e, '세트를 만들지 못했습니다.'); }
});

router.get('/sets/:id', async (req, res) => {
  try {
    res.json(await satExam.getSet(req.params.id));
  } catch (e) { fail(res, e); }
});

router.patch('/sets/:id', async (req, res) => {
  try {
    res.json(await satExam.updateSet(req.params.id, req.body || {}));
  } catch (e) { fail(res, e); }
});

router.delete('/sets/:id', async (req, res) => {
  try {
    res.json(await satExam.deleteSet(req.params.id));
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/compose', async (req, res) => {
  try {
    const notes = await satExam.composeSet(req.params.id, (req.body && req.body.module) || null);
    res.json(Object.assign(await satExam.getSet(req.params.id), { notes: notes }));
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/duplicate', async (req, res) => {
  try {
    res.json(await satExam.duplicateSet(req.params.id, userKey(req)));
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/publish', async (req, res) => {
  try {
    res.json(await satExam.publishSet(req.params.id));
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/unpublish', async (req, res) => {
  try {
    res.json(await satExam.unpublishSet(req.params.id));
  } catch (e) { fail(res, e); }
});

router.put('/sets/:id/items', async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await satExam.replaceItem(req.params.id, String(b.module || ''), b.position, b.questionId));
  } catch (e) { fail(res, e); }
});

router.delete('/sets/:id/items', async (req, res) => {
  try {
    res.json(await satExam.removeItem(req.params.id, String(req.query.module || ''), req.query.position));
  } catch (e) { fail(res, e); }
});

router.get('/sets/:id/candidates', async (req, res) => {
  try {
    res.json({
      questions: await satExam.candidates(req.params.id, String(req.query.module || ''), {
        domain: req.query.domain,
        difficulty: req.query.difficulty,
        search: req.query.search
      })
    });
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/preview', async (req, res) => {
  try {
    res.json(await satExam.startPreview(req.params.id, examUser(req), !!(req.body && req.body.fresh)));
  } catch (e) { fail(res, e, '미리보기를 시작하지 못했습니다.'); }
});

router.get('/classes', async (req, res) => {
  try {
    res.json({ classes: await classesFor(req) });
  } catch (e) { fail(res, e, '반 목록을 불러오지 못했습니다.'); }
});

router.get('/classes/:classId/roster', async (req, res) => {
  try {
    await assertClassAccess(req, req.params.classId);
    const { getClassRoster } = require('./services/teacherPortalService');
    res.json({ students: await getClassRoster(req.params.classId) });
  } catch (e) { fail(res, e, '학생 목록을 불러오지 못했습니다.'); }
});

router.post('/sets/:id/overlap', async (req, res) => {
  try {
    const b = req.body || {};
    let ids = Array.isArray(b.studentIds) ? b.studentIds : [];
    if (!ids.length && b.classId) {
      await assertClassAccess(req, b.classId);
      const { getClassRoster } = require('./services/teacherPortalService');
      ids = (await getClassRoster(b.classId)).map((s) => s.studentId);
    }
    res.json({ overlap: await satExam.overlap(req.params.id, ids) });
  } catch (e) { fail(res, e); }
});

router.post('/sets/:id/assign', async (req, res) => {
  try {
    const b = req.body || {};
    const cls = await assertClassAccess(req, b.classId);
    const { getClassRoster } = require('./services/teacherPortalService');
    const roster = await getClassRoster(cls.classId);
    let students = [];
    if (Array.isArray(b.studentIds) && b.studentIds.length) {
      const byId = new Map(roster.map((s) => [s.studentId, s]));
      students = b.studentIds.map((id) => byId.get(String(id))).filter(Boolean);
      if (students.length !== b.studentIds.length) {
        throw Object.assign(new Error('선택한 학생 중 이 반 학생이 아닌 사람이 있습니다.'), { statusCode: 400 });
      }
    }
    res.json(await satExam.createAssignments(req.params.id, {
      classId: cls.classId,
      className: cls.className,
      students: students,
      availableFrom: b.availableFrom,
      dueAt: b.dueAt
    }, userKey(req)));
  } catch (e) { fail(res, e, '시험을 부여하지 못했습니다.'); }
});

router.get('/assignments', async (req, res) => {
  try {
    let list = await satExam.listAssignments(req.query.setId);
    if (req.session.role === 'teacher') {
      const mine = new Set((await classesFor(req)).map((c) => c.classId));
      list = list.filter((a) => mine.has(a.classId));
    }
    res.json({ assignments: list });
  } catch (e) { fail(res, e); }
});

router.get('/assignments/:id', async (req, res) => {
  try {
    const detail = await satExam.assignmentDetail(req.params.id, null);
    await assertClassAccess(req, detail.assignment.classId);
    let roster = [];
    if (detail.assignment.targetType === 'class') {
      const { getClassRoster } = require('./services/teacherPortalService');
      roster = await getClassRoster(detail.assignment.classId);
    }
    res.json(await satExam.assignmentDetail(req.params.id, roster));
  } catch (e) { fail(res, e); }
});

router.delete('/assignments/:id', async (req, res) => {
  try {
    const detail = await satExam.assignmentDetail(req.params.id, null);
    await assertClassAccess(req, detail.assignment.classId);
    res.json(await satExam.removeAssignment(req.params.id));
  } catch (e) { fail(res, e); }
});

router.get('/sessions/:id/result', async (req, res) => {
  try {
    const out = await satExam.sessionResult(req.params.id);
    if (req.session.role === 'teacher' && !out.session.isPreview && out.session.classId) {
      await assertClassAccess(req, out.session.classId);
    }
    res.json(out);
  } catch (e) { fail(res, e); }
});

router.get('/score-tables', async (req, res) => {
  try {
    res.json({ tables: await satExam.getScoreTables() });
  } catch (e) { fail(res, e); }
});

router.put('/score-tables/:section/:route', async (req, res) => {
  try {
    if (!isAdminPortalRole(req.session.role)) {
      throw Object.assign(new Error('관리자만 환산표를 바꿀 수 있습니다.'), { statusCode: 403 });
    }
    res.json(await satExam.putScoreTable(req.params.section, req.params.route, (req.body || {}).points, userKey(req)));
  } catch (e) { fail(res, e); }
});

async function statsFilter(req) {
  const filter = { setId: req.query.setId || '', classId: req.query.classId || '' };
  if (req.session.role === 'teacher') {
    const mine = (await classesFor(req)).map((c) => c.classId);
    if (filter.classId && mine.indexOf(String(filter.classId)) < 0) {
      throw Object.assign(new Error('이 반을 맡고 있지 않습니다.'), { statusCode: 403 });
    }
    filter.classIds = mine;
  }
  return filter;
}

router.get('/stats/overview', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await satStats.overview(await statsFilter(req)));
  } catch (e) { fail(res, e, '통계를 불러오지 못했습니다.'); }
});

router.get('/stats/students/:studentId', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await satStats.studentReport(req.params.studentId, await statsFilter(req)));
  } catch (e) { fail(res, e, '학생 통계를 불러오지 못했습니다.'); }
});

module.exports = router;
