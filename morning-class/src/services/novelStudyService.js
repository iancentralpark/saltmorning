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
  const structureUnits = Array.isArray(job.structureUnits) ? job.structureUnits.map((u) => ({
    id: u.id,
    index: u.index,
    chapterNum: u.chapterNum || 0,
    chapterTitle: u.chapterTitle || '',
    title: u.title || '',
    kind: u.kind || 'subtitle',
    label: u.label || '',
    startPage: u.startPage,
    endPage: u.endPage,
    text: keepText ? String(u.text || '') : ''
  })) : [];
  const meta = job.meta && typeof job.meta === 'object' ? Object.assign({}, job.meta) : {};
  if (structureUnits.length) meta.structureUnits = structureUnits;
  return {
    id: job.id,
    teacherId: job.teacherId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error || null,
    meta: Object.keys(meta).length ? meta : null,
    options: job.options,
    pageCount: job.pageCount || 0,
    chunks: (job.chunks || []).map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      summary: ch.summary || '',
      readingRange: ch.readingRange || '',
      startPage: ch.startPage,
      endPage: ch.endPage,
      text: keepText ? String(ch.text || '') : '',
      unitIds: Array.isArray(ch.unitIds) ? ch.unitIds.map(String) : []
    })),
    parts: job.parts || [],
    culminating: job.culminating || null,
    googleDocsUrl: job.googleDocsUrl || null,
    originalName: job.originalName || null,
    planMode: job.planMode || null,
    planReport: job.planReport || null,
    structureUnits,
    tocCount: job.tocCount || 0,
    skippedFront: job.skippedFront || 0,
    skippedBack: job.skippedBack || 0,
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
    originalName: data.originalName || null,
    planMode: data.planMode || null,
    planReport: data.planReport || (data.meta && data.meta.planReport) || null,
    structureUnits: Array.isArray(data.structureUnits)
      ? data.structureUnits
      : ((data.meta && Array.isArray(data.meta.structureUnits)) ? data.meta.structureUnits : []),
    tocCount: data.tocCount || 0,
    skippedFront: data.skippedFront || 0,
    skippedBack: data.skippedBack || 0,
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
      exampleSentence: 'Students can use the word "' + word + '" in a clear classroom sentence.',
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
      type: 'critical_thinking',
      question: 'Using evidence from this section, explain one important idea and why it matters.',
      sampleAnswer: 'Student answers will vary; cite a detail from the passage and explain its significance in about one paragraph.',
      evidenceQuote: quote
    });
  }
  return {
    partNum: chunk.partNum,
    unitTitle: chunk.unitTitle,
    readingRange: chunk.readingRange || '',
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

function summarizePartPreview(part) {
  if (!part) return null;
  return {
    partNum: part.partNum,
    unitTitle: part.unitTitle,
    startPage: part.startPage,
    endPage: part.endPage,
    groundingScore: part.groundingScore,
    stubbed: !!part.stubbed,
    vocab: (part.vocab || []).map((v) => ({
      word: v.word,
      partOfSpeech: v.partOfSpeech || '',
      definition: v.definition || '',
      exampleFromText: v.exampleFromText || ''
    })),
    multipleChoice: (part.multipleChoice || []).map((q) => ({
      question: q.question || '',
      choices: Array.isArray(q.choices) ? q.choices.slice(0, 4) : [],
      answer: q.answer || ''
    })),
    shortAnswer: (part.shortAnswer || []).map((q) => ({
      question: q.question || ''
    })),
    reflection: (part.reflection || []).map((q) => ({
      type: q.type || '',
      question: q.question || ''
    }))
  };
}

function toPublicJob(job, opts) {
  const includeParts = !!(opts && opts.includeParts);
  const out = {
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
      summary: ch.summary || '',
      readingRange: ch.readingRange || '',
      startPage: ch.startPage,
      endPage: ch.endPage,
      charCount: String(ch.text || '').length,
      unitIds: Array.isArray(ch.unitIds) ? ch.unitIds.map(String) : []
    })),
    partsDone: (job.parts || []).length,
    partsTotal: (job.chunks || []).length,
    downloadReady: jobHasDownload(job),
    googleDocsUrl: job.googleDocsUrl || null,
    pageOverflowRisk: !!(job.options && job.options.pageOverflowRisk),
    planMode: job.planMode || null,
    planReport: job.planReport || (job.meta && job.meta.planReport) || null,
    structureUnits: (job.structureUnits || []).map((u) => ({
      id: u.id,
      index: u.index,
      chapterNum: u.chapterNum || 0,
      chapterTitle: u.chapterTitle || '',
      title: u.title || '',
      kind: u.kind || 'subtitle',
      label: u.label || '',
      startPage: u.startPage,
      endPage: u.endPage
    })),
    tocCount: job.tocCount || 0,
    skippedFront: job.skippedFront || 0,
    skippedBack: job.skippedBack || 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    canDelete: !['generating', 'parsing', 'planning'].includes(String(job.status || ''))
  };
  if (includeParts) {
    out.partsPreview = (job.parts || []).map(summarizePartPreview).filter(Boolean);
  }
  return out;
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
  // vocabCount: target words per part (3–5 typical). 0 = skip vocabulary.
  // Default 4 so master + per-part vocab are generated unless teacher turns it off.
  const vocabRaw = body && body.vocabCount;
  const vocabCount = Math.max(0, Math.min(8,
    vocabRaw === 0 || vocabRaw === '0'
      ? 0
      : (vocabRaw === undefined || vocabRaw === null || vocabRaw === ''
        ? 4
        : (Number(vocabRaw) || 4))
  ));
  const mcCount = Math.max(1, Math.min(6, Number(body && body.mcCount) || 2));
  const shortCount = Math.max(0, Math.min(3, Number(body && body.shortCount) || 3));
  const reflectionCount = Math.max(0, Math.min(2, Number(body && body.reflectionCount) || 1));
  // 0 / empty / 'auto' = Gemini suggests a natural worksheet count (about 10–20).
  // Explicit numbers still force that exact count for teachers who want it.
  const targetRaw = body && body.targetChunks;
  let targetChunks = 0;
  if (targetRaw === 0 || targetRaw === '0' || targetRaw === 'auto' ||
      targetRaw === undefined || targetRaw === null || targetRaw === '') {
    targetChunks = 0;
  } else {
    const n = Number(targetRaw);
    targetChunks = Number.isFinite(n) && n > 0
      ? Math.max(2, Math.min(80, Math.round(n)))
      : 0;
  }
  let mcTypes = Array.isArray(body && body.mcTypes)
    ? body.mcTypes.map(String)
    : MC_TYPES.map((t) => t.id);
  mcTypes = mcTypes.filter((id) => MC_TYPES.some((t) => t.id === id));
  if (!mcTypes.length) mcTypes = ['factual', 'inference', 'vocab'];
  return {
    level: LEVELS[level] ? level : 'middle',
    genre: ['auto', 'fiction', 'nonfiction'].includes(genre) ? genre : 'auto',
    vocabCount,
    targetChunks,
    mcCount,
    shortCount,
    reflectionCount,
    mcTypes,
    pageOverflowRisk: vocabCount > 5 || mcCount > 2 || shortCount > 3 || reflectionCount > 1
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
        const items = tc.items || [];
        let text = '';
        let lastY = null;
        let lastX = null;
        items.forEach((it) => {
          const str = String(it.str || '');
          if (!str) return;
          const tr = it.transform || [];
          const x = typeof tr[4] === 'number' ? tr[4] : null;
          const y = typeof tr[5] === 'number' ? tr[5] : null;
          if (lastY != null && y != null && Math.abs(y - lastY) > 2.5) {
            text += '\n';
          } else if (text && !/\s$/.test(text) && !/^\s/.test(str)) {
            // Same line: insert space when glyphs are separated
            if (lastX != null && x != null && x - lastX > 0.6) text += ' ';
            else if (lastX == null) text += ' ';
          }
          text += str;
          if (y != null) lastY = y;
          if (x != null && typeof it.width === 'number') lastX = x + it.width;
          else if (x != null) lastX = x + str.length * 4;
        });
        text = text
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
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

  const usableCount = pages.filter(
    (p) => String(p.text || '').replace(/\s+/g, '').length >= MIN_CHARS_PAGE
  ).length;
  if (!usableCount) {
    throw httpError(
      'This PDF has no extractable text. Please upload a text-layer PDF (not a scan).',
      400
    );
  }
  // Keep every PDF page (including short/nearly-blank ones) so chunk plans stay
  // contiguous in page numbers. Dropping short pages previously created visible
  // gaps like "Part 11 ends p.80, Part 12 starts p.84".
  return { pageCount: pages.length, pages };
}

function pageCharCount(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

/** US + UK: acknowledgment(s) / acknowledgement(s) */
const ACK_RE = /acknowledg(e)?ments?/i;
const NON_CONTENT_LABEL_RE = /title page|front matter|half[- ]title|copyright|table of contents|\bcontents\b|dedication|epigraph|acknowledg(e)?ments?|about the author|also by (the )?author|bibliography|works cited|further reading|\bindex\b|publishing information|publication (info|details|data)|colophon|photo credits|\bcredits\b|permissions?|catalogu?ing|isbn\b|digital archiv/i;

function frontMatterScore(pageText) {
  const raw = String(pageText || '');
  const t = raw.toLowerCase();
  const len = pageCharCount(raw);
  const lines = pageLines(raw);
  let score = 0;

  if (/©|copyright|all rights reserved|\bisbn\b|library of congress|cip data/i.test(t)) score += 4;
  if (/published by|printed in|first (published|printing)|reprint(ed)?|imprint\b/i.test(t)) score += 3;
  if (/table of contents/i.test(t) || /(^|\n)\s*contents\s*(\n|$)/i.test(raw)) score += 5;
  if (ACK_RE.test(t) || /dedication|epigraph|also by (the )?author|about the author/i.test(t)) score += 4;
  if (/permission to reproduce|cataloguing|cataloging.in.publication/i.test(t)) score += 3;
  if (/title page|half title|frontispiece/i.test(t)) score += 2;

  // TOC-like layout: many short numbered lines, little prose
  const shortLines = lines.filter((l) => l.length > 0 && l.length <= 48);
  const numbered = shortLines.filter((l) => /^\d+([.:)]|\s)/.test(l) || /^[ivxlc]+\./i.test(l)).length;
  if (shortLines.length >= 4 && numbered >= 3 && len < 900) score += 3;

  // Short sparse pages early in a book are usually title/front matter.
  if (len < 120) score += 2;
  else if (len < 280) score += 1;
  if (lines.length > 0 && lines.length <= 10 && len < 500) score += 1;

  // Dense narrative prose lowers the score.
  const sentenceHits = (raw.match(/[a-z][.!?]\s+[A-Z]/g) || []).length;
  if (len > 700 && sentenceHits >= 3) score -= 3;
  if (len > 1200 && sentenceHits >= 5) score -= 2;

  return score;
}

function backMatterScore(pageText) {
  const raw = String(pageText || '');
  const t = raw.toLowerCase();
  const len = pageCharCount(pageText);
  const lines = pageLines(raw);
  const head = lines.slice(0, 6).join(' ').toLowerCase();
  let score = 0;

  // Strong: heading-like first lines (acknowledgments are usually prose, so score high here).
  if (ACK_RE.test(head) || /about the author|publishing information|publication (info|details)|colophon|photo credits|bibliography|works cited|further reading|\bindex\b|\bglossary\b/i.test(head)) {
    score += 6;
  }
  if (/\b(index|bibliography|works cited|further reading|glossary|colophon)\b/.test(t)) score += 3;
  if (ACK_RE.test(t) || /about the author|credits|photo credits|publishing information/i.test(t)) score += 4;
  if (/©|\bisbn\b|library of congress|all rights reserved|printed in|published by|digital archiv/i.test(t) && len < 1600) {
    score += 3;
  }
  if (len < 200) score += 1;
  return score;
}

function looksLikeBodyProse(pageText) {
  const raw = String(pageText || '');
  const compact = pageCharCount(raw);
  const soft = String(raw).replace(/\s+/g, ' ').trim().length;
  if (compact < 220 && soft < 280) return false;
  if (frontMatterScore(raw) >= 3) return false;
  const sentenceHits = (raw.match(/[a-z][.!?]\s+[A-Z]/g) || []).length;
  const hasLower = /[a-z]/.test(raw);
  return hasLower && (sentenceHits >= 2 || compact > 500 || soft > 600);
}

/**
 * Drop title/copyright/TOC/dedication at the start and index/credits at the end.
 * Keeps original PDF page numbers on remaining pages.
 */
function trimToBookBody(pages) {
  const all = pages || [];
  if (all.length <= 2) {
    return { pages: all.slice(), skippedFront: 0, skippedBack: 0 };
  }

  // Short PDFs (worksheets / slim chapter books): keep all pages. The long-book
  // scanner's absMax floor of 8 previously dropped almost everything from a
  // 6–12 page file, and short chapter pages often fail the prose heuristic.
  if (all.length <= 12) {
    return { pages: all.slice(), skippedFront: 0, skippedBack: 0 };
  }

  const scanFront = Math.min(all.length - 1, Math.max(8, Math.ceil(all.length * 0.22)));
  let bodyStart = 0;
  for (let i = 0; i < scanFront; i += 1) {
    const score = frontMatterScore(all[i].text);
    if (score >= 2) {
      bodyStart = i + 1;
      continue;
    }
    if (i >= 1 && looksLikeBodyProse(all[i].text)) {
      bodyStart = i;
      break;
    }
    // Once we are past a couple pages and hit clear prose, stop.
    if (i >= 2 && looksLikeBodyProse(all[i].text) && score <= 0) {
      bodyStart = i;
      break;
    }
  }

  // Seek forward a little if we landed on another front-matter page.
  while (
    bodyStart < all.length - 1
    && frontMatterScore(all[bodyStart].text) >= 2
    && !looksLikeBodyProse(all[bodyStart].text)
  ) {
    bodyStart += 1;
    if (bodyStart > Math.max(40, Math.floor(all.length * 0.4))) break;
  }

  // Absolute safety: never drop more than ~45% unless body prose was found earlier.
  const absMax = Math.min(all.length - 1, Math.max(8, Math.floor(all.length * 0.45)));
  if (bodyStart > absMax) {
    let found = -1;
    for (let i = 0; i <= absMax; i += 1) {
      if (looksLikeBodyProse(all[i].text) && frontMatterScore(all[i].text) < 2) {
        found = i;
        break;
      }
    }
    bodyStart = found >= 0 ? found : absMax;
  }

  let bodyEnd = all.length - 1;
  // Acknowledgments / credits often look like prose — still trim them from the end.
  const scanBackFrom = Math.max(bodyStart + 1, all.length - Math.max(10, Math.ceil(all.length * 0.18)));
  for (let i = all.length - 1; i >= scanBackFrom; i -= 1) {
    const score = backMatterScore(all[i].text);
    const prose = looksLikeBodyProse(all[i].text);
    if (score >= 4 || (score >= 3 && !prose)) {
      bodyEnd = i - 1;
      continue;
    }
    break;
  }
  if (bodyEnd < bodyStart) bodyEnd = all.length - 1;

  const sliced = all.slice(bodyStart, bodyEnd + 1);
  return {
    pages: sliced.length ? sliced : all.slice(),
    skippedFront: sliced.length ? bodyStart : 0,
    skippedBack: sliced.length ? (all.length - 1 - bodyEnd) : 0
  };
}

