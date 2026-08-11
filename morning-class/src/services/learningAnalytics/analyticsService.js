const crypto = require('crypto');
const {
  ANALYTICS_TEST_REPORTS_SHEET,
  ANALYTICS_DAILY_LOGS_SHEET,
  ANALYTICS_INTERVENTIONS_SHEET
} = require('../../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache
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
  'TeacherReport', 'ParentReport', 'RecommendedActionsJSON', 'CreatedAt', 'UpdatedAt'
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
    rawMeta: safeJson(row[10], {}),
    createdAt: String(row[11] || '')
  };
}

function parseLogRow(row) {
  if (!row || !row[0]) return null;
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
    notes: String(row[9] || ''),
    createdAt: String(row[10] || '')
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
    updatedAt: String(row[9] || '')
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

async function saveTestReports(reports) {
  await ensureAnalyticsSheets();
  if (!Array.isArray(reports) || !reports.length) throw new Error('No reports to save.');
  const now = isoNow();
  const rows = reports.map((r) => [
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
    JSON.stringify(r.rawMeta || {}),
    now
  ]);
  await appendRows(ANALYTICS_TEST_REPORTS_SHEET, rows);
  invalidateSheetRowsCache(ANALYTICS_TEST_REPORTS_SHEET);
  return { saved: rows.length };
}

async function saveDailyLogs(logs) {
  await ensureAnalyticsSheets();
  if (!Array.isArray(logs) || !logs.length) throw new Error('No logs to save.');
  const now = isoNow();
  const rows = logs.map((l) => [
    l.logId || newId('adl'),
    String(l.studentId),
    String(l.classId || ''),
    formatSheetDate(l.date),
    l.vocabScore == null ? '' : l.vocabScore,
    l.formativeScore == null ? '' : l.formativeScore,
    Number(l.homeworkSubmitted) || 0,
    Number(l.homeworkAssigned) || 0,
    l.participation == null ? '' : l.participation,
    String(l.notes || ''),
    now
  ]);
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
    const saved = await saveTestReports(extracted.reports);
    return Object.assign({}, saved, {
      matched: extracted.matched,
      extracted: extracted.extracted,
      unmatched: extracted.unmatched,
      warnings: extracted.warnings,
      model: extracted.model
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
    now
  ];
  if (found > 0) await updateRange(ANALYTICS_INTERVENTIONS_SHEET, `A${found}:J${found}`, [row]);
  else await appendRows(ANALYTICS_INTERVENTIONS_SHEET, [row]);
  invalidateSheetRowsCache(ANALYTICS_INTERVENTIONS_SHEET);
  return parseInterventionRow(row);
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

function buildStudentBundle(classId, student, allTests, allLogs, allInts, pendingHomework) {
  const studentId = student.studentId;
  const testReports = allTests.filter((t) => t.studentId === studentId);
  const dailyLogs = allLogs.filter((l) => l.studentId === studentId);
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
    latestIntervention: ints[0] || null
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
  const [testRows, logRows, intRows, pendingByStudent] = await Promise.all([
    getSheetRows(ANALYTICS_TEST_REPORTS_SHEET),
    getSheetRows(ANALYTICS_DAILY_LOGS_SHEET),
    getSheetRows(ANALYTICS_INTERVENTIONS_SHEET),
    getPendingHomeworkCounts(classId, { roster }).catch(() => ({}))
  ]);

  const tests = filterParsed(testRows, parseTestRow, classId)
    .sort((a, b) => a.testDate.localeCompare(b.testDate));
  const logs = filterParsed(logRows, parseLogRow, classId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const ints = filterParsed(intRows, parseInterventionRow, classId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

  const students = roster.map((st) =>
    buildStudentBundle(classId, st, tests, logs, ints, pendingByStudent[st.studentId] || 0)
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

  const [testRows, logRows, intRows, classNames, hwMaps] = await Promise.all([
    getSheetRows(ANALYTICS_TEST_REPORTS_SHEET),
    getSheetRows(ANALYTICS_DAILY_LOGS_SHEET),
    getSheetRows(ANALYTICS_INTERVENTIONS_SHEET),
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

  const students = roster.map((st) => {
    const bundle = buildStudentBundle(
      st.classId,
      st,
      tests,
      logs,
      ints,
      pendingByStudent[st.studentId] || 0
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

module.exports = {
  ensureAnalyticsSheets,
  listTestReports,
  listDailyLogs,
  listInterventions,
  saveTestReports,
  saveDailyLogs,
  importAssessments,
  saveIntervention,
  getClassAnalyticsDashboard,
  getStudentAnalytics,
  getSchoolAnalyticsDashboard,
  getSchoolStudentAnalytics,
  defaultActions,
  STATUS_META,
  todayStr
};
