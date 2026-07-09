const {
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  SUBJECTS_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');
const { getTeacherClasses, getClassNameMap } = require('./teacherPortalService');
const {
  listTeacherSubjectStyles,
  buildStyleLookup,
  SUBJECT_PALETTE,
  styleKey
} = require('./subjectStyleService');

const DEFAULT_HOMEROOM_SUBJECT = 'English';

async function ensureTeacherClassSubjectsSheet() {
  await ensureSheet(TEACHER_CLASS_SUBJECTS_SHEET, [
    'TeacherID', 'ClassID', 'Subject', 'CreatedAt'
  ]);
}

function parseCustomSubjectRows(rows, teacherId) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (teacherId && String(rows[i][0]) !== String(teacherId)) continue;
    const subject = String(rows[i][2] || '').trim();
    if (!subject) continue;
    out.push({
      teacherId: String(rows[i][0]),
      classId: String(rows[i][1]),
      subject,
      createdAt: String(rows[i][3] || '')
    });
  }
  return out;
}

async function loadTeacherSubjectData(teacherId) {
  await ensureTeacherClassSubjectsSheet();
  const [{ homeroom, assigned }, assignRows, customRows, classNames, catalog] = await Promise.all([
    getTeacherClasses(teacherId),
    getSheetRows(CLASS_TEACHERS_SHEET),
    getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET),
    getClassNameMap(),
    listCatalogSubjects()
  ]);
  return {
    homeroom,
    assigned,
    assignRows,
    custom: parseCustomSubjectRows(customRows, teacherId),
    classNames,
    catalog
  };
}

function subjectsForClassFromData(teacherId, classId, data) {
  const subjects = new Set();
  const isHomeroom = data.homeroom.some((e) => e.classId === classId);

  data.assigned.forEach((e) => {
    if (e.classId !== classId) return;
    (e.subjects || []).forEach((s) => { if (s) subjects.add(s); });
  });

  for (let i = 1; i < data.assignRows.length; i++) {
    if (String(data.assignRows[i][1]) !== String(teacherId)) continue;
    if (String(data.assignRows[i][0]) !== String(classId)) continue;
    const subject = String(data.assignRows[i][3] || '').trim();
    if (subject) subjects.add(subject);
  }

  data.custom.forEach((c) => {
    if (c.classId === classId) subjects.add(c.subject);
  });

  if (isHomeroom && !subjects.size) subjects.add(DEFAULT_HOMEROOM_SUBJECT);
  return Array.from(subjects).sort((a, b) => a.localeCompare(b));
}

function buildLessonSlotsFromData(teacherId, filterClassId, data) {
  const slots = [];
  const seen = new Set();
  const classIds = new Set();
  data.homeroom.forEach((e) => classIds.add(e.classId));
  data.assigned.forEach((e) => classIds.add(e.classId));
  data.custom.forEach((c) => classIds.add(c.classId));

  for (const classId of classIds) {
    if (filterClassId && classId !== filterClassId) continue;
    const subjects = subjectsForClassFromData(teacherId, classId, data);
    const isHomeroom = data.homeroom.some((e) => e.classId === classId);
    subjects.forEach((subject) => {
      const key = classId + '|' + subject;
      if (seen.has(key)) return;
      seen.add(key);
      slots.push({
        classId,
        className: data.classNames[classId] || classId,
        subject,
        assignmentType: isHomeroom ? 'Homeroom' : 'Subject'
      });
    });
  }

  slots.sort((a, b) => a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject));
  return slots;
}

async function listCatalogSubjects() {
  const rows = await getSheetRows(SUBJECTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][1] || '').trim();
    if (name) out.push(name);
  }
  if (!out.length) out.push('English', 'Math', 'Science');
  return out.sort((a, b) => a.localeCompare(b));
}

async function getTeacherClassIds(teacherId) {
  const { homeroom, assigned } = await getTeacherClasses(teacherId);
  const ids = new Set();
  homeroom.forEach((e) => ids.add(e.classId));
  assigned.forEach((e) => ids.add(e.classId));
  return ids;
}

async function assertTeacherClassAccess(teacherId, classId) {
  const allowed = await getTeacherClassIds(teacherId);
  if (!allowed.has(String(classId))) {
    throw new Error('You are not assigned to this class.');
  }
}

async function listTeacherCustomSubjects(teacherId) {
  await ensureTeacherClassSubjectsSheet();
  const rows = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET);
  return parseCustomSubjectRows(rows, teacherId);
}

async function listAdminClassAssignments() {
  const [classNames, teachers, assignRows] = await Promise.all([
    getClassNameMap(),
    getSheetRows(TEACHER_LIST_SHEET),
    getSheetRows(CLASS_TEACHERS_SHEET)
  ]);

  const teacherNames = {};
  for (let i = 1; i < teachers.length; i++) {
    teacherNames[String(teachers[i][0])] = String(teachers[i][1] || '');
  }

  const out = [];
  for (let i = 1; i < assignRows.length; i++) {
    const teacherId = String(assignRows[i][1] || '');
    const classId = String(assignRows[i][0] || '');
    const subject = String(assignRows[i][3] || '').trim();
    if (!teacherId || !classId) continue;
    out.push({
      source: 'admin',
      rowIndex: i + 1,
      teacherId,
      teacherName: teacherNames[teacherId] || teacherId,
      classId,
      className: classNames[classId] || classId,
      assignmentType: String(assignRows[i][2] || 'Subject'),
      subject: subject || '(Homeroom — default English)'
    });
  }

  const allCustom = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET);
  for (let i = 1; i < allCustom.length; i++) {
    const teacherId = String(allCustom[i][0] || '');
    const classId = String(allCustom[i][1] || '');
    const subject = String(allCustom[i][2] || '').trim();
    if (!teacherId || !classId || !subject) continue;
    out.push({
      source: 'teacher',
      rowIndex: i + 1,
      teacherId,
      teacherName: teacherNames[teacherId] || teacherId,
      classId,
      className: classNames[classId] || classId,
      assignmentType: 'Subject',
      subject
    });
  }

  out.sort((a, b) =>
    a.teacherName.localeCompare(b.teacherName) ||
    a.className.localeCompare(b.className) ||
    a.subject.localeCompare(b.subject)
  );
  return out;
}