function isNonContentChunk(chunk) {
  const title = String((chunk && chunk.unitTitle) || '');
  const summary = String((chunk && chunk.summary) || '');
  const blob = (title + ' ' + summary).toLowerCase();
  if (NON_CONTENT_LABEL_RE.test(blob)) return true;
  if (chunk && chunk.text) {
    const bm = backMatterScore(chunk.text);
    if (bm >= 4) return true;
    if (frontMatterScore(chunk.text) >= 4 && !looksLikeBodyProse(chunk.text)) return true;
  }
  return false;
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
  if (/copyright|all rights reserved|isbn\b|printed in|published by/i.test(raw)) return true;
  if (/^(contents|table of contents|index|glossary|bibliography|acknowledg(e)?ments?|about the author|publishing information|colophon|photo credits)$/i.test(raw)) {
    return true;
  }
  if (ACK_RE.test(raw) && raw.length < 80) return true;
  return false;
}

function isGenericTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (/^pages?\s*\d+\s*[–—\-]\s*\d+$/i.test(t)) return true;
  if (/^pp\.?\s*\d+\s*[–—\-]\s*\d+$/i.test(t)) return true;
  if (/^part\s*\d+(\s*[–—\-:]\s*pages?\s*\d+)/i.test(t)) return true;
  if (/^(section|unit|chunk)\s*\d+$/i.test(t)) return true;
  return false;
}

/** Keep blank lines so "after blank" heading cues are real. */
function pageLinesWithBreaks(pageText) {
  return String(pageText || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());
}

/**
 * Body-prose fragments that must NEVER become chapter/subtitle titles.
 * This was the main cause of 100+ fake "subtitles" (page-start sentence scraps).
 */
function isProseFragment(line) {
  const s = String(line || '').replace(/[?!:.…]+$/g, '').trim();
  if (!s) return true;
  if (s.length > 90) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 12) return true;

  // ALL CAPS / small-caps titles are headings, not prose ("WHAT ARE HUMANS")
  const letters = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return false;

  // Continues a sentence / clause
  if (/^[a-zà-öø-ÿ]/.test(s)) return true;
  if (/[,;]$/.test(s)) return true;
  if (/\b(and|or|the|a|an|of|to|for|with|by|from|in|on|at|as|into|onto|than|then)$/i.test(s)) {
    return true;
  }
  // Comma-heavy clause → almost always prose, not a heading
  if ((s.match(/,/g) || []).length >= 1 && /[a-zà-öø-ÿ]/.test(s)) return true;

  // Narrative / verb-y scraps — only when the line has lowercase body text.
  // (Do not flag Title Case / ALL CAPS headings that happen to include "Are"/"Is".)
  if (/[a-zà-öø-ÿ]/.test(s)) {
    if (
      /\b(they|them|their|were|was|have|has|had|said|says|ate|eat|look(?:ing|ed)?|happen(?:ed|s)?|wait(?:ed|ing)?|could|would|should|might|across|toward|towards)\b/i.test(s)
      && !/^(chapter|part|unit|section|prologue|epilogue)\b/i.test(s)
      && words.length >= 3
    ) {
      return true;
    }
    // Mostly lowercase words → prose, not a title
    if (words.length >= 3) {
      const lower = words.filter((w) => /^[a-zà-öø-ÿ]/.test(w)).length;
      if (lower / words.length >= 0.5) return true;
    }
  }
  return false;
}

function isExplicitChapterHeading(line) {
  const t = String(line || '').replace(/[?!:.…]+$/g, '').trim();
  if (!t || t.length > 100) return false;
  if (/^(chapter|ch\.?|part|unit)\s*[ivxlc0-9]+/i.test(t)) return true;
  if (/^(prologue|epilogue|introduction|preface|afterword|conclusion)\b/i.test(t)) return true;
  if (/^\d+\.\s+[A-ZÀ-ÖØ-Þ]/.test(t) && t.split(/\s+/).length <= 12) return true;
  return false;
}

/**
 * Real subtitle / section title (ALL CAPS, tight Title Case, numbered) — not body text.
 */
function isStrongSubtitleTitle(line) {
  const cleaned = String(line || '').replace(/[?!:.…]+$/g, '').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return false;
  if (isProseFragment(cleaned)) return false;
  if (isExplicitChapterHeading(cleaned)) return true;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 10) return false;

  // ALL CAPS / small-caps style titles ("WHAT ARE HUMANS")
  if (
    /^[A-ZÀ-ÖØ-Þ0-9][A-ZÀ-ÖØ-Þ0-9 ,.'’:\-]*$/.test(cleaned)
    && /[A-ZÀ-ÖØ-Þ]/.test(cleaned)
    && words.length <= 10
  ) {
    return true;
  }

  // Roman / letter numbered headings
  if (/^([IVXLC]+\.|[A-Z]\.)\s+[A-ZÀ-ÖØ-Þ]/.test(cleaned) && cleaned.length <= 80) {
    return true;
  }

  // Strict Title Case: nearly every content word capitalized; no terminal period
  // Allow leading The/A/An ("The Tree of Knowledge") when the rest is title-like.
  const minor = /^(of|the|a|an|and|or|in|on|to|for|vs\.?|von|de|da|del|la|le)$/i;
  const capped = words.filter((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w) || minor.test(w)).length;
  if (
    words.length >= 2
    && capped >= Math.ceil(words.length * 0.85)
    && !/[.!?]$/.test(cleaned)
    && !/^(and|but|or|so|then|when|after|before|this|that|these|those)\b/i.test(cleaned)
  ) {
    return true;
  }
  return false;
}

function isRealHeading(line, banned) {
  const cleaned = String(line || '').replace(/[?!:.…]+$/g, '').trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 100) return false;
  if (isJunkHeading(cleaned, banned)) return false;
  if (isProseFragment(cleaned)) return false;
  return isExplicitChapterHeading(cleaned) || isStrongSubtitleTitle(cleaned);
}

function guessHeading(pageText, banned) {
  const lines = pageLinesWithBreaks(pageText);
  const candidates = [];
  const consider = (line, afterBlank, nearTop) => {
    if (!isRealHeading(line, banned)) return;
    const cleaned = line.replace(/[?!:.…]+$/g, '').trim();
    // Chapter headings win; ALL CAPS / title-case only if near top or after a blank line
    if (isExplicitChapterHeading(cleaned)) {
      candidates.unshift(cleaned);
      return;
    }
    if (nearTop || afterBlank) candidates.push(cleaned);
  };

  for (let i = 0; i < Math.min(lines.length, 14); i += 1) {
    if (!lines[i]) continue;
    // Page-top line is "near top", but only a real blank line counts as afterBlank.
    // (Previously i===0 was treated as afterBlank, which let body scraps become titles.)
    const afterBlank = i > 0 && !lines[i - 1];
    consider(lines[i], afterBlank, i <= 4);
  }
  // Deeper on-page headings only after a real blank line
  for (let i = 14; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const afterBlank = i > 0 && !lines[i - 1];
    if (!afterBlank) continue;
    consider(lines[i], true, false);
  }
  return candidates[0] || '';
}

function pageHasSectionBreak(pageText, banned, currentTitle) {
  const h = guessHeading(pageText, banned);
  if (!h) return false;
  if (currentTitle && normalizeLine(h) === normalizeLine(currentTitle)) return false;
  return true;
}

/** True when a single line is a real chapter/subtitle heading. */
function lineLooksLikeHeading(line, banned, afterBlank) {
  const cleaned = String(line || '').replace(/[?!:.…]+$/g, '').trim();
  if (!isRealHeading(cleaned, banned)) return false;
  if (isExplicitChapterHeading(cleaned)) return true;
  // Non-chapter subtitles need a blank line (or caller already verified page-top)
  return !!afterBlank;
}

/**
 * If a new heading starts mid-page (after real prose), return a text split.
 * Only splits on strong headings after a blank line — never on body scraps.
 */
function findMidPageHeadingBreak(pageText, banned, currentTitle) {
  const lines = pageLinesWithBreaks(pageText);
  if (lines.length < 5) return null;
  for (let i = 2; i < lines.length - 1; i += 1) {
    if (!lines[i]) continue;
    const afterBlank = !lines[i - 1];
    // Mid-page: require blank line before heading (chapter OR strong subtitle)
    if (!afterBlank && !isExplicitChapterHeading(lines[i])) continue;
    if (!isRealHeading(lines[i], banned)) continue;
    const beforeLines = lines.slice(0, i).filter((l, idx) => l || (idx < i - 1));
    const beforeLen = lines.slice(0, i).join(' ').replace(/\s+/g, ' ').trim().length;
    if (beforeLen < 90) continue;
    const heading = lines[i].replace(/[?!:.…]+$/g, '').trim();
    if (currentTitle && normalizeLine(heading) === normalizeLine(currentTitle)) continue;
    const afterLen = lines.slice(i).join(' ').replace(/\s+/g, ' ').trim().length;
    if (afterLen < 40) continue;
    return {
      heading,
      beforeText: lines.slice(0, i).join('\n').trim(),
      afterText: lines.slice(i).join('\n').trim()
    };
  }
  return null;
}

function sectionFromPages(unitTitle, pages) {
  if (!pages || !pages.length) return null;
  return {
    unitTitle: unitTitle || '',
    startPage: pages[0].pageNum,
    endPage: pages[pages.length - 1].pageNum,
    pages: pages.slice(),
    text: pages.map((p) => p.text).join('\n\n').trim()
  };
}

/**
 * Move mid-page "next section" tails from section i into section i+1
 * so worksheet text follows headings, not just whole PDF pages.
 */
function carveAdjacentSections(sections, banned) {
  const secs = (sections || []).map((s) => ({
    unitTitle: s.unitTitle || '',
    startPage: s.startPage,
    endPage: s.endPage,
    pages: (s.pages || []).map((p) => ({ pageNum: p.pageNum, text: p.text })),
    text: s.text || ''
  }));

  for (let i = 0; i < secs.length - 1; i += 1) {
    const a = secs[i];
    const b = secs[i + 1];
    if (!a.pages.length) continue;
    const last = a.pages[a.pages.length - 1];
    if (b.startPage > last.pageNum + 1) continue;

    const br = findMidPageHeadingBreak(last.text, banned, a.unitTitle);
    if (!br) continue;

    const nextKey = normalizeLine(b.unitTitle || '');
    const headKey = normalizeLine(br.heading);
    const matchesNext = !!(nextKey && (headKey === nextKey
      || nextKey.includes(headKey)
      || headKey.includes(nextKey)));
    const differsCurrent = !a.unitTitle || headKey !== normalizeLine(a.unitTitle);
    if (!matchesNext && !differsCurrent) continue;

    if (br.beforeText) {
      a.pages[a.pages.length - 1] = { pageNum: last.pageNum, text: br.beforeText };
    } else {
      a.pages.pop();
    }
    if (!a.pages.length) {
      // Avoid empty section — keep a minimal stub and do not carve.
      a.pages.push({ pageNum: last.pageNum, text: br.beforeText || last.text });
      continue;
    }
    a.endPage = a.pages[a.pages.length - 1].pageNum;
    a.text = a.pages.map((p) => p.text).join('\n\n').trim();

    if (b.pages[0] && b.pages[0].pageNum === last.pageNum) {
      b.pages[0] = { pageNum: last.pageNum, text: br.afterText };
    } else {
      b.pages.unshift({ pageNum: last.pageNum, text: br.afterText });
    }
    if (!b.unitTitle) b.unitTitle = br.heading;
    b.startPage = b.pages[0].pageNum;
    b.endPage = b.pages[b.pages.length - 1].pageNum;
    b.text = b.pages.map((p) => p.text).join('\n\n').trim();
  }

  return secs.filter((s) => s.pages && s.pages.length);
}

function rematerializeSectionPages(chunks, bodyPages) {
  const byNum = new Map((bodyPages || []).map((p) => [p.pageNum, p]));
  return (chunks || []).map((c) => {
    const pages = [];
    for (let n = c.startPage; n <= c.endPage; n += 1) {
      if (byNum.has(n)) pages.push({ pageNum: n, text: byNum.get(n).text });
    }
    return {
      unitTitle: c.unitTitle || '',
      startPage: pages.length ? pages[0].pageNum : c.startPage,
      endPage: pages.length ? pages[pages.length - 1].pageNum : c.endPage,
      pages,
      text: pages.map((p) => p.text).join('\n\n').trim(),
      summary: c.summary || ''
    };
  }).filter((s) => s.pages.length);
}

/** True when every body page appears in at least one section (no coverage gaps).
 * Mid-page heading splits may share a boundary page — that is allowed.
 */
function sectionsCoverAllBody(sections, bodyPages) {
  const body = bodyPages || [];
  if (!body.length) return !(sections && sections.length);
  const covered = new Set();
  for (const s of sections || []) {
    for (const p of s.pages || []) covered.add(p.pageNum);
  }
  for (const p of body) {
    if (!covered.has(p.pageNum)) return false;
  }
  return true;
}

