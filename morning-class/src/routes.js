const express = require('express');
const multer = require('multer');
const { isGeminiConfigured } = require('./services/geminiService');
const { notifyNewMessage, notifyThreadRead } = require('./realtime');
const { loginStudent, loginParent, loginTeacher, loginAdmin } = require('./services/authService');
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
  getClassLabel,
  listThreadsForSession,
  getThreadMessages,
  sendThreadMessage,
  markThreadRead,
  getUnreadCount
} = require('./services/messageService');
const { listParentAnnouncements } = require('./services/parentAnnouncementService');
const {
  listDailyGrades,
  saveDailyGrades,
  listGradeEntries,
  saveGradeEntries,
  getGradesDashboard,
  getGradebook,
  createAssessment,
  saveAssessmentCell,
  deleteAssessment,
  listAssessments,
  syncReportCardFromGrades,
  buildReportCardFromGrades
} = require('./services/gradeService');
const {
  listReportCardFields,
  listReportCardEntries,
  saveReportCardEntries,
  buildReportCardSummary
} = require('./services/reportCardService');
const {
  getActiveTerm,
  saveGradeTerm,
  listGradeWeights,
  saveGradeWeights,
  getCategoryPresets
} = require('./services/gradeWeightService');
const {
  listLessonPlans,
  getLessonPlan,
  saveLessonPlan,
  getLessonCalendar,
  getAdminLessonCalendar
} = require('./services/lessonPlanService');
const {
  getAdminOverview,
  listTeachers,
  saveTeacher,
  listAllGradeTerms,
  getMonitoringFeed,
  listClasses
} = require('./services/adminService');
const {
  listTeacherSubjectGroups,
  addTeacherSubject,
  removeTeacherSubject,
  listAdminClassAssignments,
  saveAdminClassAssignment,
  deleteAdminClassAssignment,
  assertTeacherClassAccess
} = require('./services/subjectAssignmentService');
const {
  listStudents,
  getStudent,
  saveStudent,
  listStudentsForTeacher,
  getStudentForTeacher,
  saveStudentPhoto,
  ensureRegistrySheets
} = require('./services/studentRegistryService');
const {
  listClassesDetailed,
  getClassDetail,
  saveClass,
  listAvailableStudents,
  importStudentToClass,
  removeStudentFromClass
} = require('./services/classRegistryService');
const {
  ensureTimetableSheet,
  listSubjects,
  getTimetable,
  saveTimetable,
  getStudentTimetableForTeacher
} = require('./services/timetableService');
const { getBellSchedule, saveBellSchedule } = require('./services/bellScheduleService');
const {
  listRequirementsWithClassNames,
  saveRequirements,
  importRequirementsFromAssignments
} = require('./services/timetableRequirementsService');
const { generateClassTimetable } = require('./services/timetableGenerateService');
const { saveTeacherSubjectStyle } = require('./services/subjectStyleService');
const { todayStr } = require('./dateUtils');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Photo must be JPEG, PNG, or WebP.'), ok);
  }
});

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

router.post('/auth/admin/login', async (req, res) => {
  try {
    const result = await loginAdmin(req.body.loginId, req.body.password);
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
    const { studentId, date, attendance, excuse } = req.body || {};
    if (!studentId || !date || !attendance) {
      return res.status(400).json({ error: 'studentId, date, and attendance are required.' });
    }
    const result = await upsertStudentRecord(
      req.params.classId,
      studentId,
      date,
      attendance,
      '',
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
    const { studentId, startDateStr, endDateStr, dateStr, type, note } = req.body || {};
    const start = startDateStr || dateStr;
    const result = await createPlannedAttendance(
      req.params.classId,
      studentId,
      start,
      endDateStr || start,
      type,
      note
    );
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

router.get('/teacher/class/:classId/grades/presets', requireRole('teacher'), (req, res) => {
  res.json({ presets: getCategoryPresets() });
});

router.get('/teacher/class/:classId/grades/active-term', requireRole('teacher'), async (req, res) => {
  try {
    const term = await getActiveTerm(req.params.classId);
    if (!term) {
      return res.json({ term: null, message: 'No term configured. Contact admin.' });
    }
    res.json({ term });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load active term.' });
  }
});

router.get('/teacher/class/:classId/grades/weights', requireRole('teacher'), async (req, res) => {
  try {
    const weights = await listGradeWeights(req.params.classId, req.query.term, req.query.subject);
    const totalPercent = weights.reduce((s, w) => s + w.weightPercent, 0);
    res.json({ weights, totalPercent, presets: getCategoryPresets() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load grade weights.' });
  }
});

router.post('/teacher/class/:classId/grades/weights', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject, weights } = req.body || {};
    const result = await saveGradeWeights(req.params.classId, term, subject, weights || []);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save grade weights.' });
  }
});

router.get('/teacher/class/:classId/grades/gradebook', requireRole('teacher'), async (req, res) => {
  try {
    const classId = req.params.classId;
    const term = req.query.term || 'Term1';
    const subject = req.query.subject || '';
    if (!subject) return res.status(400).json({ error: 'subject is required.' });
    const students = await getClassRoster(classId);
    const book = await getGradebook(classId, term, subject, students);
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load gradebook.' });
  }
});

router.post('/teacher/class/:classId/grades/gradebook/column', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject, categoryKey, title, date, maxScore } = req.body || {};
    const column = await createAssessment(
      req.params.classId,
      term,
      subject,
      req.session.teacherId,
      { categoryKey, title, date, maxScore }
    );
    res.json({ column });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not add column.' });
  }
});

