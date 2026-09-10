/**
 * Novel / Book Study — PDF parse, chunk planning, Gemini worksheet generation.
 * In-memory job store; temp PDF deleted after parse; jobs purged after 2h.
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

const TMP_ROOT = path.join(os.tmpdir(), 'salt-novel-study');
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const PART_DELAY_MS = 2500;
const MIN_CHARS_PAGE = 40;
const TARGET_MIN = 2;
const TARGET_MAX = 4;
const SPLIT_OVER = 5;
const MERGE_UNDER = 1;
/** Text-layer novel PDFs are often 30–80MB; keep headroom for full books. */
const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** @type {Map<string, object>} */
const jobs = new Map();

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
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) { /* continue */ }
  }
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(raw.slice(a, b + 1)); } catch (_) { /* continue */ }
  }
  return null;
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
    downloadReady: !!(job.docxBuffer && job.docxBuffer.length),
    googleDocsUrl: job.googleDocsUrl || null,
    pageOverflowRisk: !!(job.options && job.options.pageOverflowRisk),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function touch(job, patch) {
  Object.assign(job, patch || {}, { updatedAt: nowIso() });
  jobs.set(job.id, job);
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
      jobs.delete(id);
    }
  }
}
setInterval(purgeExpired, 15 * 60 * 1000).unref?.();

