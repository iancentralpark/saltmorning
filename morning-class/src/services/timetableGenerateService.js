'use strict';

/**
 * AI/OR-Tools Timetable Generate — calls the CP-SAT solver microservice
 * and writes results into Timetable_Entries.
 *
 * Locked (pinned) slots are preserved and passed to the solver as mandatory
 * constraints; the solver only fills empty / unlocked periods.
 */

const { TIMETABLE_SOLVER_URL } = require('../config');
const { getBellSchedule } = require('./bellScheduleService');
const { listRequirements } = require('./timetableRequirementsService');
const {
  loadAllEntries,
  saveClassTimetable,
  getTimetable,
  newId: newEntryId,
  isoNow,
  slotKey
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
  if (!res.ok) {
    const detail = data.detail;
    const msg = typeof detail === 'string'
      ? detail
      : (data.error || data.message || 'Solver request failed.');
    throw new Error(msg);
  }
  return data;
}

function lessonIndexForEntry(entry, lessonPeriods) {
  if (!lessonPeriods || !lessonPeriods.length) return -1;
  if (entry.periodId) {
    const byId = lessonPeriods.findIndex((p) => p.periodId === entry.periodId);
    if (byId >= 0) return byId;
  }
  const so = Number(entry.sortOrder);
  if (Number.isInteger(so) && so >= 0 && so < lessonPeriods.length) return so;
  return lessonPeriods.findIndex((p) => p.startTime === entry.startTime);
}

/**
 * Teacher busy slots from OTHER classes (and optionally this class's locked cells).
 */
function collectForbiddenSlots(allEntries, excludeClassId, lessonPeriods, extraOccupied) {
  const forbidden = [];
  const seen = new Set();

  function push(teacherId, day, lessonSlotIndex) {
    if (!teacherId || lessonSlotIndex < 0) return;
    const key = teacherId + ':' + day + ':' + lessonSlotIndex;
    if (seen.has(key)) return;
    seen.add(key);
    forbidden.push({ teacherId, day, lessonSlotIndex });
  }

  (allEntries || []).forEach((e) => {
    if (e.ownerType !== 'class') return;
    if (excludeClassId && String(e.ownerId) === String(excludeClassId)) return;
    if (!e.teacherId) return;
    push(e.teacherId, e.dayOfWeek, lessonIndexForEntry(e, lessonPeriods));
  });

  (extraOccupied || []).forEach((o) => {
    if (o.teacherId) push(o.teacherId, o.day, o.lessonSlotIndex);
  });

  return forbidden;
}

/**
 * Match locked entries to requirements and reduce periodsPerWeek.
 * Also build occupied class slots + pin metadata for the solver.
 */
function buildPinsAndAdjustedRequirements(classId, requirements, existingEntries, lessonPeriods) {
  const locks = (existingEntries || []).filter((e) => e.locked && !e.isBreak);
  const occupiedClassSlots = [];
  const pinExtras = []; // teacher forbidden at lock slots
  const lockCounts = new Map(); // subject|teacherId -> count
  const lockedEntries = [];

  locks.forEach((lock) => {
    const lessonIdx = lessonIndexForEntry(lock, lessonPeriods);
    if (lessonIdx < 0 || !lock.dayOfWeek) return;

    lockedEntries.push(lock);
    occupiedClassSlots.push({ day: lock.dayOfWeek, lessonSlotIndex: lessonIdx });

    if (lock.teacherId) {
      pinExtras.push({
        teacherId: lock.teacherId,
        day: lock.dayOfWeek,
        lessonSlotIndex: lessonIdx
      });
    }

    const key = String(lock.subject || '').toLowerCase() + '|' + String(lock.teacherId || '');
    lockCounts.set(key, (lockCounts.get(key) || 0) + 1);
  });

  const adjusted = [];
  const pins = []; // optional forced assignments (activityId + day + slot)

  requirements.forEach((r, idx) => {
    const key = String(r.subject || '').toLowerCase() + '|' + String(r.teacherId || '');
    const deduct = lockCounts.get(key) || 0;
    if (deduct > 0) lockCounts.set(key, 0);
    const remaining = Math.max(0, Number(r.periodsPerWeek || 0) - deduct);
    const activityId = r.reqId || ('act_' + idx + '_' + r.subject);

    if (remaining > 0) {
      adjusted.push({
        id: activityId,
        classId,
        subject: r.subject,
        teacherId: r.teacherId,
        periodsPerWeek: remaining,
        room: r.room || ''
      });
    }

    // Emit pin records for solver awareness (mandatory occupied slots already listed)
    locks.forEach((lock) => {
      if (String(lock.subject).toLowerCase() !== String(r.subject).toLowerCase()) return;
      if (String(lock.teacherId) !== String(r.teacherId)) return;
      const lessonIdx = lessonIndexForEntry(lock, lessonPeriods);
      if (lessonIdx < 0) return;
      pins.push({
        activityId,
        teacherId: lock.teacherId,
        subject: lock.subject,
        day: lock.dayOfWeek,
        lessonSlotIndex: lessonIdx
      });
    });
  });

  return { adjusted, lockedEntries, occupiedClassSlots, pinExtras, pins };
}