router.delete('/teacher/class/:classId/grades/gradebook/column/:assessmentId', requireRole('teacher'), async (req, res) => {
  try {
    const result = await deleteAssessment(
      req.params.assessmentId,
      req.params.classId,
      req.query.term,
      req.query.subject
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete column.' });
  }
});

router.post('/teacher/class/:classId/grades/gradebook/cell', requireRole('teacher'), async (req, res) => {
  try {
    const { assessmentId, studentId, score, subject, term } = req.body || {};
    const result = await saveAssessmentCell(
      assessmentId,
      studentId,
      score,
      req.session.teacherId,
      { classId: req.params.classId, subject, term }
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save score.' });
  }
});

router.get('/teacher/class/:classId/grades', requireRole('teacher'), async (req, res) => {
  try {
    const classId = req.params.classId;
    const term = req.query.term || 'Term1';
    const subject = req.query.subject || '';
    if (!subject) return res.status(400).json({ error: 'subject is required.' });
    const students = await getClassRoster(classId);
    const dashboard = await getGradesDashboard(classId, term, subject, students);
    const logCategory = req.query.category || '';
    const log = await listGradeEntries(classId, {
      term,
      subject,
      categoryKey: logCategory || undefined,
      limit: Number(req.query.limit) || 100
    });
    res.json({ ...dashboard, log });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load grades.' });
  }
});

router.post('/teacher/class/:classId/grades/entries', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject, date, categoryKey, maxScore, entries } = req.body || {};
    const result = await saveGradeEntries(
      req.params.classId,
      term,
      subject,
      req.session.teacherId,
      date || todayStr(),
      categoryKey,
      maxScore,
      entries || []
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save grades.' });
  }
});

router.post('/teacher/class/:classId/grades/sync-report', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject } = req.body || {};
    const students = await getClassRoster(req.params.classId);
    const result = await syncReportCardFromGrades(
      req.params.classId,
      term,
      subject,
      req.session.teacherId,
      students
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not sync report card.' });
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
    const computed = subject
      ? await buildReportCardFromGrades(classId, term, subject, students)
      : [];
    const fields = await listReportCardFields(classId, term);
    const filteredFields = subject ? fields.filter((f) => f.subject === subject) : fields;
    const entries = await listReportCardEntries(classId, term, null, subject || null);
    const summary = buildReportCardSummary(students, filteredFields, entries);
    const weights = subject ? await listGradeWeights(classId, term, subject) : [];
    res.json({
      term,
      subject: subject || null,
      fields: filteredFields,
      summary,
      computed,
      weights,
      weightTotal: weights.reduce((s, w) => s + w.weightPercent, 0)
    });
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

router.get('/teacher/class-subjects', requireRole('teacher'), async (req, res) => {
  try {
    const data = await listTeacherSubjectGroups(req.session.teacherId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load subjects.' });
  }
});

router.post('/teacher/class-subjects', requireRole('teacher'), async (req, res) => {
  try {
    const { classId, subject } = req.body || {};
    const result = await addTeacherSubject(req.session.teacherId, classId, subject);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not add subject.' });
  }
});

router.delete('/teacher/class-subjects', requireRole('teacher'), async (req, res) => {
  try {
    const { classId, subject } = req.body || {};
    const result = await removeTeacherSubject(req.session.teacherId, classId, subject);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not remove subject.' });
  }
});

router.put('/teacher/subject-styles', requireRole('teacher'), async (req, res) => {
  try {
    const { classId, subject, bg, border } = req.body || {};
    await assertTeacherClassAccess(req.session.teacherId, classId);
    const result = await saveTeacherSubjectStyle(
      req.session.teacherId,
      classId,
      subject,
      bg,
      border
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save subject color.' });
  }
});

router.get('/teacher/lesson-plans/calendar', requireRole('teacher'), async (req, res) => {
  try {
    const { year, month, classId } = req.query;
    const data = await getLessonCalendar(
      req.session.teacherId,
      year,
      month,
      classId || ''
    );
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load lesson calendar.' });
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
      studentName,
      sender: 'parent',
      senderName: req.session.name + ' (parent)',
      body: req.body.body
    });
    res.json({ message: msg });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send message.' });
  }
});

router.get('/messenger/threads', requireRole('student', 'parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const data = await listThreadsForSession(req.session);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load conversations.' });
  }
});

