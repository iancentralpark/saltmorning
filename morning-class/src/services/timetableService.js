const crypto = require('crypto');
const {
  TIMETABLE_ENTRIES_SHEET,
  SUBJECTS_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getTeacherStudentIds } = require('./studentRegistryService');
const { getBellSchedule } = require('./bellScheduleService');

const HEADERS = [
  'EntryID', 'OwnerType', 'OwnerID', 'ClassID', 'DayOfWeek',
  'StartTime', 'EndTime', 'Subject', 'TeacherID', 'Room', 'Notes', 'SortOrder', 'UpdatedAt'
];

const COL = {
  entryId: 0, ownerType: 1, ownerId: 2, classId: 3, dayOfWeek: 4,
  startTime: 5, endTime: 6, subject: 7, teacherId: 8, room: 9, notes: 10,
  sortOrder: 11, updatedAt: 12
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

function rowToEntry(row) {
  if (!row || !row[COL.entryId]) return null;
  let teacherId = '';
  let room = '';
  let notes = '';
  let sortOrder = 0;
  let updatedAt = '';
  if (row.length >= 13) {
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
    updatedAt
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
        periodType: br.periodType
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
  const bell = await getBellSchedule().catch(() => ({ periods: [] }));
  const enriched = enrichWithBellBreaks(entries, bell);

  return {
    ownerType,
    ownerId,
    entries: enriched.entries,
    byDay: enriched.byDay,
    breaks: enriched.breaks,
    bellSchedule: bell.periods || []
  };
}

function validateEntryPayload(entry, ownerType, ownerId) {
  const startTime = normalizeTime(entry.startTime);
  const endTime = normalizeTime(entry.endTime);
  if (endTime <= startTime) throw new Error('End time must be after start time.');
  return {
    entryId: String(entry.entryId || '').trim() || newId('tte'),
    ownerType,
    ownerId,
    classId: String(entry.classId || '').trim(),
    dayOfWeek: normalizeDay(entry.dayOfWeek),
    startTime,
    endTime,
    subject: String(entry.subject || '').trim(),
    teacherId: String(entry.teacherId || '').trim(),
    room: String(entry.room || '').trim(),
    notes: String(entry.notes || '').trim(),
    sortOrder: Number(entry.sortOrder) || 0,
    updatedAt: entry.updatedAt || isoNow()
  };
}

function entryToRow(entry) {
  return [
    entry.entryId, entry.ownerType, entry.ownerId, entry.classId,
    String(entry.dayOfWeek), entry.startTime, entry.endTime,
    entry.subject, entry.teacherId, entry.room, entry.notes,
    String(entry.sortOrder), entry.updatedAt
  ];
}

async function saveTimetable(ownerType, ownerId, entries) {
  ownerType = String(ownerType || '').trim();
  ownerId = String(ownerId || '').trim();
  if (!ownerType || !ownerId) throw new Error('Owner is required.');
  if (!Array.isArray(entries)) throw new Error('Entries array is required.');

  const normalized = entries.map((e, idx) => {
    const row = validateEntryPayload(Object.assign({}, e, { sortOrder: e.sortOrder ?? idx }), ownerType, ownerId);
    if (!row.subject) throw new Error('Subject is required for each slot.');
    return row;
  });

  await ensureTimetableSheet();
  const allRows = await getSheetRows(TIMETABLE_ENTRIES_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    const type = String(allRows[i][COL.ownerType] || '');
    const id = String(allRows[i][COL.ownerId] || '');
    if (type === ownerType && id === ownerId) continue;
    kept.push(allRows[i]);
  }

  const combined = kept.concat(normalized.map(entryToRow));
  const oldCount = Math.max(0, allRows.length - 1);
  const rowWidth = HEADERS.length;

  if (!combined.length && !oldCount) {
    return getTimetable(ownerType, ownerId);
  }

  if (!oldCount && combined.length) {
    await appendRows(TIMETABLE_ENTRIES_SHEET, combined);
  } else {
    const maxRows = Math.max(oldCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(rowWidth).fill(''));
    }
    await updateRange(TIMETABLE_ENTRIES_SHEET, `A2:M${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(TIMETABLE_ENTRIES_SHEET);
  return getTimetable(ownerType, ownerId);
}

async function getStudentTimetableForTeacher(teacherId, studentId) {
  const ids = await getTeacherStudentIds(teacherId);
  if (!ids.has(String(studentId))) {
    throw new Error('You do not have access to this student.');
  }
  return getTimetable('student', studentId);
}

module.exports = {
  DAY_LABELS,
  ensureTimetableSheet,
  listSubjects,
  getTimetable,
  saveTimetable,
  getStudentTimetableForTeacher,
  groupByDay,
  sortEntries,
  loadAllEntries,
  newId,
  isoNow
};
