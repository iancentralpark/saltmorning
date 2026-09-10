/**
 * Novel / Book Study — PDF parse, chunk planning, Gemini worksheet generation.
 * Jobs persist to ops Postgres (and local tmp cache) so closing the UI or a
 * Railway redeploy does not wipe teacher workbooks.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const pdfParse = require('pdf-parse');
const { askGemini, isGeminiConfigured } = require('./geminiService');
const { buildWorkbookDocx } = require('./novelStudyDocx');
const { isOpsDbEnabled, query, table } = require('../db/pool');

const TMP_ROOT = path.join(os.tmpdir(), 'salt-novel-study');
const JOBS_DIR = path.join(TMP_ROOT, 'jobs');
/** Keep finished workbooks available for reopen/download. */
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PART_DELAY_MS = 3000;
const MIN_CHARS_PAGE = 40;
const TARGET_MIN = 2;
const TARGET_MAX = 4;
const SPLIT_OVER = 5;
const MERGE_UNDER = 1;
/** Text-layer novel PDFs are often 30–80MB; keep headroom for full books. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** @type {Map<string, object>} */
const jobs = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const persistTimers = new Map();

const LEVELS = {
  elementary: {
    id: 'elementary',
    label: 'Elementary 3–5',
    prompt: 'Upper elementary (grades 3–5). Short clear stems. Avoid academic jargon.'
  },
  middle: {
    id: 'middle',
    label: 'Middle 6–8',
    prompt: 'Middle school (grades 6–8 / Lexile ~850L). Clear friendly stems.'
  },
  high: {
    id: 'high',
    label: 'High School',
    prompt: 'High school. More analytical stems, still accessible.'
  }
};

const MC_TYPES = [
  { id: 'factual', label: 'Factual Information (Right There)' },
  { id: 'inference', label: 'Inference & Clue Connection' },
  { id: 'vocab', label: 'Vocabulary in Context' },
  { id: 'negative', label: 'Negative Factual (NOT / EXCEPT)' },
  { id: 'craft', label: "Author's Craft / Rhetorical Purpose" },
  { id: 'paraphrase', label: 'Sentence Simplification / Paraphrasing' }
];

const CULMINATING_FICTION = [
  { id: 'character', label: 'Character' },
  { id: 'setting', label: 'Setting' },
  { id: 'theme', label: 'Theme' }
];

const CULMINATING_NONFICTION = [
  { id: 'main_argument', label: 'Main Argument' },
  { id: 'cause_effect', label: 'Cause & Effect' },
  { id: 'extension', label: 'Extension' }
];

function ensureTmp() {
  if (!fs.existsSync(TMP_ROOT)) fs.mkdirSync(TMP_ROOT, { recursive: true });
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobMetaPath(id) {
  return path.join(JOBS_DIR, String(id) + '.json');
}

function jobDocxPath(id) {
  return path.join(JOBS_DIR, String(id) + '.docx');
}

function hasDocxOnDisk(job) {
  try {
    return !!(job && job.id && fs.existsSync(jobDocxPath(job.id)));
  } catch (_) {
    return false;
  }
}

function jobHasDownload(job) {
  return !!(job && ((job.docxBuffer && job.docxBuffer.length) || hasDocxOnDisk(job)));
}

function ensureDocxBuffer(job) {
  if (job.docxBuffer && job.docxBuffer.length) return job.docxBuffer;
  if (hasDocxOnDisk(job)) {
    job.docxBuffer = fs.readFileSync(jobDocxPath(job.id));
    return job.docxBuffer;
  }
  return null;
}

async function ensureDocxBufferAsync(job) {
  const local = ensureDocxBuffer(job);
  if (local && local.length) return local;
  if (!isOpsDbEnabled() || !job || !job.id) return null;
  try {
    const r = await query(
      'SELECT docx FROM ' + table('novel_study_jobs') + ' WHERE id = $1 AND docx IS NOT NULL',
      [job.id]
    );
    const buf = r.rows[0] && r.rows[0].docx;
    if (buf && buf.length) {
      job.docxBuffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      try {
        ensureTmp();
        fs.writeFileSync(jobDocxPath(job.id), job.docxBuffer);
      } catch (_) { /* cache best-effort */ }
      return job.docxBuffer;
    }
  } catch (e) {
    console.warn('novelStudy docx db load failed', job.id, e.message);
  }
  return null;
}

function serializeJob(job) {
  const keepText = job.status !== 'done';
  return {
    id: job.id,
    teacherId: job.teacherId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error || null,
    meta: job.meta,
    options: job.options,
    pageCount: job.pageCount || 0,
    chunks: (job.chunks || []).map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      startPage: ch.startPage,
      endPage: ch.endPage,
      text: keepText ? String(ch.text || '') : ''
    })),
    parts: job.parts || [],
    culminating: job.culminating || null,
    googleDocsUrl: job.googleDocsUrl || null,
    hasDocx: jobHasDownload(job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function persistJobNow(job) {
  if (!job || !job.id) return;
  try {
    ensureTmp();
    if (job.docxBuffer && job.docxBuffer.length) {
      fs.writeFileSync(jobDocxPath(job.id), job.docxBuffer);
    }
    fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(serializeJob(job)));
  } catch (e) {
    console.warn('novelStudy disk persist failed', job.id, e.message);
  }
  void persistJobToDb(job);
}

async function persistJobToDb(job) {
  if (!job || !job.id || !isOpsDbEnabled()) return;
  try {
    const payload = serializeJob(job);
    const docx = job.docxBuffer && job.docxBuffer.length ? job.docxBuffer : null;
    await query(
      'INSERT INTO ' + table('novel_study_jobs') + ' (' +
        'id, teacher_id, status, progress, message, error, meta, options, page_count, ' +
        'chunks, parts, culminating, google_docs_url, has_docx, docx, created_at, updated_at' +
      ') VALUES (' +
        '$1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16::timestamptz,$17::timestamptz' +
      ') ON CONFLICT (id) DO UPDATE SET ' +
        'teacher_id = EXCLUDED.teacher_id, ' +
        'status = EXCLUDED.status, ' +
        'progress = EXCLUDED.progress, ' +
        'message = EXCLUDED.message, ' +
        'error = EXCLUDED.error, ' +
        'meta = EXCLUDED.meta, ' +
        'options = EXCLUDED.options, ' +
        'page_count = EXCLUDED.page_count, ' +
        'chunks = EXCLUDED.chunks, ' +
        'parts = EXCLUDED.parts, ' +
        'culminating = EXCLUDED.culminating, ' +
        'google_docs_url = EXCLUDED.google_docs_url, ' +
        'has_docx = EXCLUDED.has_docx OR ' + table('novel_study_jobs') + '.has_docx, ' +
        'docx = COALESCE(EXCLUDED.docx, ' + table('novel_study_jobs') + '.docx), ' +
        'updated_at = EXCLUDED.updated_at',
      [
        payload.id,
        payload.teacherId,
        payload.status,
        payload.progress,
        payload.message,
        payload.error,
        JSON.stringify(payload.meta || null),
        JSON.stringify(payload.options || null),
        payload.pageCount || 0,
        JSON.stringify(payload.chunks || []),
        JSON.stringify(payload.parts || []),
        JSON.stringify(payload.culminating || null),
        payload.googleDocsUrl || null,
        !!payload.hasDocx,
        docx,
        payload.createdAt || nowIso(),
        payload.updatedAt || nowIso()
      ]
    );
  } catch (e) {
    console.warn('novelStudy db persist failed', job.id, e.message);
  }
}

