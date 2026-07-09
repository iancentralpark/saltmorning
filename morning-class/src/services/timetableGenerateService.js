const { TIMETABLE_SOLVER_URL } = require('../config');
const { getBellSchedule } = require('./bellScheduleService');
const { listRequirements } = require('./timetableRequirementsService');
const { getClassRoster } = require('./teacherPortalService');
const {
  loadAllEntries,
  saveTimetable,
  newId: newEntryId,
  isoNow,
  sortEntries
} = require('./timetableService');

async function callSolver(payload) {
  const url = (TIMETABLE_SOLVER_URL || 'http://127.0.0.1:8791').replace(/\/$/, '') + '/solve';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw new Error(
      'Timetable solver is not running. Start it with: cd morning-class/solver && pip install -r requirements.txt && python main.py'
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || data.message || 'Solver request failed.');
  return data;
}

async function collectForbiddenSlots(excludeClassId) {
  const all = await loadAllEntries();
  const forbidden = [];
  const seen = new Set();

  all.forEach((e) => {
    if (e.ownerType !== 'class') return;
    if (excludeClassId && e.classId === excludeClassId) return;
    if (!e.teacherId) return;

    const lessonIdx = Number(e.sortOrder);
    if (!Number.isInteger(lessonIdx)) return;
    const key = e.teacherId + ':' + e.dayOfWeek + ':' + lessonIdx;
    if (seen.has(key)) return;
    seen.add(key);
    forbidden.push({
      teacherId: e.teacherId,
      day: e.dayOfWeek,
      lessonSlotIndex: lessonIdx
    });
  });
  return forbidden;
}

async function generateClassTimetable(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const [{ periods, lessonPeriods }, requirements, forbidden, roster] = await Promise.all([
    getBellSchedule(),
    listRequirements(classId),
    collectForbiddenSlots(classId),
    getClassRoster(classId)
  ]);

  if (!requirements.length) {
    throw new Error('No subject requirements for this class. Import from assignments or add manually.');
  }

  const activities = requirements.map((r) => ({
    id: r.reqId || ('act_' + r.subject),
    classId,
    subject: r.subject,
    teacherId: r.teacherId,
    periodsPerWeek: r.periodsPerWeek,
    room: r.room || ''
  }));

  const result = await callSolver({
    days: [1, 2, 3, 4, 5],
    periods,
    activities,
    forbidden,
    timeLimitSeconds: 45
  });

  if (result.status !== 'OK' || !result.assignments || !result.assignments.length) {
    throw new Error(result.message || 'Solver could not generate a timetable.');
  }

  const now = isoNow();
  const classEntries = result.assignments.map((a, idx) => ({
    entryId: newEntryId('tte'),
    ownerType: 'class',
    ownerId: classId,
    classId,
    dayOfWeek: a.day,
    startTime: a.startTime,
    endTime: a.endTime,
    subject: a.subject,
    teacherId: a.teacherId,
    room: a.room || '',
    notes: 'auto-generated',
    sortOrder: a.lessonSlotIndex,
    updatedAt: now
  }));

  await saveTimetable('class', classId, classEntries);

  const teacherIds = [...new Set(result.assignments.map((a) => a.teacherId))];
  for (const teacherId of teacherIds) {
    await rebuildTeacherTimetable(teacherId);
  }

  for (const student of roster) {
    await saveTimetable('student', student.studentId, classEntries.map((e) => ({
      ...e,
      entryId: newEntryId('tte'),
      ownerType: 'student',
      ownerId: student.studentId,
      updatedAt: now
    })));
  }

  return {
    classId,
    assignmentCount: result.assignments.length,
    studentsUpdated: roster.length,
    teachersUpdated: teacherIds.length,
    message: result.message
  };
}

async function rebuildTeacherTimetable(teacherId) {
  const all = await loadAllEntries();
  const classEntries = all.filter((e) => e.ownerType === 'class' && e.teacherId === teacherId);
  const entries = sortEntries(classEntries.map((e) => ({
    entryId: newEntryId('tte'),
    ownerType: 'teacher',
    ownerId: teacherId,
    classId: e.classId,
    dayOfWeek: e.dayOfWeek,
    startTime: e.startTime,
    endTime: e.endTime,
    subject: e.subject,
    teacherId,
    room: e.room,
    notes: e.notes,
    sortOrder: e.sortOrder,
    updatedAt: isoNow()
  })));
  await saveTimetable('teacher', teacherId, entries);
}

module.exports = { generateClassTimetable, callSolver, collectForbiddenSlots, rebuildTeacherTimetable };
