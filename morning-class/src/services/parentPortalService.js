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
const crypto = require('crypto');

const PARENT_EDITABLE_PROFILE = [
  'address', 'phone', 'email',
  'parentName', 'parentPhone', 'parentEmail',
  'emergencyContact', 'emergencyPhone',
  'nationality', 'notes'
];

async function assertParentChild(session) {
  const parentId = String((session && session.parentId) || '');
  const studentId = String((session && session.studentId) || '');
  if (!parentId) throw new Error('Login required.');
  if (!studentId) throw new Error('No linked student on this parent account.');

  const { parentHasStudent, ensureParentStudentsSheet } = require('./parentRegistryService');
  await ensureParentStudentsSheet();
  const ok = await parentHasStudent(parentId, studentId);
  if (!ok) {
    // Legacy fallback: Parent_List col B still points at this student
    const rows = await getSheetRows(PARENT_LIST_SHEET);
    let legacyOk = false;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== parentId) continue;
      if (String(rows[i][1] || '').trim() === studentId) legacyOk = true;
      break;
    }
    if (!legacyOk) throw new Error('That student is not linked to this parent account.');
  }

  let classId = String((session && session.classId) || '');
  if (!classId) {
    const studentRows = await getSheetRows(STUDENT_LIST_SHEET);
    for (let j = 1; j < studentRows.length; j++) {
      if (String(studentRows[j][0]) !== studentId) continue;
      classId = String(studentRows[j][2] || '');
      break;
    }
  }
  return { studentId, classId, parentId };
}

