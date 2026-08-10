'use strict';

const crypto = require('crypto');
const {
  REPORT_CARD_FIELDS_SHEET,
  REPORT_CARD_ENTRIES_SHEET,
  REPORT_CARD_STATUS_SHEET,
  STUDENT_PROFILE_SHEET,
  TEACHER_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache
} = require('../sheets');
const { getClassRoster, getTeacherProfile, getClassNameMap } = require('./teacherPortalService');
const { listClassGradeSubjects, getTeacherGradeAccess } = require('./subjectAssignmentService');
const { buildReportCardFromGrades } = require('./gradeService');
const { getActiveTerm } = require('./gradeWeightService');
const {
  SCHOOL_NAME,
  SCHOOL_ADDRESS
} = require('../config');
const {
  GRADE_LEGEND,
  SEL_LEGEND,
  computeTermSummary,
  academicYearLabel,
  termDisplayLabel
} = require('./reportCardPrint');
const {
  getOrCreateWorkflow,
  findWorkflow,
  STATES: WF_STATES,
  stateLabel,
  getTeacherHeadId
} = require('./reportCardWorkflowService');
const { getStudentYearAttendance } = require('./attendanceService');
const { defaultAcademicYearRange } = require('./schoolCalendarService');

const STATUS_HEADERS = [
  'StatusID', 'ClassID', 'StudentID', 'Term', 'Subject',
  'TeacherID', 'Status', 'SharedWithParents', 'SharedAt', 'UpdatedAt'
];

const WORK_HABITS = [
  { fieldKey: 'wh_participation', label: 'Class Participation' },
  { fieldKey: 'wh_homework', label: 'Homework Completion' },
  { fieldKey: 'wh_respect', label: 'Respect & Responsibility' },
  { fieldKey: 'wh_time', label: 'Time Management' }
];

const RATING_OPTIONS = [
  'Outstanding',
  'Satisfactory',
  'Needs Improvement',
  'Unsatisfactory'
];

const RATING_SCORE = {
  Outstanding: 4,
  Satisfactory: 3,
  'Needs Improvement': 2,
  Unsatisfactory: 1
};

const SUBJECT_COMMENT_KEY = 'subject_comment';

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function letterGrade(pct) {
  if (pct == null || pct === '' || Number.isNaN(Number(pct))) return '';
  const p = Number(pct);
  if (p >= 93) return 'A';
  if (p >= 90) return 'A-';
  if (p >= 87) return 'B+';
  if (p >= 83) return 'B';
  if (p >= 80) return 'B-';
  if (p >= 77) return 'C+';
  if (p >= 73) return 'C';
  if (p >= 70) return 'C-';
  if (p >= 67) return 'D+';
  if (p >= 60) return 'D';
  return 'F';
}

async function ensureReportCardSheets() {
  await ensureSheet(REPORT_CARD_FIELDS_SHEET, [
    'FieldID', 'ClassID', 'Term', 'Subject', 'FieldKey', 'Label', 'SortOrder', 'MaxScore'
  ]);
  await ensureSheet(REPORT_CARD_ENTRIES_SHEET, [
    'EntryID', 'ClassID', 'StudentID', 'Term', 'Subject', 'FieldKey', 'Score', 'Comment', 'TeacherID', 'UpdatedAt'
  ]);
  await ensureSheet(REPORT_CARD_STATUS_SHEET, STATUS_HEADERS);
}

