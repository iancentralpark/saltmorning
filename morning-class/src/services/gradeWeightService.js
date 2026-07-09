const { GRADE_WEIGHTS_SHEET, GRADE_TERMS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const { formatSheetDate } = require('../dateUtils');
const crypto = require('crypto');

const GRADE_CATEGORY_PRESETS = [
  { categoryKey: 'daily_quiz', label: 'Daily Quiz', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'assignment', label: 'Assignment', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'homework', label: 'Homework', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'midterm', label: 'Midterm Exam', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'final', label: 'Final Exam', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'performance', label: '수행평가', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'notebook', label: '노트체크', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'participation', label: 'Participation', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'project', label: 'Project', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'unit_test', label: 'Unit Test', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'listening', label: 'Listening', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'speaking', label: 'Speaking', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'vocabulary', label: 'Vocabulary Test', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'writing', label: 'Writing', aggregation: 'average', defaultMaxScore: 100 }
];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function parseWeightRow(row) {
  return {
    weightId: String(row[0]),
    classId: String(row[1]),
    term: String(row[2]),
    subject: String(row[3]),
    categoryKey: String(row[4]),
    label: String(row[5]),
    weightPercent: Number(row[6]) || 0,
    aggregation: String(row[7] || 'average'),
    sortOrder: Number(row[8]) || 0,
    defaultMaxScore: Number(row[9]) || 100,
    updatedAt: String(row[10] || '')
  };
}

function parseTermRow(row) {
  return {
    termId: String(row[0]),
    classId: String(row[1]),
    label: String(row[2]),
    startDate: formatSheetDate(row[3]),
    endDate: formatSheetDate(row[4])
  };
}

async function ensureGradeSheets() {
  const { getSheetsApi, getSheetIdMap } = require('../sheets');
  const sheets = await getSheetsApi();
  const { SPREADSHEET_ID } = require('../config');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const toCreate = [];
  if (!existing.has(GRADE_WEIGHTS_SHEET)) {
    toCreate.push({
      addSheet: { properties: { title: GRADE_WEIGHTS_SHEET } }
    });
  }
  if (!existing.has(GRADE_TERMS_SHEET)) {
    toCreate.push({
      addSheet: { properties: { title: GRADE_TERMS_SHEET } }
    });
  }
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: toCreate }
    });
    const { invalidateSheetIdCache } = require('../sheets');
    invalidateSheetIdCache();
  }

  const weights = await getSheetRows(GRADE_WEIGHTS_SHEET);
  if (!weights.length) {
    await appendRows(GRADE_WEIGHTS_SHEET, [[
      'WeightID', 'ClassID', 'Term', 'Subject', 'CategoryKey', 'Label',
      'WeightPercent', 'Aggregation', 'SortOrder', 'DefaultMaxScore', 'UpdatedAt'
    ]]);
  }
  const terms = await getSheetRows(GRADE_TERMS_SHEET);
  if (!terms.length) {
    await appendRows(GRADE_TERMS_SHEET, [[
      'TermID', 'ClassID', 'Label', 'StartDate', 'EndDate'
    ]]);
  }
}

async function listGradeTerms(classId) {
  await ensureGradeSheets();
  const rows = await getSheetRows(GRADE_TERMS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    out.push(parseTermRow(rows[i]));
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return out;
}

async function getGradeTerm(classId, termLabel) {
  const terms = await listGradeTerms(classId);
  return terms.find((t) => t.label === termLabel) || null;
}

async function getActiveTerm(classId) {
  const terms = await listGradeTerms(classId);
  if (!terms.length) return null;
  const { todayStr } = require('../dateUtils');
  const today = todayStr();
  const current = terms.find((t) => t.startDate <= today && today <= t.endDate);
  if (current) return current;
  const past = terms.filter((t) => t.startDate <= today);
  if (past.length) return past[past.length - 1];
  return terms[0];
}

async function listAllGradeTerms() {
  await ensureGradeSheets();
  const rows = await getSheetRows(GRADE_TERMS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    out.push(parseTermRow(rows[i]));
  }
  out.sort((a, b) => a.classId.localeCompare(b.classId) || a.startDate.localeCompare(b.startDate));
  return out;
}

async function saveGradeTerm(classId, label, startDate, endDate) {
  await ensureGradeSheets();
  classId = String(classId);
  label = String(label || '').trim();
  startDate = formatSheetDate(startDate);
  endDate = formatSheetDate(endDate);
  if (!label || !startDate || !endDate) throw new Error('Term label and dates are required.');
  if (endDate < startDate) throw new Error('End date must be on or after start date.');

  const data = await getSheetRows(GRADE_TERMS_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || String(data[i][2]) !== label) continue;
    await updateRange(GRADE_TERMS_SHEET, `D${i + 1}:E${i + 1}`, [[startDate, endDate]]);
    return { termId: String(data[i][0]), classId, label, startDate, endDate };
  }
  const termId = newId('gt');
  await appendRows(GRADE_TERMS_SHEET, [[termId, classId, label, startDate, endDate]]);
  return { termId, classId, label, startDate, endDate };
}

