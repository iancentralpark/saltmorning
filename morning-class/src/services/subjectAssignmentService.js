const {
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  SUBJECTS_SHEET,
  GRADE_ASSESSMENTS_SHEET
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
const SKIP_SUBJECTS = new Set(['All', 'All subjects', 'Homeroom']);

function addSubjectEntry(bySubject, teacherNames, subject, teacherIdForSubj, teacherNameHint) {
  const name = String(subject || '').trim();
  if (!name || SKIP_SUBJECTS.has(name)) return;
  if (!bySubject.has(name)) {
    bySubject.set(name, { subject: name, teacherIds: [], teacherNames: [] });
  }
  const entry = bySubject.get(name);
  const tid = String(teacherIdForSubj || '').trim();
  if (tid && !entry.teacherIds.includes(tid)) {
    entry.teacherIds.push(tid);
    entry.teacherNames.push(teacherNameHint || teacherNames[tid] || tid);
  }
}

/**
 * Class curriculum for Grades / Reports.
 * If the class has timetable Subject requirements, that list is the
 * curriculum (exact match). Otherwise the list is Class_Teachers +
 * Teacher_Class_Subjects + existing Grade_Assessments.
 */
async function collectClassSubjects(classId) {
  const { listRequirementCurriculum } = require('./timetableRequirementsService');
  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  const [reqSubjects, assignRows, customRows, assessRows, teacherNames] = await Promise.all([
    listRequirementCurriculum(classId).catch(() => []),
    getSheetRows(CLASS_TEACHERS_SHEET),
    getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET),
    getSheetRows(GRADE_ASSESSMENTS_SHEET).catch(() => []),
    teacherDisplayNameMap()
  ]);

  const bySubject = new Map();
  function add(subject, teacherIdForSubj, teacherNameHint) {
    addSubjectEntry(bySubject, teacherNames, subject, teacherIdForSubj, teacherNameHint);
  }

  if (reqSubjects.length) {
    reqSubjects.forEach((s) => {
      (s.teacherIds || []).forEach((tid, idx) => {
        add(s.subject, tid, (s.teacherNames && s.teacherNames[idx]) || '');
      });
      if (!(s.teacherIds || []).length) add(s.subject, '');
    });
    return {
      source: 'requirements',
      subjects: Array.from(bySubject.values()).sort((a, b) => a.subject.localeCompare(b.subject))
    };
  }

  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0]) !== String(classId)) continue;
    add(assignRows[i][3], assignRows[i][1]);
  }
  for (let i = 1; i < customRows.length; i++) {
    if (String(customRows[i][1]) !== String(classId)) continue;
    add(customRows[i][2], customRows[i][0]);
  }
  for (let i = 1; i < (assessRows || []).length; i++) {
    if (String(assessRows[i][1]) !== String(classId)) continue;
    add(assessRows[i][3], assessRows[i][8]);
  }
  return {
    source: 'assignments',
    subjects: Array.from(bySubject.values()).sort((a, b) => a.subject.localeCompare(b.subject))
  };
}

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
  const { listAllRequirements } = require('./timetableRequirementsService');
  const [{ homeroom, assigned }, assignRows, customRows, classNames, catalog, requirements] = await Promise.all([
    getTeacherClasses(teacherId),
    getSheetRows(CLASS_TEACHERS_SHEET),
    getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET),
    getClassNameMap(),
    listCatalogSubjects(),
    listAllRequirements().catch(() => [])
  ]);
  return {
    homeroom,
    assigned,
    assignRows,
    custom: parseCustomSubjectRows(customRows, teacherId),
    classNames,
    catalog,
    requirements
  };
}

