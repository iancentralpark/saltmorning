const express = require('express');
const { isSupabaseEnabled, shouldSyncPasswordsToSheet } = require('./supabaseClient');
const {
  listPortalLoginsForClass,
  resetPortalPasswordByTeacher,
  listManagedClasses,
  createClass,
  updateClass,
  reorderClasses,
  deleteClass,
  getStudentSchoolGrade,
  setStudentSchoolGrade
} = require('./supabaseStudentService');
const { syncStudentPasswordToSheet } = require('./studentPasswordSync');
const { getInitialData } = require('./initialService');
const {
  getClassSessionData,
  getClassWorkData,
  getClassSidebarCached,
  buildClassAttendanceFromCtx
} = require('./sessionService');
const {
  buildClassHomeworkFromCtx,
  listMyClassroomCourses,
  linkClassToClassroom,
  saveAndPostHomework,
  syncHomeworkClassroomForClassDate,
  getStudentHomeworkStatus,
  setHomeworkCompletion,
  setHomeworkFixNote,
  getClassPendingHomework,
  isClassroomConfigured
} = require('./homeworkService');
const { saveAttendanceData } = require('./attendanceService');
const { getMonthlyReport } = require('./reportService');
const { getStudentHistory, updateStudentRecord, deleteStudentRecord } = require('./studentService');
const { getStudentStats } = require('./studentStatsService');
const {
  listClassStudents,
  getMakeupLessons,
  saveMakeupLesson,
  updateMakeupLesson,
  deleteMakeupLesson,
  setMakeupStatus
} = require('./makeupService');
const { studentLogin, getStudentDashboard, changeStudentPassword } = require('./studentPortalService');
const { requireStudentAuth } = require('./studentAuth');
const {
  signTeacherToken,
  verifyTeacherToken,
  readTeacherTokenFromRequest,
  requireTeacherAuth,
  setTeacherAuthCookie,
  clearTeacherAuthCookie
} = require('./teacherAuth');
const { getBuddyStatus, askEnglishBuddy, streamEnglishBuddy, listBuddyUsageForClass, listBuddyMonitorRoster, refillBuddyUsage, refillBuddyUsageForClass, getTeacherBuddyStatus, streamTeacherVirtualMrPark, TEACHER_BUDDY_ID, TEACHER_BUDDY_CLASS } = require('./englishBuddyService');
const { getBuddyChatHistory, clearBuddyChatHistory } = require('./englishBuddyHistoryService');
const { listAbuseFlagsForClass, listAbuseFlagsAll, reviewAbuseFlag, getAbuseFlagChatLog, unlockBuddyAbuse } = require('./englishBuddyAbuseService');
const {
  getPlacementMeta,
  scorePlacement,
  deepDiveWord,
  nextTargetFreq,
  updateAbility,
  shouldStopPlacement
} = require('./vocabPlacementService');
const {
  configureVocabLearning,
  bulkUpsertWords,
  listWords: listVocabWords,
  getWordBankStats,
  deleteWord: deleteVocabWord,
  savePlacementResult,
  getDailyQueue,
  recordReview,
  recordDailyTestResult,
  getStudentVocabSummary,
  getClassSettings: getVocabClassSettings,
  saveClassSettings: saveVocabClassSettings,
  getClassOverview: getVocabClassOverview,
  overrideStudentState: overrideVocabStudentState,
  manualGrantReward: manualGrantVocabReward,
  getGenerationJob: getVocabGenerationJob,
  listActiveGenerationJobs: listActiveVocabGenerationJobs,
  buildPlacementItem
} = require('./vocabLearningService');

configureVocabLearning({
  tenantId: process.env.VOCAB_TENANT_ID || 'mrpark',
  skipLuckyDraw: process.env.VOCAB_SKIP_LUCKY_DRAW === 'true'
});
const vocabV1Routes = require('./vocabV1Routes');
const vocabPlatformRoutes = require('./vocabPlatformRoutes');
const { startGenerationJob: startVocabGenerationJob, cancelGenerationJob: cancelVocabGenerationJob } = require('./vocabWordGenService');
const {
  getThread,
  markMessagesRead,
  getStudentUnreadCount,
  getInboxForClass,
  getGlobalInbox,
  getUnreadTotalForClass,
  getUnreadTotalGlobal,
  studentSendMessage,
  teacherSendMessage,
  deleteThread
} = require('./messageService');
const {
  groupLuckyTickets,
  saveLuckyDrawTicket,
  purchaseLuckyDrawTicket,
  studentPurchaseLuckyDraw,
  getStudentLuckySpinStatus,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  transferLuckyTicket,
  studentTransferLuckyTicket,
  listLuckyTransfersForClass,
  fuseLuckyTickets,
  listFusionRecipes,
  executeUnluckyDraw
} = require('./luckyDrawService');
const {
  getLuckyDrawConfig,
  getActiveClientTiers,
  saveLuckyDrawConfig
} = require('./luckyDrawConfigService');
const { addManualPendingHomework, addManualPendingHomeworkBatch } = require('./manualHomeworkService');
const { withdrawStudent, listWithdrawnStudents, reinstateStudent } = require('./withdrawnStudentService');
const {
  startStudentLeave,
  endStudentLeave,
  listStudentLeaves,
  getActiveLeaveRecord
} = require('./leaveService');
const {
  listPlannedAttendance,
  getPlannedAttendanceCalendar,
  createPlannedAttendance,
  cancelPlannedAttendance
} = require('./plannedAttendanceService');
const { addEnrolledStudent, reorderClassStudents } = require('./studentListService');
const { applyDollarAdjustment, getStudentDollarBalance } = require('./dollarService');
const { toggleChambitRead, setChambitComboManual } = require('./chambitService');
const {
  getStampBoard,
  addStamp,
  removeStamp,
  redeemStampBoard,
  syncStampBoard
} = require('./stampBoardService');
const {
  getClassTextbookData,
  addTextbookToQueue,
  updateTextbookQueueItem,
  deleteTextbookQueueItem,
  addClassTextbook,
  updateClassTextbook,
  completeClassTextbook,
  saveTextbookProgress
} = require('./textbookService');
const {
  getClassRules,
  saveClassRules,
  getClassAnnouncement,
  saveClassAnnouncement,
  getClassUpcomingEvents,
  getClassEventsEditData,
  addClassEvent,
  deleteClassEvent,
  getClassVideo,
  saveClassVideo,
  getClassBooksToReturn,
  getLibraryEditData,
  addLibraryBooks,
  markLibraryBookReturned
} = require('./sidebarService');
const { getClassCalendarData } = require('./calendarService');
const { saveClassLogEntry, getClassLogEntry } = require('./classLogService');
const { isGeminiConfigured, askGemini, streamAskGemini, teacherGeminiOptions, getGeminiCallStats } = require('./geminiService');
const { notifyNewMessage, notifyThreadRead, notifyThreadCleared, isRealtimeEnabled } = require('./realtime');
const { buildRequestContext } = require('./sheets');
const { TEACHER_GATE_PASSWORD, LUCKY_DRAW_PURCHASE_COST } = require('./config');

const router = express.Router();

const PUBLIC_API_ROUTES = new Set([
  'GET /health',
  'POST /teacher/login',
  'POST /teacher-gate',
  'POST /student/login'
]);