async function getSubjectsForClass(teacherId, classId) {
  const data = await loadTeacherSubjectData(teacherId);
  return subjectsForClassFromData(teacherId, classId, data);
}

async function getTeacherLessonSlots(teacherId, filterClassId) {
  const data = await loadTeacherSubjectData(teacherId);
  return buildLessonSlotsFromData(teacherId, filterClassId, data);
}

async function listTeacherSubjectGroups(teacherId) {
  const [data, customStyles] = await Promise.all([
    loadTeacherSubjectData(teacherId),
    listTeacherSubjectStyles(teacherId)
  ]);
  const groups = {};

  data.homeroom.forEach((e) => {
    groups[e.classId] = {
      classId: e.classId,
      className: e.className,
      isHomeroom: true,
      subjects: []
    };
  });
  data.assigned.forEach((e) => {
    if (!groups[e.classId]) {
      groups[e.classId] = {
        classId: e.classId,
        className: e.className,
        isHomeroom: false,
        subjects: []
      };
    }
  });

  for (const classId of Object.keys(groups)) {
    groups[classId].subjects = subjectsForClassFromData(teacherId, classId, data);
  }

  const classSlots = buildLessonSlotsFromData(teacherId, '', data);
  const styleBundle = buildStyleLookup(classSlots, customStyles);
  return {
    catalog: data.catalog,
    classes: Object.values(groups).sort((a, b) => a.className.localeCompare(b.className)),
    custom: data.custom,
    styles: customStyles,
    stylePalette: SUBJECT_PALETTE,
    resolvedStyles: styleBundle.byKey
  };
}

async function addTeacherSubject(teacherId, classId, subject) {
  await ensureTeacherClassSubjectsSheet();
  await assertTeacherClassAccess(teacherId, classId);
  subject = String(subject || '').trim();
  if (!subject) throw new Error('Subject name is required.');
  if (subject.length > 40) throw new Error('Subject name is too long.');

  const existing = await getSubjectsForClass(teacherId, classId);
  if (existing.includes(subject)) {
    return { added: false, subject, classId, message: 'Subject already exists.' };
  }

  const rows = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(teacherId) &&
        String(rows[i][1]) === String(classId) &&
        String(rows[i][2]).trim().toLowerCase() === subject.toLowerCase()) {
      return { added: false, subject, classId };
    }
  }

  const now = new Date().toISOString();
  await appendRows(TEACHER_CLASS_SUBJECTS_SHEET, [[teacherId, classId, subject, now]]);
  return { added: true, subject, classId };
}

async function removeTeacherSubject(teacherId, classId, subject) {
  await ensureTeacherClassSubjectsSheet();
  subject = String(subject || '').trim();
  const data = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(teacherId)) continue;
    if (String(data[i][1]) !== String(classId)) continue;
    if (String(data[i][2]).trim() !== subject) continue;
    found = i + 1;
    break;
  }
  if (found < 0) throw new Error('Custom subject not found.');
  await updateRange(TEACHER_CLASS_SUBJECTS_SHEET, `A${found}:D${found}`, [['', '', '', '']]);
  return { removed: true };
}

async function saveAdminClassAssignment(payload) {
  const teacherId = String(payload.teacherId || '').trim();
  const classId = String(payload.classId || '').trim();
  const assignmentType = String(payload.assignmentType || 'Subject').trim();
  const subject = String(payload.subject || '').trim();
  if (!teacherId || !classId) throw new Error('Teacher and class are required.');
  if (assignmentType === 'Subject' && !subject) throw new Error('Subject is required for subject assignments.');

  const data = await getSheetRows(CLASS_TEACHERS_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== classId) continue;
    if (String(data[i][1]) !== teacherId) continue;
    if (String(data[i][2]) !== assignmentType) continue;
    if (String(data[i][3] || '').trim().toLowerCase() === subject.toLowerCase()) {
      throw new Error('This assignment already exists.');
    }
  }

  await appendRows(CLASS_TEACHERS_SHEET, [[classId, teacherId, assignmentType, subject]]);
  return { saved: true };
}

async function deleteAdminClassAssignment(payload) {
  const source = String(payload.source || 'admin');
  const rowIndex = Number(payload.rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error('Invalid assignment row.');

  const sheet = source === 'teacher' ? TEACHER_CLASS_SUBJECTS_SHEET : CLASS_TEACHERS_SHEET;
  const cols = source === 'teacher' ? 'A:D' : 'A:D';
  await updateRange(sheet, `A${rowIndex}:${cols.split(':')[1]}${rowIndex}`, [
    source === 'teacher' ? ['', '', '', ''] : ['', '', '', '']
  ]);
  return { deleted: true };
}

module.exports = {
  ensureTeacherClassSubjectsSheet,
  listCatalogSubjects,
  listAdminClassAssignments,
  listTeacherSubjectGroups,
  getSubjectsForClass,
  getTeacherLessonSlots,
  addTeacherSubject,
  removeTeacherSubject,
  saveAdminClassAssignment,
  deleteAdminClassAssignment,
  styleKey,
  assertTeacherClassAccess
};
