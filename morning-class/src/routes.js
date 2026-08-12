const express = require('express');
const multer = require('multer');
const { isGeminiConfigured } = require('./services/geminiService');
const { notifyNewMessage, notifyThreadRead } = require('./realtime');
const { loginStudent, loginParent, loginTeacher, loginAdmin, loginUnified, switchParentActiveChild, changePassword } = require('./services/authService');
const { requireRole } = require('./auth/tokenAuth');
const {
  getTeacherClasses,
  getClassRoster,
  isHomeroomOfClass
} = require('./services/teacherPortalService');
const { getAttendanceBoardExtras } = require('./services/attendanceBoardService');
const {
  getAttendanceForDate,
  saveAttendance,
  getClassWorkData,
  upsertStudentRecord,
  getStudentYearAttendance
} = require('./services/attendanceService');
const {
  listPlannedAttendance,
  getPlannedAttendanceCalendar,
  createPlannedAttendance,
  cancelPlannedAttendance
} = require('./services/plannedAttendanceService');
const { getMonthlyReport } = require('./services/reportService');
const {
  listEntries,
  getMonthCalendar,
  getYearCalendar,
  upsertEntry,
  deleteEntry,
  resolveDay,
  defaultAcademicYearRange
} = require('./services/schoolCalendarService');
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
  getUnreadCount,
  searchMessengerDirectory
} = require('./services/messageService');
const {
  listParentAnnouncements,
  listAnnouncementsForViewer,
  listManagedAnnouncements,
  createAnnouncement,
  deactivateAnnouncement
} = require('./services/announcementService');
const {
  getParentOverview,
  getParentAttendance,
  getParentTimetable,
  getParentHomework,
  getParentStudentProfile,
  updateParentStudentProfile,
  translateToKorean,
  translateChatMessage,
  ensureParentDemoData
} = require('./services/parentPortalService');
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
  buildReportCardSummary,
  getClassReportOverview,
  getStudentSubjectReport,
  saveStudentSubjectReport,
  getFullStudentReportCard,
  shareReportCardWithParents,
  listParentReportCards
} = require('./services/reportCardService');
const {
  ensureWorkflowSheet,
  getOrCreateWorkflow,
  listWorkflows,
  listTeachersForHead,
  saveSignaturePng,
  readSignaturePath,
  resolveSignaturePath,
  loadSignatureAsset,
  signAsHomeroom,
  submitToHead,
  signAsHead,
  submitToPrincipal,
  signAsPrincipal,
  stateLabel,
  processDueScheduledShares,
  STATES: RC_WF_STATES
} = require('./services/reportCardWorkflowService');
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
const { saveSubjectPref, listTeacherSubjectPrefs } = require('./services/subjectPrefsService');
const {
  getSemesterPlan,
  saveSemesterPlan,
  listAdminSemesterPlans,
  listTeacherSemesterSubjects
} = require('./services/semesterPlanService');
const {
  listSchoolSemesters,
  saveSchoolSemesters,
  getActiveSchoolSemester
} = require('./services/schoolSemesterService');
const {
  getAdminOverview,
  listTeachers,
  getTeacher,
  saveTeacher,
  deleteTeacher,
  listAllGradeTerms,
  getMonitoringFeed,
  listClasses,
  ensureLeadershipAccounts
} = require('./services/adminService');
const {
  listTeacherSubjectGroups,
  addTeacherSubject,
  removeTeacherSubject,
  listAdminClassAssignments,
  saveAdminClassAssignment,
  deleteAdminClassAssignment,
  assertTeacherClassAccess,
  getTeacherGradeAccess,
  listClassGradeSubjects
} = require('./services/subjectAssignmentService');
const {
  getClassAnalyticsDashboard,
  getStudentAnalytics,
  getSchoolAnalyticsDashboard,
  getSchoolStudentAnalytics,
  importAssessments,
  seedLearningAnalyticsMock,
  generateAiDiagnostic
} = require('./services/learningAnalytics');
const {
  listStudents,
  getStudent,
  saveStudent,
  listStudentsForTeacher,
  getStudentForTeacher,
  saveStudentPhoto,
  ensureRegistrySheets,
  withdrawStudent,
  restoreStudent,
  deleteStudent
} = require('./services/studentRegistryService');
const {
  saveTeacherPhoto,
  ensureTeacherProfileSheet
} = require('./services/teacherRegistryService');
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
  saveClassTimetable,
  getTeacherBusyMap,
  getAllClassesMatrix,
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
const { getBuddyStatus, askEnglishBuddy, getBuddyChatHistory, listBuddyMonitorForClass, unlockBuddy, refillBuddyUsage, clearBuddyChatHistory } = require('./services/englishBuddyService');
const { getStudentDashboard } = require('./services/studentPortalService');
const {
  getStudentDollars,
  applyDollarAdjustment,
  listClassDollarBalances,
  ensureDollarSheets
} = require('./services/dollarService');
const {
  postHomework,
  getClassHomework,
  getStudentHomeworkStatus,
  setHomeworkCompletion,
  ensureHomeworkSheets
} = require('./services/homeworkService');
const {
  getStudentVocabSummary,
  isPlacementDone,
  buildPlacementItem,
  processPlacementNext,
  savePlacementResult,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  getClassVocabOverview,
  overrideStudentVocab,
  scorePlacement,
  deepDiveWord,
  getPlacementMeta,
  getPromotionTestStatus,
  startPromotionTest,
  submitPromotionTest,
  ackPromotionTest,
  getVocabEngineInfo
} = require('./services/vocabShared');
const {
  tryEngine,
  probeHealth,
  TENANT_ID: VOCAB_TENANT_ID,
  isConfigured: isVocabEngineConfigured
} = require('./services/vocabEngineProxy');
const { todayStr } = require('./dateUtils');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Photo must be JPEG, PNG, or WebP.'), ok);
  }
});

const analyticsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Upload a PDF or image scan (JPG/PNG/WebP).'), ok);
  }
});

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Signature must be PNG, JPEG, or WebP.'), ok);
  }
});

const announcementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/zip'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('File type not allowed for announcements.'), ok);
  }
});

const router = express.Router();

async function assertHomeroomOfClass(teacherId, classId) {
  await assertTeacherClassAccess(teacherId, classId);
  if (!(await isHomeroomOfClass(teacherId, classId))) {
    throw new Error('Homeroom teachers only.');
  }
}

router.get('/health', async (req, res) => {
  let vocab = null;
  let engine = null;
  try {
    vocab = await getVocabEngineInfo();
  } catch (e) {
    vocab = { ok: false, error: e.message || String(e) };
  }
  try {
    engine = await probeHealth();
  } catch (e) {
    engine = { ok: false, error: e.message || String(e) };
  }
  res.json({
    ok: true,
    service: 'salt-morning-class',
    gemini: isGeminiConfigured(),
    vocab,
    vocabEngine: engine
  });
});

