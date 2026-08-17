'use strict';

/**
 * One-time copy of gradebook sheets → salt_morning Postgres.
 * Safe to re-run: INSERT ON CONFLICT DO NOTHING.
 */

const { isOpsDbEnabled, query, table } = require('./pool');
const { GRADE_WEIGHTS_SHEET, GRADE_ASSESSMENTS_SHEET, GRADES_DAILY_SHEET } = require('../config');
const { formatSheetDate } = require('../dateUtils');

const META_KEY = 'grades_backfilled';

function pgDate(val) {
  const s = formatSheetDate(val);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function isoTs(val) {
  if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString();
  if (val) {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

async function getMeta(key) {
  const r = await query(
    'SELECT value FROM ' + table('meta') + ' WHERE key = $1',
    [key]
  );
  return r.rows[0] ? String(r.rows[0].value || '') : '';
}

async function setMeta(key, value) {
  await query(
    'INSERT INTO ' + table('meta') +
      ' (key, value, updated_at) VALUES ($1, $2, now())' +
      ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [key, String(value)]
  );
}

async function insertIgnore(tableName, columns, rows) {
  if (!rows.length) return 0;
  const chunkSize = 150;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params = [];
    const values = chunk.map((row, idx) => {
      const start = idx * columns.length;
      row.forEach((v) => params.push(v));
      return '(' + columns.map((_, c) => '$' + (start + c + 1)).join(', ') + ')';
    });
    const r = await query(
      'INSERT INTO ' + table(tableName) + ' (' + columns.join(', ') + ') VALUES ' +
        values.join(', ') + ' ON CONFLICT DO NOTHING',
      params
    );
    inserted += r.rowCount || 0;
  }
  return inserted;
}

function dedupeMap(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (key) map.set(key, row);
  });
  return Array.from(map.values());
}

async function readSheetRows(sheetName) {
  try {
    const { getSheetRows } = require('../sheets');
    return await getSheetRows(sheetName, { skipCache: true });
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (/Unable to parse range|Unable to find|not found/i.test(msg)) {
      console.warn('[ops-db] sheet missing ' + sheetName + ':', msg);
      return [];
    }
    throw e;
  }
}

async function backfillGradesFromSheets() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };
  if ((await getMeta(META_KEY)) === '1') {
    return { ok: true, skipped: true };
  }

  const weightsRaw = await readSheetRows(GRADE_WEIGHTS_SHEET);
  const assessRaw = await readSheetRows(GRADE_ASSESSMENTS_SHEET);
  const entryRaw = await readSheetRows(GRADES_DAILY_SHEET);

  const weightRows = [];
  for (let i = 1; i < weightsRaw.length; i++) {
    const row = weightsRaw[i] || [];
    const weightId = String(row[0] || '').trim();
    const classId = String(row[1] || '').trim();
    const term = String(row[2] || '').trim();
    const subject = String(row[3] || '').trim();
    const categoryKey = String(row[4] || '').trim();
    if (!weightId || !classId || !term || !subject || !categoryKey) continue;
    weightRows.push([
      weightId,
      classId,
      term,
      subject,
      categoryKey,
      String(row[5] || ''),
      Number(row[6]) || 0,
      String(row[7] || 'average') || 'average',
      Number(row[8]) || 0,
      Number(row[9]) || 100,
      isoTs(row[10])
    ]);
  }

  const assessRows = [];
  for (let i = 1; i < assessRaw.length; i++) {
    const row = assessRaw[i] || [];
    const assessmentId = String(row[0] || '').trim();
    const date = pgDate(row[6]);
    if (!assessmentId || !date) continue;
    assessRows.push([
      assessmentId,
      String(row[1] || ''),
      String(row[2] || ''),
      String(row[3] || ''),
      String(row[4] || ''),
      String(row[5] || ''),
      date,
      Number(row[7]) || 100,
      String(row[8] || ''),
      isoTs(row[9])
    ]);
  }

  const entryRows = [];
  for (let i = 1; i < entryRaw.length; i++) {
    const row = entryRaw[i] || [];
    const recordId = String(row[0] || '').trim();
    const date = pgDate(row[4]);
    if (!recordId || !date) continue;
    entryRows.push([
      recordId,
      String(row[1] || ''),
      String(row[2] || ''),
      String(row[3] || ''),
      date,
      Number(row[5]) || 0,
      Number(row[6]) || 100,
      String(row[7] || '').trim() || 'daily_quiz',
      String(row[8] || ''),
      String(row[9] || ''),
      isoTs(row[10] || row[4]),
      String(row[11] || '').trim()
    ]);
  }

  const weights = dedupeMap(weightRows, (r) => r[1] + '|' + r[2] + '|' + r[3] + '|' + r[4]);
  const assessments = dedupeMap(assessRows, (r) => r[0]);
  const entries = dedupeMap(entryRows, (r) => {
    const assessmentId = r[11];
    if (assessmentId) return 'a:' + assessmentId + '|' + r[2];
    return 'd:' + r[1] + '|' + r[2] + '|' + r[3] + '|' + r[4] + '|' + r[7];
  });

  const copied = {
    weights: await insertIgnore(
      'grade_weights',
      [
        'weight_id', 'class_id', 'term', 'subject', 'category_key', 'label',
        'weight_percent', 'aggregation', 'sort_order', 'default_max_score', 'updated_at'
      ],
      weights
    ),
    assessments: await insertIgnore(
      'grade_assessments',
      [
        'assessment_id', 'class_id', 'term', 'subject', 'category_key', 'title',
        'assess_date', 'max_score', 'teacher_id', 'created_at'
      ],
      assessments
    ),
    entries: await insertIgnore(
      'grade_entries',
      [
        'record_id', 'class_id', 'student_id', 'subject', 'entry_date', 'score',
        'max_score', 'category_key', 'teacher_id', 'note', 'created_at', 'assessment_id'
      ],
      entries
    )
  };

  await setMeta(META_KEY, '1');
  return { ok: true, copied, scanned: { weights: weights.length, assessments: assessments.length, entries: entries.length } };
}

module.exports = { backfillGradesFromSheets };
