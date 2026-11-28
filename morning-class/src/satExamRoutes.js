'use strict';

/** /api/sat-exam — the student's side of the SAT mock test (also used for teacher previews). */

const express = require('express');
const satExam = require('./services/sat/satExamService');
const { requireRole } = require('./auth/tokenAuth');

const router = express.Router();

function fail(res, e, fallback) {
  const status = e && e.statusCode ? e.statusCode : 500;
  if (status >= 500) console.warn('[sat-exam]', e && e.message);
  res.status(status).json({ error: (e && e.statusCode && e.message) || fallback || '요청을 처리하지 못했습니다.' });
}

function who(req) {
  const s = req.session || {};
  if (s.role === 'student') {
    return { role: 'student', studentId: String(s.studentId || ''), classId: String(s.classId || ''), name: String(s.name || ''), key: String(s.studentId || '') };
  }
  return {
    role: 'staff',
    key: String(s.teacherId || s.adminId || s.userId || s.email || 'anon'),
    name: String(s.name || s.teacherName || '선생님')
  };
}

const anyone = requireRole('student', 'teacher', 'admin');

router.get('/my', requireRole('student'), async (req, res) => {
  try {
    res.json({ assignments: await satExam.myAssignments(who(req)) });
  } catch (e) { fail(res, e, '시험 목록을 불러오지 못했습니다.'); }
});

router.post('/assignments/:id/start', requireRole('student'), async (req, res) => {
  try {
    res.json(await satExam.startAssignment(req.params.id, who(req)));
  } catch (e) { fail(res, e, '시험을 시작하지 못했습니다.'); }
});

router.get('/sessions/:id', anyone, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await satExam.getSessionState(req.params.id, who(req)));
  } catch (e) { fail(res, e); }
});

router.post('/sessions/:id/start-step', anyone, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await satExam.startStep(req.params.id, who(req), (req.body || {}).step));
  } catch (e) { fail(res, e); }
});

router.post('/sessions/:id/save', anyone, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await satExam.saveAnswers(req.params.id, who(req), (req.body || {}).items));
  } catch (e) { fail(res, e); }
});

router.post('/sessions/:id/submit', anyone, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const b = req.body || {};
    res.json(await satExam.submitModule(req.params.id, who(req), b.items, b.step));
  } catch (e) { fail(res, e); }
});

router.get('/sessions/:id/assets/:assetId', anyone, async (req, res) => {
  try {
    const img = await satExam.assetForSession(req.params.id, req.params.assetId, who(req));
    res.set('Content-Type', img.mime || 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(img.data);
  } catch (e) { fail(res, e); }
});

module.exports = router;
