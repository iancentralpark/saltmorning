const crypto = require('crypto');
const {
  TIMETABLE_REQUIREMENTS_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassNameMap } = require('./teacherPortalService');

const HEADERS = [
  'ReqID', 'ClassID', 'Subject', 'TeacherID', 'TeacherName',
  'PeriodsPerWeek', 'Room', 'Notes', 'LinkedClassIDs'
];
const COL = {
  reqId: 0, classId: 1, subject: 2, teacherId: 3, teacherName: 4,
  periodsPerWeek: 5, room: 6, notes: 7, linkedClassIds: 8
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function parseIdList(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
  )];
}

function normalizeClassIds(primaryClassId, linkedClassIds) {
  const primary = String(primaryClassId || '').trim();
  const linked = Array.isArray(linkedClassIds)
    ? linkedClassIds.map((x) => String(x || '').trim()).filter(Boolean)
    : parseIdList(linkedClassIds);
  const all = [...new Set([primary].concat(linked).filter(Boolean))];
  return {
    classId: primary || all[0] || '',
    linkedClassIds: all.filter((id) => id !== (primary || all[0] || '')),
    classIds: all
  };
}

async function ensureRequirementsSheet() {
  await ensureSheet(TIMETABLE_REQUIREMENTS_SHEET, HEADERS);
  try {
    const rows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET, { skipCache: true });
    const header = rows[0] || [];
    if (String(header[COL.linkedClassIds] || '') !== 'LinkedClassIDs') {
      const next = header.slice();
      while (next.length < HEADERS.length) next.push('');
      next[COL.linkedClassIds] = 'LinkedClassIDs';
      // Keep legacy labels for older columns if present
      for (let i = 0; i < HEADERS.length - 1; i++) {
        if (!String(next[i] || '').trim()) next[i] = HEADERS[i];
      }
      await updateRange(TIMETABLE_REQUIREMENTS_SHEET, 'A1:I1', [next.slice(0, HEADERS.length)]);
      invalidateSheetRowsCache(TIMETABLE_REQUIREMENTS_SHEET);
    }
  } catch (e) {
    // non-fatal
  }
}

function rowToReq(row) {
  if (!row || !row[COL.classId]) return null;
  const classId = String(row[COL.classId]);
  const linkedClassIds = parseIdList(row[COL.linkedClassIds]);
  const classIds = [...new Set([classId].concat(linkedClassIds))];
  return {
    reqId: String(row[COL.reqId] || ''),
    classId,
    subject: String(row[COL.subject] || ''),
    teacherId: String(row[COL.teacherId] || ''),
    teacherName: String(row[COL.teacherName] || ''),
    periodsPerWeek: Number(row[COL.periodsPerWeek]) || 0,
    room: String(row[COL.room] || ''),
    notes: String(row[COL.notes] || ''),
    linkedClassIds,
    classIds
  };
}

function reqInvolvesClass(req, classId) {
  if (!req || !classId) return false;
  return (req.classIds || [req.classId]).map(String).includes(String(classId));
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
    if (classId && !reqInvolvesClass(r, classId)) continue;
    out.push(r);
  }
  out.sort((a, b) => a.classId.localeCompare(b.classId) || a.subject.localeCompare(b.subject));
  return out;
}

async function listAllRequirements() {
  return listRequirements('');
}

/**
 * Linked class IDs for a teacher+subject group that includes classId.
 */
function linkedClassesFor(requirements, classId, teacherId, subject) {
  const cid = String(classId || '');
  const tid = String(teacherId || '');
  const sub = String(subject || '').toLowerCase();
  const linked = new Set();
  (requirements || []).forEach((r) => {
    if (String(r.teacherId) !== tid) return;
    if (String(r.subject || '').toLowerCase() !== sub) return;
    if (!reqInvolvesClass(r, cid)) return;
    (r.classIds || []).forEach((id) => {
      if (String(id) !== cid) linked.add(String(id));
    });
  });
  return linked;
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
    const ids = normalizeClassIds(classId, r.linkedClassIds || r.classIds);
    return [
      String(r.reqId || '').trim() || newId('req'),
      classId,
      subject,
      teacherId,
      names[teacherId] || String(r.teacherName || ''),
      String(ppw),
      String(r.room || '').trim(),
      String(r.notes || '').trim(),
      ids.linkedClassIds.join(',')
    ];
  });

  const allRows = await getSheetRows(TIMETABLE_REQUIREMENTS_SHEET, { skipCache: true });
  const kept = [];
  for (let i = 1; i < allRows.length; i++) {
    const existing = rowToReq(allRows[i]);
    if (!existing) continue;
    // Replace any requirement that involves this class
    if (reqInvolvesClass(existing, classId)) continue;
    const row = allRows[i].slice();
    while (row.length < HEADERS.length) row.push('');
    kept.push(row.slice(0, HEADERS.length));
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
    await updateRange(TIMETABLE_REQUIREMENTS_SHEET, `A2:I${maxRows + 1}`, toWrite);
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
      notes: 'Imported from class assignment',
      linkedClassIds: []
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
      notes: 'Imported from teacher subject',
      linkedClassIds: []
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
    className: classNames[r.classId] || r.classId,
    linkedClassNames: (r.linkedClassIds || []).map((id) => classNames[id] || id)
  }));
}

module.exports = {
  ensureRequirementsSheet,
  listRequirements,
  listAllRequirements,
  listRequirementsWithClassNames,
  saveRequirements,
  importRequirementsFromAssignments,
  parseIdList,
  normalizeClassIds,
  reqInvolvesClass,
  linkedClassesFor
};
