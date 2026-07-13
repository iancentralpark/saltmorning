const express = require('express');
const { isSupabaseEnabled, shouldSyncPasswordsToSheet } = require('./supabaseClient');
const {
  listPortalLoginsForClass,
  resetPortalPasswordByTeacher
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
const { getBuddyStatus, askEnglishBuddy, streamEnglishBuddy } = require('./englishBuddyService');
const {
  getThread,
  markMessagesRead,
  getStudentUnreadCount,
  getInboxForClass,
  getGlobalInbox,
  getUnreadTotalForClass,
  getUnreadTotalGlobal,
  studentSendMessage,
  teacherSendMessage
} = require('./messageService');
const {
  groupLuckyTickets,
  saveLuckyDrawTicket,
  purchaseLuckyDrawTicket,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  transferLuckyTicket
} = require('./luckyDrawService');
const {
  getLuckyDrawConfig,
  getActiveClientTiers,
  saveLuckyDrawConfig
} = require('./luckyDrawConfigService');
const { addManualPendingHomework, addManualPendingHomeworkBatch } = require('./manualHomeworkService');
const { withdrawStudent, listWithdrawnStudents } = require('./withdrawnStudentService');
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
const { addEnrolledStudent } = require('./studentListService');
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
const { notifyNewMessage, notifyThreadRead, isRealtimeEnabled } = require('./realtime');
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
    const { classId, dateStr } = req.body || {};
    if (!classId || !dateStr) return res.status(400).json({ error: 'classId and dateStr are required' });
    res.json(await syncHomeworkClassroomForClassDate(classId, dateStr));
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
    res.json(await transferLuckyTicket(ticketId, toStudentId));
  } catch (e) {
    console.error('POST /lucky-draw/transfer', e);
    res.status(400).json({ error: e.message || 'Transfer failed' });
  }
});

router.post('/lucky-draw/redeem', async (req, res) => {
  try {
    const { ticketId } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
    res.json(await redeemLuckyTicket(ticketId));
  } catch (e) {
    console.error('POST /lucky-draw/redeem', e);
    res.status(500).json({ error: e.message || 'Server error' });
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

router.get('/students/withdrawn', async (req, res) => {
  try {
    const classId = req.query.classId || '';
    res.json(await listWithdrawnStudents(classId));
  } catch (e) {
    console.error('GET /students/withdrawn', e);
    res.status(500).json({ error: e.message || 'Server error' });
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

router.post('/student/english-buddy', requireStudentAuth, async (req, res) => {
  try {
    const { studentId } = req.studentSession;
    const prompt = String(req.body.prompt || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const result = await askEnglishBuddy(studentId, prompt, history);
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
    const { studentId } = req.studentSession;
    const prompt = String(req.body.prompt || '').trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    await streamEnglishBuddy(res, studentId, prompt, history);
  } catch (e) {
    console.error('POST /student/english-buddy/stream', e);
    const msg = e.message || 'Request failed';
    const status = /today/i.test(msg) ? 429 : 400;
    if (!res.headersSent) {
      res.status(status).json({ error: msg });
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
