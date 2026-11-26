'use strict';

/**
 * Content-only student portal helpers: external product links and class overview.
 */

const { getClassById, PORTAL_CONTENT, normalizePortalMode } = require('./classRegistryService');
const debriefAssignments = require('./debriefAssignmentService');
const debriefSessions = require('./debriefSessionService');
const lmsLessons = require('./lmsLessonService');
const { getClassRoster } = require('./teacherPortalService');

function boosterUrl() {
  return String(process.env.CONTENT_PORTAL_BOOSTER_URL || process.env.ENGLISH_BOOSTER_URL || '').trim();
}

function magicAcademyUrl() {
  return String(process.env.CONTENT_PORTAL_MAGIC_ACADEMY_URL || process.env.MAGIC_ACADEMY_URL || '').trim();
}

async function portalForClass(classId) {
  const cls = await getClassById(classId);
  const mode = cls ? normalizePortalMode(cls.portalMode) : 'full';
  const flags = (cls && cls.contentFlags) || { englishBooster: true, magicAcademy: false };
  const links = {
    englishBooster: flags.englishBooster !== false && boosterUrl() ? boosterUrl() : null,
    magicAcademy: flags.magicAcademy === true && magicAcademyUrl() ? magicAcademyUrl() : null
  };
  return {
    mode,
    isContent: mode === PORTAL_CONTENT,
    flags,
    links,
    classId: cls ? cls.classId : classId,
    className: cls ? cls.name : ''
  };
}

async function overviewForClass(classId) {
  classId = String(classId || '').trim();
  const portal = await portalForClass(classId);
  const roster = await getClassRoster(classId);
  const assignments = await debriefAssignments.listByClass(classId);
  const lessons = await lmsLessons.listForStaff(classId);

  // Preload staff session summaries (status + score) per assignment.
  const sessionsByAssignment = {};
  for (const a of assignments) {
    try {
      const list = await debriefSessions.listByAssignment(a.id);
      const byStudent = {};
      (list || []).forEach((sess) => {
        byStudent[String(sess.studentId)] = {
          sessionId: sess.id,
          status: sess.status,
          gradeStatus: sess.gradeStatus || 'none',
          total: sess.total != null ? sess.total : null,
          reportReleased: !!sess.reportReleased,
          studentTurns: sess.studentTurns || 0,
          updatedAt: sess.updatedAt || null
        };
      });
      sessionsByAssignment[a.id] = byStudent;
    } catch (_) {
      sessionsByAssignment[a.id] = {};
    }
  }

  const students = [];
  for (const s of roster) {
    const studentId = String(s.studentId || s.id || '');
    const debrief = await debriefAssignments.listForStudent(classId, studentId);
    let lessonList = { lessons: [] };
    try {
      lessonList = await lmsLessons.listForStudent(classId, studentId);
    } catch (_) { /* ignore */ }

    const debriefItems = (debrief.assignments || []).map((a) => {
      const sess = (sessionsByAssignment[a.id] || {})[studentId] || null;
      return {
        id: a.id,
        title: a.title || a.bookTitle,
        status: (sess && sess.status === 'completed') ? 'completed'
          : (sess && sess.status === 'active') ? 'in_progress'
            : (a.status || 'assigned'),
        reportReleased: !!(sess && sess.reportReleased),
        gradeStatus: sess ? sess.gradeStatus : 'none',
        gradeTotal: sess && sess.total != null ? sess.total : null,
        sessionId: sess ? sess.sessionId : null,
        canStartOral: !!a.canStartOral
      };
    });
    const lessonItems = (lessonList.lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      completed: !!l.completed,
      percent: l.percent != null ? l.percent : 0,
      watchedSeconds: Number(l.watchedSeconds) || 0
    }));

    const scored = debriefItems.filter((x) => x.gradeTotal != null);
    const avgScore = scored.length
      ? Math.round(scored.reduce((sum, x) => sum + Number(x.gradeTotal), 0) / scored.length)
      : null;

    students.push({
      studentId,
      name: s.name || studentId,
      debrief: {
        total: debriefItems.length,
        completed: debriefItems.filter((x) => x.status === 'completed').length,
        graded: scored.length,
        avgScore,
        items: debriefItems
      },
      lessons: {
        total: lessonItems.length,
        completed: lessonItems.filter((x) => x.completed).length,
        items: lessonItems
      }
    });
  }

  return {
    portal,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      bookTitle: a.bookTitle,
      bookId: a.bookId,
      dueDate: a.dueDate,
      studentIds: a.studentIds || null,
      targeted: !!(a.studentIds && a.studentIds.length)
    })),
    lessons: (lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      published: !!l.published,
      status: l.status,
      studentIds: l.studentIds || null,
      targeted: !!(l.studentIds && l.studentIds.length),
      startedCount: l.startedCount,
      completedCount: l.completedCount
    })),
    students
  };
}

/**
 * Admin view of video watch progress and oral debrief results.
 * classId empty = every class. Classes are loaded a few at a time.
 */
async function learningBoard(classId) {
  const { listClasses } = require('./adminService');
  const classes = await listClasses();
  const want = String(classId || '').trim();
  const targets = want ? classes.filter((c) => c.classId === want) : classes;
  const students = [];
  const chunkSize = 2;
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    const boards = await Promise.all(chunk.map(async (c) => {
      try {
        return await overviewForClass(c.classId);
      } catch (e) {
        return { students: [] };
      }
    }));
    boards.forEach((board, idx) => {
      const c = chunk[idx];
      (board.students || []).forEach((st) => {
        const items = (st.lessons && st.lessons.items) || [];
        const watchedSeconds = items.reduce((n, l) => n + (Number(l.watchedSeconds) || 0), 0);
        const avgPercent = items.length
          ? Math.round(items.reduce((n, l) => n + (Number(l.percent) || 0), 0) / items.length)
          : null;
        students.push({
          studentId: st.studentId,
          name: st.name,
          classId: c.classId,
          className: c.name,
          debrief: st.debrief,
          lessons: {
            total: st.lessons ? st.lessons.total : 0,
            completed: st.lessons ? st.lessons.completed : 0,
            watchedSeconds,
            avgPercent,
            items
          }
        });
      });
    });
  }
  students.sort((a, b) =>
    String(a.className).localeCompare(String(b.className)) ||
    String(a.name).localeCompare(String(b.name))
  );
  return { classId: want, classes, students };
}

module.exports = {
  portalForClass,
  overviewForClass,
  learningBoard,
  boosterUrl,
  magicAcademyUrl
};