router.get('/messenger/unread', requireRole('student', 'parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const count = await getUnreadCount(req.session);
    res.json({ unread: count });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load unread count.' });
  }
});

router.get('/messenger/threads/:threadId', requireRole('student', 'parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const messages = await getThreadMessages(req.params.threadId, req.session);
    res.json({ messages });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load messages.' });
  }
});

router.post('/messenger/threads/:threadId', requireRole('student', 'parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const message = await sendThreadMessage(req.params.threadId, req.session, req.body.body);
    notifyNewMessage(req.params.threadId, message);
    res.json({ message });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not send message.' });
  }
});

router.post('/messenger/threads/:threadId/read', requireRole('student', 'parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const marked = await markThreadRead(req.params.threadId, req.session.role);
    notifyThreadRead(req.params.threadId, req.session.role);
    res.json({ marked });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not mark read.' });
  }
});

router.get('/admin/class-assignments', requireRole('admin'), async (req, res) => {
  try {
    const assignments = await listAdminClassAssignments();
    res.json({ assignments });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load assignments.' });
  }
});

router.post('/admin/class-assignments', requireRole('admin'), async (req, res) => {
  try {
    const result = await saveAdminClassAssignment(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save assignment.' });
  }
});

router.delete('/admin/class-assignments', requireRole('admin'), async (req, res) => {
  try {
    const result = await deleteAdminClassAssignment(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete assignment.' });
  }
});

router.get('/admin/lesson-plans/calendar', requireRole('admin'), async (req, res) => {
  try {
    const { year, month, classId, teacherId } = req.query;
    const data = await getAdminLessonCalendar(year, month, { classId, teacherId });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load lesson plans.' });
  }
});

router.get('/admin/lesson-plans/:planId', requireRole('admin'), async (req, res) => {
  try {
    const plan = await getLessonPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Lesson plan not found.' });
    res.json({ plan });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load lesson plan.' });
  }
});

router.get('/admin/overview', requireRole('admin'), async (req, res) => {
  try {
    res.json(await getAdminOverview());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load overview.' });
  }
});

router.get('/admin/monitoring', requireRole('admin'), async (req, res) => {
  try {
    const feed = await getMonitoringFeed({
      classId: req.query.classId,
      type: req.query.type,
      limit: req.query.limit
    });
    res.json({ feed });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load monitoring feed.' });
  }
});

router.get('/admin/teachers', requireRole('admin'), async (req, res) => {
  try {
    res.json({ teachers: await listTeachers() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load teachers.' });
  }
});

router.post('/admin/teachers', requireRole('admin'), async (req, res) => {
  try {
    const teacher = await saveTeacher(req.body || {});
    res.json({ teacher });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save teacher.' });
  }
});

router.get('/admin/classes', requireRole('admin'), async (req, res) => {
  try {
    if (req.query.detailed === '1' || req.query.detailed === 'true') {
      res.json({ classes: await listClassesDetailed() });
    } else {
      res.json({ classes: await listClasses() });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load classes.' });
  }
});

router.get('/admin/classes/:classId', requireRole('admin'), async (req, res) => {
  try {
    res.json({ class: await getClassDetail(req.params.classId) });
  } catch (e) {
    res.status(e.message === 'Class not found.' ? 404 : 500).json({ error: e.message });
  }
});

router.post('/admin/classes', requireRole('admin'), async (req, res) => {
  try {
    const cls = await saveClass(req.body || {});
    res.json({ class: cls });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save class.' });
  }
});

router.get('/admin/classes/:classId/available-students', requireRole('admin'), async (req, res) => {
  try {
    const students = await listAvailableStudents({
      classId: req.params.classId,
      q: req.query.q
    });
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load students.' });
  }
});

router.post('/admin/classes/:classId/import-student', requireRole('admin'), async (req, res) => {
  try {
    const studentId = req.body && req.body.studentId;
    const cls = await importStudentToClass(req.params.classId, studentId);
    res.json({ class: cls });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not import student.' });
  }
});

router.post('/admin/classes/:classId/remove-student', requireRole('admin'), async (req, res) => {
  try {
    const studentId = req.body && req.body.studentId;
    const cls = await removeStudentFromClass(req.params.classId, studentId);
    res.json({ class: cls });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not remove student.' });
  }
});

router.get('/admin/terms', requireRole('admin'), async (req, res) => {
  try {
    res.json({ terms: await listAllGradeTerms() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load terms.' });
  }
});

router.post('/admin/terms', requireRole('admin'), async (req, res) => {
  try {
    const { classId, label, startDate, endDate } = req.body || {};
    const term = await saveGradeTerm(classId, label, startDate, endDate);
    res.json({ term });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save term.' });
  }
});

router.get('/admin/students', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const students = await listStudents({
      classId: req.query.classId,
      status: req.query.status,
      q: req.query.q
    });
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load students.' });
  }
});

router.get('/admin/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    res.json({ student: await getStudent(req.params.studentId) });
  } catch (e) {
    res.status(e.message === 'Student not found.' ? 404 : 500).json({ error: e.message });
  }
});

router.post('/admin/students', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const student = await saveStudent(req.body || {});
    res.json({ student });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save student.' });
  }
});

router.post('/admin/students/:studentId/photo', requireRole('admin'), (req, res, next) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}, async (req, res) => {
  try {
    const result = await saveStudentPhoto(req.params.studentId, req.file);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save photo.' });
  }
});

