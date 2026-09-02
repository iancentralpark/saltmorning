const crypto = require('crypto');
const {
  ANALYTICS_TEST_REPORTS_SHEET,
  ANALYTICS_DAILY_LOGS_SHEET,
  ANALYTICS_INTERVENTIONS_SHEET,
  ANALYTICS_TEACHER_NOTES_SHEET
} = require('../../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache, deleteRows
} = require('../../sheets');
const { formatSheetDate, todayStr } = require('../../dateUtils');
const { getClassRoster } = require('../teacherPortalService');
const { getPendingHomeworkCounts } = require('../homeworkService');
const {
  calculateStudentStatus,
  summarizeEngagement,
  buildDomainProfile,
  buildProgressSeries,
  STATUS_META
} = require('./statusEngine');
const { parseAssessmentInput } = require('./assessmentParser');
const {
  listTeacherNotes,
  activeTeacherNotes
} = require('./teacherNotesService');

const TEST_HEADERS = [
  'ReportID', 'StudentID', 'ClassID', 'Source', 'TestDate',
  'Score', 'Percentile', 'Lexile', 'RitScore', 'DomainScoresJSON', 'RawMetaJSON', 'CreatedAt'
];
const LOG_HEADERS = [
  'LogID', 'StudentID', 'ClassID', 'Date', 'VocabScore', 'FormativeScore',
  'HomeworkSubmitted', 'HomeworkAssigned', 'Participation', 'Notes', 'CreatedAt'
];
const INT_HEADERS = [
  'InterventionID', 'StudentID', 'ClassID', 'Status', 'RootCausesJSON',
  'TeacherReport', 'ParentReport', 'RecommendedActionsJSON', 'CreatedAt', 'UpdatedAt', 'ParentSharedAt'
];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function safeJson(v, fallback) {
  try {
    if (v == null || v === '') return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(String(v));
  } catch (e) {
    return fallback;
  }
}

let analyticsSheetsReady = false;
let analyticsSheetsInFlight = null;

async function ensureAnalyticsSheets() {
  if (analyticsSheetsReady) return;
  if (analyticsSheetsInFlight) return analyticsSheetsInFlight;
  analyticsSheetsInFlight = (async () => {
    await ensureSheet(ANALYTICS_TEST_REPORTS_SHEET, TEST_HEADERS);
    await ensureSheet(ANALYTICS_DAILY_LOGS_SHEET, LOG_HEADERS);
    await ensureSheet(ANALYTICS_INTERVENTIONS_SHEET, INT_HEADERS);
    analyticsSheetsReady = true;
    analyticsSheetsInFlight = null;
  })();
  return analyticsSheetsInFlight;
}

function parseTestRow(row) {
  if (!row || !row[0]) return null;
  const rawMeta = safeJson(row[10], {});
  return {
    reportId: String(row[0]),
    studentId: String(row[1] || ''),
    classId: String(row[2] || ''),
    source: String(row[3] || 'other'),
    testDate: formatSheetDate(row[4]),
    score: row[5] === '' || row[5] == null ? null : Number(row[5]),
    percentile: row[6] === '' || row[6] == null ? null : Number(row[6]),
    lexile: String(row[7] || '') || null,
    ritScore: row[8] === '' || row[8] == null ? null : Number(row[8]),
    domainScores: safeJson(row[9], []),
    rawMeta,
    included: rawMeta.included !== false,
    isMock: isMockReportMeta(rawMeta),
    importBatchId: String(rawMeta.importBatchId || ''),
    importedFrom: String(rawMeta.importedFrom || ''),
    extractionModel: String(rawMeta.extractionModel || ''),
    createdAt: String(row[11] || '')
  };
}

function isMockReportMeta(rawMeta) {
  const meta = rawMeta || {};
  if (meta.mock === true || meta.sourceType === 'seed') return true;
  if (meta.importedFrom || meta.importBatchId) return false;
  return true;
}

function activeTestReports(reports) {
  return (reports || []).filter((r) => r.included !== false);
}

function activeDailyLogs(logs) {
  return (logs || []).filter((l) => l.included !== false);
}