async function listReportCardFields(classId, term) {
  await ensureReportCardSheets();
  const rows = await getSheetRows(REPORT_CARD_FIELDS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId) && String(rows[i][1]) !== '*') continue;
    if (term && String(rows[i][2]) !== String(term) && String(rows[i][2]) !== '*') continue;
    out.push({
      fieldId: String(rows[i][0]),
      classId: String(rows[i][1]),
      term: String(rows[i][2]),
      subject: String(rows[i][3]),
      fieldKey: String(rows[i][4]),
      label: String(rows[i][5]),
      sortOrder: Number(rows[i][6]) || 0,
      maxScore: Number(rows[i][7]) || 100
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return out;
}

async function listReportCardEntries(classId, term, studentId, subjectFilter) {
  await ensureReportCardSheets();
  const rows = await getSheetRows(REPORT_CARD_ENTRIES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (term && String(rows[i][3]) !== String(term)) continue;
    if (studentId && String(rows[i][2]) !== String(studentId)) continue;
    if (subjectFilter && String(rows[i][4]) !== String(subjectFilter)) continue;
    out.push({
      entryId: String(rows[i][0]),
      classId: String(rows[i][1]),
      studentId: String(rows[i][2]),
      term: String(rows[i][3]),
      subject: String(rows[i][4]),
      fieldKey: String(rows[i][5]),
      score: rows[i][6] === '' || rows[i][6] == null ? null : Number(rows[i][6]),
      comment: String(rows[i][7] || ''),
      teacherId: String(rows[i][8] || ''),
      updatedAt: String(rows[i][9] || '')
    });
  }
  return out;
}

async function saveReportCardEntries(classId, term, subject, teacherId, entries) {
  await ensureReportCardSheets();
  const data = await getSheetRows(REPORT_CARD_ENTRIES_SHEET, { skipCache: true });
  const now = new Date().toISOString();
  const appends = [];

  for (const e of entries) {
    const studentId = String(e.studentId);
    const fieldKey = String(e.fieldKey);
    let found = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== String(classId)) continue;
      if (String(data[i][2]) !== studentId) continue;
      if (String(data[i][3]) !== String(term)) continue;
      if (String(data[i][4]) !== String(subject)) continue;
      if (String(data[i][5]) !== fieldKey) continue;
      found = i + 1;
      break;
    }
    const row = [
      found > 0 ? String(data[found - 1][0]) : newId('rc'),
      classId,
      studentId,
      term,
      subject,
      fieldKey,
      e.score == null || e.score === '' ? '' : Number(e.score),
      String(e.comment || ''),
      teacherId,
      now
    ];
    if (found > 0) {
      await updateRange(REPORT_CARD_ENTRIES_SHEET, `A${found}:J${found}`, [row]);
      data[found - 1] = row;
    } else {
      appends.push(row);
      data.push(row);
    }
  }

  if (appends.length) await appendRows(REPORT_CARD_ENTRIES_SHEET, appends);
  invalidateSheetRowsCache(REPORT_CARD_ENTRIES_SHEET);
  return { saved: entries.length };
}

function buildReportCardSummary(students, fields, entries) {
  return students.map((student) => {
    const studentEntries = entries.filter((e) => e.studentId === student.studentId);
    const bySubject = {};
    for (const field of fields) {
      if (!bySubject[field.subject]) bySubject[field.subject] = [];
      const match = studentEntries.find(
        (e) => e.subject === field.subject && e.fieldKey === field.fieldKey
      );
      bySubject[field.subject].push({
        label: field.label,
        fieldKey: field.fieldKey,
        maxScore: field.maxScore,
        score: match ? match.score : null,
        comment: match ? match.comment : ''
      });
    }
    return { studentId: student.studentId, name: student.name, subjects: bySubject };
  });
}

async function listStatusRows(classId, term, studentId) {
  await ensureReportCardSheets();
  const rows = await getSheetRows(REPORT_CARD_STATUS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i] || !rows[i][0]) continue;
    if (classId && String(rows[i][1]) !== String(classId)) continue;
    if (term && String(rows[i][3]) !== String(term)) continue;
    if (studentId && String(rows[i][2]) !== String(studentId)) continue;
    out.push({
      statusId: String(rows[i][0]),
      classId: String(rows[i][1]),
      studentId: String(rows[i][2]),
      term: String(rows[i][3]),
      subject: String(rows[i][4]),
      teacherId: String(rows[i][5] || ''),
      status: String(rows[i][6] || 'Draft'),
      sharedWithParents: String(rows[i][7] || '').toUpperCase() === 'TRUE',
      sharedAt: String(rows[i][8] || ''),
      updatedAt: String(rows[i][9] || ''),
      rowIndex: i + 1
    });
  }
  return out;
}

