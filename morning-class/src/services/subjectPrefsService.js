const { TEACHER_SUBJECT_PREFS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');
const { getTimetable } = require('./timetableService');

const HEADERS = [
  'TeacherID', 'ClassID', 'Subject', 'Hidden', 'TeachingDays', 'SyncFromTimetable', 'UpdatedAt'
];

const DAY_LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };

function prefKey(classId, subject) {
  return String(classId) + '|' + String(subject);
}

function parseDays(raw) {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => n >= 1 && n <= 5);
  }
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parseDays(parsed);
  } catch (e) { /* csv */ }
  return s.split(/[,|]/).map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= 5);
}

function serializeDays(days) {
  return JSON.stringify(parseDays(days));
}

function parseBool(val, fallback) {
  if (val == null || val === '') return fallback;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return fallback;
}

async function ensureSubjectPrefsSheet() {
  await ensureSheet(TEACHER_SUBJECT_PREFS_SHEET, HEADERS);
}

function parsePrefRow(row, rowIndex) {
  return {
    teacherId: String(row[0] || ''),
    classId: String(row[1] || ''),
    subject: String(row[2] || '').trim(),
    hidden: parseBool(row[3], false),
    teachingDays: parseDays(row[4]),
    syncFromTimetable: parseBool(row[5], true),
    updatedAt: String(row[6] || ''),
    _row: rowIndex
  };
}

async function listTeacherSubjectPrefs(teacherId) {
  await ensureSubjectPrefsSheet();
  const rows = await getSheetRows(TEACHER_SUBJECT_PREFS_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(teacherId)) continue;
    const pref = parsePrefRow(rows[i], i + 1);
    if (!pref.classId || !pref.subject) continue;
    map[prefKey(pref.classId, pref.subject)] = pref;
  }
  return map;
}

async function teachingDaysFromTimetable(teacherId, classId, subject) {
  try {
    const tt = await getTimetable('teacher', teacherId);
    const days = new Set();
    (tt.entries || []).forEach((e) => {
      if (e.isBreak) return;
      if (String(e.classId || '') !== String(classId)) return;
      if (String(e.subject || '').trim() !== String(subject).trim()) return;
      const dow = Number(e.dayOfWeek);
      if (dow >= 1 && dow <= 5) days.add(dow);
    });
    return Array.from(days).sort((a, b) => a - b);
  } catch (e) {
    return [];
  }
}

async function periodsPerWeekFromTimetable(teacherId, classId, subject) {
  try {
    const tt = await getTimetable('teacher', teacherId);
    let count = 0;
    (tt.entries || []).forEach((e) => {
      if (e.isBreak) return;
      if (String(e.classId || '') !== String(classId)) return;
      if (String(e.subject || '').trim() !== String(subject).trim()) return;
      count += 1;
    });
    return count;
  } catch (e) {
    return 0;
  }
}

/**
 * Resolve teaching days for a slot: prefs → timetable → Mon–Fri default.
 */
async function resolveTeachingDays(teacherId, classId, subject, prefsMap) {
  const key = prefKey(classId, subject);
  const pref = prefsMap && prefsMap[key];
  if (pref && !pref.syncFromTimetable && pref.teachingDays && pref.teachingDays.length) {
    return pref.teachingDays.slice();
  }
  const fromTt = await teachingDaysFromTimetable(teacherId, classId, subject);
  if (fromTt.length) return fromTt;
  if (pref && pref.teachingDays && pref.teachingDays.length) return pref.teachingDays.slice();
  return [1, 2, 3, 4, 5];
}

function isHidden(prefsMap, classId, subject) {
  const pref = prefsMap && prefsMap[prefKey(classId, subject)];
  return !!(pref && pref.hidden);
}

async function saveSubjectPref(teacherId, payload) {
  await ensureSubjectPrefsSheet();
  const classId = String(payload.classId || '').trim();
  const subject = String(payload.subject || '').trim();
  if (!classId || !subject) throw new Error('Class and subject are required.');

  const prefs = await listTeacherSubjectPrefs(teacherId);
  const existing = prefs[prefKey(classId, subject)];
  let hidden = existing ? existing.hidden : false;
  let teachingDays = existing ? existing.teachingDays.slice() : [];
  let syncFromTimetable = existing ? existing.syncFromTimetable : true;

  if (payload.hidden != null) hidden = !!payload.hidden;
  if (payload.syncFromTimetable != null) syncFromTimetable = !!payload.syncFromTimetable;
  if (payload.teachingDays != null) {
    teachingDays = parseDays(payload.teachingDays);
    if (payload.syncFromTimetable == null) syncFromTimetable = false;
  }
  if (payload.syncFromTimetable === true || (syncFromTimetable && !teachingDays.length)) {
    teachingDays = await teachingDaysFromTimetable(teacherId, classId, subject);
    syncFromTimetable = true;
  }

  const now = new Date().toISOString();
  const row = [
    teacherId,
    classId,
    subject,
    hidden ? 'TRUE' : 'FALSE',
    serializeDays(teachingDays),
    syncFromTimetable ? 'TRUE' : 'FALSE',
    now
  ];

  if (existing && existing._row) {
    await updateRange(TEACHER_SUBJECT_PREFS_SHEET, `A${existing._row}:G${existing._row}`, [row]);
  } else {
    await appendRows(TEACHER_SUBJECT_PREFS_SHEET, [row]);
  }

  return {
    classId,
    subject,
    hidden,
    teachingDays,
    syncFromTimetable,
    dayLabels: teachingDays.map((d) => DAY_LABELS[d] || String(d))
  };
}

module.exports = {
  DAY_LABELS,
  ensureSubjectPrefsSheet,
  listTeacherSubjectPrefs,
  teachingDaysFromTimetable,
  periodsPerWeekFromTimetable,
  resolveTeachingDays,
  isHidden,
  saveSubjectPref,
  prefKey,
  parseDays
};
