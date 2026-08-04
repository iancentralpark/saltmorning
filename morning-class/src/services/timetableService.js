const crypto = require('crypto');
const {
  TIMETABLE_ENTRIES_SHEET,
  SUBJECTS_SHEET,
  STUDENT_LIST_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getTeacherStudentIds } = require('./studentRegistryService');
const { getBellSchedule } = require('./bellScheduleService');
const { getClassRoster } = require('./teacherPortalService');

const HEADERS = [
  'EntryID', 'OwnerType', 'OwnerID', 'ClassID', 'DayOfWeek',
  'StartTime', 'EndTime', 'Subject', 'TeacherID', 'Room', 'Notes',
  'SortOrder', 'UpdatedAt', 'Locked', 'PeriodID'
];

const COL = {
  entryId: 0, ownerType: 1, ownerId: 2, classId: 3, dayOfWeek: 4,
  startTime: 5, endTime: 6, subject: 7, teacherId: 8, room: 9, notes: 10,
  sortOrder: 11, updatedAt: 12, locked: 13, periodId: 14
};

const DAY_LABELS = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday',
  6: 'Saturday', 0: 'Sunday'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeTime(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Time must be HH:MM (e.g. 09:00).');
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('Invalid time.');
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function normalizeDay(value) {
  const d = Number(value);
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error('Day of week must be 0–6 (Mon=1).');
  return d;
}

function truthyLocked(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'locked' || value === true;
}

function rowToEntry(row) {
  if (!row || !row[COL.entryId]) return null;
  let teacherId = '';
  let room = '';
  let notes = '';
  let sortOrder = 0;
  let updatedAt = '';
  let locked = false;
  let periodId = '';

  if (row.length >= 15) {
    teacherId = String(row[COL.teacherId] || '');
    room = String(row[COL.room] || '');
    notes = String(row[COL.notes] || '');
    sortOrder = Number(row[COL.sortOrder]) || 0;
    updatedAt = String(row[COL.updatedAt] || '');
    locked = truthyLocked(row[COL.locked]);
    periodId = String(row[COL.periodId] || '').trim();
  } else if (row.length >= 13) {
    teacherId = String(row[COL.teacherId] || '');
    room = String(row[COL.room] || '');
    notes = String(row[COL.notes] || '');
    sortOrder = Number(row[COL.sortOrder]) || 0;
    updatedAt = String(row[COL.updatedAt] || '');
  } else {
    room = String(row[8] || '');
    notes = String(row[9] || '');
    sortOrder = Number(row[10]) || 0;
    updatedAt = String(row[11] || '');
  }

  return {
    entryId: String(row[COL.entryId]),
    ownerType: String(row[COL.ownerType] || ''),
    ownerId: String(row[COL.ownerId] || ''),
    classId: String(row[COL.classId] || ''),
    dayOfWeek: Number(row[COL.dayOfWeek]),
    dayLabel: DAY_LABELS[Number(row[COL.dayOfWeek])] || '',
    startTime: String(row[COL.startTime] || ''),
    endTime: String(row[COL.endTime] || ''),
    subject: String(row[COL.subject] || ''),
    teacherId,
    room,
    notes,
    sortOrder,
    updatedAt,
    locked,
    periodId
  };
}

function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.sortOrder - b.sortOrder;
  });
}

function groupByDay(entries) {
  const grouped = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  sortEntries(entries).forEach((e) => {
    if (grouped[e.dayOfWeek]) grouped[e.dayOfWeek].push(e);
  });
  return grouped;
}

function slotKey(dayOfWeek, periodId, startTime, sortOrder) {
  if (periodId) return String(dayOfWeek) + '|' + periodId;
  if (Number.isInteger(sortOrder)) return String(dayOfWeek) + '|idx:' + sortOrder;
  return String(dayOfWeek) + '|' + String(startTime || '');
}