function parseLogRow(row) {
  if (!row || !row[0]) return null;
  const notes = String(row[9] || '');
  const isMock = notes.startsWith('__mock__') || (!notes.includes('imported:') && notes !== '');
  return {
    logId: String(row[0]),
    studentId: String(row[1] || ''),
    classId: String(row[2] || ''),
    date: formatSheetDate(row[3]),
    vocabScore: row[4] === '' || row[4] == null ? null : Number(row[4]),
    formativeScore: row[5] === '' || row[5] == null ? null : Number(row[5]),
    homeworkSubmitted: Number(row[6]) || 0,
    homeworkAssigned: Number(row[7]) || 0,
    participation: row[8] === '' || row[8] == null ? null : Number(row[8]),
    notes: notes.replace(/^__mock__\s*/, '').replace(/^__excluded__\s*/, '').trim(),
    included: !notes.startsWith('__excluded__'),
    isMock,
    createdAt: String(row[10] || '')
  };
}

function parseTeacherNoteRow(row) {
  if (!row || !row[0]) return null;
  const included = String(row[8] || '').toLowerCase();
  return {
    noteId: String(row[0]),
    studentId: String(row[1] || ''),
    classId: String(row[2] || ''),
    teacherId: String(row[3] || ''),
    teacherName: String(row[4] || ''),
    subject: String(row[5] || ''),
    noteType: String(row[6] || 'comment'),
    body: String(row[7] || ''),
    includedInAnalytics: !(included === 'false' || included === '0' || included === 'no'),
    createdAt: String(row[9] || ''),
    updatedAt: String(row[10] || '')
  };
}

function parseInterventionRow(row) {
  if (!row || !row[0]) return null;
  return {
    interventionId: String(row[0]),
    studentId: String(row[1] || ''),
    classId: String(row[2] || ''),
    status: String(row[3] || ''),
    rootCauses: safeJson(row[4], []),
    teacherReport: String(row[5] || ''),
    parentReport: String(row[6] || ''),
    recommendedActions: safeJson(row[7], []),
    createdAt: String(row[8] || ''),
    updatedAt: String(row[9] || ''),
    parentSharedAt: String(row[10] || '')
  };
}