function isPublicApiRoute(req) {
  const key = req.method + ' ' + req.path;
  if (PUBLIC_API_ROUTES.has(key)) return true;
  if (req.path.startsWith('/student/')) return true;
  // Multi-tenant Vocab Booster API has its own session / tenant-secret auth.
  if (req.path === '/vocab/v1' || req.path.startsWith('/vocab/v1/')) return true;
  // Platform admin has its own login + session (not teacher gate).
  if (req.path === '/vocab/platform' || req.path.startsWith('/vocab/platform/')) return true;
  return false;
}

function issueTeacherLogin(req, res) {
  if (!TEACHER_GATE_PASSWORD) {
    return res.status(503).json({ error: 'Teacher access is not configured yet.' });
  }
  const password = String((req.body && req.body.password) || '');
  if (password !== TEACHER_GATE_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const token = signTeacherToken();
  setTeacherAuthCookie(res, req, token);
  res.json({ ok: true, token });
}

router.use('/vocab/v1', vocabV1Routes);
router.use('/vocab/platform', vocabPlatformRoutes);

router.use((req, res, next) => {
  if (isPublicApiRoute(req)) return next();
  return requireTeacherAuth(req, res, next);
});

router.post('/teacher/login', issueTeacherLogin);

router.post('/teacher-gate', issueTeacherLogin);

router.post('/teacher/logout', (req, res) => {
  clearTeacherAuthCookie(res, req);
  res.json({ ok: true });
});

router.get('/teacher/session', (req, res) => {
  const token = readTeacherTokenFromRequest(req);
  const session = verifyTeacherToken(token);
  if (!session) return res.status(401).json({ error: 'Teacher login required.' });
  res.json({ ok: true, token: token });
});

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'mrpark-class-api',
    portalBuild: '2026-07-09.22',
    pwaEnabled: true,
    phase: 5,
    supabase: isSupabaseEnabled(),
    supabasePhase1: isSupabaseEnabled() ? ['classes', 'students', 'messages'] : null,
    supabasePhase2: isSupabaseEnabled()
      ? ['dollars', 'attendance', 'homework', 'classroom_map']
      : null,
    supabasePhase3: isSupabaseEnabled()
      ? ['chambit', 'textbooks', 'lucky_draw', 'makeup', 'leave', 'library', 'sidebar', 'withdrawn']
      : null,
    supabasePhase4: isSupabaseEnabled()
      ? ['class_log_daily', 'class_log_student_marks']
      : null,
    supabasePhase5: isSupabaseEnabled() ? ['students.login_password'] : null,
    supabaseMigrationComplete: isSupabaseEnabled(),
    messagesViaSupabase: isSupabaseEnabled(),
    classLogDualWrite: isSupabaseEnabled(),
    realtimeMessenger: isRealtimeEnabled(),
    geminiViaAiSdk: true,
    classroomOAuth: isClassroomConfigured(),
    classroomViaGas: process.env.CLASSROOM_ON_NODE !== 'true',
    gemini: isGeminiConfigured(),
    geminiCallsToday: getGeminiCallStats(),
    telegram: !!(
      String(process.env.TELEGRAM_BOT_TOKEN || '').trim() &&
      String(process.env.TELEGRAM_CHAT_ID || '').trim()
    )
  });
});

router.get('/gemini/status', (req, res) => {
  res.json({ configured: isGeminiConfigured() });
});

router.post('/gemini/ask', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const result = await askGemini(prompt, history, teacherGeminiOptions());
    if (!result.ok) {
      return res.status(result.fallbackWeb ? 503 : 502).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error('POST /gemini/ask', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/gemini/ask-stream', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    await streamAskGemini(res, prompt, history, teacherGeminiOptions());
  } catch (e) {
    console.error('POST /gemini/ask-stream', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'Server error' });
    }
  }
});

router.get('/initial', async (req, res) => {
  try {
    res.json(await getInitialData());
  } catch (e) {
    console.error('GET /initial', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/classes', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Class management requires Supabase.' });
    }
    res.json({ classes: await listManagedClasses() });
  } catch (e) {
    console.error('GET /classes', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/classes', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Class management requires Supabase.' });
    }
    const body = req.body || {};
    res.json({ ok: true, class: await createClass(body) });
  } catch (e) {
    console.error('POST /classes', e);
    res.status(400).json({ error: e.message || 'Could not create class' });
  }
});

router.put('/classes/:classId', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Class management requires Supabase.' });
    }
    const body = req.body || {};
    res.json({ ok: true, class: await updateClass(req.params.classId, body) });
  } catch (e) {
    console.error('PUT /classes/:classId', e);
    res.status(400).json({ error: e.message || 'Could not update class' });
  }
});

router.post('/classes/reorder', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Class management requires Supabase.' });
    }
    const body = req.body || {};
    res.json(await reorderClasses(body.classIds));
  } catch (e) {
    console.error('POST /classes/reorder', e);
    res.status(400).json({ error: e.message || 'Could not reorder classes' });
  }
});

router.delete('/classes/:classId', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Class management requires Supabase.' });
    }
    res.json(await deleteClass(req.params.classId));
  } catch (e) {
    console.error('DELETE /classes/:classId', e);
    const status = e.code === 'CLASS_HAS_STUDENTS' ? 409 : 400;
    res.status(status).json({ error: e.message || 'Could not delete class', code: e.code || null });
  }
});