/** True when sections are a partition of body pages (no gaps, no full-page overlaps). */
function sectionsPartitionBody(sections, bodyPages) {
  const body = bodyPages || [];
  if (!body.length) return !(sections && sections.length);
  const covered = new Set();
  for (const s of sections || []) {
    for (const p of s.pages || []) {
      if (covered.has(p.pageNum)) return false;
      covered.add(p.pageNum);
    }
  }
  if (covered.size !== body.length) return false;
  for (const p of body) {
    if (!covered.has(p.pageNum)) return false;
  }
  return true;
}

/**
 * Rebuild sections so every body page is in exactly one part, preserving
 * heading-aligned starts when possible. Gaps between claimed ranges are filled;
 * overlaps are resolved by preferring the later section's start.
 */
function ensureContiguousBodyCoverage(sections, bodyPages, banned) {
  const body = (bodyPages || []).slice();
  if (!body.length) return [];
  const byNum = new Map(body.map((p) => [p.pageNum, p]));
  const pageNums = body.map((p) => p.pageNum);
  const indexOf = new Map(pageNums.map((n, i) => [n, i]));

  let secs = (sections || [])
    .map((s) => ({
      unitTitle: s.unitTitle || '',
      summary: s.summary || '',
      pages: (s.pages || []).filter((p) => byNum.has(p.pageNum))
    }))
    .filter((s) => s.pages.length)
    .sort((a, b) => a.pages[0].pageNum - b.pages[0].pageNum);

  if (!secs.length) {
    return [{
      unitTitle: guessHeading(body[0].text, banned) || 'Part 1',
      summary: '',
      startPage: body[0].pageNum,
      endPage: body[body.length - 1].pageNum,
      pages: body.slice(),
      text: body.map((p) => p.text).join('\n\n').trim()
    }];
  }

  // Claim start indexes into body; later sections win overlapping claims.
  const starts = [];
  secs.forEach((s) => {
    const idx = indexOf.get(s.pages[0].pageNum);
    if (idx == null) return;
    if (starts.length && idx <= starts[starts.length - 1]) return;
    starts.push(idx);
  });
  if (!starts.length || starts[0] !== 0) starts.unshift(0);
  // Deduplicate and ensure strictly increasing.
  const uniq = [];
  starts.forEach((idx) => {
    if (!uniq.length || idx > uniq[uniq.length - 1]) uniq.push(idx);
  });
  if (uniq[0] !== 0) uniq[0] = 0;

  const out = [];
  for (let i = 0; i < uniq.length; i += 1) {
    const from = uniq[i];
    const to = i + 1 < uniq.length ? uniq[i + 1] : pageNums.length;
    const slice = body.slice(from, to);
    if (!slice.length) continue;
    // Prefer original title for the section that started near this index.
    let title = '';
    let summary = '';
    for (const s of secs) {
      const sIdx = indexOf.get(s.pages[0].pageNum);
      if (sIdx === from || (sIdx > from && sIdx < to)) {
        title = s.unitTitle || title;
        summary = s.summary || summary;
        if (sIdx === from) break;
      }
    }
    if (!title) title = guessHeading(slice[0].text, banned) || ('Part ' + (out.length + 1));
    out.push({
      unitTitle: title,
      summary,
      startPage: slice[0].pageNum,
      endPage: slice[slice.length - 1].pageNum,
      pages: slice,
      text: slice.map((p) => p.text).join('\n\n').trim()
    });
  }
  return out;
}

/** Merge/split page-backed sections until count equals target (best-effort). */
function fitSectionsToTargetCount(sections, target, banned) {
  const want = Math.max(2, Math.min(80, Number(target) || 0));
  if (!want) return sections;
  let secs = (sections || []).map((s) => ({
    unitTitle: s.unitTitle || '',
    startPage: s.startPage,
    endPage: s.endPage,
    pages: (s.pages || []).slice(),
    text: s.text || '',
    summary: s.summary || ''
  })).filter((s) => s.pages.length);
  if (secs.length < 1) return sections;

  // When we have way more slices than wanted (heading explosion), greedy
  // pairwise merges skew left. Prefer an even page split instead.
  if (secs.length > want * 2) {
    const pages = [];
    secs.forEach((s) => s.pages.forEach((p) => pages.push(p)));
    return evenSplitPages(pages, want, banned);
  }

  while (secs.length > want) {
    // Merge the adjacent pair with the smallest combined length (most even).
    let best = 0;
    let bestCombined = Infinity;
    for (let i = 0; i < secs.length - 1; i += 1) {
      const combined = secs[i].pages.length + secs[i + 1].pages.length;
      if (combined < bestCombined) {
        bestCombined = combined;
        best = i;
      }
    }
    const a = secs[best];
    const b = secs[best + 1];
    secs.splice(best, 2, {
      unitTitle: a.unitTitle || b.unitTitle,
      startPage: a.startPage,
      endPage: b.endPage,
      pages: a.pages.concat(b.pages),
      text: '',
      summary: a.summary || b.summary || ''
    });
  }

  while (secs.length < want) {
    let best = 0;
    let bestLen = 0;
    for (let i = 0; i < secs.length; i += 1) {
      if (secs[i].pages.length > bestLen) {
        bestLen = secs[i].pages.length;
        best = i;
      }
    }
    if (bestLen < 2) break;
    const sec = secs[best];
    const mid = Math.floor(sec.pages.length / 2);
    const left = sec.pages.slice(0, mid);
    const right = sec.pages.slice(mid);
    const rightHeading = guessHeading(right[0].text, banned) || (sec.unitTitle + ' (cont.)');
    secs.splice(best, 1,
      {
        unitTitle: sec.unitTitle,
        startPage: left[0].pageNum,
        endPage: left[left.length - 1].pageNum,
        pages: left,
        text: '',
        summary: ''
      },
      {
        unitTitle: rightHeading,
        startPage: right[0].pageNum,
        endPage: right[right.length - 1].pageNum,
        pages: right,
        text: '',
        summary: ''
      }
    );
  }

  return secs.map((s) => {
    s.text = s.pages.map((p) => p.text).join('\n\n').trim();
    return s;
  });
}

/** Even contiguous page split — hard guarantee of exactly N sections. */
function evenSplitPages(pages, target, banned) {
  const want = Math.max(2, Math.min(80, Number(target) || 0));
  const list = (pages || []).slice();
  if (!want || list.length < 1) return [];
  const n = Math.min(want, list.length);
  const secs = [];
  for (let i = 0; i < n; i += 1) {
    const start = Math.floor((i * list.length) / n);
    const end = Math.floor(((i + 1) * list.length) / n);
    const slice = list.slice(start, end);
    if (!slice.length) continue;
    const heading = guessHeading(slice[0].text, banned) || ('Part ' + (secs.length + 1));
    secs.push({
      unitTitle: heading,
      startPage: slice[0].pageNum,
      endPage: slice[slice.length - 1].pageNum,
      pages: slice,
      text: slice.map((p) => p.text).join('\n\n').trim(),
      summary: ''
    });
  }
  return secs;
}

/**
 * Build exactly N worksheet sections for a teacher-requested count.
 * Starts from an even page split, then snaps each internal boundary to a
 * nearby chapter/section heading when one exists within a small window.
 */
function planTargetCountSections(bodyPages, target, banned, toc) {
  const want = Math.max(2, Math.min(80, Number(target) || 0));
  const pages = (bodyPages || []).slice();
  if (!want || pages.length < 1) return [];
  const n = Math.min(want, pages.length);
  const byNum = new Map(pages.map((p) => [p.pageNum, p]));
  const pageNums = pages.map((p) => p.pageNum);
  const headingPages = new Set();
  (toc || []).forEach((t) => {
    if (t && t.page != null) headingPages.add(Number(t.page));
  });
  pages.forEach((p) => {
    if (guessHeading(p.text, banned)) headingPages.add(p.pageNum);
  });

  // Ideal start indexes into pageNums, then snap to a nearby heading page.
  const starts = [];
  for (let i = 0; i < n; i += 1) {
    let idx = Math.floor((i * pageNums.length) / n);
    if (i === 0) {
      starts.push(0);
      continue;
    }
    const idealPage = pageNums[idx];
    const window = Math.max(1, Math.round(pageNums.length / n / 2));
    let bestIdx = idx;
    let bestDist = Infinity;
    for (let j = Math.max(starts[i - 1] + 1, idx - window);
      j <= Math.min(pageNums.length - (n - i), idx + window);
      j += 1) {
      const pnum = pageNums[j];
      if (!headingPages.has(pnum)) continue;
      const dist = Math.abs(pnum - idealPage);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    // Keep starts strictly increasing.
    starts.push(Math.max(starts[i - 1] + 1, bestIdx));
  }

  const secs = [];
  for (let i = 0; i < n; i += 1) {
    const from = starts[i];
    const to = i + 1 < n ? starts[i + 1] : pageNums.length;
    const slice = pageNums.slice(from, to).map((pn) => byNum.get(pn)).filter(Boolean);
    if (!slice.length) continue;
    const heading = guessHeading(slice[0].text, banned) || ('Part ' + (secs.length + 1));
    secs.push({
      unitTitle: heading,
      startPage: slice[0].pageNum,
      endPage: slice[slice.length - 1].pageNum,
      pages: slice,
      text: slice.map((p) => p.text).join('\n\n').trim(),
      summary: ''
    });
  }
  // If snapping collapsed a range, fall back to pure even split.
  if (secs.length !== n) return evenSplitPages(pages, want, banned);
  return secs;
}

const SUGGEST_MIN = 10;
const SUGGEST_MAX = 20;

function defaultPlanCriteria() {
  return [
    'Prefer chapter, subtitle, and content-unit boundaries over an exact page count',
    'Aim for about one class period per worksheet (roughly ' + SUGGEST_MIN + '–' + SUGGEST_MAX + ' parts)',
    'Avoid cutting mid-paragraph or mid-scene when a nearby heading exists',
    'Skip title/copyright/contents and back-matter pages'
  ];
}

/** Fallback worksheet count from headings + page length when Gemini is unavailable. */
function heuristicSuggestedCount(bodyPages, toc) {
  const pageN = (bodyPages || []).length;
  const headingN = (toc || []).length;
  if (pageN < 1) return 2;
  let n;
  if (headingN >= SUGGEST_MIN && headingN <= SUGGEST_MAX) {
    n = headingN;
  } else if (headingN > SUGGEST_MAX) {
    n = Math.round(headingN / Math.max(1, Math.ceil(headingN / 16)));
  } else if (headingN >= 4) {
    n = Math.max(headingN, Math.round(pageN / 5));
  } else {
    n = Math.round(pageN / 4);
  }
  const hardMax = Math.min(SUGGEST_MAX, Math.max(2, pageN));
  if (pageN < 24) {
    return Math.max(2, Math.min(hardMax, Math.max(2, Math.round(pageN / 3))));
  }
  const hardMin = Math.min(SUGGEST_MIN, hardMax);
  return Math.max(hardMin, Math.min(hardMax, n || SUGGEST_MIN));
}

/**
 * Ask Gemini for a natural worksheet count (~10–20) from structure signals.
 */
async function suggestWorksheetCountWithGemini(bodyPages, toc, options) {
  const fallback = heuristicSuggestedCount(bodyPages, toc);
  const headings = (toc || []).slice(0, 90).map((t) => ({
    page: t.page,
    title: String(t.title || t.heading || '').trim()
  })).filter((t) => t.title);
  const pageN = (bodyPages || []).length;
  const pageMin = bodyPages[0] && bodyPages[0].pageNum;
  const pageMax = bodyPages[bodyPages.length - 1] && bodyPages[bodyPages.length - 1].pageNum;

  try {
    const prompt = [
      'You are planning Novel/Book Study worksheets for middle/high school ELA.',
      'Suggest how many reading worksheets (chunks) this book body should have.',
      'Return JSON ONLY:',
      '{ "suggested_count": number, "criteria": string[], "summary": string, "notes": string }',
      'Rules:',
      '- Prefer a count between ' + SUGGEST_MIN + ' and ' + SUGGEST_MAX + ' when the book is long enough.',
      '- Use chapters, subtitles, and clear content units — not a blind every-N-pages grid.',
      '- Group very short chapters; split very long chapters at natural mid-chapter breaks when needed.',
      '- Meaning boundaries matter more than hitting an exact number.',
      '- criteria: 3–5 short bullets explaining what you optimized for.',
      '- summary: 1–2 sentences for the teacher (plain English).',
      'Book body pages: ' + pageN + ' (PDF pp. ' + pageMin + '–' + pageMax + ').',
      'Level: ' + String((options && options.level) || 'middle') + '.',
      'Detected headings: ' + JSON.stringify(headings)
    ].join('\n');

    const res = await askGemini(prompt, {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      systemInstruction: 'STRICT JSON only. Suggest a natural worksheet count for class periods.',
      retries: 1
    });
    const parsed = extractJson(res.text || res.answer || '');
    let count = Number(
      (parsed && (parsed.suggested_count || parsed.suggestedCount || parsed.count)) || fallback
    );
    if (!Number.isFinite(count)) count = fallback;
    count = Math.round(count);
    count = Math.max(8, Math.min(22, count));
    if (pageN < count) count = Math.max(2, pageN);
    if (pageN >= 24) {
      count = Math.max(SUGGEST_MIN, Math.min(SUGGEST_MAX, count));
    }

    const criteria = Array.isArray(parsed && parsed.criteria)
      ? parsed.criteria.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 8)
      : defaultPlanCriteria();
    const summary = String((parsed && (parsed.summary || parsed.rationale)) || '').trim()
      || ('Suggested ' + count + ' worksheets from ' + headings.length +
        ' detected headings across ' + pageN + ' content pages.');
    return {
      suggestedCount: count,
      criteria: criteria.length ? criteria : defaultPlanCriteria(),
      summary,
      notes: String((parsed && parsed.notes) || '').trim(),
      source: 'gemini'
    };
  } catch (e) {
    console.warn('novelStudy suggest count failed', e.message);
    return {
      suggestedCount: fallback,
      criteria: defaultPlanCriteria(),
      summary: 'Suggested ' + fallback + ' worksheets from heading/page heuristics (' +
        (toc || []).length + ' headings, ' + pageN + ' content pages).',
      notes: 'AI suggestion unavailable — used structure heuristic.',
      source: 'heuristic'
    };
  }
}