function schedulePersist(job, immediate) {
  if (!job || !job.id) return;
  if (immediate) {
    const t = persistTimers.get(job.id);
    if (t) clearTimeout(t);
    persistTimers.delete(job.id);
    persistJobNow(job);
    return;
  }
  if (persistTimers.has(job.id)) clearTimeout(persistTimers.get(job.id));
  persistTimers.set(
    job.id,
    setTimeout(() => {
      persistTimers.delete(job.id);
      persistJobNow(job);
    }, 500)
  );
}

function deletePersistedJob(jobId) {
  try {
    const meta = jobMetaPath(jobId);
    const docx = jobDocxPath(jobId);
    if (fs.existsSync(meta)) fs.unlinkSync(meta);
    if (fs.existsSync(docx)) fs.unlinkSync(docx);
  } catch (_) { /* ignore */ }
  if (isOpsDbEnabled()) {
    void query('DELETE FROM ' + table('novel_study_jobs') + ' WHERE id = $1', [String(jobId)]).catch(() => {});
  }
}

function hydrateJob(data) {
  const job = {
    id: data.id,
    teacherId: String(data.teacherId || ''),
    status: data.status || 'error',
    progress: Number(data.progress) || 0,
    message: data.message || '',
    error: data.error || null,
    meta: data.meta || null,
    options: data.options || {},
    pageCount: data.pageCount || 0,
    chunks: Array.isArray(data.chunks) ? data.chunks : [],
    parts: Array.isArray(data.parts) ? data.parts : [],
    culminating: data.culminating || null,
    googleDocsUrl: data.googleDocsUrl || null,
    pages: null,
    pdfPath: null,
    docxBuffer: null,
    listeners: [],
    createdAt: data.createdAt || nowIso(),
    updatedAt: data.updatedAt || nowIso()
  };
  if (data.hasDocx || hasDocxOnDisk(job)) {
    try {
      if (fs.existsSync(jobDocxPath(job.id))) {
        job.docxBuffer = fs.readFileSync(jobDocxPath(job.id));
      }
    } catch (_) { /* ignore */ }
  }
  // Generation loops die with the process — mark interrupted jobs as retryable.
  if (job.status === 'generating' || job.status === 'parsing' || job.status === 'planning') {
    job.status = 'error';
    job.error = 'Interrupted while the tool was closed or the server restarted. Open the job and click Generate again.';
    job.message = job.error;
  }
  return job;
}

function loadJobsFromDisk() {
  try {
    ensureTmp();
    const files = fs.readdirSync(JOBS_DIR).filter((f) => f.endsWith('.json'));
    files.forEach((file) => {
      try {
        const raw = fs.readFileSync(path.join(JOBS_DIR, file), 'utf8');
        const data = JSON.parse(raw);
        if (!data || !data.id) return;
        if (jobs.has(data.id)) return; // DB copy wins if already loaded
        const job = hydrateJob(data);
        jobs.set(job.id, job);
      } catch (_) { /* skip bad file */ }
    });
  } catch (_) { /* empty */ }
}

async function loadJobsFromDb() {
  if (!isOpsDbEnabled()) return 0;
  try {
    const cutoff = new Date(Date.now() - JOB_TTL_MS).toISOString();
    const r = await query(
      'SELECT id, teacher_id, status, progress, message, error, meta, options, page_count, ' +
        'chunks, parts, culminating, google_docs_url, has_docx, ' +
        'created_at, updated_at ' +
      'FROM ' + table('novel_study_jobs') +
      ' WHERE updated_at >= $1::timestamptz',
      [cutoff]
    );
    let n = 0;
    (r.rows || []).forEach((row) => {
      const data = {
        id: row.id,
        teacherId: row.teacher_id,
        status: row.status,
        progress: row.progress,
        message: row.message,
        error: row.error,
        meta: row.meta,
        options: row.options,
        pageCount: row.page_count,
        chunks: row.chunks || [],
        parts: row.parts || [],
        culminating: row.culminating,
        googleDocsUrl: row.google_docs_url,
        hasDocx: !!row.has_docx,
        createdAt: row.created_at && row.created_at.toISOString
          ? row.created_at.toISOString()
          : row.created_at,
        updatedAt: row.updated_at && row.updated_at.toISOString
          ? row.updated_at.toISOString()
          : row.updated_at
      };
      const job = hydrateJob(data);
      jobs.set(job.id, job);
      n += 1;
    });
    return n;
  } catch (e) {
    console.warn('novelStudy db load failed', e.message);
    return 0;
  }
}

function newId(prefix) {
  return (prefix || 'ns') + '_' + crypto.randomBytes(6).toString('hex');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function extractJson(text) {
  let raw = String(text || '').trim();
  if (!raw) return null;

  function tryParse(s) {
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  let parsed = tryParse(raw);
  if (parsed) return parsed;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    parsed = tryParse(fenced[1].trim());
    if (parsed) return parsed;
    raw = fenced[1].trim();
  }

  const a = raw.indexOf('{');
  if (a < 0) return null;
  let slice = raw.slice(a);
  parsed = tryParse(slice);
  if (parsed) return parsed;

  // Truncated / messy model output: trim to last complete-looking brace region and close opens.
  const b = slice.lastIndexOf('}');
  if (b > 0) {
    parsed = tryParse(slice.slice(0, b + 1));
    if (parsed) return parsed;
  }

  let repaired = slice
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u0000-\u001f]/g, ' ');
  // Close dangling strings/braces roughly.
  let inStr = false;
  let esc = false;
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < repaired.length; i += 1) {
    const ch = repaired[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') braces += 1;
    else if (ch === '}') braces = Math.max(0, braces - 1);
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets = Math.max(0, brackets - 1);
  }
  if (inStr) repaired += '"';
  while (brackets > 0) { repaired += ']'; brackets -= 1; }
  while (braces > 0) { repaired += '}'; braces -= 1; }
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  return tryParse(repaired);
}