function enrichWithBellBreaks(entries, bell) {
  const breaks = (bell && bell.periods) ? bell.periods.filter((p) => p.periodType !== 'lesson') : [];
  if (!breaks.length) return { entries, byDay: groupByDay(entries), breaks: [] };

  const byDay = groupByDay(entries);
  breaks.forEach((br) => {
    [1, 2, 3, 4, 5].forEach((day) => {
      if (!byDay[day]) return;
      byDay[day].push({
        entryId: 'bell_' + br.periodId,
        ownerType: 'bell',
        ownerId: '',
        classId: '',
        dayOfWeek: day,
        dayLabel: DAY_LABELS[day],
        startTime: br.startTime,
        endTime: br.endTime,
        subject: br.label,
        teacherId: '',
        room: '',
        notes: br.periodType,
        sortOrder: br.sortOrder - 0.5,
        isBreak: true,
        periodType: br.periodType,
        periodId: br.periodId,
        locked: false
      });
    });
    Object.keys(byDay).forEach((day) => {
      byDay[day].sort((a, b) => {
        const ta = a.startTime || '';
        const tb = b.startTime || '';
        return ta.localeCompare(tb) || (a.sortOrder - b.sortOrder);
      });
    });
  });

  const merged = [];
  Object.keys(byDay).forEach((day) => { merged.push(...byDay[day]); });
  return { entries: sortEntries(merged), byDay, breaks };
}

async function ensureTimetableSheet() {
  await ensureSheet(TIMETABLE_ENTRIES_SHEET, HEADERS);
  // Migrate legacy header row to include Locked + PeriodID when needed
  try {
    const rows = await getSheetRows(TIMETABLE_ENTRIES_SHEET, { skipCache: true });
    const header = rows[0] || [];
    if (header.length < HEADERS.length || String(header[13] || '') !== 'Locked') {
      await updateRange(TIMETABLE_ENTRIES_SHEET, 'A1:O1', [HEADERS]);
      invalidateSheetRowsCache(TIMETABLE_ENTRIES_SHEET);
    }
  } catch (e) {
    // non-fatal — writes still pad columns
  }
}

async function getStudentClassId(studentId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(studentId)) {
      return String(rows[i][2] || '').trim();
    }
  }
  return '';
}

async function listSubjects() {
  const rows = await getSheetRows(SUBJECTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1] || '').trim();
    if (name) out.push(name);
  }
  if (!out.length) return ['English', 'Math', 'Science', 'Reading', 'Writing', 'Grammar'];
  return out;
}

async function teacherNameMap() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = String(rows[i][1] || '');
  }
  return map;
}

async function loadAllEntries() {
  await ensureTimetableSheet();
  const rows = await getSheetRows(TIMETABLE_ENTRIES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const e = rowToEntry(rows[i]);
    if (e) out.push(e);
  }
  return out;
}

async function resolveTimetableEntries(ownerType, ownerId) {
  ownerType = String(ownerType || '').trim();
  ownerId = String(ownerId || '').trim();
  const all = await loadAllEntries();
  let entries = all.filter((e) => e.ownerType === ownerType && e.ownerId === ownerId);

  if (!entries.length && ownerType === 'student') {
    const classId = await getStudentClassId(ownerId);
    if (classId) {
      entries = all.filter((e) => e.ownerType === 'class' && e.ownerId === classId);
    }
  }

  if (!entries.length && ownerType === 'teacher') {
    entries = all.filter((e) => e.ownerType === 'class' && e.teacherId === ownerId);
  }

  return sortEntries(entries);
}

async function getTimetable(ownerType, ownerId) {
  if (!ownerType || !ownerId) throw new Error('Owner is required.');

  const entries = await resolveTimetableEntries(ownerType, ownerId);
  const bell = await getBellSchedule().catch(() => ({ periods: [], lessonPeriods: [] }));
  const enriched = enrichWithBellBreaks(entries, bell);
  const names = await teacherNameMap().catch(() => ({}));
  enriched.entries.forEach((e) => {
    e.teacherName = names[e.teacherId] || '';
  });
  Object.keys(enriched.byDay).forEach((d) => {
    enriched.byDay[d].forEach((e) => {
      e.teacherName = names[e.teacherId] || '';
    });
  });

  return {
    ownerType,
    ownerId,
    entries: enriched.entries,
    byDay: enriched.byDay,
    breaks: enriched.breaks,
    bellSchedule: bell.periods || [],
    lessonPeriods: bell.lessonPeriods || []
  };
}

