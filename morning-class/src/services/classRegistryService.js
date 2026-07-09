const {
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const CLASS_COL = { classId: 0, name: 1, scheduleType: 2, allowedDays: 3 };
const LIST_COL = { studentId: 0, name: 1, classId: 2, status: 3, loginId: 4, loginPassword: 5 };

const DEFAULT_SCHEDULE = 'Mon-Fri';
const DEFAULT_ALLOWED = '1,2,3,4,5';

function parseAllowedDays(value) {
  const raw = String(value || DEFAULT_ALLOWED).trim();
  if (!raw) return [1, 2, 3, 4, 5];
  return raw.split(',').map((n) => Number(n.trim())).filter((n) => !isNaN(n));
}

function formatAllowedDays(days) {
  const list = Array.isArray(days) ? days : parseAllowedDays(days);
  return list.length ? list.join(',') : DEFAULT_ALLOWED;
}

function rowToClass(row) {
  if (!row || !row[CLASS_COL.classId]) return null;
  return {
    classId: String(row[CLASS_COL.classId]),
    name: String(row[CLASS_COL.name] || ''),
    scheduleType: String(row[CLASS_COL.scheduleType] || DEFAULT_SCHEDULE),
    allowedDays: parseAllowedDays(row[CLASS_COL.allowedDays])
  };
}

async function nextClassId() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  let max = 0;
  for (let i = 1; i < rows.length; i++) {
    const m = String(rows[i][0] || '').match(/^C(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return 'C' + String(max + 1).padStart(3, '0');
}

async function listClassesDetailed() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const classes = [];
  for (let i = 1; i < rows.length; i++) {
    const cls = rowToClass(rows[i]);
    if (!cls) continue;
    const roster = await getClassRoster(cls.classId);
    classes.push({
      ...cls,
      allowedDaysLabel: cls.allowedDays.join(','),
      studentCount: roster.length
    });
  }
  classes.sort((a, b) => a.name.localeCompare(b.name));
  return classes;
}

async function getClassDetail(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const rows = await getSheetRows(CLASS_LIST_SHEET);
  let cls = null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][CLASS_COL.classId]) === classId) {
      cls = rowToClass(rows[i]);
      break;
    }
  }
  if (!cls) throw new Error('Class not found.');

  const students = await getClassRoster(classId);
  return { ...cls, allowedDaysLabel: cls.allowedDays.join(','), students };
}

async function saveClass(payload) {
  let classId = String(payload.classId || '').trim();
  const isNew = !classId;
  if (!classId) classId = await nextClassId();

  const name = String(payload.name || '').trim();
  const scheduleType = String(payload.scheduleType || DEFAULT_SCHEDULE).trim() || DEFAULT_SCHEDULE;
  const allowedDays = formatAllowedDays(payload.allowedDays);

  if (!name) throw new Error('Class name is required.');

  const rows = await getSheetRows(CLASS_LIST_SHEET, { skipCache: true });
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][CLASS_COL.classId] || '');
    if (id === classId) { rowIndex = i + 1; continue; }
    if (String(rows[i][CLASS_COL.name]).trim().toLowerCase() === name.toLowerCase() && id !== classId) {
      throw new Error('Another class already uses this name.');
    }
  }

  const row = [classId, name, scheduleType, allowedDays];
  if (rowIndex > 0) {
    await updateRange(CLASS_LIST_SHEET, `A${rowIndex}:D${rowIndex}`, [row]);
  } else {
    await appendRows(CLASS_LIST_SHEET, [row]);
  }
  invalidateSheetRowsCache(CLASS_LIST_SHEET);
  return getClassDetail(classId);
}

async function listAvailableStudents(options) {
  options = options || {};
  const classId = String(options.classId || '').trim();
  const query = String(options.q || '').trim().toLowerCase();

  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const studentId = String(rows[i][LIST_COL.studentId] || '').trim();
    if (!studentId) continue;
    const name = String(rows[i][LIST_COL.name] || '');
    const currentClassId = String(rows[i][LIST_COL.classId] || '').trim();
    const status = String(rows[i][LIST_COL.status] || 'Enrolled').trim();

    if (status !== 'Enrolled') continue;
    if (currentClassId && currentClassId !== classId) continue;
    if (currentClassId === classId) continue;

    if (query) {
      const hay = [studentId, name, currentClassId].join(' ').toLowerCase();
      if (!hay.includes(query)) continue;
    }

    out.push({
      studentId,
      name,
      classId: currentClassId,
      status,
      inRegistry: !currentClassId
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function findStudentRow(studentId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][LIST_COL.studentId]) === String(studentId)) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return null;
}

async function importStudentToClass(classId, studentId) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  if (!classId || !studentId) throw new Error('Class and student are required.');

  await getClassDetail(classId);

  const found = await findStudentRow(studentId);
  if (!found) throw new Error('Student not found.');

  const currentClassId = String(found.row[LIST_COL.classId] || '').trim();
  const status = String(found.row[LIST_COL.status] || '').trim();
  if (status !== 'Enrolled') throw new Error('Only enrolled students can be added to a class.');
  if (currentClassId === classId) throw new Error('Student is already in this class.');
  if (currentClassId) {
    throw new Error('Student is assigned to ' + currentClassId + '. Remove them from that class first.');
  }

  const row = found.row.slice();
  row[LIST_COL.classId] = classId;
  await updateRange(STUDENT_LIST_SHEET, `A${found.rowIndex}:F${found.rowIndex}`, [row]);
  invalidateSheetRowsCache(STUDENT_LIST_SHEET);

  return getClassDetail(classId);
}

async function removeStudentFromClass(classId, studentId) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  if (!classId || !studentId) throw new Error('Class and student are required.');

  const found = await findStudentRow(studentId);
  if (!found) throw new Error('Student not found.');

  const currentClassId = String(found.row[LIST_COL.classId] || '').trim();
  if (currentClassId !== classId) {
    throw new Error('Student is not in this class.');
  }

  const row = found.row.slice();
  row[LIST_COL.classId] = '';
  await updateRange(STUDENT_LIST_SHEET, `A${found.rowIndex}:F${found.rowIndex}`, [row]);
  invalidateSheetRowsCache(STUDENT_LIST_SHEET);

  return getClassDetail(classId);
}

module.exports = {
  listClassesDetailed,
  getClassDetail,
  saveClass,
  listAvailableStudents,
  importStudentToClass,
  removeStudentFromClass,
  nextClassId,
  parseAllowedDays,
  formatAllowedDays
};