router.get('/teacher/students', requireRole('teacher'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const students = await listStudentsForTeacher(req.session.teacherId, {
      classId: req.query.classId,
      q: req.query.q
    });
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load students.' });
  }
});

router.get('/teacher/students/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const student = await getStudentForTeacher(req.session.teacherId, req.params.studentId);
    res.json({ student });
  } catch (e) {
    const code = e.message.includes('access') ? 403 : (e.message === 'Student not found.' ? 404 : 500);
    res.status(code).json({ error: e.message });
  }
});

router.get('/admin/timetable/subjects', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ subjects: await listSubjects() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load subjects.' });
  }
});

router.get('/admin/timetable/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('student', req.params.studentId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.post('/admin/timetable/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const timetable = await saveTimetable('student', req.params.studentId, req.body.entries || []);
    res.json({ timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save timetable.' });
  }
});

router.get('/admin/timetable/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('teacher', req.params.teacherId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.post('/admin/timetable/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const timetable = await saveTimetable('teacher', req.params.teacherId, req.body.entries || []);
    res.json({ timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save timetable.' });
  }
});

router.get('/teacher/timetable', requireRole('teacher'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({
      timetable: await getTimetable('teacher', req.session.teacherId)
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.get('/teacher/timetable/students/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({
      timetable: await getStudentTimetableForTeacher(req.session.teacherId, req.params.studentId)
    });
  } catch (e) {
    const code = e.message.includes('access') ? 403 : 500;
    res.status(code).json({ error: e.message });
  }
});

router.get('/admin/timetable/bell-schedule', requireRole('admin'), async (req, res) => {
  try {
    res.json(await getBellSchedule());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load bell schedule.' });
  }
});

router.post('/admin/timetable/bell-schedule', requireRole('admin'), async (req, res) => {
  try {
    const schedule = await saveBellSchedule(req.body.periods || []);
    res.json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save bell schedule.' });
  }
});

router.get('/admin/timetable/requirements', requireRole('admin'), async (req, res) => {
  try {
    const requirements = await listRequirementsWithClassNames(req.query.classId);
    res.json({ requirements });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load requirements.' });
  }
});

router.post('/admin/timetable/requirements', requireRole('admin'), async (req, res) => {
  try {
    const { classId, requirements } = req.body || {};
    const saved = await saveRequirements(classId, requirements || []);
    res.json({ requirements: saved });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save requirements.' });
  }
});

router.post('/admin/timetable/requirements/import', requireRole('admin'), async (req, res) => {
  try {
    const { classId } = req.body || {};
    const requirements = await importRequirementsFromAssignments(classId);
    res.json({ requirements });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not import requirements.' });
  }
});

router.get('/admin/timetable/classes/:classId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json({ timetable: await getTimetable('class', req.params.classId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load class timetable.' });
  }
});

router.post('/admin/timetable/generate', requireRole('admin'), async (req, res) => {
  try {
    const { classId } = req.body || {};
    const result = await generateClassTimetable(classId);
    const timetable = await getTimetable('class', classId);
    res.json({ result, timetable });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not generate timetable.' });
  }
});

router.get('/admin/timetable/solver-health', requireRole('admin'), async (req, res) => {
  try {
    const { TIMETABLE_SOLVER_URL } = require('./config');
    const url = (TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791').replace(/\/$/, '') + '/health';
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    res.json({ ok: r.ok, solver: data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
