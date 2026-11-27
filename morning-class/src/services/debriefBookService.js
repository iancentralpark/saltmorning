'use strict';

/**
 * Oral Novel Debrief — Book Debrief Profile (Phase 1)
 *
 * Teacher uploads/pastes book text (or PDF) → Claude builds a structured
 * interview/grading profile → teacher verifies before student assignments.
 * Full book text is not persisted long-term (short excerpt only).
 */

const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const { isOpsDbEnabled, query, table } = require('../db/pool');

const MAX_TEXT_CHARS = 90000;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const EXCERPT_CHARS = 1200;
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, object>} */
const books = new Map();
const AUTO_RETRY_LIMIT = 4;
let askOverride = null;

function setAskForTests(fn) {
  askOverride = typeof fn === 'function' ? fn : null;
}

const GRADE_BANDS = {
  elementary: 'Upper elementary (grades 3–5). Simple vocabulary in questions.',
  middle: 'Middle school (grades 6–8). Clear academic language.',
  high: 'High school. More analytical prompts, still accessible.'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function claudeModel() {
  return String(
    process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (e2) { /* continue */ }
  }
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(raw.slice(s, e + 1)); } catch (e3) { /* continue */ }
  }
  return null;
}

async function askClaudeJson(system, prompt, opts) {
  opts = opts || {};
  if (askOverride) return askOverride(system, prompt, opts);
  if (!isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  try {
    const result = await askGemini(prompt, {
      provider: 'claude',
      noGeminiFallback: true,
      systemInstruction: system,
      temperature: opts.temperature != null ? opts.temperature : 0.35,
      maxOutputTokens: opts.maxOutputTokens || 12000,
      responseMimeType: 'application/json',
      model: claudeModel()
    });
    const text = (result && (result.answer || result.text)) || result;
    const parsed = extractJson(text);
    if (!parsed) {
      const err = new Error('AI returned invalid JSON for book profile.');
      err.statusCode = 502;
      throw err;
    }
    return parsed;
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error(formatGeminiClientError(e));
    err.statusCode = 502;
    throw err;
  }
}

const SYSTEM_PROFILE = `You are an expert middle-school English literature coach designing an AI oral debrief interviewer.
Given book text, produce a Book Debrief Profile JSON used later for Socratic spoken interviews and rubric grading.
Do NOT invent major plot events that contradict the text. Prefer evidence-grounded questions.
Output JSON only.`;

function buildProfilePrompt({ title, author, gradeBand, text }) {
  const band = GRADE_BANDS[gradeBand] || GRADE_BANDS.middle;
  return [
    'Build a Book Debrief Profile for oral 1:1 AI interviews with Korean academy students learning English.',
    'title: ' + title,
    'author: ' + (author || '(unknown)'),
    'audience: ' + band,
    '',
    'JSON schema:',
    JSON.stringify({
      title: 'string',
      author: 'string',
      oneSentenceHook: 'string',
      summary: '2–4 paragraph plot summary',
      themes: ['theme'],
      characters: [{ name: '', role: '', traits: [], arc: '' }],
      plotBeats: [{ label: 'Ch.1 / Part', summary: '', keyEvents: [''] }],
      vocabulary: [{ word: '', context: '', glossKo: '' }],
      properNouns: ['names places for STT hints'],
      questionBank: {
        comprehension: [{ q: '', expectedPoints: [''] }],
        evidence: [{ q: '', expectedPoints: [''] }],
        criticalThinking: [{ q: '', expectedPoints: [''] }],
        socraticFollowups: ['Follow-up when answer is short']
      },
      rubricAnchors: {
        comprehension: { '4': '', '3': '', '2': '', '1': '' },
        evidence: { '4': '', '3': '', '2': '', '1': '' },
        criticalThinking: { '4': '', '3': '', '2': '', '1': '' },
        oralFluency: { '4': '', '3': '', '2': '', '1': '' }
      },
      interviewOpening: 'First spoken prompt to the student',
      interviewClosing: 'How to wrap up the session'
    }, null, 2),
    '',
    'Requirements:',
    '- At least 8 comprehension, 6 evidence, 6 criticalThinking questions.',
    '- At least 8 socraticFollowups.',
    '- properNouns: character/place names that Whisper should hear correctly.',
    '- Rubric anchors must be book-specific, not generic.',
    '- Keep questions speakable aloud (short stems).',
    '',
    'BOOK TEXT (may be truncated):',
    String(text || '').slice(0, MAX_TEXT_CHARS)
  ].join('\n');
}

function coerceProfile(raw, fallback) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const questions = (list) => arr(list).slice(0, 20).map((q) => ({
    q: String((q && (q.q || q.question)) || '').trim(),
    expectedPoints: arr(q && q.expectedPoints).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
  })).filter((q) => q.q);
  const bandScore = (obj) => {
    const o = obj && typeof obj === 'object' ? obj : {};
    const out = {};
    ['4', '3', '2', '1'].forEach((k) => {
      out[k] = String(o[k] || '').trim();
    });
    return out;
  };
  return {
    title: String(p.title || fallback.title || '').trim(),
    author: String(p.author || fallback.author || '').trim(),
    oneSentenceHook: String(p.oneSentenceHook || '').trim(),
    summary: String(p.summary || '').trim(),
    themes: arr(p.themes).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 12),
    characters: arr(p.characters).slice(0, 20).map((c) => ({
      name: String((c && c.name) || '').trim(),
      role: String((c && c.role) || '').trim(),
      traits: arr(c && c.traits).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8),
      arc: String((c && c.arc) || '').trim()
    })).filter((c) => c.name),
    plotBeats: arr(p.plotBeats).slice(0, 30).map((b) => ({
      label: String((b && b.label) || '').trim(),
      summary: String((b && b.summary) || '').trim(),
      keyEvents: arr(b && b.keyEvents).map((e) => String(e || '').trim()).filter(Boolean).slice(0, 8)
    })).filter((b) => b.label || b.summary),
    vocabulary: arr(p.vocabulary).slice(0, 40).map((v) => ({
      word: String((v && v.word) || '').trim(),
      context: String((v && v.context) || '').trim(),
      glossKo: String((v && (v.glossKo || v.gloss)) || '').trim()
    })).filter((v) => v.word),
    properNouns: arr(p.properNouns).map((n) => String(n || '').trim()).filter(Boolean).slice(0, 80),
    questionBank: {
      comprehension: questions(p.questionBank && p.questionBank.comprehension),
      evidence: questions(p.questionBank && p.questionBank.evidence),
      criticalThinking: questions(p.questionBank && p.questionBank.criticalThinking),
      socraticFollowups: arr(p.questionBank && p.questionBank.socraticFollowups)
        .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20)
    },
    rubricAnchors: {
      comprehension: bandScore(p.rubricAnchors && p.rubricAnchors.comprehension),
      evidence: bandScore(p.rubricAnchors && p.rubricAnchors.evidence),
      criticalThinking: bandScore(p.rubricAnchors && p.rubricAnchors.criticalThinking),
      oralFluency: bandScore(p.rubricAnchors && p.rubricAnchors.oralFluency)
    },
    interviewOpening: String(p.interviewOpening || '').trim(),
    interviewClosing: String(p.interviewClosing || '').trim()
  };
}