async function upsertStatus(classId, studentId, term, subject, teacherId, patch) {
  await ensureReportCardSheets();
  const rows = await getSheetRows(REPORT_CARD_STATUS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (String(rows[i][2]) !== String(studentId)) continue;
    if (String(rows[i][3]) !== String(term)) continue;
    if (String(rows[i][4]) !== String(subject)) continue;
    found = i + 1;
    break;
  }
  const prev = found > 0 ? rows[found - 1] : [];
  const now = new Date().toISOString();
  const row = [
    found > 0 ? String(prev[0]) : newId('rcs'),
    classId,
    studentId,
    term,
    subject,
    teacherId || String(prev[5] || ''),
    patch.status != null ? String(patch.status) : String(prev[6] || 'Draft'),
    patch.sharedWithParents != null
      ? (patch.sharedWithParents ? 'TRUE' : 'FALSE')
      : String(prev[7] || 'FALSE'),
    patch.sharedAt != null ? String(patch.sharedAt) : String(prev[8] || ''),
    now
  ];
  if (found > 0) {
    await updateRange(REPORT_CARD_STATUS_SHEET, `A${found}:J${found}`, [row]);
  } else {
    await appendRows(REPORT_CARD_STATUS_SHEET, [row]);
  }
  invalidateSheetRowsCache(REPORT_CARD_STATUS_SHEET);
  return {
    statusId: row[0],
    classId,
    studentId,
    term,
    subject,
    teacherId: row[5],
    status: row[6],
    sharedWithParents: row[7] === 'TRUE',
    sharedAt: row[8],
    updatedAt: row[9]
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

async function getStudentMeta(studentId) {
  const listRows = await getSheetRows(STUDENT_LIST_SHEET);
  let name = '';
  let classId = '';
  for (let i = 1; i < listRows.length; i++) {
    if (String(listRows[i][0]) !== String(studentId)) continue;
    name = String(listRows[i][1] || '');
    classId = String(listRows[i][2] || '');
    break;
  }
  let gradeLevel = '';
  try {
    const profiles = await getSheetRows(STUDENT_PROFILE_SHEET);
    for (let i = 1; i < profiles.length; i++) {
      if (String(profiles[i][0]) !== String(studentId)) continue;
      gradeLevel = String(profiles[i][14] || '');
      break;
    }
  } catch (e) { /* optional */ }
  return { studentId: String(studentId), name, classId, gradeLevel };
}

function entriesToSubjectForm(entries, subject) {
  const byKey = {};
  (entries || []).filter((e) => e.subject === subject).forEach((e) => {
    byKey[e.fieldKey] = e;
  });
  const workHabits = WORK_HABITS.map((h) => ({
    fieldKey: h.fieldKey,
    label: h.label,
    rating: (byKey[h.fieldKey] && byKey[h.fieldKey].comment) || '',
    score: byKey[h.fieldKey] ? byKey[h.fieldKey].score : null
  }));
  const commentEntry = byKey[SUBJECT_COMMENT_KEY] || byKey.comment;
  return {
    workHabits,
    subjectComment: commentEntry ? String(commentEntry.comment || '') : ''
  };
}

function isSubjectFormComplete(form) {
  if (!form) return false;
  const habitsOk = (form.workHabits || []).every((h) => RATING_OPTIONS.includes(h.rating));
  const commentOk = String(form.subjectComment || '').trim().length > 0;
  return habitsOk && commentOk;
}

async function listAllSubjectsForClass(classId) {
  const {
    CLASS_TEACHERS_SHEET,
    TEACHER_CLASS_SUBJECTS_SHEET,
    GRADE_ASSESSMENTS_SHEET
  } = require('../config');
  const [assignRows, customRows, assessRows, names] = await Promise.all([
    getSheetRows(CLASS_TEACHERS_SHEET),
    getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET),
    getSheetRows(GRADE_ASSESSMENTS_SHEET).catch(() => []),
    teacherNameMap()
  ]);
  const bySubject = new Map();
  function add(subject, teacherIdForSubj) {
    const name = String(subject || '').trim();
    if (!name || name === 'All' || name === 'All subjects') return;
    if (!bySubject.has(name)) bySubject.set(name, { subject: name, teacherIds: [], teacherNames: [] });
    const entry = bySubject.get(name);
    const tid = String(teacherIdForSubj || '').trim();
    if (tid && !entry.teacherIds.includes(tid)) {
      entry.teacherIds.push(tid);
      entry.teacherNames.push(names[tid] || tid);
    }
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
  return Array.from(bySubject.values()).sort((a, b) => a.subject.localeCompare(b.subject));
}

/**
 * Class overview for Report Card tab: students + subject completion matrix.
 */
async function getClassReportOverview(teacherId, classId, term) {
  await ensureReportCardSheets();
  classId = String(classId);
  term = String(term || '').trim();
  if (!term) {
    const active = await getActiveTerm(classId).catch(() => null);
    term = (active && (active.label || active.termId)) || 'Term1';
  }

  const [students, subjectData, allSubjects, statuses, classNames, teacher, names] = await Promise.all([
    getClassRoster(classId),
    listClassGradeSubjects(teacherId, classId),
    listAllSubjectsForClass(classId),
    listStatusRows(classId, term),
    getClassNameMap(),
    getTeacherProfile(teacherId),
    teacherNameMap()
  ]);

  const taughtSet = new Set(subjectData.taughtSubjects || []);
  const isHomeroom = !!(subjectData.isHomeroom || (teacher && teacher.homeroomClassId === classId));
  // Readiness uses ALL class subjects; canEdit follows the logged-in teacher.
  const subjectList = (allSubjects.length ? allSubjects : (subjectData.subjects || [])).map((s) => ({
    subject: s.subject,
    teacherNames: s.teacherNames || [],
    canEdit: isHomeroom ? false : taughtSet.has(s.subject) || !!(subjectData.subjects || []).find((x) => x.subject === s.subject && x.canEdit)
  }));
  // Subject teachers can edit their taught subjects; homeroom edits none unless also assigned
  subjectList.forEach((s) => {
    if (taughtSet.has(s.subject)) s.canEdit = true;
  });

  const statusMap = {};
  statuses.forEach((s) => {
    statusMap[s.studentId + '||' + s.subject] = s;
  });

  const requiredSubjects = subjectList.map((s) => s.subject);
  const studentRows = students.map((st) => {
    const subjectStatuses = requiredSubjects.map((subj) => {
      const meta = subjectList.find((x) => x.subject === subj) || {};
      const stRow = statusMap[st.studentId + '||' + subj];
      return {
        subject: subj,
        canEdit: !!meta.canEdit,
        teacherNames: meta.teacherNames || [],
        status: stRow ? stRow.status : 'Draft',
        sharedWithParents: !!(stRow && stRow.sharedWithParents),
        complete: stRow && stRow.status === 'Complete'
      };
    });
    const completeCount = subjectStatuses.filter((x) => x.complete).length;
    const reportReady = requiredSubjects.length > 0 && completeCount === requiredSubjects.length;
    const shared = subjectStatuses.some((x) => x.sharedWithParents);
    return {
      studentId: st.studentId,
      name: st.name,
      subjects: subjectStatuses,
      completeCount,
      requiredCount: requiredSubjects.length,
      reportReady,
      sharedWithParents: shared
    };
  });

  const classReady = studentRows.length > 0 && studentRows.every((s) => s.reportReady);

  return {
    classId,
    className: classNames[classId] || classId,
    term,
    isHomeroom,
    workHabitFields: WORK_HABITS,
    ratingOptions: RATING_OPTIONS,
    subjects: subjectList,
    students: studentRows,
    classReady,
    homeroomTeacherName: isHomeroom ? (teacher && teacher.name) : (names[(await getHomeroomTeacherId(classId))] || '')
  };
}

async function getHomeroomTeacherId(classId) {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][4] || '').trim() === String(classId)) return String(rows[i][0]);
  }
  return '';
}