router.get('/admin/vocab/engine', requireRole('admin'), async (req, res) => {
  try {
    const local = await getVocabEngineInfo();
    const remote = await probeHealth();
    res.json({
      tenantId: VOCAB_TENANT_ID,
      localVendor: local,
      remoteEngine: remote,
      proxyConfigured: isVocabEngineConfigured()
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load vocab engine info.' });
  }
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
    const result = await loginParent(req.body.loginId, req.body.password, {
      studentId: req.body.studentId
    });
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

router.post('/auth/login', async (req, res) => {
  try {
    const result = await loginUnified(req.body.loginId, req.body.password);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Login failed.' });
  }
});

router.post('/auth/change-password', requireRole('student', 'parent', 'teacher', 'principal', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await changePassword(
      req.session,
      body.currentPassword,
      body.newPassword,
      body.confirmPassword
    );
    res.json(result);
  } catch (e) {
    const msg = e.message || 'Could not change password.';
    const status = /incorrect|match|different|at least|Enter|not found|cannot change/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/teacher/classes', requireRole('teacher'), async (req, res) => {
  try {
    const [data, subjectGroups] = await Promise.all([
      getTeacherClasses(req.session.teacherId),
      listTeacherSubjectGroups(req.session.teacherId)
    ]);
    return res.json({
      ...data,
      classes: subjectGroups.classes || []
    });
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
    await assertTeacherClassAccess(req.session.teacherId, req.params.classId);
    const data = await getClassWorkData(req.params.classId, req.query.date);
    res.json(data);
  } catch (e) {
    const status = /not assigned|access/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load class work.' });
  }
});

router.get('/teacher/class/:classId/attendance-board', requireRole('teacher'), async (req, res) => {
  try {
    await assertTeacherClassAccess(req.session.teacherId, req.params.classId);
    const wantMonitors = String(req.query.monitors || '') === '1' ||
      String(req.query.monitors || '').toLowerCase() === 'true';
    const includeMonitors = wantMonitors &&
      await isHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await getAttendanceBoardExtras(req.params.classId, { includeMonitors }));
  } catch (e) {
    const status = /not assigned|access/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load attendance board.' });
  }
});

router.post('/teacher/class/:classId/attendance/record', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
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
    const status = /Homeroom|assigned|access/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not save record.' });
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
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
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
    const status = /Homeroom|assigned|access/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not save planned attendance.' });
  }
});

router.post('/teacher/class/:classId/planned-attendance/cancel', requireRole('teacher'), async (req, res) => {
  try {
    // Cancel is scoped by noticeId; require homeroom of the class when classId is present
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    const result = await cancelPlannedAttendance(req.body.noticeId);
    res.json(result);
  } catch (e) {
    const status = /Homeroom|assigned|access/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not cancel notice.' });
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

router.get('/teacher/class/:classId/students/:studentId/year-attendance', requireRole('teacher'), async (req, res) => {
  try {
    await assertTeacherClassAccess(req.session.teacherId, req.params.classId);
    const data = await getStudentYearAttendance(
      req.params.classId,
      req.params.studentId,
      req.query.start || req.query.startDate,
      req.query.end || req.query.endDate
    );
    res.json(data);
  } catch (e) {
    const status = /not assigned|access/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load year attendance.' });
  }
});

router.get('/school-calendar/day', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const date = req.query.date;
    const classId = req.query.classId || '*';
    if (!date) return res.status(400).json({ error: 'date is required.' });
    res.json(await resolveDay(classId, date));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not resolve day.' });
  }
});

router.get('/school-calendar/range', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const classId = req.query.classId || '*';
    if (req.query.view === 'year' || (req.query.start && req.query.end && !req.query.month)) {
      const data = await getYearCalendar(classId, req.query.start || req.query.startDate, req.query.end || req.query.endDate);
      return res.json(data);
    }
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    res.json(await getMonthCalendar(classId, year, month));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load calendar.' });
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
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    const result = await saveAttendance(req.params.classId, req.body.date || todayStr(), req.body.records);
    res.json(result);
  } catch (e) {
    const status = /Homeroom|assigned|access/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not save attendance.' });
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

router.get('/teacher/class/:classId/grades/subjects', requireRole('teacher'), async (req, res) => {
  try {
    const data = await listClassGradeSubjects(req.session.teacherId, req.params.classId);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load subjects.' });
  }
});

router.get('/teacher/class/:classId/grades/weights', requireRole('teacher'), async (req, res) => {
  try {
    const subject = req.query.subject || '';
    const access = await getTeacherGradeAccess(req.session.teacherId, req.params.classId, subject);
    if (subject && !access.canView) {
      return res.status(403).json({ error: 'You cannot view this subject.' });
    }
    const weights = await listGradeWeights(req.params.classId, req.query.term, subject);
    const totalPercent = weights.reduce((s, w) => s + w.weightPercent, 0);
    res.json({ weights, totalPercent, presets: getCategoryPresets(), canEdit: access.canEdit });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load grade weights.' });
  }
});

router.post('/teacher/class/:classId/grades/weights', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject, weights } = req.body || {};
    const access = await getTeacherGradeAccess(req.session.teacherId, req.params.classId, subject);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Only the subject teacher can edit grade weights.' });
    }
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
    const access = await getTeacherGradeAccess(req.session.teacherId, classId, subject);
    if (!access.canView) {
      return res.status(403).json({ error: 'You cannot view grades for this subject.' });
    }
    const students = await getClassRoster(classId);
    const book = await getGradebook(classId, term, subject, students);
    res.json({ ...book, canEdit: access.canEdit, isHomeroom: access.isHomeroom });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load gradebook.' });
  }
});

router.post('/teacher/class/:classId/grades/gradebook/column', requireRole('teacher'), async (req, res) => {
  try {
    const { term, subject, categoryKey, title, date, maxScore } = req.body || {};
    const access = await getTeacherGradeAccess(req.session.teacherId, req.params.classId, subject);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Only the subject teacher can add grade columns.' });
    }
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
    const access = await getTeacherGradeAccess(
      req.session.teacherId,
      req.params.classId,
      req.query.subject
    );
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Only the subject teacher can delete grade columns.' });
    }
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
    const access = await getTeacherGradeAccess(req.session.teacherId, req.params.classId, subject);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Only the subject teacher can edit scores. Homeroom teachers can view only.' });
    }
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
    const term = req.query.term || '';
    const subject = req.query.subject || '';
    const studentId = req.query.studentId || '';

    // Full printable card
    if (studentId && req.query.full === '1') {
      const card = await getFullStudentReportCard(
        req.session.teacherId, classId, studentId, term || 'Term1'
      );
      return res.json({ card });
    }

    // Student × subject editor
    if (studentId && subject) {
      const data = await getStudentSubjectReport(
        req.session.teacherId, classId, studentId, term || 'Term1', subject
      );
      return res.json(data);
    }

    // Class overview (student list + readiness)
    const overview = await getClassReportOverview(req.session.teacherId, classId, term);
    res.json(overview);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load report card.' });
  }
});

