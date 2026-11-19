'use strict';

/**
 * Content-only student portal helpers: external product links and class overview.
 */

const { getClassById, PORTAL_CONTENT, normalizePortalMode } = require('./classRegistryService');
const debriefAssignments = require('./debriefAssignmentService');
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

  const students = [];
  for (const s of roster) {
    const studentId = String(s.studentId || s.id || '');
    const debrief = await debriefAssignments.listForStudent(classId, studentId);
    let lessonList = { lessons: [] };
    try {
      lessonList = await lmsLessons.listForStudent(classId, studentId);
    } catch (_) { /* ignore */ }

    const debriefItems = (debrief.assignments || []).map((a) => ({
      id: a.id,
      title: a.title || a.bookTitle,
      status: a.status,
      reportReleased: !!a.reportReleased,
      canStartOral: !!a.canStartOral
    }));
    const lessonItems = (lessonList.lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      completed: !!l.completed,
      percent: l.percent != null ? l.percent : 0
    }));

    students.push({
      studentId,
      name: s.name || studentId,
      debrief: {
        total: debriefItems.length,
        completed: debriefItems.filter((x) => x.status === 'completed').length,
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
      studentIds: a.studentIds || null
    })),
    lessons: (lessons || []).map((l) => ({
      id: l.id,
      title: l.title,
      published: !!l.published,
      status: l.status,
      studentIds: l.studentIds || null,
      startedCount: l.startedCount,
      completedCount: l.completedCount
    })),
    students
  };
}

module.exports = {
  portalForClass,
  overviewForClass,
  boosterUrl,
  magicAcademyUrl
};
