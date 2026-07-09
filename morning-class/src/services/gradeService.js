const {
  GRADES_DAILY_SHEET,
  GRADE_ASSESSMENTS_SHEET,
  REPORT_CARD_ENTRIES_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, batchUpdateRanges } = require('../sheets');
const { formatSheetDate } = require('../dateUtils');
const crypto = require('crypto');
const {
  listGradeWeights,
  getGradeTerm,
  ensureGradeSheets
} = require('./gradeWeightService');

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function pctScore(score, maxScore) {
  const max = Number(maxScore) || 100;
  if (max <= 0) return 0;
  return Math.round((Number(score) / max) * 1000) / 10;
}

function parseGradeRow(row) {
  return {
    recordId: String(row[0]),
    classId: String(row[1]),
    studentId: String(row[2]),
    subject: String(row[3]),
    date: formatSheetDate(row[4]),
    score: Number(row[5]) || 0,
    maxScore: Number(row[6]) || 100,
    categoryKey: String(row[7] || 'daily_quiz').trim() || 'daily_quiz',
    teacherId: String(row[8] || ''),
    note: String(row[9] || ''),
    createdAt: String(row[10] || row[4] || ''),
    assessmentId: String(row[11] || '').trim()
  };
}

function parseAssessmentRow(row) {
  return {
    assessmentId: String(row[0]),
    classId: String(row[1]),
    term: String(row[2]),
    subject: String(row[3]),
    categoryKey: String(row[4]),
    title: String(row[5] || ''),
    date: formatSheetDate(row[6]),
    maxScore: Number(row[7]) || 100,
    teacherId: String(row[8] || ''),
    createdAt: String(row[9] || '')
  };
}

async function ensureAssessmentSheet() {
  await ensureSheet(GRADE_ASSESSMENTS_SHEET, [
    'AssessmentID', 'ClassID', 'Term', 'Subject', 'CategoryKey', 'Title', 'Date', 'MaxScore', 'TeacherID', 'CreatedAt'
  ]);
}

async function ensureGradesColumns() {
  await ensureGradeSheets();
  const data = await getSheetRows(GRADES_DAILY_SHEET);
  if (!data.length) return;
  const header = (data[0] || []).map((c) => String(c || '').trim());
  if (header[7] === 'GradeType') {
    await updateRange(GRADES_DAILY_SHEET, 'H1', [['CategoryKey']]);
  }
  if (!header[10]) {
    await updateRange(GRADES_DAILY_SHEET, 'K1', [['CreatedAt']]);
  }
  if (header[11] !== 'AssessmentID' && !header[11]) {
    await updateRange(GRADES_DAILY_SHEET, 'L1', [['AssessmentID']]);
  }
}

async function listGradeEntries(classId, options) {
  await ensureGradesColumns();
  const { term, subject, categoryKey, studentId, limit } = options || {};
  const termInfo = term ? await getGradeTerm(classId, term) : null;

  const rows = await getSheetRows(GRADES_DAILY_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    const entry = parseGradeRow(rows[i]);
    if (subject && entry.subject !== String(subject)) continue;
    if (categoryKey && entry.categoryKey !== String(categoryKey)) continue;
    if (studentId && entry.studentId !== String(studentId)) continue;
    if (termInfo) {
      if (entry.date < termInfo.startDate || entry.date > termInfo.endDate) continue;
    }
    entry.percent = pctScore(entry.score, entry.maxScore);
    out.push(entry);
  }

  out.sort((a, b) => {
    const ca = a.createdAt || a.date;
    const cb = b.createdAt || b.date;
    return cb.localeCompare(ca) || b.recordId.localeCompare(a.recordId);
  });

  if (limit) return out.slice(0, Number(limit));
  return out;
}

/** @deprecated */
async function listDailyGrades(classId, dateStr, subject) {
  return listGradeEntries(classId, { subject, categoryKey: null }).then((all) =>
    all.filter((e) => !dateStr || e.date === dateStr)
  );
}