async function listTestReports(classId, studentId) {
  await ensureAnalyticsSheets();
  const rows = await getSheetRows(ANALYTICS_TEST_REPORTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = parseTestRow(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    if (studentId && r.studentId !== String(studentId)) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.testDate.localeCompare(b.testDate));
}

async function listDailyLogs(classId, studentId) {
  await ensureAnalyticsSheets();
  const rows = await getSheetRows(ANALYTICS_DAILY_LOGS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = parseLogRow(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    if (studentId && r.studentId !== String(studentId)) continue;
    out.push(r);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function listInterventions(classId, studentId) {
  await ensureAnalyticsSheets();
  const rows = await getSheetRows(ANALYTICS_INTERVENTIONS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = parseInterventionRow(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    if (studentId && r.studentId !== String(studentId)) continue;
    out.push(r);
  }
  return out.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function saveTestReports(reports, opts) {
  opts = opts || {};
  await ensureAnalyticsSheets();
  if (!Array.isArray(reports) || !reports.length) throw new Error('No reports to save.');
  const now = isoNow();
  const batchId = opts.importBatchId || '';
  const rows = reports.map((r) => {
    const rawMeta = Object.assign({}, r.rawMeta || {});
    if (batchId && !rawMeta.importBatchId) rawMeta.importBatchId = batchId;
    if (opts.mock && rawMeta.mock == null) rawMeta.mock = true;
    if (rawMeta.included == null) rawMeta.included = true;
    return [
      r.reportId || newId('atr'),
      String(r.studentId),
      String(r.classId || ''),
      String(r.source || 'other'),
      formatSheetDate(r.testDate),
      r.score == null ? '' : r.score,
      r.percentile == null ? '' : r.percentile,
      r.lexile || '',
      r.ritScore == null ? '' : r.ritScore,
      JSON.stringify(r.domainScores || []),
      JSON.stringify(rawMeta),
      now
    ];
  });
  await appendRows(ANALYTICS_TEST_REPORTS_SHEET, rows);
  invalidateSheetRowsCache(ANALYTICS_TEST_REPORTS_SHEET);
  return { saved: rows.length, importBatchId: batchId || null };
}

async function saveDailyLogs(logs, opts) {
  opts = opts || {};
  await ensureAnalyticsSheets();
  if (!Array.isArray(logs) || !logs.length) throw new Error('No logs to save.');
  const now = isoNow();
  const rows = logs.map((l) => {
    let notes = String(l.notes || '');
    if (opts.mock && !notes.startsWith('__mock__')) {
      notes = '__mock__' + (notes ? ' ' + notes : '');
    }
    return [
      l.logId || newId('adl'),
      String(l.studentId),
      String(l.classId || ''),
      formatSheetDate(l.date),
      l.vocabScore == null ? '' : l.vocabScore,
      l.formativeScore == null ? '' : l.formativeScore,
      Number(l.homeworkSubmitted) || 0,
      Number(l.homeworkAssigned) || 0,
      l.participation == null ? '' : l.participation,
      notes,
      now
    ];
  });
  await appendRows(ANALYTICS_DAILY_LOGS_SHEET, rows);
  invalidateSheetRowsCache(ANALYTICS_DAILY_LOGS_SHEET);
  return { saved: rows.length };
}

async function importAssessments(payload) {
  const classId = String(payload.classId || '');
  const sourceHint = payload.source || '';
  const defaults = { classId, source: sourceHint };

  // PDF / scan path (AI extraction)
  if (payload.buffer || payload.file) {
    const file = payload.file || {};
    const buffer = payload.buffer || file.buffer;
    const mimeType = payload.mimeType || file.mimetype || '';
    const filename = payload.filename || file.originalname || '';
    const { getClassRoster } = require('../teacherPortalService');
    const { extractAssessmentsFromDocument } = require('./assessmentDocumentImport');
    const roster = await getClassRoster(classId);
    const extracted = await extractAssessmentsFromDocument({
      buffer,
      mimeType,
      filename,
      classId,
      source: sourceHint || 'star_reading',
      roster
    });
    const importBatchId = newId('la_import');
    const reports = extracted.reports.map((r) => Object.assign({}, r, {
      reportId: newId('atr'),
      rawMeta: Object.assign({}, r.rawMeta || {}, {
        importBatchId,
        included: true
      })
    }));
    const saved = await saveTestReports(reports, { importBatchId });
    return Object.assign({}, saved, {
      matched: extracted.matched,
      extracted: extracted.extracted,
      unmatched: extracted.unmatched,
      warnings: extracted.warnings,
      model: extracted.model,
      importBatchId,
      reports: reports.map((r) => ({
        reportId: r.reportId,
        studentId: r.studentId,
        source: r.source,
        testDate: r.testDate,
        score: r.score,
        percentile: r.percentile,
        lexile: r.lexile,
        ritScore: r.ritScore,
        domainScores: r.domainScores || []
      }))
    });
  }

  // Legacy structured JSON (used by seed / internal tools) — not exposed in teacher UI.
  const parsed = parseAssessmentInput(payload.data != null ? payload.data : payload, defaults)
    .map((r) => Object.assign({}, r, {
      classId: r.classId || classId,
      source: sourceHint ? (sourceHint === 'sr' ? 'star_reading' : sourceHint) : r.source
    }));
  if (!parsed.length) throw new Error('Could not parse any assessment rows.');
  return saveTestReports(parsed);
}

async function saveIntervention(record) {
  await ensureAnalyticsSheets();
  const now = isoNow();
  const id = record.interventionId || newId('ain');
  const data = await getSheetRows(ANALYTICS_INTERVENTIONS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) { found = i + 1; break; }
  }
  const row = [
    id,
    String(record.studentId),
    String(record.classId || ''),
    String(record.status || ''),
    JSON.stringify(record.rootCauses || []),
    String(record.teacherReport || ''),
    String(record.parentReport || ''),
    JSON.stringify(record.recommendedActions || []),
    found > 0 ? String(data[found - 1][8] || now) : now,
    now,
    record.parentSharedAt != null
      ? String(record.parentSharedAt || '')
      : (found > 0 ? String(data[found - 1][10] || '') : '')
  ];
  if (found > 0) await updateRange(ANALYTICS_INTERVENTIONS_SHEET, `A${found}:K${found}`, [row]);
  else await appendRows(ANALYTICS_INTERVENTIONS_SHEET, [row]);
  invalidateSheetRowsCache(ANALYTICS_INTERVENTIONS_SHEET);
  return parseInterventionRow(row);
}

async function shareParentReport({ classId, studentId, interventionId }) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  let ints = await listInterventions(classId || undefined, studentId || undefined);
  let target = null;
  if (interventionId) {
    target = ints.find((i) => i.interventionId === String(interventionId));
  }
  if (!target) {
    target = ints.find((i) => i.parentReport && String(i.parentReport).trim()) || ints[0];
  }
  if (!target || !String(target.parentReport || '').trim()) {
    throw new Error('No parent report available to share. Generate a diagnostic first.');
  }
  const shared = await saveIntervention(Object.assign({}, target, {
    parentSharedAt: isoNow()
  }));

  try {
    const { listParentsForStudent } = require('../parentRegistryService');
    const { notifyParentChannels } = require('../consentService');
    const parents = await listParentsForStudent(shared.studentId).catch(() => []);
    const body = 'A learning progress note for your child is ready. Open Report cards / Learning notes in the parent portal.';
    for (const p of parents || []) {
      const pid = typeof p === 'string' ? p : p.parentId;
      if (!pid) continue;
      await notifyParentChannels(pid, shared.studentId, body, {
        title: 'Learning progress note',
        body: 'A teacher shared a progress note for your child.',
        url: '/parent#/reportcards'
      }).catch(() => null);
    }
  } catch (_) { /* optional */ }
  return shared;
}

async function listParentSharedReports(session) {
  const studentId = String(session.studentId || '').trim();
  if (!studentId) return { reports: [] };
  const ints = await listInterventions(undefined, studentId);
  const reports = ints
    .filter((i) => i.parentSharedAt && String(i.parentReport || '').trim())
    .map((i) => ({
      interventionId: i.interventionId,
      studentId: i.studentId,
      classId: i.classId,
      status: i.status,
      parentReport: i.parentReport,
      recommendedActions: i.recommendedActions || [],
      sharedAt: i.parentSharedAt,
      updatedAt: i.updatedAt
    }));
  return { reports, count: reports.length };
}

function defaultActions(status) {
  const map = {
    on_track: [
      'Extend challenge texts in the student’s strength domain while keeping success rate ~80%.',
      'Use the student briefly as a peer model for a strategy already mastered, then rotate roles.',
      'Celebrate specific strategy growth with student and family (not only scores).'
    ],
    attention: [
      'Run a 10-minute targeted clinic on the weakest domain 3× this week (model → guided → brief independent).',
      'Reduce homework breadth; require completion of one high-leverage task tied to the weak skill.',
      'Collect one formative check (exit ticket or oral retell) before the next progress monitoring window.'
    ],
    warning: [
      'Schedule a 1:1 reading/strategy conference this week; diagnose accuracy vs. meaning-making vs. stamina.',
      'Assign daily 8–12 minute practice on the declining domain with immediate corrective feedback.',
      'Align homeroom and subject teachers on one shared skill target; notify family with a concrete home routine.'
    ],
    intervention: [
      'Begin a 2-week intensive: 10-min daily vocabulary/decoding or comprehension clinic (Mon–Fri).',
      'Temporarily prioritize completion over volume; strip non-essential homework until success rate stabilizes.',
      'Hold a brief MTSS-style huddle (homeroom + literacy/subject teacher) to set one measurable goal.',
      'Send a parent-friendly action plan with exact minutes, materials, and what “done well” looks like.'
    ]
  };
  return map[status] || map.attention;
}

function buildStudentBundle(classId, student, allTests, allLogs, allInts, pendingHomework, allNotes) {
  const studentId = student.studentId;
  const testReports = activeTestReports(allTests.filter((t) => t.studentId === studentId));
  const dailyLogs = activeDailyLogs(allLogs.filter((l) => l.studentId === studentId));
  const teacherNotes = activeTeacherNotes((allNotes || []).filter((n) => n.studentId === studentId));
  const engagement = summarizeEngagement(dailyLogs, pendingHomework);
  const status = calculateStudentStatus({ testReports, dailyLogs, engagement, pendingHomework });
  const ints = allInts.filter((i) => i.studentId === studentId);
  return {
    studentId,
    name: student.name,
    classId,
    testReports,
    dailyLogs,
    engagement,
    progressSeries: buildProgressSeries(testReports, dailyLogs),
    domainProfile: buildDomainProfile(testReports),
    status,
    latestIntervention: ints[0] || null,
    teacherNotes,
    allTeacherNotes: (allNotes || []).filter((n) => n.studentId === studentId)
  };
}

function filterParsed(rows, parseFn, classId, studentId) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = parseFn(rows[i]);
    if (!r) continue;
    if (classId && r.classId !== String(classId)) continue;
    if (studentId && r.studentId !== String(studentId)) continue;
    out.push(r);
  }
  return out;
}

async function getClassAnalyticsDashboard(classId, opts) {
  opts = opts || {};
  classId = String(classId);
  await ensureAnalyticsSheets();

  // Single parallel fan-out: roster + 3 analytics sheets + 1 homework bundle (not N× homework).
  const roster = await getClassRoster(classId);
  const [testRows, logRows, intRows, noteRows, pendingByStudent] = await Promise.all([
    getSheetRows(ANALYTICS_TEST_REPORTS_SHEET),
    getSheetRows(ANALYTICS_DAILY_LOGS_SHEET),
    getSheetRows(ANALYTICS_INTERVENTIONS_SHEET),
    getSheetRows(ANALYTICS_TEACHER_NOTES_SHEET).catch(() => []),
    getPendingHomeworkCounts(classId, { roster }).catch(() => ({}))
  ]);

  const tests = filterParsed(testRows, parseTestRow, classId)
    .sort((a, b) => a.testDate.localeCompare(b.testDate));
  const logs = filterParsed(logRows, parseLogRow, classId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ints = filterParsed(intRows, parseInterventionRow, classId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

  const notes = filterParsed(noteRows, parseTeacherNoteRow, classId);

  const students = roster.map((st) =>
    buildStudentBundle(classId, st, tests, logs, ints, pendingByStudent[st.studentId] || 0, notes)
  );

  const statusFilter = opts.status ? String(opts.status) : '';
  let filtered = students;
  if (statusFilter) filtered = students.filter((s) => s.status.status === statusFilter);

  const counts = { on_track: 0, attention: 0, warning: 0, intervention: 0 };
  students.forEach((s) => { counts[s.status.status] = (counts[s.status.status] || 0) + 1; });

  filtered.sort((a, b) => {
    const ra = STATUS_META[a.status.status]?.rank ?? 0;
    const rb = STATUS_META[b.status.status]?.rank ?? 0;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });

  return {
    classId,
    generatedAt: isoNow(),
    counts,
    statusMeta: STATUS_META,
    students: filtered,
    totalStudents: students.length
  };
}

async function getStudentAnalytics(classId, studentId) {
  const dash = await getClassAnalyticsDashboard(classId);
  const hit = (dash.students || []).find((s) => s.studentId === String(studentId));
  if (!hit) throw new Error('Student not found in class analytics.');
  return hit;
}

/**
 * School-wide Learning Analytics for Admin / Principal.
 * Optional classId filter; otherwise all enrolled students.
 */
async function getSchoolAnalyticsDashboard(opts) {
  opts = opts || {};
  const classFilter = opts.classId ? String(opts.classId).trim() : '';
  await ensureAnalyticsSheets();

  const { listStudents } = require('../studentRegistryService');
  const { getClassNameMap } = require('../teacherPortalService');

  let roster = await listStudents({ status: 'Enrolled' });
  if (classFilter) {
    roster = roster.filter((s) => String(s.classId || '') === classFilter);
  }

  const classIds = Array.from(new Set(
    roster.map((s) => String(s.classId || '').trim()).filter(Boolean)
  ));

  const [testRows, logRows, intRows, noteRows, classNames, hwMaps] = await Promise.all([
    getSheetRows(ANALYTICS_TEST_REPORTS_SHEET),
    getSheetRows(ANALYTICS_DAILY_LOGS_SHEET),
    getSheetRows(ANALYTICS_INTERVENTIONS_SHEET),
    getSheetRows(ANALYTICS_TEACHER_NOTES_SHEET).catch(() => []),
    getClassNameMap(),
    Promise.all(classIds.map((cid) =>
      getPendingHomeworkCounts(cid).catch(() => ({}))
    ))
  ]);

  const pendingByStudent = {};
  (hwMaps || []).forEach((map) => {
    Object.keys(map || {}).forEach((sid) => {
      pendingByStudent[sid] = (pendingByStudent[sid] || 0) + (map[sid] || 0);
    });
  });

  const tests = filterParsed(testRows, parseTestRow, '')
    .sort((a, b) => a.testDate.localeCompare(b.testDate));
  const logs = filterParsed(logRows, parseLogRow, '')
    .sort((a, b) => a.date.localeCompare(b.date));
  const ints = filterParsed(intRows, parseInterventionRow, '')
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const notes = filterParsed(noteRows, parseTeacherNoteRow, '');

  const students = roster.map((st) => {
    const bundle = buildStudentBundle(
      st.classId,
      st,
      tests,
      logs,
      ints,
      pendingByStudent[st.studentId] || 0,
      notes
    );
    bundle.className = classNames[st.classId] || st.className || st.classId || '';
    return bundle;
  });

  const statusFilter = opts.status ? String(opts.status) : '';
  let filtered = students;
  if (statusFilter) filtered = students.filter((s) => s.status.status === statusFilter);

  const counts = { on_track: 0, attention: 0, warning: 0, intervention: 0 };
  students.forEach((s) => { counts[s.status.status] = (counts[s.status.status] || 0) + 1; });

  filtered.sort((a, b) => {
    const ra = STATUS_META[a.status.status]?.rank ?? 0;
    const rb = STATUS_META[b.status.status]?.rank ?? 0;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });

  return {
    classId: classFilter || '*',
    schoolWide: true,
    generatedAt: isoNow(),
    counts,
    statusMeta: STATUS_META,
    students: filtered,
    totalStudents: students.length,
    classes: classIds.map((id) => ({ classId: id, className: classNames[id] || id }))
  };
}

async function getSchoolStudentAnalytics(studentId) {
  studentId = String(studentId || '').trim();
  if (!studentId) throw new Error('Student ID is required.');
  const { getStudent } = require('../studentRegistryService');
  const st = await getStudent(studentId);
  if (!st) throw new Error('Student not found.');
  const classId = String(st.classId || '').trim();
  if (!classId) throw new Error('Student has no class assignment.');
  const hit = await getStudentAnalytics(classId, studentId);
  const { getClassNameMap } = require('../teacherPortalService');
  const classNames = await getClassNameMap().catch(() => ({}));
  hit.className = classNames[classId] || classId;
  return hit;
}

function sourceLabel(source) {
  if (source === 'star_reading') return 'Star Reading';
  if (source === 'map') return 'NWEA MAP';
  return String(source || 'Other');
}

function summarizeBatches(testReports) {
  const map = new Map();
  (testReports || []).forEach((r) => {
    const batchId = r.importBatchId || (r.isMock ? 'mock_demo' : 'legacy_untagged');
    const label = r.isMock
      ? 'Demo / mock data'
      : (r.importedFrom
        ? ('Upload: ' + r.importedFrom)
        : (r.importBatchId ? 'Import ' + r.importBatchId : 'Legacy import'));
    if (!map.has(batchId)) {
      map.set(batchId, {
        batchId,
        label,
        importedFrom: r.importedFrom || '',
        extractionModel: r.extractionModel || '',
        isMock: !!r.isMock,
        createdAt: r.createdAt || '',
        reportCount: 0,
        includedCount: 0
      });
    }
    const b = map.get(batchId);
    b.reportCount += 1;
    if (r.included !== false) b.includedCount += 1;
    if (r.createdAt && (!b.createdAt || r.createdAt > b.createdAt)) b.createdAt = r.createdAt;
  });
  return Array.from(map.values()).sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  );
}

async function getAnalyticsRecords(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class is required.');
  await ensureAnalyticsSheets();
  const roster = await getClassRoster(classId).catch(() => []);
  const nameById = {};
  roster.forEach((s) => { nameById[s.studentId] = s.name; });

  const [testReports, dailyLogs, teacherNotes] = await Promise.all([
    listTestReports(classId),
    listDailyLogs(classId),
    listTeacherNotes(classId)
  ]);

  const enrichedReports = testReports.map((r) => Object.assign({}, r, {
    studentName: nameById[r.studentId] || r.studentId,
    sourceLabel: sourceLabel(r.source),
    kind: 'test_report'
  }));
  const enrichedLogs = dailyLogs.map((l) => Object.assign({}, l, {
    studentName: nameById[l.studentId] || l.studentId,
    kind: 'daily_log',
    sourceLabel: l.isMock ? 'Demo engagement log' : 'Engagement log'
  }));

  const enrichedNotes = teacherNotes.map((n) => Object.assign({}, n, {
    studentName: nameById[n.studentId] || n.studentId,
    kind: 'teacher_note',
    sourceLabel: (n.subject ? n.subject + ' · ' : '') + (n.noteType === 'diagnostic' ? 'Diagnostic' : 'Comment')
  }));

  return {
    classId,
    testReports: enrichedReports,
    dailyLogs: enrichedLogs,
    teacherNotes: enrichedNotes,
    batches: summarizeBatches(enrichedReports),
    counts: {
      testReports: enrichedReports.length,
      dailyLogs: enrichedLogs.length,
      teacherNotes: enrichedNotes.length,
      includedTestReports: enrichedReports.filter((r) => r.included !== false).length,
      includedTeacherNotes: enrichedNotes.filter((n) => n.includedInAnalytics !== false).length,
      mockTestReports: enrichedReports.filter((r) => r.isMock).length,
      mockDailyLogs: enrichedLogs.filter((l) => l.isMock).length
    }
  };
}

async function findTestReportRow(reportId) {
  reportId = String(reportId || '').trim();
  const rows = await getSheetRows(ANALYTICS_TEST_REPORTS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === reportId) return { rowIndex: i + 1, row: rows[i].slice() };
  }
  return null;
}

async function findDailyLogRow(logId) {
  logId = String(logId || '').trim();
  const rows = await getSheetRows(ANALYTICS_DAILY_LOGS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === logId) return { rowIndex: i + 1, row: rows[i].slice() };
  }
  return null;
}

function serializeTestRow(row) {
  while (row.length < 12) row.push('');
  return row.slice(0, 12);
}

async function updateTestReport(classId, reportId, patch) {
  classId = String(classId || '').trim();
  reportId = String(reportId || '').trim();
  const hit = await findTestReportRow(reportId);
  if (!hit) throw new Error('Assessment record not found.');
  if (String(hit.row[2] || '') !== classId) throw new Error('Assessment record not found.');
  const parsed = parseTestRow(hit.row);
  const rawMeta = Object.assign({}, parsed.rawMeta || {});
  if (patch && patch.included != null) rawMeta.included = !!patch.included;
  const row = serializeTestRow(hit.row.slice());
  row[10] = JSON.stringify(rawMeta);
  await updateRange(ANALYTICS_TEST_REPORTS_SHEET, `A${hit.rowIndex}:L${hit.rowIndex}`, [row]);
  return parseTestRow(row);
}

async function deleteTestReport(classId, reportId) {
  classId = String(classId || '').trim();
  reportId = String(reportId || '').trim();
  const hit = await findTestReportRow(reportId);
  if (!hit) throw new Error('Assessment record not found.');
  if (String(hit.row[2] || '') !== classId) throw new Error('Assessment record not found.');
  await deleteRows(ANALYTICS_TEST_REPORTS_SHEET, [hit.rowIndex]);
  return { deleted: true, reportId };
}

async function updateDailyLog(classId, logId, patch) {
  classId = String(classId || '').trim();
  logId = String(logId || '').trim();
  const hit = await findDailyLogRow(logId);
  if (!hit) throw new Error('Engagement log not found.');
  if (String(hit.row[2] || '') !== classId) throw new Error('Engagement log not found.');
  const parsed = parseLogRow(hit.row);
  let notes = String(hit.row[9] || '');
  const isMock = parsed.isMock;
  let body = notes.replace(/^__mock__\s*/, '').replace(/^__excluded__\s*/, '').trim();
  const included = patch && patch.included != null ? !!patch.included : parsed.included;
  notes = (included ? '' : '__excluded__ ') + (isMock ? '__mock__ ' : '') + body;
  notes = notes.trim();
  const row = hit.row.slice();
  while (row.length < 11) row.push('');
  row[9] = notes;
  await updateRange(ANALYTICS_DAILY_LOGS_SHEET, `A${hit.rowIndex}:K${hit.rowIndex}`, [row]);
  return parseLogRow(row);
}

async function deleteDailyLog(classId, logId) {
  classId = String(classId || '').trim();
  logId = String(logId || '').trim();
  const hit = await findDailyLogRow(logId);
  if (!hit) throw new Error('Engagement log not found.');
  if (String(hit.row[2] || '') !== classId) throw new Error('Engagement log not found.');
  await deleteRows(ANALYTICS_DAILY_LOGS_SHEET, [hit.rowIndex]);
  return { deleted: true, logId };
}

async function clearMockAnalyticsData(classId) {
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class is required.');
  await ensureAnalyticsSheets();

  const [testRows, logRows] = await Promise.all([
    getSheetRows(ANALYTICS_TEST_REPORTS_SHEET, { skipCache: true }),
    getSheetRows(ANALYTICS_DAILY_LOGS_SHEET, { skipCache: true })
  ]);

  const testDeletes = [];
  for (let i = 1; i < testRows.length; i++) {
    const parsed = parseTestRow(testRows[i]);
    if (!parsed || parsed.classId !== classId) continue;
    if (parsed.isMock) testDeletes.push(i + 1);
  }

  const logDeletes = [];
  for (let i = 1; i < logRows.length; i++) {
    const parsed = parseLogRow(logRows[i]);
    if (!parsed || parsed.classId !== classId) continue;
    if (parsed.isMock || !parsed.notes.includes('imported:')) {
      logDeletes.push(i + 1);
    }
  }

  if (testDeletes.length) await deleteRows(ANALYTICS_TEST_REPORTS_SHEET, testDeletes);
  if (logDeletes.length) await deleteRows(ANALYTICS_DAILY_LOGS_SHEET, logDeletes);

  return {
    deletedTestReports: testDeletes.length,
    deletedDailyLogs: logDeletes.length
  };
}

async function deleteImportBatch(classId, batchId) {
  classId = String(classId || '').trim();
  batchId = String(batchId || '').trim();
  if (!batchId) throw new Error('Import batch is required.');
  const rows = await getSheetRows(ANALYTICS_TEST_REPORTS_SHEET, { skipCache: true });
  const deletes = [];
  for (let i = 1; i < rows.length; i++) {
    const parsed = parseTestRow(rows[i]);
    if (!parsed || parsed.classId !== classId) continue;
    const match = parsed.importBatchId === batchId
      || (batchId === 'mock_demo' && parsed.isMock)
      || (batchId === 'legacy_untagged' && !parsed.importBatchId && !parsed.importedFrom);
    if (match) deletes.push(i + 1);
  }
  if (!deletes.length) throw new Error('No records found for this import batch.');
  await deleteRows(ANALYTICS_TEST_REPORTS_SHEET, deletes);
  return { deleted: deletes.length, batchId };
}

module.exports = {
  ensureAnalyticsSheets,
  listTestReports,
  listDailyLogs,
  listInterventions,
  saveTestReports,
  saveDailyLogs,
  importAssessments,
  saveIntervention,
  shareParentReport,
  listParentSharedReports,
  getClassAnalyticsDashboard,
  getStudentAnalytics,
  getSchoolAnalyticsDashboard,
  getSchoolStudentAnalytics,
  getAnalyticsRecords,
  updateTestReport,
  deleteTestReport,
  updateDailyLog,
  deleteDailyLog,
  clearMockAnalyticsData,
  deleteImportBatch,
  activeTestReports,
  activeDailyLogs,
  defaultActions,
  STATUS_META,
  todayStr
};