router.get('/session', async (req, res) => {
  try {
    const classId = req.query.classId;
    const date = req.query.date || '';
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getClassSessionData(classId, date));
  } catch (e) {
    console.error('GET /session', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/work', async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!classId || !date) return res.status(400).json({ error: 'classId and date are required' });
    res.json(await getClassWorkData(classId, date));
  } catch (e) {
    console.error('GET /work', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/sidebar', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getClassSidebarCached(classId));
  } catch (e) {
    console.error('GET /sidebar', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/attendance', async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!classId || !date) return res.status(400).json({ error: 'classId and date are required' });
    const ctx = await buildRequestContext(classId);
    res.json(await buildClassAttendanceFromCtx(ctx, date));
  } catch (e) {
    console.error('GET /attendance', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/homework', async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!classId || !date) return res.status(400).json({ error: 'classId and date are required' });
    const ctx = await buildRequestContext(classId);
    res.json(await buildClassHomeworkFromCtx(ctx, date));
  } catch (e) {
    console.error('GET /homework', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/textbook', async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!classId || !date) return res.status(400).json({ error: 'classId and date are required' });
    res.json(await getClassTextbookData(classId, date));
  } catch (e) {
    console.error('GET /textbook', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/attendance', async (req, res) => {
  try {
    const { classId, dateStr, records } = req.body || {};
    if (!classId || !dateStr) return res.status(400).json({ error: 'classId and dateStr are required' });
    const message = await saveAttendanceData(classId, dateStr, records);
    res.json({ message });
  } catch (e) {
    console.error('POST /attendance', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/monthly-report', async (req, res) => {
  try {
    const { classId, year, month } = req.query;
    if (!classId || !year || !month) {
      return res.status(400).json({ error: 'classId, year, and month are required' });
    }
    res.json(await getMonthlyReport(classId, year, month));
  } catch (e) {
    console.error('GET /monthly-report', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student-history', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await getStudentHistory(classId, studentId));
  } catch (e) {
    console.error('GET /student-history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student-record', async (req, res) => {
  try {
    const { classId, studentId, dateStr, attendance, vocabScore } = req.body || {};
    if (!classId || !studentId || !dateStr) {
      return res.status(400).json({ error: 'classId, studentId, and dateStr are required' });
    }
    const message = await updateStudentRecord(classId, studentId, dateStr, attendance, vocabScore);
    res.json({ message });
  } catch (e) {
    console.error('POST /student-record', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/student-record', async (req, res) => {
  try {
    const { classId, studentId, dateStr } = req.query || {};
    if (!classId || !studentId || !dateStr) {
      return res.status(400).json({ error: 'classId, studentId, and dateStr are required' });
    }
    const message = await deleteStudentRecord(classId, studentId, dateStr);
    res.json({ message });
  } catch (e) {
    console.error('DELETE /student-record', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student-stats', async (req, res) => {
  try {
    const { classId, studentId, period } = req.query;
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await getStudentStats(classId, studentId, period));
  } catch (e) {
    console.error('GET /student-stats', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/students', async (req, res) => {
  try {
    const { classId } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await listClassStudents(classId));
  } catch (e) {
    console.error('GET /students', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/students/portal-logins', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Portal login lookup requires Supabase.' });
    }
    res.json({
      students: await listPortalLoginsForClass(classId, {
        skipCache: req.query.fresh === '1' || req.query.fresh === 'true'
      })
    });
  } catch (e) {
    console.error('GET /students/portal-logins', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/students/portal-password/reset', async (req, res) => {
  try {
    const { studentId, newPassword } = req.body || {};
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Password reset requires Supabase.' });
    }
    res.json(await resetPortalPasswordByTeacher(studentId, newPassword));
  } catch (e) {
    console.error('POST /students/portal-password/reset', e);
    const msg = e.message || 'Reset failed';
    const status = /Enter|characters|not active|not found/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/makeup', async (req, res) => {
  try {
    const { classId, studentId, status } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getMakeupLessons(classId, studentId || '', status ? { status } : {}));
  } catch (e) {
    console.error('GET /makeup', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/makeup', async (req, res) => {
  try {
    const { classId, studentId, studentName, dateStr, startTime, endTime, notes } = req.body || {};
    if (!classId || !studentId || !dateStr) {
      return res.status(400).json({ error: 'classId, studentId, and dateStr are required' });
    }
    res.json(await saveMakeupLesson(classId, studentId, studentName, dateStr, startTime, endTime, notes, {}));
  } catch (e) {
    console.error('POST /makeup', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.put('/makeup/:makeupId', async (req, res) => {
  try {
    const { makeupId } = req.params;
    const { classId, studentId, studentName, dateStr, startTime, endTime, notes } = req.body || {};
    res.json(await updateMakeupLesson(makeupId, {
      classId, studentId, studentName, dateStr, startTime, endTime, notes
    }));
  } catch (e) {
    console.error('PUT /makeup', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.patch('/makeup/:makeupId/status', async (req, res) => {
  try {
    const { makeupId } = req.params;
    const { status } = req.body || {};
    res.json(await setMakeupStatus(makeupId, status));
  } catch (e) {
    console.error('PATCH /makeup/status', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/makeup/:makeupId', async (req, res) => {
  try {
    const { makeupId } = req.params;
    res.json(await deleteMakeupLesson(makeupId));
  } catch (e) {
    console.error('DELETE /makeup', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/dollar/balance', async (req, res) => {
  try {
    const studentId = req.query.studentId;
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    res.json({ studentId: String(studentId), balance: await getStudentDollarBalance(studentId) });
  } catch (e) {
    console.error('GET /dollar/balance', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/dollar', async (req, res) => {
  try {
    const { classId, studentId, amount, reason } = req.body || {};
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await applyDollarAdjustment(classId, studentId, amount, reason));
  } catch (e) {
    console.error('POST /dollar', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/stamp-board', async (req, res) => {
  try {
    const { classId } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getStampBoard(classId));
  } catch (e) {
    console.error('GET /stamp-board', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/stamp-board/stamp', async (req, res) => {
  try {
    const { classId, studentId, xPct, yPct, rotDeg } = req.body || {};
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await addStamp(classId, studentId, xPct, yPct, rotDeg));
  } catch (e) {
    console.error('POST /stamp-board/stamp', e);
    const status = e.code === 'STAMP_COLLISION' ? 409 : 500;
    res.status(status).json({ error: e.message || 'Server error' });
  }
});

router.post('/stamp-board/redeem', async (req, res) => {
  try {
    const { classId } = req.body || {};
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await redeemStampBoard(classId, { reason: 'stamp-board-manual' }));
  } catch (e) {
    console.error('POST /stamp-board/redeem', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/stamp-board/sync', async (req, res) => {
  try {
    const { classId, adds, removes } = req.body || {};
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await syncStampBoard(classId, adds, removes));
  } catch (e) {
    console.error('POST /stamp-board/sync', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/stamp-board/stamp/:stampId', async (req, res) => {
  try {
    const { classId } = req.query;
    const { stampId } = req.params;
    if (!classId || !stampId) return res.status(400).json({ error: 'classId and stampId are required' });
    res.json(await removeStamp(classId, stampId));
  } catch (e) {
    console.error('DELETE /stamp-board/stamp', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/chambit/toggle', async (req, res) => {
  try {
    const { classId, studentId, dateStr, action, allowedDays } = req.body || {};
    res.json(await toggleChambitRead(classId, studentId, dateStr, action, allowedDays));
  } catch (e) {
    console.error('POST /chambit/toggle', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/chambit/combo', async (req, res) => {
  try {
    const { studentId, comboCount } = req.body || {};
    res.json(await setChambitComboManual(studentId, comboCount));
  } catch (e) {
    console.error('POST /chambit/combo', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/class-log', async (req, res) => {
  try {
    const { classId, dateStr, lesson, homework, writing } = req.body || {};
    if (!classId || !dateStr) {
      return res.status(400).json({ error: 'classId and dateStr are required.' });
    }
    res.json(await saveClassLogEntry(classId, dateStr, lesson, homework, writing));
  } catch (e) {
    console.error('POST /class-log', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/class-log', async (req, res) => {
  try {
    const { classId, date } = req.query;
    if (!classId || !date) {
      return res.status(400).json({ error: 'classId and date are required.' });
    }
    res.json(await getClassLogEntry(classId, date));
  } catch (e) {
    console.error('GET /class-log', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/textbook/progress', async (req, res) => {
  try {
    const { classId, dateStr, records } = req.body || {};
    const message = await saveTextbookProgress(classId, dateStr, records);
    res.json({ message });
  } catch (e) {
    console.error('POST /textbook/progress', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/textbook/queue', async (req, res) => {
  try {
    const { classId, name, type, unitType, totalUnits } = req.body || {};
    res.json(await addTextbookToQueue(classId, name, type, unitType, totalUnits));
  } catch (e) {
    console.error('POST /textbook/queue', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.put('/textbook/queue/:queueId', async (req, res) => {
  try {
    const { name, type, unitType, totalUnits } = req.body || {};
    res.json(await updateTextbookQueueItem(req.params.queueId, name, type, unitType, totalUnits));
  } catch (e) {
    console.error('PUT /textbook/queue', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/textbook/queue/:queueId', async (req, res) => {
  try {
    res.json(await deleteTextbookQueueItem(req.params.queueId));
  } catch (e) {
    console.error('DELETE /textbook/queue', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/textbook', async (req, res) => {
  try {
    const { classId, name, type, unitType, totalUnits, startDateStr } = req.body || {};
    res.json(await addClassTextbook(classId, name, type, unitType, totalUnits, startDateStr));
  } catch (e) {
    console.error('POST /textbook', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.put('/textbook/:textbookId', async (req, res) => {
  try {
    const { name, type, unitType, totalUnits, startDateStr } = req.body || {};
    res.json(await updateClassTextbook(req.params.textbookId, name, type, unitType, totalUnits, startDateStr));
  } catch (e) {
    console.error('PUT /textbook', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/textbook/:textbookId/complete', async (req, res) => {
  try {
    res.json(await completeClassTextbook(req.params.textbookId));
  } catch (e) {
    console.error('POST /textbook/complete', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/rules', async (req, res) => {
  try {
    res.json(await getClassRules(req.query.classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/rules', async (req, res) => {
  try {
    const { classId, rulesText } = req.body || {};
    res.json(await saveClassRules(classId, rulesText));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/announcement', async (req, res) => {
  try {
    res.json(await getClassAnnouncement(req.query.classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/announcement', async (req, res) => {
  try {
    const { classId, text } = req.body || {};
    res.json(await saveClassAnnouncement(classId, text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/events', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (req.query.edit === '1') {
      return res.json(await getClassEventsEditData(classId));
    }
    res.json(await getClassUpcomingEvents(classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/events', async (req, res) => {
  try {
    const { classId, dateStr, description } = req.body || {};
    res.json(await addClassEvent(classId, dateStr, description));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/events/:eventId', async (req, res) => {
  try {
    res.json(await deleteClassEvent(req.params.eventId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/calendar', async (req, res) => {
  try {
    const classId = req.query.classId;
    const year = req.query.year;
    const month = req.query.month;
    let allowedDays = req.query.allowedDays;
    if (allowedDays) {
      allowedDays = String(allowedDays).split(',').map(Number).filter(n => !isNaN(n));
    } else {
      allowedDays = [];
    }
    res.json(await getClassCalendarData(classId, year, month, allowedDays));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/video', async (req, res) => {
  try {
    res.json(await getClassVideo(req.query.classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/video', async (req, res) => {
  try {
    const { classId, videoUrl } = req.body || {};
    res.json(await saveClassVideo(classId, videoUrl));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/library/return', async (req, res) => {
  try {
    res.json(await getClassBooksToReturn(req.query.classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/library/edit', async (req, res) => {
  try {
    res.json(await getLibraryEditData(req.query.classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/library/books', async (req, res) => {
  try {
    const { classId, studentId, titles } = req.body || {};
    res.json(await addLibraryBooks(classId, studentId, titles));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/library/return-book', async (req, res) => {
  try {
    res.json(await markLibraryBookReturned(req.body.bookId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/classroom/courses', async (req, res) => {
  try {
    res.json(await listMyClassroomCourses());
  } catch (e) {
    console.error('GET /classroom/courses', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/classroom/link', async (req, res) => {
  try {
    const { classId, courseId, courseName } = req.body || {};
    if (!classId || !courseId) return res.status(400).json({ error: 'classId and courseId are required' });
    res.json(await linkClassToClassroom(classId, courseId, courseName));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/homework/post', async (req, res) => {
  try {
    const { classId, dateStr, title, items, description, skipClassroom } = req.body || {};
    if (!classId || !dateStr) return res.status(400).json({ error: 'classId and dateStr are required' });
    const itemList = items || (description ? [{ title: description }] : null);
    res.json(await saveAndPostHomework(classId, dateStr, title, itemList, { skipClassroom: !!skipClassroom }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/homework/sync-classroom', async (req, res) => {
  try {
    const { classId, dateStr, title, description, items } = req.body || {};
    if (!classId || !dateStr) return res.status(400).json({ error: 'classId and dateStr are required' });
    res.json(await syncHomeworkClassroomForClassDate(classId, dateStr, {
      title,
      description,
      items
    }));
  } catch (e) {
    console.error('POST /homework/sync-classroom', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/homework/student', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await getStudentHomeworkStatus(classId, studentId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/homework/class-pending', async (req, res) => {
  try {
    const { classId } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getClassPendingHomework(classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/homework/completion', async (req, res) => {
  try {
    const { itemId, homeworkId, studentId, completed, classId } = req.body || {};
    const id = itemId || homeworkId;
    if (!id || !studentId) return res.status(400).json({ error: 'itemId and studentId are required' });
    res.json(await setHomeworkCompletion(id, studentId, completed, classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/homework/fix-note', async (req, res) => {
  try {
    const { itemId, studentId, fixNote, classId } = req.body || {};
    if (!itemId || !studentId) return res.status(400).json({ error: 'itemId and studentId are required' });
    res.json(await setHomeworkFixNote(itemId, studentId, fixNote, classId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/homework/manual', async (req, res) => {
  try {
    const { classId, studentId, studentIds, title, description } = req.body || {};
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    const ids = Array.isArray(studentIds) && studentIds.length
      ? studentIds.map(function(sid) { return String(sid); }).filter(Boolean)
      : (studentId ? [String(studentId)] : []);
    if (!ids.length) return res.status(400).json({ error: 'studentId or studentIds is required' });
    if (ids.length === 1) {
      res.json(await addManualPendingHomework(classId, ids[0], title, description));
      return;
    }
    res.json(await addManualPendingHomeworkBatch(classId, ids, title, description));
  } catch (e) {
    console.error('POST /homework/manual', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/lucky-draw/config', async (req, res) => {
  try {
    const config = await getLuckyDrawConfig();
    res.json({
      tiers: config.tiers,
      activeTiers: getActiveClientTiers(config)
    });
  } catch (e) {
    console.error('GET /lucky-draw/config', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.put('/lucky-draw/config', async (req, res) => {
  try {
    const { tiers } = req.body || {};
    res.json(await saveLuckyDrawConfig(tiers));
  } catch (e) {
    console.error('PUT /lucky-draw/config', e);
    res.status(400).json({ error: e.message || 'Save failed' });
  }
});

router.post('/lucky-draw/purchase', async (req, res) => {
  try {
    const { classId, studentId, tier, prizeText } = req.body || {};
    if (!classId || !studentId || !prizeText) {
      return res.status(400).json({ error: 'classId, studentId, and prizeText are required' });
    }
    res.json(await purchaseLuckyDrawTicket(classId, studentId, tier, prizeText, LUCKY_DRAW_PURCHASE_COST));
  } catch (e) {
    console.error('POST /lucky-draw/purchase', e);
    const status = e.code === 'INSUFFICIENT_DOLLARS' ? 402 : 500;
    res.status(status).json({
      error: e.message || 'Purchase failed',
      code: e.code || undefined,
      balance: e.balance,
      cost: e.cost || LUCKY_DRAW_PURCHASE_COST
    });
  }
});

router.post('/lucky-draw/ticket', async (req, res) => {
  try {
    const { classId, studentId, tier, prizeText } = req.body || {};
    if (!classId || !studentId || !prizeText) {
      return res.status(400).json({ error: 'classId, studentId, and prizeText are required' });
    }
    res.json(await saveLuckyDrawTicket(classId, studentId, tier, prizeText));
  } catch (e) {
    console.error('POST /lucky-draw/ticket', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/lucky-draw/student', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    const tickets = await listStudentLuckyTickets(classId, studentId);
    res.json({
      tickets: groupLuckyTickets(tickets),
      totalCount: tickets.length
    });
  } catch (e) {
    console.error('GET /lucky-draw/student', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/lucky-draw/transfer', async (req, res) => {
  try {
    const { ticketId, toStudentId } = req.body || {};
    if (!ticketId || !toStudentId) {
      return res.status(400).json({ error: 'ticketId and toStudentId are required' });
    }
    res.json(await transferLuckyTicket(ticketId, toStudentId, { actorType: 'teacher' }));
  } catch (e) {
    console.error('POST /lucky-draw/transfer', e);
    res.status(400).json({ error: e.message || 'Transfer failed' });
  }
});

router.get('/lucky-draw/transfers', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    const transfers = await listLuckyTransfersForClass(classId, {
      studentId: req.query.studentId || '',
      limit: req.query.limit
    });
    res.json({ transfers });
  } catch (e) {
    console.error('GET /lucky-draw/transfers', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/lucky-draw/redeem', async (req, res) => {
  try {
    const { ticketId } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
    res.json(await redeemLuckyTicket(ticketId, { reason: 'teacher_redeem', actorType: 'teacher' }));
  } catch (e) {
    console.error('POST /lucky-draw/redeem', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/lucky-draw/unlucky', async (req, res) => {
  try {
    const { classId, studentId, allowNegative } = req.body || {};
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    res.json(await executeUnluckyDraw(classId, studentId, { allowNegative: !!allowNegative }));
  } catch (e) {
    console.error('POST /lucky-draw/unlucky', e);
    res.status(400).json({ error: e.message || 'Unlucky draw failed' });
  }
});

router.post('/students/withdraw', async (req, res) => {
  try {
    const { classId, studentId } = req.body || {};
    res.json(await withdrawStudent(classId, studentId));
  } catch (e) {
    console.error('POST /students/withdraw', e);
    res.status(400).json({ error: e.message || 'Withdraw failed' });
  }
});

router.get('/students/leave', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    const leaves = await listStudentLeaves(classId, studentId);
    const active = await getActiveLeaveRecord(classId, studentId);
    res.json({ leaves, active });
  } catch (e) {
    console.error('GET /students/leave', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/students/leave', async (req, res) => {
  try {
    const { classId, studentId, startDate, endDate, reason } = req.body || {};
    if (!classId || !studentId || !startDate || !endDate) {
      return res.status(400).json({ error: 'classId, studentId, startDate, and endDate are required' });
    }
    res.json(await startStudentLeave(classId, studentId, startDate, endDate, reason));
  } catch (e) {
    console.error('POST /students/leave', e);
    res.status(400).json({ error: e.message || 'Leave failed' });
  }
});

router.post('/students/leave/end', async (req, res) => {
  try {
    const { leaveId } = req.body || {};
    if (!leaveId) return res.status(400).json({ error: 'leaveId is required' });
    res.json(await endStudentLeave(leaveId));
  } catch (e) {
    console.error('POST /students/leave/end', e);
    res.status(400).json({ error: e.message || 'End leave failed' });
  }
});

router.get('/students/planned-attendance', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    res.json({ items: await listPlannedAttendance(classId, studentId) });
  } catch (e) {
    console.error('GET /students/planned-attendance', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/students/planned-attendance/calendar', async (req, res) => {
  try {
    const { classId, studentId, year, month } = req.query;
    if (!classId || !studentId || !year || !month) {
      return res.status(400).json({ error: 'classId, studentId, year, and month are required' });
    }
    res.json(await getPlannedAttendanceCalendar(classId, studentId, year, month));
  } catch (e) {
    console.error('GET /students/planned-attendance/calendar', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/students/planned-attendance', async (req, res) => {
  try {
    const { classId, studentId, date, type, note } = req.body || {};
    if (!classId || !studentId || !date || !type) {
      return res.status(400).json({ error: 'classId, studentId, date, and type are required' });
    }
    res.json(await createPlannedAttendance(classId, studentId, date, type, note));
  } catch (e) {
    console.error('POST /students/planned-attendance', e);
    res.status(400).json({ error: e.message || 'Advance notice failed' });
  }
});

router.post('/students/planned-attendance/cancel', async (req, res) => {
  try {
    const { noticeId } = req.body || {};
    if (!noticeId) return res.status(400).json({ error: 'noticeId is required' });
    res.json(await cancelPlannedAttendance(noticeId));
  } catch (e) {
    console.error('POST /students/planned-attendance/cancel', e);
    res.status(400).json({ error: e.message || 'Cancel failed' });
  }
});

router.post('/students/enroll', async (req, res) => {
  try {
    const { classId, name, loginId, loginPassword } = req.body || {};
    const result = await addEnrolledStudent(classId, name, loginId, loginPassword);
    if (isSupabaseEnabled() && loginPassword && shouldSyncPasswordsToSheet()) {
      try {
        await syncStudentPasswordToSheet(result.studentId, String(loginPassword).trim());
      } catch (e) {
        console.error('enroll sheet password sync', e);
      }
    }
    res.json(result);
  } catch (e) {
    console.error('POST /students/enroll', e);
    res.status(400).json({ error: e.message || 'Enroll failed' });
  }
});

router.post('/students/reorder', async (req, res) => {
  try {
    const { classId, studentIds } = req.body || {};
    res.json(await reorderClassStudents(classId, studentIds));
  } catch (e) {
    console.error('POST /students/reorder', e);
    res.status(400).json({ error: e.message || 'Reorder failed' });
  }
});

router.get('/students/:studentId/school-grade', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'School grade requires Supabase.' });
    }
    res.json(await getStudentSchoolGrade(req.params.studentId));
  } catch (e) {
    console.error('GET /students/:studentId/school-grade', e);
    res.status(400).json({ error: e.message || 'Could not load school grade' });
  }
});

router.put('/students/:studentId/school-grade', requireTeacherAuth, async (req, res) => {
  try {
    if (!isSupabaseEnabled()) {
      return res.status(503).json({ error: 'School grade requires Supabase.' });
    }
    const body = req.body || {};
    res.json(await setStudentSchoolGrade(req.params.studentId, body.schoolGrade));
  } catch (e) {
    console.error('PUT /students/:studentId/school-grade', e);
    res.status(400).json({ error: e.message || 'Could not save school grade' });
  }
});

router.get('/students/withdrawn', async (req, res) => {
  try {
    const classId = req.query.classId || '';
    res.json(await listWithdrawnStudents(classId));
  } catch (e) {
    console.error('GET /students/withdrawn', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/students/reinstate', async (req, res) => {
  try {
    const { classId, studentId } = req.body || {};
    res.json(await reinstateStudent(classId, studentId));
  } catch (e) {
    console.error('POST /students/reinstate', e);
    res.status(400).json({ error: e.message || 'Reinstate failed' });
  }
});

router.post('/student/login', async (req, res) => {
  try {
    const { loginId, password } = req.body || {};
    res.json(await studentLogin(loginId, password));
  } catch (e) {
    console.error('POST /student/login', e);
    res.status(401).json({ error: e.message || 'Login failed' });
  }
});

router.post('/student/change-password', requireStudentAuth, async (req, res) => {
  try {
    const { studentId } = req.studentSession;
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (String(newPassword || '').trim() !== String(confirmPassword || '').trim()) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }
    res.json(await changeStudentPassword(studentId, currentPassword, newPassword));
  } catch (e) {
    console.error('POST /student/change-password', e);
    const msg = e.message || 'Request failed';
    const status = /incorrect|match|Enter|different|characters|not active/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/student/dashboard', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getStudentDashboard(studentId, classId));
  } catch (e) {
    console.error('GET /student/dashboard', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student/lucky-draw/recipes', requireStudentAuth, async (req, res) => {
  try {
    res.json({ recipes: listFusionRecipes() });
  } catch (e) {
    console.error('GET /student/lucky-draw/recipes', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student/lucky-draw/fuse', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const ticketIds = (req.body && req.body.ticketIds) || [];
    res.json(await fuseLuckyTickets(classId, studentId, ticketIds));
  } catch (e) {
    console.error('POST /student/lucky-draw/fuse', e);
    const msg = e.message || 'Upgrade failed';
    const status = /select|same tier|cannot be upgraded|not found|own tickets|Duplicate/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.post('/student/lucky-draw/transfer', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const ticketId = req.body && req.body.ticketId;
    const toStudentId = req.body && req.body.toStudentId;
    if (!ticketId || !toStudentId) {
      return res.status(400).json({ error: 'ticketId and toStudentId are required' });
    }
    res.json(await studentTransferLuckyTicket(classId, studentId, ticketId, toStudentId));
  } catch (e) {
    console.error('POST /student/lucky-draw/transfer', e);
    const msg = e.message || 'Transfer failed';
    const status = /own|not found|expired|already|not in|enrolled/i.test(msg) ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get('/student/lucky-draw/spin-status', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getStudentLuckySpinStatus(classId, studentId));
  } catch (e) {
    console.error('GET /student/lucky-draw/spin-status', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student/lucky-draw/spin', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await studentPurchaseLuckyDraw(classId, studentId));
  } catch (e) {
    console.error('POST /student/lucky-draw/spin', e);
    const msg = e.message || 'Spin failed';
    let status = 500;
    if (e.code === 'INSUFFICIENT_DOLLARS' || e.code === 'DAILY_LIMIT') status = 400;
    else if (/enough dollars|only .* times|configured|weights|prizes/i.test(msg)) status = 400;
    res.status(status).json({
      error: msg,
      code: e.code || null,
      used: e.used,
      limit: e.limit,
      balance: e.balance,
      cost: e.cost
    });
  }
});

router.get('/student/stamp-board', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const board = await getStampBoard(classId);
    const sid = String(studentId);
    const myStampCount = (board.stamps || []).filter(function(s) {
      return String(s.studentId) === sid;
    }).length;
    res.json(Object.assign({}, board, { studentId: sid, myStampCount }));
  } catch (e) {
    console.error('GET /student/stamp-board', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student/messages', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const messages = await getThread(classId, studentId, req.query.limit);
    try {
      const marked = await markMessagesRead(classId, studentId, 'student');
      if (marked > 0) notifyThreadRead(classId, studentId, 'student');
    } catch (readErr) {
      console.error('GET /student/messages mark read', readErr);
    }
    res.json({ messages });
  } catch (e) {
    console.error('GET /student/messages', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student/messages/mark-read', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const marked = await markMessagesRead(classId, studentId, 'student');
    if (marked > 0) notifyThreadRead(classId, studentId, 'student');
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /student/messages/mark-read', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student/messages', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const body = req.body && req.body.body;
    const studentName = req.body && req.body.studentName;
    const message = await studentSendMessage(studentId, classId, studentName, body);
    notifyNewMessage(classId, studentId, message);
    res.json({ ok: true, message });
  } catch (e) {
    console.error('POST /student/messages', e);
    res.status(400).json({ error: e.message || 'Send failed' });
  }
});

router.get('/student/messages/unread-count', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json({ count: await getStudentUnreadCount(studentId, classId) });
  } catch (e) {
    console.error('GET /student/messages/unread-count', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student/english-buddy/status', requireStudentAuth, async (req, res) => {
  try {
    const { studentId } = req.studentSession;
    res.json(getBuddyStatus(studentId));
  } catch (e) {
    console.error('GET /student/english-buddy/status', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/english-buddy/usage', async (req, res) => {
  try {
    const classId = String(req.query.classId || '').trim();
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await listBuddyUsageForClass(classId));
  } catch (e) {
    console.error('GET /english-buddy/usage', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/english-buddy/refill', async (req, res) => {
  try {
    const classId = String((req.body && req.body.classId) || '').trim();
    const studentId = String((req.body && req.body.studentId) || '').trim();
    const refillAll = !!(req.body && req.body.all);
    if (refillAll || (classId && !studentId)) {
      if (!classId) return res.status(400).json({ error: 'classId is required to refill all' });
      res.json(await refillBuddyUsageForClass(classId));
      return;
    }
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    const status = refillBuddyUsage(studentId);
    res.json({ ok: true, studentId: studentId, ...status });
  } catch (e) {
    console.error('POST /english-buddy/refill', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/english-buddy/abuse-flags', requireTeacherAuth, async (req, res) => {
  try {
    const classId = String(req.query.classId || '').trim();
    const includeReviewed = String(req.query.includeReviewed || '') === '1';
    if (!classId) {
      res.json(await listAbuseFlagsAll({ includeReviewed: includeReviewed }));
      return;
    }
    res.json(await listAbuseFlagsForClass(classId, { includeReviewed: includeReviewed }));
  } catch (e) {
    console.error('GET /english-buddy/abuse-flags', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/english-buddy/monitor', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await listBuddyMonitorRoster());
  } catch (e) {
    console.error('GET /english-buddy/monitor', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/english-buddy/abuse-flags/chat', requireTeacherAuth, async (req, res) => {
  try {
    const classId = String(req.query.classId || '').trim();
    const studentId = String(req.query.studentId || '').trim();
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    res.json(await getAbuseFlagChatLog(studentId, classId));
  } catch (e) {
    console.error('GET /english-buddy/abuse-flags/chat', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/english-buddy/history', requireTeacherAuth, async (req, res) => {
  try {
    const classId = String(req.query.classId || '').trim();
    const studentId = String(req.query.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    res.json(await getBuddyChatHistory(studentId, classId));
  } catch (e) {
    console.error('GET /english-buddy/history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/english-buddy/history/clear', requireTeacherAuth, async (req, res) => {
  try {
    const studentId = String((req.body && req.body.studentId) || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    res.json(await clearBuddyChatHistory(studentId));
  } catch (e) {
    console.error('POST /english-buddy/history/clear', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// ---- Vocab LMS: word bank uploads, class settings, roster overview (Round 2) ----

router.get('/vocab/words', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await listVocabWords({
      limit: req.query.limit,
      offset: req.query.offset,
      search: req.query.search
    }));
  } catch (e) {
    console.error('GET /vocab/words', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/vocab/words/stats', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await getWordBankStats());
  } catch (e) {
    console.error('GET /vocab/words/stats', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/vocab/words/bulk', requireTeacherAuth, async (req, res) => {
  try {
    const words = (req.body && req.body.words) || [];
    res.json(await bulkUpsertWords(words));
  } catch (e) {
    console.error('POST /vocab/words/bulk', e);
    res.status(400).json({ error: e.message || 'Bulk upload failed' });
  }
});

// AI-generated word bank: raw word list (paste / CSV / Excel, already normalized client-side)
// -> background Gemini batch job -> full vocab_words rows (definitions + pre-baked quiz).
router.get('/vocab/words/generate', requireTeacherAuth, async (req, res) => {
  try {
    const jobs = await listActiveVocabGenerationJobs();
    res.json({
      jobs: jobs.map(function (job) {
        return {
          id: job.id,
          status: job.status,
          total: job.total,
          completed: job.completed,
          failedWords: job.failed_words || []
        };
      })
    });
  } catch (e) {
    console.error('GET /vocab/words/generate', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/vocab/words/generate', requireTeacherAuth, async (req, res) => {
  try {
    const words = (req.body && req.body.words) || [];
    const result = await startVocabGenerationJob(words, 'teacher');
    res.json({
      ok: true,
      jobId: result.jobId,
      total: result.total,
      skippedExisting: result.skippedExisting || 0,
      skippedJunk: result.skippedJunk || 0,
      skippedJunkWords: result.skippedJunkWords || []
    });
  } catch (e) {
    console.error('POST /vocab/words/generate', e);
    res.status(400).json({
      error: e.message || 'Could not start generation job',
      skippedExisting: e.skippedExisting || 0,
      skippedJunk: e.skippedJunk || 0,
      skippedJunkWords: e.skippedJunkWords || []
    });
  }
});

router.get('/vocab/words/generate/:jobId', requireTeacherAuth, async (req, res) => {
  try {
    const job = await getVocabGenerationJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      id: job.id,
      status: job.status,
      total: job.total,
      completed: job.completed,
      failedWords: job.failed_words || []
    });
  } catch (e) {
    console.error('GET /vocab/words/generate/:jobId', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/vocab/words/generate/:jobId/cancel', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await cancelVocabGenerationJob(req.params.jobId));
  } catch (e) {
    console.error('POST /vocab/words/generate/:jobId/cancel', e);
    res.status(400).json({ error: e.message || 'Could not cancel job' });
  }
});

router.delete('/vocab/words/:wordId', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await deleteVocabWord(req.params.wordId));
  } catch (e) {
    console.error('DELETE /vocab/words/:wordId', e);
    res.status(400).json({ error: e.message || 'Delete failed' });
  }
});

router.get('/vocab/class/:classId/overview', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await getVocabClassOverview(req.params.classId));
  } catch (e) {
    console.error('GET /vocab/class/overview', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/vocab/class/:classId/settings', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await getVocabClassSettings(req.params.classId));
  } catch (e) {
    console.error('GET /vocab/class/settings', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/vocab/class/:classId/settings', requireTeacherAuth, async (req, res) => {
  try {
    const body = req.body || {};
    res.json(await saveVocabClassSettings(req.params.classId, {
      dailyTarget: body.dailyTarget,
      passThreshold: body.passThreshold,
      rewardTier: body.rewardTier,
      maxDailySessions: body.maxDailySessions
    }));
  } catch (e) {
    console.error('POST /vocab/class/settings', e);
    res.status(400).json({ error: e.message || 'Could not save settings' });
  }
});

router.post('/vocab/student/:studentId/override', requireTeacherAuth, async (req, res) => {
  try {
    const body = req.body || {};
    res.json(await overrideVocabStudentState(req.params.studentId, {
      gradeLevel: body.gradeLevel,
      resetPlacement: body.resetPlacement !== false
    }));
  } catch (e) {
    console.error('POST /vocab/student/override', e);
    res.status(400).json({ error: e.message || 'Could not override student state' });
  }
});

router.post('/vocab/student/:studentId/grant-reward', requireTeacherAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const classId = String(body.classId || '').trim();
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await manualGrantVocabReward(classId, req.params.studentId));
  } catch (e) {
    console.error('POST /vocab/student/grant-reward', e);
    res.status(400).json({ error: e.message || 'Could not grant reward' });
  }
});

router.post('/english-buddy/abuse-flags/review', requireTeacherAuth, async (req, res) => {
  try {
    const flagId = String((req.body && req.body.flagId) || '').trim();
    const classId = String((req.body && req.body.classId) || '').trim();
    const studentId = String((req.body && req.body.studentId) || '').trim();
    res.json(await reviewAbuseFlag(flagId, classId, studentId));
  } catch (e) {
    console.error('POST /english-buddy/abuse-flags/review', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/english-buddy/abuse-flags/unlock', requireTeacherAuth, async (req, res) => {
  try {
    const classId = String((req.body && req.body.classId) || '').trim();
    const studentId = String((req.body && req.body.studentId) || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });
    res.json(await unlockBuddyAbuse(studentId, classId));
  } catch (e) {
    console.error('POST /english-buddy/abuse-flags/unlock', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student/english-buddy/history', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getBuddyChatHistory(studentId, classId));
  } catch (e) {
    console.error('GET /student/english-buddy/history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/student/english-buddy/history', requireStudentAuth, async (req, res) => {
  try {
    const { studentId } = req.studentSession;
    res.json(await clearBuddyChatHistory(studentId));
  } catch (e) {
    console.error('DELETE /student/english-buddy/history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/student/vocab/placement/meta', requireStudentAuth, async (req, res) => {
  try {
    res.json(getPlacementMeta());
  } catch (e) {
    console.error('GET /student/vocab/placement/meta', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/student/vocab/placement/score', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const result = scorePlacement(req.body || {});
    try {
      await savePlacementResult(studentId, classId, result);
    } catch (persistErr) {
      console.error('savePlacementResult', persistErr.message || persistErr);
      result.persisted = false;
    }
    res.json(result);
  } catch (e) {
    console.error('POST /student/vocab/placement/score', e);
    res.status(400).json({ error: e.message || 'Could not score placement' });
  }
});

router.post('/student/vocab/placement/next', requireStudentAuth, async (req, res) => {
  try {
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
      abilityTrail: abilityTrail
    });
  } catch (e) {
    console.error('POST /student/vocab/placement/next', e);
    res.status(400).json({ error: e.message || 'Could not adapt difficulty' });
  }
});

router.post('/student/vocab/placement/item', requireStudentAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const item = await buildPlacementItem({
      abilityGrade: body.abilityGrade,
      questionIndex: body.questionIndex,
      avoidWordIds: body.avoidWordIds,
      abilityTrail: body.abilityTrail
    });
    res.json(item);
  } catch (e) {
    console.error('POST /student/vocab/placement/item', e);
    res.status(400).json({ error: e.message || 'Could not build placement item' });
  }
});

router.post('/student/vocab/deep-dive', requireStudentAuth, async (req, res) => {
  try {
    const body = req.body || {};
    res.json(await deepDiveWord({
      word: body.word,
      partOfSpeech: body.partOfSpeech || body.part_of_speech,
      focus: body.focus,
      levelHint: body.levelHint,
      studentLevel: body.studentLevel
    }));
  } catch (e) {
    console.error('POST /student/vocab/deep-dive', e);
    res.status(400).json({ error: e.message || 'Deep-dive failed' });
  }
});

// ---- Daily Quest: SRS review queue -> mini test -> auto reward (Round 2) ----

router.get('/student/vocab/summary', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getStudentVocabSummary(studentId, classId));
  } catch (e) {
    console.error('GET /student/vocab/summary', e);
    res.status(400).json({ error: e.message || 'Could not load vocab summary' });
  }
});

router.get('/student/vocab/daily-queue', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getDailyQueue(studentId, classId));
  } catch (e) {
    console.error('GET /student/vocab/daily-queue', e);
    res.status(400).json({ error: e.message || 'Could not load today\'s queue' });
  }
});

router.post('/student/vocab/review', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const body = req.body || {};
    res.json(await recordReview(studentId, classId, body.wordId, !!body.correct));
  } catch (e) {
    console.error('POST /student/vocab/review', e);
    res.status(400).json({ error: e.message || 'Could not record review' });
  }
});

router.post('/student/vocab/daily-test/submit', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const body = req.body || {};
    if (Array.isArray(body.answers)) {
      for (const a of body.answers) {
        if (!a || !a.wordId || !a.correct) continue;
        try {
          await recordReview(studentId, classId, a.wordId, true);
        } catch (err) {
          console.warn('daily-test answer sync', err.message || err);
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
  } catch (e) {
    console.error('POST /student/vocab/daily-test/submit', e);
    res.status(400).json({ error: e.message || 'Could not submit daily test' });
  }
});

const {
  getPromotionTestStatus,
  startPromotionTest,
  submitPromotionTest,
  ackPromotionTest
} = require('./vocabPromotionTestService');

router.get('/student/vocab/promotion-test/status', requireStudentAuth, async (req, res) => {
  try {
    res.json(await getPromotionTestStatus(req.studentSession.studentId));
  } catch (e) {
    console.error('GET /student/vocab/promotion-test/status', e);
    res.status(400).json({ error: e.message || 'Could not load promotion test' });
  }
});

router.post('/student/vocab/promotion-test/start', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await startPromotionTest(studentId, classId));
  } catch (e) {
    console.error('POST /student/vocab/promotion-test/start', e);
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not start promotion test', code: e.code });
  }
});

router.post('/student/vocab/promotion-test/submit', requireStudentAuth, async (req, res) => {
  try {
    res.json(await submitPromotionTest(req.studentSession.studentId, req.body || {}));
  } catch (e) {
    console.error('POST /student/vocab/promotion-test/submit', e);
    res.status(e.statusCode || 400).json({ error: e.message || 'Could not submit promotion test' });
  }
});

router.post('/student/vocab/promotion-test/ack', requireStudentAuth, async (req, res) => {
  try {
    res.json(await ackPromotionTest(req.studentSession.studentId, req.body || {}));
  } catch (e) {
    console.error('POST /student/vocab/promotion-test/ack', e);
    res.status(400).json({ error: e.message || 'Could not ack promotion test' });
  }
});

router.post('/student/english-buddy', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const prompt = String(req.body.prompt || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const result = await askEnglishBuddy(studentId, classId, prompt, history);
    res.json(result);
  } catch (e) {
    console.error('POST /student/english-buddy', e);
    const msg = e.message || 'Request failed';
    const status = /today/i.test(msg) ? 429 : 400;
    res.status(status).json({ error: msg });
  }
});

router.post('/student/english-buddy/stream', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    const prompt = String(req.body.prompt || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    await streamEnglishBuddy(res, studentId, classId, prompt, history);
  } catch (e) {
    console.error('POST /student/english-buddy/stream', e);
    const msg = e.message || 'Request failed';
    const status = /today/i.test(msg) ? 429 : 400;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
    }
  }
});

router.get('/teacher/virtual-mr-park/status', requireTeacherAuth, async (req, res) => {
  try {
    res.json(getTeacherBuddyStatus());
  } catch (e) {
    console.error('GET /teacher/virtual-mr-park/status', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/teacher/virtual-mr-park/history', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await getBuddyChatHistory(TEACHER_BUDDY_ID, TEACHER_BUDDY_CLASS));
  } catch (e) {
    console.error('GET /teacher/virtual-mr-park/history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.delete('/teacher/virtual-mr-park/history', requireTeacherAuth, async (req, res) => {
  try {
    res.json(await clearBuddyChatHistory(TEACHER_BUDDY_ID));
  } catch (e) {
    console.error('DELETE /teacher/virtual-mr-park/history', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/teacher/virtual-mr-park/stream', requireTeacherAuth, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    await streamTeacherVirtualMrPark(res, prompt, history);
  } catch (e) {
    console.error('POST /teacher/virtual-mr-park/stream', e);
    const msg = e.message || 'Request failed';
    if (!res.headersSent) {
      res.status(400).json({ error: msg });
    }
  }
});

router.get('/messages/inbox-all', async (req, res) => {
  try {
    res.json({ inbox: await getGlobalInbox() });
  } catch (e) {
    console.error('GET /messages/inbox-all', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/messages/unread-total-all', async (req, res) => {
  try {
    res.json({ count: await getUnreadTotalGlobal() });
  } catch (e) {
    console.error('GET /messages/unread-total-all', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/messages/inbox', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json({ inbox: await getInboxForClass(classId) });
  } catch (e) {
    console.error('GET /messages/inbox', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/messages/thread', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    const messages = await getThread(classId, studentId, req.query.limit);
    try {
      const marked = await markMessagesRead(classId, studentId, 'teacher');
      if (marked > 0) notifyThreadRead(classId, studentId, 'teacher');
    } catch (readErr) {
      console.error('GET /messages/thread mark read', readErr);
    }
    res.json({ messages });
  } catch (e) {
    console.error('GET /messages/thread', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/messages/mark-read', async (req, res) => {
  try {
    const { classId, studentId } = req.body || {};
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    const marked = await markMessagesRead(classId, studentId, 'teacher');
    if (marked > 0) notifyThreadRead(classId, studentId, 'teacher');
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /messages/mark-read', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.post('/messages', async (req, res) => {
  try {
    const { classId, studentId, studentName, body } = req.body || {};
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    const message = await teacherSendMessage(classId, studentId, studentName, body);
    notifyNewMessage(classId, studentId, message);
    res.json({ ok: true, message });
  } catch (e) {
    console.error('POST /messages', e);
    res.status(400).json({ error: e.message || 'Send failed' });
  }
});

router.post('/messages/thread/clear', requireTeacherAuth, async (req, res) => {
  try {
    const classId = String((req.body && req.body.classId) || '').trim();
    const studentId = String((req.body && req.body.studentId) || '').trim();
    if (!classId || !studentId) {
      return res.status(400).json({ error: 'classId and studentId are required' });
    }
    const result = await deleteThread(classId, studentId);
    notifyThreadCleared(classId, studentId);
    res.json(result);
  } catch (e) {
    console.error('POST /messages/thread/clear', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

router.get('/messages/unread-total', async (req, res) => {
  try {
    const classId = req.query.classId;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json({ count: await getUnreadTotalForClass(classId) });
  } catch (e) {
    console.error('GET /messages/unread-total', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;