/**
 * Nudge section count toward a soft target without forcing exact N.
 * Prefer merging short neighbors and splitting only at heading pages.
 */
function softFitTowardCount(sections, softTarget, banned, tolerance) {
  const want = Math.max(2, Math.min(80, Number(softTarget) || 0));
  const tol = Math.max(1, Number(tolerance) || 2);
  if (!want) return sections || [];
  let secs = (sections || []).map((s) => ({
    unitTitle: s.unitTitle || '',
    startPage: s.startPage,
    endPage: s.endPage,
    pages: (s.pages || []).slice(),
    text: s.text || '',
    summary: s.summary || ''
  })).filter((s) => s.pages && s.pages.length);
  if (secs.length < 1) return sections || [];

  const within = () => Math.abs(secs.length - want) <= tol;

  while (secs.length > want + tol) {
    let best = 0;
    let bestCombined = Infinity;
    for (let i = 0; i < secs.length - 1; i += 1) {
      const combined = secs[i].pages.length + secs[i + 1].pages.length;
      if (combined < bestCombined) {
        bestCombined = combined;
        best = i;
      }
    }
    const a = secs[best];
    const b = secs[best + 1];
    secs.splice(best, 2, {
      unitTitle: a.unitTitle || b.unitTitle,
      startPage: a.startPage,
      endPage: b.endPage,
      pages: a.pages.concat(b.pages),
      text: '',
      summary: a.summary || b.summary || ''
    });
  }

  while (secs.length < want - tol) {
    let best = -1;
    let bestLen = 0;
    let bestSplit = -1;
    for (let i = 0; i < secs.length; i += 1) {
      const pages = secs[i].pages;
      if (pages.length < 4) continue;
      const minIdx = Math.max(1, Math.floor(pages.length * 0.3));
      const maxIdx = Math.min(pages.length - 1, Math.ceil(pages.length * 0.7));
      let splitAt = -1;
      for (let j = minIdx; j <= maxIdx; j += 1) {
        if (pageHasSectionBreak(pages[j].text, banned, secs[i].unitTitle) ||
            guessHeading(pages[j].text, banned)) {
          splitAt = j;
          break;
        }
      }
      if (splitAt > 0 && pages.length > bestLen) {
        best = i;
        bestLen = pages.length;
        bestSplit = splitAt;
      } else if (splitAt < 0 && pages.length > bestLen && pages.length >= 6) {
        best = i;
        bestLen = pages.length;
        bestSplit = Math.floor(pages.length / 2);
      }
    }
    if (best < 0 || bestSplit < 1) break;
    const sec = secs[best];
    const left = sec.pages.slice(0, bestSplit);
    const right = sec.pages.slice(bestSplit);
    if (!left.length || !right.length) break;
    const rightHeading = guessHeading(right[0].text, banned) || (sec.unitTitle + ' (cont.)');
    secs.splice(best, 1,
      {
        unitTitle: sec.unitTitle,
        startPage: left[0].pageNum,
        endPage: left[left.length - 1].pageNum,
        pages: left,
        text: '',
        summary: ''
      },
      {
        unitTitle: rightHeading,
        startPage: right[0].pageNum,
        endPage: right[right.length - 1].pageNum,
        pages: right,
        text: '',
        summary: ''
      }
    );
  }

  if (!within() && secs.length > want + tol) {
    // Still too many after soft merges — continue merging to upper bound only.
    while (secs.length > want + tol) {
      let best = 0;
      let bestCombined = Infinity;
      for (let i = 0; i < secs.length - 1; i += 1) {
        const combined = secs[i].pages.length + secs[i + 1].pages.length;
        if (combined < bestCombined) {
          bestCombined = combined;
          best = i;
        }
      }
      const a = secs[best];
      const b = secs[best + 1];
      secs.splice(best, 2, {
        unitTitle: a.unitTitle || b.unitTitle,
        startPage: a.startPage,
        endPage: b.endPage,
        pages: a.pages.concat(b.pages),
        text: '',
        summary: a.summary || b.summary || ''
      });
    }
  }

  return secs.map((s) => {
    s.text = s.pages.map((p) => p.text).join('\n\n').trim();
    return s;
  });
}

function buildPlanReport(opts) {
  const o = opts || {};
  const finalCount = Number(o.finalCount) || 0;
  const suggested = Number(o.suggestedCount) || 0;
  const hard = Number(o.hardTarget) || 0;
  const criteria = Array.isArray(o.criteria) && o.criteria.length
    ? o.criteria
    : defaultPlanCriteria();
  let howSplit = String(o.howSplit || '').trim();
  if (!howSplit) {
    if (hard >= 2) {
      howSplit = 'Fitted to the teacher-requested count of ' + hard +
        ' worksheets, snapping boundaries to nearby headings when possible.';
    } else if (suggested >= 2) {
      howSplit = 'AI suggested about ' + suggested +
        ' worksheets; final plan has ' + finalCount +
        ' parts along chapter/section meaning boundaries (exact count not forced).';
    } else {
      howSplit = 'Aligned to detected chapter/section headings where possible.';
    }
  }
  return {
    mode: o.mode || null,
    suggestedCount: suggested || null,
    finalCount: finalCount || null,
    hardTarget: hard >= 2 ? hard : null,
    countExact: hard >= 2,
    criteria,
    summary: String(o.summary || '').trim() || null,
    howSplit,
    notes: String(o.notes || '').trim() || null,
    headingCount: Number(o.headingCount) || 0,
    skippedFront: Number(o.skippedFront) || 0,
    skippedBack: Number(o.skippedBack) || 0,
    source: o.source || null
  };
}

/**
 * Final authority when the teacher asked for N worksheets.
 */
function enforceTargetChunkCount(chunks, bodyPages, target, banned, toc) {
  const want = Math.max(2, Math.min(80, Number(target) || 0));
  if (!want) return chunks || [];
  let sections = rematerializeSectionPages(chunks, bodyPages);

  // Prefer stitching gaps (keeps AI/heading titles) before a full replan.
  if (sections.length && !sectionsPartitionBody(sections, bodyPages)) {
    sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
  }

  const needsRebuild = !sections.length
    || sections.length !== want
    || !sectionsPartitionBody(sections, bodyPages);
  if (needsRebuild) {
    if (!sections.length || sections.length > want * 2) {
      sections = planTargetCountSections(bodyPages, want, banned, toc);
    } else {
      sections = fitSectionsToTargetCount(sections, want, banned);
      if (!sectionsPartitionBody(sections, bodyPages)) {
        sections = planTargetCountSections(bodyPages, want, banned, toc);
      }
    }
  }
  if (sections.length !== want || !sectionsPartitionBody(sections, bodyPages)) {
    sections = planTargetCountSections(bodyPages, want, banned, toc);
  }
  if (sections.length !== want || !sectionsPartitionBody(sections, bodyPages)) {
    sections = evenSplitPages(bodyPages, want, banned);
  }
  return sections.map((sec, idx) => labelChunk({
    partNum: idx + 1,
    unitTitle: sec.unitTitle,
    summary: sec.summary || '',
    startPage: sec.startPage,
    endPage: sec.endPage,
    pages: sec.pages,
    text: sec.text
  }, banned));
}

function sliceSectionPages(sec, fromIdx, toIdxExclusive, banned) {
  const slice = sec.pages.slice(fromIdx, toIdxExclusive);
  if (!slice.length) return null;
  const localHeading = fromIdx === 0
    ? sec.unitTitle
    : (guessHeading(slice[0].text, banned) || sec.unitTitle);
  return {
    unitTitle: localHeading || '',
    startPage: slice[0].pageNum,
    endPage: slice[slice.length - 1].pageNum,
    pages: slice
  };
}

/** Split long sections at heading pages when possible — not a blind every-4-pages grid. */
function splitLongSection(sec, banned) {
  const span = sec.endPage - sec.startPage + 1;
  if (span <= SPLIT_OVER) return [sec];

  const out = [];
  let startIdx = 0;
  const pages = sec.pages || [];
  while (startIdx < pages.length) {
    const remaining = pages.length - startIdx;
    if (remaining <= SPLIT_OVER) {
      const last = sliceSectionPages(sec, startIdx, pages.length, banned);
      if (last) out.push(last);
      break;
    }
    const minEnd = startIdx + TARGET_MIN - 1;
    const idealEnd = startIdx + TARGET_MAX - 1;
    const maxEnd = Math.min(pages.length - 1, startIdx + TARGET_MAX + 2);

    let splitAt = idealEnd; // inclusive index of last page in this piece
    // Prefer splitting just before a later heading in the window
    for (let j = Math.min(maxEnd + 1, pages.length - 1); j > minEnd; j -= 1) {
      if (pageHasSectionBreak(pages[j].text, banned, sec.unitTitle)) {
        splitAt = j - 1;
        break;
      }
    }
    // Or if the ideal page itself introduces a new heading and we're far enough
    if (
      splitAt === idealEnd
      && idealEnd + 1 < pages.length
      && pageHasSectionBreak(pages[idealEnd + 1].text, banned, sec.unitTitle)
    ) {
      splitAt = idealEnd;
    }
    if (splitAt < minEnd) splitAt = Math.min(idealEnd, pages.length - 1);

    const piece = sliceSectionPages(sec, startIdx, splitAt + 1, banned);
    if (piece) out.push(piece);
    startIdx = splitAt + 1;
  }
  return out.length ? out : [sec];
}

function firstContentSnippet(text, banned) {
  const lines = pageLines(text);
  for (const line of lines) {
    if (line.length < 18) continue;
    if (isJunkHeading(line, banned)) continue;
    if (/^(chapter|part|unit|section|prologue|epilogue)\b/i.test(line)) continue;
    if (/^\d+\.\s+[A-ZÀ-ÖØ-Þ]/.test(line) && line.length < 60) continue;
    // Prefer a sentence-like content line over a header.
    if (/[a-z]/.test(line) && /[A-Za-z]/.test(line)) {
      return line.replace(/\s+/g, ' ').slice(0, 90);
    }
  }
  // Looser fallback: any non-junk line with letters
  for (const line of lines) {
    if (line.length < 8 || line.length > 120) continue;
    if (isJunkHeading(line, banned)) continue;
    if (/[A-Za-z]/.test(line)) return line.replace(/\s+/g, ' ').slice(0, 90);
  }
  return '';
}

function makeChunkBlurb(text, banned) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // Skip leading heading-like fragment if present
  let body = raw;
  const snip = firstContentSnippet(text, banned);
  if (snip && raw.toLowerCase().includes(snip.toLowerCase().slice(0, 24))) {
    const idx = raw.toLowerCase().indexOf(snip.toLowerCase().slice(0, 24));
    if (idx >= 0 && idx < 120) body = raw.slice(idx);
  }
  // One sentence-ish blurb
  const m = body.match(/^.{24,160}?[\.\!\?](?:\s|$)/);
  const blurb = (m ? m[0] : body.slice(0, 140)).trim();
  return blurb.length > 150 ? blurb.slice(0, 147).trim() + '…' : blurb;
}

function clipQuote(s, maxLen) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1).replace(/\s+\S*$/, '').trim() + '…';
}

/**
 * Book-friendly locator for hard copies (PDF page numbers often disagree).
 * Prefer chapter/section headings; fall back to start/end passage quotes.
 */
function buildReadingRange(text, unitTitle, banned) {
  const raw = String(text || '');
  const lines = pageLines(raw);
  const headings = [];
  lines.forEach((line, i) => {
    const fromBreak = i === 0 || !lines[i - 1] || lines[i - 1].length < 2;
    if (!lineLooksLikeHeading(line, banned, fromBreak)) return;
    if (isJunkHeading(line, banned)) return;
    const cleaned = line.replace(/[?!:.…]+$/g, '').trim();
    if (cleaned.length < 3 || cleaned.length > 90) return;
    if (headings.length && normalizeLine(headings[headings.length - 1]) === normalizeLine(cleaned)) return;
    headings.push(cleaned);
  });
  const prose = lines.filter((l) =>
    l.length >= 35
    && !isJunkHeading(l, banned)
    && !lineLooksLikeHeading(l, banned, true)
  );
  const startQuote = clipQuote(prose[0] || '', 72);
  const endQuote = clipQuote(prose[prose.length - 1] || '', 72);
  const startHead = headings[0] || String(unitTitle || '').trim();
  const endHead = headings.length > 1 ? headings[headings.length - 1] : '';

  if (startHead && endHead && normalizeLine(startHead) !== normalizeLine(endHead)) {
    return 'From “' + startHead + '” through “' + endHead + '”';
  }
  if (startHead && startQuote) {
    return 'Section “' + startHead + '” — begins “' + startQuote + '”';
  }
  if (startHead) return 'Section “' + startHead + '”';
  if (startQuote && endQuote && startQuote !== endQuote) {
    return 'From “' + startQuote + '” … to “' + endQuote + '”';
  }
  if (startQuote) return 'Begins “' + startQuote + '”';
  return String(unitTitle || '').trim() || '';
}

function labelChunk(sec, banned) {
  const text = sec.text || (sec.pages || []).map((p) => p.text).join('\n\n').trim();
  const start = sec.startPage;
  const end = sec.endPage;
  let title = String(sec.unitTitle || '').trim();
  if (isGenericTitle(title) || isJunkHeading(title, banned)) {
    const heading = guessHeading(text, banned);
    if (heading && !isJunkHeading(heading, banned) && !isGenericTitle(heading)) {
      title = heading;
    } else {
      const snip = firstContentSnippet(text, banned);
      title = snip
        ? snip.replace(/[.?!,:;]+\s*$/, '')
        : ('Reading ' + start + '–' + end);
      if (title.length > 70) title = title.slice(0, 67).trim() + '…';
    }
  } else if (title.length > 72) {
    title = title.slice(0, 72).trim() + '…';
  }
  const summary = String(sec.summary || '').trim() || makeChunkBlurb(text, banned);
  const readingRange = String(sec.readingRange || '').trim()
    || buildReadingRange(text, title, banned);
  return {
    partNum: sec.partNum || 0,
    unitTitle: title,
    summary: summary || ('Pages ' + start + '–' + end),
    readingRange,
    startPage: start,
    endPage: end,
    text,
    unitIds: Array.isArray(sec.unitIds) ? sec.unitIds.map(String) : []
  };
}