function subjectsForClassFromData(teacherId, classId, data, opts) {
  const includeHomeroomDefault = !opts || opts.includeHomeroomDefault !== false;
  const subjects = new Set();
  const isHomeroom = data.homeroom.some((e) => e.classId === classId);

  data.assigned.forEach((e) => {
    if (e.classId !== classId) return;
    (e.subjects || []).forEach((s) => {
      if (s && s !== 'All' && s !== 'All subjects') subjects.add(s);
    });
  });

  for (let i = 1; i < data.assignRows.length; i++) {
    if (String(data.assignRows[i][1]) !== String(teacherId)) continue;
    if (String(data.assignRows[i][0]) !== String(classId)) continue;
    const assignmentType = String(data.assignRows[i][2] || 'Subject');
    const subject = String(data.assignRows[i][3] || '').trim();
    if (subject) subjects.add(subject);
    // Homeroom row without a subject is a role, not a teachable subject
    if (assignmentType === 'Homeroom' && !subject) continue;
  }

  data.custom.forEach((c) => {
    if (c.classId === classId) subjects.add(c.subject);
  });

  (data.requirements || []).forEach((r) => {
    if (String(r.teacherId) !== String(teacherId)) return;
    const ids = r.classIds || [r.classId];
    if (!ids.map(String).includes(String(classId))) return;
    const name = String(r.subject || '').trim();
    if (name && !SKIP_SUBJECTS.has(name)) subjects.add(name);
  });

  if (includeHomeroomDefault && isHomeroom && !subjects.size) {
    subjects.add(DEFAULT_HOMEROOM_SUBJECT);
  }
  return Array.from(subjects).sort((a, b) => a.localeCompare(b));
}

function isHomeroomOfFromData(teacherId, classId, data) {
  return data.homeroom.some((e) => e.classId === String(classId));
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
  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  const [classNames, teacherNames, assignRows] = await Promise.all([
    getClassNameMap(),
    teacherDisplayNameMap(),
    getSheetRows(CLASS_TEACHERS_SHEET)
  ]);

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

async function getSubjectsForClass(teacherId, classId, opts) {
  const data = await loadTeacherSubjectData(teacherId);
  return subjectsForClassFromData(teacherId, classId, data, opts);
}

async function isTeacherHomeroomOf(teacherId, classId) {
  const data = await loadTeacherSubjectData(teacherId);
  return isHomeroomOfFromData(teacherId, classId, data);
}

async function getTeacherGradeAccess(teacherId, classId, subject) {
  await assertTeacherClassAccess(teacherId, classId);
  const isHomeroom = await isTeacherHomeroomOf(teacherId, classId);
  const taught = await getSubjectsForClass(teacherId, classId, { includeHomeroomDefault: false });
  const subj = String(subject || '').trim();
  const canEdit = Boolean(subj && taught.includes(subj));
  const canView = canEdit || isHomeroom;
  if (subj && !canView) {
    throw new Error('You can only view grades for subjects you teach, or all subjects as Homeroom teacher.');
  }
  return { canView: !subj || canView, canEdit, isHomeroom, taughtSubjects: taught };
}

async function listClassGradeSubjects(teacherId, classId) {
  await assertTeacherClassAccess(teacherId, classId);
  const { listExcludedReportSubjects } = require('./classSubjectFlagsService');
  const [data, collected, excluded] = await Promise.all([
    loadTeacherSubjectData(teacherId),
    collectClassSubjects(classId),
    listExcludedReportSubjects(classId)
  ]);

  const isHomeroom = isHomeroomOfFromData(teacherId, classId, data);
  const taught = subjectsForClassFromData(teacherId, classId, data, { includeHomeroomDefault: false });
  const taughtSet = new Set(taught);

  let subjects = collected.subjects.map((s) => ({
    subject: s.subject,
    canEdit: taughtSet.has(s.subject),
    teacherNames: s.teacherNames,
    excludeFromReport: excluded.has(s.subject),
    canToggleReport: isHomeroom || taughtSet.has(s.subject)
  }));

  if (!isHomeroom) {
    subjects = subjects.filter((s) => s.canEdit);
  }

  return {
    classId: String(classId),
    isHomeroom,
    source: collected.source,
    taughtSubjects: taught,
    subjects
  };
}

async function getTeacherLessonSlots(teacherId, filterClassId) {
  const data = await loadTeacherSubjectData(teacherId);
  return buildLessonSlotsFromData(teacherId, filterClassId, data);
}

async function listTeacherSubjectGroups(teacherId) {
  const [data, customStyles, prefs] = await Promise.all([
    loadTeacherSubjectData(teacherId),
    listTeacherSubjectStyles(teacherId),
    require('./subjectPrefsService').listTeacherSubjectPrefs(teacherId)
  ]);
  const { isHidden, resolveTeachingDays, DAY_LABELS } = require('./subjectPrefsService');
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
    let subjects = subjectsForClassFromData(teacherId, classId, data);
    subjects = subjects.filter((s) => !isHidden(prefs, classId, s));
    groups[classId].subjects = subjects;
    const subjectMeta = {};
    for (const s of subjects) {
      const days = await resolveTeachingDays(teacherId, classId, s, prefs);
      const custom = data.custom.some((c) => c.classId === classId && c.subject === s);
      subjectMeta[s] = {
        teachingDays: days,
        dayLabels: days.map((d) => DAY_LABELS[d] || String(d)),
        removable: true,
        isCustom: custom,
        syncFromTimetable: !(prefs[classId + '|' + s] && prefs[classId + '|' + s].syncFromTimetable === false)
      };
    }
    groups[classId].subjectMeta = subjectMeta;
    const roles = [];
    if (groups[classId].isHomeroom) roles.push('Homeroom');
    subjects.forEach((s) => {
      if (s && !roles.includes(s)) roles.push(s);
    });
    groups[classId].roles = roles;
    groups[classId].roleLabel = roles.join(' / ');
  }

  const classSlots = buildLessonSlotsFromData(teacherId, '', data).filter(
    (s) => !isHidden(prefs, s.classId, s.subject)
  );
  const styleBundle = buildStyleLookup(classSlots, customStyles);
  const classes = Object.values(groups).sort((a, b) => {
    if (a.isHomeroom !== b.isHomeroom) return a.isHomeroom ? -1 : 1;
    return a.className.localeCompare(b.className);
  });
  return {
    catalog: data.catalog,
    classes,
    custom: data.custom,
    styles: customStyles,
    stylePalette: SUBJECT_PALETTE,
    resolvedStyles: styleBundle.byKey,
    prefs
  };
}

