const crypto = require('crypto');
const {
  TIMETABLE_REQUIREMENTS_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassNameMap } = require('./teacherPortalService');

const HEADERS = ['ReqID', 'ClassID', 'Subject', 'TeacherID', 'TeacherName', 'PeriodsPerWeek', 'Room', 'Notes'];
const COL = {
  reqId: 0, classId: 1, subject: 2, teacherId: 3, teacherName: 4,
  periodsPerWeek: 5, room: 6, notes: 7
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

async function ensureRequirementsSheet() {
  await ensureSheet(TIMETABLE_REQUIREMENTS_SHEET, HEADERS);
}

function rowToReq(row) {
  if (!row || !row[COL.classId]) return null;
  return {
    reqId: String(row[COL.reqId] || ''),
    classId: String(row[COL.classId]),
    subject: String(row[COL.subject] || ''),
    teacherId: String(row[COL.teacherId] || ''),
    teacherName: String(row[COL.teacherName] || ''),
    periodsPerWeek: Number(row[COL.periodsPerWeek]) || 0,
    room: String(row[COL.room] || ''),
    notes: String(row[COL.notes] || '')
  };
}

async function teacherNameMap() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = String(rows[i][1] || '');
  }
  return map;
}

async function listRequirements(classId) {
  await ensureRequirementsSheet();
  const rows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rowToReq(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    out.push(r);
  }
  out.sort((a, b) => a.classId.localeCompare(b.classId) || a.subject.localeCompare(b.subject));
  return out;
}

async function saveRequirements(classId, requirements) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');
  if (!Array.isArray(requirements)) throw new Error('Requirements array is required.');

  const names = await teacherNameMap();
  const normalized = requirements.map((r) => {
    const subject = String(r.subject || '').trim();
    const teacherId = String(r.teacherId || '').trim();
    const ppw = Number(r.periodsPerWeek);
    if (!subject) throw new Error('Subject is required.');
    if (!teacherId) throw new Error('Teacher is required for ' + subject + '.');
    if (!ppw || ppw < 1) throw new Error('Periods per week must be at least 1 for ' + subject + '.');
    return [
      String(r.reqId || '').trim() || newId('req'),
      classId,
      subject,
      teacherId,
      names[teacherId] || String(r.teacherName || ''),
      String(ppw),
      String(r.room || '').trim(),
      String(r.notes || '').trim()
    ];
  });

  const allRows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    if (String(allRows[i][COL.classId]) !== classId) kept.push(allRows[i]);
  }
  const combined = kept.concat(normalized);
  const oldCount = Math.max(0, allRows.length - 1);
  const width = HEADERS.length;

  if (!combined.length && !oldCount) return listRequirements(classId);
  if (!oldCount && combined.length) {
    await appendRows(TIMETABLE_REQUIREMENTS_SHEET, combined);
  } else {
    const maxRows = Math.max(oldCount, combined.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < combined.length ? combined[i] : new Array(width).fill(''));
    }
    await updateRange(TIMETABLE_REQUIREMENTS_SHEET, `A2:H${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(TIMETABLE_REQUIREMENTS_SHEET);
  return listRequirements(classId);
}

async function importRequirementsFromAssignments(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const names = await teacherNameMap();
  const seen = new Set();
  const requirements = [];

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0]) !== classId) continue;
    const teacherId = String(assignRows[i][1] || '');
    const subject = String(assignRows[i][3] || '').trim() || 'Homeroom';
    const key = teacherId + ':' + subject;
    if (!teacherId || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      subject,
      teacherId,
      teacherName: names[teacherId] || '',
      periodsPerWeek: 5,
      room: '',
      notes: 'Imported from class assignment'
    });
  }

  const customRows = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET);
  for (let i = 1; i < customRows.length; i++) {
    if (String(customRows[i][1]) !== classId) continue;
    const teacherId = String(customRows[i][0] || '');
    const subject = String(customRows[i][2] || '').trim();
    const key = teacherId + ':' + subject;
    if (!teacherId || !subject || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      subject,
      teacherId,
      teacherName: names[teacherId] || '',
      periodsPerWeek: 5,
      room: '',
      notes: 'Imported from teacher subject'
    });
  }

  if (!requirements.length) {
    throw new Error('No teacher assignments found for this class. Add assignments first.');
  }

  return saveRequirements(classId, requirements);
}

async function listRequirementsWithClassNames(classId) {
  const classNames = await getClassNameMap();
  const reqs = await listRequirements(classId);
  return reqs.map((r) => ({
    ...r,
    className: classNames[r.classId] || r.classId
  }));
}

module.exports = {
  ensureRequirementsSheet,
  listRequirements,
  listRequirementsWithClassNames,
  saveRequirements,
  importRequirementsFromAssignments
};