router.post('/teacher/class/:classId/report-card', requireRole('teacher'), async (req, res) => {
  try {
    const body = req.body || {};
    // New student-subject save (work habits + comment)
    if (body.studentId && body.subject && (body.workHabits || body.subjectComment != null || body.markComplete != null)) {
      const result = await saveStudentSubjectReport(req.session.teacherId, req.params.classId, body);
      return res.json(result);
    }
    // Legacy bulk entries save
    const result = await saveReportCardEntries(
      req.params.classId,
      body.term,
      body.subject,
      req.session.teacherId,
      body.entries || []
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save report card.' });
  }
});

router.post('/teacher/class/:classId/report-card/share', requireRole('teacher'), async (req, res) => {
  try {
    return res.status(403).json({
      error: 'Homeroom teachers submit report cards to the Head Teacher. Only the Principal can share with parents.'
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not share report card.' });
  }
});

router.post('/teacher/signature', requireRole('teacher', 'principal'), async (req, res) => {
  signatureUpload.single('signature')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid signature.' });
    try {
      if (!req.file) return res.status(400).json({ error: 'Upload a PNG signature image.' });
      const personId = req.session.teacherId || req.session.principalId;
      const sigPath = await saveSignaturePng(personId, req.file.buffer, req.file.mimetype);
      res.json({ signaturePath: sigPath });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Could not save signature.' });
    }
  });
});

router.get('/teacher/signature', requireRole('teacher', 'principal'), async (req, res) => {
  try {
    const personId = req.session.teacherId || req.session.principalId;
    res.json({ signaturePath: await resolveSignaturePath(personId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load signature.' });
  }
});

/** Durable signature image (Sheets-backed). Used by report-card <img src>. */
router.get('/signatures/:personId', async (req, res) => {
  try {
    const personId = decodeURIComponent(String(req.params.personId || '').trim());
    if (!personId || personId.length > 80) return res.status(404).end();
    const asset = await loadSignatureAsset(personId);
    if (!asset) return res.status(404).json({ error: 'Signature not found.' });
    res.setHeader('Content-Type', asset.mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(asset.buffer);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load signature.' });
  }
});

router.post('/teacher/class/:classId/report-card/workflow', requireRole('teacher'), async (req, res) => {
  try {
    const classId = req.params.classId;
    const { studentId, term, action } = req.body || {};
    if (!studentId) throw new Error('studentId is required.');
    const t = term || 'Term1';
    await assertHomeroomOfClass(req.session.teacherId, classId);
    const card = await getFullStudentReportCard(req.session.teacherId, classId, studentId, t);
    if (!card.reportReady) throw new Error('All subjects must be complete before signing.');
    let wf = await getOrCreateWorkflow(classId, studentId, t, {
      homeroomTeacherId: req.session.teacherId,
      headTeacherId: req.session.headTeacherId || ''
    });
    if (action === 'sign') wf = await signAsHomeroom(wf, req.session.teacherId);
    else if (action === 'submit') wf = await submitToHead(wf, req.session.teacherId);
    else throw new Error('action must be sign or submit.');
    res.json({ workflow: wf, stateLabel: stateLabel(wf.state) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Workflow action failed.' });
  }
});

router.get('/teacher/head/report-cards', requireRole('teacher'), async (req, res) => {
  try {
    if (!/head\s*teacher/i.test(String(req.session.staffRole || ''))) {
      return res.status(403).json({ error: 'Head Teacher access only.' });
    }
    await ensureWorkflowSheet();
    const assigned = await listTeachersForHead(req.session.teacherId);
    const assignedIds = new Set(assigned.map((t) => t.teacherId));
    const items = await listWorkflows({
      states: [
        RC_WF_STATES.submitted_head,
        RC_WF_STATES.signed_head,
        RC_WF_STATES.submitted_principal,
        RC_WF_STATES.signed_principal,
        RC_WF_STATES.shared_parent
      ]
    });
    const filtered = items.filter((w) =>
      String(w.headTeacherId) === String(req.session.teacherId) ||
      assignedIds.has(w.homeroomTeacherId)
    );
    res.json({ teachers: assigned, workflows: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load Head Teacher queue.' });
  }
});

router.get('/teacher/head/report-cards/:classId/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    if (!/head\s*teacher/i.test(String(req.session.staffRole || ''))) {
      return res.status(403).json({ error: 'Head Teacher access only.' });
    }
    const term = req.query.term || 'Term1';
    const card = await getFullStudentReportCard(
      req.session.teacherId, req.params.classId, req.params.studentId, term, { bypassAccess: true }
    );
    res.json({ card });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load report card.' });
  }
});

router.post('/teacher/head/report-cards/workflow', requireRole('teacher'), async (req, res) => {
  try {
    if (!/head\s*teacher/i.test(String(req.session.staffRole || ''))) {
      return res.status(403).json({ error: 'Head Teacher access only.' });
    }
    const { classId, studentId, term, action } = req.body || {};
    if (!classId || !studentId) throw new Error('classId and studentId are required.');
    const t = term || 'Term1';
    let wf = await getOrCreateWorkflow(classId, studentId, t, {
      headTeacherId: req.session.teacherId
    });
    if (action === 'sign') wf = await signAsHead(wf, req.session.teacherId);
    else if (action === 'submit') wf = await submitToPrincipal(wf, req.session.teacherId);
    else throw new Error('action must be sign or submit.');
    res.json({ workflow: wf, stateLabel: stateLabel(wf.state) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Head Teacher workflow failed.' });
  }
});

router.get('/admin/report-cards', requireRole('admin', 'principal'), async (req, res) => {
  try {
    await ensureWorkflowSheet();
    const workflows = await listWorkflows({
      states: [
        RC_WF_STATES.submitted_principal,
        RC_WF_STATES.signed_principal,
        RC_WF_STATES.shared_parent
      ]
    });
    res.json({ workflows });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load Principal queue.' });
  }
});

router.get('/admin/report-cards/:classId/:studentId', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const term = req.query.term || 'Term1';
    const viewerId = req.session.principalId || req.session.teacherId || req.session.adminId;
    const card = await getFullStudentReportCard(
      viewerId, req.params.classId, req.params.studentId, term, { bypassAccess: true }
    );
    res.json({ card });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load report card.' });
  }
});

router.post('/admin/report-cards/workflow', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const { classId, studentId, term, action, scheduledShareAt } = req.body || {};
    if (!classId || !studentId) throw new Error('classId and studentId are required.');
    const t = term || 'Term1';
    const principalId = req.session.principalId || req.session.teacherId || req.session.adminId;
    let wf = await getOrCreateWorkflow(classId, studentId, t, {});
    if (action === 'sign') {
      wf = await signAsPrincipal(wf, principalId);
      return res.json({ workflow: wf, stateLabel: stateLabel(wf.state) });
    }
    if (action === 'share' || action === 'schedule') {
      const result = await shareReportCardWithParents(principalId, classId, studentId, t, {
        bypassAccess: true,
        scheduledShareAt: action === 'schedule' ? scheduledShareAt : ''
      });
      return res.json(result);
    }
    if (action === 'batch-sign') {
      const list = Array.isArray(req.body.items) ? req.body.items : [{ classId, studentId, term: t }];
      const signed = [];
      for (const it of list) {
        let w = await getOrCreateWorkflow(it.classId, it.studentId, it.term || t, {});
        w = await signAsPrincipal(w, principalId);
        signed.push(w);
      }
      return res.json({ signed: signed.length, workflows: signed });
    }
    throw new Error('action must be sign, share, schedule, or batch-sign.');
  } catch (e) {
    res.status(400).json({ error: e.message || 'Principal workflow failed.' });
  }
});

router.post('/admin/signature', requireRole('admin', 'principal'), async (req, res) => {
  signatureUpload.single('signature')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid signature.' });
    try {
      if (!req.file) return res.status(400).json({ error: 'Upload a PNG signature image.' });
      const personId = req.session.principalId || req.session.teacherId || req.session.adminId;
      const sigPath = await saveSignaturePng(personId, req.file.buffer, req.file.mimetype);
      res.json({ signaturePath: sigPath });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Could not save signature.' });
    }
  });
});

router.post('/admin/ensure-leadership', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const result = await ensureLeadershipAccounts();
    res.json({
      ok: true,
      ...result,
      accounts: [
        { role: 'Principal', loginId: 'principal', password: 'principal123' },
        { role: 'Head Teacher', loginId: 'head', password: 'head123' }
      ]
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not ensure leadership accounts.' });
  }
});

router.get('/teacher/head/team', requireRole('teacher'), async (req, res) => {
  try {
    if (!/head\s*teacher/i.test(String(req.session.staffRole || ''))) {
      return res.status(403).json({ error: 'Head Teacher access only.' });
    }
    const teachers = await listTeachersForHead(req.session.teacherId);
    const enriched = [];
    for (const t of teachers) {
      let classes = [];
      try {
        const groups = await listTeacherSubjectGroups(t.teacherId);
        classes = (groups.classes || []).map((c) => ({
          classId: c.classId,
          className: c.className,
          isHomeroom: !!c.isHomeroom,
          subjects: c.subjects || [],
          roleLabel: c.roleLabel || ''
        }));
      } catch (e) { /* ignore */ }
      enriched.push(Object.assign({}, t, { classes }));
    }
    res.json({ teachers: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load team.' });
  }
});

router.get('/teacher/class/:classId/analytics', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    const data = await getClassAnalyticsDashboard(req.params.classId, {
      status: req.query.status || ''
    });
    res.json(data);
  } catch (e) {
    const status = /homeroom|not assigned|access/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load analytics.' });
  }
});

router.get('/teacher/class/:classId/analytics/students/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await getStudentAnalytics(req.params.classId, req.params.studentId));
  } catch (e) {
    const status = /homeroom|not assigned|access|not found/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load student analytics.' });
  }
});

router.post(
  '/teacher/class/:classId/analytics/import',
  requireRole('teacher'),
  (req, res, next) => {
    analyticsUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Invalid upload.' });
      next();
    });
  },
  async (req, res) => {
    try {
      await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
      if (!req.file) {
        return res.status(400).json({
          error: 'Upload a Star Reading or MAP PDF / scan image. CSV and JSON paste are no longer supported.'
        });
      }
      const result = await importAssessments({
        classId: req.params.classId,
        source: (req.body && req.body.source) || 'star_reading',
        file: req.file,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        filename: req.file.originalname
      });
      res.json(result);
    } catch (e) {
      const status = /homeroom/i.test(e.message || '') ? 403 : 400;
      res.status(status).json({ error: e.message || 'Import failed.' });
    }
  }
);

