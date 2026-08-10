const {
  PARENT_LIST_SHEET,
  STUDENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  CLASS_TEACHERS_SHEET,
  TEACHER_CLASS_SUBJECTS_SHEET,
  GRADES_DAILY_SHEET,
  PARENT_ANNOUNCEMENTS_SHEET
} = require('../config');
const { getSheetRows, updateRange, appendRows, invalidateSheetRowsCache } = require('../sheets');
const { formatSheetDate, todayStr } = require('../dateUtils');
const { getStudent, saveStudent, saveStudentFields } = require('./studentRegistryService');
const { getStudentYearAttendance } = require('./attendanceService');
const { getTimetable } = require('./timetableService');
const { getStudentHomeworkStatus } = require('./homeworkService');
const { listParentAnnouncements } = require('./parentAnnouncementService');
const { listParentReportCards } = require('./reportCardService');
const { askGemini, isGeminiConfigured } = require('./geminiService');

const PARENT_EDITABLE_PROFILE = [
  'address', 'phone', 'email',
  'parentName', 'parentPhone', 'parentEmail',
  'emergencyContact', 'emergencyPhone',
  'nationality', 'notes'
];

async function assertParentChild(session) {
  const studentId = String(session.studentId || '');
  const classId = String(session.classId || '');
  if (!studentId) throw new Error('No linked student on this parent account.');
  return { studentId, classId };
}

async function teacherNameMap() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[String(rows[i][0])] = String(rows[i][1] || '');
  }
  return map;
}