function findLessonPeriod(bell, entry) {
  const lessons = (bell && bell.lessonPeriods) || [];
  if (!lessons.length) return null;
  if (entry.periodId) {
    const hit = lessons.find((p) => p.periodId === entry.periodId);
    if (hit) return hit;
  }
  if (Number.isInteger(entry.sortOrder) || entry.sortOrder === 0) {
    // Prefer index into lessonPeriods when auto-generated
    const byLessonIdx = lessons[Number(entry.sortOrder)];
    if (byLessonIdx && (!entry.startTime || byLessonIdx.startTime === entry.startTime)) {
      return byLessonIdx;
    }
  }
  if (entry.startTime) {
    const byTime = lessons.find((p) => p.startTime === entry.startTime);
    if (byTime) return byTime;
  }
  return null;
}

async function alignEntryToBell(entry, bell) {
  const period = findLessonPeriod(bell, entry);
  if (!period) {
    // Allow raw times only if no bell schedule configured
    if (!(bell && bell.lessonPeriods && bell.lessonPeriods.length)) {
      return {
        startTime: normalizeTime(entry.startTime),
        endTime: normalizeTime(entry.endTime),
        periodId: String(entry.periodId || '').trim(),
        sortOrder: Number(entry.sortOrder) || 0
      };
    }
    throw new Error('Each slot must use a bell schedule lesson period.');
  }
  const lessonIdx = bell.lessonPeriods.findIndex((p) => p.periodId === period.periodId);
  return {
    startTime: period.startTime,
    endTime: period.endTime,
    periodId: period.periodId,
    sortOrder: lessonIdx >= 0 ? lessonIdx : Number(entry.sortOrder) || 0
  };
}

function validateEntryPayload(entry, ownerType, ownerId, bell) {
  return alignEntryToBell(entry, bell).then((aligned) => {
    if (aligned.endTime <= aligned.startTime) throw new Error('End time must be after start time.');
    return {
      entryId: String(entry.entryId || '').trim() || newId('tte'),
      ownerType,
      ownerId,
      classId: String(entry.classId || '').trim(),
      dayOfWeek: normalizeDay(entry.dayOfWeek),
      startTime: aligned.startTime,
      endTime: aligned.endTime,
      subject: String(entry.subject || '').trim(),
      teacherId: String(entry.teacherId || '').trim(),
      room: String(entry.room || '').trim(),
      notes: String(entry.notes || '').trim(),
      sortOrder: aligned.sortOrder,
      updatedAt: entry.updatedAt || isoNow(),
      locked: truthyLocked(entry.locked),
      periodId: aligned.periodId
    };
  });
}

function entryToRow(entry) {
  return [
    entry.entryId, entry.ownerType, entry.ownerId, entry.classId,
    String(entry.dayOfWeek), entry.startTime, entry.endTime,
    entry.subject, entry.teacherId, entry.room, entry.notes,
    String(entry.sortOrder), entry.updatedAt,
    entry.locked ? 'true' : 'false',
    entry.periodId || ''
  ];
}

function assertNoInternalConflicts(entries) {
  const classSlots = new Set();
  const teacherSlots = new Map();
  entries.forEach((e) => {
    const key = slotKey(e.dayOfWeek, e.periodId, e.startTime, e.sortOrder);
    if (classSlots.has(key)) {
      throw new Error('This class already has a subject in that period.');
    }
    classSlots.add(key);
    if (!e.teacherId) return;
    if (!teacherSlots.has(e.teacherId)) teacherSlots.set(e.teacherId, new Set());
    const set = teacherSlots.get(e.teacherId);
    if (set.has(key)) {
      throw new Error('Teacher is double-booked within this timetable (' + e.subject + ').');
    }
    set.add(key);
  });
}