/**
 * Student × subject editor payload (grades from gradebook + SEL + comment).
 */
async function getStudentSubjectReport(teacherId, classId, studentId, term, subject) {
  await ensureReportCardSheets();
  const access = await getTeacherGradeAccess(teacherId, classId, subject);
  if (!access.canView) throw new Error('You cannot view this subject report.');

  const [roster, entries, statuses, computedList, meta, classNames, names] = await Promise.all([
    getClassRoster(classId),
    listReportCardEntries(classId, term, studentId, subject),
    listStatusRows(classId, term, studentId),
    buildReportCardFromGrades(classId, term, subject, await getClassRoster(classId)),
    getStudentMeta(studentId),
    getClassNameMap(),
    teacherNameMap()
  ]);

  const student = roster.find((s) => s.studentId === String(studentId));
  if (!student) throw new Error('Student not found in this class.');

  const computed = (computedList || []).find((c) => c.studentId === String(studentId)) || null;
  const percent = computed && computed.weightedTotal != null ? computed.weightedTotal : null;
  const form = entriesToSubjectForm(entries, subject);
  const statusRow = (statuses || []).find((s) => s.subject === subject);

  return {
    classId,
    className: classNames[classId] || classId,
    term,
    subject,
    student: {
      studentId: student.studentId,
      name: student.name,
      gradeLevel: meta.gradeLevel || ''
    },
    canEdit: !!access.canEdit,
    isHomeroom: !!access.isHomeroom,
    academic: {
      percentageGrade: percent,
      letterGrade: letterGrade(percent),
      categories: computed ? computed.categories : []
    },
    workHabits: form.workHabits,
    subjectComment: form.subjectComment,
    formComplete: isSubjectFormComplete(form),
    status: statusRow ? statusRow.status : 'Draft',
    sharedWithParents: !!(statusRow && statusRow.sharedWithParents),
    workHabitFields: WORK_HABITS,
    ratingOptions: RATING_OPTIONS,
    teacherName: names[teacherId] || ''
  };
}