function aggregateCategoryPercent(entries, aggregation) {
  if (!entries.length) return null;
  const sorted = entries.slice().sort((a, b) => {
    const ca = a.createdAt || a.date;
    const cb = b.createdAt || b.date;
    return cb.localeCompare(ca);
  });
  const percents = sorted.map((e) => pctScore(e.score, e.maxScore));
  if (aggregation === 'single' || aggregation === 'latest') {
    return percents[0];
  }
  if (aggregation === 'best') return Math.max(...percents);
  return Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10;
}

function computeStudentGrades(studentId, weights, entriesByCategory) {
  const categories = [];
  let weightedTotal = 0;
  let gradedWeight = 0;

  for (const w of weights) {
    const catEntries = (entriesByCategory[w.categoryKey] || []).filter((e) => e.studentId === studentId);
    const categoryPercent = aggregateCategoryPercent(catEntries, w.aggregation);
    const weightedPoints = categoryPercent == null ? null : Math.round(categoryPercent * w.weightPercent) / 100;
    if (categoryPercent != null) {
      weightedTotal += weightedPoints;
      gradedWeight += w.weightPercent;
    }
    categories.push({
      categoryKey: w.categoryKey,
      label: w.label,
      weightPercent: w.weightPercent,
      aggregation: w.aggregation,
      entryCount: catEntries.length,
      categoryPercent,
      weightedPoints,
      defaultMaxScore: w.defaultMaxScore
    });
  }

  return {
    studentId,
    weightedTotal: weights.length ? Math.round(weightedTotal * 10) / 10 : null,
    gradedWeightPercent: gradedWeight,
    categories
  };
}

async function getGradesDashboard(classId, term, subject, students) {
  const weights = await listGradeWeights(classId, term, subject);
  const termInfo = await getGradeTerm(classId, term);
  const allEntries = await listGradeEntries(classId, { term, subject });

  const entriesByCategory = {};
  for (const e of allEntries) {
    if (!entriesByCategory[e.categoryKey]) entriesByCategory[e.categoryKey] = [];
    entriesByCategory[e.categoryKey].push(e);
  }

  const standings = students.map((s) => {
    const computed = computeStudentGrades(s.studentId, weights, entriesByCategory);
    return {
      studentId: s.studentId,
      name: s.name,
      ...computed
    };
  });

  standings.sort((a, b) => {
    const av = a.weightedTotal == null ? -1 : a.weightedTotal;
    const bv = b.weightedTotal == null ? -1 : b.weightedTotal;
    return bv - av || a.name.localeCompare(b.name);
  });

  standings.forEach((s, i) => { s.rank = s.weightedTotal == null ? null : i + 1; });

  const weightTotal = weights.reduce((sum, w) => sum + w.weightPercent, 0);

  return {
    term,
    subject,
    termDates: termInfo,
    weights,
    weightTotal,
    standings,
    recentEntries: allEntries.slice(0, 80)
  };
}

