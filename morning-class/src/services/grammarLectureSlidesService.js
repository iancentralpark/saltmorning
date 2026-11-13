'use strict';

/**
 * Grammar lecture slides (인강용 PPT) for Class Tools / grammar-clinic.
 *
 * Mode A: pick up to 2 catalog units → Claude picks content blocks → chalkboard PPTX
 * Mode B: upload .pptx/.ppt → extract text → restyle into the same template
 *
 * Layout contract (all slides):
 * - 16:9
 * - Right 25% always empty (teacher standing zone on e-board)
 * - Chalkboard green + light grid background
 * - Chalk-light text only (never dark ink)
 * - One content block per slide; bold large type
 * - Quiz answers live in presenter notes only
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const { getUnitsByIds } = require('./grammarClinic/catalog');

const MAX_UNITS = 2;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const jobs = new Map();

const BLOCK_TYPES = [
  'HOOK',        // 도입예문
  'FORMULA',     // 핵심 공식
  'ONE_LINER',   // 한줄 예문
  'USAGE',       // 용법 구분
  'PAIR',        // 짝꿍 표현
  'FORMS',       // 형태 변화
  'TRAP',        // 비문 ↔ 정문
  'BAN',         // 같이 못 씀 / 예외
  'TRANSFORM',   // 전환 공식
  'QUIZ'         // 미니 퀴즈
];

const BLOCK_LABEL = {
  HOOK: '도입예문',
  FORMULA: '핵심 공식',
  ONE_LINER: '한줄 예문',
  USAGE: '용법 구분',
  PAIR: '짝꿍 표현',
  FORMS: '형태 변화',
  TRAP: '비문 ↔ 정문',
  BAN: '예외·금지',
  TRANSFORM: '전환 공식',
  QUIZ: '미니 퀴즈'
};

/** Chalkboard palette — light chalk only */
const THEME = {
  board: '2F6B4F',
  boardDeep: '245540',
  grid: 'FFFFFF',
  cream: 'F7F1DE',
  yellow: 'FFE08A',
  mint: 'C8F0D8',
  white: 'FFFFFF',
  softRed: 'FFB4A8',
  softOk: 'B8F0C8'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
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

function claudeModel() {
  return String(
    process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

async function askClaudeJson(system, prompt, opts) {
  opts = opts || {};
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
      temperature: opts.temperature != null ? opts.temperature : 0.45,
      maxOutputTokens: opts.maxOutputTokens || 8000,
      responseMimeType: 'application/json',
      model: claudeModel()
    });
    const text = (result && (result.answer || result.text)) || result;
    const parsed = extractJson(text);
    if (!parsed) {
      const err = new Error('AI returned invalid JSON.');
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

const SYSTEM_SCRIPT = `당신은 한국 중학교 영어 내신 인강 강사입니다.
선택한 문법 포인트만으로 전자칠판용 강의 슬라이드 대본을 JSON으로 만듭니다.

[콘텐츠 블록 — 문법에 맞는 것만 고르세요. 전부 넣을 필요 없음]
HOOK 도입예문 / FORMULA 핵심 공식 / ONE_LINER 한줄 예문 / USAGE 용법 구분 /
PAIR 짝꿍 표현 / FORMS 형태 변화 / TRAP 비문↔정문 / BAN 예외·금지 /
TRANSFORM 전환 공식 / QUIZ 미니 퀴즈(내신 스타일)

[규칙]
- 문법 unit당 대략 6~10장. 전체 최대 22장.
- 한 슬라이드 = 블록 1개. 정보는 최소. 글은 굵고 짧게.
- title 슬라이드(kind=title)로 시작, 유닛이 2개면 중간에 section 구분 슬라이드.
- QUIZ의 정답·해설은 반드시 notes(발표자 노트)에만 넣고, 화면 bullets/lines에는 넣지 말 것.
- 한국어 설명 + 영어 예문. 중학생 눈높이.
- 출력은 JSON만.`;

function buildGeneratePrompt({ title, units, grade }) {
  const specs = units.map((u) => ({
    unitId: u.unitId,
    grade: u.grade,
    category: u.category,
    subCategory: u.subCategory,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
  return [
    '다음 문법으로 인강 슬라이드 대본을 작성하라.',
    'title: ' + title,
    'schoolGrade: ' + grade,
    'units (최대 2개):',
    JSON.stringify(specs, null, 2),
    '',
    'JSON 스키마:',
    JSON.stringify({
      title: '강의 제목',
      grade: 'M2',
      slides: [{
        kind: 'title|section|content',
        unitId: 'optional unit id for content/section',
        blockType: 'HOOK|FORMULA|ONE_LINER|USAGE|PAIR|FORMS|TRAP|BAN|TRANSFORM|QUIZ|null for title/section',
        heading: '슬라이드 큰 제목 (짧게)',
        lines: ['화면에 보이는 줄들 — 최대 6줄, 각 줄 짧게'],
        columns: [['왼쪽'], ['오른쪽']],
        examples: [{ en: '...', ko: '...' }],
        wrongRight: [{ wrong: '...', right: '...' }],
        quiz: { prompt: '문제', choices: ['①', '②', '③', '④', '⑤'] },
        notes: '발표자 노트. QUIZ면 정답·해설만 여기.'
      }]
    }, null, 2),
    '',
    'columns / examples / wrongRight / quiz 는 해당 블록에만 채우고 나머지는 생략 가능.',
    'TRAP은 wrongRight 필수. USAGE는 columns 2열 권장. QUIZ는 quiz+notes 필수.'
  ].join('\n');
}

function buildRestylePrompt({ title, extractedText, unitHint }) {
  return [
    '아래는 교사가 업로드한 기존 문법 PPT에서 추출한 텍스트이다.',
    '내용을 보존하되, 우리 인강 칠판 템플릿용 슬라이드 JSON으로 재구성하라.',
    '불필요한 장식 문구는 버리고, 위 콘텐츠 블록 체계에 맞게 재배치하라.',
    'QUIZ 정답은 notes에만.',
    title ? ('희망 제목: ' + title) : '',
    unitHint ? ('힌트 문법: ' + unitHint) : '',
    '',
    '추출 텍스트:',
    String(extractedText || '').slice(0, 24000),
    '',
    '출력 JSON 스키마는 generate와 동일 (title, grade, slides[]).'
  ].filter(Boolean).join('\n');
}

function coerceSlide(raw, idx) {
  const kind = ['title', 'section', 'content'].includes(raw && raw.kind) ? raw.kind : 'content';
  let blockType = raw && raw.blockType ? String(raw.blockType).toUpperCase() : null;
  if (kind === 'content' && !BLOCK_TYPES.includes(blockType)) blockType = 'ONE_LINER';
  if (kind !== 'content') blockType = null;
  const lines = Array.isArray(raw && raw.lines)
    ? raw.lines.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const columns = Array.isArray(raw && raw.columns)
    ? raw.columns.slice(0, 2).map((col) =>
      (Array.isArray(col) ? col : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
    )
    : undefined;
  const examples = Array.isArray(raw && raw.examples)
    ? raw.examples.slice(0, 4).map((ex) => ({
      en: String((ex && ex.en) || '').trim(),
      ko: String((ex && ex.ko) || '').trim()
    })).filter((ex) => ex.en || ex.ko)
    : undefined;
  const wrongRight = Array.isArray(raw && raw.wrongRight)
    ? raw.wrongRight.slice(0, 4).map((w) => ({
      wrong: String((w && w.wrong) || '').trim(),
      right: String((w && w.right) || '').trim()
    })).filter((w) => w.wrong || w.right)
    : undefined;
  let quiz;
  if (raw && raw.quiz) {
    quiz = {
      prompt: String(raw.quiz.prompt || '').trim(),
      choices: Array.isArray(raw.quiz.choices)
        ? raw.quiz.choices.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 5)
        : []
    };
  }
  return {
    index: idx + 1,
    kind,
    unitId: raw && raw.unitId ? String(raw.unitId) : undefined,
    blockType,
    heading: String((raw && raw.heading) || '').trim() || (blockType ? BLOCK_LABEL[blockType] : ''),
    lines,
    columns,
    examples,
    wrongRight,
    quiz,
    notes: String((raw && raw.notes) || '').trim()
  };
}

function coerceDeck(parsed, fallbackTitle, grade) {
  const slidesRaw = Array.isArray(parsed && parsed.slides) ? parsed.slides : [];
  const slides = slidesRaw.map(coerceSlide).filter((s) =>
    s.heading || s.lines.length || (s.quiz && s.quiz.prompt) || s.kind === 'title'
  );
  if (slides.length < 3) {
    const err = new Error('슬라이드 대본이 너무 짧습니다. 문법을 바꿔 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  if (slides[0].kind !== 'title') {
    slides.unshift({
      index: 1,
      kind: 'title',
      heading: String((parsed && parsed.title) || fallbackTitle || '문법 강의'),
      lines: [],
      notes: ''
    });
  }
  slides.forEach((s, i) => { s.index = i + 1; });
  return {
    title: String((parsed && parsed.title) || fallbackTitle || '문법 인강').trim(),
    grade: String((parsed && parsed.grade) || grade || 'M2').toUpperCase(),
    slides
  };
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) jobs.delete(id);
  }
}

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
}

function publicJob(job) {
  const out = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    mode: job.mode,
    error: job.error || undefined,
    warnings: job.warnings || []
  };
  if (job.deck) {
    out.deck = job.deck;
    out.htmlPreview = job.htmlPreview;
    out.pptxUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/pptx';
    out.deckUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/deck';
  }
  return out;
}

function getJob(jobId, ownerKey) {
  pruneJobs();
  const job = jobs.get(String(jobId || ''));
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== String(ownerKey)) {
    const err = new Error('Job not found.');
    err.statusCode = 404;
    throw err;
  }
  return job;
}

function startGenerateJob(opts, ownerKey) {
  pruneJobs();
  const unitIds = Array.isArray(opts && opts.unitIds) ? opts.unitIds.map(String) : [];
  if (!unitIds.length) {
    const err = new Error('문법 요소를 1~2개 선택하세요.');
    err.statusCode = 400;
    throw err;
  }
  if (unitIds.length > MAX_UNITS) {
    const err = new Error('인강 슬라이드는 문법을 최대 2개까지 선택할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  const units = getUnitsByIds(unitIds);
  if (!units.length) {
    const err = new Error('선택한 문법 유닛을 찾을 수 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const grade = String((opts && opts.grade) || units[0].grade || 'M2').toUpperCase();
  const title = String((opts && opts.title) || '').trim()
    || units.map((u) => u.subCategory).join(' · ') + ' 인강';

  const id = newId('gl');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    mode: 'generate',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { message: 'Claude가 인강 대본을 쓰는 중…', pct: 10 },
    input: { title, grade, unitIds },
    deck: null,
    htmlPreview: null,
    pptxBuffer: null,
    error: null,
    warnings: []
  };
  jobs.set(id, job);

  setImmediate(() => {
    (async () => {
      const parsed = await askClaudeJson(
        SYSTEM_SCRIPT,
        buildGeneratePrompt({ title, units, grade })
      );
      touch(job, { progress: { message: '칠판 슬라이드 조립 중…', pct: 70 } });
      const deck = coerceDeck(parsed, title, grade);
      const htmlPreview = renderDeckHtml(deck);
      const pptxBuffer = await renderDeckPptx(deck);
      touch(job, {
        status: 'done',
        deck,
        htmlPreview,
        pptxBuffer,
        progress: { message: '완료', pct: 100 }
      });
    })().catch((e) => {
      touch(job, { status: 'error', error: e.message || '생성 실패', progress: { message: e.message, pct: 100 } });
      console.error('grammar lecture job', id, e);
    });
  });

  return publicJob(job);
}

function startRestyleJob(opts, ownerKey) {
  pruneJobs();
  const extractedText = String((opts && opts.extractedText) || '').trim();
  if (extractedText.length < 40) {
    const err = new Error('PPT에서 텍스트를 충분히 읽지 못했습니다. 다른 파일을 올려 보세요.');
    err.statusCode = 400;
    throw err;
  }
  const title = String((opts && opts.title) || '').trim() || '문법 인강 (재구성)';
  const unitHint = String((opts && opts.unitHint) || '').trim();
  const grade = String((opts && opts.grade) || 'M2').toUpperCase();

  const id = newId('glr');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    mode: 'restyle',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { message: '업로드 PPT를 분석·재구성 중…', pct: 15 },
    input: { title, grade, unitHint },
    deck: null,
    htmlPreview: null,
    pptxBuffer: null,
    error: null,
    warnings: []
  };
  jobs.set(id, job);

  setImmediate(() => {
    (async () => {
      const parsed = await askClaudeJson(
        SYSTEM_SCRIPT,
        buildRestylePrompt({ title, extractedText, unitHint })
      );
      touch(job, { progress: { message: '칠판 템플릿으로 재배치 중…', pct: 70 } });
      const deck = coerceDeck(parsed, title, grade);
      const htmlPreview = renderDeckHtml(deck);
      const pptxBuffer = await renderDeckPptx(deck);
      touch(job, {
        status: 'done',
        deck,
        htmlPreview,
        pptxBuffer,
        progress: { message: '완료', pct: 100 }
      });
    })().catch((e) => {
      touch(job, { status: 'error', error: e.message || '재구성 실패', progress: { message: e.message, pct: 100 } });
      console.error('grammar lecture restyle', id, e);
    });
  });

  return publicJob(job);
}

/* ───────── PPTX / PPT text extraction ───────── */

function stripXml(s) {
  return String(s || '')
    .replace(/<a:t[^>]*>/g, '')
    .replace(/<\/a:t>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractTextFromPptxBuffer(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
      const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
      return na - nb;
    });
  const parts = [];
  for (const name of names) {
    const xml = await zip.files[name].async('string');
    const texts = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let m;
    while ((m = re.exec(xml))) {
      const t = stripXml(m[1]);
      if (t) texts.push(t);
    }
    if (texts.length) {
      const num = (name.match(/slide(\d+)/i) || [])[1] || '?';
      parts.push('[슬라이드 ' + num + ']\n' + texts.join('\n'));
    }
  }
  return parts.join('\n\n');
}

function findLibreOffice() {
  const candidates = ['soffice', 'libreoffice', '/usr/bin/soffice', '/usr/bin/libreoffice'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0 || (r.stdout || r.stderr)) return c;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function convertPptToPptx(pptBuffer, originalName) {
  const bin = findLibreOffice();
  if (!bin) {
    const err = new Error(
      '구형 .ppt 파일은 서버에 LibreOffice가 없어 자동 변환할 수 없습니다. PowerPoint/Google에서 .pptx로 저장한 뒤 다시 올려 주세요.'
    );
    err.statusCode = 400;
    err.code = 'PPT_CONVERTER_MISSING';
    throw err;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salt-ppt-'));
  const inPath = path.join(dir, originalName || 'upload.ppt');
  fs.writeFileSync(inPath, pptBuffer);
  const r = spawnSync(bin, [
    '--headless', '--norestore', '--convert-to', 'pptx', '--outdir', dir, inPath
  ], { encoding: 'utf8', timeout: 120000 });
  const outPath = path.join(dir, path.basename(inPath, path.extname(inPath)) + '.pptx');
  if (!fs.existsSync(outPath)) {
    const err = new Error('PPT → PPTX 변환에 실패했습니다. ' + ((r && r.stderr) || '').slice(0, 200));
    err.statusCode = 502;
    throw err;
  }
  const out = fs.readFileSync(outPath);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
  return out;
}

async function extractTextFromUpload(file) {
  if (!file || !file.buffer) {
    const err = new Error('파일이 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  let buf = file.buffer;
  const isPpt = name.endsWith('.ppt') && !name.endsWith('.pptx')
    || mime === 'application/vnd.ms-powerpoint';
  const isPptx = name.endsWith('.pptx')
    || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  if (isPpt) {
    buf = await convertPptToPptx(buf, name.endsWith('.ppt') ? path.basename(name) : 'upload.ppt');
  } else if (!isPptx) {
    // Try pptx parse anyway (some browsers send octet-stream)
    try {
      return await extractTextFromPptxBuffer(buf);
    } catch (_) {
      const err = new Error('PPTX 또는 PPT 파일만 업로드할 수 있습니다.');
      err.statusCode = 400;
      throw err;
    }
  }
  const text = await extractTextFromPptxBuffer(buf);
  if (!text || text.length < 20) {
    const err = new Error('슬라이드에서 텍스트를 거의 찾지 못했습니다. 텍스트가 있는 PPT인지 확인해 주세요.');
    err.statusCode = 400;
    throw err;
  }
  return text;
}

/* ───────── Chalkboard renderers ───────── */

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chalkBoardCss() {
  return `
@page { size: 338.67mm 190.5mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #1a1a1a; font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; }
.stage { position: relative; width: 100vw; height: 56.25vw; max-height: 100vh; max-width: 177.78vh; margin: 0 auto; }
.slide {
  position: absolute; inset: 0; display: none; padding: 4% 28% 4% 4%;
  background-color: #2F6B4F;
  background-image:
    linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px);
  background-size: 28px 28px;
  color: #F7F1DE;
}
.slide.active { display: block; }
.teacher-zone {
  position: absolute; top: 0; right: 0; width: 25%; height: 100%;
  border-left: 2px dashed rgba(255,255,255,0.18);
  pointer-events: none;
}
.badge {
  display: inline-block; font-size: 1.1vw; font-weight: 800; letter-spacing: 0.04em;
  color: #245540; background: #FFE08A; padding: 0.25em 0.7em; border-radius: 999px; margin-bottom: 1.2vw;
}
h1 { margin: 0 0 1.2vw; font-size: 3.6vw; font-weight: 900; color: #fff; line-height: 1.2; word-break: keep-all; }
h2 { margin: 0 0 1.4vw; font-size: 2.8vw; font-weight: 900; color: #FFE08A; line-height: 1.25; word-break: keep-all; }
.lines { list-style: none; padding: 0; margin: 0; }
.lines li {
  font-size: 2vw; font-weight: 800; line-height: 1.45; margin: 0.55vw 0; word-break: keep-all;
  text-shadow: 0 1px 0 rgba(0,0,0,0.25);
}
.formula {
  margin: 1vw 0; padding: 1.2vw 1.4vw; border: 3px solid #FFE08A; border-radius: 12px;
  font-size: 2.4vw; font-weight: 900; color: #fff; background: rgba(0,0,0,0.12);
}
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2vw; margin-top: 0.8vw; }
.col { background: rgba(0,0,0,0.12); border-radius: 10px; padding: 1vw; }
.col h3 { margin: 0 0 0.6vw; font-size: 1.5vw; color: #C8F0D8; }
.ex { margin: 0.7vw 0; }
.ex .en { font-size: 2vw; font-weight: 800; color: #fff; }
.ex .ko { font-size: 1.4vw; font-weight: 600; color: #C8F0D8; opacity: 0.95; }
.trap { margin: 0.8vw 0; font-size: 1.8vw; font-weight: 800; }
.trap .w { color: #FFB4A8; }
.trap .r { color: #B8F0C8; }
.quiz { margin-top: 0.8vw; }
.quiz .q { font-size: 2vw; font-weight: 900; margin-bottom: 0.8vw; }
.quiz .c { font-size: 1.7vw; font-weight: 700; margin: 0.35vw 0; }
.pagenum { position: absolute; left: 4%; bottom: 3%; font-size: 1.1vw; color: rgba(247,241,222,0.7); }
.hud {
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.55);
  color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 13px; z-index: 5;
}
.hud button { background: rgba(255,255,255,0.15); border: 0; color: #fff; border-radius: 999px; width: 32px; height: 32px; cursor: pointer; }
@media print {
  .hud { display: none !important; }
  .stage { width: 338.67mm; height: 190.5mm; max-width: none; max-height: none; }
  .slide { display: block !important; position: relative; width: 338.67mm; height: 190.5mm; page-break-after: always; }
}
`;
}

function renderSlideBody(slide) {
  if (slide.kind === 'title') {
    return '<div class="badge">GRAMMAR LECTURE</div>'
      + '<h1>' + escapeHtml(slide.heading) + '</h1>'
      + (slide.lines.length
        ? '<ul class="lines">' + slide.lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>'
        : '');
  }
  if (slide.kind === 'section') {
    return '<div class="badge">NEXT</div><h1>' + escapeHtml(slide.heading) + '</h1>';
  }
  let html = '';
  if (slide.blockType && BLOCK_LABEL[slide.blockType]) {
    html += '<div class="badge">' + escapeHtml(BLOCK_LABEL[slide.blockType]) + '</div>';
  }
  html += '<h2>' + escapeHtml(slide.heading) + '</h2>';
  if (slide.blockType === 'FORMULA' && slide.lines.length) {
    html += '<div class="formula">' + escapeHtml(slide.lines[0]) + '</div>';
    if (slide.lines.length > 1) {
      html += '<ul class="lines">' + slide.lines.slice(1).map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
    }
  } else if (slide.lines.length) {
    html += '<ul class="lines">' + slide.lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
  }
  if (slide.columns && slide.columns.length) {
    html += '<div class="columns">' + slide.columns.map((col, i) =>
      '<div class="col"><h3>' + (i === 0 ? 'A' : 'B') + '</h3><ul class="lines">'
      + col.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul></div>'
    ).join('') + '</div>';
  }
  if (slide.examples && slide.examples.length) {
    html += slide.examples.map((ex) =>
      '<div class="ex"><div class="en">' + escapeHtml(ex.en) + '</div>'
      + (ex.ko ? '<div class="ko">' + escapeHtml(ex.ko) + '</div>' : '') + '</div>'
    ).join('');
  }
  if (slide.wrongRight && slide.wrongRight.length) {
    html += slide.wrongRight.map((w) =>
      '<div class="trap"><div class="w">❌ ' + escapeHtml(w.wrong) + '</div>'
      + '<div class="r">⭕ ' + escapeHtml(w.right) + '</div></div>'
    ).join('');
  }
  if (slide.quiz && slide.quiz.prompt) {
    html += '<div class="quiz"><div class="q">' + escapeHtml(slide.quiz.prompt) + '</div>'
      + (slide.quiz.choices || []).map((c) => '<div class="c">' + escapeHtml(c) + '</div>').join('')
      + '</div>';
  }
  return html;
}

function renderDeckHtml(deck) {
  const slides = deck.slides.map((s, i) =>
    '<section class="slide' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">'
    + '<div class="teacher-zone" title="강사 존 (비움)"></div>'
    + renderSlideBody(s)
    + '<div class="pagenum">' + (i + 1) + ' / ' + deck.slides.length + '</div>'
    + '</section>'
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)} — 문법 인강</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;900&display=swap" rel="stylesheet">
<style>${chalkBoardCss()}</style></head>
<body>
<div class="stage">${slides}
<div class="hud">
  <button type="button" id="prev">‹</button>
  <span id="c">1 / ${deck.slides.length}</span>
  <button type="button" id="next">›</button>
</div></div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')); var i=0;
  function show(n){ i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){s.classList.toggle('active',k===i);});
    document.getElementById('c').textContent=(i+1)+' / '+slides.length; }
  document.getElementById('prev').onclick=function(){show(i-1);};
  document.getElementById('next').onclick=function(){show(i+1);};
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' ') show(i+1);
    if(e.key==='ArrowLeft') show(i-1);
  });
})();
</script>
</body></html>`;
}

function boardBgDataUri() {
  // Lightweight SVG chalkboard with grid — used as PPTX slide background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
<rect width="1600" height="900" fill="#2F6B4F"/>
<g stroke="rgba(255,255,255,0.08)" stroke-width="1">
${Array.from({ length: 33 }, (_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="900"/>`).join('')}
${Array.from({ length: 19 }, (_, i) => `<line x1="0" y1="${i * 50}" x2="1600" y2="${i * 50}"/>`).join('')}
</g>
<line x1="1200" y1="0" x2="1200" y2="900" stroke="rgba(255,255,255,0.18)" stroke-width="2" stroke-dasharray="10 10"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function renderDeckPptx(deck) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE16x9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE16x9';
  pptx.author = 'Salt Morning Grammar Lecture';
  pptx.title = deck.title;

  const bg = boardBgDataUri();
  // Content lives in left 75% → width ≈ 10.0 inches (margin 0.45)
  const CX = 0.45;
  const CW = 9.4;

  deck.slides.forEach((s) => {
    const slide = pptx.addSlide();
    slide.addImage({ data: bg, x: 0, y: 0, w: '100%', h: '100%' });

    const notes = [];
    if (s.blockType) notes.push('블록: ' + (BLOCK_LABEL[s.blockType] || s.blockType));
    if (s.notes) notes.push(s.notes);
    if (notes.length) slide.addNotes(notes.join('\n\n'));

    let y = 0.45;

    if (s.kind === 'title') {
      slide.addText('GRAMMAR LECTURE', {
        x: CX, y, w: CW, h: 0.4,
        fontSize: 14, bold: true, color: THEME.boardDeep,
        fill: { color: THEME.yellow }, align: 'center'
      });
      y += 0.7;
      slide.addText(s.heading || deck.title, {
        x: CX, y, w: CW, h: 1.6,
        fontSize: 36, bold: true, color: THEME.white, fontFace: 'Arial',
        align: 'center', valign: 'middle'
      });
      y += 1.8;
      if (s.lines.length) {
        slide.addText(s.lines.map((t) => ({ text: t, options: { breakLine: true } })), {
          x: CX, y, w: CW, h: 2.5,
          fontSize: 20, bold: true, color: THEME.cream, fontFace: 'Arial', align: 'center'
        });
      }
      return;
    }

    if (s.kind === 'section') {
      slide.addText('NEXT', {
        x: CX, y, w: 1.6, h: 0.4,
        fontSize: 14, bold: true, color: THEME.boardDeep, fill: { color: THEME.yellow }, align: 'center'
      });
      y += 1.5;
      slide.addText(s.heading, {
        x: CX, y, w: CW, h: 1.5,
        fontSize: 32, bold: true, color: THEME.white, fontFace: 'Arial', align: 'center'
      });
      return;
    }

    if (s.blockType && BLOCK_LABEL[s.blockType]) {
      slide.addText(BLOCK_LABEL[s.blockType], {
        x: CX, y, w: 2.4, h: 0.38,
        fontSize: 13, bold: true, color: THEME.boardDeep, fill: { color: THEME.yellow }, align: 'center'
      });
      y += 0.55;
    }

    slide.addText(s.heading || '', {
      x: CX, y, w: CW, h: 0.7,
      fontSize: 26, bold: true, color: THEME.yellow, fontFace: 'Arial'
    });
    y += 0.85;

    if (s.blockType === 'FORMULA' && s.lines[0]) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: CX, y, w: CW, h: 1.0,
        fill: { color: THEME.boardDeep },
        line: { color: THEME.yellow, width: 2 }
      });
      slide.addText(s.lines[0], {
        x: CX + 0.2, y: y + 0.15, w: CW - 0.4, h: 0.7,
        fontSize: 24, bold: true, color: THEME.white, fontFace: 'Arial', align: 'center'
      });
      y += 1.2;
      if (s.lines.length > 1) {
        slide.addText(s.lines.slice(1).map((t) => ({ text: t, options: { breakLine: true } })), {
          x: CX, y, w: CW, h: 2.2,
          fontSize: 18, bold: true, color: THEME.cream, fontFace: 'Arial'
        });
        y += 2.0;
      }
    } else if (s.lines.length) {
      slide.addText(s.lines.map((t) => ({ text: t, options: { breakLine: true } })), {
        x: CX, y, w: CW, h: Math.min(3.2, 0.45 * s.lines.length + 0.4),
        fontSize: 20, bold: true, color: THEME.cream, fontFace: 'Arial'
      });
      y += Math.min(3.0, 0.45 * s.lines.length + 0.5);
    }

    if (s.columns && s.columns.length === 2) {
      const colW = (CW - 0.3) / 2;
      s.columns.forEach((col, i) => {
        const x = CX + i * (colW + 0.3);
        slide.addShape(pptx.ShapeType.roundRect, {
          x, y, w: colW, h: 2.4,
          fill: { color: THEME.boardDeep }
        });
        slide.addText((i === 0 ? 'A' : 'B') + '\n' + col.join('\n'), {
          x: x + 0.15, y: y + 0.15, w: colW - 0.3, h: 2.1,
          fontSize: 16, bold: true, color: THEME.cream, fontFace: 'Arial'
        });
      });
      y += 2.6;
    }

    if (s.examples && s.examples.length) {
      const chunks = s.examples.slice(0, 3).map((ex) => {
        const line = ex.en + (ex.ko ? '\n' + ex.ko : '');
        return { text: line, options: { breakLine: true } };
      });
      slide.addText(chunks, {
        x: CX, y, w: CW, h: 2.2,
        fontSize: 18, bold: true, color: THEME.white, fontFace: 'Arial'
      });
      y += 2.0;
    }

    if (s.wrongRight && s.wrongRight.length) {
      const rows = [];
      s.wrongRight.slice(0, 3).forEach((w) => {
        rows.push({ text: 'X  ' + w.wrong, options: { breakLine: true, color: THEME.softRed } });
        rows.push({ text: 'O  ' + w.right, options: { breakLine: true, color: THEME.softOk } });
      });
      slide.addText(rows, {
        x: CX, y, w: CW, h: 2.8,
        fontSize: 17, bold: true, fontFace: 'Arial'
      });
    }

    if (s.quiz && s.quiz.prompt) {
      const qLines = [{ text: s.quiz.prompt, options: { breakLine: true } }]
        .concat((s.quiz.choices || []).map((c) => ({ text: c, options: { breakLine: true } })));
      slide.addText(qLines, {
        x: CX, y, w: CW, h: 3.5,
        fontSize: 18, bold: true, color: THEME.cream, fontFace: 'Arial'
      });
    }
  });

  const buf = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buf);
}

function safeFilename(title) {
  return String(title || 'grammar-lecture').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'grammar-lecture';
}

module.exports = {
  MAX_UNITS,
  BLOCK_TYPES,
  BLOCK_LABEL,
  startGenerateJob,
  startRestyleJob,
  getJob,
  publicJob,
  extractTextFromUpload,
  renderDeckHtml,
  renderDeckPptx,
  safeFilename,
  isClaudeConfigured
};
