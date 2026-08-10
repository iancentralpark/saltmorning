/**
 * Extract Star Reading / NWEA MAP scores from PDF or scanned images via Gemini.
 */
const { askGemini, isGeminiConfigured } = require('../geminiService');
const { parseAssessmentInput, normalizeSource } = require('./assessmentParser');

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif'
]);

function clean(s) {
  return String(s == null ? '' : s).trim();
}

function normalizeName(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonBlob(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI returned an empty extraction.');
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Could not parse AI extraction JSON.');
    return JSON.parse(m[0]);
  }
}

function matchStudent(row, roster) {
  const byId = clean(row.studentId);
  if (byId) {
    const hit = roster.find((s) => String(s.studentId) === byId);
    if (hit) return hit;
  }
  const name = normalizeName(row.studentName || row.name || '');
  if (!name) return null;

  let best = null;
  let bestScore = 0;
  roster.forEach((s) => {
    const n = normalizeName(s.name);
    if (!n) return;
    if (n === name) {
      best = s;
      bestScore = 100;
      return;
    }
    if (bestScore >= 100) return;
    if (n.includes(name) || name.includes(n)) {
      const score = Math.min(n.length, name.length) / Math.max(n.length, name.length);
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
      return;
    }
    const a = new Set(n.split(' '));
    const b = new Set(name.split(' '));
    let overlap = 0;
    a.forEach((tok) => { if (b.has(tok)) overlap += 1; });
    const score = overlap / Math.max(a.size, b.size);
    if (score >= 0.66 && score > bestScore) {
      best = s;
      bestScore = score;
    }
  });
  return bestScore >= 0.66 ? best : null;
}

function buildExtractPrompt(source, classId, roster) {
  const product = source === 'map'
    ? 'NWEA MAP Growth (Reading or related)'
    : (source === 'star_reading'
      ? 'Renaissance Star Reading'
      : 'Star Reading or NWEA MAP');
  return [
    'You are an expert assessment data extractor for an elementary/middle school.',
    'Read the attached PDF or scanned report image carefully (OCR as needed).',
    'Extract every student assessment result for ' + product + '.',
    'Match names to this class roster when possible. Roster JSON:',
    JSON.stringify(roster.map((s) => ({ studentId: s.studentId, name: s.name }))),
    '',
    'Return ONLY JSON with this shape:',
    JSON.stringify({
      source: source || 'star_reading',
      reports: [{
        studentId: 'from roster if known',
        studentName: 'as printed on report',
        testDate: 'YYYY-MM-DD',
        score: 0,
        percentile: 0,
        lexile: 'optional string',
        ritScore: 0,
        domainScores: [{ domain: 'vocabulary', label: 'Vocabulary', score: 0, percentile: 0 }],
        notes: 'optional'
      }],
      warnings: ['optional extraction notes']
    }, null, 2),
    '',
    'Rules:',
    '- classId for all rows is ' + classId,
    '- Prefer roster studentId when the printed name matches a roster student.',
    '- Include domain / skill scores when visible (vocabulary, comprehension, fluency, informational text, etc.).',
    '- If a field is missing, omit it or use null — do not invent scores.',
    '- If the document is a class summary with multiple students, return one report object per student.',
    '- Dates must be YYYY-MM-DD when possible.',
    '- source must be "star_reading" or "map".'
  ].join('\n');
}

/**
 * @param {Object} opts
 * @param {Buffer} opts.buffer
 * @param {string} opts.mimeType
 * @param {string} [opts.filename]
 * @param {string} opts.classId
 * @param {string} opts.source  star_reading | map
 * @param {Array<{studentId:string,name:string}>} opts.roster
 */
async function extractAssessmentsFromDocument(opts) {
  opts = opts || {};
  const buffer = opts.buffer;
  const mimeType = String(opts.mimeType || '').toLowerCase();
  const classId = String(opts.classId || '');
  const sourceHint = normalizeSource(opts.source || 'star_reading');
  const roster = Array.isArray(opts.roster) ? opts.roster : [];

  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('Upload a PDF or scan image of the report.');
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error('Only PDF or image scans are supported (PDF, JPG, PNG, WebP).');
  }
  if (!isGeminiConfigured()) {
    throw new Error('AI is required to read PDF/scan imports. Ask an admin to configure Gemini.');
  }
  if (!classId) throw new Error('Class is required.');

  const parts = [
    {
      inlineData: {
        mimeType,
        data: buffer.toString('base64')
      }
    },
    { text: buildExtractPrompt(sourceHint, classId, roster) }
  ];

  const ai = await askGemini(parts, {
    temperature: 0.1,
    maxOutputTokens: 8192,
    systemInstruction:
      'You extract structured assessment scores from school testing PDFs and scans. ' +
      'Never invent missing numeric scores. Respond with JSON only.'
  });

  const parsed = parseJsonBlob(ai.text || ai.answer);
  const source = normalizeSource(parsed.source || sourceHint);
  const rawReports = Array.isArray(parsed.reports)
    ? parsed.reports
    : (Array.isArray(parsed.rows) ? parsed.rows : []);

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  const unmatched = [];
  const normalized = [];

  rawReports.forEach((row) => {
    const hit = matchStudent(row, roster);
    if (!hit) {
      unmatched.push(clean(row.studentName || row.name || row.studentId) || 'Unknown student');
      return;
    }
    normalized.push(Object.assign({}, row, {
      studentId: hit.studentId,
      studentName: hit.name,
      classId,
      source: normalizeSource(row.source || source),
      testDate: row.testDate || row.date || row.assessment_date,
      score: row.score,
      percentile: row.percentile,
      lexile: row.lexile,
      ritScore: row.ritScore != null ? row.ritScore : row.rit,
      domainScores: row.domainScores || row.domains || []
    }));
  });

  const reports = parseAssessmentInput(normalized, { classId, source })
    .map((r) => Object.assign({}, r, {
      classId,
      source: sourceHint === 'other' ? r.source : sourceHint,
      rawMeta: Object.assign({}, r.rawMeta || {}, {
        importedFrom: opts.filename || 'upload',
        mimeType,
        extractionModel: ai.model
      })
    }));

  if (unmatched.length) {
    warnings.push('Could not match to class roster: ' + unmatched.join(', '));
  }
  if (!reports.length) {
    throw new Error(
      unmatched.length
        ? ('No roster matches. Unmatched names: ' + unmatched.join(', '))
        : 'No assessment scores could be read from this file.'
    );
  }

  return {
    reports,
    warnings,
    extracted: rawReports.length,
    matched: reports.length,
    unmatched,
    model: ai.model
  };
}

module.exports = {
  extractAssessmentsFromDocument,
  ALLOWED_MIME,
  matchStudent
};