function normalizeOptions(body) {
  const level = String((body && body.level) || 'middle').toLowerCase();
  const genre = String((body && body.genre) || 'auto').toLowerCase();
  const vocabCount = Math.max(1, Math.min(6, Number(body && body.vocabCount) || 3));
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

function guessHeading(pageText) {
  const lines = String(pageText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length < 4 || line.length > 80) continue;
    if (/^(chapter|part|unit|section|prologue|epilogue)\b/i.test(line)) return line;
    if (/^[A-Z][A-Z0-9 ,.'’:\-]{6,60}$/.test(line) && !/[.!?]$/.test(line)) return line;
  }
  return '';
}

function planChunksHeuristic(pages) {
  const raw = [];
  let cur = null;
  pages.forEach((p) => {
    const heading = guessHeading(p.text);
    const startNew = heading && (!cur || heading !== cur.unitTitle);
    if (!cur || startNew) {
      if (cur) raw.push(cur);
      cur = {
        unitTitle: heading || ('Section starting p.' + p.pageNum),
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
    if (merged.length && span <= MERGE_UNDER) {
      const prev = merged[merged.length - 1];
      prev.endPage = sec.endPage;
      prev.pages = prev.pages.concat(sec.pages);
      if (!/section starting/i.test(sec.unitTitle)) prev.unitTitle += ' / ' + sec.unitTitle;
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
      const idx = Math.floor(i / TARGET_MAX) + 1;
      split.push({
        unitTitle: sec.unitTitle + (sec.pages.length > TARGET_MAX ? (' (' + idx + ')') : ''),
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
          unitTitle: sec.unitTitle + ' / ' + next.unitTitle,
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

  return finalSecs.map((sec, idx) => ({
    partNum: idx + 1,
    unitTitle: sec.unitTitle || ('Part ' + (idx + 1)),
    startPage: sec.startPage,
    endPage: sec.endPage,
    text: sec.pages.map((p) => p.text).join('\n\n').trim()
  }));
}

async function planChunksWithGemini(pages, options) {
  const sample = pages.slice(0, 12).map((p) => ({
    page: p.pageNum,
    preview: String(p.text || '').slice(0, 500)
  }));
  const headings = [];
  pages.forEach((p) => {
    const h = guessHeading(p.text);
    if (h) headings.push({ page: p.pageNum, heading: h });
  });
  const level = LEVELS[options.level] || LEVELS.middle;

  const prompt = [
    'Plan a Novel/Book Study workbook for English class.',
    'Return JSON ONLY:',
    '{ "title": string, "author": string, "genre": "fiction"|"nonfiction",',
    '  "chunks": [{ "part_num": number, "unit_title": string, "start_page": number, "end_page": number }] }',
    'Rules:',
    '- Prefer chapter/section heading boundaries.',
    '- Each chunk ≈ ' + TARGET_MIN + '-' + TARGET_MAX + ' pages for one class period.',
    '- Split sections longer than ' + SPLIT_OVER + ' pages.',
    '- Merge sections that are 1 page or less with a neighbor.',
    '- Page numbers must be within 1..' + pages.length + '.',
    'Level: ' + level.prompt,
    'Detected headings: ' + JSON.stringify(headings.slice(0, 80)),
    'Sample pages: ' + JSON.stringify(sample)
  ].join('\n');

  try {
    const res = await askGemini(prompt, {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      systemInstruction: 'STRICT: Output valid JSON only. Use only provided page numbers.'
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
      return {
        partNum: i + 1,
        unitTitle: String(ch.unit_title || ch.unitTitle || ('Part ' + (i + 1))).trim(),
        startPage: start,
        endPage: end,
        text: slice.map((p) => p.text).join('\n\n').trim()
      };
    }).filter((ch) => ch.text.length > 80);

    if (!chunks.length) throw new Error('no usable chunks');
    return {
      meta: {
        title: String(parsed.title || options.fallbackTitle || 'Untitled Book').trim(),
        author: String(parsed.author || 'Unknown').trim(),
        genre: /non[- ]?fiction/i.test(String(parsed.genre || options.genre || ''))
          ? 'nonfiction'
          : 'fiction'
      },
      chunks
    };
  } catch (_) {
    return {
      meta: {
        title: options.fallbackTitle || 'Untitled Book',
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
  const level = LEVELS[options.level] || LEVELS.middle;
  const typeList = options.mcTypes.map((id) => {
    const hit = MC_TYPES.find((t) => t.id === id);
    return hit ? hit.label : id;
  }).join('; ');

  const system = [
    'You are an expert ELA worksheet writer for school teachers.',
    'STRICT GROUNDING: Rely EXCLUSIVELY on the provided section_text.',
    'Before each vocabulary item and each question, choose an exact quote from section_text as evidence.',
    'Never invent plot points, facts, names, or claims not present in section_text.',
    'Output valid JSON only.'
  ].join(' ');

  const prompt = [
    'Create one Novel/Book Study worksheet for this section.',
    'Book: ' + meta.title + ' by ' + meta.author + ' (' + meta.genre + ')',
    'Unit: ' + chunk.unitTitle + ' (pages ' + chunk.startPage + '–' + chunk.endPage + ')',
    'Audience: ' + level.prompt,
    'Return JSON:',
    '{',
    '  "vocab": [{ "word", "partOfSpeech", "definition", "exampleFromText", "evidenceQuote" }],',
    '  "multipleChoice": [{ "type", "question", "choices": ["A...","B...","C...","D..."], "answer": "A"|"B"|"C"|"D", "evidenceQuote" }],',
    '  "shortAnswer": [{ "question", "sampleAnswer", "evidenceQuote" }],',
    '  "reflection": [{ "question", "sampleAnswer", "evidenceQuote" }]',
    '}',
    'Counts: vocab=' + options.vocabCount + ', mc=' + options.mcCount +
      ', short=' + options.shortCount + ', reflection=' + options.reflectionCount,
    'Prefer these MC types: ' + typeList,
    'Definitions must be student-friendly English-English.',
    'exampleFromText and evidenceQuote must be exact phrases/sentences from section_text.',
    'section_text:',
    String(chunk.text || '').slice(0, 28000)
  ].join('\n');

  const res = await askGemini(prompt, {
    temperature: 0.35,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    systemInstruction: system
  });
  const parsed = extractJson(res.text || res.answer || '');
  if (!parsed) throw new Error('Model returned non-JSON for part ' + chunk.partNum);

  const vocab = (Array.isArray(parsed.vocab) ? parsed.vocab : [])
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
      const choices = Array.isArray(q.choices) ? q.choices.map((c) => String(c || '').trim()) : [];
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

  const checks = []
    .concat(vocab.map((v) => v.evidenceQuote || v.exampleFromText))
    .concat(multipleChoice.map((q) => q.evidenceQuote))
    .concat(shortAnswer.map((q) => q.evidenceQuote))
    .concat(reflection.map((q) => q.evidenceQuote));
  const ok = checks.filter((q) => evidenceInText(q, chunk.text)).length;
  const ratio = checks.length ? ok / checks.length : 0;
  if (ratio < 0.5 && (!attempt || attempt < 2)) {
    return generatePartWorksheet(chunk, meta, options, (attempt || 1) + 1);
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

    const fallbackTitle = path.basename(String(file.originalname || 'book.pdf'), '.pdf');
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

  touch(job, {
    status: 'generating',
    progress: 20,
    message: 'Generating worksheets…',
    parts: [],
    culminating: null,
    docxBuffer: null,
    error: null
  });
  emit(job, 'status', toPublicJob(job));

  const total = job.chunks.length;
  try {
    for (let i = 0; i < total; i += 1) {
      const chunk = job.chunks[i];
      touch(job, {
        message: 'Generating part ' + (i + 1) + '/' + total + ': ' + chunk.unitTitle,
        progress: 20 + Math.floor((i / total) * 60)
      });
      emit(job, 'status', toPublicJob(job));

      const part = await generatePartWorksheet(chunk, job.meta, job.options);
      job.parts.push(part);
      touch(job, { parts: job.parts });
      emit(job, 'part', { partNum: part.partNum, groundingScore: part.groundingScore });

      if (i < total - 1) await sleep(PART_DELAY_MS);
    }

    await sleep(PART_DELAY_MS);
    touch(job, { message: 'Generating culminating task…', progress: 85 });
    emit(job, 'status', toPublicJob(job));
    const culminating = await generateCulminating(job);
    touch(job, { culminating });

    // Drop section text from memory; keep chunk meta + question JSON.
    job.chunks = job.chunks.map((ch) => ({
      partNum: ch.partNum,
      unitTitle: ch.unitTitle,
      startPage: ch.startPage,
      endPage: ch.endPage,
      text: ''
    }));
    job.pages = null;

    touch(job, { message: 'Building workbook (.docx)…', progress: 92 });
    emit(job, 'status', toPublicJob(job));

    const buf = await buildWorkbookDocx(job);
    touch(job, {
      status: 'done',
      progress: 100,
      message: 'Workbook ready.',
      docxBuffer: buf
    });
    emit(job, 'done', toPublicJob(job));
    return toPublicJob(job);
  } catch (e) {
    touch(job, {
      status: 'error',
      progress: 100,
      message: e.message || 'Generation failed.',
      error: e.message || 'Generation failed.'
    });
    emit(job, 'error', toPublicJob(job));
    throw e;
  }
}

function getDownload(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (!job.docxBuffer) throw httpError('Download is not ready yet.', 409);
  const safe = String((job.meta && job.meta.title) || 'book-study')
    .replace(/[^\w\s\-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'book-study';
  return {
    filename: safe + '-workbook.docx',
    buffer: job.docxBuffer,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
}

async function uploadToGoogleDocs(jobId, teacherId) {
  const job = getJob(jobId, teacherId);
  if (!job.docxBuffer) throw httpError('Generate the workbook first.', 409);

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
  toPublicJob,
  subscribe,
  runGeneration,
  getDownload,
  uploadToGoogleDocs,
  listMcTypes,
  listLevels,
  normalizeOptions,
  MAX_PDF_BYTES
};