function pickSnippetWords(text, count) {
  const stop = new Set([
    'about', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'where',
    'while', 'would', 'could', 'should', 'because', 'people', 'through', 'other',
    'being', 'before', 'between', 'under', 'over', 'into', 'from', 'with', 'that',
    'this', 'have', 'been', 'were', 'when', 'what', 'your', 'they', 'them'
  ]);
  const seen = new Set();
  const out = [];
  const words = String(text || '').match(/\b[A-Za-z][A-Za-z'-]{4,}\b/g) || [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (stop.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= count) break;
  }
  return out;
}

function stubPartWorksheet(chunk, options) {
  const text = String(chunk.text || '');
  const quote = text.replace(/\s+/g, ' ').trim().slice(0, 120);
  const vocabWanted = Math.max(0, Number(options.vocabCount) || 0);
  const words = pickSnippetWords(text, Math.max(3, vocabWanted || 3));
  const vocab = [];
  for (let i = 0; i < vocabWanted; i += 1) {
    const word = words[i] || ('word' + (i + 1));
    vocab.push({
      word,
      partOfSpeech: 'noun',
      definition: 'A word used in this section of the text.',
      exampleFromText: quote,
      evidenceQuote: quote
    });
  }
  const mc = [];
  for (let i = 0; i < (options.mcCount || 3); i += 1) {
    mc.push({
      type: 'factual',
      question: 'According to this section (pages ' + chunk.startPage + '–' + chunk.endPage +
        '), which idea is supported by the text?',
      choices: [
        'A detail supported by the passage',
        'An idea not mentioned in the passage',
        'A contradiction of the passage',
        'A claim with no textual evidence'
      ],
      answer: 'A',
      evidenceQuote: quote
    });
  }
  const shortAnswer = [];
  for (let i = 0; i < (options.shortCount || 1); i += 1) {
    shortAnswer.push({
      question: 'Using evidence from this section, explain one important idea the author presents.',
      sampleAnswer: 'Student answers will vary; cite a detail from the passage.',
      evidenceQuote: quote
    });
  }
  const reflection = [];
  for (let i = 0; i < (options.reflectionCount || 1); i += 1) {
    reflection.push({
      question: 'What connection can you make between this section and something you already know?',
      sampleAnswer: 'Student reflection.',
      evidenceQuote: quote
    });
  }
  return {
    partNum: chunk.partNum,
    unitTitle: chunk.unitTitle,
    startPage: chunk.startPage,
    endPage: chunk.endPage,
    vocab,
    multipleChoice: mc,
    shortAnswer,
    reflection,
    groundingScore: 0,
    stubbed: true
  };
}

function httpError(message, status, code) {
  const err = new Error(message);
  err.status = status || 400;
  if (code) err.code = code;
  return err;
}

function toPublicJob(job) {
  return {
    id: job.id,
    teacherId: job.teacherId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error || null,
    meta: job.meta,
    options: job.options,
    pageCount: job.pageCount || 0,
    chunks: (job.chunks || []).map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      startPage: ch.startPage,
      endPage: ch.endPage,
      charCount: String(ch.text || '').length
    })),
    partsDone: (job.parts || []).length,
    partsTotal: (job.chunks || []).length,
    downloadReady: jobHasDownload(job),
    googleDocsUrl: job.googleDocsUrl || null,
    pageOverflowRisk: !!(job.options && job.options.pageOverflowRisk),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function touch(job, patch) {
  Object.assign(job, patch || {}, { updatedAt: nowIso() });
  jobs.set(job.id, job);
  const immediate = job.status === 'done' || job.status === 'error' || job.status === 'ready';
  schedulePersist(job, immediate);
  return job;
}

function getJob(jobId, teacherId) {
  const job = jobs.get(String(jobId || ''));
  if (!job) throw httpError('Job not found or expired.', 404);
  if (teacherId && job.teacherId !== String(teacherId)) {
    throw httpError('You do not have access to this job.', 403);
  }
  return job;
}

function listJobsForTeacher(teacherId, limit) {
  const tid = String(teacherId || '');
  const max = Math.max(1, Math.min(50, Number(limit) || 30));
  return Array.from(jobs.values())
    .filter((j) => String(j.teacherId || '') === tid)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, max)
    .map((j) => toPublicJob(j));
}

function cleanupJobFiles(job) {
  try {
    if (job && job.pdfPath && fs.existsSync(job.pdfPath)) fs.unlinkSync(job.pdfPath);
  } catch (_) { /* ignore */ }
  if (job) job.pdfPath = null;
}

function purgeExpired() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const t = Date.parse(job.updatedAt || job.createdAt || 0) || 0;
    if (t < cutoff) {
      cleanupJobFiles(job);
      deletePersistedJob(id);
      jobs.delete(id);
    }
  }
  if (isOpsDbEnabled()) {
    void query(
      'DELETE FROM ' + table('novel_study_jobs') + ' WHERE updated_at < $1::timestamptz',
      [new Date(cutoff).toISOString()]
    ).catch(() => {});
  }
}
setInterval(purgeExpired, 15 * 60 * 1000).unref?.();

function normalizeOptions(body) {
  const level = String((body && body.level) || 'middle').toLowerCase();
  const genre = String((body && body.genre) || 'auto').toLowerCase();
  // vocabCount 0 = skip vocabulary entirely (master list + section A)
  const vocabRaw = body && body.vocabCount;
  const vocabCount = Math.max(0, Math.min(6,
    vocabRaw === 0 || vocabRaw === '0' ? 0 : (Number(vocabRaw) || 3)
  ));
  const mcCount = Math.max(1, Math.min(6, Number(body && body.mcCount) || 3));
  const shortCount = Math.max(0, Math.min(3, Number(body && body.shortCount) || 1));
  const reflectionCount = Math.max(0, Math.min(2, Number(body && body.reflectionCount) || 1));
  let mcTypes = Array.isArray(body && body.mcTypes)
    ? body.mcTypes.map(String)
    : MC_TYPES.map((t) => t.id);
  mcTypes = mcTypes.filter((id) => MC_TYPES.some((t) => t.id === id));
  if (!mcTypes.length) mcTypes = ['factual', 'inference', 'vocab'];
  return {
    level: LEVELS[level] ? level : 'middle',
    genre: ['auto', 'fiction', 'nonfiction'].includes(genre) ? genre : 'auto',
    vocabCount,
    mcCount,
    shortCount,
    reflectionCount,
    mcTypes,
    pageOverflowRisk: vocabCount > 3 || mcCount > 3 || shortCount > 1 || reflectionCount > 1
  };
}

