const { GRADE_WEIGHTS_SHEET, GRADE_TERMS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange } = require('../sheets');
const { formatSheetDate } = require('../dateUtils');
const { query, table, withTransaction } = require('../db/pool');
const { ensureOpsDbStarted, isOpsGradesReady } = require('../db/boot');
const crypto = require('crypto');

const GRADE_CATEGORY_PRESETS = [
  { categoryKey: 'daily_quiz', label: 'Daily Quiz', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'assignment', label: 'Assignment', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'homework', label: 'Homework', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'midterm', label: 'Midterm Exam', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'final', label: 'Final Exam', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'participation', label: 'Participation', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'project', label: 'Project', aggregation: 'single', defaultMaxScore: 100 },
  { categoryKey: 'unit_test', label: 'Unit Test', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'listening', label: 'Listening', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'speaking', label: 'Speaking', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'vocabulary', label: 'Vocabulary Test', aggregation: 'average', defaultMaxScore: 100 },
  { categoryKey: 'writing', label: 'Writing', aggregation: 'average', defaultMaxScore: 100 }
];

function slugCategoryKey(label) {
  const base = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return 'custom_' + (base || crypto.randomBytes(3).toString('hex'));
}

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

function mapWeightRow(row) {
  return {
    weightId: String(row.weight_id),
    classId: String(row.class_id),
    term: String(row.term),
    subject: String(row.subject),
    categoryKey: String(row.category_key),
    label: String(row.label || ''),
    weightPercent: Number(row.weight_percent) || 0,
    aggregation: String(row.aggregation || 'average'),
    sortOrder: Number(row.sort_order) || 0,
    defaultMaxScore: Number(row.default_max_score) || 100,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : ''
  };
}

async function listGradeWeightsPg(classId, term, subject) {
  const params = [String(classId)];
  let sql = 'SELECT * FROM ' + table('grade_weights') + ' WHERE class_id = $1';
  if (term) {
    params.push(String(term));
    sql += ' AND term = $' + params.length;
  }
  if (subject) {
    params.push(String(subject));
    sql += ' AND subject = $' + params.length;
  }
  sql += ' ORDER BY sort_order ASC, label ASC';
  const r = await query(sql, params);
  return r.rows.map(mapWeightRow);
}

async function saveGradeWeightsPg(classId, term, subject, normalized) {
  await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT weight_id, category_key FROM ' + table('grade_weights') +
        ' WHERE class_id = $1 AND term = $2 AND subject = $3',
      [classId, term, subject]
    );
    const byKey = {};
    existing.rows.forEach((row) => {
      byKey[String(row.category_key)] = String(row.weight_id);
    });
    const keep = [];
    for (const w of normalized) {
      const weightId = byKey[w.categoryKey] || newId('gw');
      keep.push(w.categoryKey);
      await client.query(
        'INSERT INTO ' + table('grade_weights') +
          ' (weight_id, class_id, term, subject, category_key, label, weight_percent, aggregation, sort_order, default_max_score, updated_at)' +
          ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())' +
          ' ON CONFLICT (class_id, term, subject, category_key) DO UPDATE SET' +
          ' label = EXCLUDED.label, weight_percent = EXCLUDED.weight_percent,' +
          ' aggregation = EXCLUDED.aggregation, sort_order = EXCLUDED.sort_order,' +
          ' default_max_score = EXCLUDED.default_max_score, updated_at = now()',
        [
          weightId, classId, term, subject, w.categoryKey, w.label,
          w.weightPercent, w.aggregation, w.sortOrder, w.defaultMaxScore
        ]
      );
    }
    await client.query(
      'DELETE FROM ' + table('grade_weights') +
        ' WHERE class_id = $1 AND term = $2 AND subject = $3 AND NOT (category_key = ANY($4::text[]))',
      [classId, term, subject, keep]
    );
  });
}

async function ensureGradeSheets() {
  await ensureOpsDbStarted();
  if (isOpsGradesReady()) return;
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
  const { listTermsForClass } = require('./schoolSemesterService');
  return listTermsForClass(classId);
}