async function saveGradeEntries(classId, term, subject, teacherId, dateStr, categoryKey, maxScoreDefault, entries) {
  await ensureGradesColumns();
  if (!Array.isArray(entries) || !entries.length) throw new Error('No grades to save.');
  classId = String(classId);
  subject = String(subject || '').trim();
  categoryKey = String(categoryKey || '').trim();
  dateStr = formatSheetDate(dateStr);
  if (!subject || !categoryKey) throw new Error('Subject and category are required.');

  const termInfo = term ? await getGradeTerm(classId, term) : null;
  if (termInfo && (dateStr < termInfo.startDate || dateStr > termInfo.endDate)) {
    throw new Error('Date is outside the term range (' + termInfo.startDate + ' – ' + termInfo.endDate + ').');
  }

  const data = await getSheetRows(GRADES_DAILY_SHEET);
  const now = new Date().toISOString();
  const appends = [];
  const updates = [];
  let saved = 0;

  for (const e of entries) {
    const studentId = String(e.studentId);
    const score = Number(e.score);
    if (e.score === '' || e.score == null || Number.isNaN(score)) continue;
    const maxScore = Number(e.maxScore) || Number(maxScoreDefault) || 100;

    let found = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== classId) continue;
      if (String(data[i][2]) !== studentId) continue;
      if (String(data[i][3]) !== subject) continue;
      if (formatSheetDate(data[i][4]) !== dateStr) continue;
      if (String(data[i][7]) !== categoryKey) continue;
      found = i + 1;
      break;
    }

    const row = [
      found > 0 ? String(data[found - 1][0]) : newId('gd'),
      classId,
      studentId,
      subject,
      dateStr,
      score,
      maxScore,
      categoryKey,
      teacherId,
      String(e.note || ''),
      found > 0 ? String(data[found - 1][10] || now) : now,
      String(e.assessmentId || (found > 0 ? data[found - 1][11] : '') || '')
    ];

    if (found > 0) updates.push({ row: found, values: row });
    else appends.push(row);
    saved++;
  }

  if (!saved) throw new Error('Enter at least one score.');

  for (const u of updates) {
    await updateRange(GRADES_DAILY_SHEET, `A${u.row}:L${u.row}`, [u.values]);
  }
  if (appends.length) await appendRows(GRADES_DAILY_SHEET, appends);

  return { saved };
}

/** @deprecated */
async function saveDailyGrades(classId, dateStr, subject, teacherId, entries) {
  return saveGradeEntries(
    classId,
    null,
    subject,
    teacherId,
    dateStr,
    'daily_quiz',
    100,
    entries
  );
}

async function syncReportCardFromGrades(classId, term, subject, teacherId, students) {
  const dashboard = await getGradesDashboard(classId, term, subject, students);
  if (!dashboard.weights.length) return { synced: 0 };

  const data = await getSheetRows(REPORT_CARD_ENTRIES_SHEET);
  const now = new Date().toISOString();
  const appends = [];
  let synced = 0;

  for (const st of dashboard.standings) {
    for (const cat of st.categories) {
      if (cat.categoryPercent == null) continue;
      const fieldKey = 'gw_' + cat.categoryKey;
      let found = -1;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) !== String(classId)) continue;
        if (String(data[i][2]) !== st.studentId) continue;
        if (String(data[i][3]) !== String(term)) continue;
        if (String(data[i][4]) !== String(subject)) continue;
        if (String(data[i][5]) !== fieldKey) continue;
        found = i + 1;
        break;
      }
      const row = [
        found > 0 ? String(data[found - 1][0]) : newId('rc'),
        classId,
        st.studentId,
        term,
        subject,
        fieldKey,
        cat.categoryPercent,
        cat.label + ' (' + cat.weightPercent + '%)',
        teacherId,
        now
      ];
      if (found > 0) {
        await updateRange(REPORT_CARD_ENTRIES_SHEET, `A${found}:J${found}`, [row]);
      } else {
        appends.push(row);
      }
      synced++;
    }

    if (st.weightedTotal != null) {
      const fieldKey = 'term_total';
      let found = -1;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) !== String(classId)) continue;
        if (String(data[i][2]) !== st.studentId) continue;
        if (String(data[i][3]) !== String(term)) continue;
        if (String(data[i][4]) !== String(subject)) continue;
        if (String(data[i][5]) !== fieldKey) continue;
        found = i + 1;
        break;
      }
      const row = [
        found > 0 ? String(data[found - 1][0]) : newId('rc'),
        classId,
        st.studentId,
        term,
        subject,
        fieldKey,
        st.weightedTotal,
        'Weighted term grade',
        teacherId,
        now
      ];
      if (found > 0) {
        await updateRange(REPORT_CARD_ENTRIES_SHEET, `A${found}:J${found}`, [row]);
      } else {
        appends.push(row);
      }
      synced++;
    }
  }

  if (appends.length) await appendRows(REPORT_CARD_ENTRIES_SHEET, appends);
  return { synced };
}

