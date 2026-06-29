const express = require('express');
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
  getStudentHomeworkStatus,
  setHomeworkCompletion,
  setHomeworkFixNote,
  getClassPendingHomework,
  isClassroomConfigured
} = require('./homeworkService');
const { saveAttendanceData } = require('./attendanceService');
const { getMonthlyReport } = require('./reportService');
const { getStudentHistory, updateStudentRecord } = require('./studentService');
const { getStudentStats } = require('./studentStatsService');
const {
  listClassStudents,
  getMakeupLessons,
  saveMakeupLesson
} = require('./makeupService');
const { studentLogin, getStudentDashboard } = require('./studentPortalService');
const { requireStudentAuth } = require('./studentAuth');
const {
  saveLuckyDrawTicket,
  listStudentLuckyTickets,
  redeemLuckyTicket
} = require('./luckyDrawService');
const { addManualPendingHomework } = require('./manualHomeworkService');
const { withdrawStudent, listWithdrawnStudents } = require('./withdrawnStudentService');
const { addEnrolledStudent } = require('./studentListService');
const { applyDollarAdjustment } = require('./dollarService');
const { toggleChambitRead, setChambitComboManual } = require('./chambitService');
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
const { buildRequestContext } = require('./sheets');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'mrpark-class-api',
    phase: 3,
    classroomOAuth: isClassroomConfigured(),
    classroomViaGas: process.env.CLASSROOM_ON_NODE !== 'true'
  });
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

router.get('/makeup', async (req, res) => {
  try {
    const { classId, studentId } = req.query;
    if (!classId) return res.status(400).json({ error: 'classId is required' });
    res.json(await getMakeupLessons(classId, studentId || ''));
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
    res.json(await saveMakeupLesson(classId, studentId, studentName, dateStr, startTime, endTime, notes));
  } catch (e) {
    console.error('POST /makeup', e);
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
    const { classId, studentId, title, description } = req.body || {};
    if (!classId || !studentId) return res.status(400).json({ error: 'classId and studentId are required' });
    res.json(await addManualPendingHomework(classId, studentId, title, description));
  } catch (e) {
    console.error('POST /homework/manual', e);
    res.status(500).json({ error: e.message || 'Server error' });
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
    res.json({ tickets: await listStudentLuckyTickets(classId, studentId) });
  } catch (e) {
    console.error('GET /lucky-draw/student', e);
    res.status(500).json({ error: e.message || 'Server error' });
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

router.post('/students/enroll', async (req, res) => {
  try {
    const { classId, name, loginId, loginPassword } = req.body || {};
    res.json(await addEnrolledStudent(classId, name, loginId, loginPassword));
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

router.get('/student/dashboard', requireStudentAuth, async (req, res) => {
  try {
    const { studentId, classId } = req.studentSession;
    res.json(await getStudentDashboard(studentId, classId));
  } catch (e) {
    console.error('GET /student/dashboard', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

module.exports = router;