function listMcTypes() {
  return MC_TYPES.slice();
}

function listLevels() {
  return Object.values(LEVELS).map((l) => ({ id: l.id, label: l.label }));
}

async function extractPages(pdfBuffer) {
  const pages = [];
  const data = await pdfParse(pdfBuffer, {
    pagerender(pageData) {
      return pageData.getTextContent().then((tc) => {
        const text = (tc.items || [])
          .map((it) => it.str || '')
          .join(' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\s*\n\s*/g, '\n')
          .trim();
        pages.push({ pageNum: pages.length + 1, text });
        return text;
      });
    }
  });

  if (!pages.length) {
    const full = String(data.text || '').trim();
    if (!full) {
      throw httpError(
        'This PDF has no extractable text. Please upload a text-layer PDF (not a scan).',
        400
      );
    }
    const parts = full.split(/\f/);
    if (parts.length > 1) {
      parts.forEach((t, i) => pages.push({ pageNum: i + 1, text: String(t || '').trim() }));
    } else {
      const size = 3000;
      for (let i = 0, n = 1; i < full.length; i += size, n += 1) {
        pages.push({ pageNum: n, text: full.slice(i, i + size) });
      }
    }
  }

  const usable = pages.filter(
    (p) => String(p.text || '').replace(/\s+/g, '').length >= MIN_CHARS_PAGE
  );
  if (!usable.length) {
    throw httpError(
      'This PDF has no extractable text. Please upload a text-layer PDF (not a scan).',
      400
    );
  }
  return { pageCount: pages.length, pages };
}

function normalizeLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pageLines(pageText) {
  return String(pageText || '')
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Lines that repeat across many pages are usually running headers/footers. */
function collectRunningHeaders(pages) {
  const counts = new Map();
  (pages || []).forEach((p) => {
    const lines = pageLines(p.text);
    const edge = lines.slice(0, 4).concat(lines.slice(-3));
    const seen = new Set();
    edge.forEach((line) => {
      if (line.length < 4 || line.length > 90) return;
      const key = normalizeLine(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  const pageCount = Math.max(1, (pages || []).length);
  const threshold = Math.max(3, Math.ceil(pageCount * 0.12));
  const banned = new Set();
  for (const [key, n] of counts) {
    if (n >= threshold) banned.add(key);
  }
  return banned;
}

function isJunkHeading(line, banned) {
  const raw = String(line || '').trim();
  const key = normalizeLine(raw);
  if (!raw || !key) return true;
  if (banned && banned.has(key)) return true;
  if (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(raw)) return true;
  if (/z-?library|z-?lib|1lib\.|pdfdrive|downloaded from|www\.|https?:/i.test(raw)) return true;
  if (/^world map of history$/i.test(raw)) return true;
  if (/copyright|all rights reserved|isbn\b/i.test(raw)) return true;
  return false;
}

function guessHeading(pageText, banned) {
  const lines = pageLines(pageText);
  const candidates = [];
  for (const line of lines.slice(0, 10)) {
    if (line.length < 4 || line.length > 90) continue;
    if (isJunkHeading(line, banned)) continue;
    if (/^(chapter|part|unit|section|prologue|epilogue|contents|introduction)\b/i.test(line)) {
      return line;
    }
    // Title Case / short display heading — avoid ALL-CAPS running headers.
    const words = line.split(/\s+/);
    const titleCase = words.length >= 2 && words.length <= 12
      && words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length * 0.5)
      && !/[.!?]$/.test(line);
    if (titleCase) candidates.push(line);
    // ALL CAPS only if short and not banned (true chapter titles sometimes shout).
    if (
      /^[A-Z][A-Z0-9 ,.'’:\-]{3,50}$/.test(line)
      && !/[.!?]$/.test(line)
      && words.length <= 8
    ) {
      candidates.push(line);
    }
  }
  return candidates[0] || '';
}

function firstContentSnippet(text, banned) {
  const lines = pageLines(text);
  for (const line of lines) {
    if (line.length < 12 || line.length > 90) continue;
    if (isJunkHeading(line, banned)) continue;
    if (/^(chapter|part|unit|section)\b/i.test(line)) return line;
    // Prefer a sentence-like content line over a header.
    if (/[a-z]/.test(line) && /[A-Za-z]/.test(line)) {
      return line.replace(/\s+/g, ' ').slice(0, 72);
    }
  }
  return '';
}

function cleanBookTitle(raw, fallback) {
  let t = String(raw || fallback || 'Untitled Book').trim();
  t = t.replace(/\((?:z-?library|z-?lib|1lib)[^)]*\)/gi, '');
  t = t.replace(/\b(?:z-?library\.sk|1lib\.sk|z-lib\.sk)\b/gi, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/[_\-]+$/g, '').trim();
  // "Title (Author etc.)" → keep title; author handled separately when possible.
  return t.slice(0, 160) || 'Untitled Book';
}

function planChunksHeuristic(pages) {
  const banned = collectRunningHeaders(pages);
  const raw = [];
  let cur = null;
  pages.forEach((p) => {
    const heading = guessHeading(p.text, banned);
    const startNew = heading && (!cur || heading !== cur.unitTitle);
    if (!cur || startNew) {
      if (cur) raw.push(cur);
      cur = {
        unitTitle: heading || '',
        startPage: p.pageNum,
        endPage: p.pageNum,
        pages: [p]
      };
    } else {
      cur.endPage = p.pageNum;
      cur.pages.push(p);
    }
  });
  if (cur) raw.push(cur);

  const merged = [];
  for (const sec of raw) {
    const span = sec.endPage - sec.startPage + 1;
    if (merged.length && (span <= MERGE_UNDER || !sec.unitTitle)) {
      const prev = merged[merged.length - 1];
      prev.endPage = sec.endPage;
      prev.pages = prev.pages.concat(sec.pages);
      if (sec.unitTitle && sec.unitTitle !== prev.unitTitle && prev.unitTitle) {
        // Keep first real heading; don't append running junk.
        if (!isJunkHeading(sec.unitTitle, banned)) {
          prev.unitTitle = prev.unitTitle; // no-op keep
        }
      } else if (!prev.unitTitle && sec.unitTitle) {
        prev.unitTitle = sec.unitTitle;
      }
    } else {
      merged.push({
        unitTitle: sec.unitTitle,
        startPage: sec.startPage,
        endPage: sec.endPage,
        pages: sec.pages.slice()
      });
    }
  }

  const split = [];
  for (const sec of merged) {
    const span = sec.endPage - sec.startPage + 1;
    if (span <= SPLIT_OVER) {
      split.push(sec);
      continue;
    }
    for (let i = 0; i < sec.pages.length; i += TARGET_MAX) {
      const slice = sec.pages.slice(i, i + TARGET_MAX);
      if (!slice.length) continue;
      split.push({
        unitTitle: sec.unitTitle || '',
        startPage: slice[0].pageNum,
        endPage: slice[slice.length - 1].pageNum,
        pages: slice
      });
    }
  }

  const finalSecs = [];
  for (let i = 0; i < split.length; i += 1) {
    const sec = split[i];
    const span = sec.endPage - sec.startPage + 1;
    if (span < TARGET_MIN && i + 1 < split.length) {
      const next = split[i + 1];
      if (next.endPage - sec.startPage + 1 <= TARGET_MAX + 1) {
        finalSecs.push({
          unitTitle: sec.unitTitle || next.unitTitle || '',
          startPage: sec.startPage,
          endPage: next.endPage,
          pages: sec.pages.concat(next.pages)
        });
        i += 1;
        continue;
      }
    }
    finalSecs.push(sec);
  }

  return finalSecs.map((sec, idx) => {
    const text = sec.pages.map((p) => p.text).join('\n\n').trim();
    let title = String(sec.unitTitle || '').trim();
    if (!title || isJunkHeading(title, banned)) {
      const snip = firstContentSnippet(text, banned);
      title = snip
        ? ('pp. ' + sec.startPage + '–' + sec.endPage + ': ' + snip)
        : ('Pages ' + sec.startPage + '–' + sec.endPage);
    } else if (title.length > 72) {
      title = title.slice(0, 72).trim() + '…';
    }
    return {
      partNum: idx + 1,
      unitTitle: title,
      startPage: sec.startPage,
      endPage: sec.endPage,
      text
    };
  });
}

async function planChunksWithGemini(pages, options) {
  const banned = collectRunningHeaders(pages);
  const sample = pages.slice(0, 14).map((p) => ({
    page: p.pageNum,
    preview: String(p.text || '').slice(0, 420)
  }));
  const headings = [];
  pages.forEach((p) => {
    const h = guessHeading(p.text, banned);
    if (h) headings.push({ page: p.pageNum, heading: h });
  });
  const level = LEVELS[options.level] || LEVELS.middle;

  const prompt = [
    'Plan a Novel/Book Study workbook for English class.',
    'Return JSON ONLY:',
    '{ "title": string, "author": string, "genre": "fiction"|"nonfiction",',
    '  "chunks": [{ "part_num": number, "unit_title": string, "start_page": number, "end_page": number }] }',
    'Rules:',
    '- Prefer real chapter/section headings (e.g. "Chapter 1", topic titles).',
    '- IGNORE running headers/footers that repeat on many pages (maps, site names, book title alone).',
    '- Each chunk ≈ ' + TARGET_MIN + '-' + TARGET_MAX + ' pages for one class period.',
    '- Split sections longer than ' + SPLIT_OVER + ' pages.',
    '- Merge sections that are 1 page or less with a neighbor.',
    '- unit_title must be unique and descriptive for that page range — never reuse a header.',
    '- Page numbers must be within 1..' + pages.length + '.',
    'Level: ' + level.prompt,
    'Detected chapter-like headings: ' + JSON.stringify(headings.slice(0, 80)),
    'Sample pages: ' + JSON.stringify(sample)
  ].join('\n');

  try {
    const res = await askGemini(prompt, {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      systemInstruction: 'STRICT: Output valid JSON only. Use only provided page numbers. Never use repeating page headers as unit titles.'
    });
    const parsed = extractJson(res.text || res.answer || '');
    if (!parsed || !Array.isArray(parsed.chunks) || !parsed.chunks.length) {
      throw new Error('empty plan');
    }
    const chunks = parsed.chunks.map((ch, i) => {
      let start = Math.max(1, Math.min(pages.length, Number(ch.start_page || ch.startPage) || 1));
      let end = Math.max(start, Math.min(pages.length, Number(ch.end_page || ch.endPage) || start));
      if (end - start + 1 > SPLIT_OVER + 2) end = start + TARGET_MAX - 1;
      const slice = pages.filter((p) => p.pageNum >= start && p.pageNum <= end);
      const text = slice.map((p) => p.text).join('\n\n').trim();
      let unitTitle = String(ch.unit_title || ch.unitTitle || '').trim();
      if (!unitTitle || isJunkHeading(unitTitle, banned)) {
        const snip = firstContentSnippet(text, banned);
        unitTitle = snip
          ? ('pp. ' + start + '–' + end + ': ' + snip)
          : ('Pages ' + start + '–' + end);
      }
      return {
        partNum: i + 1,
        unitTitle,
        startPage: start,
        endPage: end,
        text
      };
    }).filter((ch) => ch.text.length > 80);

    if (!chunks.length) throw new Error('no usable chunks');
    // Renumber after filter
    chunks.forEach((ch, i) => { ch.partNum = i + 1; });
    return {
      meta: {
        title: cleanBookTitle(parsed.title || options.fallbackTitle, options.fallbackTitle),
        author: String(parsed.author || 'Unknown').replace(/\(.*?etc\.?\)/gi, '').trim() || 'Unknown',
        genre: /non[- ]?fiction/i.test(String(parsed.genre || options.genre || ''))
          ? 'nonfiction'
          : (/fiction/i.test(String(parsed.genre || '')) ? 'fiction' : (
            /harari|history|argument|science|biography/i.test(
              String(parsed.title || '') + ' ' + String(options.fallbackTitle || '')
            ) ? 'nonfiction' : 'fiction'
          ))
      },
      chunks
    };
  } catch (_) {
    return {
      meta: {
        title: cleanBookTitle(options.fallbackTitle, 'Untitled Book'),
        author: 'Unknown',
        genre: options.genre === 'nonfiction' ? 'nonfiction' : 'fiction'
      },
      chunks: planChunksHeuristic(pages)
    };
  }
}

function evidenceInText(quote, sectionText) {
  const q = String(quote || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const t = String(sectionText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!q || q.length < 8) return false;
  if (t.includes(q)) return true;
  const head = q.slice(0, Math.min(40, q.length));
  return head.length >= 12 && t.includes(head);
}

async function generatePartWorksheet(chunk, meta, options, attempt) {
  const tryNum = attempt || 1;
  const maxTries = 5;
  const level = LEVELS[options.level] || LEVELS.middle;
  const typeList = options.mcTypes.map((id) => {
    const hit = MC_TYPES.find((t) => t.id === id);
    return hit ? hit.label : id;
  }).join('; ');

  const compact = tryNum >= 3;
  const system = [
    'You are an expert ELA worksheet writer for school teachers.',
    'STRICT GROUNDING: Rely EXCLUSIVELY on the provided section_text.',
    'Output ONE valid JSON object only. No markdown fences, no commentary.',
    compact
      ? 'Keep every string short. Prefer brief evidence quotes (under 20 words).'
      : 'Before each vocabulary item and each question, choose an exact quote from section_text as evidence.'
  ].join(' ');

  const textLimit = compact ? 9000 : (tryNum > 1 ? 16000 : 24000);
  const prompt = [
    compact
      ? 'Create a SHORT Novel/Book Study worksheet JSON for this section.'
      : 'Create one Novel/Book Study worksheet for this section.',
    'Book: ' + meta.title + ' by ' + meta.author + ' (' + meta.genre + ')',
    'Unit: ' + chunk.unitTitle + ' (pages ' + chunk.startPage + '–' + chunk.endPage + ')',
    'Audience: ' + level.prompt,
    'Return JSON with keys vocab, multipleChoice, shortAnswer, reflection.',
    'Counts: vocab=' + options.vocabCount + ', mc=' + options.mcCount +
      ', short=' + options.shortCount + ', reflection=' + options.reflectionCount,
    options.vocabCount === 0 ? 'Set vocab to an empty array []. Do not invent vocabulary.' : '',
    'For each multipleChoice item, choices MUST be a JSON array of exactly 4 NON-EMPTY answer strings.',
    'Do NOT use an object for choices. Do NOT leave choice text blank.',
    'Do NOT put A/B/C/D letters inside choice strings — letters are added by the formatter.',
    'Example: "choices":["the river flooded","the mountain erupted","the forest burned","the desert froze"]',
    !compact ? ('Prefer these MC types: ' + typeList) : '',
    tryNum > 1 ? 'IMPORTANT: Previous reply was invalid or truncated. Reply with complete JSON only. Every MC choice must have real text.' : '',
    'section_text:',
    String(chunk.text || '').slice(0, textLimit)
  ].filter(Boolean).join('\n');

  let rawText = '';
  try {
    const res = await askGemini(prompt, {
      temperature: compact ? 0.1 : (tryNum > 1 ? 0.2 : 0.35),
      maxOutputTokens: compact ? 3072 : 4096,
      responseMimeType: 'application/json',
      systemInstruction: system,
      retries: 2
    });
    rawText = res.text || res.answer || '';
  } catch (e) {
    if (tryNum < maxTries) {
      await sleep(1500 * tryNum);
      return generatePartWorksheet(chunk, meta, options, tryNum + 1);
    }
    console.warn('novelStudy part stub after API error', chunk.partNum, e.message);
    return stubPartWorksheet(chunk, options);
  }

  const parsed = extractJson(rawText);
  if (!parsed) {
    if (tryNum < maxTries) {
      await sleep(1500 * tryNum);
      return generatePartWorksheet(chunk, meta, options, tryNum + 1);
    }
    console.warn('novelStudy part stub after bad JSON', chunk.partNum, String(rawText).slice(0, 180));
    return stubPartWorksheet(chunk, options);
  }

  const { normalizeChoices } = require('./novelStudyHtml');

  const vocab = options.vocabCount === 0
    ? []
    : (Array.isArray(parsed.vocab) ? parsed.vocab : [])
      .slice(0, options.vocabCount)
      .map((v) => ({
        word: String(v.word || '').trim(),
        partOfSpeech: String(v.partOfSpeech || v.pos || '').trim(),
        definition: String(v.definition || '').trim(),
        exampleFromText: String(v.exampleFromText || v.example || '').trim(),
        evidenceQuote: String(v.evidenceQuote || v.exampleFromText || '').trim()
      }))
      .filter((v) => v.word);

  const multipleChoice = (Array.isArray(parsed.multipleChoice) ? parsed.multipleChoice : [])
    .slice(0, options.mcCount)
    .map((q) => {
      const choices = normalizeChoices(q.choices != null ? q.choices : q.options);
      while (choices.length < 4) choices.push('');
      return {
        type: String(q.type || '').trim(),
        question: String(q.question || '').trim(),
        choices: choices.slice(0, 4),
        answer: String(q.answer || 'A').trim().toUpperCase().slice(0, 1),
        evidenceQuote: String(q.evidenceQuote || '').trim()
      };
    })
    .filter((q) => q.question);

  const shortAnswer = (Array.isArray(parsed.shortAnswer) ? parsed.shortAnswer : [])
    .slice(0, options.shortCount)
    .map((q) => ({
      question: String(q.question || '').trim(),
      sampleAnswer: String(q.sampleAnswer || '').trim(),
      evidenceQuote: String(q.evidenceQuote || '').trim()
    }))
    .filter((q) => q.question);

  const reflection = (Array.isArray(parsed.reflection) ? parsed.reflection : [])
    .slice(0, options.reflectionCount)
    .map((q) => ({
      question: String(q.question || '').trim(),
      sampleAnswer: String(q.sampleAnswer || '').trim(),
      evidenceQuote: String(q.evidenceQuote || '').trim()
    }))
    .filter((q) => q.question);

  const mcIncomplete = multipleChoice.some((q) =>
    !(q.choices || []).filter((c) => String(c || '').trim()).length >= 4
  );
  if (mcIncomplete && tryNum < maxTries) {
    await sleep(1500 * tryNum);
    return generatePartWorksheet(chunk, meta, options, tryNum + 1);
  }

  if (!vocab.length && !multipleChoice.length && !shortAnswer.length) {
    if (tryNum < maxTries) {
      await sleep(1500 * tryNum);
      return generatePartWorksheet(chunk, meta, options, tryNum + 1);
    }
    return stubPartWorksheet(chunk, options);
  }

  const checks = []
    .concat(vocab.map((v) => v.evidenceQuote || v.exampleFromText))
    .concat(multipleChoice.map((q) => q.evidenceQuote))
    .concat(shortAnswer.map((q) => q.evidenceQuote))
    .concat(reflection.map((q) => q.evidenceQuote));
  const ok = checks.filter((q) => evidenceInText(q, chunk.text)).length;
  const ratio = checks.length ? ok / checks.length : 0;
  if (ratio < 0.4 && tryNum < 3) {
    return generatePartWorksheet(chunk, meta, options, tryNum + 1);
  }

  return {
    partNum: chunk.partNum,
    unitTitle: chunk.unitTitle,
    startPage: chunk.startPage,
    endPage: chunk.endPage,
    vocab,
    multipleChoice,
    shortAnswer,
    reflection,
    groundingScore: Math.round(ratio * 100)
  };
}

async function generateCulminating(job) {
  const genre = (job.meta && job.meta.genre) === 'nonfiction' ? 'nonfiction' : 'fiction';
  const specs = genre === 'nonfiction' ? CULMINATING_NONFICTION : CULMINATING_FICTION;
  const level = LEVELS[job.options.level] || LEVELS.middle;
  const excerpts = (job.chunks || []).map((ch) => ({
    part: ch.partNum,
    title: ch.unitTitle,
    excerpt: String(ch.text || '').slice(0, 1200)
  }));
  const partSummary = (job.parts || []).map((p) => ({
    part: p.partNum,
    title: p.unitTitle,
    vocab: (p.vocab || []).map((v) => v.word),
    themes: (p.reflection || []).map((r) => r.question).slice(0, 1)
  }));

  const prompt = [
    'Create 3 culminating Novel/Book Study prompts for the WHOLE text.',
    'Book: ' + ((job.meta && job.meta.title) || 'Untitled') +
      ' by ' + ((job.meta && job.meta.author) || 'Unknown') +
      ' (' + genre + ')',
    'Audience: ' + level.prompt,
    'Required labels in order: ' + specs.map((s) => s.label).join(', '),
    'Return JSON ONLY:',
    '{ "prompts": [{ "id", "label", "question", "sampleAnswer", "evidenceQuote" }] }',
    'Exactly 3 prompts matching the required labels.',
    'Ground each in the excerpts. evidenceQuote must be a real phrase from the excerpts.',
    'Part summaries: ' + JSON.stringify(partSummary).slice(0, 6000),
    'Excerpts: ' + JSON.stringify(excerpts).slice(0, 20000)
  ].join('\n');

  const res = await askGemini(prompt, {
    temperature: 0.35,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    systemInstruction:
      'You write culminating ELA tasks. Output valid JSON only. Stay grounded in excerpts.'
  });
  const parsed = extractJson(res.text || res.answer || '');
  let prompts = Array.isArray(parsed && parsed.prompts) ? parsed.prompts : [];
  prompts = specs.map((spec, i) => {
    const hit = prompts.find((p) =>
      String(p.id || '').toLowerCase() === spec.id ||
      String(p.label || '').toLowerCase() === spec.label.toLowerCase()
    ) || prompts[i] || {};
    return {
      id: spec.id,
      label: spec.label,
      question: String(hit.question || ('Discuss the ' + spec.label.toLowerCase() + ' of this text.')).trim(),
      sampleAnswer: String(hit.sampleAnswer || '').trim(),
      evidenceQuote: String(hit.evidenceQuote || '').trim()
    };
  });
  return { genre, prompts };
}

function emit(job, type, data) {
  const payload = Object.assign({ type }, data || {});
  (job.listeners || []).forEach((fn) => {
    try { fn(payload); } catch (_) { /* ignore */ }
  });
}

async function createJobFromPdf(teacherId, file, body) {
  if (!isGeminiConfigured()) {
    throw httpError('Gemini is not configured (missing GEMINI_API_KEY).', 503);
  }
  if (!file || !file.buffer || !file.buffer.length) {
    throw httpError('PDF file is required.', 400);
  }
  if (file.buffer.length > MAX_PDF_BYTES) {
    throw httpError('PDF is too large (max 100MB).', 400);
  }
  const mime = String(file.mimetype || '').toLowerCase();
  const name = String(file.originalname || '').toLowerCase();
  if (mime && mime !== 'application/pdf' && !name.endsWith('.pdf')) {
    throw httpError('Only PDF files are accepted.', 400);
  }

  ensureTmp();
  const options = normalizeOptions(body || {});
  const jobId = newId('ns');
  const pdfPath = path.join(TMP_ROOT, jobId + '.pdf');
  fs.writeFileSync(pdfPath, file.buffer);

  const job = {
    id: jobId,
    teacherId: String(teacherId || ''),
    status: 'parsing',
    progress: 2,
    message: 'Parsing PDF text…',
    options,
    pdfPath,
    pages: null,
    pageCount: 0,
    meta: null,
    chunks: [],
    parts: [],
    culminating: null,
    docxBuffer: null,
    googleDocsUrl: null,
    error: null,
    listeners: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  jobs.set(jobId, job);

  try {
    const extracted = await extractPages(file.buffer);
    touch(job, {
      status: 'planning',
      progress: 10,
      message: 'Planning chapter chunks…',
      pages: extracted.pages,
      pageCount: extracted.pageCount
    });

    const fallbackTitle = cleanBookTitle(
      path.basename(String(file.originalname || 'book.pdf'), '.pdf'),
      'Untitled Book'
    );
    const planned = await planChunksWithGemini(extracted.pages, {
      level: options.level,
      genre: options.genre === 'auto' ? '' : options.genre,
      fallbackTitle
    });
    if (options.genre === 'fiction' || options.genre === 'nonfiction') {
      planned.meta.genre = options.genre;
    }

    // Temp PDF deleted after parse; keep chunk meta + text in memory.
    cleanupJobFiles(job);
    touch(job, {
      status: 'ready',
      progress: 18,
      message: 'Chunk plan ready (' + planned.chunks.length + ' parts). Click Generate to continue.',
      meta: planned.meta,
      chunks: planned.chunks,
      pages: null
    });
    return toPublicJob(job);
  } catch (e) {
    cleanupJobFiles(job);
    touch(job, {
      status: 'error',
      progress: 100,
      message: e.message,
      error: e.message
    });
    throw e;
  }
}

function subscribe(jobId, teacherId, listenerFn) {
  const job = getJob(jobId, teacherId);
  job.listeners = job.listeners || [];
  job.listeners.push(listenerFn);
  return () => {
    job.listeners = (job.listeners || []).filter((x) => x !== listenerFn);
  };
}

async function runGeneration(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (job.status === 'generating') throw httpError('Generation is already running.', 409);
  if (!job.chunks || !job.chunks.length) throw httpError('No chunks to generate.', 400);
  if (!isGeminiConfigured()) throw httpError('Gemini is not configured.', 503);

  // Resume from last successful part instead of restarting from part 1.
  const existingParts = Array.isArray(job.parts) ? job.parts.slice() : [];
  const startIndex = Math.min(existingParts.length, job.chunks.length);
  const total = job.chunks.length;

  touch(job, {
    status: 'generating',
    progress: 20 + Math.floor((startIndex / Math.max(1, total)) * 60),
    message: startIndex
      ? ('Resuming from part ' + (startIndex + 1) + '/' + total + '…')
      : 'Generating worksheets…',
    parts: existingParts,
    culminating: null,
    docxBuffer: null,
    error: null
  });
  emit(job, 'status', toPublicJob(job));

  let stubCount = 0;
  try {
    for (let i = startIndex; i < total; i += 1) {
      const chunk = job.chunks[i];
      touch(job, {
        message: 'Generating part ' + (i + 1) + '/' + total + ': ' + chunk.unitTitle,
        progress: 20 + Math.floor((i / total) * 60)
      });
      emit(job, 'status', toPublicJob(job));

      const part = await generatePartWorksheet(chunk, job.meta, job.options);
      if (part.stubbed) stubCount += 1;
      job.parts.push(part);
      touch(job, { parts: job.parts });
      emit(job, 'part', {
        partNum: part.partNum,
        groundingScore: part.groundingScore,
        stubbed: !!part.stubbed
      });

      if (i < total - 1) await sleep(PART_DELAY_MS);
    }

    await sleep(PART_DELAY_MS);
    touch(job, { message: 'Generating culminating task…', progress: 85 });
    emit(job, 'status', toPublicJob(job));
    const culminating = await generateCulminating(job);
    touch(job, { culminating });

    touch(job, { message: 'Building workbook (.docx)…', progress: 92 });
    emit(job, 'status', toPublicJob(job));

    const buf = await buildWorkbookDocx(job);

    // Drop section text only after a successful build so failed jobs can be retried.
    job.chunks = job.chunks.map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      startPage: ch.startPage,
      endPage: ch.endPage,
      text: ''
    }));
    job.pages = null;

    const doneMsg = stubCount
      ? ('Workbook ready — download below. (' + stubCount +
        ' part(s) used a simplified fallback after AI errors.)')
      : 'Workbook ready — download below.';
    touch(job, {
      status: 'done',
      progress: 100,
      message: doneMsg,
      docxBuffer: buf,
      error: null
    });
    emit(job, 'done', toPublicJob(job));
    return toPublicJob(job);
  } catch (e) {
    const doneParts = (job.parts || []).length;
    const totalParts = (job.chunks || []).length || 1;
    const failProgress = Math.min(95, 20 + Math.floor((doneParts / totalParts) * 60));
    touch(job, {
      status: 'error',
      progress: failProgress,
      message: e.message || 'Generation failed.',
      error: (e.message || 'Generation failed.') +
        (doneParts
          ? ' Saved ' + doneParts + '/' + totalParts +
            ' parts — click Generate again to resume from part ' + (doneParts + 1) + '.'
          : '')
    });
    emit(job, 'error', toPublicJob(job));
    throw e;
  }
}

async function rebuildDocxBuffer(job) {
  const { buildWorkbookDocx } = require('./novelStudyDocx');
  const buf = await buildWorkbookDocx(job);
  job.docxBuffer = buf;
  try {
    ensureTmp();
    fs.writeFileSync(jobDocxPath(job.id), buf);
  } catch (_) { /* cache best-effort */ }
  return buf;
}

async function getDownload(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (job.status !== 'done' && !(job.parts || []).length) {
    throw httpError('Download is not ready yet.', 409);
  }
  // Always rebuild so template/layout fixes apply to older jobs too.
  let buf = null;
  if ((job.parts || []).length) {
    try {
      buf = await rebuildDocxBuffer(job);
    } catch (e) {
      console.warn('novelStudy rebuild docx failed', job.id, e.message);
    }
  }
  if (!buf || !buf.length) buf = await ensureDocxBufferAsync(job);
  if (!buf || !buf.length) throw httpError('Download is not ready yet.', 409);
  const safe = String((job.meta && job.meta.title) || 'book-study')
    .replace(/[^\w\s\-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'book-study';
  return {
    filename: safe + '-workbook.docx',
    buffer: buf,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
}

async function getHtml(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (job.status !== 'done' || !(job.parts || []).length) {
    throw httpError('Printable HTML is not ready yet.', 409);
  }
  const { buildWorkbookHtml } = require('./novelStudyHtml');
  const html = buildWorkbookHtml(job);
  const safe = String((job.meta && job.meta.title) || 'book-study')
    .replace(/[^\w\s\-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'book-study';
  return {
    filename: safe + '-workbook.html',
    html,
    mime: 'text/html; charset=utf-8'
  };
}

async function uploadToGoogleDocs(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  let buf = null;
  if ((job.parts || []).length) {
    try {
      buf = await rebuildDocxBuffer(job);
    } catch (_) { /* fall through */ }
  }
  if (!buf || !buf.length) buf = await ensureDocxBufferAsync(job);
  if (!buf || !buf.length) throw httpError('Generate the workbook first.', 409);
  job.docxBuffer = buf;

  const {
    getGoogleStatus,
    getAccessToken,
    shareDriveFile
  } = require('./googleTeacherAuthService');

  let status;
  try {
    status = await getGoogleStatus(teacherId);
  } catch (_) {
    status = { connected: false };
  }
  if (!status || !status.connected) {
    throw httpError(
      'Connect your Google account in the teacher portal first.',
      400,
      'GOOGLE_NOT_CONNECTED'
    );
  }

  const { google } = require('googleapis');
  const tokenInfo = await getAccessToken(teacherId);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: tokenInfo.accessToken });
  const drive = google.drive({ version: 'v3', auth });
  const name = String((job.meta && job.meta.title) || 'Book Study') + ' — Student Workbook';
  const stream = Readable.from(job.docxBuffer);
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.document'
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: stream
    },
    fields: 'id, webViewLink, name'
  });
  const fileId = created.data && created.data.id;
  let webViewLink = created.data && created.data.webViewLink;
  try {
    const shared = await shareDriveFile(teacherId, fileId);
    webViewLink = shared.webViewLink || webViewLink;
  } catch (_) { /* optional */ }

  const url = webViewLink || ('https://docs.google.com/document/d/' + fileId + '/edit');
  touch(job, { googleDocsUrl: url });
  return { url, fileId, name: (created.data && created.data.name) || name };
}

module.exports = {
  createJobFromPdf,
  getJob,
  listJobsForTeacher,
  toPublicJob,
  subscribe,
  runGeneration,
  getDownload,
  getHtml,
  uploadToGoogleDocs,
  listMcTypes,
  listLevels,
  normalizeOptions,
  MAX_PDF_BYTES
};

loadJobsFromDisk();
purgeExpired();
void (async () => {
  try {
    const n = await loadJobsFromDb();
    if (n) console.log('[novel-study] restored', n, 'job(s) from ops db');
  } catch (e) {
    console.warn('[novel-study] db restore skipped', e.message);
  }
})();