async function buildReportCardFromGrades(classId, term, subject, students) {
  const dashboard = await getGradesDashboard(classId, term, subject, students);
  return dashboard.standings.map((st) => ({
    studentId: st.studentId,
    name: st.name,
    weightedTotal: st.weightedTotal,
    gradedWeightPercent: st.gradedWeightPercent,
    categories: st.categories,
    weights: dashboard.weights
  }));
}

async function listAssessments(classId, term, subject) {
  await ensureAssessmentSheet();
  const rows = await getSheetRows(GRADE_ASSESSMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (String(rows[i][2]) !== String(term)) continue;
    if (String(rows[i][3]) !== String(subject)) continue;
    out.push(parseAssessmentRow(rows[i]));
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return out;
}

async function createAssessment(classId, term, subject, teacherId, payload) {
  await ensureAssessmentSheet();
  await ensureGradesColumns();
  classId = String(classId);
  term = String(term || '').trim();
  subject = String(subject || '').trim();
  const categoryKey = String(payload.categoryKey || '').trim();
  const title = String(payload.title || '').trim();
  const dateStr = formatSheetDate(payload.date);
  const maxScore = Number(payload.maxScore) || 100;
  if (!term || !subject || !categoryKey) {
    throw new Error('Term, subject, and category are required.');
  }

  const weights = await listGradeWeights(classId, term, subject);
  const weight = weights.find((w) => w.categoryKey === categoryKey);
  if (!weight) throw new Error('Choose a category from your grade weights.');

  const termInfo = await getGradeTerm(classId, term);
  if (termInfo && (dateStr < termInfo.startDate || dateStr > termInfo.endDate)) {
    throw new Error('Date is outside the term range.');
  }

  const now = new Date().toISOString();
  const assessmentId = newId('ga');
  const label = title || weight.label;
  await appendRows(GRADE_ASSESSMENTS_SHEET, [[
    assessmentId, classId, term, subject, categoryKey, label, dateStr, maxScore, teacherId, now
  ]]);

  clearGradebookCache(classId, term, subject);

  return {
    assessmentId,
    classId,
    term,
    subject,
    categoryKey,
    categoryLabel: weight.label,
    title: label,
    date: dateStr,
    maxScore,
    weightPercent: weight.weightPercent,
    createdAt: now
  };
}

function legacyColumnId(date, categoryKey, maxScore) {
  return 'legacy:' + date + ':' + categoryKey + ':' + maxScore;
}

const gradebookCache = new Map();

function gradebookCacheKey(classId, term, subject) {
  return String(classId) + '|' + String(term) + '|' + String(subject);
}

function clearGradebookCache(classId, term, subject) {
  if (classId && term && subject) {
    gradebookCache.delete(gradebookCacheKey(classId, term, subject));
    return;
  }
  gradebookCache.clear();
}

async function getGradebook(classId, term, subject, students) {
  const cacheKey = gradebookCacheKey(classId, term, subject);
  const hit = gradebookCache.get(cacheKey);
  if (hit && Date.now() < hit.expires) return hit.data;

  const weights = await listGradeWeights(classId, term, subject);
  const weightMap = {};
  weights.forEach((w) => { weightMap[w.categoryKey] = w; });

  let columns = (await listAssessments(classId, term, subject)).map((a) => ({
    assessmentId: a.assessmentId,
    categoryKey: a.categoryKey,
    categoryLabel: (weightMap[a.categoryKey] && weightMap[a.categoryKey].label) || a.categoryKey,
    title: a.title,
    date: a.date,
    maxScore: a.maxScore,
    weightPercent: weightMap[a.categoryKey] ? weightMap[a.categoryKey].weightPercent : null,
    legacy: false
  }));

  const allEntries = await listGradeEntries(classId, { term, subject });
  const scores = {};
  const legacyKeys = new Set(columns.map((c) => c.assessmentId));

  for (const e of allEntries) {
    let colId = e.assessmentId;
    if (!colId) {
      colId = legacyColumnId(e.date, e.categoryKey, e.maxScore);
      if (!legacyKeys.has(colId)) {
        legacyKeys.add(colId);
        const w = weightMap[e.categoryKey];
        columns.push({
          assessmentId: colId,
          categoryKey: e.categoryKey,
          categoryLabel: (w && w.label) || e.categoryKey,
          title: (w && w.label) || e.categoryKey,
          date: e.date,
          maxScore: e.maxScore,
          weightPercent: w ? w.weightPercent : null,
          legacy: true
        });
      }
    }
    if (!scores[colId]) scores[colId] = {};
    scores[colId][e.studentId] = {
      score: e.score,
      maxScore: e.maxScore,
      percent: e.percent,
      recordId: e.recordId
    };
  }

  columns.sort((a, b) => a.date.localeCompare(b.date) || a.assessmentId.localeCompare(b.assessmentId));

  const entriesByCategory = {};
  for (const e of allEntries) {
    if (!entriesByCategory[e.categoryKey]) entriesByCategory[e.categoryKey] = [];
    entriesByCategory[e.categoryKey].push(e);
  }

  const rows = students.map((s) => {
    const computed = computeStudentGrades(s.studentId, weights, entriesByCategory);
    const cells = {};
    columns.forEach((col) => {
      cells[col.assessmentId] = scores[col.assessmentId] && scores[col.assessmentId][s.studentId]
        ? scores[col.assessmentId][s.studentId]
        : null;
    });
    return {
      studentId: s.studentId,
      name: s.name,
      finalGrade: computed.weightedTotal,
      gradedWeightPercent: computed.gradedWeightPercent,
      cells
    };
  });

  const weightTotal = weights.reduce((sum, w) => sum + w.weightPercent, 0);
  const result = { term, subject, weights, weightTotal, columns, students: rows };
  gradebookCache.set(cacheKey, { data: result, expires: Date.now() + 45000 });
  return result;
}

async function saveAssessmentCell(assessmentId, studentId, score, teacherId, opts) {
  await ensureGradesColumns();
  await ensureAssessmentSheet();
  assessmentId = String(assessmentId);
  studentId = String(studentId);

  let assessment = null;
  if (assessmentId.startsWith('legacy:')) {
    const parts = assessmentId.split(':');
    assessment = {
      assessmentId,
      classId: '',
      subject: '',
      categoryKey: parts[2] || '',
      date: parts[1] || '',
      maxScore: Number(parts[3]) || 100,
      title: parts[2] || ''
    };
  } else {
    const rows = await getSheetRows(GRADE_ASSESSMENTS_SHEET);
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === assessmentId) {
        assessment = parseAssessmentRow(rows[i]);
        break;
      }
    }
  }
  if (!assessment) throw new Error('Assessment not found.');

  const data = await getSheetRows(GRADES_DAILY_SHEET);
  let foundRow = -1;
  let existingSubject = assessment.subject;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== studentId) continue;
    const rowAid = String(data[i][11] || '');
    if (rowAid === assessmentId) {
      foundRow = i + 1;
      existingSubject = String(data[i][3]);
      if (!assessment.classId) assessment.classId = String(data[i][1]);
      break;
    }
    if (assessmentId.startsWith('legacy:') && !rowAid) {
      const e = parseGradeRow(data[i]);
      if (legacyColumnId(e.date, e.categoryKey, e.maxScore) === assessmentId) {
        foundRow = i + 1;
        existingSubject = e.subject;
        assessment.classId = e.classId;
        assessment.subject = e.subject;
        break;
      }
    }
  }

  if (!assessment.classId && opts && opts.classId) {
    assessment.classId = String(opts.classId);
    assessment.subject = String(opts.subject || assessment.subject || '');
  }

  const empty = score === '' || score == null || Number.isNaN(Number(score));
  if (empty) {
    if (foundRow > 0) {
      await updateRange(GRADES_DAILY_SHEET, `A${foundRow}:L${foundRow}`, [['', '', '', '', '', '', '', '', '', '', '', '']]);
    }
    return { cleared: true };
  }

  if (!assessment.classId || !assessment.subject) {
    throw new Error('Could not resolve class for this score.');
  }

  const numScore = Number(score);
  const now = new Date().toISOString();
  const row = [
    foundRow > 0 ? String(data[foundRow - 1][0]) : newId('gd'),
    assessment.classId,
    studentId,
    existingSubject || assessment.subject,
    assessment.date,
    numScore,
    assessment.maxScore,
    assessment.categoryKey,
    teacherId,
    '',
    foundRow > 0 ? String(data[foundRow - 1][10] || now) : now,
    assessmentId
  ];

  if (foundRow > 0) {
    await updateRange(GRADES_DAILY_SHEET, `A${foundRow}:L${foundRow}`, [row]);
  } else {
    await appendRows(GRADES_DAILY_SHEET, [row]);
  }

  if (opts && opts.classId && opts.term && opts.subject) {
    clearGradebookCache(opts.classId, opts.term, opts.subject);
  } else {
    clearGradebookCache();
  }

  return {
    saved: true,
    percent: pctScore(numScore, assessment.maxScore)
  };
}