router.post('/teacher/class/:classId/analytics/seed-mock', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await seedLearningAnalyticsMock(req.params.classId));
  } catch (e) {
    const status = /homeroom/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not seed mock analytics.' });
  }
});

router.post('/teacher/class/:classId/analytics/students/:studentId/diagnose', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await generateAiDiagnostic(req.params.classId, req.params.studentId));
  } catch (e) {
    const status = /homeroom/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not generate diagnostic.' });
  }
});

/** Admin / Principal — school-wide Learning Analytics (all enrolled students). */
router.get('/admin/analytics', requireRole('admin'), async (req, res) => {
  try {
    const data = await getSchoolAnalyticsDashboard({
      classId: req.query.classId || '',
      status: req.query.status || ''
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load school analytics.' });
  }
});

router.get('/admin/analytics/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    res.json(await getSchoolStudentAnalytics(req.params.studentId));
  } catch (e) {
    const status = /not found/i.test(e.message || '') ? 404 : 500;
    res.status(status).json({ error: e.message || 'Could not load student analytics.' });
  }
});

router.post('/admin/analytics/students/:studentId/diagnose', requireRole('admin'), async (req, res) => {
  try {
    const bundle = await getSchoolStudentAnalytics(req.params.studentId);
    res.json(await generateAiDiagnostic(bundle.classId, req.params.studentId));
  } catch (e) {
    const status = /not found/i.test(e.message || '') ? 404 : 400;
    res.status(status).json({ error: e.message || 'Could not generate diagnostic.' });
  }
});

router.post('/admin/analytics/seed-mock', requireRole('admin'), async (req, res) => {
  try {
    const classId = String((req.body && req.body.classId) || req.query.classId || '').trim();
    if (!classId) {
      return res.status(400).json({ error: 'Choose a class to seed demo analytics data.' });
    }
    res.json(await seedLearningAnalyticsMock(classId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not seed mock analytics.' });
  }
});

router.post(
  '/admin/analytics/import',
  requireRole('admin'),
  (req, res, next) => {
    analyticsUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Invalid upload.' });
      next();
    });
  },
  async (req, res) => {
    try {
      const classId = String((req.body && req.body.classId) || '').trim();
      if (!classId) {
        return res.status(400).json({ error: 'Choose a class for this import.' });
      }
      if (!req.file) {
        return res.status(400).json({
          error: 'Upload a Star Reading or MAP PDF / scan image.'
        });
      }
      const result = await importAssessments({
        classId,
        source: (req.body && req.body.source) || 'star_reading',
        file: req.file,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        filename: req.file.originalname
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message || 'Import failed.' });
    }
  }
);