async function assertNoExternalTeacherConflicts(entries, excludeClassId) {
  const all = await loadAllEntries();
  const busy = new Map(); // teacherId -> Set(slotKey)

  all.forEach((e) => {
    if (e.ownerType !== 'class') return;
    if (excludeClassId && e.ownerId === String(excludeClassId)) return;
    if (!e.teacherId) return;
    const key = slotKey(e.dayOfWeek, e.periodId, e.startTime, e.sortOrder);
    if (!busy.has(e.teacherId)) busy.set(e.teacherId, new Set());
    busy.get(e.teacherId).add(key);
  });

  entries.forEach((e) => {
    if (!e.teacherId) return;
    const key = slotKey(e.dayOfWeek, e.periodId, e.startTime, e.sortOrder);
    const set = busy.get(e.teacherId);
    if (set && set.has(key)) {
      throw new Error(
        'Teacher conflict: already scheduled in another class at that period (' + e.subject + ').'
      );
    }
  });
}

async function writeOwnerRows(ownerType, ownerId, normalized) {
  await ensureTimetableSheet();
  const allRows = await getSheetRows(TIMETABLE_ENTRIES_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    const type = String(allRows[i][COL.ownerType] || '');
    const id = String(allRows[i][COL.ownerId] || '');
    if (type === ownerType && id === ownerId) continue;
    // Pad legacy rows to new width when rewriting
    const row = allRows[i].slice();
    while (row.length < HEADERS.length) row.push('');
    kept.push(row.slice(0, HEADERS.length));
  }

  const combined = kept.concat(normalized.map(entryToRow));
  const oldCount = Math.max(0, allRows.length - 1);
  const rowWidth = HEADERS.length;

  if (!combined.length && !oldCount) return;

  if (!oldCount && combined.length) {
    await appendRows(TIMETABLE_ENTRIES_SHEET, combined);
  } else {
    const maxRows = Math.max(oldCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(rowWidth).fill(''));
    }
    await updateRange(TIMETABLE_ENTRIES_SHEET, `A2:O${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(TIMETABLE_ENTRIES_SHEET);
}

async function saveTimetable(ownerType, ownerId, entries, options) {
  options = options || {};
  ownerType = String(ownerType || '').trim();
  ownerId = String(ownerId || '').trim();
  if (!ownerType || !ownerId) throw new Error('Owner is required.');
  if (!Array.isArray(entries)) throw new Error('Entries array is required.');

  const bell = await getBellSchedule().catch(() => ({ periods: [], lessonPeriods: [] }));
  const filtered = entries.filter((e) => e && !e.isBreak && e.ownerType !== 'bell');

  const normalized = [];
  for (let idx = 0; idx < filtered.length; idx++) {
    const e = filtered[idx];
    const row = await validateEntryPayload(
      Object.assign({}, e, { sortOrder: e.sortOrder != null ? e.sortOrder : idx }),
      ownerType,
      ownerId,
      bell
    );
    if (!row.subject) throw new Error('Subject is required for each slot.');
    normalized.push(row);
  }

  assertNoInternalConflicts(normalized);

  if (!options.skipConflictCheck && (ownerType === 'class' || options.checkTeacherConflicts)) {
    const excludeClassId = ownerType === 'class' ? ownerId : (options.excludeClassId || '');
    await assertNoExternalTeacherConflicts(normalized, excludeClassId);
  }

  await writeOwnerRows(ownerType, ownerId, normalized);
  return getTimetable(ownerType, ownerId);
}

async function saveClassTimetable(classId, entries, options) {
  options = options || {};
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const previous = await loadAllEntries();
  const previousTeacherIds = previous
    .filter((e) => e.ownerType === 'class' && e.ownerId === classId && e.teacherId)
    .map((e) => e.teacherId);

  const result = await saveTimetable('class', classId, entries.map((e) => ({
    ...e,
    classId: e.classId || classId
  })), {
    checkTeacherConflicts: true,
    skipConflictCheck: !!options.skipConflictCheck
  });

  const classOnly = (result.entries || []).filter((e) => !e.isBreak);
  let sync = { studentsUpdated: 0, teachersUpdated: 0 };
  if (options.syncDependents !== false) {
    const teacherIds = [...new Set(
      previousTeacherIds.concat(classOnly.map((e) => e.teacherId).filter(Boolean))
    )];
    sync = await syncClassDependents(classId, classOnly, teacherIds);
  }
  return Object.assign({}, result, sync);
}

async function rebuildTeacherTimetable(teacherId) {
  const all = await loadAllEntries();
  const classEntries = all.filter((e) => e.ownerType === 'class' && e.teacherId === teacherId);
  const now = isoNow();
  const entries = sortEntries(classEntries.map((e) => ({
    entryId: newId('tte'),
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
    updatedAt: now,
    locked: !!e.locked,
    periodId: e.periodId || ''
  })));
  await writeOwnerRows('teacher', teacherId, entries);
}

async function syncClassDependents(classId, classEntries, teacherIdsOverride) {
  classId = String(classId);
  const roster = await getClassRoster(classId);
  const now = isoNow();
  const teacherIds = teacherIdsOverride
    || [...new Set(classEntries.map((e) => e.teacherId).filter(Boolean))];

  for (const teacherId of teacherIds) {
    await rebuildTeacherTimetable(teacherId);
  }

  for (const student of roster) {
    const studentEntries = classEntries.map((e) => ({
      ...e,
      entryId: newId('tte'),
      ownerType: 'student',
      ownerId: student.studentId,
      classId,
      updatedAt: now
    }));
    await writeOwnerRows('student', student.studentId, studentEntries);
  }

  return {
    studentsUpdated: roster.length,
    teachersUpdated: teacherIds.length
  };
}

async function getTeacherBusyMap(excludeClassId) {
  const all = await loadAllEntries();
  const names = await teacherNameMap();
  const busy = {};
  all.forEach((e) => {
    if (e.ownerType !== 'class') return;
    if (excludeClassId && e.ownerId === String(excludeClassId)) return;
    if (!e.teacherId) return;
    const key = slotKey(e.dayOfWeek, e.periodId, e.startTime, e.sortOrder);
    if (!busy[e.teacherId]) busy[e.teacherId] = {};
    busy[e.teacherId][key] = {
      classId: e.classId || e.ownerId,
      subject: e.subject,
      teacherName: names[e.teacherId] || e.teacherId
    };
  });
  return { busy, teacherNames: names };
}

async function getStudentTimetableForTeacher(teacherId, studentId) {
  const ids = await getTeacherStudentIds(teacherId);
  if (!ids.has(String(studentId))) {
    throw new Error('You do not have access to this student.');
  }
  return getTimetable('student', studentId);
}

async function getAllClassesMatrix() {
  const all = await loadAllEntries();
  const bell = await getBellSchedule();
  const names = await teacherNameMap();
  const byClass = {};
  all.filter((e) => e.ownerType === 'class').forEach((e) => {
    const id = e.ownerId;
    if (!byClass[id]) byClass[id] = [];
    e.teacherName = names[e.teacherId] || '';
    byClass[id].push(e);
  });
  Object.keys(byClass).forEach((id) => {
    byClass[id] = sortEntries(byClass[id]);
  });
  return {
    byClass,
    lessonPeriods: bell.lessonPeriods || [],
    bellSchedule: bell.periods || [],
    teacherNames: names
  };
}

module.exports = {
  DAY_LABELS,
  ensureTimetableSheet,
  listSubjects,
  getTimetable,
  saveTimetable,
  saveClassTimetable,
  syncClassDependents,
  rebuildTeacherTimetable,
  getTeacherBusyMap,
  getAllClassesMatrix,
  getStudentTimetableForTeacher,
  groupByDay,
  sortEntries,
  loadAllEntries,
  slotKey,
  findLessonPeriod,
  newId,
  isoNow
};