/**
 * Generate a conflict-free timetable for one class using the OR-Tools solver.
 * Preserves locked slots; only fills empty / unlocked periods.
 */
async function generateClassTimetable(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const [{ periods, lessonPeriods }, requirements, allEntries, existingTt] = await Promise.all([
    getBellSchedule(),
    listRequirements(classId),
    loadAllEntries(),
    getTimetable('class', classId)
  ]);

  if (!requirements.length) {
    throw new Error('No subject requirements for this class. Import from assignments or add manually.');
  }
  if (!lessonPeriods.length) {
    throw new Error('Bell schedule has no teaching periods. Set up the bell schedule first.');
  }

  const existing = (existingTt.entries || []).filter((e) => !e.isBreak);
  const {
    adjusted,
    lockedEntries,
    occupiedClassSlots,
    pinExtras,
    pins
  } = buildPinsAndAdjustedRequirements(classId, requirements, existing, lessonPeriods);

  const forbidden = collectForbiddenSlots(allEntries, classId, lessonPeriods, pinExtras);

  const now = isoNow();
  const lockedOut = lockedEntries.map((e) => ({
    entryId: newEntryId('tte'),
    ownerType: 'class',
    ownerId: classId,
    classId,
    dayOfWeek: e.dayOfWeek,
    startTime: e.startTime,
    endTime: e.endTime,
    subject: e.subject,
    teacherId: e.teacherId,
    room: e.room || '',
    notes: e.notes || '',
    sortOrder: e.sortOrder,
    updatedAt: now,
    locked: true,
    periodId: e.periodId || ''
  }));

  // All requirements already satisfied by locks
  if (!adjusted.length) {
    const saved = await saveClassTimetable(classId, lockedOut);
    return {
      classId,
      assignmentCount: lockedOut.length,
      lockedKept: lockedOut.length,
      generated: 0,
      studentsUpdated: saved.studentsUpdated || 0,
      teachersUpdated: saved.teachersUpdated || 0,
      message: `Kept ${lockedOut.length} locked slot(s); nothing left to generate.`
    };
  }

  const result = await callSolver({
    days: [1, 2, 3, 4, 5],
    periods,
    activities: adjusted,
    forbidden,
    occupiedClassSlots,
    pinned: pins,
    timeLimitSeconds: 45
  });

  if (result.status !== 'OK' || !result.assignments || !result.assignments.length) {
    throw new Error(result.message || 'Solver could not generate a timetable.');
  }

  const occupied = new Set(
    lockedOut.map((e) => slotKey(e.dayOfWeek, e.periodId, e.startTime, e.sortOrder))
  );

  const generated = [];
  result.assignments.forEach((a) => {
    const period = lessonPeriods[a.lessonSlotIndex] || lessonPeriods.find((p) => p.periodId === a.periodId);
    const periodId = period ? period.periodId : (a.periodId || '');
    const key = slotKey(a.day, periodId, a.startTime, a.lessonSlotIndex);
    if (occupied.has(key)) return;
    occupied.add(key);
    generated.push({
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
      updatedAt: now,
      locked: false,
      periodId
    });
  });

  const merged = lockedOut.concat(generated);
  const saved = await saveClassTimetable(classId, merged);

  return {
    classId,
    assignmentCount: merged.length,
    lockedKept: lockedOut.length,
    generated: generated.length,
    studentsUpdated: saved.studentsUpdated || 0,
    teachersUpdated: saved.teachersUpdated || 0,
    message:
      result.message
      || `Generated ${generated.length} slot(s), kept ${lockedOut.length} locked.`
  };
}

module.exports = {
  generateClassTimetable,
  callSolver,
  collectForbiddenSlots,
  lessonIndexForEntry
};