function touch(book, patch) {
  Object.assign(book, patch || {});
  book.updatedAt = Date.now();
}

function publicBook(book, opts) {
  opts = opts || {};
  const out = {
    id: book.id,
    title: book.title,
    author: book.author,
    gradeBand: book.gradeBand,
    lexileLevel: book.lexileLevel || null,
    sourceType: book.sourceType,
    sourceExcerpt: book.sourceExcerpt || '',
    novelStudyJobId: book.novelStudyJobId || null,
    isVerified: !!book.isVerified,
    status: book.status,
    progress: book.progress,
    message: book.message || '',
    error: book.error || undefined,
    canResume: book.status === 'error' && !!(book._sourceText || book.sourceText),
    createdBy: book.createdBy,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt
  };
  if (opts.includeProfile !== false && book.debriefProfile) {
    out.debriefProfile = book.debriefProfile;
  }
  return out;
}

async function persistBook(book) {
  if (!book || book._cancelled || !books.has(book.id)) return;
  if (!isOpsDbEnabled()) return;
  await query(
    'INSERT INTO ' + table('debrief_books') + ' (' +
      'id, title, author, grade_band, lexile_level, source_type, source_excerpt, novel_study_job_id, ' +
      'debrief_profile, is_verified, status, progress, message, error, created_by, created_at, updated_at, ' +
      'source_text, auto_retries' +
    ') VALUES (' +
      '$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,to_timestamp($16/1000.0),to_timestamp($17/1000.0),$18,$19' +
    ') ON CONFLICT (id) DO UPDATE SET ' +
      'title = EXCLUDED.title, author = EXCLUDED.author, grade_band = EXCLUDED.grade_band, ' +
      'lexile_level = EXCLUDED.lexile_level, source_type = EXCLUDED.source_type, ' +
      'source_excerpt = EXCLUDED.source_excerpt, novel_study_job_id = EXCLUDED.novel_study_job_id, ' +
      'debrief_profile = EXCLUDED.debrief_profile, is_verified = EXCLUDED.is_verified, ' +
      'status = EXCLUDED.status, progress = EXCLUDED.progress, message = EXCLUDED.message, ' +
      'error = EXCLUDED.error, updated_at = EXCLUDED.updated_at, ' +
      'source_text = EXCLUDED.source_text, auto_retries = EXCLUDED.auto_retries',
    [
      book.id,
      book.title,
      book.author || '',
      book.gradeBand || 'middle',
      book.lexileLevel || null,
      book.sourceType || 'text',
      book.sourceExcerpt || '',
      book.novelStudyJobId || null,
      JSON.stringify(book.debriefProfile || {}),
      !!book.isVerified,
      book.status || 'ready',
      Number(book.progress) || 0,
      book.message || '',
      book.error || null,
      book.createdBy || '',
      book.createdAt || Date.now(),
      book.updatedAt || Date.now(),
      book._cancelled ? '' : String(book._sourceText || book.sourceText || ''),
      Number(book.autoRetries) || 0
    ]
  );
}

function rowToBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || '',
    gradeBand: row.grade_band || 'middle',
    lexileLevel: row.lexile_level || null,
    sourceType: row.source_type || 'text',
    sourceExcerpt: row.source_excerpt || '',
    novelStudyJobId: row.novel_study_job_id || null,
    debriefProfile: row.debrief_profile || {},
    isVerified: !!row.is_verified,
    status: row.status || 'ready',
    progress: Number(row.progress) || 0,
    message: row.message || '',
    error: row.error || null,
    sourceText: row.source_text || '',
    _sourceText: row.source_text || '',
    autoRetries: Number(row.auto_retries) || 0,
    createdBy: row.created_by || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

async function loadBookFromDb(id) {
  if (!isOpsDbEnabled()) return null;
  const r = await query(
    'SELECT * FROM ' + table('debrief_books') + ' WHERE id = $1 LIMIT 1',
    [String(id)]
  );
  return r.rows[0] ? rowToBook(r.rows[0]) : null;
}

function pruneMemory() {
  const now = Date.now();
  for (const [id, book] of books.entries()) {
    if (book.status === 'generating') continue;
    if (now - (book.updatedAt || book.createdAt || 0) > JOB_TTL_MS) books.delete(id);
  }
}

function retryCount(book) {
  const n = Number(book && book.autoRetries);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sourceOf(book) {
  return String((book && (book._sourceText || book.sourceText)) || '');
}

function friendlyFail(err) {
  const msg = String(err && err.message || '');
  if (/invalid JSON/i.test(msg)) return 'AI 응답이 깨졌습니다.';
  return msg || '프로필 생성에 실패했습니다.';
}

function canAutoRetry(book, err) {
  if (!book || book._cancelled || book.status === 'cancelled') return false;
  if (!sourceOf(book)) return false;
  if (err && (err.statusCode === 400 || err.statusCode === 503)) return false;
  return retryCount(book) < AUTO_RETRY_LIMIT;
}

function keptProgress(book) {
  const n = Number(book && book.progress);
  if (Number.isFinite(n) && n > 0 && n < 100) return n;
  return 25;
}

async function runGenerate(book) {
  if (!book || book._cancelled || book._running || !books.has(book.id)) return;
  book._running = true;
  book._resumeScheduled = false;
  let again = false;
  try {
    const text = sourceOf(book);
    book._sourceText = text;
    if (text.length < 200) {
      const err = new Error('본문이 없어 이어서 만들 수 없습니다. 삭제 후 다시 만들어 주세요.');
      err.statusCode = 400;
      throw err;
    }
    touch(book, {
      status: 'generating',
      progress: Math.max(25, keptProgress(book)),
      message: retryCount(book)
        ? ('끝난 지점부터 다시 시도합니다 (' + retryCount(book) + '/' + AUTO_RETRY_LIMIT + ').')
        : '줄거리·인물·질문 은행 생성 중…',
      error: null
    });
    await persistBook(book);
    const raw = await askClaudeJson(
      SYSTEM_PROFILE,
      buildProfilePrompt({
        title: book.title,
        author: book.author,
        gradeBand: book.gradeBand,
        text: book._sourceText
      }),
      { maxOutputTokens: 12000 }
    );
    if (book._cancelled || !books.has(book.id)) return;
    touch(book, { progress: 80, message: '프로필 정리 중…' });
    const profile = coerceProfile(raw, { title: book.title, author: book.author });
    if (!profile.summary || profile.questionBank.comprehension.length < 4) {
      const err = new Error('프로필이 너무 빈약합니다. 본문을 더 넣거나 다시 시도해 주세요.');
      err.statusCode = 502;
      throw err;
    }
    book._sourceText = '';
    book.sourceText = '';
    book.autoRetries = 0;
    touch(book, {
      status: 'ready',
      progress: 100,
      message: '초안 완료 — 검수 후 Verified로 표시하세요.',
      debriefProfile: profile,
      error: null
    });
    await persistBook(book);
  } catch (e) {
    if (book._cancelled || !books.has(book.id)) return;
    if (canAutoRetry(book, e)) {
      const n = retryCount(book) + 1;
      book.autoRetries = n;
      touch(book, {
        status: 'generating',
        progress: keptProgress(book),
        error: null,
        message: friendlyFail(e) + ' 끝난 지점부터 다시 시도합니다 (' + n + '/' + AUTO_RETRY_LIMIT + ').'
      });
      await persistBook(book);
      again = true;
      const wait = askOverride ? 0 : 1200 * n;
      setTimeout(() => {
        book._running = false;
        void runGenerate(book);
      }, wait);
      return;
    }
    const stuck = !sourceOf(book);
    touch(book, {
      status: 'error',
      progress: keptProgress(book),
      error: stuck
        ? '생성이 중간에 멈췄습니다. 삭제 후 다시 만들어 주세요.'
        : (friendlyFail(e) + ' 이어서 만들기를 누르면 다시 시도합니다.'),
      message: stuck
        ? '생성이 중간에 멈췄습니다. 삭제 후 다시 만들어 주세요.'
        : '이어서 만들 수 있습니다'
    });
    await persistBook(book);
    console.error('debrief book job', book.id, e);
  } finally {
    if (!again) book._running = false;
  }
}

async function reconcile(book) {
  if (!book || book.status !== 'generating' || book._running || book._cancelled) return book;
  const text = sourceOf(book);
  if (text && retryCount(book) < AUTO_RETRY_LIMIT) {
    book._sourceText = text;
    if (!book._resumeScheduled) {
      book._resumeScheduled = true;
      setImmediate(() => { void runGenerate(book); });
    }
    return book;
  }
  touch(book, {
    status: 'error',
    progress: keptProgress(book),
    error: text
      ? '여러 번 실패했습니다. 이어서 만들기를 누르면 다시 시도합니다.'
      : '생성이 중간에 멈췄습니다. 삭제 후 다시 만들어 주세요.',
    message: text
      ? '이어서 만들 수 있습니다'
      : '생성이 중간에 멈췄습니다. 삭제 후 다시 만들어 주세요.'
  });
  await persistBook(book);
  return book;
}

async function getBook(id, ownerKey) {
  pruneMemory();
  const key = String(id || '');
  const live = books.get(key);
  if (live && live._running) return live;
  let book = live || await loadBookFromDb(id);
  if (!book) return null;
  if (ownerKey && book.createdBy && book.createdBy !== String(ownerKey) && book.status === 'generating') {
    return null;
  }
  if (live && live._sourceText) book._sourceText = live._sourceText;
  books.set(book.id, book);
  await reconcile(book);
  return book;
}

async function listBooks(opts) {
  opts = opts || {};
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
  const verifiedOnly = !!opts.verifiedOnly;
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT * FROM ' + table('debrief_books') +
        (verifiedOnly ? ' WHERE is_verified = true' : '') +
        ' ORDER BY updated_at DESC LIMIT $1',
      [limit]
    );
    const out = [];
    for (const row of r.rows) {
      const fresh = rowToBook(row);
      const live = books.get(fresh.id);
      if (live && live._running) {
        out.push(publicBook(live, { includeProfile: !!opts.includeProfile }));
        continue;
      }
      if (live && live._sourceText) fresh._sourceText = live._sourceText;
      books.set(fresh.id, fresh);
      await reconcile(fresh);
      out.push(publicBook(fresh, { includeProfile: !!opts.includeProfile }));
    }
    return out;
  }
  pruneMemory();
  const rows = Array.from(books.values())
    .filter((b) => (verifiedOnly ? b.isVerified : true))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
  const out = [];
  for (const book of rows) {
    if (!book._running) await reconcile(book);
    out.push(publicBook(book, { includeProfile: !!opts.includeProfile }));
  }
  return out;
}

