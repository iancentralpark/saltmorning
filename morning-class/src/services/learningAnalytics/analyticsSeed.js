const { formatSheetDate, todayStr } = require('../../dateUtils');
const {
  ensureAnalyticsSheets,
  saveTestReports,
  saveDailyLogs,
  listTestReports
} = require('./analyticsService');
const { getClassRoster } = require('../teacherPortalService');
const { STUDENT_LIST_SHEET } = require('../../config');
const { getSheetRows } = require('../../sheets');

function daysAgo(n) {
  const d = new Date(todayStr() + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return formatSheetDate(d);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Seed realistic SR/MAP + engagement logs for a class.
 * Profiles: on_track, attention, warning, intervention across roster.
 */
async function seedLearningAnalyticsMock(classId) {
  classId = String(classId || 'C001');
  await ensureAnalyticsSheets();

  let roster = [];
  try {
    roster = await getClassRoster(classId);
  } catch (e) {
    roster = [];
  }
  if (!roster.length) {
    const rows = await getSheetRows(STUDENT_LIST_SHEET);
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][2]) !== classId) continue;
      if (String(rows[i][3]) !== 'Enrolled') continue;
      roster.push({ studentId: String(rows[i][0]), name: String(rows[i][1] || '') });
    }
  }
  if (!roster.length) {
    roster = [{ studentId: 'S001', name: 'Test Students' }];
  }

  // Avoid duplicating if already heavily seeded
  const existing = await listTestReports(classId);
  if (existing.length >= roster.length * 3) {
    return {
      ok: true,
      skipped: true,
      message: 'Analytics mock already present for this class.',
      classId,
      students: roster.length,
      existingReports: existing.length
    };
  }

  const profiles = ['on_track', 'attention', 'warning', 'intervention'];
  const tests = [];
  const logs = [];

  roster.forEach((st, idx) => {
    const profile = profiles[idx % profiles.length];
    // Force Test Students toward intervention demo if name matches
    const forced = /test student/i.test(st.name) ? 'intervention' : profile;
    const basePct = forced === 'on_track' ? 72
      : forced === 'attention' ? 55
        : forced === 'warning' ? 48
          : 52;
    const delta = forced === 'on_track' ? 8
      : forced === 'attention' ? 1
        : forced === 'warning' ? -10
          : -12;
    const dates = [daysAgo(180), daysAgo(100), daysAgo(20)];

    dates.forEach((date, i) => {
      const pct = clamp(basePct + Math.round((delta * i) / (dates.length - 1)) + (idx % 3), 5, 99);
      const rit = clamp(190 + Math.round(pct * 0.4) + i * (forced === 'on_track' ? 3 : -2), 160, 250);
      tests.push({
        studentId: st.studentId,
        classId,
        source: 'star_reading',
        testDate: date,
        score: clamp(400 + pct * 4, 200, 900),
        percentile: pct,
        lexile: (600 + pct * 5) + 'L',
        ritScore: null,
        domainScores: [
          { domain: 'vocabulary', label: 'Vocabulary', score: clamp(pct + (forced === 'intervention' ? -12 : 5), 10, 99) },
          { domain: 'reading_comprehension', label: 'Reading Comprehension', score: clamp(pct + (forced === 'warning' ? -8 : 2), 10, 99) },
          { domain: 'fluency', label: 'Fluency', score: clamp(pct - 3, 10, 99) }
        ]
      });
      tests.push({
        studentId: st.studentId,
        classId,
        source: 'map',
        testDate: date,
        score: null,
        percentile: clamp(pct - 2, 5, 99),
        lexile: null,
        ritScore: rit,
        domainScores: [
          { domain: 'reading_comprehension', label: 'Literary Text', score: clamp(pct, 10, 99) },
          { domain: 'vocabulary', label: 'Vocabulary Acquisition', score: clamp(pct + (forced === 'intervention' ? -15 : 0), 10, 99) },
          { domain: 'critical_thinking', label: 'Informational Text', score: clamp(pct - 5, 10, 99) }
        ]
      });
    });

    // Daily engagement ~ last 14 school-ish days
    for (let d = 14; d >= 1; d--) {
      const date = daysAgo(d);
      const hwAssigned = d % 2 === 0 ? 1 : 0;
      let hwSubmitted = hwAssigned;
      let vocab = clamp(78 + (idx % 5) - (d % 4), 40, 100);
      let formative = clamp(80 - (d % 6), 45, 100);
      let participation = clamp(75 + (idx % 7), 40, 100);

      if (forced === 'attention') {
        if (d <= 4) hwSubmitted = 0;
        vocab = clamp(vocab - 8, 35, 100);
      }
      if (forced === 'warning') {
        vocab = clamp(vocab - 5, 30, 100);
        formative = clamp(formative - 10, 30, 100);
      }
      if (forced === 'intervention') {
        if (hwAssigned) hwSubmitted = d % 3 === 0 ? 1 : 0;
        vocab = clamp(55 - (d % 5), 25, 75);
        participation = clamp(50 - (d % 4), 20, 70);
        formative = clamp(60 - (d % 6), 25, 80);
      }

      logs.push({
        studentId: st.studentId,
        classId,
        date,
        vocabScore: vocab,
        formativeScore: formative,
        homeworkSubmitted: hwSubmitted,
        homeworkAssigned: hwAssigned,
        participation,
        notes: forced === 'intervention' && d === 1 ? 'Flagged for intervention review' : ''
      });
    }
  });

  const t = await saveTestReports(tests, { mock: true, importBatchId: 'mock_demo' });
  const l = await saveDailyLogs(logs, { mock: true });
  return {
    ok: true,
    classId,
    students: roster.length,
    savedReports: t.saved,
    savedLogs: l.saved,
    profiles: roster.map((st, idx) => ({
      studentId: st.studentId,
      name: st.name,
      intendedProfile: /test student/i.test(st.name) ? 'intervention' : profiles[idx % profiles.length]
    }))
  };
}

module.exports = { seedLearningAnalyticsMock };