function buildToc(pages, banned) {
  const toc = [];
  let last = '';
  (pages || []).forEach((p) => {
    const h = guessHeading(p.text, banned);
    if (!h) return;
    const key = normalizeLine(h);
    if (!key || key === last) return;
    // Skip if this heading appears on too many pages (running header leak)
    if (banned && banned.has(key)) return;
    last = key;
    toc.push({ page: p.pageNum, heading: h });
  });
  return toc;
}

function isChapterHeading(title) {
  const t = String(title || '').trim();
  if (!t) return false;
  if (/^(chapter|ch\.?|part|unit)\s*[ivxlc0-9]+/i.test(t)) return true;
  if (/^(prologue|epilogue|introduction|preface|afterword|conclusion)\b/i.test(t)) return true;
  return false;
}

/**
 * Split one PDF page into heading-bounded segments (chapter + subtitles on same page).
 * Only cuts on real headings after blank lines (or page-top chapter/ALL CAPS/Title Case).
 */
function splitPageByHeadings(pageText, banned) {
  const lines = pageLinesWithBreaks(pageText);
  if (!lines.length) return [{ heading: '', text: '' }];
  const cuts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    const afterBlank = i === 0 || !lines[i - 1];
    const nearTop = i <= 4;
    if (!isRealHeading(lines[i], banned)) continue;
    const cleaned = lines[i].replace(/[?!:.…]+$/g, '').trim();
    if (isExplicitChapterHeading(cleaned)) {
      cuts.push({ index: i, heading: cleaned });
      continue;
    }
    // Subtitles: page-top or after blank only
    if (nearTop || afterBlank) cuts.push({ index: i, heading: cleaned });
  }
  if (!cuts.length) {
    return [{ heading: '', text: lines.join('\n').trim() }];
  }
  // If first cut isn't at line 0, keep a lead-in segment under empty heading
  const segments = [];
  if (cuts[0].index > 0) {
    const lead = lines.slice(0, cuts[0].index).join('\n').trim();
    if (lead) segments.push({ heading: '', text: lead });
  }
  for (let c = 0; c < cuts.length; c += 1) {
    const start = cuts[c].index;
    const end = c + 1 < cuts.length ? cuts[c + 1].index : lines.length;
    segments.push({
      heading: cuts[c].heading,
      text: lines.slice(start, end).join('\n').trim()
    });
  }
  return segments.filter((seg) => seg.text);
}

/**
 * Atomic structure units = one heading section each (no page-count merge/split).
 * Classifies chapter vs subtitle so teachers can group within chapters.
 */
function extractStructureUnits(pages) {
  const banned = collectRunningHeaders(pages);
  const raw = [];
  let cur = null;
  (pages || []).forEach((p) => {
    const segments = splitPageByHeadings(p.text, banned);
    segments.forEach((seg) => {
      const heading = String(seg.heading || '').trim();
      const startNew = heading && (!cur || normalizeLine(heading) !== normalizeLine(cur.unitTitle));
      if (!cur || startNew) {
        if (cur) raw.push(cur);
        cur = {
          unitTitle: heading || (cur ? cur.unitTitle : ''),
          startPage: p.pageNum,
          endPage: p.pageNum,
          pages: [{ pageNum: p.pageNum, text: seg.text }]
        };
        // If we opened a continuation with no heading, keep prior title
        if (!heading && raw.length && !cur.unitTitle) {
          cur.unitTitle = raw[raw.length - 1].unitTitle || '';
        }
      } else {
        cur.endPage = p.pageNum;
        cur.pages.push({ pageNum: p.pageNum, text: seg.text });
      }
    });
  });
  if (cur) raw.push(cur);

  let chapterNum = 0;
  let chapterTitle = 'Opening';
  const units = [];
  raw.forEach((sec) => {
    let title = String(sec.unitTitle || '').trim() || ('Section starting p.' + sec.startPage);
    // Drop leftover prose-looking titles (safety net)
    if (isProseFragment(title) && !isExplicitChapterHeading(title)) {
      title = 'Section starting p.' + sec.startPage;
    }
    if (isChapterHeading(title) || isExplicitChapterHeading(title)) {
      chapterNum += 1;
      chapterTitle = title;
    } else if (chapterNum === 0) {
      chapterNum = 1;
      chapterTitle = 'Chapter 1';
    }
    const kind = (isChapterHeading(title) || isExplicitChapterHeading(title)) ? 'chapter' : 'subtitle';
    const label = kind === 'chapter'
      ? title
      : (chapterTitle + ' — ' + title);
    const text = (sec.pages || []).map((pg) => pg.text).join('\n\n').trim();
    units.push({
      id: 'u' + (units.length + 1),
      index: units.length,
      chapterNum,
      chapterTitle,
      title,
      kind,
      label,
      startPage: sec.startPage,
      endPage: sec.endPage,
      text
    });
  });

  const collapsed = collapseWeakStructureUnits(units);
  return { units: collapsed, banned, tocCount: collapsed.length };
}

/**
 * Merge units whose titles still look like body prose into the previous real heading.
 * Caps runaway page-per-scrap splits if any slip past the heading detector.
 */
function collapseWeakStructureUnits(units) {
  const list = Array.isArray(units) ? units : [];
  if (list.length <= 1) return list;
  const out = [];
  list.forEach((u) => {
    const title = String(u.title || '').trim();
    const strong = isExplicitChapterHeading(title)
      || isChapterHeading(title)
      || isStrongSubtitleTitle(title);
    if (!out.length || strong) {
      out.push(Object.assign({}, u, {
        pages: undefined,
        text: u.text || ''
      }));
      return;
    }
    // Weak / placeholder title → absorb into previous unit
    const prev = out[out.length - 1];
    prev.endPage = Math.max(prev.endPage || 0, u.endPage || 0);
    prev.text = [prev.text || '', u.text || ''].filter(Boolean).join('\n\n').trim();
  });
  // Re-index / rebuild labels
  let chapterNum = 0;
  let chapterTitle = 'Opening';
  return out.map((u, i) => {
    const title = String(u.title || '').trim() || ('Section starting p.' + u.startPage);
    if (isChapterHeading(title) || isExplicitChapterHeading(title)) {
      chapterNum += 1;
      chapterTitle = title;
    } else if (chapterNum === 0) {
      chapterNum = 1;
      chapterTitle = 'Chapter 1';
    }
    const kind = (isChapterHeading(title) || isExplicitChapterHeading(title)) ? 'chapter' : 'subtitle';
    return {
      id: 'u' + (i + 1),
      index: i,
      chapterNum,
      chapterTitle,
      title,
      kind,
      label: kind === 'chapter' ? title : (chapterTitle + ' — ' + title),
      startPage: u.startPage,
      endPage: u.endPage,
      text: u.text || ''
    };
  });
}

/**
 * Optional AI pass: refine chapter/subtitle labels from detected headings.
 * When too many units remain (false splits), ask AI which ids are REAL headings
 * and merge the rest into the previous real heading — never invent page ranges.
 */
async function refineStructureWithAi(units, options) {
  if (!units || units.length < 2) return units;
  const pageSpan = Math.max(
    1,
    (units[units.length - 1].endPage || 0) - (units[0].startPage || 0) + 1
  );
  const tooMany = units.length > 40 || units.length > Math.max(24, Math.ceil(pageSpan * 0.55));

  if (tooMany) {
    try {
      const payload = units.map((u) => ({
        id: u.id,
        title: u.title,
        kind: u.kind,
        start_page: u.startPage,
        end_page: u.endPage
      }));
      const prompt = [
        'A PDF heading detector over-split a book into too many scraps.',
        'Return JSON ONLY:',
        '{ "keep_ids": ["u1","u3", ...] }',
        'Rules:',
        '- keep_ids = ONLY real chapter titles or real section/subtitle headings.',
        '- DROP sentence fragments, mid-sentence scraps, and body prose used as titles.',
        '- Keep order. Always keep the first id. Prefer ~1 heading per real chapter/section.',
        '- Typical novels/nonfiction have far fewer headings than pages.',
        'Candidates: ' + JSON.stringify(payload.slice(0, 180))
      ].join('\n');
      const res = await askGemini(prompt, {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        systemInstruction: 'STRICT JSON only. keep_ids must be a subset of candidate ids in order.',
        retries: 1
      });
      const parsed = extractJson(res.text || res.answer || '');
      const keepIds = Array.isArray(parsed && parsed.keep_ids)
        ? parsed.keep_ids.map(String)
        : [];
      const keepSet = new Set(keepIds);
      if (keepSet.size >= 1 && keepSet.size < units.length) {
        const merged = [];
        units.forEach((u, i) => {
          const keep = i === 0 || keepSet.has(String(u.id));
          if (!merged.length || keep) {
            merged.push(Object.assign({}, u, { text: u.text || '' }));
            return;
          }
          const prev = merged[merged.length - 1];
          prev.endPage = Math.max(prev.endPage || 0, u.endPage || 0);
          prev.text = [prev.text || '', u.text || ''].filter(Boolean).join('\n\n').trim();
        });
        units = collapseWeakStructureUnits(merged);
      } else {
        units = collapseWeakStructureUnits(units);
      }
    } catch (e) {
      console.warn('novelStudy structure collapse failed', e.message);
      units = collapseWeakStructureUnits(units);
    }
  }

  if (!units || units.length < 2) return units;
  const payload = units.map((u) => ({
    id: u.id,
    title: u.title,
    kind: u.kind,
    chapter_num: u.chapterNum,
    chapter_title: u.chapterTitle,
    start_page: u.startPage,
    end_page: u.endPage
  }));
  try {
    const prompt = [
      'You organize a book into chapters and subtitles for a teacher.',
      'Return JSON ONLY:',
      '{ "items": [{ "id": string, "chapter_num": number, "chapter_title": string, "title": string, "kind": "chapter"|"subtitle" }] }',
      'Rules:',
      '- Keep the SAME ids and the same order. Do not add/remove items.',
      '- chapter_num must be contiguous starting at 1 where possible.',
      '- Do NOT move a subtitle into a different chapter if that would cross page order oddly; respect page order.',
      '- kind=chapter for major chapter headings; kind=subtitle for sections under a chapter.',
      '- title should be the section heading; chapter_title is the parent chapter name.',
      '- Never invent sentence-fragment titles.',
      'Detected items: ' + JSON.stringify(payload.slice(0, 120))
    ].join('\n');
    const res = await askGemini(prompt, {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      systemInstruction: 'STRICT JSON only. Preserve ids and reading order.',
      retries: 1
    });
    const parsed = extractJson(res.text || res.answer || '');
    const items = (parsed && parsed.items) || [];
    if (!Array.isArray(items) || items.length !== units.length) return units;
    const byId = new Map(items.map((it) => [String(it.id || ''), it]));
    return units.map((u) => {
      const hit = byId.get(String(u.id));
      if (!hit) return u;
      const chapterNum = Math.max(1, Number(hit.chapter_num) || u.chapterNum || 1);
      const chapterTitle = String(hit.chapter_title || u.chapterTitle || '').trim() || u.chapterTitle;
      let title = String(hit.title || u.title || '').trim() || u.title;
      // Reject AI-invented prose titles
      if (isProseFragment(title) && !isExplicitChapterHeading(title)) title = u.title;
      const kind = String(hit.kind || u.kind) === 'chapter' ? 'chapter' : 'subtitle';
      const label = kind === 'chapter' ? title : (chapterTitle + ' — ' + title);
      return Object.assign({}, u, { chapterNum, chapterTitle, title, kind, label });
    });
  } catch (e) {
    console.warn('novelStudy structure refine failed', e.message);
    return units;
  }
}

function tocQuality(toc, pageCount) {
  if (!toc || toc.length < 3) return 'weak';
  const span = toc[toc.length - 1].page - toc[0].page;
  if (toc.length >= 5 && span >= Math.max(20, pageCount * 0.25)) return 'strong';
  if (toc.length >= 3 && span >= 10) return 'ok';
  return 'weak';
}

function cleanBookTitle(raw, fallback) {
  let t = String(raw || fallback || 'Untitled Book').trim();
  t = t.replace(/\((?:z-?library|z-?lib|1lib)[^)]*\)/gi, '');
  t = t.replace(/\b(?:z-?library\.sk|1lib\.sk|z-lib\.sk)\b/gi, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/[_\-]+$/g, '').trim();
  return t.slice(0, 160) || 'Untitled Book';
}

function guessGenreFromText(title, author, options) {
  const blob = [
    title, author, options && options.genre, options && options.fallbackTitle
  ].map((x) => String(x || '')).join(' ').toLowerCase();
  if (options && options.genre === 'nonfiction') return 'nonfiction';
  if (options && options.genre === 'fiction') return 'fiction';
  if (/non[- ]?fiction|harari|history|science|biography|memoir|argument|how humans|true story/.test(blob)) {
    return 'nonfiction';
  }
  if (/novel|fiction|story of|fairy|fantasy|mystery/.test(blob)) return 'fiction';
  return 'fiction';
}

