/**
 * Parse Renaissance Star Reading & NWEA MAP reports from structured JSON
 * (e.g. AI extraction) or legacy CSV text for internal/seed tools.
 */

function clean(s) {
  return String(s == null ? '' : s).trim();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  const s = clean(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return y + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] != null ? cols[i] : ''; });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; }
      else q = !q;
      continue;
    }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function pick(row, keys, opts) {
  opts = opts || {};
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h === k || h.replace(/\s+/g, '_') === k);
    if (hit && clean(row[hit]) !== '') return row[hit];
  }
  if (opts.loose === false) return '';
  for (const k of keys) {
    const loose = Object.keys(row).find((h) => h === k || h.split(/[_\s]/).includes(k));
    if (loose && clean(row[loose]) !== '') return row[loose];
  }
  return '';
}

function normalizeSource(raw) {
  const s = clean(raw).toLowerCase();
  if (s.includes('star') || s === 'sr') return 'star_reading';
  if (s.includes('map') || s.includes('nwea')) return 'map';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'other';
  return s || 'other';
}

function domainsFromRow(row, source) {
  const domains = [];
  const pairs = source === 'map'
    ? [
      ['reading_comprehension', ['reading', 'comprehension', 'lit_comp']],
      ['vocabulary', ['vocabulary', 'vocab', 'word_meaning']],
      ['critical_thinking', ['informational', 'literary', 'analysis']]
    ]
    : [
      ['vocabulary', ['vocabulary', 'vocab', 'word_knowledge']],
      ['reading_comprehension', ['comprehension', 'understanding']],
      ['fluency', ['fluency', 'oral_reading']]
    ];
  pairs.forEach(([domain, keys]) => {
    for (const k of keys) {
      const v = pick(row, [k, k + '_score', k + '_percentile', domain]);
      if (v !== '') {
        domains.push({ domain, label: domain.replace(/_/g, ' '), score: num(v), percentile: num(v) });
        break;
      }
    }
  });
  return domains;
}

function rowToReport(row, defaults) {
  const source = normalizeSource(
    pick(row, ['source', 'assessment', 'product', 'test_type', 'testtype'], { loose: false }) ||
    defaults.source ||
    'other'
  );
  const existingDomains = Array.isArray(row.domainScores)
    ? row.domainScores
    : (Array.isArray(row.domains) ? row.domains : null);
  return {
    studentId: clean(pick(row, ['studentid', 'student_id', 'student id', 'sid']) || row.studentId || defaults.studentId),
    classId: clean(pick(row, ['classid', 'class_id', 'class']) || row.classId || defaults.classId),
    source,
    testDate: parseDate(pick(row, ['testdate', 'test_date', 'date', 'assessment_date']) || row.testDate),
    score: num(pick(row, ['score', 'scaled_score', 'ss', 'ge']) || row.score),
    percentile: num(pick(row, ['percentile', 'pr', 'pct', 'percentile_rank']) || row.percentile),
    lexile: clean(pick(row, ['lexile', 'lexile_measure', 'zpd']) || row.lexile) || null,
    ritScore: num(pick(row, ['rit', 'rit_score', 'ritscore']) || row.ritScore),
    domainScores: existingDomains && existingDomains.length
      ? existingDomains.map((d) => ({
        domain: clean(d.domain || d.label || '').toLowerCase().replace(/\s+/g, '_') || 'domain',
        label: clean(d.label || d.domain || 'Domain'),
        score: num(d.score),
        percentile: num(d.percentile)
      }))
      : domainsFromRow(row, source),
    rawMeta: row
  };
}

/**
 * @param {string|Object|Object[]} input  JSON object/array or CSV string
 * @param {Object} [defaults]
 */
function parseAssessmentInput(input, defaults) {
  defaults = defaults || {};
  let rows = [];
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      rows = Array.isArray(parsed) ? parsed : (parsed.reports || parsed.rows || [parsed]);
    } else {
      rows = parseCsv(trimmed);
    }
  } else if (Array.isArray(input)) {
    rows = input;
  } else if (input && typeof input === 'object') {
    rows = input.reports || input.rows || [input];
  }

  return rows.map((r) => rowToReport(r, defaults)).filter((r) => r.studentId && r.testDate);
}

function parseStarReading(input, defaults) {
  return parseAssessmentInput(input, Object.assign({}, defaults, { source: 'star_reading' }));
}

function parseMap(input, defaults) {
  return parseAssessmentInput(input, Object.assign({}, defaults, { source: 'map' }));
}

module.exports = {
  parseAssessmentInput,
  parseStarReading,
  parseMap,
  parseCsv,
  normalizeSource
};