async function saveStudentSubjectReport(teacherId, classId, payload) {
  const term = String(payload.term || '').trim();
  const subject = String(payload.subject || '').trim();
  const studentId = String(payload.studentId || '').trim();
  if (!term || !subject || !studentId) throw new Error('Term, subject, and student are required.');

  const access = await getTeacherGradeAccess(teacherId, classId, subject);
  if (!access.canEdit) throw new Error('Only the subject teacher can edit this report section.');

  const ratings = payload.workHabits || {};
  const entries = [];
  WORK_HABITS.forEach((h) => {
    const rating = String(ratings[h.fieldKey] || payload[h.fieldKey] || '').trim();
    if (rating && !RATING_OPTIONS.includes(rating)) {
      throw new Error('Invalid rating for ' + h.label + '.');
    }
    entries.push({
      studentId,
      fieldKey: h.fieldKey,
      score: rating ? RATING_SCORE[rating] : null,
      comment: rating
    });
  });
  entries.push({
    studentId,
    fieldKey: SUBJECT_COMMENT_KEY,
    score: null,
    comment: String(payload.subjectComment || '').trim()
  });

  await saveReportCardEntries(classId, term, subject, teacherId, entries);

  const form = entriesToSubjectForm(
    entries.map((e) => ({ ...e, subject })),
    subject
  );
  // Rebuild form from saved ratings
  form.workHabits = WORK_HABITS.map((h) => ({
    fieldKey: h.fieldKey,
    label: h.label,
    rating: String(ratings[h.fieldKey] || '').trim()
  }));
  form.subjectComment = String(payload.subjectComment || '').trim();

  let status = 'Draft';
  if (payload.markComplete || isSubjectFormComplete(form)) {
    if (!isSubjectFormComplete(form)) {
      throw new Error('Fill all work-habit ratings and a subject comment before marking complete.');
    }
    status = 'Complete';
  }
  if (payload.markComplete === false) status = 'Draft';

  const statusRow = await upsertStatus(classId, studentId, term, subject, teacherId, { status });
  return {
    saved: true,
    status: statusRow.status,
    formComplete: isSubjectFormComplete(form)
  };
}

/**
 * Full printable report card for one student (all subjects).
 * @param {string} viewerId teacher/principal id used for access
 * @param {object} [opts] { bypassAccess }
 */