async function getGradeTerm(classId, termLabel) {
  const { getTermForClass } = require('./schoolSemesterService');
  return getTermForClass(classId, termLabel);
}

async function getActiveTerm(classId) {
  const { getActiveTermForClass } = require('./schoolSemesterService');
  return getActiveTermForClass(classId);
}

async function listAllGradeTerms() {
  const { listSchoolSemesters, asTerm } = require('./schoolSemesterService');
  const semesters = await listSchoolSemesters();
  return semesters
    .filter((s) => s.startDate && s.endDate)
    .map((s) => asTerm(s, '*'));
}

async function saveGradeTerm(classId, label, startDate, endDate) {
  // Legacy admin Terms API → school-wide semester slots
  const { getSchoolSemester, saveSchoolSemesters, listSchoolSemesters } = require('./schoolSemesterService');
  const matched = await getSchoolSemester(label);
  const key = matched ? matched.key : (/2|term2|2학기/i.test(String(label || '')) ? 'sem2' : 'sem1');
  const current = await listSchoolSemesters();
  const payload = {
    sem1: {
      startDate: key === 'sem1' ? startDate : (current[0] && current[0].startDate),
      endDate: key === 'sem1' ? endDate : (current[0] && current[0].endDate)
    },
    sem2: {
      startDate: key === 'sem2' ? startDate : (current[1] && current[1].startDate),
      endDate: key === 'sem2' ? endDate : (current[1] && current[1].endDate)
    }
  };
  const result = await saveSchoolSemesters(payload);
  const saved = result.semesters.find((s) => s.key === key);
  return {
    termId: key,
    classId: '*',
    label: saved ? saved.label : label,
    startDate: saved ? saved.startDate : startDate,
    endDate: saved ? saved.endDate : endDate
  };
}

async function listGradeWeights(classId, term, subject) {
  await ensureOpsDbStarted();
  if (isOpsGradesReady()) {
    return listGradeWeightsPg(classId, term, subject);
  }
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
    const label = String(w.label || w.categoryKey || '').trim();
    if (!label) throw new Error('Each category needs a name.');
    let categoryKey = String(w.categoryKey || '').trim();
    const preset = GRADE_CATEGORY_PRESETS.find((p) => p.categoryKey === categoryKey);
    // Custom categories: accept any key, or generate one from the label
    if (!preset) {
      if (!categoryKey || categoryKey === '__custom__' || categoryKey === 'custom') {
        categoryKey = slugCategoryKey(label);
      }
    } else {
      // Keep preset label unless teacher renamed it intentionally via custom flow
      // Prefer teacher-provided label when present
    }
    const weightPercent = Number(w.weightPercent);
    if (!Number.isFinite(weightPercent) || weightPercent <= 0 || weightPercent > 100) {
      throw new Error('Weight for ' + label + ' must be between 1 and 100.');
    }
    const aggregation = String(
      w.aggregation || (preset && preset.aggregation) || 'average'
    );
    if (aggregation !== 'average' && aggregation !== 'single') {
      throw new Error('Aggregation for ' + label + ' must be average or single.');
    }
    return {
      categoryKey: preset ? preset.categoryKey : categoryKey,
      label: preset && !String(w.label || '').trim() ? preset.label : label,
      weightPercent,
      aggregation,
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

  await ensureOpsDbStarted();
  if (isOpsGradesReady()) {
    await saveGradeWeightsPg(classId, term, subject, normalized);
    try {
      const { clearGradebookCache } = require('./gradeService');
      clearGradebookCache(classId, term, subject);
    } catch (e) {
      // ignore cache clear failures
    }
    return { saved: normalized.length, weights: await listGradeWeights(classId, term, subject), totalPercent: total };
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

  try {
    const { clearGradebookCache } = require('./gradeService');
    clearGradebookCache(classId, term, subject);
  } catch (e) {
    // ignore cache clear failures
  }

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