async function addTeacherSubject(teacherId, classId, subject) {
  await ensureTeacherClassSubjectsSheet();
  await assertTeacherClassAccess(teacherId, classId);
  subject = String(subject || '').trim();
  if (!subject) throw new Error('Subject name is required.');
  if (subject.length > 40) throw new Error('Subject name is too long.');

  const { isHidden, saveSubjectPref, listTeacherSubjectPrefs } = require('./subjectPrefsService');
  const prefs = await listTeacherSubjectPrefs(teacherId);
  if (isHidden(prefs, classId, subject)) {
    await saveSubjectPref(teacherId, { classId, subject, hidden: false });
    return { added: true, subject, classId, mode: 'unhidden' };
  }

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
  classId = String(classId || '').trim();
  const data = await getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(teacherId)) continue;
    if (String(data[i][1]) !== String(classId)) continue;
    if (String(data[i][2]).trim() !== subject) continue;
    found = i + 1;
    break;
  }
  if (found > 0) {
    await updateRange(TEACHER_CLASS_SUBJECTS_SHEET, `A${found}:D${found}`, [['', '', '', '']]);
    return { removed: true, mode: 'custom' };
  }
  // Admin-assigned / homeroom default: hide via prefs instead of deleting source assignment.
  const { saveSubjectPref } = require('./subjectPrefsService');
  await saveSubjectPref(teacherId, { classId, subject, hidden: true });
  return { removed: true, mode: 'hidden' };
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
  assertTeacherClassAccess,
  isTeacherHomeroomOf,
  getTeacherGradeAccess,
  listClassGradeSubjects,
  collectClassSubjects
};
