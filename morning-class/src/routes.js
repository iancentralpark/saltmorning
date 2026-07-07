const express = require('express');
const { isGeminiConfigured } = require('./services/geminiService');
const { loginStudent, loginParent, loginTeacher } = require('./services/authService');
const { requireRole } = require('./auth/tokenAuth');
const { getTeacherClasses, getClassRoster } = require('./services/teacherPortalService');
const { getAttendanceForDate, saveAttendance, getClassWorkData, upsertStudentRecord } = require('./services/attendanceService');
const {
  listPlannedAttendance,
  getPlannedAttendanceCalendar,
  createPlannedAttendance,
  cancelPlannedAttendance
} = require('./services/plannedAttendanceService');
const { getMonthlyReport } = require('./services/reportService');
const {
  loadMessagesForStudent,
  sendMessage,
  markMessagesRead,
  lookupStudentName,
  getClassLabel
} = require('./services/messageService');
const { listParentAnnouncements } = require('./services/parentAnnouncementService');
const {
  listDailyGrades,
  saveDailyGrades,
  listReportCardFields,
  listReportCardEntries,
  saveReportCardEntries,
  buildReportCardSummary
} = require('./services/gradeService');
const { listLessonPlans, getLessonPlan, saveLessonPlan } = require('./services/lessonPlanService');
const { getBuddyStatus, askEnglishBuddy } = require('./services/englishBuddyService');
const { todayStr } = require('./dateUtils');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'salt-morning-class',
    gemini: isGeminiConfigured()
  });
});