function planChunksHeuristic(pages) {
  const banned = collectRunningHeaders(pages);
  const raw = [];
  let cur = null;
  pages.forEach((p) => {
    const mid = cur ? findMidPageHeadingBreak(p.text, banned, cur.unitTitle) : null;
    if (mid && cur) {
      if (mid.beforeText) {
        cur.pages.push({ pageNum: p.pageNum, text: mid.beforeText });
        cur.endPage = p.pageNum;
      }
      raw.push(cur);
      cur = {
        unitTitle: mid.heading,
        startPage: p.pageNum,
        endPage: p.pageNum,
        pages: [{ pageNum: p.pageNum, text: mid.afterText }]
      };
      return;
    }

    const heading = guessHeading(p.text, banned);
    const startNew = heading && (!cur || normalizeLine(heading) !== normalizeLine(cur.unitTitle));
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
      if (!prev.unitTitle && sec.unitTitle) prev.unitTitle = sec.unitTitle;
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
    splitLongSection(sec, banned).forEach((piece) => split.push(piece));
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

  const carved = carveAdjacentSections(finalSecs, banned);
  return carved.map((sec, idx) => labelChunk({
    partNum: idx + 1,
    unitTitle: sec.unitTitle,
    startPage: sec.startPage,
    endPage: sec.endPage,
    pages: sec.pages,
    text: sec.pages.map((p) => p.text).join('\n\n').trim()
  }, banned));
}

/**
 * Ask Gemini only for book meta + better titles/summaries (boundaries stay fixed).
 * Batches to avoid truncated JSON on long books.
 */
async function enrichChunkLabelsWithGemini(chunks, metaSeed, options, toc) {
  const banned = new Set(); // titles already cleaned
  const out = chunks.map((c) => Object.assign({}, c));
  const batchSize = 12;
  for (let i = 0; i < out.length; i += batchSize) {
    const batch = out.slice(i, i + batchSize);
    const payload = batch.map((c) => ({
      part_num: c.partNum,
      start_page: c.startPage,
      end_page: c.endPage,
      current_title: c.unitTitle,
      preview: String(c.text || '').replace(/\s+/g, ' ').trim().slice(0, 380)
    }));
    const prompt = [
      'You label Novel Study worksheet sections for teachers.',
      'Return JSON ONLY: { "items": [{ "part_num": number, "unit_title": string, "summary": string }] }',
      'Rules:',
      '- Keep the SAME part_num values. Do not add/remove parts or change page ranges.',
      '- unit_title: short descriptive section title (chapter/section name OR a clear topic title).',
      '- NEVER use titles like "Pages 1–4", "Part 3", or only a page range.',
      '- NEVER label title pages, copyright, contents, dedication, acknowledgments, about the author, publishing info, index, or other front/back matter.',
      '- summary: one plain sentence (max 140 chars) describing what students read in that range.',
      '- Prefer real chapter/section names when the preview shows them.',
      metaSeed && metaSeed.title ? ('Book: ' + metaSeed.title) : '',
      toc && toc.length
        ? ('Detected headings TOC (hint): ' + JSON.stringify(toc.slice(0, 60)))
        : '',
      'Sections to label: ' + JSON.stringify(payload)
    ].filter(Boolean).join('\n');

    try {
      const res = await askGemini(prompt, {
        temperature: 0.2,
        maxOutputTokens: 3072,
        responseMimeType: 'application/json',
        systemInstruction: 'STRICT JSON only. Descriptive titles required. No page-range-only titles.',
        retries: 1
      });
      const parsed = extractJson(res.text || res.answer || '');
      const items = (parsed && (parsed.items || parsed.chunks)) || [];
      if (!Array.isArray(items) || !items.length) continue;
      const byPart = new Map();
      items.forEach((it) => {
        const n = Number(it.part_num || it.partNum);
        if (!n) return;
        byPart.set(n, it);
      });
      batch.forEach((c) => {
        const hit = byPart.get(c.partNum);
        if (!hit) return;
        let title = String(hit.unit_title || hit.unitTitle || '').trim();
        let summary = String(hit.summary || hit.blurb || '').trim();
        if (title && !isGenericTitle(title) && !isJunkHeading(title, banned)) {
          c.unitTitle = title.length > 72 ? title.slice(0, 72).trim() + '…' : title;
        }
        if (summary) {
          c.summary = summary.length > 160 ? summary.slice(0, 157).trim() + '…' : summary;
        }
      });
    } catch (e) {
      console.warn('novelStudy label enrich batch failed', i, e.message);
    }
  }
  return out.map((c) => labelChunk(c, banned));
}

async function detectBookMetaWithGemini(pages, options, toc) {
  const sample = [];
  const step = Math.max(1, Math.floor(pages.length / 10));
  for (let i = 0; i < pages.length && sample.length < 12; i += step) {
    sample.push({
      page: pages[i].pageNum,
      preview: String(pages[i].text || '').slice(0, 350)
    });
  }
  // Always include opening pages (title/copyright)
  pages.slice(0, 3).forEach((p) => {
    if (!sample.some((s) => s.page === p.pageNum)) {
      sample.unshift({ page: p.pageNum, preview: String(p.text || '').slice(0, 350) });
    }
  });

  const prompt = [
    'Identify this book from PDF text samples.',
    'Return JSON ONLY: { "title": string, "author": string, "genre": "fiction"|"nonfiction" }',
    'Filename hint: ' + String(options.fallbackTitle || ''),
    'Requested genre hint: ' + String(options.genre || 'auto'),
    'TOC headings: ' + JSON.stringify((toc || []).slice(0, 40)),
    'Samples: ' + JSON.stringify(sample.slice(0, 14))
  ].join('\n');

  try {
    const res = await askGemini(prompt, {
      temperature: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      systemInstruction: 'STRICT JSON only. Prefer nonfiction when the text is history/science/essay.',
      retries: 1
    });
    const parsed = extractJson(res.text || res.answer || '');
    if (!parsed) return null;
    const title = cleanBookTitle(parsed.title || options.fallbackTitle, options.fallbackTitle);
    const author = String(parsed.author || 'Unknown').replace(/\(.*?etc\.?\)/gi, '').trim() || 'Unknown';
    const genre = guessGenreFromText(title, author, {
      genre: parsed.genre || options.genre,
      fallbackTitle: options.fallbackTitle
    });
    return { title, author, genre };
  } catch (e) {
    console.warn('novelStudy meta detect failed', e.message);
    return null;
  }
}

async function proposeBoundariesWithGemini(pages, options, toc) {
  const banned = collectRunningHeaders(pages);
  const outline = [];
  pages.forEach((p, idx) => {
    const heading = guessHeading(p.text, banned) || null;
    // Always include heading pages; otherwise every 2nd page for coverage
    if (heading || idx % 2 === 0 || idx < 3 || idx >= pages.length - 2) {
      outline.push({
        page: p.pageNum,
        heading,
        preview: String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
      });
    }
  });

  const targetN = Math.max(0, Number(options && options.targetChunks) || 0);
  const softN = Math.max(0, Number(options && options.softTargetChunks) || 0);
  let countRule;
  let systemInstruction;
  if (targetN >= 2) {
    countRule = '- Create EXACTLY ' + targetN +
      ' sections (teacher requested worksheet count). Prefer natural heading breaks; otherwise split at sensible paragraph/topic shifts.';
    systemInstruction = 'STRICT JSON only. Return exactly ' + targetN + ' heading-aware sections.';
  } else if (softN >= 2) {
    countRule = '- Aim for about ' + softN +
      ' sections (±2 is OK). Prefer chapter/subtitle/meaning boundaries over hitting the number exactly. Never cut mid-paragraph or mid-scene when a nearby heading exists.';
    systemInstruction = 'STRICT JSON only. Prefer meaning-aligned boundaries near ' + softN + ' sections; exact count is secondary.';
  } else {
    countRule = '- Do NOT make every section exactly 4 pages. Typical length is ' +
      TARGET_MIN + '-' + (TARGET_MAX + 2) + ' pages.';
    systemInstruction = 'STRICT JSON only. Prefer heading-aligned boundaries. Avoid uniform page grids.';
  }
  const prompt = [
    'Plan Novel/Book Study reading sections for one class period each.',
    'Return JSON ONLY:',
    '{ "sections": [{ "unit_title": string, "start_page": number, "end_page": number }] }',
    'Rules:',
    '- Align starts to REAL chapter/section headings whenever the outline shows them.',
    countRule,
    '- Never invent page numbers outside ' + pages[0].pageNum + '..' + pages[pages.length - 1].pageNum + '.',
    '- Cover the whole book body with contiguous, non-overlapping sections.',
    '- unit_title must be descriptive (chapter/section name or clear topic). Never "Pages 12–15".',
    '- Skip title/copyright/contents and back matter (acknowledgments, about the author, publishing info, index, credits) if they appear.',
    '- Do not create sections for acknowledgments, credits, or publishing information.',
    'Detected headings: ' + JSON.stringify((toc || []).slice(0, 80)),
    'Page outline: ' + JSON.stringify(outline.slice(0, 120))
  ].join('\n');

  const res = await askGemini(prompt, {
    temperature: 0.15,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    systemInstruction,
    retries: 1
  });
  const parsed = extractJson(res.text || res.answer || '');
  const sections = (parsed && (parsed.sections || parsed.chunks)) || [];
  if (!Array.isArray(sections) || sections.length < 2) {
    throw new Error('no section boundaries');
  }

  const pageMin = pages[0].pageNum;
  const pageMax = pages[pages.length - 1].pageNum;
  const byNum = new Map(pages.map((p) => [p.pageNum, p]));
  const pageNums = pages.map((p) => p.pageNum);
  const indexOf = new Map(pageNums.map((n, i) => [n, i]));
  const normalized = sections.map((s, i) => {
    let start = Math.max(pageMin, Math.min(pageMax, Number(s.start_page || s.startPage) || pageMin));
    let end = Math.max(start, Math.min(pageMax, Number(s.end_page || s.endPage) || start));
    // Only clamp runaway spans when neither hard nor soft target is set.
    // Truncating here was a primary gap source (next section kept its original start).
    if (targetN < 2 && softN < 2 && end - start + 1 > TARGET_MAX + 3) {
      end = start + TARGET_MAX + 1;
    }
    return {
      order: i,
      unitTitle: String(s.unit_title || s.unitTitle || '').trim(),
      startPage: start,
      endPage: end
    };
  }).sort((a, b) => a.startPage - b.startPage || a.order - b.order);

  // Resolve overlaps (later start wins) and fill gaps so coverage is contiguous
  // over the body page list (not merely numeric end+1 when pages are sparse).
  if (normalized.length) {
    normalized[0].startPage = pageMin;
    for (let i = 1; i < normalized.length; i += 1) {
      const prev = normalized[i - 1];
      const cur = normalized[i];
      const prevEndIdx = indexOf.has(prev.endPage) ? indexOf.get(prev.endPage) : -1;
      let curStartIdx = indexOf.has(cur.startPage) ? indexOf.get(cur.startPage) : -1;
      if (curStartIdx < 0) {
        // Snap start to nearest existing body page at/after claimed start.
        curStartIdx = pageNums.findIndex((n) => n >= cur.startPage);
        if (curStartIdx < 0) curStartIdx = pageNums.length - 1;
        cur.startPage = pageNums[curStartIdx];
      }
      if (prevEndIdx >= 0 && curStartIdx <= prevEndIdx) {
        // Overlap: push current start to the page after previous end.
        const nextIdx = prevEndIdx + 1;
        if (nextIdx >= pageNums.length) {
          cur.startPage = pageMax;
          cur.endPage = pageMax;
        } else {
          cur.startPage = pageNums[nextIdx];
        }
      } else if (prevEndIdx >= 0 && curStartIdx > prevEndIdx + 1) {
        // Gap: extend previous section through the page before current start.
        prev.endPage = pageNums[curStartIdx - 1];
      }
      if (cur.startPage > cur.endPage) cur.endPage = cur.startPage;
    }
    normalized[normalized.length - 1].endPage = pageMax;
  }

  const chunks = [];
  normalized.forEach((sec, idx) => {
    if (sec.startPage > pageMax || sec.endPage < pageMin) return;
    const slice = [];
    for (let p = sec.startPage; p <= sec.endPage; p += 1) {
      if (byNum.has(p)) slice.push(byNum.get(p));
    }
    if (!slice.length) return;
    const text = slice.map((p) => p.text).join('\n\n').trim();
    // Do not drop short sections — that created gaps. Keep them; callers may merge.
    chunks.push(labelChunk({
      unitTitle: sec.unitTitle || ('Part ' + (idx + 1)),
      startPage: slice[0].pageNum,
      endPage: slice[slice.length - 1].pageNum,
      pages: slice,
      text
    }, banned));
  });

  if (chunks.length < 2) throw new Error('boundary chunks too few');
  // Final safety: absorb any remaining uncovered body pages into neighbors.
  let sectionsOut = rematerializeSectionPages(chunks, pages);
  if (!sectionsCoverAllBody(sectionsOut, pages)) {
    sectionsOut = ensureContiguousBodyCoverage(sectionsOut, pages, banned);
  }
  const fixed = sectionsOut.map((sec, i) => labelChunk({
    partNum: i + 1,
    unitTitle: sec.unitTitle,
    summary: sec.summary || '',
    startPage: sec.startPage,
    endPage: sec.endPage,
    pages: sec.pages,
    text: sec.text
  }, banned));
  if (fixed.length < 2) throw new Error('boundary chunks too few');
  return fixed;
}

async function planChunksWithGemini(pages, options, onProgress) {
  const report = (pct, message) => {
    if (typeof onProgress === 'function') {
      try { onProgress(pct, message); } catch (_) { /* ignore */ }
    }
  };

  report(12, 'Skipping front matter…');
  const trimmed = trimToBookBody(pages);
  const bodyPages = trimmed.pages;
  const targetN = Math.max(0, Number(options && options.targetChunks) || 0);
  const planOpts = Object.assign({}, options || {});

  report(22, 'Detecting chapter and section headings…');
  const banned = collectRunningHeaders(bodyPages);
  const toc = buildToc(bodyPages, banned);
  let quality = tocQuality(toc, bodyPages.length);
  let chunks = planChunksHeuristic(bodyPages);
  let planMode = quality === 'strong' || quality === 'ok'
    ? 'chapter-aware'
    : 'page-groups';
  let suggestion = null;
  let softTarget = 0;

  report(38, 'Identifying book title and author…');
  let meta = await detectBookMetaWithGemini(pages, planOpts, toc);
  if (!meta) {
    meta = {
      title: cleanBookTitle(planOpts.fallbackTitle, 'Untitled Book'),
      author: 'Unknown',
      genre: guessGenreFromText(planOpts.fallbackTitle, '', planOpts)
    };
  }

  if (targetN < 2) {
    report(48, 'Asking AI for a natural worksheet count (about 10–20)…');
    suggestion = await suggestWorksheetCountWithGemini(bodyPages, toc, planOpts);
    softTarget = suggestion.suggestedCount;
    planOpts.softTargetChunks = softTarget;
    report(52, 'Planning ~' + softTarget + ' worksheets along chapter/section boundaries…');
  }

  // Hard target, AI-auto soft target, weak TOC, or uniform 4-page grids → AI boundaries.
  const spans = chunks.map((c) => c.endPage - c.startPage + 1);
  const mostlyFour = spans.length >= 6 &&
    spans.filter((n) => n === TARGET_MAX).length >= Math.ceil(spans.length * 0.7);
  const needAiBoundaries = targetN >= 2 || softTarget >= 2 || quality === 'weak' || mostlyFour;
  if (needAiBoundaries) {
    if (targetN >= 2) {
      report(52, 'Asking AI to split the book into ' + targetN + ' worksheets…');
    } else if (softTarget >= 2) {
      report(55, 'Asking AI to align ~' + softTarget + ' sections to meaning boundaries…');
    } else {
      report(52, 'Asking AI to align sections to chapter/section headings…');
    }
    try {
      const aiChunks = await proposeBoundariesWithGemini(bodyPages, planOpts, toc);
      if (aiChunks && aiChunks.length >= 2) {
        chunks = aiChunks;
        planMode = targetN >= 2
          ? 'target-count'
          : (softTarget >= 2 ? 'ai-suggested' : 'chapter-aware');
        quality = 'ok';
      }
    } catch (e) {
      console.warn('novelStudy boundary proposal failed', e.message);
    }
  }

  // Rematerialize page lists, carve mid-page heading tails, fit target count.
  report(64, 'Refining page boundaries…');
  if (targetN >= 2) {
    // Teacher count is authoritative — do not keep a 100+ heading-slice plan.
    report(64, 'Fitting plan to ' + targetN + ' worksheets…');
    chunks = enforceTargetChunkCount(chunks, bodyPages, targetN, banned, toc);
    planMode = 'target-count';
  } else {
    let sections = rematerializeSectionPages(chunks, bodyPages);
    if (!sectionsCoverAllBody(sections, bodyPages)) {
      sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
    }
    sections = carveAdjacentSections(sections, banned);
    if (softTarget >= 2) {
      report(66, 'Nudging toward ~' + softTarget + ' worksheets without mid-scene cuts…');
      sections = softFitTowardCount(sections, softTarget, banned, 2);
      if (!sectionsCoverAllBody(sections, bodyPages)) {
        sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
      }
      planMode = 'ai-suggested';
    }
    chunks = sections.map((sec, idx) => labelChunk({
      partNum: idx + 1,
      unitTitle: sec.unitTitle,
      summary: sec.summary || '',
      startPage: sec.startPage,
      endPage: sec.endPage,
      pages: sec.pages,
      text: sec.text
    }, banned));
  }

  report(72, 'Writing section titles and blurbs…');
  try {
    chunks = await enrichChunkLabelsWithGemini(chunks, meta, planOpts, toc);
  } catch (e) {
    console.warn('novelStudy enrich labels failed', e.message);
    chunks = chunks.map((c) => labelChunk(c, banned));
  }

  report(90, 'Finalizing chunk plan…');
  chunks = chunks
    .map((c, i) => {
      const labeled = labelChunk(Object.assign({}, c, { partNum: i + 1 }), banned);
      labeled.planMode = planMode;
      return labeled;
    })
    .filter((c) => !isNonContentChunk(c));
  chunks.forEach((c, i) => { c.partNum = i + 1; });

  // Teacher-requested count wins: re-enforce after back-matter filters.
  // Also repair page gaps created by dropping non-content chunks.
  if (targetN >= 2) {
    if (chunks.length !== targetN || !sectionsCoverAllBody(rematerializeSectionPages(chunks, bodyPages), bodyPages)) {
      chunks = enforceTargetChunkCount(chunks, bodyPages, targetN, banned, toc);
      chunks.forEach((c, i) => {
        c.partNum = i + 1;
        c.planMode = 'target-count';
      });
      planMode = 'target-count';
    }
  } else {
    let sections = rematerializeSectionPages(chunks, bodyPages);
    if (!sectionsCoverAllBody(sections, bodyPages)) {
      sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
      sections = carveAdjacentSections(sections, banned);
    }
    if (softTarget >= 2) {
      sections = softFitTowardCount(sections, softTarget, banned, 2);
      if (!sectionsCoverAllBody(sections, bodyPages)) {
        sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
      }
      planMode = 'ai-suggested';
    }
    chunks = sections.map((sec, idx) => labelChunk({
      partNum: idx + 1,
      unitTitle: sec.unitTitle,
      summary: sec.summary || '',
      startPage: sec.startPage,
      endPage: sec.endPage,
      pages: sec.pages,
      text: sec.text
    }, banned));
    chunks.forEach((c) => { c.planMode = planMode; });
  }

  if (!chunks.length) {
    chunks = (targetN >= 2
      ? evenSplitPages(bodyPages, targetN, banned).map((sec, i) => labelChunk({
        partNum: i + 1,
        unitTitle: sec.unitTitle,
        summary: '',
        startPage: sec.startPage,
        endPage: sec.endPage,
        pages: sec.pages,
        text: sec.text
      }, banned))
      : (softTarget >= 2
        ? softFitTowardCount(
          rematerializeSectionPages(planChunksHeuristic(bodyPages), bodyPages),
          softTarget,
          banned,
          2
        )
        : planChunksHeuristic(bodyPages)
      )
        .filter((c) => !isNonContentChunk(c))
        .map((c, i) => Object.assign(labelChunk(c, banned), { partNum: i + 1 }))
    );
    chunks.forEach((c, i) => {
      c.partNum = i + 1;
      c.planMode = planMode;
    });
  }

  // Last-resort contiguous cover (heuristic fallback can still gap after filters).
  {
    let sections = rematerializeSectionPages(chunks, bodyPages);
    if (sections.length && !sectionsCoverAllBody(sections, bodyPages)) {
      if (targetN >= 2) {
        chunks = enforceTargetChunkCount(chunks, bodyPages, targetN, banned, toc);
      } else {
        sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
        if (softTarget >= 2) {
          sections = softFitTowardCount(sections, softTarget, banned, 2);
          if (!sectionsCoverAllBody(sections, bodyPages)) {
            sections = ensureContiguousBodyCoverage(sections, bodyPages, banned);
          }
        }
        chunks = sections.map((sec, idx) => labelChunk({
          partNum: idx + 1,
          unitTitle: sec.unitTitle,
          summary: sec.summary || '',
          startPage: sec.startPage,
          endPage: sec.endPage,
          pages: sec.pages,
          text: sec.text
        }, banned));
      }
      chunks.forEach((c, i) => {
        c.partNum = i + 1;
        c.planMode = planMode;
      });
    }
  }

  const planReport = buildPlanReport({
    mode: planMode,
    suggestedCount: softTarget || (suggestion && suggestion.suggestedCount) || 0,
    finalCount: chunks.length,
    hardTarget: targetN,
    criteria: suggestion && suggestion.criteria,
    summary: suggestion && suggestion.summary,
    notes: suggestion && suggestion.notes,
    howSplit: targetN >= 2
      ? ('Fitted exactly to ' + targetN +
        ' teacher-requested worksheets; boundaries snapped to nearby headings when possible.')
      : (softTarget >= 2
        ? ('AI suggested ~' + softTarget + ' worksheets from chapters/subtitles; final plan has ' +
          chunks.length + ' parts using meaning boundaries (exact count not forced).')
        : 'Aligned to detected chapter/section headings where possible.'),
    headingCount: toc.length,
    skippedFront: trimmed.skippedFront || 0,
    skippedBack: trimmed.skippedBack || 0,
    source: suggestion ? suggestion.source : (targetN >= 2 ? 'teacher' : 'heuristic')
  });

  return {
    meta,
    planMode,
    planReport,
    tocCount: toc.length,
    skippedFront: trimmed.skippedFront || 0,
    skippedBack: trimmed.skippedBack || 0,
    chunks
  };
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
    options.reflectionCount > 0
      ? [
        'For each reflection item, pick the SINGLE best prompt type for THIS section among:',
        'personal_reflection, critical_thinking, factual, inference.',
        'Do NOT default to personal reflection — choose whichever fits the text best.',
        'Each reflection item must include: type, question, sampleAnswer, evidenceQuote.',
        'The question must invite about one paragraph of writing (roughly 5–8 sentences), grounded in the section.'
      ].join(' ')
      : 'Set reflection to an empty array [].',
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
        exampleSentence: String(v.exampleSentence || v.example_sentence || '').trim(),
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
    .map((q) => {
      const rawType = String(q.type || q.promptType || '').trim().toLowerCase().replace(/\s+/g, '_');
      const allowed = ['personal_reflection', 'critical_thinking', 'factual', 'inference'];
      const type = allowed.includes(rawType)
        ? rawType
        : (rawType.includes('critical') ? 'critical_thinking'
          : rawType.includes('fact') ? 'factual'
            : rawType.includes('infer') ? 'inference'
              : rawType.includes('reflect') || rawType.includes('personal') ? 'personal_reflection'
                : 'critical_thinking');
      return {
        type,
        question: String(q.question || '').trim(),
        sampleAnswer: String(q.sampleAnswer || '').trim(),
        evidenceQuote: String(q.evidenceQuote || '').trim()
      };
    })
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
    readingRange: chunk.readingRange || '',
    startPage: chunk.startPage,
    endPage: chunk.endPage,
    vocab,
    multipleChoice,
    shortAnswer,
    reflection,
    groundingScore: Math.round(ratio * 100)
  };
}

/**
 * After all worksheets exist, pick useful academic / harder words per section.
 * Prefer 3–5; may exceed (up to 8) for essential elementary learning words.
 * exampleSentence is newly written for students (not copied from the book).
 */
async function extractSectionVocab(chunk, meta, options, usedWords) {
  const target = Math.max(3, Math.min(5, Number(options.vocabCount) || 4));
  const maxN = 8;
  const level = LEVELS[options.level] || LEVELS.middle;
  const avoid = Array.from(usedWords || []).slice(0, 120);
  const prompt = [
    'Extract vocabulary for an elementary/middle Novel Study worksheet section.',
    'Book: ' + ((meta && meta.title) || 'Untitled') + ' by ' + ((meta && meta.author) || 'Unknown'),
    'Section: ' + chunk.unitTitle + ' (pages ' + chunk.startPage + '–' + chunk.endPage + ')',
    'Audience: ' + level.prompt,
    'Return JSON ONLY:',
    '{ "vocab": [{ "word", "partOfSpeech", "definition", "exampleSentence", "evidenceQuote" }] }',
    'Rules:',
    '- Pick about ' + target + ' words students may not know well (academic, precise, or slightly hard).',
    '- You MAY include up to ' + maxN + ' if there are extra essential words for young readers of this book.',
    '- Prefer words that actually appear in section_text. evidenceQuote must be a short phrase from the text containing the word.',
    '- definition: short student-friendly English.',
    '- exampleSentence: invent a NEW clear classroom sentence using the word (do NOT copy from the book).',
    '- Avoid duplicates of these already-used words: ' + JSON.stringify(avoid),
    '- Avoid names, tiny function words, and ultra-common words (said, went, like, very).',
    'section_text:',
    String(chunk.text || '').replace(/\s+/g, ' ').trim().slice(0, 14000)
  ].join('\n');

  const res = await askGemini(prompt, {
    temperature: 0.3,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json',
    systemInstruction: 'Output valid JSON only. Create original example sentences for learners.',
    retries: 1
  });
  const parsed = extractJson(res.text || res.answer || '');
  const rows = Array.isArray(parsed && parsed.vocab) ? parsed.vocab : [];
  const out = [];
  const local = new Set();
  rows.forEach((v) => {
    if (out.length >= maxN) return;
    const word = String(v.word || '').trim();
    const key = word.toLowerCase();
    if (!word || key.length < 3 || local.has(key) || (usedWords && usedWords.has(key))) return;
    local.add(key);
    out.push({
      word,
      partOfSpeech: String(v.partOfSpeech || v.pos || '').trim(),
      definition: String(v.definition || '').trim(),
      exampleSentence: String(v.exampleSentence || v.example_sentence || '').trim(),
      exampleFromText: String(v.evidenceQuote || v.exampleFromText || '').trim(),
      evidenceQuote: String(v.evidenceQuote || '').trim()
    });
  });
  if (out.length < 3) {
    // Soft fallback from snippet words if model under-delivers
    const extras = pickSnippetWords(chunk.text, target);
    extras.forEach((word) => {
      if (out.length >= target) return;
      const key = word.toLowerCase();
      if (local.has(key) || (usedWords && usedWords.has(key))) return;
      local.add(key);
      out.push({
        word,
        partOfSpeech: '',
        definition: 'A useful word from this section.',
        exampleSentence: 'We practiced the word "' + word + '" in class today.',
        exampleFromText: '',
        evidenceQuote: ''
      });
    });
  }
  return out;
}

async function enrichPartsVocabulary(job) {
  const wanted = Math.max(0, Number(job.options && job.options.vocabCount) || 0);
  if (!wanted) {
    (job.parts || []).forEach((p) => { p.vocab = []; });
    return;
  }
  const used = new Set();
  const total = (job.parts || []).length;
  for (let i = 0; i < total; i += 1) {
    const chunk = job.chunks[i];
    const part = job.parts[i];
    if (!chunk || !part) continue;
    touch(job, {
      message: 'Collecting vocabulary for the front list (' + (i + 1) + '/' + total + ')…',
      progress: 82 + Math.floor((i / Math.max(1, total)) * 6)
    });
    emit(job, 'status', toPublicJob(job, { includeParts: true }));
    try {
      const vocab = await extractSectionVocab(chunk, job.meta, job.options, used);
      part.vocab = vocab;
      vocab.forEach((v) => {
        const key = String(v.word || '').toLowerCase();
        if (key) used.add(key);
      });
    } catch (e) {
      console.warn('novelStudy vocab enrich failed part', i + 1, e.message);
      part.vocab = part.vocab || [];
    }
    touch(job, { parts: job.parts });
    emit(job, 'part', {
      partNum: part.partNum,
      partsDone: i + 1,
      partsTotal: total,
      message: 'Vocabulary ready for part ' + (i + 1) + '/' + total,
      part: summarizePartPreview(part),
      job: toPublicJob(job, { includeParts: true })
    });
    if (i < total - 1) await sleep(Math.min(PART_DELAY_MS, 1500));
  }
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
    throw httpError('AI is not configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY).', 503);
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
    progress: 3,
    message: 'Upload received — starting PDF parse…',
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
    originalName: String(file.originalname || 'book.pdf'),
    error: null,
    listeners: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  jobs.set(jobId, job);
  schedulePersist(job, true);
  return toPublicJob(job);
}

async function runPlanning(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (job.status === 'structure_ready' && (job.structureUnits || []).length) {
    return toPublicJob(job);
  }
  if (job.status === 'ready' && (job.chunks || []).length) {
    return toPublicJob(job);
  }
  if (job.status === 'planning' && job.planningStarted) {
    return toPublicJob(job);
  }

  const bump = (pct, message, extra) => {
    touch(job, Object.assign({
      progress: pct,
      message
    }, extra || {}));
    emit(job, 'status', toPublicJob(job));
  };

  try {
    job.planningStarted = true;
    bump(5, 'Parsing PDF text…', { status: 'parsing', error: null });

    let pdfBuffer = null;
    if (job.pdfPath && fs.existsSync(job.pdfPath)) {
      pdfBuffer = fs.readFileSync(job.pdfPath);
    }
    if (!pdfBuffer || !pdfBuffer.length) {
      throw httpError('Uploaded PDF is missing. Please upload again.', 400);
    }

    const extracted = await extractPages(pdfBuffer);
    bump(18, 'PDF parsed (' + extracted.pageCount + ' pages). Finding chapters & subtitles…', {
      status: 'planning',
      pages: extracted.pages,
      pageCount: extracted.pageCount
    });

    const fallbackTitle = cleanBookTitle(
      path.basename(String(job.originalName || 'book.pdf'), '.pdf'),
      'Untitled Book'
    );
    const planOpts = {
      level: job.options.level,
      genre: job.options.genre === 'auto' ? '' : job.options.genre,
      fallbackTitle
    };

    bump(35, 'Skipping front/back matter…');
    const trimmed = trimToBookBody(extracted.pages);
    bump(50, 'Detecting chapter and subtitle headings…');
    let extractedUnits = extractStructureUnits(trimmed.pages);
    let units = extractedUnits.units;

    bump(65, 'Identifying book title and author…');
    let meta = await detectBookMetaWithGemini(extracted.pages, planOpts, units.map((u) => ({
      page: u.startPage,
      heading: u.title
    })));
    if (!meta) {
      meta = {
        title: cleanBookTitle(fallbackTitle, 'Untitled Book'),
        author: 'Unknown',
        genre: guessGenreFromText(fallbackTitle, '', planOpts)
      };
    }
    if (job.options.genre === 'fiction' || job.options.genre === 'nonfiction') {
      meta.genre = job.options.genre;
    }

    bump(80, 'Organizing chapter → subtitle list…');
    units = await refineStructureWithAi(units, planOpts);

    cleanupJobFiles(job);
    touch(job, {
      status: 'structure_ready',
      progress: 100,
      message: 'Structure ready — ' + units.length +
        ' sections found. Click to group them into worksheet parts.',
      meta,
      structureUnits: units,
      chunks: [],
      planMode: 'teacher-groups',
      planReport: null,
      tocCount: units.length,
      skippedFront: trimmed.skippedFront || 0,
      skippedBack: trimmed.skippedBack || 0,
      pages: null,
      planningStarted: false,
      error: null
    });
    emit(job, 'status', toPublicJob(job));
    emit(job, 'structure', toPublicJob(job));
    return toPublicJob(job);
  } catch (e) {
    cleanupJobFiles(job);
    touch(job, {
      status: 'error',
      progress: 100,
      message: e.message || 'Structure analysis failed.',
      error: e.message || 'Structure analysis failed.',
      planningStarted: false
    });
    emit(job, 'error', toPublicJob(job));
    throw e;
  }
}

/**
 * Teacher-defined groups of structure unit ids → worksheet chunks.
 * body.groups = [{ unitIds: ['u1','u2'], title?: string }]
 */
function applyTeacherGroups(jobId, teacherId, body) {
  const job = getJob(jobId, teacherId);
  if (!['structure_ready', 'ready'].includes(String(job.status || ''))) {
    throw httpError('Group sections after structure analysis finishes.', 409);
  }
  const units = Array.isArray(job.structureUnits) ? job.structureUnits : [];
  if (!units.length) throw httpError('No structure units to group. Re-upload the PDF.', 400);

  const groups = Array.isArray(body && body.groups) ? body.groups : [];
  if (groups.length < 1) throw httpError('Add at least one worksheet group.', 400);

  const byId = new Map(units.map((u) => [String(u.id), u]));
  const seen = new Set();
  const orderedIds = [];
  const chunks = [];

  groups.forEach((g, gi) => {
    const ids = Array.isArray(g && g.unitIds)
      ? g.unitIds.map(String)
      : (Array.isArray(g && g.unitIndexes)
        ? g.unitIndexes.map((n) => {
          const u = units[Number(n)];
          return u ? String(u.id) : '';
        }).filter(Boolean)
        : []);
    if (!ids.length) {
      throw httpError('Group ' + (gi + 1) + ' has no sections.', 400);
    }
    const selected = ids.map((id) => {
      if (seen.has(id)) throw httpError('Section ' + id + ' is in more than one group.', 400);
      const u = byId.get(id);
      if (!u) throw httpError('Unknown section id: ' + id, 400);
      seen.add(id);
      orderedIds.push(id);
      return u;
    });

    // Groups must follow book order (no rearranging).
    for (let i = 1; i < selected.length; i += 1) {
      if (selected[i].index < selected[i - 1].index) {
        throw httpError('Group ' + (gi + 1) + ' must keep sections in book order.', 400);
      }
    }

    const chapterNums = Array.from(new Set(selected.map((u) => u.chapterNum)));
    const subtitleTitles = selected
      .filter((u) => u.kind !== 'chapter')
      .map((u) => u.title)
      .filter(Boolean);
    const title = String((g && g.title) || '').trim()
      || (selected.length === 1
        ? selected[0].label
        : (chapterNums.length === 1
          ? (
            (selected[0].chapterTitle || selected[0].title || 'Chapter')
            + (subtitleTitles.length
              ? (': ' + subtitleTitles.slice(0, 3).join(' / '))
              : '')
          )
          : (selected[0].label + ' → ' + selected[selected.length - 1].label)));

    const startPage = selected[0].startPage;
    const endPage = selected[selected.length - 1].endPage;
    const text = selected.map((u) => u.text || '').filter(Boolean).join('\n\n').trim();
    const readingRange = selected.length === 1
      ? ('Section “' + selected[0].title + '”')
      : ('From “' + selected[0].title + '” through “' + selected[selected.length - 1].title + '”');

    chunks.push(labelChunk({
      partNum: gi + 1,
      unitTitle: title,
      summary: selected.map((u) => u.title).filter(Boolean).join(' · '),
      readingRange,
      startPage,
      endPage,
      text,
      unitIds: ids
    }, new Set()));
  });

  if (seen.size !== units.length) {
    throw httpError(
      'Every section must be grouped before generating (' +
      seen.size + '/' + units.length + ' used).',
      400
    );
  }

  // Ensure global order of groups follows book order.
  for (let i = 1; i < orderedIds.length; i += 1) {
    const a = byId.get(orderedIds[i - 1]);
    const b = byId.get(orderedIds[i]);
    if (a && b && b.index < a.index) {
      throw httpError('Worksheet parts must follow book order.', 400);
    }
  }

  touch(job, {
    status: 'ready',
    progress: 100,
    message: 'Chunk plan ready (' + chunks.length +
      ' parts). Choose worksheet options, then generate.',
    chunks,
    planMode: 'teacher-groups',
    planReport: {
      mode: 'teacher-groups',
      finalCount: chunks.length,
      countExact: true,
      criteria: [
        'Teacher grouped chapter/subtitle units manually',
        'Cuts only at heading boundaries',
        'All detected sections covered exactly once'
      ],
      summary: 'You grouped ' + units.length + ' sections into ' + chunks.length + ' worksheets.',
      howSplit: 'Manual chapter/subtitle groups (no mid-section cuts).',
      headingCount: units.length,
      source: 'teacher'
    },
    error: null
  });
  emit(job, 'status', toPublicJob(job));
  emit(job, 'planned', toPublicJob(job));
  return toPublicJob(job);
}

function updateJobOptions(jobId, teacherId, body) {
  const job = getJob(jobId, teacherId);
  if (['generating', 'parsing', 'planning'].includes(String(job.status || ''))) {
    throw httpError('Cannot change options while the job is busy.', 409);
  }
  const next = normalizeOptions(Object.assign({}, job.options || {}, body || {}));
  // Preserve level/genre if body omitted them as empty.
  if (body && body.level == null && job.options && job.options.level) next.level = job.options.level;
  if (body && body.genre == null && job.options && job.options.genre) next.genre = job.options.genre;
  touch(job, { options: next });
  emit(job, 'status', toPublicJob(job));
  return toPublicJob(job);
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
  if (!isGeminiConfigured()) throw httpError('AI is not configured.', 503);

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
  emit(job, 'status', toPublicJob(job, { includeParts: true }));

  let stubCount = 0;
  try {
    for (let i = startIndex; i < total; i += 1) {
      const chunk = job.chunks[i];
      touch(job, {
        message: 'Generating part ' + (i + 1) + '/' + total + ': ' + chunk.unitTitle,
        progress: 20 + Math.floor((i / total) * 60)
      });
      emit(job, 'status', toPublicJob(job, { includeParts: true }));

      // Worksheets first (no vocab yet); vocabulary is a final pass over all parts.
      const part = await generatePartWorksheet(
        chunk,
        job.meta,
        Object.assign({}, job.options, { vocabCount: 0 })
      );
      if (part.stubbed) stubCount += 1;
      job.parts.push(part);
      touch(job, { parts: job.parts });
      emit(job, 'part', {
        partNum: part.partNum,
        groundingScore: part.groundingScore,
        stubbed: !!part.stubbed,
        partsDone: job.parts.length,
        partsTotal: total,
        progress: 20 + Math.floor(((i + 1) / total) * 60),
        message: 'Finished part ' + (i + 1) + '/' + total + ': ' + chunk.unitTitle,
        part: summarizePartPreview(part),
        job: toPublicJob(job, { includeParts: true })
      });

      if (i < total - 1) await sleep(PART_DELAY_MS);
    }

    await sleep(PART_DELAY_MS);
    if ((job.options && job.options.vocabCount) > 0) {
      touch(job, { message: 'Extracting vocabulary lists…', progress: 82 });
      emit(job, 'status', toPublicJob(job, { includeParts: true }));
      await enrichPartsVocabulary(job);
    }

    touch(job, { message: 'Generating culminating task…', progress: 88 });
    emit(job, 'status', toPublicJob(job, { includeParts: true }));
    const culminating = await generateCulminating(job);
    touch(job, { culminating });

    touch(job, { message: 'Building workbook (.docx)…', progress: 94 });
    emit(job, 'status', toPublicJob(job, { includeParts: true }));

    const buf = await buildWorkbookDocx(job);

    // Drop section text only after a successful build so failed jobs can be retried.
    job.chunks = job.chunks.map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      summary: ch.summary || '',
      readingRange: ch.readingRange || '',
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
    emit(job, 'done', toPublicJob(job, { includeParts: true }));
    return toPublicJob(job, { includeParts: true });
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
    emit(job, 'error', toPublicJob(job, { includeParts: true }));
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

async function getPartHtml(jobId, teacherId, partNum) {
  const job = getJob(jobId, teacherId);
  const n = Number(partNum);
  const part = (job.parts || []).find((p) => Number(p.partNum) === n);
  if (!part) throw httpError('That worksheet sheet is not ready yet.', 404);
  const { buildPartSheetHtml } = require('./novelStudyHtml');
  const html = buildPartSheetHtml(part, job.meta, job.options);
  return {
    filename: 'part-' + n + '-sheet.html',
    html,
    mime: 'text/html; charset=utf-8'
  };
}

function deleteJob(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  const status = String(job.status || '');
  if (status === 'generating' || status === 'parsing' || status === 'planning') {
    throw httpError(
      'Cannot delete while this workbook is still running. Wait until it finishes or fails.',
      409
    );
  }
  cleanupJobFiles(job);
  deletePersistedJob(job.id);
  try {
    if (job.listeners) job.listeners.length = 0;
  } catch (_) { /* ignore */ }
  jobs.delete(job.id);
  return { ok: true, id: jobId };
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
  runPlanning,
  applyTeacherGroups,
  updateJobOptions,
  getJob,
  listJobsForTeacher,
  toPublicJob,
  subscribe,
  runGeneration,
  getDownload,
  getHtml,
  getPartHtml,
  deleteJob,
  uploadToGoogleDocs,
  listMcTypes,
  listLevels,
  normalizeOptions,
  MAX_PDF_BYTES,
  // Internals for contiguous-coverage regression checks
  _test: {
    sectionsCoverAllBody,
    sectionsPartitionBody,
    ensureContiguousBodyCoverage,
    rematerializeSectionPages,
    enforceTargetChunkCount,
    evenSplitPages,
    planTargetCountSections,
    fitSectionsToTargetCount,
    softFitTowardCount,
    heuristicSuggestedCount,
    buildPlanReport,
    collectRunningHeaders,
    extractStructureUnits,
    isChapterHeading,
    isProseFragment,
    isStrongSubtitleTitle,
    isExplicitChapterHeading,
    isRealHeading,
    guessHeading,
    splitPageByHeadings,
    collapseWeakStructureUnits,
    trimToBookBody,
    putJob(job) {
      if (!job || !job.id) throw new Error('job.id required');
      jobs.set(String(job.id), job);
      return job;
    },
    applyTeacherGroups
  }
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
