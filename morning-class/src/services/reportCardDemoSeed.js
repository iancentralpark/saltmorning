const { formatSheetDate } = require('../dateUtils');
const { saveGradeTerm, saveGradeWeights, listGradeTerms } = require('./gradeWeightService');
const { saveGradeEntries } = require('./gradeService');
const {
  seedDemoSubjectReports,
  listAllSubjectsForClass,
  ensureReportCardSheets
} = require('./reportCardService');
const {
  STUDENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  CLASS_TEACHERS_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, invalidateSheetRowsCache } = require('../sheets');

const LAST_TERM_LABEL = 'Fall 2025';
const LAST_TERM_START = '2025-09-01';
const LAST_TERM_END = '2026-02-28';

const CURRENT_TERM_LABEL = 'Spring 2026';
const CURRENT_TERM_START = '2026-03-01';
const CURRENT_TERM_END = '2026-08-31';

const DEFAULT_SUBJECTS = ['English', 'Math', 'Science'];

const SUBJECT_PACKS = {
  English: {
    quizzes: [
      { date: '2025-10-08', score: 92, note: 'Unit 1 quiz' },
      { date: '2025-11-12', score: 88, note: 'Unit 2 quiz' },
      { date: '2026-01-14', score: 90, note: 'Unit 3 quiz' }
    ],
    homework: [
      { date: '2025-10-20', score: 95, note: 'Reading journal' },
      { date: '2025-12-05', score: 90, note: 'Essay draft' }
    ],
    tests: [
      { date: '2025-12-18', score: 87, note: 'Midterm' },
      { date: '2026-02-12', score: 91, note: 'Final' }
    ],
    ratings: ['Outstanding', 'Outstanding', 'Satisfactory', 'Outstanding'],
    comment:
      'Test Students showed strong growth in reading comprehension and class discussion. ' +
      'Writing became clearer across the term. Continue nightly reading over the break.'
  },
  Math: {
    quizzes: [
      { date: '2025-10-10', score: 85, note: 'Fractions quiz' },
      { date: '2025-11-18', score: 90, note: 'Decimals quiz' },
      { date: '2026-01-20', score: 88, note: 'Geometry quiz' }
    ],
    homework: [
      { date: '2025-10-25', score: 92, note: 'Problem set 4' },
      { date: '2025-12-02', score: 86, note: 'Word problems' }
    ],
    tests: [
      { date: '2025-12-16', score: 84, note: 'Midterm' },
      { date: '2026-02-10', score: 89, note: 'Final' }
    ],
    ratings: ['Satisfactory', 'Outstanding', 'Outstanding', 'Satisfactory'],
    comment:
      'Consistent effort on practice sets. Multi-step word problems improved after midterm. ' +
      'Encourage checking answers carefully before submitting.'
  },
  Science: {
    quizzes: [
      { date: '2025-10-15', score: 94, note: 'Matter quiz' },
      { date: '2025-11-25', score: 89, note: 'Energy quiz' },
      { date: '2026-01-22', score: 93, note: 'Earth quiz' }
    ],
    homework: [
      { date: '2025-11-05', score: 97, note: 'Lab notebook' },
      { date: '2026-01-08', score: 91, note: 'Research mini-poster' }
    ],
    tests: [
      { date: '2025-12-17', score: 90, note: 'Midterm' },
      { date: '2026-02-11', score: 92, note: 'Final' }
    ],
    ratings: ['Outstanding', 'Satisfactory', 'Outstanding', 'Outstanding'],
    comment:
      'Curious and careful during labs. Notebook organization improved a lot. ' +
      'Great collaboration with classmates on group investigations.'
  }
};