async function getFullStudentReportCard(viewerId, classId, studentId, term, opts) {
  await ensureReportCardSheets();
  opts = opts || {};
  classId = String(classId);
  studentId = String(studentId);
  term = String(term || '').trim() || 'Term1';

  const homeroomIdEarly = await getHomeroomTeacherId(classId);
  const overviewTeacherId = opts.bypassAccess
    ? (homeroomIdEarly || viewerId)
    : viewerId;
  const overview = await getClassReportOverview(overviewTeacherId, classId, term);
  const studentRow = overview.students.find((s) => s.studentId === studentId);
  if (!studentRow) throw new Error('Student not found.');

  const meta = await getStudentMeta(studentId);
  const classNames = await getClassNameMap();
  const names = await teacherNameMap();
  const homeroomId = homeroomIdEarly;
  let access = { isHomeroom: false };
  if (!opts.bypassAccess) {
    access = await getTeacherGradeAccess(viewerId, classId, '');
    const canEditSome = overview.subjects.some((s) => s.canEdit);
    if (!access.isHomeroom && !canEditSome) {
      const headOf = await getTeacherHeadId(homeroomId).catch(() => '');
      if (String(headOf) !== String(viewerId)) {
        throw new Error('You do not have access to this report card.');
      }
    }
  }

  const subjectBlocks = [];
  for (const subj of overview.subjects) {
    const block = await getStudentSubjectReport(
      overviewTeacherId, classId, studentId, term, subj.subject
    );
    subjectBlocks.push({
      subject: subj.subject,
      teacherNames: subj.teacherNames && subj.teacherNames.length
        ? subj.teacherNames
        : (block.teacherName ? [block.teacherName] : []),
      letterGrade: block.academic.letterGrade,
      percentageGrade: block.academic.percentageGrade,
      categories: block.academic.categories,
      workHabits: block.workHabits,
      subjectComment: block.subjectComment,
      status: block.status,
      complete: block.status === 'Complete'
    });
  }

  const reportReady = !!(studentRow && studentRow.reportReady);
  const shared = !!(studentRow && studentRow.sharedWithParents);

  let attendance = null;
  try {
    const range = defaultAcademicYearRange();
    const yearAtt = await getStudentYearAttendance(classId, studentId, range.start, range.end);
    const s = (yearAtt && yearAtt.summary) || {};
    attendance = {
      daysPresent: s.present || 0,
      daysAbsent: (s.absent || 0) + (s.absentExcused || 0),
      daysAbsentExcused: s.absentExcused || 0,
      daysAbsentUnexcused: s.absent || 0,
      daysTardy: (s.tardy || 0) + (s.tardyExcused || 0),
      daysTardyExcused: s.tardyExcused || 0,
      schoolDays: yearAtt.schoolDays || s.schoolDays || 0,
      yearLabel: yearAtt.yearLabel || academicYearLabel()
    };
  } catch (e) {
    attendance = null;
  }

  const termSummary = computeTermSummary(subjectBlocks);
  const headTeacherId = await getTeacherHeadId(homeroomId).catch(() => '');
  let workflow = null;
  try {
    workflow = await getOrCreateWorkflow(classId, studentId, term, {
      homeroomTeacherId: homeroomId,
      headTeacherId
    });
  } catch (e) {
    const hit = await findWorkflow(classId, studentId, term);
    workflow = hit ? hit.workflow : null;
  }

  const wfState = workflow ? workflow.state : WF_STATES.draft;
  const canHomeroomSign = !!(access.isHomeroom && reportReady &&
    (wfState === WF_STATES.draft || wfState === WF_STATES.signed_homeroom));
  const canSubmitHead = !!(access.isHomeroom && wfState === WF_STATES.signed_homeroom);
  // Parents receive cards only after Principal signs + shares
  const canShare = false;

  return {
    schoolName: SCHOOL_NAME,
    schoolAddress: SCHOOL_ADDRESS,
    term,
    termLabel: termDisplayLabel(term),
    academicYear: academicYearLabel(),
    classId,
    className: classNames[classId] || classId,
    student: {
      studentId,
      name: meta.name || studentRow.name,
      gradeLevel: meta.gradeLevel || ''
    },
    homeroomTeacherName: names[homeroomId] || overview.homeroomTeacherName || '',
    homeroomTeacherId: homeroomId || '',
    subjects: subjectBlocks,
    workHabitFields: WORK_HABITS,
    ratingOptions: RATING_OPTIONS,
    attendance,
    termSummary,
    gradeLegend: GRADE_LEGEND,
    selLegend: SEL_LEGEND,
    workflow: workflow
      ? {
        state: workflow.state,
        stateLabel: stateLabel(workflow.state),
        homeroomSigPath: workflow.homeroomSigPath,
        headSigPath: workflow.headSigPath,
        principalSigPath: workflow.principalSigPath,
        homeroomSignedAt: workflow.homeroomSignedAt,
        headSignedAt: workflow.headSignedAt,
        principalSignedAt: workflow.principalSignedAt,
        sharedAt: workflow.sharedAt,
        scheduledShareAt: workflow.scheduledShareAt
      }
      : null,
    reportReady,
    sharedWithParents: shared || wfState === WF_STATES.shared_parent,
    canShare,
    canHomeroomSign,
    canSubmitHead,
    canGenerate: reportReady,
    generatedAt: new Date().toISOString()
  };
}