async function extractPdfText(buf) {
  if (!buf || !buf.length) {
    const err = new Error('PDF 파일이 비어 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  if (buf.length > MAX_PDF_BYTES) {
    const err = new Error('PDF는 ' + Math.round(MAX_PDF_BYTES / (1024 * 1024)) + 'MB 이하로 올려 주세요.');
    err.statusCode = 400;
    throw err;
  }
  const parsed = await pdfParse(buf);
  const text = String((parsed && parsed.text) || '').replace(/\s+\n/g, '\n').trim();
  if (text.length < 200) {
    const err = new Error('PDF에서 텍스트를 거의 읽지 못했습니다. 스캔본이 아닌 텍스트 PDF를 올려 주세요.');
    err.statusCode = 400;
    throw err;
  }
  return text;
}

function normalizeGradeBand(v) {
  const s = String(v || 'middle').toLowerCase();
  if (s === 'elementary' || s === 'elem' || s === 'e') return 'elementary';
  if (s === 'high' || s === 'hs' || s === 'h') return 'high';
  return 'middle';
}

function startGenerateJob(opts, ownerKey) {
  pruneMemory();
  const title = String((opts && opts.title) || '').trim();
  const author = String((opts && opts.author) || '').trim();
  const gradeBand = normalizeGradeBand(opts && opts.gradeBand);
  let text = String((opts && opts.text) || '').trim();
  if (!title) {
    const err = new Error('책 제목을 입력하세요.');
    err.statusCode = 400;
    throw err;
  }
  if (text.length < 200) {
    const err = new Error('책 본문이 너무 짧습니다. 텍스트를 더 붙여넣거나 PDF를 올려 주세요.');
    err.statusCode = 400;
    throw err;
  }
  if (text.length > MAX_TEXT_CHARS + 20000) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }

  const id = newId('dbk');
  const now = Date.now();
  const book = {
    id,
    title,
    author,
    gradeBand,
    lexileLevel: String((opts && opts.lexileLevel) || '').trim() || null,
    sourceType: (opts && opts.sourceType) || 'text',
    sourceExcerpt: text.slice(0, EXCERPT_CHARS),
    novelStudyJobId: (opts && opts.novelStudyJobId) || null,
    debriefProfile: null,
    isVerified: false,
    status: 'generating',
    progress: 8,
    message: 'Claude가 Book Debrief Profile을 만드는 중…',
    error: null,
    createdBy: String(ownerKey || ''),
    createdAt: now,
    updatedAt: now,
    sourceText: text,
    _sourceText: text,
    autoRetries: 0
  };
  books.set(id, book);
  persistBook(book).catch((e) => console.warn('[debrief] persist start', e.message));
  setImmediate(() => { void runGenerate(book); });
  return publicBook(book);
}