router.post('/auth/student/login', async (req, res) => {
  try {
    const result = await loginStudent(req.body.loginId, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Login failed.' });
  }
});

router.post('/auth/parent/login', async (req, res) => {
  try {
    const result = await loginParent(req.body.loginId, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Login failed.' });
  }
});

router.post('/auth/teacher/login', async (req, res) => {
  try {
    const result = await loginTeacher(req.body.loginId, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Login failed.' });
  }
});

router.get('/teacher/classes', requireRole('teacher'), async (req, res) => {
  try {
    const data = await getTeacherClasses(req.session.teacherId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load classes.' });
  }
});

router.get('/teacher/class/:classId/roster', requireRole('teacher'), async (req, res) => {
  try {
    const students = await getClassRoster(req.params.classId);
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load roster.' });
  }
});

router.get('/teacher/class/:classId/work', requireRole('teacher'), async (req, res) => {
  try {
    const data = await getClassWorkData(req.params.classId, req.query.date);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load class work.' });
  }
});

router.post('/teacher/class/:classId/attendance/record', requireRole('teacher'), async (req, res) => {
  try {
    const { studentId, date, attendance, vocabScore, excuse } = req.body || {};
    if (!studentId || !date || !attendance) {
      return res.status(400).json({ error: 'studentId, date, and attendance are required.' });
    }
    const result = await upsertStudentRecord(
      req.params.classId,
      studentId,
      date,
      attendance,
      vocabScore,
      excuse
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save record.' });
  }
});

router.get('/teacher/class/:classId/planned-attendance', requireRole('teacher'), async (req, res) => {
  try {
    const items = await listPlannedAttendance(req.params.classId, req.query.studentId);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load planned attendance.' });
  }
});

router.get('/teacher/class/:classId/planned-attendance/calendar', requireRole('teacher'), async (req, res) => {
  try {
    const { studentId, year, month } = req.query;
    const data = await getPlannedAttendanceCalendar(
      req.params.classId,
      studentId,
      year,
      month
    );
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load calendar.' });
  }
});

router.post('/teacher/class/:classId/planned-attendance', requireRole('teacher'), async (req, res) => {
  try {
    const { studentId, dateStr, type, note } = req.body || {};
    const result = await createPlannedAttendance(req.params.classId, studentId, dateStr, type, note);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save planned attendance.' });
  }
});

router.post('/teacher/class/:classId/planned-attendance/cancel', requireRole('teacher'), async (req, res) => {
  try {
    const result = await cancelPlannedAttendance(req.body.noticeId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not cancel notice.' });
  }
});

router.get('/teacher/class/:classId/monthly-report', requireRole('teacher'), async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const month = req.query.month || (new Date().getMonth() + 1);
    const data = await getMonthlyReport(req.params.classId, year, month);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not build report.' });
  }
});

router.get('/teacher/class/:classId/attendance', requireRole('teacher'), async (req, res) => {
  try {
    const data = await getAttendanceForDate(req.params.classId, req.query.date);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load attendance.' });
  }
});

router.post('/teacher/class/:classId/attendance', requireRole('teacher'), async (req, res) => {
  try {
    const result = await saveAttendance(req.params.classId, req.body.date || todayStr(), req.body.records);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save attendance.' });
  }
});

router.get('/teacher/class/:classId/grades/daily', requireRole('teacher'), async (req, res) => {
  try {
    const grades = await listDailyGrades(req.params.classId, req.query.date, req.query.subject);
    res.json({ grades });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load grades.' });
  }
});

router.post('/teacher/class/:classId/grades/daily', requireRole('teacher'), async (req, res) => {
  try {
    const result = await saveDailyGrades(
      req.params.classId,
      req.body.date || todayStr(),
      req.body.subject,
      req.session.teacherId,
      req.body.entries || []
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save grades.' });
  }
});

router.get('/teacher/class/:classId/report-card', requireRole('teacher'), async (req, res) => {
  try {
    const classId = req.params.classId;
    const term = req.query.term || 'Term1';
    const subject = req.query.subject || '';
    const students = await getClassRoster(classId);
    const fields = await listReportCardFields(classId, term);
    const filteredFields = subject ? fields.filter((f) => f.subject === subject) : fields;
    const entries = await listReportCardEntries(classId, term, null, subject || null);
    const summary = buildReportCardSummary(students, filteredFields, entries);
    res.json({ term, subject: subject || null, fields: filteredFields, summary });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load report card.' });
  }
});

router.post('/teacher/class/:classId/report-card', requireRole('teacher'), async (req, res) => {
  try {
    const result = await saveReportCardEntries(
      req.params.classId,
      req.body.term,
      req.body.subject,
      req.session.teacherId,
      req.body.entries || []
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save report card.' });
  }
});

router.get('/teacher/lesson-plans', requireRole('teacher'), async (req, res) => {
  try {
    const plans = await listLessonPlans(req.session.teacherId, req.query.classId);
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load lesson plans.' });
  }
});

router.get('/teacher/lesson-plans/:planId', requireRole('teacher'), async (req, res) => {
  try {
    const plan = await getLessonPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Lesson plan not found.' });
    res.json({ plan });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load lesson plan.' });
  }
});

router.post('/teacher/lesson-plans', requireRole('teacher'), async (req, res) => {
  try {
    const plan = await saveLessonPlan(req.session.teacherId, req.body || {});
    res.json({ plan });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save lesson plan.' });
  }
});

router.get('/student/messages', requireRole('student'), async (req, res) => {
  try {
    const messages = await loadMessagesForStudent(req.session.studentId);
    res.json({ messages, className: await getClassLabel(req.session.classId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load messages.' });
  }
});

router.post('/student/messages', requireRole('student'), async (req, res) => {
  try {
    const msg = await sendMessage({
      classId: req.session.classId,
      studentId: req.session.studentId,
      studentName: req.session.name,
      sender: 'student',
      body: req.body.body
    });
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send message.' });
  }
});

router.post('/student/messages/read', requireRole('student'), async (req, res) => {
  try {
    const count = await markMessagesRead(req.session.studentId, 'teacher');
    res.json({ marked: count });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not update messages.' });
  }
});

router.get('/student/english-buddy/status', requireRole('student'), (req, res) => {
  res.json(getBuddyStatus(req.session.studentId));
});

router.post('/student/english-buddy', requireRole('student'), async (req, res) => {
  try {
    const result = await askEnglishBuddy(req.session.studentId, req.body.message, req.body.history);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not reach AI English Buddy.' });
  }
});

router.get('/parent/announcements', requireRole('parent'), async (req, res) => {
  try {
    const announcements = await listParentAnnouncements();
    res.json({ announcements });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load announcements.' });
  }
});

router.get('/parent/messages', requireRole('parent'), async (req, res) => {
  try {
    const messages = await loadMessagesForStudent(req.session.studentId);
    res.json({
      messages,
      studentName: await lookupStudentName(req.session.studentId),
      className: await getClassLabel(req.session.classId)
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load messages.' });
  }
});

router.post('/parent/messages', requireRole('parent'), async (req, res) => {
  try {
    const studentName = await lookupStudentName(req.session.studentId);
    const msg = await sendMessage({
      classId: req.session.classId,
      studentId: req.session.studentId,
      studentName: studentName + ' (parent: ' + req.session.name + ')',
      sender: 'parent',
      body: req.body.body
    });
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send message.' });
  }
});

module.exports = router;