async function shareReportCardWithParents(actorId, classId, studentId, term, opts) {
  opts = opts || {};
  const card = await getFullStudentReportCard(actorId, classId, studentId, term, {
    bypassAccess: !!opts.bypassAccess
  });
  if (!card.reportReady) {
    throw new Error('Report is not ready yet. All subject teachers must complete their sections first.');
  }
  const wf = await getOrCreateWorkflow(classId, studentId, term, {
    homeroomTeacherId: card.homeroomTeacherId
  });
  if (wf.state !== WF_STATES.signed_principal && wf.state !== WF_STATES.shared_parent) {
    throw new Error('Principal must sign the report card before sharing with parents.');
  }
  const { markShared } = require('./reportCardWorkflowService');
  await markShared(wf, opts.scheduledShareAt || '');
  if (opts.scheduledShareAt && new Date(opts.scheduledShareAt).getTime() > Date.now()) {
    return { shared: false, scheduled: true, scheduledShareAt: opts.scheduledShareAt, studentId, term };
  }
  const now = new Date().toISOString();
  for (const subj of card.subjects) {
    await upsertStatus(classId, studentId, term, subj.subject, actorId, {
      status: 'Complete',
      sharedWithParents: true,
      sharedAt: now
    });
  }
  return { shared: true, sharedAt: now, studentId, term };
}

/**
 * Seed complete SEL + comments for demo/testing (bypasses teacher access checks).
 */
async function seedDemoSubjectReports(classId, studentId, teacherId, term, subjects) {
  await ensureReportCardSheets();
  classId = String(classId);
  studentId = String(studentId);
  teacherId = String(teacherId);
  term = String(term || 'Term1');
  const subjectList = (subjects && subjects.length) ? subjects : ['English', 'Math', 'Science'];
  const ratings = ['Outstanding', 'Satisfactory', 'Outstanding', 'Satisfactory'];
  const comments = {
    English: 'Test Students participates thoughtfully in discussions and is building stronger writing stamina.',
    Math: 'Solid progress with multi-digit operations. Encourage checking work carefully on word problems.',
    Science: 'Curious and engaged during labs. Lab notes are improving — great effort this term.'
  };
  const seeded = [];
  for (const subject of subjectList) {
    const entries = WORK_HABITS.map((h, idx) => ({
      studentId,
      fieldKey: h.fieldKey,
      score: RATING_SCORE[ratings[idx % ratings.length]],
      comment: ratings[idx % ratings.length]
    }));
    entries.push({
      studentId,
      fieldKey: SUBJECT_COMMENT_KEY,
      score: null,
      comment: comments[subject] ||
        (subject + ': Test Students is making steady progress this term. (Demo comment)')
    });
    await saveReportCardEntries(classId, term, subject, teacherId, entries);
    await upsertStatus(classId, studentId, term, subject, teacherId, { status: 'Complete' });
    seeded.push(subject);
  }
  return { seeded, term, studentId, classId };
}