async function teacherNameMap() {
  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  return teacherDisplayNameMap();
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
  const { studentId, classId, parentId } = await assertParentChild(session);
  const { listChildrenForParent } = require('./parentRegistryService');
  const [student, teachers, announcements, homework, reports, children] = await Promise.all([
    getStudent(studentId),
    listChildTeachers(classId),
    listParentAnnouncements(classId).catch(() => []),
    getStudentHomeworkStatus(studentId, classId).catch(() => ({ pending: [], today: [], completed: [] })),
    listParentReportCards(session).catch(() => ({ reports: [] })),
    listChildrenForParent(parentId).catch(() => [])
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
      parentName: (student.profile && student.profile.parentName) || session.name,
      relationship: ((children || []).find((c) => c.studentId === studentId) || {}).relationship || 'Guardian'
    },
    children: (children || []).map((c) => ({
      studentId: c.studentId,
      name: c.name,
      classId: c.classId,
      relationship: c.relationship,
      isPrimary: c.isPrimary,
      active: c.studentId === studentId
    })),
    teachers,
    homeworkSummary: {
      pending: (homework.pending || []).length,
      today: (homework.today || []).length
    },
    reportCardsShared: (reports.reports || []).length,
    newsfeed,
    badgeSources: {
      feed: (newsfeed || []).map((i) => ({ id: String(i.id || ''), at: String(i.at || '') })),
      announcements: (announcements || []).map((a) => ({
        id: String(a.announcementId || a.title || ''),
        at: String(a.postedAt || '')
      })),
      homework: (homework.pending || []).map((h) => ({
        id: String(h.itemId || h.homeworkId || h.title || ''),
        at: String(h.assignedDate || h.postedAt || h.createdAt || '')
      })),
      reportcards: (reports.reports || []).map((r) => ({
        id: String(r.term || ''),
        at: String(r.sharedAt || '')
      }))
    }
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
      meta: {
        source: a.sourceLabel || (a.scope === 'class' ? 'Class' : 'School'),
        imagePath: a.imagePath || '',
        linkUrl: a.linkUrl || '',
        linkLabel: a.linkLabel || '',
        attachmentPath: a.attachmentPath || '',
        attachmentName: a.attachmentName || ''
      }
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
 * Fast path with a short model fallback list (avoids hard-fail when one model is busy).
 * targetLang: 'ko' | 'en'
 */
const translateResultCache = new Map();
const TRANSLATE_CACHE_TTL_MS = 60 * 60 * 1000;

function translateCacheKey(text, lang) {
  return lang + ':' + crypto.createHash('sha1').update(String(text)).digest('hex');
}

function getCachedTranslation(text, lang) {
  const key = translateCacheKey(text, lang);
  const hit = translateResultCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    translateResultCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCachedTranslation(text, lang, value) {
  translateResultCache.set(translateCacheKey(text, lang), {
    value,
    expires: Date.now() + TRANSLATE_CACHE_TTL_MS
  });
  // Soft cap to avoid unbounded growth in long-lived processes
  if (translateResultCache.size > 500) {
    const first = translateResultCache.keys().next().value;
    if (first) translateResultCache.delete(first);
  }
}

async function translateChatMessage(text, targetLang) {
  text = String(text || '').trim();
  if (!text) throw new Error('Nothing to translate.');
  if (!isGeminiConfigured()) {
    throw new Error('Translate is not configured (missing GEMINI_API_KEY).');
  }
  const lang = String(targetLang || 'ko').toLowerCase() === 'en' ? 'en' : 'ko';
  const cached = getCachedTranslation(text, lang);
  if (cached) return Object.assign({ cached: true }, cached);

  const langName = lang === 'en' ? 'English' : 'Korean';
  // Chat bodies are capped at 500 chars — keep output budget tight for speed.
  const maxOutputTokens = Math.min(768, Math.max(160, Math.ceil(text.length * 2.2) + 40));
  const primary = process.env.MESSENGER_TRANSLATE_MODEL
    || process.env.GEMINI_FAST_MODEL
    || 'gemini-2.5-flash-lite';
  // Short curated list: stay fast, but recover when one model is overloaded.
  const models = Array.from(new Set([
    primary,
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash'
  ].filter(Boolean)));

  let result;
  try {
    result = await askGemini(
      'Translate into natural ' + langName + '. Return ONLY the full translation, no quotes.\n\n' + text,
      {
        temperature: 0.1,
        maxOutputTokens,
        model: primary,
        models,
        retries: 2
      }
    );
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (/busy|high demand|unavailable|overloaded|quota|rate/i.test(msg)) {
      throw new Error('Translate is busy right now. Tap Translate again in a moment.');
    }
    throw e;
  }
  const translated = String(result.text || result.answer || '').trim()
    .replace(/^["'「『]|["'」』]$/g, '')
    .trim();
  if (!translated) throw new Error('Empty translation.');
  const payload = {
    original: text,
    translated,
    targetLang: lang,
    model: result.model || primary
  };
  setCachedTranslation(text, lang, payload);
  return payload;
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
  const { upsertStudentRecord } = require('./attendanceService');

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

  // 2) Parent account parent / parent + Parent_Students link
  const {
    saveParentAccount,
    linkParentToStudent,
    ensureParentStudentsSheet
  } = require('./parentRegistryService');
  await ensureParentStudentsSheet();
  await saveParentAccount({
    parentId: 'P001',
    name: 'Test Parents',
    loginId: 'parent',
    password: 'parent',
    phone: '',
    email: ''
  });
  // Keep legacy StudentID column for older readers
  const parentRows = await getSheetRows(PARENT_LIST_SHEET, { skipCache: true });
  for (let i = 1; i < parentRows.length; i++) {
    if (String(parentRows[i][0]) !== 'P001') continue;
    const row = parentRows[i].slice();
    while (row.length < 7) row.push('');
    row[1] = studentId;
    row[2] = 'Test Parents';
    row[3] = 'parent';
    row[4] = 'parent';
    await updateRange(PARENT_LIST_SHEET, `A${i + 1}:G${i + 1}`, [row.slice(0, 7)]);
    break;
  }
  invalidateSheetRowsCache(PARENT_LIST_SHEET);
  await linkParentToStudent('P001', studentId, { relationship: 'Guardian', isPrimary: true });

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
  const { parseHomeroomClassIds } = require('./teacherPortalService');
  const teacherRows = await getSheetRows(TEACHER_LIST_SHEET);
  let teacherId = 'T001';
  for (let i = 1; i < teacherRows.length; i++) {
    const ids = parseHomeroomClassIds(teacherRows[i][4]);
    if (ids.includes(classId) || String(teacherRows[i][0]) === 'T001') {
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

  // Seed under whichever real school semester is active today. Demo data
  // must never create or edit semesters itself — that's a real Admin
  // feature now (Admin → Calendar → School semesters), and doing it here
  // used to pollute that list with a fake "Term1" entry and even stretch
  // the real active semester's end date.
  let activeTerm = '';
  try {
    const active = await getActiveTerm(classId);
    if (active && active.label) activeTerm = active.label;
  } catch (e) { /* ignore */ }
  if (!activeTerm) {
    try {
      const terms = await listGradeTerms(classId);
      if (terms && terms[0]) activeTerm = terms[0].label;
    } catch (e) { /* ignore */ }
  }
  if (!activeTerm) {
    throw new Error('No school semester configured yet. Set one up in Admin → Calendar → School semesters first, then try again.');
  }

  const termsToSeed = [activeTerm];
  const today = todayStr();
  let subjectList = subjectsNeeded;
  try {
    const listed = await listAllSubjectsForClass(classId);
    if (listed && listed.length) subjectList = listed.map((s) => s.subject);
  } catch (e) { /* use defaults */ }

  const seededByTerm = {};
  for (const term of termsToSeed) {
    for (const subject of subjectList) {
      try {
        await saveGradeWeights(classId, term, subject, [
          { categoryKey: 'quiz', label: 'Quiz', weightPercent: 40, aggregation: 'average' },
          { categoryKey: 'test', label: 'Test', weightPercent: 60, aggregation: 'average' }
        ]);
      } catch (e) { /* may already exist */ }

      const base = 82 + (subject.length % 8);
      try {
        await saveGradeEntries(classId, term, subject, teacherId, today, 'quiz', 100, [
          { studentId, score: base + 4, maxScore: 100, note: 'Demo quiz' }
        ]);
        await saveGradeEntries(classId, term, subject, teacherId, today, 'test', 100, [
          { studentId, score: base + 8, maxScore: 100, note: 'Demo test' }
        ]);
      } catch (e) {
        try {
          await saveGradeEntries(classId, null, subject, teacherId, today, 'quiz', 100, [
            { studentId, score: 88, maxScore: 100, note: 'Demo quiz' }
          ]);
        } catch (e2) { /* ignore */ }
      }
    }
    seededByTerm[term] = await seedDemoSubjectReports(
      classId, studentId, teacherId, term, subjectList
    );
  }

  // Mock attendance so report card Attendance Record is non-empty.
  const attendancePlan = [
    { offset: 1, status: '출석', excuse: '' },
    { offset: 2, status: '출석', excuse: '' },
    { offset: 3, status: '지각', excuse: '' },
    { offset: 4, status: '출석', excuse: '' },
    { offset: 5, status: '결석', excuse: 'Illness' },
    { offset: 8, status: '출석', excuse: '' },
    { offset: 9, status: '결석', excuse: '' },
    { offset: 10, status: '지각', excuse: 'Bus delay' },
    { offset: 11, status: '출석', excuse: '' },
    { offset: 12, status: '출석', excuse: '' },
    { offset: 15, status: '출석', excuse: '' },
    { offset: 16, status: '출석', excuse: '' },
    { offset: 17, status: '결석', excuse: 'Family event' },
    { offset: 18, status: '출석', excuse: '' },
    { offset: 19, status: '출석', excuse: '' }
  ];
  let attendanceSeeded = 0;
  for (const item of attendancePlan) {
    const d = new Date();
    d.setDate(d.getDate() - item.offset);
    // skip weekends
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const dateStr = formatSheetDate(d);
    try {
      await upsertStudentRecord(classId, studentId, dateStr, item.status, 'Demo seed', item.excuse);
      attendanceSeeded += 1;
    } catch (e) { /* ignore calendar blocks */ }
  }

  return {
    ok: true,
    parentLogin: { loginId: 'parent', password: 'parent', name: 'Test Parents' },
    student: { studentId, name: 'Test Students', classId },
    teacherId,
    term: activeTerm,
    activeTerm,
    termsSeeded: termsToSeed,
    subjects: (seededByTerm[activeTerm] && seededByTerm[activeTerm].seeded) || subjectList,
    attendanceSeeded,
    message: 'Parent demo ready. Open Report card with term ' + activeTerm +
      ' → generate/print. Homeroom signs, then Head → Principal before parent share.'
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