async function listGradeWeights(classId, term, subject) {
  await ensureGradeSheets();
  const rows = await getSheetRows(GRADE_WEIGHTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (term && String(rows[i][2]) !== String(term)) continue;
    if (subject && String(rows[i][3]) !== String(subject)) continue;
    out.push(parseWeightRow(rows[i]));
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return out;
}

async function saveGradeWeights(classId, term, subject, weights) {
  await ensureGradeSheets();
  classId = String(classId);
  term = String(term || '').trim();
  subject = String(subject || '').trim();
  if (!term || !subject) throw new Error('Term and subject are required.');
  if (!Array.isArray(weights) || !weights.length) {
    throw new Error('Add at least one grade category weight.');
  }

  const normalized = weights.map((w, idx) => {
    const preset = GRADE_CATEGORY_PRESETS.find((p) => p.categoryKey === w.categoryKey);
    const label = String(w.label || (preset && preset.label) || w.categoryKey).trim();
    const categoryKey = String(w.categoryKey || '').trim();
    const weightPercent = Number(w.weightPercent);
    if (!categoryKey || !label) throw new Error('Each category needs a key and label.');
    if (!Number.isFinite(weightPercent) || weightPercent <= 0 || weightPercent > 100) {
      throw new Error('Weight for ' + label + ' must be between 1 and 100.');
    }
    return {
      categoryKey,
      label,
      weightPercent,
      aggregation: String(w.aggregation || (preset && preset.aggregation) || 'average'),
      sortOrder: Number(w.sortOrder) || idx + 1,
      defaultMaxScore: Number(w.defaultMaxScore) || (preset && preset.defaultMaxScore) || 100
    };
  });

  const keys = new Set();
  for (const w of normalized) {
    if (keys.has(w.categoryKey)) throw new Error('Duplicate category: ' + w.label);
    keys.add(w.categoryKey);
  }

  const total = normalized.reduce((s, w) => s + w.weightPercent, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new Error('Weights must add up to 100% (currently ' + Math.round(total * 10) / 10 + '%).');
  }

  const data = await getSheetRows(GRADE_WEIGHTS_SHEET, { skipCache: true });
  const now = new Date().toISOString();
  const keepIds = new Set();
  const appends = [];

  for (const w of normalized) {
    let found = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) !== classId) continue;
      if (String(data[i][2]) !== term) continue;
      if (String(data[i][3]) !== subject) continue;
      if (String(data[i][4]) !== w.categoryKey) continue;
      found = i + 1;
      break;
    }
    const weightId = found > 0 ? String(data[found - 1][0]) : newId('gw');
    keepIds.add(weightId);
    const row = [
      weightId, classId, term, subject, w.categoryKey, w.label,
      w.weightPercent, w.aggregation, w.sortOrder, w.defaultMaxScore, now
    ];
    if (found > 0) {
      await updateRange(GRADE_WEIGHTS_SHEET, `A${found}:K${found}`, [row]);
    } else {
      appends.push(row);
    }
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    if (String(data[i][2]) !== term) continue;
    if (String(data[i][3]) !== subject) continue;
    const id = String(data[i][0]);
    if (!keepIds.has(id)) {
      await updateRange(GRADE_WEIGHTS_SHEET, `A${i + 1}:K${i + 1}`, [['', '', '', '', '', '', '', '', '', '', '']]);
    }
  }
  if (appends.length) await appendRows(GRADE_WEIGHTS_SHEET, appends);

  return { saved: normalized.length, weights: await listGradeWeights(classId, term, subject), totalPercent: total };
}

function getCategoryPresets() {
  return GRADE_CATEGORY_PRESETS;
}

module.exports = {
  GRADE_CATEGORY_PRESETS,
  ensureGradeSheets,
  listGradeTerms,
  listAllGradeTerms,
  getGradeTerm,
  getActiveTerm,
  saveGradeTerm,
  listGradeWeights,
  saveGradeWeights,
  getCategoryPresets,
  parseWeightRow
};