router.post('/dev/seed-learning-analytics', async (req, res) => {
  try {
    const key = String((req.body && req.body.key) || req.query.key || '');
    if (key !== String(process.env.DEMO_SEED_KEY || 'salt-demo-seed')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const classId = (req.body && req.body.classId) || 'C001';
    res.json(await seedLearningAnalyticsMock(classId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Seed failed.' });
  }
});

router.get('/parent/report-cards', requireRole('parent'), async (req, res) => {
  try {
    const data = await listParentReportCards(req.session);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load report cards.' });
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

router.get('/teacher/subject-prefs', requireRole('teacher'), async (req, res) => {
  try {
    const prefs = await listTeacherSubjectPrefs(req.session.teacherId);
    res.json({ prefs });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load subject preferences.' });
  }
});

router.post('/teacher/subject-prefs', requireRole('teacher'), async (req, res) => {
  try {
    const { classId, subject } = req.body || {};
    await assertTeacherClassAccess(req.session.teacherId, classId);
    const pref = await saveSubjectPref(req.session.teacherId, req.body || {});
    res.json({ pref });
  } catch (e) {
    const status = /access|homeroom|not assigned/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not save subject preferences.' });
  }
});

router.get('/teacher/semester-plans/subjects', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await listTeacherSemesterSubjects(req.session.teacherId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load subjects.' });
  }
});

router.get('/teacher/semester-plans', requireRole('teacher'), async (req, res) => {
  try {
    const { classId, subject, termLabel } = req.query;
    if (!classId || !subject) {
      return res.status(400).json({ error: 'classId and subject are required.' });
    }
    const [plan, semesters, active] = await Promise.all([
      getSemesterPlan(
        req.session.teacherId,
        classId,
        subject,
        termLabel || ''
      ),
      listSchoolSemesters(),
      getActiveSchoolSemester()
    ]);
    res.json({
      plan,
      semesters: semesters.filter((s) => s.startDate && s.endDate),
      activeSemesterKey: active ? active.key : ''
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not load semester plan.' });
  }
});

router.post('/teacher/semester-plans', requireRole('teacher'), async (req, res) => {
  try {
    const result = await saveSemesterPlan(req.session.teacherId, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save semester plan.' });
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

router.get('/teacher/class/:classId/dollars', requireRole('teacher'), async (req, res) => {
  try {
    await ensureDollarSheets();
    const roster = await getClassRoster(req.params.classId);
    const students = await listClassDollarBalances(req.params.classId, roster);
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load dollar balances.' });
  }
});

router.post('/teacher/class/:classId/dollars', requireRole('teacher'), async (req, res) => {
  try {
    const { studentId, amount, reason } = req.body || {};
    const result = await applyDollarAdjustment(req.params.classId, studentId, amount, reason);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not adjust dollars.' });
  }
});

router.get('/teacher/class/:classId/homework', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await getClassHomework(req.params.classId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load homework.' });
  }
});

router.post('/teacher/class/:classId/homework', requireRole('teacher'), async (req, res) => {
  try {
    const data = await postHomework(req.params.classId, req.body || {});
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not post homework.' });
  }
});

router.post('/teacher/class/:classId/homework/complete', requireRole('teacher'), async (req, res) => {
  try {
    const { itemId, studentId, completed, fixNote } = req.body || {};
    const result = await setHomeworkCompletion(itemId, studentId, completed !== false, fixNote);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update completion.' });
  }
});

router.get('/student/dashboard', requireRole('student'), async (req, res) => {
  try {
    const dashboard = await getStudentDashboard(req.session);
    res.json(dashboard);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load dashboard.' });
  }
});

router.get('/student/dollars', requireRole('student'), async (req, res) => {
  try {
    await ensureDollarSheets();
    res.json(await getStudentDollars(req.session.studentId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load dollars.' });
  }
});

router.get('/student/homework', requireRole('student'), async (req, res) => {
  try {
    await ensureHomeworkSheets();
    res.json(await getStudentHomeworkStatus(req.session.studentId, req.session.classId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load homework.' });
  }
});

router.post('/student/homework/complete', requireRole('student'), async (req, res) => {
  try {
    const { itemId, completed, fixNote } = req.body || {};
    const result = await setHomeworkCompletion(
      itemId,
      req.session.studentId,
      completed !== false,
      fixNote
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not mark homework.' });
  }
});

router.get('/student/vocab', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/summary', { studentId: sid, classId: cid, name: req.session.name });
    res.json(remote || await getStudentVocabSummary(sid, cid));
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not load vocab.' });
  }
});

router.get('/student/vocab/summary', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/summary', { studentId: sid, classId: cid, name: req.session.name });
    res.json(remote || await getStudentVocabSummary(sid, cid));
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not load vocab.' });
  }
});

/**
 * Platform admin directory lookup (name / school / class) for this host tenant.
 * Auth: X-Vocab-Platform-Key must match VOCAB_PLATFORM_SECRET (shared with central).
 */
router.get('/vocab/directory', async (req, res) => {
  try {
    const expected = String(process.env.VOCAB_PLATFORM_SECRET || '').trim();
    const key = String(req.headers['x-vocab-platform-key'] || '').trim();
    if (!expected || key !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (!ids.length) return res.json({ students: [] });

    const { getStudent } = require('./services/studentRegistryService');
    const schoolName = String(process.env.VOCAB_SCHOOL_NAME || 'Salt Morning Class');

    const students = [];
    for (const studentId of ids) {
      try {
        const student = await getStudent(studentId);
        if (!student) continue;
        const classId = student.classId || null;
        const className = student.className && student.className !== '—'
          ? student.className
          : classId;
        const gradeRaw =
          (student.profile && student.profile.gradeLevel) ||
          student.gradeLevel ||
          null;
        const gradeNum = gradeRaw != null
          ? Math.round(Number(String(gradeRaw).replace(/[^0-9.]/g, '')))
          : null;
        const previousSchool =
          (student.profile && student.profile.previousSchool) || null;
        students.push({
          studentId,
          name: student.name || null,
          schoolName: previousSchool || schoolName,
          classId,
          className,
          schoolGrade: Number.isFinite(gradeNum) ? gradeNum : null
        });
      } catch (e) {
        /* skip missing */
      }
    }
    res.json({ students });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Directory lookup failed' });
  }
});

/** Mint a central Vocab Booster /v1 session JWT for embed hosts (optional). */
router.post('/student/vocab/central-session', requireRole('student'), async (req, res) => {
  try {
    const { mintStudentSession } = require('./services/vocabEngineProxy');
    const payload = await mintStudentSession(
      req.session.studentId,
      req.session.classId,
      (req.body && req.body.name) || req.session.name
    );
    res.json(payload);
  } catch (e) {
    res.status(e.statusCode || 502).json({ error: e.message || 'Central mint failed' });
  }
});

router.post('/student/vocab/placement/item', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const body = req.body || {};
    const remote = await tryEngine('/placement/item', {
      method: 'POST',
      body,
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    if (remote) return res.json(remote);
    res.json(await buildPlacementItem({
      abilityGrade: body.abilityGrade,
      questionIndex: body.questionIndex,
      avoidWordIds: body.avoidWordIds,
      abilityTrail: body.abilityTrail
    }));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not build placement item.' });
  }
});

router.post('/student/vocab/placement/next', requireRole('student'), async (req, res) => {
  try {
    const remote = await tryEngine('/placement/next', {
      method: 'POST',
      body: req.body || {},
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    if (remote) return res.json(remote);
    res.json(processPlacementNext(req.body || {}));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not adapt difficulty.' });
  }
});

router.get('/student/vocab/placement/meta', requireRole('student'), async (req, res) => {
  try {
    const remote = await tryEngine('/placement/meta', {
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    res.json(remote || getPlacementMeta());
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not load placement meta.' });
  }
});

router.post('/student/vocab/placement/score', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/placement/score', {
      method: 'POST',
      body: req.body || {},
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    if (remote) return res.json(remote);

    if (await isPlacementDone(sid)) {
      return res.status(409).json({ error: 'Placement already completed.', code: 'PLACEMENT_ALREADY_DONE' });
    }
    const result = scorePlacement(req.body || {});
    try {
      await savePlacementResult(sid, cid, result);
      result.persisted = true;
    } catch (persistErr) {
      console.error('savePlacementResult', persistErr.message || persistErr);
      result.persisted = false;
    }
    res.json(result);
  } catch (e) {
    const status = e.code === 'PLACEMENT_ALREADY_DONE' ? 409 : (e.statusCode || 400);
    res.status(status).json({ error: e.message || 'Could not score placement.', code: e.code });
  }
});

router.get('/student/vocab/daily-queue', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/daily-queue', {
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await getDailyQueue(sid, cid));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not load daily queue.' });
  }
});

router.post('/student/vocab/review', requireRole('student'), async (req, res) => {
  try {
    const { wordId, correct } = req.body || {};
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/review', {
      method: 'POST',
      body: { wordId, correct },
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await recordReview(sid, cid, wordId, correct));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not record review.' });
  }
});

router.post('/student/vocab/daily-test/submit', requireRole('student'), async (req, res) => {
  try {
    const body = req.body || {};
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/daily-test/submit', {
      method: 'POST',
      body,
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    if (remote) return res.json(remote);
    res.json(await recordDailyTestResult(
      sid,
      cid,
      body.correctCount,
      body.totalCount,
      body.answers
    ));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not submit daily test.' });
  }
});

router.get('/student/vocab/promotion-test/status', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/promotion-test/status', {
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await getPromotionTestStatus(sid));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not load promotion test.' });
  }
});

router.post('/student/vocab/promotion-test/start', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/promotion-test/start', {
      method: 'POST',
      body: req.body || {},
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await startPromotionTest(sid, cid));
  } catch (e) {
    res.status(e.statusCode || 400).json({
      error: e.message || 'Could not start promotion test.',
      code: e.code
    });
  }
});

router.post('/student/vocab/promotion-test/submit', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/promotion-test/submit', {
      method: 'POST',
      body: req.body || {},
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await submitPromotionTest(sid, req.body || {}));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not submit promotion test.' });
  }
});

router.post('/student/vocab/promotion-test/ack', requireRole('student'), async (req, res) => {
  try {
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/promotion-test/ack', {
      method: 'POST',
      body: req.body || {},
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    res.json(remote || await ackPromotionTest(sid, req.body || {}));
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not ack promotion test.' });
  }
});

router.post('/student/vocab/deep-dive', requireRole('student'), async (req, res) => {
  try {
    const body = req.body || {};
    const sid = req.session.studentId;
    const cid = req.session.classId;
    const remote = await tryEngine('/deep-dive', {
      method: 'POST',
      body,
      studentId: sid,
      classId: cid,
      name: req.session.name
    });
    if (remote) {
      const text = typeof remote === 'string'
        ? remote
        : String((remote && (remote.text || remote.answer || remote.explanation)) || '');
      return res.json({ text, ...(typeof remote === 'object' && remote ? remote : {}) });
    }
    const result = await deepDiveWord({
      word: body.word,
      partOfSpeech: body.partOfSpeech || body.part_of_speech,
      focus: body.focus,
      levelHint: body.levelHint,
      studentLevel: body.studentLevel
    });
    const text = typeof result === 'string'
      ? result
      : String((result && (result.text || result.answer || result.explanation)) || '');
    res.json({ text, ...(typeof result === 'object' && result ? result : {}) });
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Deep-dive unavailable.' });
  }
});

/** Sunday dollar dungeon — engine-only (no local Sheets reimplementation). */
router.get('/student/vocab/dungeon/status', requireRole('student'), async (req, res) => {
  try {
    const remote = await tryEngine('/dungeon/status', {
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    if (!remote) {
      return res.status(503).json({
        error: 'Dungeon requires Mr.Park Vocab engine v1 (/dungeon). Engine not available yet.',
        code: 'ENGINE_ROUTE_MISSING'
      });
    }
    res.json(remote);
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not load dungeon.' });
  }
});

router.post('/student/vocab/dungeon/stage/start', requireRole('student'), async (req, res) => {
  try {
    const remote = await tryEngine('/dungeon/stage/start', {
      method: 'POST',
      body: req.body || {},
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    if (!remote) {
      return res.status(503).json({
        error: 'Dungeon requires Mr.Park Vocab engine v1.',
        code: 'ENGINE_ROUTE_MISSING'
      });
    }
    res.json(remote);
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not start dungeon stage.' });
  }
});

router.post('/student/vocab/dungeon/stage/submit', requireRole('student'), async (req, res) => {
  try {
    const remote = await tryEngine('/dungeon/stage/submit', {
      method: 'POST',
      body: req.body || {},
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    if (!remote) {
      return res.status(503).json({
        error: 'Dungeon requires Mr.Park Vocab engine v1.',
        code: 'ENGINE_ROUTE_MISSING'
      });
    }
    res.json(remote);
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not submit dungeon stage.' });
  }
});

router.get('/student/vocab/pronounce', requireRole('student'), async (req, res) => {
  try {
    const word = String(req.query.word || '').trim();
    const remote = await tryEngine('/pronounce', {
      query: 'word=' + encodeURIComponent(word),
      studentId: req.session.studentId,
      classId: req.session.classId,
      name: req.session.name
    });
    if (!remote) {
      return res.status(503).json({
        error: 'Pronounce requires Mr.Park Vocab engine v1.',
        code: 'ENGINE_ROUTE_MISSING'
      });
    }
    res.json(remote);
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message || 'Pronounce unavailable.' });
  }
});

router.get('/teacher/class/:classId/vocab', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await getClassVocabOverview(req.params.classId));
  } catch (e) {
    const status = /homeroom|not assigned|access/i.test(e.message || '') ? 403 : 500;
    res.status(status).json({ error: e.message || 'Could not load vocab overview.' });
  }
});

router.post('/teacher/class/:classId/vocab/:studentId', requireRole('teacher'), async (req, res) => {
  try {
    await assertHomeroomOfClass(req.session.teacherId, req.params.classId);
    res.json(await overrideStudentVocab(req.params.studentId, req.params.classId, req.body || {}));
  } catch (e) {
    const status = /homeroom/i.test(e.message || '') ? 403 : 400;
    res.status(status).json({ error: e.message || 'Could not update vocab state.' });
  }
});

router.get('/student/english-buddy/status', requireRole('student'), (req, res) => {
  res.json(getBuddyStatus(req.session.studentId));
});

router.get('/student/english-buddy/history', requireRole('student'), async (req, res) => {
  try {
    const messages = await getBuddyChatHistory(req.session.studentId, req.session.classId);
    res.json({ messages, status: getBuddyStatus(req.session.studentId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load chat history.' });
  }
});

router.delete('/student/english-buddy/history', requireRole('student'), async (req, res) => {
  try {
    res.json(await clearBuddyChatHistory(req.session.studentId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not clear chat history.' });
  }
});

router.post('/student/english-buddy', requireRole('student'), async (req, res) => {
  try {
    const result = await askEnglishBuddy(
      req.session.studentId,
      req.session.classId,
      req.body.message,
      req.body.history
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not reach English Buddy.' });
  }
});

router.get('/teacher/class/:classId/english-buddy', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await listBuddyMonitorForClass(req.params.classId));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load English Buddy monitor.' });
  }
});

router.get('/teacher/class/:classId/english-buddy/:studentId/history', requireRole('teacher'), async (req, res) => {
  try {
    const messages = await getBuddyChatHistory(req.params.studentId, req.params.classId);
    res.json({ messages, status: getBuddyStatus(req.params.studentId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load history.' });
  }
});

router.post('/teacher/class/:classId/english-buddy/:studentId/unlock', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await unlockBuddy(req.params.studentId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not unlock.' });
  }
});

router.post('/teacher/class/:classId/english-buddy/:studentId/refill', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await refillBuddyUsage(req.params.studentId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not refill.' });
  }
});

router.get('/parent/announcements', requireRole('parent'), async (req, res) => {
  try {
    const scope = req.query.scope || '';
    const classId = req.session.classId || req.query.classId || '';
    const announcements = await listAnnouncementsForViewer({
      role: 'parent',
      classId,
      scope
    });
    res.json({ announcements, scope: scope || 'all' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load announcements.' });
  }
});

router.get('/student/announcements', requireRole('student'), async (req, res) => {
  try {
    const scope = req.query.scope || '';
    const classId = req.session.classId || '';
    const announcements = await listAnnouncementsForViewer({
      role: 'student',
      classId,
      scope
    });
    res.json({ announcements, scope: scope || 'all' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load announcements.' });
  }
});

function parseAnnouncementFiles(req) {
  const files = req.files || {};
  return {
    image: files.image && files.image[0] ? files.image[0] : null,
    attachment: files.attachment && files.attachment[0] ? files.attachment[0] : null
  };
}

router.get('/admin/announcements', requireRole('admin'), async (req, res) => {
  try {
    const announcements = await listManagedAnnouncements({
      role: 'admin',
      classId: req.query.classId || ''
    });
    res.json({ announcements });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load announcements.' });
  }
});

router.post('/admin/announcements', requireRole('admin'), (req, res) => {
  announcementUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'attachment', maxCount: 1 }
  ])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    try {
      const body = req.body || {};
      const announcement = await createAnnouncement(body, parseAnnouncementFiles(req), {
        role: 'admin',
        name: (req.session && req.session.name) || 'Admin',
        id: (req.session && req.session.adminId) || 'admin'
      });
      res.json({ announcement });
    } catch (e) {
      res.status(400).json({ error: e.message || 'Could not create announcement.' });
    }
  });
});

router.post('/admin/announcements/:id/deactivate', requireRole('admin'), async (req, res) => {
  try {
    res.json(await deactivateAnnouncement(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not remove announcement.' });
  }
});

router.get('/teacher/announcements', requireRole('teacher'), async (req, res) => {
  try {
    const classes = await getTeacherClasses(req.session.teacherId);
    const classIds = [];
    (classes.homeroom || []).forEach((c) => classIds.push(c.classId));
    (classes.assigned || []).forEach((c) => {
      if (c.classId && !classIds.includes(c.classId)) classIds.push(c.classId);
    });
    // Also flatten if API returns combined classes array
    if (Array.isArray(classes.classes)) {
      classes.classes.forEach((c) => {
        if (c.classId && !classIds.includes(c.classId)) classIds.push(c.classId);
      });
    }
    const announcements = await listManagedAnnouncements({
      role: 'teacher',
      teacherId: req.session.teacherId,
      classId: classIds
    });
    res.json({ announcements, classes: classIds });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load announcements.' });
  }
});

router.post('/teacher/announcements', requireRole('teacher'), (req, res) => {
  announcementUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'attachment', maxCount: 1 }
  ])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    try {
      const body = Object.assign({}, req.body || {}, { scope: 'class' });
      const classId = String(body.classId || '').trim();
      if (!classId) return res.status(400).json({ error: 'Class is required.' });
      await assertTeacherClassAccess(req.session.teacherId, classId);
      const announcement = await createAnnouncement(body, parseAnnouncementFiles(req), {
        role: 'teacher',
        name: (req.session && req.session.name) || 'Teacher',
        id: req.session.teacherId
      });
      res.json({ announcement });
    } catch (e) {
      const status = /not assigned|access/i.test(e.message || '') ? 403 : 400;
      res.status(status).json({ error: e.message || 'Could not create announcement.' });
    }
  });
});

router.post('/teacher/announcements/:id/deactivate', requireRole('teacher'), async (req, res) => {
  try {
    res.json(await deactivateAnnouncement(req.params.id, { teacherId: req.session.teacherId }));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not remove announcement.' });
  }
});

router.get('/parent/overview', requireRole('parent'), async (req, res) => {
  try {
    res.json(await getParentOverview(req.session));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load parent overview.' });
  }
});

router.get('/parent/children', requireRole('parent'), async (req, res) => {
  try {
    const { listChildrenForParent, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const children = await listChildrenForParent(req.session.parentId);
    res.json({
      children,
      activeStudentId: req.session.studentId || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load children.' });
  }
});

router.post('/parent/active-child', requireRole('parent'), async (req, res) => {
  try {
    const result = await switchParentActiveChild(req.session, (req.body && req.body.studentId) || '');
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not switch child.' });
  }
});

router.get('/parent/attendance', requireRole('parent'), async (req, res) => {
  try {
    res.json(await getParentAttendance(req.session, req.query.start, req.query.end));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load attendance.' });
  }
});

router.get('/parent/attendance-notice', requireRole('parent'), async (req, res) => {
  try {
    const { getParentNoticeView } = require('./services/parentAttendanceNoticeService');
    const { todayStr } = require('./dateUtils');
    const studentId = String(req.query.studentId || req.session.studentId || '').trim();
    const dateStr = String(req.query.date || todayStr()).slice(0, 10);
    if (!studentId) return res.status(400).json({ error: 'studentId is required.' });
    const { parentHasStudent } = require('./services/parentRegistryService');
    if (!(await parentHasStudent(req.session.parentId, studentId))) {
      return res.status(403).json({ error: 'Not your child.' });
    }
    res.json(await getParentNoticeView(studentId, dateStr));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load notice.' });
  }
});

router.post('/parent/attendance-notice', requireRole('parent'), async (req, res) => {
  try {
    const { submitNotice } = require('./services/parentAttendanceNoticeService');
    const body = req.body || {};
    const notice = await submitNotice({
      parentId: req.session.parentId,
      studentId: body.studentId || req.session.studentId,
      noticeType: body.noticeType || body.type,
      date: body.date || body.dateStr,
      note: body.note
    });
    res.json({ ok: true, notice });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Could not submit notice.' });
  }
});

router.post('/parent/attendance-notice/clear', requireRole('parent'), async (req, res) => {
  try {
    const { clearNotice } = require('./services/parentAttendanceNoticeService');
    const body = req.body || {};
    const result = await clearNotice({
      parentId: req.session.parentId,
      studentId: body.studentId || req.session.studentId,
      date: body.date || body.dateStr
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Could not clear notice.' });
  }
});

router.get('/parent/timetable', requireRole('parent'), async (req, res) => {
  try {
    res.json(await getParentTimetable(req.session));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable.' });
  }
});

router.get('/parent/homework', requireRole('parent'), async (req, res) => {
  try {
    res.json(await getParentHomework(req.session));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load homework.' });
  }
});

router.get('/parent/student-profile', requireRole('parent'), async (req, res) => {
  try {
    res.json(await getParentStudentProfile(req.session));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load profile.' });
  }
});

router.post('/parent/student-profile', requireRole('parent'), async (req, res) => {
  try {
    res.json(await updateParentStudentProfile(req.session, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update profile.' });
  }
});

router.post('/parent/translate', requireRole('parent'), async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const targetLang = (req.body && req.body.targetLang) || 'ko';
    res.json(await translateChatMessage(text, targetLang));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Translate failed.' });
  }
});

/** Parent + teacher messenger auto-translate (role picks default target language). */
router.post('/messenger/translate', requireRole('parent', 'teacher', 'admin'), async (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const role = req.session && req.session.role;
    const defaultLang = role === 'teacher' || role === 'admin' ? 'en' : 'ko';
    const targetLang = (req.body && req.body.targetLang) || defaultLang;
    res.json(await translateChatMessage(text, targetLang));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Translate failed.' });
  }
});

router.post('/admin/seed-parent-demo', requireRole('admin'), async (req, res) => {
  try {
    res.json(await ensureParentDemoData());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not seed parent demo.' });
  }
});

// Also allow a one-shot seed without auth in non-production? Prefer admin-only + script.
router.post('/dev/seed-parent-demo', async (req, res) => {
  try {
    if (process.env.ALLOW_DEMO_SEED !== '1' && process.env.NODE_ENV === 'production') {
      // Still allow when explicitly keyed
      const key = String((req.body && req.body.key) || req.query.key || '');
      if (key !== String(process.env.DEMO_SEED_KEY || 'salt-demo-seed')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }
    res.json(await ensureParentDemoData());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not seed parent demo.' });
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

/** Admin people directory — search teachers, parents, students to start a chat. */
router.get('/messenger/directory', requireRole('admin'), async (req, res) => {
  try {
    const data = await searchMessengerDirectory(req.query.q, {
      types: req.query.types,
      limit: req.query.limit
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not search directory.' });
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

router.get('/admin/semester-plans', requireRole('admin'), async (req, res) => {
  try {
    const data = await listAdminSemesterPlans({
      teacherId: req.query.teacherId || '',
      classId: req.query.classId || '',
      termLabel: req.query.termLabel || ''
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load semester plans.' });
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
    await ensureTeacherProfileSheet();
    res.json({ teachers: await listTeachers() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load teachers.' });
  }
});

router.get('/admin/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    const teacher = await getTeacher(req.params.teacherId);
    res.json({ teacher });
  } catch (e) {
    res.status(e.message === 'Teacher not found.' ? 404 : 500).json({ error: e.message });
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

router.delete('/admin/teachers/:teacherId', requireRole('admin'), async (req, res) => {
  try {
    const result = await deleteTeacher(req.params.teacherId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete teacher.' });
  }
});

router.post('/admin/teachers/:teacherId/photo', requireRole('admin'), (req, res) => {
  photoUpload.single('photo')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Invalid photo upload.' });
    }
    try {
      const result = await saveTeacherPhoto(req.params.teacherId, req.file);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message || 'Could not save photo.' });
    }
  });
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

router.get('/admin/school-calendar', requireRole('admin'), async (req, res) => {
  try {
    const items = await listEntries({
      from: req.query.from || req.query.start,
      to: req.query.to || req.query.end,
      classId: req.query.classId,
      includeInactive: String(req.query.includeInactive || '') === '1'
    });
    res.json({ entries: items, academicYear: defaultAcademicYearRange() });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load school calendar.' });
  }
});

router.get('/admin/school-calendar/month', requireRole('admin'), async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    res.json(await getMonthCalendar(req.query.classId || '*', year, month));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load month calendar.' });
  }
});

router.get('/admin/school-calendar/year', requireRole('admin'), async (req, res) => {
  try {
    res.json(await getYearCalendar(
      req.query.classId || '*',
      req.query.start || req.query.startDate,
      req.query.end || req.query.endDate
    ));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load year calendar.' });
  }
});

router.post('/admin/school-calendar', requireRole('admin'), async (req, res) => {
  try {
    const entry = await upsertEntry(req.body || {});
    res.json({ entry });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save calendar entry.' });
  }
});

router.delete('/admin/school-calendar/:entryId', requireRole('admin'), async (req, res) => {
  try {
    res.json(await deleteEntry(req.params.entryId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete calendar entry.' });
  }
});

router.get('/admin/school-semesters', requireRole('admin'), async (req, res) => {
  try {
    const [semesters, active] = await Promise.all([
      listSchoolSemesters(),
      getActiveSchoolSemester()
    ]);
    res.json({ semesters, activeSemesterKey: active ? active.key : '' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load school semesters.' });
  }
});

router.put('/admin/school-semesters', requireRole('admin'), async (req, res) => {
  try {
    const result = await saveSchoolSemesters(req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save school semesters.' });
  }
});

/** @deprecated Prefer /admin/school-semesters — kept for compatibility */
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

router.get('/admin/students/:studentId/grades', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const { getStudentGradeSummary } = require('./services/gradeService');
    res.json(await getStudentGradeSummary(req.params.studentId, { term: req.query.term || '' }));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load grades.' });
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

router.post('/admin/students/:studentId/withdraw', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const student = await withdrawStudent(req.params.studentId);
    res.json({ student });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not withdraw student.' });
  }
});

router.post('/admin/students/:studentId/restore', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const student = await restoreStudent(req.params.studentId);
    res.json({ student });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not restore student.' });
  }
});

router.delete('/admin/students/:studentId', requireRole('admin'), async (req, res) => {
  try {
    await ensureRegistrySheets();
    const result = await deleteStudent(req.params.studentId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete student.' });
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

router.get('/admin/parents', requireRole('admin'), async (req, res) => {
  try {
    const { listParents, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    res.json({ parents: await listParents({ q: req.query.q || '' }) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load parents.' });
  }
});

router.get('/admin/parents/:parentId', requireRole('admin'), async (req, res) => {
  try {
    const {
      getParentRecord,
      listChildrenForParent,
      ensureParentStudentsSheet
    } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const parent = await getParentRecord(req.params.parentId);
    if (!parent) return res.status(404).json({ error: 'Parent not found.' });
    const children = await listChildrenForParent(parent.parentId);
    res.json({ parent, children });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load parent.' });
  }
});

router.post('/admin/parents', requireRole('admin'), async (req, res) => {
  try {
    const { saveParentAccount, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const parent = await saveParentAccount(req.body || {});
    res.json({ parent });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save parent.' });
  }
});

router.get('/admin/students/:studentId/parents', requireRole('admin'), async (req, res) => {
  try {
    const { listParentsForStudent, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    res.json({ parents: await listParentsForStudent(req.params.studentId) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load linked parents.' });
  }
});

router.post('/admin/students/:studentId/parents', requireRole('admin'), async (req, res) => {
  try {
    const { linkOrCreateParentForStudent, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const result = await linkOrCreateParentForStudent(req.params.studentId, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not link parent.' });
  }
});

router.patch('/admin/students/:studentId/parents/:parentId', requireRole('admin'), async (req, res) => {
  try {
    const { updateParentStudentLink, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const result = await updateParentStudentLink(req.params.parentId, req.params.studentId, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not update parent link.' });
  }
});

router.delete('/admin/students/:studentId/parents/:parentId', requireRole('admin'), async (req, res) => {
  try {
    const { unlinkParentFromStudent, ensureParentStudentsSheet } = require('./services/parentRegistryService');
    await ensureParentStudentsSheet();
    const result = await unlinkParentFromStudent(req.params.parentId, req.params.studentId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not unlink parent.' });
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

router.post('/admin/timetable/classes/:classId', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const timetable = await saveClassTimetable(req.params.classId, req.body.entries || []);
    res.json({
      timetable,
      studentsUpdated: timetable.studentsUpdated || 0,
      teachersUpdated: timetable.teachersUpdated || 0
    });
  } catch (e) {
    console.error('[timetable] save class failed:', e);
    const status = /conflict|period|required|double-book/i.test(e.message || '') ? 400 : 500;
    res.status(status).json({ error: e.message || 'Could not save class timetable.' });
  }
});

router.get('/admin/timetable/teacher-busy', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    const data = await getTeacherBusyMap(req.query.excludeClassId || '');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load teacher busy map.' });
  }
});

router.get('/admin/timetable/matrix', requireRole('admin'), async (req, res) => {
  try {
    await ensureTimetableSheet();
    res.json(await getAllClassesMatrix());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load timetable matrix.' });
  }
});

router.post('/admin/timetable/generate', requireRole('admin'), async (req, res) => {
  try {
    const { classId } = req.body || {};
    const result = await generateClassTimetable(classId);
    const timetable = await getTimetable('class', classId);
    res.json({ result, timetable });
  } catch (e) {
    const code = e.message && /solver|not running|timed out/i.test(e.message) ? 503 : 400;
    res.status(code).json({ error: e.message || 'Could not generate timetable.' });
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

const {
  generateJeopardyBoard,
  createBlankJeopardyBoard
} = require('./services/jeopardyService');

router.post('/jeopardy/generate', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    const board = await generateJeopardyBoard({
      subject: body.subject || body.topic,
      title: body.title,
      difficulty: body.difficulty,
      language: body.language,
      teamCount: body.teamCount
    });
    res.json({ ok: true, game: board });
  } catch (e) {
    console.error('POST /jeopardy/generate', e);
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not generate Jeopardy board.' });
  }
});

router.post('/jeopardy/blank', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    res.json({
      ok: true,
      game: createBlankJeopardyBoard({
        subject: body.subject || body.topic || 'Jeopardy',
        title: body.title,
        difficulty: body.difficulty,
        language: body.language,
        teamCount: body.teamCount
      })
    });
  } catch (e) {
    console.error('POST /jeopardy/blank', e);
    res.status(400).json({ error: e.message || 'Could not create blank board.' });
  }
});

const {
  listItems,
  saveItem,
  deleteItem,
  generateQuestions,
  generateSimilarQuestion,
  sortQuestions,
  listExams,
  getExam,
  saveExam,
  deleteExam,
  ensureItemBankSheets
} = require('./services/itemBankService');

function itemBankTeacherId(req) {
  return req.session.teacherId || req.session.adminId || req.session.userId || 'admin';
}

router.get('/item-bank', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    await ensureItemBankSheets();
    const items = await listItems(itemBankTeacherId(req), {
      q: req.query.q,
      subject: req.query.subject,
      difficulty: req.query.difficulty,
      tag: req.query.tag
    });
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load item bank.' });
  }
});

router.post('/item-bank', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const item = await saveItem(itemBankTeacherId(req), req.body || {});
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save question.' });
  }
});

router.delete('/item-bank/:id', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const result = await deleteItem(itemBankTeacherId(req), req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete question.' });
  }
});

router.post('/item-bank/generate', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const questions = await generateQuestions(itemBankTeacherId(req), req.body || {});
    res.json({ ok: true, questions });
  } catch (e) {
    console.error('POST /item-bank/generate', e);
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not generate questions.' });
  }
});

router.post('/item-bank/generate-similar', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const question = await generateSimilarQuestion(itemBankTeacherId(req), req.body || {});
    res.json({ ok: true, question });
  } catch (e) {
    console.error('POST /item-bank/generate-similar', e);
    res.status(e.statusCode || 500).json({ error: e.message || 'Could not generate similar question.' });
  }
});

router.post('/item-bank/sort', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const questions = sortQuestions((req.body && req.body.questions) || [], req.body && req.body.rule);
    res.json({ ok: true, questions });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not sort questions.' });
  }
});

router.get('/item-bank/exams', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const exams = await listExams(itemBankTeacherId(req));
    res.json({ ok: true, exams });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load exams.' });
  }
});

router.get('/item-bank/exams/:id', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await getExam(itemBankTeacherId(req), req.params.id);
    res.json({ ok: true, exam });
  } catch (e) {
    res.status(e.message === 'Exam not found.' ? 404 : 500).json({ error: e.message });
  }
});

router.post('/item-bank/exams', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await saveExam(itemBankTeacherId(req), req.body || {});
    res.json({ ok: true, exam });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save exam.' });
  }
});

router.delete('/item-bank/exams/:id', requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const result = await deleteExam(itemBankTeacherId(req), req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete exam.' });
  }
});

/* ── Bus system ─────────────────────────────────────────────── */
async function busExclusions(dateStr) {
  const { buildBusExclusionsForDate } = require('./services/parentAttendanceNoticeService');
  return buildBusExclusionsForDate(dateStr);
}

router.get('/admin/bus/setup', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json(await busService.getBusSetupBundle());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load bus setup.' });
  }
});

router.get('/admin/bus/board', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const { todayStr } = require('./dateUtils');
    const dateStr = String(req.query.date || todayStr()).slice(0, 10);
    const exclusions = await busExclusions(dateStr);
    res.json(await busService.getAdminBusBoard(dateStr, exclusions));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load bus board.' });
  }
});

router.post('/admin/bus', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json({ bus: await busService.saveBus(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save bus.' });
  }
});

router.post('/admin/bus/run', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json({ run: await busService.saveRun(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save run.' });
  }
});

router.post('/admin/bus/assignment', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json({ assignment: await busService.saveAssignment(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save assignment.' });
  }
});

router.delete('/admin/bus/assignment/:assignmentId', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json(await busService.deleteAssignment(req.params.assignmentId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not delete assignment.' });
  }
});

router.post('/admin/bus/duty', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    res.json({ duty: await busService.saveDuty(req.body || {}) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save duty.' });
  }
});

router.post('/admin/bus/override', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const actor = { role: req.session.role, id: req.session.adminId || req.session.principalId || '' };
    res.json({ override: await busService.saveOverride(req.body || {}, actor) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save override.' });
  }
});

router.post('/admin/bus/noshow', requireRole('admin', 'principal'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const actor = { role: req.session.role, id: req.session.adminId || req.session.principalId || '' };
    res.json(await busService.reportNoShow(req.body || {}, actor));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not report no-show.' });
  }
});

router.get('/teacher/bus/duty', requireRole('teacher'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const { todayStr } = require('./dateUtils');
    const dateStr = String(req.query.date || todayStr()).slice(0, 10);
    const exclusions = await busExclusions(dateStr);
    res.json(await busService.getTeacherDutyManifest(req.session.teacherId, dateStr, exclusions));
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not load bus duty.' });
  }
});

router.post('/teacher/bus/noshow', requireRole('teacher'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const actor = { role: 'teacher', id: req.session.teacherId };
    const body = req.body || {};
    const dateStr = body.dateStr || body.date;
    const duty = await busService.getTeacherDutyManifest(
      req.session.teacherId,
      dateStr,
      await busExclusions(dateStr)
    );
    const runOk = (duty.runs || []).some((r) => r.runId === String(body.runId || ''));
    if (!runOk) return res.status(403).json({ error: 'Not on duty for this run.' });
    res.json(await busService.reportNoShow(body, actor));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not report no-show.' });
  }
});

router.post('/teacher/bus/override', requireRole('teacher'), async (req, res) => {
  try {
    const busService = require('./services/busService');
    const actor = { role: 'teacher', id: req.session.teacherId };
    const body = req.body || {};
    const dateStr = body.dateStr || body.date;
    const duty = await busService.getTeacherDutyManifest(
      req.session.teacherId,
      dateStr,
      await busExclusions(dateStr)
    );
    const runOk = (duty.runs || []).some((r) => r.runId === String(body.runId || ''));
    if (!runOk) return res.status(403).json({ error: 'Not on duty for this run.' });
    res.json({ override: await busService.saveOverride(body, actor) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not save override.' });
  }
});

module.exports = router;