function resolveTestStudent(studentRows) {
  let studentId = 'S001';
  let classId = 'C001';
  let rowIndex = -1;
  for (let i = 1; i < studentRows.length; i++) {
    const id = String(studentRows[i][0] || '');
    const name = String(studentRows[i][1] || '').toLowerCase();
    if (id === 'S001' || name.includes('test student')) {
      studentId = id;
      classId = String(studentRows[i][2] || 'C001');
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex < 0 && studentRows.length > 1) {
    studentId = String(studentRows[1][0]);
    classId = String(studentRows[1][2] || 'C001');
    rowIndex = 2;
  }
  return { studentId, classId, rowIndex };
}

async function ensureTeacherSubjects(classId, teacherId) {
  const assignRows = await getSheetRows(CLASS_TEACHERS_SHEET);
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
  DEFAULT_SUBJECTS.forEach((subj) => {
    if (!existing.has(subj)) toAdd.push([classId, teacherId, 'Subject', subj]);
  });
  if (toAdd.length) {
    await appendRows(CLASS_TEACHERS_SHEET, toAdd);
    invalidateSheetRowsCache(CLASS_TEACHERS_SHEET);
  }
}

async function seedSubjectGrades(classId, studentId, teacherId, term, subject, pack) {
  await saveGradeWeights(classId, term, subject, [
    { categoryKey: 'quiz', label: 'Quiz', weightPercent: 30, aggregation: 'average', sortOrder: 1 },
    { categoryKey: 'homework', label: 'Homework', weightPercent: 20, aggregation: 'average', sortOrder: 2 },
    { categoryKey: 'test', label: 'Test', weightPercent: 50, aggregation: 'average', sortOrder: 3 }
  ]);

  const buckets = [
    ['quiz', pack.quizzes || []],
    ['homework', pack.homework || []],
    ['test', pack.tests || []]
  ];
  let saved = 0;
  for (const [categoryKey, rows] of buckets) {
    for (const row of rows) {
      const dateStr = formatSheetDate(row.date);
      if (dateStr < LAST_TERM_START || dateStr > LAST_TERM_END) continue;
      try {
        await saveGradeEntries(classId, term, subject, teacherId, dateStr, categoryKey, 100, [
          { studentId, score: row.score, maxScore: 100, note: row.note || '' }
        ]);
        saved += 1;
      } catch (e) { /* ignore */ }
    }
  }
  return saved;
}

/**
 * Fill Test Students with a complete last-semester report card dataset
 * so teachers can open Report card → generate/print/share.
 */
async function seedLastSemesterReportCard() {
  await ensureReportCardSheets();

  const studentRows = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const { studentId, classId, rowIndex } = resolveTestStudent(studentRows);
  if (rowIndex > 0) {
    const row = studentRows[rowIndex - 1].slice();
    while (row.length < 6) row.push('');
    row[1] = 'Test Students';
    await updateRange(STUDENT_LIST_SHEET, `A${rowIndex}:F${rowIndex}`, [row.slice(0, 6)]);
    invalidateSheetRowsCache(STUDENT_LIST_SHEET);
  }

  const teacherRows = await getSheetRows(TEACHER_LIST_SHEET);
  let teacherId = 'T001';
  for (let i = 1; i < teacherRows.length; i++) {
    if (String(teacherRows[i][4] || '') === classId || String(teacherRows[i][0]) === 'T001') {
      teacherId = String(teacherRows[i][0]);
      break;
    }
  }

  await ensureTeacherSubjects(classId, teacherId);
  await saveGradeTerm(classId, LAST_TERM_LABEL, LAST_TERM_START, LAST_TERM_END);
  await saveGradeTerm(classId, CURRENT_TERM_LABEL, CURRENT_TERM_START, CURRENT_TERM_END);

  let subjectList = DEFAULT_SUBJECTS.slice();
  try {
    const listed = await listAllSubjectsForClass(classId);
    if (listed && listed.length) {
      subjectList = listed.map((s) => s.subject);
      DEFAULT_SUBJECTS.forEach((s) => {
        if (!subjectList.includes(s)) subjectList.push(s);
      });
    }
  } catch (e) { /* defaults */ }

  const gradeCounts = {};
  const comments = {};
  const ratingsBySubject = {};
  for (const subject of subjectList) {
    const pack = SUBJECT_PACKS[subject] || {
      quizzes: [
        { date: '2025-10-15', score: 88, note: 'Quiz 1' },
        { date: '2025-11-20', score: 90, note: 'Quiz 2' }
      ],
      homework: [{ date: '2025-11-01', score: 92, note: 'HW packet' }],
      tests: [
        { date: '2025-12-15', score: 86, note: 'Midterm' },
        { date: '2026-02-10', score: 89, note: 'Final' }
      ],
      ratings: ['Satisfactory', 'Satisfactory', 'Outstanding', 'Satisfactory'],
      comment: subject + ': Test Students made steady progress across Fall 2025.'
    };
    gradeCounts[subject] = await seedSubjectGrades(
      classId, studentId, teacherId, LAST_TERM_LABEL, subject, pack
    );
    comments[subject] = pack.comment;
    ratingsBySubject[subject] = pack.ratings;
  }

  const seeded = await seedDemoSubjectReports(
    classId, studentId, teacherId, LAST_TERM_LABEL, subjectList,
    { comments, ratingsBySubject }
  );

  return {
    ok: true,
    student: { studentId, name: 'Test Students', classId },
    teacherId,
    lastTerm: {
      label: LAST_TERM_LABEL,
      startDate: LAST_TERM_START,
      endDate: LAST_TERM_END
    },
    currentTerm: {
      label: CURRENT_TERM_LABEL,
      startDate: CURRENT_TERM_START,
      endDate: CURRENT_TERM_END
    },
    subjects: seeded.seeded || subjectList,
    gradeCounts,
    terms: await listGradeTerms(classId),
    howToView:
      'Teacher → class → Report card → choose term "' + LAST_TERM_LABEL +
      '" → Refresh → Open report card on Test Students → Print / Share with parents.'
  };
}

module.exports = {
  LAST_TERM_LABEL,
  seedLastSemesterReportCard
};