async function listChildTeachers(classId) {
  classId = String(classId || '');
  const [assignRows, customRows, names] = await Promise.all([
    getSheetRows(CLASS_TEACHERS_SHEET),
    getSheetRows(TEACHER_CLASS_SUBJECTS_SHEET),
    teacherNameMap()
  ]);
  const byTeacher = new Map();

  function add(teacherId, role, subject) {
    const tid = String(teacherId || '').trim();
    if (!tid) return;
    if (!byTeacher.has(tid)) {
      byTeacher.set(tid, {
        teacherId: tid,
        name: names[tid] || tid,
        isHomeroom: false,
        subjects: []
      });
    }
    const t = byTeacher.get(tid);
    if (String(role || '').toLowerCase() === 'homeroom') t.isHomeroom = true;
    const subj = String(subject || '').trim();
    if (subj && subj !== 'All' && !t.subjects.includes(subj)) t.subjects.push(subj);
  }

  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0]) !== classId) continue;
    add(assignRows[i][1], assignRows[i][2], assignRows[i][3]);
  }
  for (let i = 1; i < customRows.length; i++) {
    if (String(customRows[i][1]) !== classId) continue;
    add(customRows[i][0], 'Subject', customRows[i][2]);
  }

  return Array.from(byTeacher.values()).sort((a, b) => {
    if (a.isHomeroom !== b.isHomeroom) return a.isHomeroom ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function getParentOverview(session) {
  const { studentId, classId } = await assertParentChild(session);
  const [student, teachers, announcements, homework, reports] = await Promise.all([
    getStudent(studentId),
    listChildTeachers(classId),
    listParentAnnouncements().catch(() => []),
    getStudentHomeworkStatus(studentId, classId).catch(() => ({ pending: [], today: [], completed: [] })),
    listParentReportCards(session).catch(() => ({ reports: [] }))
  ]);

  const newsfeed = await buildNewsfeed({
    studentId,
    classId,
    studentName: student.name,
    announcements,
    homework,
    reports: reports.reports || []
  });

  return {
    parent: {
      parentId: session.parentId,
      name: session.name
    },
    student: {
      studentId: student.studentId,
      name: student.name,
      classId: student.classId,
      className: student.className || '',
      status: student.status,
      photoPath: (student.profile && student.profile.photoPath) || student.photoPath || '',
      gradeLevel: (student.profile && student.profile.gradeLevel) || '',
      parentName: (student.profile && student.profile.parentName) || session.name
    },
    teachers,
    homeworkSummary: {
      pending: (homework.pending || []).length,
      today: (homework.today || []).length
    },
    reportCardsShared: (reports.reports || []).length,
    newsfeed
  };
}

async function buildNewsfeed({ studentId, classId, studentName, announcements, homework, reports }) {
  const items = [];

  (announcements || []).slice(0, 10).forEach((a) => {
    items.push({
      id: 'ann-' + (a.announcementId || a.title),
      type: 'announcement',
      title: a.title || 'Announcement',
      body: a.body || '',
      at: a.postedAt || '',
      meta: { source: 'School' }
    });
  });

  (reports || []).forEach((r) => {
    items.push({
      id: 'rc-' + r.term,
      type: 'report',
      title: 'Report card shared — ' + r.term,
      body: 'Homeroom shared ' + studentName + "'s report card with you.",
      at: r.sharedAt || '',
      meta: { term: r.term }
    });
    (r.subjects || []).forEach((s) => {
      if (s.subjectComment) {
        items.push({
          id: 'cmt-' + r.term + '-' + s.subject,
          type: 'comment',
          title: s.subject + ' — Teacher comment',
          body: s.subjectComment,
          at: r.sharedAt || '',
          meta: {
            subject: s.subject,
            letterGrade: s.letterGrade,
            teachers: (s.teacherNames || []).join(', ')
          }
        });
      }
    });
  });

  try {
    const gradeRows = await getSheetRows(GRADES_DAILY_SHEET);
    const recent = [];
    for (let i = 1; i < gradeRows.length; i++) {
      if (String(gradeRows[i][2]) !== String(studentId)) continue;
      if (classId && String(gradeRows[i][1]) !== String(classId)) continue;
      recent.push({
        subject: String(gradeRows[i][3] || ''),
        date: formatSheetDate(gradeRows[i][4]),
        score: gradeRows[i][5],
        maxScore: gradeRows[i][6],
        category: String(gradeRows[i][7] || ''),
        note: String(gradeRows[i][9] || ''),
        createdAt: String(gradeRows[i][10] || '')
      });
    }
    recent.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    recent.slice(0, 12).forEach((g, idx) => {
      items.push({
        id: 'gr-' + g.date + '-' + g.subject + '-' + idx,
        type: 'grade',
        title: g.subject + ' grade' + (g.category ? ' · ' + g.category : ''),
        body: 'Score: ' + g.score + (g.maxScore ? ' / ' + g.maxScore : '') +
          (g.note ? ' — ' + g.note : ''),
        at: g.createdAt || g.date,
        meta: g
      });
    });
  } catch (e) { /* optional */ }

  (homework.pending || []).slice(0, 8).forEach((h) => {
    items.push({
      id: 'hw-' + h.itemId,
      type: 'homework',
      title: 'Homework: ' + (h.title || 'Assignment'),
      body: h.description || ('Due ' + (h.dueDate || h.assignedDate || '')),
      at: h.assignedDate || '',
      meta: { dueDate: h.dueDate, pending: true }
    });
  });

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return items.slice(0, 40);
}

async function getParentAttendance(session, startDate, endDate) {
  const { studentId, classId } = await assertParentChild(session);
  return getStudentYearAttendance(classId, studentId, startDate, endDate);
}

async function getParentTimetable(session) {
  const { studentId } = await assertParentChild(session);
  return getTimetable('student', studentId);
}

async function getParentHomework(session) {
  const { studentId, classId } = await assertParentChild(session);
  return getStudentHomeworkStatus(studentId, classId);
}

async function getParentStudentProfile(session) {
  const { studentId } = await assertParentChild(session);
  const student = await getStudent(studentId);
  return {
    studentId: student.studentId,
    name: student.name,
    classId: student.classId,
    className: student.className || '',
    status: student.status,
    photoPath: (student.profile && student.profile.photoPath) || '',
    profile: student.profile,
    fields: student.fields,
    editableKeys: PARENT_EDITABLE_PROFILE,
    medicalFields: (student.fields && student.fields.medical) || []
  };
}

async function updateParentStudentProfile(session, payload) {
  const { studentId } = await assertParentChild(session);
  const current = await getStudent(studentId);
  const profilePayload = Object.assign({}, current.profile || {});

  PARENT_EDITABLE_PROFILE.forEach((key) => {
    if (payload && Object.prototype.hasOwnProperty.call(payload, key)) {
      profilePayload[key] = String(payload[key] == null ? '' : payload[key]).trim();
    }
  });

  await saveStudent({
    studentId,
    name: current.name,
    classId: current.classId,
    status: current.status,
    loginId: current.loginId,
    profile: profilePayload
  });

  if (payload && payload.medicalFields && Array.isArray(payload.medicalFields)) {
    const medical = payload.medicalFields.map((f, i) => ({
      fieldId: f.fieldId || '',
      label: String(f.label || '').trim(),
      value: String(f.value || '').trim(),
      sortOrder: i
    })).filter((f) => f.label);
    await saveStudentFields(studentId, { medical });
  }

  return getParentStudentProfile(session);
}

/**
 * Translate a chat message for parent↔teacher messenger.
 * targetLang: 'ko' | 'en'
 */
async function translateChatMessage(text, targetLang) {
  text = String(text || '').trim();
  if (!text) throw new Error('Nothing to translate.');
  if (!isGeminiConfigured()) {
    throw new Error('Translate is not configured (missing GEMINI_API_KEY).');
  }
  const lang = String(targetLang || 'ko').toLowerCase() === 'en' ? 'en' : 'ko';
  const langName = lang === 'en' ? 'English' : 'Korean';
  const audience = lang === 'en'
    ? 'a teacher reading a parent message'
    : 'a parent reading a teacher message';
  const result = await askGemini(
    'You are a careful school-messenger translator.\n' +
    'Translate the FULL message below into natural ' + langName + ' for ' + audience + '.\n' +
    'Rules:\n' +
    '- Return ONLY the complete translation — every sentence, joke, and detail.\n' +
    '- Do not summarize, cut off, or add commentary/quotes/labels.\n' +
    '- Keep names and numbers as-is when natural.\n\n' +
    'MESSAGE:\n' + text,
    { temperature: 0.15, maxOutputTokens: 4096 }
  );
  const translated = String(result.text || result.answer || '').trim()
    .replace(/^["'「『]|["'」』]$/g, '')
    .trim();
  if (!translated) throw new Error('Empty translation.');
  return {
    original: text,
    translated,
    targetLang: lang,
    model: result.model || ''
  };
}

async function translateToKorean(text) {
  return translateChatMessage(text, 'ko');
}

/**
 * Ensure demo parent account parent/parent linked to Test Students (S001),
 * and seed mock grades + report-card SEL so a teacher can generate/share.
 */
async function ensureParentDemoData() {
  const { seedDemoSubjectReports, listAllSubjectsForClass } = require('./reportCardService');
  const { saveGradeEntries } = require('./gradeService');
  const { getActiveTerm, listGradeTerms, saveGradeWeights } = require('./gradeWeightService');

  // 1) Student name
  const studentRows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  let studentId = 'S001';
  let classId = 'C001';
  let studentRowIndex = -1;
  for (let i = 1; i < studentRows.length; i++) {
    if (String(studentRows[i][0]) === 'S001' || String(studentRows[i][1]).toLowerCase().includes('test student')) {
      studentId = String(studentRows[i][0]);
      classId = String(studentRows[i][2] || 'C001');
      studentRowIndex = i + 1;
      break;
    }
  }
  if (studentRowIndex < 0 && studentRows.length > 1) {
    studentId = String(studentRows[1][0]);
    classId = String(studentRows[1][2] || 'C001');
    studentRowIndex = 2;
  }
  if (studentRowIndex > 0) {
    const row = studentRows[studentRowIndex - 1].slice();
    while (row.length < 6) row.push('');
    row[1] = 'Test Students';
    await updateRange(STUDENT_LIST_SHEET, `A${studentRowIndex}:F${studentRowIndex}`, [row.slice(0, 6)]);
    invalidateSheetRowsCache(STUDENT_LIST_SHEET);
  }

  // 2) Parent account parent / parent
  const parentRows = await getSheetRows(PARENT_LIST_SHEET, { skipCache: true });
  let parentFound = -1;
  for (let i = 1; i < parentRows.length; i++) {
    if (String(parentRows[i][3] || '').trim() === 'parent' || String(parentRows[i][0]) === 'P001') {
      parentFound = i + 1;
      break;
    }
  }
  const parentRow = ['P001', studentId, 'Test Parents', 'parent', 'parent', '', ''];
  if (parentFound > 0) {
    await updateRange(PARENT_LIST_SHEET, `A${parentFound}:G${parentFound}`, [parentRow]);
  } else {
    await appendRows(PARENT_LIST_SHEET, [parentRow]);
  }
  invalidateSheetRowsCache(PARENT_LIST_SHEET);

  try {
    await saveStudent({
      studentId,
      name: 'Test Students',
      classId,
      status: 'Enrolled',
      profile: {
        parentName: 'Test Parents',
        gradeLevel: 'Grade 5',
        gender: 'F',
        nationality: 'Korea'
      }
    });
  } catch (e) { /* continue */ }

  // 3) Homeroom teacher
  const teacherRows = await getSheetRows(TEACHER_LIST_SHEET);
  let teacherId = 'T001';
  for (let i = 1; i < teacherRows.length; i++) {
    if (String(teacherRows[i][4] || '') === classId || String(teacherRows[i][0]) === 'T001') {
      teacherId = String(teacherRows[i][0]);
      break;
    }
  }

  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
  const subjectsNeeded = ['English', 'Math', 'Science'];
  const existing = new Set();
  let hasHomeroom = false;
  for (let i = 1; i < assignRows.length; i++) {
    if (String(assignRows[i][0]) !== classId) continue;
    const subj = String(assignRows[i][3] || '').trim();
    if (subj) existing.add(subj);
    if (String(assignRows[i][2]).toLowerCase() === 'homeroom') hasHomeroom = true;
  }
  const toAdd = [];
  if (!hasHomeroom) toAdd.push([classId, teacherId, 'Homeroom', '']);
  subjectsNeeded.forEach((subj) => {
    if (!existing.has(subj)) toAdd.push([classId, teacherId, 'Subject', subj]);
  });
  if (toAdd.length) {
    await appendRows(CLASS_TEACHERS_SHEET, toAdd);
    invalidateSheetRowsCache(CLASS_TEACHERS_SHEET);
  }

  let term = 'Term1';
  try {
    const active = await getActiveTerm(classId);
    if (active && active.label) term = active.label;
    else {
      const terms = await listGradeTerms(classId);
      if (terms && terms[0]) term = terms[0].label;
    }
  } catch (e) { /* default */ }

  const today = todayStr();
  let subjectList = subjectsNeeded;
  try {
    const listed = await listAllSubjectsForClass(classId);
    if (listed && listed.length) subjectList = listed.map((s) => s.subject);
  } catch (e) { /* use defaults */ }

  for (const subject of subjectList) {
    try {
      await saveGradeWeights(classId, term, subject, [
        { categoryKey: 'quiz', label: 'Quiz', weightPercent: 40, aggregation: 'average' },
        { categoryKey: 'test', label: 'Test', weightPercent: 60, aggregation: 'average' }
      ]);
    } catch (e) { /* may already exist */ }

    try {
      await saveGradeEntries(classId, term, subject, teacherId, today, 'quiz', 100, [
        { studentId, score: 86 + (subject.length % 10), maxScore: 100, note: 'Demo quiz' }
      ]);
    } catch (e) {
      try {
        await saveGradeEntries(classId, null, subject, teacherId, today, 'quiz', 100, [
          { studentId, score: 88, maxScore: 100, note: 'Demo quiz' }
        ]);
      } catch (e2) { /* ignore */ }
    }
  }

  const seeded = await seedDemoSubjectReports(classId, studentId, teacherId, term, subjectList);

  return {
    ok: true,
    parentLogin: { loginId: 'parent', password: 'parent', name: 'Test Parents' },
    student: { studentId, name: 'Test Students', classId },
    teacherId,
    term,
    subjects: seeded.seeded || subjectList,
    message: 'Parent demo ready. Homeroom can open Report card → generate/print → Share with parents.'
  };
}

module.exports = {
  getParentOverview,
  getParentAttendance,
  getParentTimetable,
  getParentHomework,
  getParentStudentProfile,
  updateParentStudentProfile,
  listChildTeachers,
  translateToKorean,
  translateChatMessage,
  ensureParentDemoData,
  PARENT_EDITABLE_PROFILE
};