async function listParentReportCards(parentSession) {
  const studentId = String(parentSession.studentId || '');
  const classId = String(parentSession.classId || '');
  if (!studentId || !classId) return { reports: [] };

  const active = await getActiveTerm(classId).catch(() => null);
  const term = (active && (active.label || active.termId)) || 'Term1';
  const statuses = await listStatusRows(classId, term, studentId);
  const sharedSubjects = statuses.filter((s) => s.sharedWithParents);
  if (!sharedSubjects.length) {
    return { reports: [], message: 'No report card has been shared yet.' };
  }

  // Build card without teacher access check — parents only see shared cards
  const overviewSubjects = [...new Set(sharedSubjects.map((s) => s.subject))];
  const meta = await getStudentMeta(studentId);
  const classNames = await getClassNameMap();
  const names = await teacherNameMap();
  const homeroomId = await getHomeroomTeacherId(classId);
  const roster = [{ studentId, name: meta.name }];

  const subjectBlocks = [];
  for (const subject of overviewSubjects) {
    const entries = await listReportCardEntries(classId, term, studentId, subject);
    const form = entriesToSubjectForm(entries, subject);
    let percent = null;
    try {
      const computed = await buildReportCardFromGrades(classId, term, subject, roster);
      const hit = (computed || []).find((c) => c.studentId === studentId);
      if (hit) percent = hit.weightedTotal;
    } catch (e) { /* ignore */ }
    const st = sharedSubjects.find((s) => s.subject === subject);
    subjectBlocks.push({
      subject,
      teacherNames: st && st.teacherId ? [names[st.teacherId] || st.teacherId] : [],
      letterGrade: letterGrade(percent),
      percentageGrade: percent,
      workHabits: form.workHabits,
      subjectComment: form.subjectComment,
      status: 'Complete',
      complete: true
    });
  }

  let attendance = null;
  try {
    const range = defaultAcademicYearRange();
    const yearAtt = await getStudentYearAttendance(classId, studentId, range.start, range.end);
    const s = (yearAtt && yearAtt.summary) || {};
    attendance = {
      daysPresent: s.present || 0,
      daysAbsent: (s.absent || 0) + (s.absentExcused || 0),
      daysAbsentExcused: s.absentExcused || 0,
      daysAbsentUnexcused: s.absent || 0,
      daysTardy: (s.tardy || 0) + (s.tardyExcused || 0),
      schoolDays: yearAtt.schoolDays || s.schoolDays || 0
    };
  } catch (e) { /* ignore */ }

  const wfHit = await findWorkflow(classId, studentId, term);

  return {
    reports: [{
      schoolName: SCHOOL_NAME,
      schoolAddress: SCHOOL_ADDRESS,
      term,
      termLabel: termDisplayLabel(term),
      academicYear: academicYearLabel(),
      classId,
      className: classNames[classId] || classId,
      student: {
        studentId,
        name: meta.name,
        gradeLevel: meta.gradeLevel || ''
      },
      homeroomTeacherName: names[homeroomId] || '',
      subjects: subjectBlocks,
      workHabitFields: WORK_HABITS,
      termSummary: computeTermSummary(subjectBlocks),
      gradeLegend: GRADE_LEGEND,
      selLegend: SEL_LEGEND,
      attendance,
      workflow: wfHit && wfHit.workflow
        ? {
          state: wfHit.workflow.state,
          stateLabel: stateLabel(wfHit.workflow.state),
          homeroomSigPath: wfHit.workflow.homeroomSigPath,
          headSigPath: wfHit.workflow.headSigPath,
          principalSigPath: wfHit.workflow.principalSigPath,
          homeroomSignedAt: wfHit.workflow.homeroomSignedAt,
          headSignedAt: wfHit.workflow.headSignedAt,
          principalSignedAt: wfHit.workflow.principalSignedAt,
          sharedAt: wfHit.workflow.sharedAt,
          scheduledShareAt: wfHit.workflow.scheduledShareAt
        }
        : null,
      sharedWithParents: true,
      sharedAt: sharedSubjects[0].sharedAt || '',
      generatedAt: new Date().toISOString()
    }]
  };
}

module.exports = {
  WORK_HABITS,
  RATING_OPTIONS,
  letterGrade,
  listReportCardFields,
  listReportCardEntries,
  saveReportCardEntries,
  buildReportCardSummary,
  getClassReportOverview,
  getStudentSubjectReport,
  saveStudentSubjectReport,
  getFullStudentReportCard,
  shareReportCardWithParents,
  listParentReportCards,
  listAllSubjectsForClass,
  ensureReportCardSheets,
  seedDemoSubjectReports
};