async function resumeBook(id) {
  const book = await getBook(id, null);
  if (!book) {
    const err = new Error('책을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  if (book.status === 'ready' && book.debriefProfile) return publicBook(book);
  if (book._running) return publicBook(book);
  const text = sourceOf(book);
  if (text.length < 200) {
    const err = new Error('본문이 없어 이어서 만들 수 없습니다. 삭제 후 다시 만들어 주세요.');
    err.statusCode = 400;
    throw err;
  }
  book._cancelled = false;
  book._sourceText = text;
  book.autoRetries = 0;
  book.status = 'generating';
  books.set(book.id, book);
  setImmediate(() => { void runGenerate(book); });
  return publicBook(book);
}

async function startGenerateFromPdf(opts, ownerKey, file) {
  if (!file || !file.buffer) {
    const err = new Error('PDF 파일이 필요합니다.');
    err.statusCode = 400;
    throw err;
  }
  const text = await extractPdfText(file.buffer);
  return startGenerateJob({
    title: (opts && opts.title) || (file.originalname || '').replace(/\.pdf$/i, '') || 'Untitled',
    author: opts && opts.author,
    gradeBand: opts && opts.gradeBand,
    lexileLevel: opts && opts.lexileLevel,
    novelStudyJobId: opts && opts.novelStudyJobId,
    text,
    sourceType: 'pdf'
  }, ownerKey);
}

async function setVerified(id, verified, ownerKey) {
  const book = await getBook(id, null);
  if (!book) {
    const err = new Error('책을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  if (book.status !== 'ready' || !book.debriefProfile) {
    const err = new Error('생성이 끝난 초안만 검수할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  touch(book, {
    isVerified: !!verified,
    message: verified ? 'Verified — 과제 부여에 사용 가능' : '초안 (미검수)'
  });
  books.set(book.id, book);
  await persistBook(book);
  return publicBook(book);
}

async function updateProfile(id, profilePatch, ownerKey) {
  const book = await getBook(id, null);
  if (!book) {
    const err = new Error('책을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  const next = coerceProfile(
    Object.assign({}, book.debriefProfile || {}, profilePatch || {}),
    { title: book.title, author: book.author }
  );
  touch(book, {
    debriefProfile: next,
    isVerified: false,
    message: '프로필 수정됨 — 다시 검수해 주세요.',
    status: 'ready'
  });
  if (profilePatch && profilePatch.title) book.title = String(profilePatch.title).trim() || book.title;
  if (profilePatch && profilePatch.author != null) book.author = String(profilePatch.author).trim();
  books.set(book.id, book);
  await persistBook(book);
  return publicBook(book);
}

async function deleteBook(id, ownerKey) {
  const book = await getBook(id, null);
  if (!book) {
    const err = new Error('책을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  // Avoid FK RESTRICT surprises when class assignments still reference this book.
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT COUNT(*)::int AS n FROM ' + table('debrief_assignments') + ' WHERE book_id = $1',
      [String(id)]
    );
    if ((Number(r.rows[0] && r.rows[0].n) || 0) > 0) {
      const err = new Error('반에 부여된 과제가 있어 삭제할 수 없습니다. 먼저 과제를 삭제하세요.');
      err.statusCode = 409;
      throw err;
    }
  } else {
    try {
      const { countByBook } = require('./debriefAssignmentService');
      if ((await countByBook(id)) > 0) {
        const err = new Error('반에 부여된 과제가 있어 삭제할 수 없습니다. 먼저 과제를 삭제하세요.');
        err.statusCode = 409;
        throw err;
      }
    } catch (e) {
      if (e.statusCode) throw e;
    }
  }
  book._cancelled = true;
  book.status = 'cancelled';
  books.delete(String(id));
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('debrief_books') + ' WHERE id = $1', [String(id)]);
  }
  return { ok: true, id: String(id) };
}

module.exports = {
  MAX_PDF_BYTES,
  GRADE_BANDS,
  isClaudeConfigured,
  startGenerateJob,
  startGenerateFromPdf,
  resumeBook,
  listBooks,
  getBook,
  publicBook,
  setVerified,
  updateProfile,
  deleteBook,
  setAskForTests,
  extractPdfText,
  askClaudeJson
};