async function deleteAssessment(assessmentId, classId, term, subject) {
  await ensureGradesColumns();
  await ensureAssessmentSheet();
  assessmentId = String(assessmentId);
  classId = String(classId);
  if (!assessmentId) throw new Error('Column id is required.');

  const blankGrade = [['', '', '', '', '', '', '', '', '', '', '', '']];

  if (assessmentId.startsWith('legacy:')) {
    const data = await getSheetRows(GRADES_DAILY_SHEET);
    const updates = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== classId) continue;
      const e = parseGradeRow(data[i]);
      if (legacyColumnId(e.date, e.categoryKey, e.maxScore) !== assessmentId) continue;
      updates.push({ sheetName: GRADES_DAILY_SHEET, a1: 'A' + (i + 1) + ':L' + (i + 1), values: blankGrade });
    }
    if (updates.length) await batchUpdateRanges(updates);
    if (term && subject) clearGradebookCache(classId, term, subject);
    else clearGradebookCache();
    return { deleted: true };
  }

  const rows = await getSheetRows(GRADE_ASSESSMENTS_SHEET);
  let foundRow = -1;
  let rowTerm = term || '';
  let rowSubject = subject || '';
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== assessmentId) continue;
    if (String(rows[i][1]) !== classId) throw new Error('Column not found for this class.');
    foundRow = i + 1;
    rowTerm = String(rows[i][2] || '');
    rowSubject = String(rows[i][3] || '');
    break;
  }
  if (foundRow < 0) throw new Error('Column not found.');

  await updateRange(GRADE_ASSESSMENTS_SHEET, `A${foundRow}:J${foundRow}`, [['', '', '', '', '', '', '', '', '', '']]);

  const gradeData = await getSheetRows(GRADES_DAILY_SHEET);
  const updates = [];
  for (let i = 1; i < gradeData.length; i++) {
    if (String(gradeData[i][11] || '') !== assessmentId) continue;
    updates.push({ sheetName: GRADES_DAILY_SHEET, a1: 'A' + (i + 1) + ':L' + (i + 1), values: blankGrade });
  }
  if (updates.length) await batchUpdateRanges(updates);

  clearGradebookCache(classId, rowTerm, rowSubject);
  return { deleted: true };
}

module.exports = {
  listGradeEntries,
  listDailyGrades,
  saveGradeEntries,
  saveDailyGrades,
  getGradesDashboard,
  getGradebook,
  createAssessment,
  saveAssessmentCell,
  deleteAssessment,
  listAssessments,
  computeStudentGrades,
  syncReportCardFromGrades,
  buildReportCardFromGrades,
  aggregateCategoryPercent,
  pctScore,
  ensureGradesColumns,
  ensureAssessmentSheet
};
