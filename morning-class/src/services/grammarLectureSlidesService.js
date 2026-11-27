'use strict';

/**
 * Grammar lecture slides (인강용 PPT) for Class Tools / grammar-clinic.
 *
 * Mode A: pick up to 2 catalog units → Claude picks content blocks → chalkboard PPTX
 * Mode B: free-text custom topic (e.g. 8품사 개요) when not in the catalog
 *
 * Layout contract (all slides):
 * - 16:9
 * - Right 25% always empty (teacher standing zone on e-board)
 * - Solid chalkboard green background (no grid)
 * - Chalk-light text only (never dark ink)
 * - One content block per slide; bold large type
 * - On-screen PPT text is calm / textbook-like; script alone is 일타강사 tone
 * - Quiz answers live in notes; speaking script in script (both go to PPT notes)
 *
 * Pipeline: blueprint (curriculum + companion points) → slides from that
 * blueprint → audit for content, omissions, and structure → one revise if it fails.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const {
  formatQuizPromptLines,
  ACCURACY_LAW,
  hasGeminiKey
} = require('./grammarVerifyService');
const { getUnitsByIds } = require('./grammarClinic/catalog');

const MAX_UNITS = 2;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 60;
const TMP_ROOT = path.join(os.tmpdir(), 'salt-grammar-lecture');
const JOBS_DIR = path.join(TMP_ROOT, 'jobs');
const jobs = new Map();
const persistTimers = new Map();

function ensureJobsDir() {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobDir(id) {
  return path.join(JOBS_DIR, String(id));
}

function jobMetaPath(id) {
  return path.join(jobDir(id), 'meta.json');
}

function jobPptxPath(id) {
  return path.join(jobDir(id), 'deck.pptx');
}

function serializeJob(job) {
  return {
    id: job.id,
    ownerKey: job.ownerKey,
    mode: job.mode,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    input: job.input,
    deck: job.deck || null,
    htmlPreview: job.htmlPreview || null,
    scriptHtml: job.scriptHtml || null,
    warnings: job.warnings || [],
    error: job.error || null,
    hasPptx: !!(job.pptxBuffer && job.pptxBuffer.length)
  };
}

function persistJobNow(job) {
  if (!job || !job.id) return;
  try {
    ensureJobsDir();
    const dir = jobDir(job.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(serializeJob(job)));
    if (job.pptxBuffer && job.pptxBuffer.length) {
      fs.writeFileSync(jobPptxPath(job.id), job.pptxBuffer);
    }
  } catch (e) {
    console.warn('grammar lecture disk persist failed', job.id, e.message);
  }
}

function schedulePersist(job, immediate) {
  if (!job || !job.id) return;
  if (immediate) {
    if (persistTimers.has(job.id)) {
      clearTimeout(persistTimers.get(job.id));
      persistTimers.delete(job.id);
    }
    persistJobNow(job);
    return;
  }
  if (persistTimers.has(job.id)) return;
  persistTimers.set(job.id, setTimeout(() => {
    persistTimers.delete(job.id);
    persistJobNow(job);
  }, 600));
}

function loadJobFromDisk(jobId) {
  const metaFile = jobMetaPath(jobId);
  if (!fs.existsSync(metaFile)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    let pptxBuffer = null;
    const pptxFile = jobPptxPath(jobId);
    if (meta.hasPptx && fs.existsSync(pptxFile)) {
      pptxBuffer = fs.readFileSync(pptxFile);
    }
    const job = {
      id: meta.id,
      ownerKey: meta.ownerKey || '',
      mode: meta.mode || 'generate',
      status: meta.status,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      progress: meta.progress,
      input: meta.input,
      deck: meta.deck || null,
      htmlPreview: meta.htmlPreview || null,
      scriptHtml: meta.scriptHtml || null,
      pptxBuffer,
      warnings: meta.warnings || [],
      error: meta.error || null,
      fromDisk: true
    };
    jobs.set(job.id, job);
    return job;
  } catch (e) {
    console.warn('grammar lecture disk load failed', jobId, e.message);
    return null;
  }
}

function deleteJobDisk(jobId) {
  const dir = jobDir(jobId);
  if (!fs.existsSync(dir)) return;
  try {
    fs.readdirSync(dir).forEach((f) => {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ }
    });
    fs.rmdirSync(dir);
  } catch (_) { /* ignore */ }
}

function jobNotFoundError() {
  const err = new Error(
    '슬라이드 작업을 찾을 수 없습니다. 서버가 재시작됐거나 만료됐을 수 있어요. 화면의 미리보기가 남아 있으면 PPT는 다시 만들 수 있습니다.'
  );
  err.statusCode = 404;
  return err;
}

const BLOCK_TYPES = [
  'HOOK',           // 도입예문
  'FORMULA',        // 핵심 규칙·공식 (예보다 먼저)
  'ONE_LINER',      // 한줄 예문
  'USAGE',          // 용법 구분
  'PAIR',           // 짝꿍 표현
  'FORMS',          // 형태 변화 예시 표 (규칙 장 다음에)
  'TRAP',           // 비문 ↔ 정문
  'BAN',            // 같이 못 씀 / 예외
  'TRANSFORM',      // 전환 공식
  'FUN',            // 어원·문화 잡지식
  'CONCEPT_CHECK',  // 간단한 개념확인 (O/X·짧은 선택)
  'QUIZ',           // 내신형 미니 퀴즈
  'CLOSER'          // 핵심 요약 마무리
];

const BLOCK_LABEL = {
  HOOK: '도입예문',
  FORMULA: '핵심 규칙',
  ONE_LINER: '한줄 예문',
  USAGE: '용법 구분',
  PAIR: '짝꿍 표현',
  FORMS: '형태 변화',
  TRAP: '비문 ↔ 정문',
  BAN: '예외·금지',
  TRANSFORM: '전환 공식',
  FUN: '어원·배경',
  CONCEPT_CHECK: '개념 확인',
  QUIZ: '내신 퀴즈',
  CLOSER: '마무리'
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

/** Grammar lecture only — Opus by default; other Class Tools stay on Sonnet. */
const DEFAULT_LECTURE_CLAUDE_MODEL = 'claude-opus-5-5';

function claudeModel() {
  return String(
    process.env.GRAMMAR_LECTURE_CLAUDE_MODEL
    || DEFAULT_LECTURE_CLAUDE_MODEL
  ).trim() || DEFAULT_LECTURE_CLAUDE_MODEL;
}

function lectureClaudeModels() {
  const primary = claudeModel();
  const extras = String(process.env.GRAMMAR_LECTURE_CLAUDE_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = ['claude-opus-5-5', 'claude-opus-4-5', 'claude-sonnet-4-5'];
  const seen = new Set();
  const out = [];
  [primary].concat(extras).concat(defaults).forEach((m) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    out.push(m);
  });
  return out;
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
      models: lectureClaudeModels()
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

const SYSTEM_BLUEPRINT = `당신은 한국 중·고등학교 영어 문법 단원을 정리하는 편집장입니다.
슬라이드를 쓰지 마세요. 강의 전에, 이 문법 요소를 교과서와 시중 참고서가 어떤 순서로 설명하는지, 그리고 그 설명에 반드시 또는 보통 함께 들어가는 요소가 무엇인지만 기준표로 만듭니다.

[기준]
- 대상은 한국 중학교·고등학교 내신입니다. 능률·천재·동아·비상·문법 바이블류가 그 단원에서 같이 넣는 구성을 따르세요.
- 대학 언어학, 드문 원어민 예외, 수능만의 말장난으로 수업을 넓히지 마세요.
- mustCover는 이 주제를 가르칠 때 빠지면 단원이 성립하지 않는 항목만. 최대 12개. 항목끼리 내용이 겹치지 않게.
- usuallyCover는 참고서가 보통 뒤에 붙이는 짝꿍·강조·예외입니다. 최대 8개. 필수는 아닙니다.
- neverClaim은 이 주제에서 자주 지어내는 거짓 절대규칙입니다. 확실하지 않은 규칙은 mustCover에 넣지 마세요.
- howTextbooksExplain은 설명 순서입니다. 정의, 형태, 대표 구분, 같이 오는 표현, 학생 실수. 4문장 이내.
- slideBeats는 그 순서를 강의 장면 이름으로만 적습니다. 최대 14개. 예문 문장은 적지 마세요.
- 카탈로그 힌트가 교과서 설명과 어긋나면 교과서를 따르고, 어긋난 힌트는 neverClaim이나 생략으로 처리하세요.

[깊이 예시]
이번 주제와 같은 단원일 때만 아래 수준으로 적으세요. 다른 단원 내용을 이번 기준표에 넣지 마세요.
- 비교급: -er / -ier / more, than, 강조 부사, 이중비교 금지.
- 문장 형식·4형식: to / for / of 분류. for를 취하는 동사 buy, make, cook, get, find. 4형식이 안 되는 동사 explain me [X] → explain to me [O]. 대명사 목적어 Give me it [X] → Give it to me [O].
- 동명사와 to부정사: 목적어로 동명사를 취하는 enjoy, finish, mind와 to부정사를 취하는 want, hope, decide. 뜻이 갈리는 remember, forget, stop + to-v / v-ing. 전치사 to 뒤는 동명사 look forward to -ing.
- 관계대명사: 선행사 유무와 주격·목적격·소유격. 생략은 목적격, 또는 주격 뒤에 be동사. 계속적 용법에서는 that, what 불가 (, that [X]).

출력 JSON만:
{
  "topic": "",
  "howTextbooksExplain": "",
  "mustCover": [{ "id": "m1", "point": "", "whyTogether": "", "screen": "화면에 남을 한 줄" }],
  "usuallyCover": [{ "id": "u1", "point": "", "whyTogether": "" }],
  "neverClaim": [""],
  "slideBeats": [""]
}`;

const SYSTEM_WRITE = `당신은 한국 중등 영어 문법 인강 슬라이드를 쓰는 작가입니다.
이미 잠긴 기준표만 보고 슬라이드 JSON을 만듭니다. 기준표에 없는 새 문법 규칙을 추가하지 마세요.

[화면과 대본]
- 화면(heading, lines, columns, examples, wrongRight, quiz)은 차분한 교과서 판서입니다. 구호, 감탄, 이모지, 유행어는 넣지 마세요.
- script는 그 장에서 강사가 할 말 전체입니다. 중학생에게 질문하고 답하고, 비유해도 됩니다. 화면 문장을 그대로 읽지 마세요.
- 퀴즈 정답과 해설은 notes에만 둡니다. 화면에는 문제와 보기만.

[블록]
HOOK 도입 / FORMULA 규칙 / ONE_LINER 예문 하나 / USAGE 용법 / PAIR 짝꿍 /
FORMS 형태 표 / TRAP 비문과 정문 / BAN 예외·금지 / TRANSFORM 전환 /
FUN 배경 / CONCEPT_CHECK 개념확인 / QUIZ 내신 퀴즈 / CLOSER 요약

[구성]
- 순서: 제목 → 도입 → 규칙(FORMULA) → 그 규칙의 새 예(FORMS 또는 ONE_LINER) → 함정 → 개념확인 → 내신 퀴즈 → 요약.
- 한 슬라이드에는 블록 하나만. lines는 6줄 이하.
- 같은 영어 예문·같은 단어 쌍은 한 번만 씁니다. 한 슬라이드의 제목, 본문, 표, 예문 칸에 반복하지 마세요. 바로 다음 슬라이드에도 그 예문을 다시 쓰지 마세요. 규칙을 보여 주는 문장과 표의 문장은 서로 다르게 쓰세요.
- FORMULA에는 규칙만 두고, 다음 장에 새 예를 둡니다. 규칙 없이 예만 있는 표는 만들지 마세요.
- mustCover는 모두 화면 글에 보여야 합니다. script에만 있으면 빠진 것입니다. usuallyCover는 전체 28장을 넘지 않을 때만 넣으세요.
- CONCEPT_CHECK 1장, QUIZ 1장, CLOSER 1장. FUN은 사실이 있을 때만 1장.
- 주제가 둘이면 사이에 section. 전체 최대 28장.
- quiz.prompt는 한국어 발문과 영어 문장을 \\n 으로 나눕니다. 영어 문장 중간에서 끊지 마세요.
  예: "다음 빈칸에 알맞은 것은?\\nThe student _______ answered was smart."
- 예문은 그 슬라이드 규칙을 실제로 보여 주는 올바른 영어여야 합니다.
- TRAP은 wrongRight. USAGE·FORMS는 columns 2열. CONCEPT_CHECK·QUIZ는 quiz와 notes. CONCEPT_CHECK는 보기 2~3개 또는 O/X.
- 모든 슬라이드에 script가 있어야 합니다. title·section은 3~6문장, 일반 슬라이드는 8~14문장.

[사실]
` + ACCURACY_LAW + `
기준표 neverClaim에 있는 말은 화면과 script 어디에도 쓰지 마세요.

출력은 { title, grade, slides } JSON만.`;

const SLIDE_SCHEMA_HINT = {
  title: '강의 제목',
  grade: 'M2',
  slides: [{
    kind: 'title|section|content',
    unitId: 'optional unit id for content/section',
    blockType: 'HOOK|FORMULA|ONE_LINER|USAGE|PAIR|FORMS|TRAP|BAN|TRANSFORM|FUN|CONCEPT_CHECK|QUIZ|CLOSER|null for title/section',
    heading: '점잖은 짧은 제목 (구호·감탄 금지)',
    lines: ['화면에 보이는 차분한 판서 — 최대 6줄. 같은 예문을 이 배열 안에 두 번 넣지 말 것.'],
    columns: [['왼쪽 헤더+항목'], ['오른쪽 헤더+항목']],
    examples: [{ en: '이 슬라이드의 lines·columns와 겹치지 않는 새 예문', ko: '...' }],
    wrongRight: [{ wrong: '...', right: '...' }],
    quiz: {
      prompt: '한국어 발문\\n영어 문장',
      choices: ['① …', '② …']
    },
    script: '이 슬라이드 전체 대본 — 여기만 구어체 (필수)',
    notes: 'CONCEPT_CHECK/QUIZ면 정답·해설만. 그 외는 비워도 됨.'
  }]
};

const SYSTEM_AUDIT = `당신은 한국 중등 영어 인강 슬라이드 감수자입니다.
고치지 마세요. 잠긴 기준표와 슬라이드를 비교해 합격인지 탈락인지만 JSON으로 판정합니다.

[탈락]
- content: 거짓 규칙, 비문, 규칙과 다른 예문, 교육과정 용어 오류, neverClaim을 말한 경우. 화면과 script를 모두 봅니다.
- omission: mustCover 항목이 화면 글(heading, lines, columns, examples, wrongRight, quiz)에 없음. script에만 있으면 빠진 것입니다. usuallyCover가 없어도 mustCover가 화면에 있으면 severity는 medium.
- structure: 구성 오류.
  · 같은 영어 예문이나 같은 단어 쌍이 한 슬라이드에 두 번 (제목·본문·표·예문 칸·보기 사이 포함)
  · 바로 옆 슬라이드에 같은 예문
  · 한 장에 서로 다른 블록이 섞임
  · 규칙 없이 예만 있는 표
  · 정답이 lines나 choices에 드러남
  · 화면에 구호·이모지
  · lines가 7줄 이상
  · 퀴즈 발문과 영어 문장이 한 줄에 붙음
  · 화면이 비어 있음

[판정]
- high가 하나라도 있으면 pass는 false.
- 애매하면 탈락시키지 마세요. 확실한 것만 issues에 넣으세요.
- 이슈는 최대 12개. 같은 문제를 장마다 반복해 적지 마세요.
- 수정 지시가 아니라 무엇이 틀렸는지 한 문장으로 적으세요.

출력 JSON만:
{
  "pass": true,
  "issues": [{
    "kind": "content|omission|structure",
    "severity": "high|medium",
    "slide": 3,
    "point": "mustCover id 또는 짧은 이름",
    "detail": "무엇이 틀렸고 무엇을 바꾸면 되는지 한 문장"
  }]
}`;

const SYSTEM_REVISE = `당신은 한국 중등 영어 인강 슬라이드 수정 편집자입니다.
검수에서 걸린 항목만 고친 전체 덱을 JSON으로 반환합니다.

[수정]
- issues에 없는 슬라이드의 규칙과 예문은 유지하세요.
- mustCover는 수정 후에도 모두 화면 글에 남아 있어야 합니다. script에만 넣지 마세요.
- 고치면서 같은 영어 예문을 그 슬라이드나 바로 옆 슬라이드에 다시 넣지 마세요. 중복이면 한쪽만 새 예문으로 바꿉니다.
- neverClaim은 추가하지 마세요. 거짓 규칙은 삭제하거나 조건이 있는 바른 설명으로 바꿉니다.
- 정답은 notes만. 화면은 교과서 판서, script만 구어체.
- 스키마는 초안과 같습니다. 전체 최대 28장. lines는 6줄 이하.
- quiz.prompt는 한국어 발문과 영어 문장을 \\n 으로 나눕니다.

출력은 { title, grade, slides } JSON만.`;

function clipText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max || 400);
}

function catalogSpecs(units) {
  return (units || []).map((u) => ({
    unitId: u.unitId,
    grade: u.grade,
    category: u.category,
    subCategory: u.subCategory,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
}

function sanitizeCoverList(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((item, i) => {
    if (out.length >= max) return;
    if (typeof item === 'string') {
      const point = clipText(item, 160);
      if (!point) return;
      out.push({ id: 'c' + (out.length + 1), point, whyTogether: '', screen: '' });
      return;
    }
    if (!item || typeof item !== 'object') return;
    const point = clipText(item.point || item.item || item.title, 160);
    if (!point) return;
    out.push({
      id: clipText(item.id, 24) || ('c' + (i + 1)),
      point,
      whyTogether: clipText(item.whyTogether || item.why, 220),
      screen: clipText(item.screen, 180)
    });
  });
  return out;
}

function unwrapObject(raw, key) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw[key] && typeof raw[key] === 'object') return raw[key];
  return raw;
}

function sanitizeBlueprint(raw, title) {
  const src = unwrapObject(raw, 'blueprint') || {};
  const mustCover = sanitizeCoverList(src.mustCover || src.required || src.points, 12);
  if (!mustCover.length) {
    const err = new Error('기준표에 함께 설명할 항목이 없습니다. 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  return {
    topic: clipText(src.topic || title, 120),
    howTextbooksExplain: clipText(src.howTextbooksExplain || src.approach, 800),
    mustCover,
    usuallyCover: sanitizeCoverList(src.usuallyCover || src.optional, 8),
    neverClaim: (Array.isArray(src.neverClaim) ? src.neverClaim : [])
      .map((x) => clipText(x, 180)).filter(Boolean).slice(0, 8),
    slideBeats: (Array.isArray(src.slideBeats) ? src.slideBeats : [])
      .map((x) => clipText(typeof x === 'string' ? x : (x && x.title), 80))
      .filter(Boolean)
      .slice(0, 16)
  };
}

function buildBlueprintPrompt({ title, units, grade, customTopic }) {
  const specs = catalogSpecs(units);
  const custom = String(customTopic || '').trim();
  return [
    '다음 문법 요소의 강의 기준표를 작성하라. 슬라이드는 쓰지 말 것.',
    'title: ' + title,
    'schoolGrade: ' + grade,
    custom ? ('customTopic: ' + custom) : '',
    specs.length
      ? 'catalog hints (교과서와 어긋나면 고쳐서 반영):\n' + JSON.stringify(specs, null, 2)
      : 'catalog: 없음. customTopic만으로 교과서·참고서 공통 구성을 정리할 것.',
    '',
    'mustCover에는 이 주제를 설명할 때 같이 나와야 하는 형태·구분·짝꿍·예외만 넣으세요.',
    '깊이 예시와 같은 단원이면 그 목록·함정·구분을 항목에 적으세요. 다른 단원 예시는 넣지 마세요.'
  ].filter(Boolean).join('\n');
}

function buildWritePrompt({ title, units, grade, blueprint }) {
  const ids = (units || []).map((u) => ({ unitId: u.unitId, subCategory: u.subCategory }));
  return [
    '잠긴 기준표만 보고 인강 슬라이드를 작성하라. 표 밖의 규칙을 추가하지 말 것.',
    'title: ' + title,
    'schoolGrade: ' + grade,
    'blueprint:',
    JSON.stringify(blueprint, null, 2),
    ids.length
      ? 'unitId는 아래 id만 사용:\n' + JSON.stringify(ids)
      : 'unitId는 비워도 됩니다.',
    '',
    'JSON 스키마:',
    JSON.stringify(SLIDE_SCHEMA_HINT, null, 2)
  ].join('\n');
}

function deckForAudit(deck) {
  const slides = Array.isArray(deck && deck.slides) ? deck.slides : [];
  return {
    title: deck && deck.title,
    grade: deck && deck.grade,
    slides: slides.map((s, i) => ({
      index: s.index || (i + 1),
      kind: s.kind,
      blockType: s.blockType,
      heading: s.heading,
      lines: s.lines,
      columns: s.columns,
      examples: s.examples,
      wrongRight: s.wrongRight,
      quiz: s.quiz,
      notes: s.notes,
      script: String(s.script || '').slice(0, 700)
    }))
  };
}

function buildAuditPrompt({ blueprint, document }) {
  return [
    '기준표와 슬라이드를 비교해 합격·탈락을 판정하라. 덱을 고치지 말 것.',
    'blueprint:',
    JSON.stringify(blueprint, null, 2),
    '',
    'slides:',
    JSON.stringify(deckForAudit(document), null, 2)
  ].join('\n');
}

function buildRevisePrompt({ blueprint, document, issues }) {
  return [
    '검수에서 걸린 항목만 고친 전체 덱을 반환하라.',
    'blueprint:',
    JSON.stringify(blueprint, null, 2),
    '',
    'issues:',
    JSON.stringify(issues, null, 2),
    '',
    'current deck:',
    JSON.stringify({
      title: document && document.title,
      grade: document && document.grade,
      slides: (document && document.slides) || []
    }, null, 2)
  ].join('\n');
}

function sanitizeIssues(list) {
  if (!Array.isArray(list)) return [];
  const kinds = { content: 1, omission: 1, structure: 1 };
  const out = [];
  list.forEach((item) => {
    if (out.length >= 12 || !item || typeof item !== 'object') return;
    const kind = String(item.kind || item.type || '').toLowerCase();
    if (!kinds[kind]) return;
    const detail = clipText(item.detail || item.fix || item.problem, 320);
    if (!detail) return;
    const severity = String(item.severity || '').toLowerCase() === 'medium' ? 'medium' : 'high';
    const slide = Number(item.slide || item.slideIndex);
    out.push({
      kind,
      severity,
      slide: Number.isFinite(slide) && slide >= 1 ? slide : null,
      point: clipText(item.point || item.id, 120),
      detail
    });
  });
  return out;
}

function sanitizeAudit(raw) {
  const src = unwrapObject(raw, 'audit') || {};
  const issues = sanitizeIssues(src.issues || src.findings);
  const pass = src.pass !== false && src.passed !== false;
  return { pass, issues };
}

function normalizeExample(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”„"«»]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function englishSpans(text) {
  const runs = String(text || '').match(/[A-Za-z][A-Za-z0-9'’][A-Za-z0-9'’,.!? :;\-]{10,}/g) || [];
  const spans = [];
  runs.forEach((run) => {
    const parts = run.split(/(?<=[.!?])\s+/);
    (parts.length > 1 ? parts : [run]).forEach((part) => {
      const norm = normalizeExample(part);
      const letters = (norm.match(/[a-z]/g) || []).length;
      if (norm.length >= 18 && letters >= 12) spans.push(norm);
    });
  });
  return spans;
}

function slideExampleSpans(slide) {
  const bag = [];
  function add(text) {
    englishSpans(text).forEach((span) => bag.push(span));
  }
  (slide.lines || []).forEach(add);
  (slide.columns || []).forEach((col) => (Array.isArray(col) ? col : []).forEach(add));
  (slide.examples || []).forEach((ex) => add(ex && ex.en));
  (slide.wrongRight || []).forEach((pair) => {
    add(pair && pair.wrong);
    add(pair && pair.right);
  });
  if (slide.quiz) {
    add(slide.quiz.prompt);
    (slide.quiz.choices || []).forEach(add);
  }
  return bag;
}

/** Same English example twice on one slide, or repeated on the next slide. */
function findStructureIssues(deck) {
  const slides = (deck && deck.slides) || [];
  const issues = [];
  function push(issue) {
    if (issues.length >= 12) return;
    issues.push(issue);
  }
  slides.forEach((slide, i) => {
    const counts = new Map();
    slideExampleSpans(slide).forEach((span) => {
      counts.set(span, (counts.get(span) || 0) + 1);
    });
    counts.forEach((count, text) => {
      if (count < 2) return;
      push({
        kind: 'structure',
        severity: 'high',
        slide: slide.index || (i + 1),
        point: '중복 예문',
        detail: '같은 영어 예문이 이 슬라이드에 ' + count + '번 있습니다: ' + text
      });
    });
  });
  for (let i = 0; i < slides.length - 1; i++) {
    const prev = new Set(slideExampleSpans(slides[i]));
    const dup = slideExampleSpans(slides[i + 1]).find((span) => prev.has(span));
    if (!dup) continue;
    push({
      kind: 'structure',
      severity: 'high',
      slide: slides[i + 1].index || (i + 2),
      point: '인접 슬라이드 중복',
      detail: '앞 슬라이드와 같은 예문입니다: ' + dup
    });
  }
  return issues;
}

function mergeIssues(modelIssues, codeIssues) {
  const seen = new Set();
  const out = [];
  modelIssues.concat(codeIssues).forEach((item) => {
    const key = item.kind + '|' + (item.slide || '') + '|' + item.detail;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out.slice(0, 12);
}

function auditFailed(modelPass, issues) {
  if (issues.some((item) => item.severity === 'high')) return true;
  return modelPass === false && issues.length > 0;
}

function unwrapDeck(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.slides)) return parsed;
  const nested = parsed.document || parsed.deck;
  if (nested && Array.isArray(nested.slides)) return nested;
  return null;
}

async function askAuditJson(system, prompt) {
  if (hasGeminiKey()) {
    try {
      const result = await askGemini(prompt, {
        provider: 'gemini',
        systemInstruction: system,
        temperature: 0.1,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
        timeoutMs: 120000
      });
      const text = (result && (result.answer || result.text)) || result;
      const parsed = extractJson(text);
      if (parsed) return parsed;
    } catch (e) {
      console.warn('lecture audit gemini failed, falling back to claude', e.message);
    }
  }
  return askClaudeJson(system, prompt, { temperature: 0.1, maxOutputTokens: 4000 });
}

async function generateThenReview({ title, units, grade, customTopic, onProgress }) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  report({ message: '교육과정·참고서 기준표를 정리하는 중…', pct: 12 });
  const blueprint = sanitizeBlueprint(
    await askClaudeJson(
      SYSTEM_BLUEPRINT,
      buildBlueprintPrompt({ title, units, grade, customTopic }),
      { temperature: 0.2, maxOutputTokens: 4000 }
    ),
    title
  );

  report({ message: '기준표에 맞춰 슬라이드를 쓰는 중…', pct: 32 });
  let doc = unwrapDeck(await askClaudeJson(
    SYSTEM_WRITE,
    buildWritePrompt({ title, units, grade, blueprint }),
    { temperature: 0.4, maxOutputTokens: 16000 }
  ));
  if (!doc) {
    const err = new Error('슬라이드 초안을 읽지 못했습니다. 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }

  const rounds = [];
  async function runAudit(document, pct, message) {
    report({ message, pct });
    let model = { pass: true, issues: [] };
    let auditError = null;
    try {
      model = sanitizeAudit(await askAuditJson(
        SYSTEM_AUDIT,
        buildAuditPrompt({ blueprint, document })
      ));
    } catch (e) {
      auditError = e.message || 'audit failed';
    }
    const issues = mergeIssues(model.issues, findStructureIssues(document));
    const failed = auditFailed(auditError ? null : model.pass, issues);
    rounds.push({
      failed,
      count: issues.length,
      error: auditError
    });
    return { issues, failed, auditError };
  }

  let audit = await runAudit(doc, 54, '내용·빠짐·구성 검수 중…');
  if (audit.failed) {
    report({ message: '검수에서 걸린 항목을 수정하는 중…', pct: 68 });
    try {
      const revised = unwrapDeck(await askClaudeJson(
        SYSTEM_REVISE,
        buildRevisePrompt({ blueprint, document: doc, issues: audit.issues }),
        { temperature: 0.2, maxOutputTokens: 16000 }
      ));
      if (revised) doc = revised;
      else doc.__reviseError = 'revise returned no slides';
    } catch (e) {
      doc.__reviseError = e.message || 'revise failed';
    }
    if (!doc.__reviseError) {
      audit = await runAudit(doc, 82, '수정본을 다시 검수하는 중…');
    }
  }

  doc.__audit = {
    mustCover: blueprint.mustCover.length,
    rounds,
    remaining: audit.issues,
    auditError: audit.auditError || null
  };
  return doc;
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
      prompt: formatQuizPromptLines(String(raw.quiz.prompt || '').trim()),
      choices: Array.isArray(raw.quiz.choices)
        ? raw.quiz.choices.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 5)
        : []
    };
  }
  if ((blockType === 'CONCEPT_CHECK' || blockType === 'QUIZ') && (!quiz || !quiz.prompt)) {
    if (lines.length) {
      quiz = {
        prompt: lines[0],
        choices: lines.slice(1)
      };
    }
  }
  let script = String((raw && (raw.script || raw.speakingScript || raw.narration)) || '').trim();
  let notes = String((raw && raw.notes) || '').trim();
  if (!script && notes && blockType !== 'CONCEPT_CHECK' && blockType !== 'QUIZ') {
    script = notes;
    notes = '';
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
    script,
    notes
  };
}

function coerceDeck(parsed, fallbackTitle, grade) {
  const slidesRaw = Array.isArray(parsed && parsed.slides) ? parsed.slides : [];
  let slides = slidesRaw.map(coerceSlide).filter((s) =>
    s.heading || s.lines.length || s.script || (s.quiz && s.quiz.prompt) || s.kind === 'title'
  );
  if (slides.length > 28) slides = slides.slice(0, 28);
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
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) {
      jobs.delete(id);
      deleteJobDisk(id);
    }
  }
  if (jobs.size <= MAX_JOBS) return;
  const ordered = Array.from(jobs.values())
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  while (jobs.size > MAX_JOBS && ordered.length) {
    const old = ordered.shift();
    if (!old) break;
    jobs.delete(old.id);
    deleteJobDisk(old.id);
  }
}

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
  const doneOrError = job.status === 'done' || job.status === 'error';
  schedulePersist(job, doneOrError || !!(patch && (patch.deck || patch.pptxBuffer)));
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
    out.scriptHtml = job.scriptHtml || (job.deck ? renderDeckScriptHtml(job.deck) : null);
    out.htmlUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/html';
    out.scriptUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/script';
    out.deckUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/deck';
    out.pdfUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/pdf';
    out.pptxUrl = '/api/grammar-clinic/lecture/jobs/' + job.id + '/pptx';
  }
  return out;
}

function getJob(jobId, ownerKey) {
  pruneJobs();
  const id = String(jobId || '');
  let job = jobs.get(id);
  if (!job) job = loadJobFromDisk(id);
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== String(ownerKey)) {
    const err = jobNotFoundError();
    throw err;
  }
  return job;
}

/** Accept a client-held deck (after job expiry) and normalize for export. */
function deckFromClient(raw, fallbackTitle) {
  if (!raw || typeof raw !== 'object') {
    const err = new Error('내보낼 슬라이드 데이터가 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const grade = String(raw.grade || 'M2').toUpperCase();
  const title = String(raw.title || fallbackTitle || 'grammar-lecture').trim();
  return coerceDeck(raw, title, grade);
}

function startGenerateJob(opts, ownerKey) {
  pruneJobs();
  const customTopic = String((opts && opts.customTopic) || '').trim();
  const unitIds = Array.isArray(opts && opts.unitIds) ? opts.unitIds.map(String) : [];
  if (unitIds.length > MAX_UNITS) {
    const err = new Error('인강 슬라이드는 문법을 최대 2개까지 선택할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  if (!customTopic && !unitIds.length) {
    const err = new Error('카탈로그 문법을 1~2개 고르거나, 직접 주제를 입력하세요.');
    err.statusCode = 400;
    throw err;
  }
  if (customTopic && customTopic.length < 2) {
    const err = new Error('직접 주제를 조금 더 구체적으로 적어 주세요.');
    err.statusCode = 400;
    throw err;
  }
  if (customTopic.length > 500) {
    const err = new Error('직접 주제는 500자 이내로 적어 주세요.');
    err.statusCode = 400;
    throw err;
  }
  const units = unitIds.length ? getUnitsByIds(unitIds) : [];
  if (unitIds.length && !units.length) {
    const err = new Error('선택한 문법 유닛을 찾을 수 없습니다.');
    err.statusCode = 400;
    throw err;
  }
  const grade = String((opts && opts.grade) || (units[0] && units[0].grade) || 'M2').toUpperCase();
  const title = String((opts && opts.title) || '').trim()
    || (customTopic
      ? (customTopic.length > 40 ? customTopic.slice(0, 40) + '…' : customTopic) + ' 인강'
      : units.map((u) => u.subCategory).join(' · ') + ' 인강');

  const id = newId('gl');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    mode: 'generate',
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { message: '교육과정·참고서 기준표를 정리하는 중…', pct: 8 },
    input: { title, grade, unitIds, customTopic: customTopic || undefined },
    deck: null,
    htmlPreview: null,
    pptxBuffer: null,
    error: null,
    warnings: []
  };
  jobs.set(id, job);

  setImmediate(() => {
    (async () => {
      const parsed = await generateThenReview({
        title,
        units,
        grade,
        customTopic,
        onProgress: (p) => touch(job, { progress: p })
      });
      if (parsed && parsed.__reviseError) {
        job.warnings.push('검수 수정 실패 — 초안을 사용합니다: ' + parsed.__reviseError);
        delete parsed.__reviseError;
      }
      if (parsed && parsed.__audit) {
        const audit = parsed.__audit;
        if (audit.mustCover) job.warnings.push('기준표 필수 항목 ' + audit.mustCover + '개');
        const rounds = audit.rounds || [];
        if (rounds.length > 1) job.warnings.push('검수 탈락 후 수정·재검수');
        if (audit.auditError) job.warnings.push('모델 검수 실패 — 중복 예문 검사만 적용: ' + audit.auditError);
        (audit.remaining || []).slice(0, 6).forEach((issue) => {
          const where = issue.slide ? (issue.slide + '번 ') : '';
          job.warnings.push('검수 남음(' + issue.kind + '): ' + where + issue.detail);
        });
        delete parsed.__audit;
      }
      touch(job, { progress: { message: '칠판 슬라이드 조립 중…', pct: 88 } });
      const deck = coerceDeck(parsed, title, grade);
      const htmlPreview = renderDeckHtml(deck);
      const scriptHtml = renderDeckScriptHtml(deck);
      touch(job, {
        status: 'done',
        deck,
        htmlPreview,
        scriptHtml,
        pptxBuffer: null,
        progress: { message: '완료', pct: 100 }
      });
      // HTML 캡처 PPT는 무거우니 완료 후 백그라운드 프리웜 (실패해도 다운로드 시 재시도)
      setImmediate(() => {
        renderDeckPptx(deck).then((buf) => {
          const cur = jobs.get(id);
          if (cur === job) touch(job, { pptxBuffer: buf });
        }).catch((e) => console.warn('grammar lecture pptx prewarm', id, e && e.message));
      });
    })().catch((e) => {
      touch(job, { status: 'error', error: e.message || '생성 실패', progress: { message: e.message, pct: 100 } });
      console.error('grammar lecture job', id, e);
    });
  });

  return publicJob(job);
}

const SYSTEM_PATCH = `당신은 중등 영어 인강 슬라이드 편집자입니다.
기존 덱 JSON에서 사용자가 말한 부분만 고칩니다. 전체 재작성 금지.
출력은 JSON만.

[규칙]
- 사용자가 지칭한 슬라이드(번호·제목·내용)만 변경.
- 언급 없는 슬라이드는 손대지 말 것.
- 예시 중복 금지: 같은 영어 예문을 한 슬라이드나 바로 옆 슬라이드에 두 번 넣지 말 것. 퀴즈 정답은 notes만.
- 톤 분리 유지: 화면(heading/lines/quiz)=점잖은 판서, script만 일타강사.
- 슬라이드를 고치면 script(강의 대사)도 그 장면에 맞게 함께 고칠 것.
- quiz.prompt: 한국어 발문과 영어 문장은 \\n으로 분리.
- 번호는 1부터 (화면에 보이는 N / 총장수).
- op: replace | insertAfter | delete
- replace/insertAfter의 slide는 기존 스키마(+ script, notes).

` + ACCURACY_LAW;

function buildPatchPrompt({ deck, instruction, slideIndexes }) {
  const indexes = Array.isArray(slideIndexes)
    ? slideIndexes.map((n) => Number(n)).filter((n) => n >= 1)
    : [];
  return [
    '아래 인강 덱을 부분 수정하라. 전체 재생성 금지.',
    '사용자 지시:',
    String(instruction || '').trim(),
    indexes.length ? ('명시적 대상 슬라이드 번호(1-based): ' + indexes.join(', ')) : '대상 번호가 지시문에 있으면 따르고, 없으면 지시에서 추론.',
    '',
    '현재 덱 JSON:',
    JSON.stringify({
      title: deck.title,
      grade: deck.grade,
      slides: deck.slides
    }, null, 2),
    '',
    '출력 JSON 스키마:',
    JSON.stringify({
      summary: '무엇을 바꿨는지 한 줄',
      ops: [
        { op: 'replace', index: 5, slide: { kind: 'content', blockType: 'FORMS', heading: '…', lines: [], notes: '' } },
        { op: 'insertAfter', index: 5, slide: { kind: 'content', blockType: 'ONE_LINER', heading: '…', lines: [], notes: '' } },
        { op: 'delete', index: 8 }
      ]
    }, null, 2),
    '',
    'ops는 1개 이상. 불필요하면 빈 배열 금지 — 최소 한 장은 고쳐야 함.',
    'replace의 index는 수정 전 덱 기준. 여러 op면 원래 번호 기준으로 적고, 서버가 안전하게 적용한다.'
  ].join('\n');
}

function applyDeckOps(deck, ops) {
  const slides = (deck.slides || []).map((s) => Object.assign({}, s));
  const list = Array.isArray(ops) ? ops : [];
  if (!list.length) {
    const err = new Error('수정할 내용이 없습니다. 지시를 더 구체적으로 적어 주세요.');
    err.statusCode = 400;
    throw err;
  }

  // Prefer replace-first (most teacher edits). Then delete high→low, then insertAfter high→low.
  const deletes = list.filter((o) => o && o.op === 'delete').map((o) => Number(o.index)).filter((n) => n >= 1);
  const replaces = list.filter((o) => o && o.op === 'replace' && o.slide);
  const inserts = list.filter((o) => o && o.op === 'insertAfter' && o.slide);

  replaces.forEach((o) => {
    const idx = Number(o.index);
    if (idx < 1 || idx > slides.length) return;
    slides[idx - 1] = coerceSlide(o.slide, idx - 1);
  });

  deletes.sort((a, b) => b - a).forEach((idx) => {
    if (idx >= 1 && idx <= slides.length) slides.splice(idx - 1, 1);
  });

  inserts
    .slice()
    .sort((a, b) => Number(b.index) - Number(a.index))
    .forEach((o) => {
      let idx = Number(o.index);
      if (!Number.isFinite(idx) || idx < 0) idx = slides.length;
      if (idx > slides.length) idx = slides.length;
      // insertAfter N (1-based) → splice at N (0-based)
      slides.splice(idx, 0, coerceSlide(o.slide, idx));
    });

  if (slides.length < 3) {
    const err = new Error('수정 결과 슬라이드가 너무 적어졌습니다. 지시를 바꿔 다시 시도해 주세요.');
    err.statusCode = 400;
    throw err;
  }
  if (slides.length > 28) slides.length = 28;
  slides.forEach((s, i) => { s.index = i + 1; });
  return {
    title: deck.title,
    grade: deck.grade,
    slides
  };
}

function startPatchJob(jobId, opts, ownerKey) {
  pruneJobs();
  const job = getJob(jobId, ownerKey);
  if (!job || !job.deck || !job.deck.slides || !job.deck.slides.length) {
    const err = new Error('수정할 인강 덱이 없습니다. 먼저 슬라이드를 만들어 주세요.');
    err.statusCode = 404;
    throw err;
  }
  if (job.status === 'running') {
    const err = new Error('이미 작업 중입니다. 잠시 후 다시 시도해 주세요.');
    err.statusCode = 409;
    throw err;
  }
  const instruction = String((opts && opts.instruction) || '').trim();
  if (instruction.length < 2) {
    const err = new Error('어떻게 고칠지 자연어로 적어 주세요. 예: 「5번 예시만 little→less로 바꿔줘」');
    err.statusCode = 400;
    throw err;
  }
  if (instruction.length > 1000) {
    const err = new Error('수정 지시는 1000자 이내로 적어 주세요.');
    err.statusCode = 400;
    throw err;
  }
  const slideIndexes = Array.isArray(opts && opts.slideIndexes) ? opts.slideIndexes : [];

  touch(job, {
    status: 'running',
    mode: 'patch',
    error: null,
    progress: { message: '지정한 슬라이드만 수정 중…', pct: 20 }
  });

  const deckSnapshot = {
    title: job.deck.title,
    grade: job.deck.grade,
    slides: job.deck.slides.map((s) => Object.assign({}, s))
  };

  setImmediate(() => {
    (async () => {
      const parsed = await askClaudeJson(
        SYSTEM_PATCH,
        buildPatchPrompt({ deck: deckSnapshot, instruction, slideIndexes }),
        { temperature: 0.25, maxOutputTokens: 12000 }
      );
      touch(job, { progress: { message: '수정 내용 적용·조립 중…', pct: 70 } });
      const nextDeck = applyDeckOps(deckSnapshot, parsed && parsed.ops);
      const htmlPreview = renderDeckHtml(nextDeck);
      const scriptHtml = renderDeckScriptHtml(nextDeck);
      const summary = String((parsed && parsed.summary) || '').trim();
      touch(job, {
        status: 'done',
        deck: nextDeck,
        htmlPreview,
        scriptHtml,
        pptxBuffer: null,
        progress: { message: summary ? ('수정 완료 — ' + summary) : '수정 완료', pct: 100 }
      });
      setImmediate(() => {
        renderDeckPptx(nextDeck).then((buf) => {
          const cur = jobs.get(id);
          if (cur === job) touch(job, { pptxBuffer: buf });
        }).catch((e) => console.warn('grammar lecture pptx prewarm', id, e && e.message));
      });
      if (summary) job.warnings = (job.warnings || []).concat(['patch: ' + summary]).slice(-8);
    })().catch((e) => {
      // Restore previous deck on failure
      touch(job, {
        status: 'done',
        deck: deckSnapshot,
        htmlPreview: job.htmlPreview || renderDeckHtml(deckSnapshot),
        error: undefined,
        progress: { message: '수정 실패 — 이전 덱 유지: ' + (e.message || 'error'), pct: 100 }
      });
      job.warnings = (job.warnings || []).concat(['patch failed: ' + (e.message || 'error')]).slice(-8);
      console.error('grammar lecture patch', job.id, e);
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
.quiz .q { font-size: 2vw; font-weight: 900; margin-bottom: 0.8vw; white-space: pre-wrap; word-break: keep-all; line-height: 1.35; }
.quiz .c { font-size: 1.7vw; font-weight: 700; margin: 0.35vw 0; }
.pagenum { position: absolute; left: 4%; bottom: 3%; font-size: 1.1vw; color: rgba(247,241,222,0.7); }
.nav-hit {
  position: absolute; top: 0; bottom: 0; width: 22%; z-index: 2; cursor: pointer;
  background: transparent; border: 0; padding: 0;
}
.nav-hit.prev { left: 0; }
.nav-hit.next { right: 0; }
.script-panel {
  position: fixed; left: 0; right: 0; bottom: 56px; max-height: 28vh; overflow: auto;
  background: rgba(15, 23, 42, 0.94); color: #f4f6fb; padding: 10px 16px 12px;
  font-size: 13px; line-height: 1.55; z-index: 40; display: none;
  border-top: 1px solid rgba(255,255,255,0.12);
  pointer-events: auto;
}
.script-panel.open { display: block; }
.script-panel h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #FFE08A; }
.script-panel p { margin: 0; white-space: pre-wrap; word-break: keep-all; }
.hud {
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.72);
  color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 13px; z-index: 50;
  pointer-events: auto; box-shadow: 0 4px 18px rgba(0,0,0,0.35);
}
.hud button {
  background: rgba(255,255,255,0.18); border: 0; color: #fff; border-radius: 999px;
  min-width: 36px; height: 36px; padding: 0 10px; cursor: pointer; font-size: 16px; line-height: 1;
}
.hud button:hover { background: rgba(255,255,255,0.28); }
.hud #c { min-width: 4.5em; text-align: center; font-variant-numeric: tabular-nums; }
@media print {
  .hud, .script-panel, .nav-hit { display: none !important; }
  .stage { width: 338.67mm; height: 190.5mm; max-width: none; max-height: none; }
  .slide { display: block !important; position: relative; width: 338.67mm; height: 190.5mm; page-break-after: always; }
}
/* Puppeteer screenshot → PPTX: match HTML chalkboard 1:1 */
body.capture-mode {
  margin: 0; background: #2F6B4F; overflow: hidden;
}
body.capture-mode .hud,
body.capture-mode .script-panel,
body.capture-mode .nav-hit { display: none !important; }
body.capture-mode .stage {
  width: 1600px !important;
  height: 900px !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
}
`;
}

/** Safe to embed inside <script> — prevents </script> in lecture text from killing nav JS. */
function jsonForScriptTag(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderSlideBody(slide) {
  const lines = Array.isArray(slide.lines) ? slide.lines : [];
  if (slide.kind === 'title') {
    return '<div class="badge">GRAMMAR LECTURE</div>'
      + '<h1>' + escapeHtml(slide.heading) + '</h1>'
      + (lines.length
        ? '<ul class="lines">' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>'
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
  if (slide.blockType === 'FORMULA' && lines.length === 1) {
    html += '<div class="formula">' + escapeHtml(lines[0]) + '</div>';
  } else if (slide.blockType === 'FORMULA' && lines.length > 1) {
    html += '<ul class="lines">' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
  } else if (lines.length) {
    html += '<ul class="lines">' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
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
  if ((slide.blockType === 'CONCEPT_CHECK' || slide.blockType === 'QUIZ' || slide.quiz)
    && slide.quiz && slide.quiz.prompt) {
    html += '<div class="quiz"><div class="q">'
      + escapeHtml(slide.quiz.prompt).replace(/\n/g, '<br>')
      + '</div>'
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

  const scriptsJson = jsonForScriptTag(deck.slides.map((s) => ({
    heading: s.heading || '',
    block: s.blockType ? (BLOCK_LABEL[s.blockType] || s.blockType) : (s.kind || ''),
    script: s.script || '',
    notes: s.notes || ''
  })));

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)} — 문법 인강</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;900&display=swap" rel="stylesheet">
<style>${chalkBoardCss()}</style></head>
<body>
<div class="stage" id="stage">
${slides}
<button type="button" class="nav-hit prev" id="hitPrev" aria-label="이전 슬라이드"></button>
<button type="button" class="nav-hit next" id="hitNext" aria-label="다음 슬라이드"></button>
</div>
<div class="script-panel" id="scriptPanel">
  <h3 id="scriptLabel">강의 대본</h3>
  <p id="scriptBody"></p>
</div>
<div class="hud" id="hud">
  <button type="button" id="prev" title="이전 (←)">‹</button>
  <span id="c">1 / ${deck.slides.length}</span>
  <button type="button" id="next" title="다음 (→)">›</button>
  <button type="button" id="togScript" title="대본 (S)" style="width:auto;font-size:12px">대본</button>
  <button type="button" id="fs" title="전체화면 (F)" style="width:auto;font-size:12px">전체화면</button>
</div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var i=0;
  var scripts = ${scriptsJson};
  var panel=document.getElementById('scriptPanel');
  var body=document.getElementById('scriptBody');
  var label=document.getElementById('scriptLabel');
  var counter=document.getElementById('c');
  function fillScript(){
    if (!label || !body) return;
    var s=scripts[i]||{};
    label.textContent = '강의 대본 · ' + (i+1) + ' · ' + (s.block||'') + (s.heading?(' — '+s.heading):'');
    var text = s.script || '(이 슬라이드 대본이 없습니다)';
    if (s.notes) text += '\\n\\n—— 정답·메모 ——\\n' + s.notes;
    body.textContent = text;
  }
  function show(n){
    if (!slides.length) return;
    i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){ s.classList.toggle('active', k===i); });
    if (counter) counter.textContent=(i+1)+' / '+slides.length;
    try { fillScript(); } catch (err) {}
  }
  function go(delta, ev){
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    show(i+delta);
  }
  function bind(id, delta){
    var el=document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function(ev){ go(delta, ev); });
  }
  bind('prev', -1); bind('hitPrev', -1);
  bind('next', 1); bind('hitNext', 1);
  var tog=document.getElementById('togScript');
  if (tog) tog.addEventListener('click', function(ev){
    ev.preventDefault(); ev.stopPropagation();
    if (panel) panel.classList.toggle('open');
  });
  var fsBtn=document.getElementById('fs');
  if (fsBtn) fsBtn.addEventListener('click', function(ev){
    ev.preventDefault(); ev.stopPropagation();
    var el=document.documentElement;
    if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
    else if (document.exitFullscreen) document.exitFullscreen();
  });
  document.addEventListener('keydown', function(e){
    if (e.key==='ArrowRight' || e.key===' ') { e.preventDefault(); show(i+1); }
    else if (e.key==='ArrowLeft') { e.preventDefault(); show(i-1); }
    else if (e.key==='f' || e.key==='F') { if (fsBtn) fsBtn.click(); }
    else if (e.key==='s' || e.key==='S') { if (tog) tog.click(); }
  });
  show(0);
})();
</script>
</body></html>`;
}

function renderDeckScriptHtml(deck) {
  const rows = (deck.slides || []).map((s, i) => {
    const badge = s.blockType ? (BLOCK_LABEL[s.blockType] || s.blockType) : (s.kind || '');
    return '<article class="card">'
      + '<header><span class="num">' + (i + 1) + '</span>'
      + (badge ? '<span class="badge">' + escapeHtml(badge) + '</span>' : '')
      + '<h2>' + escapeHtml(s.heading || ('슬라이드 ' + (i + 1))) + '</h2></header>'
      + '<pre class="script">' + escapeHtml(s.script || '(대본 없음)') + '</pre>'
      + (s.notes ? ('<div class="notes"><strong>정답·메모</strong><pre>' + escapeHtml(s.notes) + '</pre></div>') : '')
      + '</article>';
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)} — 강의 대본</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&display=swap" rel="stylesheet">
<style>
body{margin:0;font-family:"Noto Sans KR",sans-serif;background:#f3f6f4;color:#1a1f2e}
.wrap{max-width:820px;margin:0 auto;padding:1.5rem 1.1rem 3rem}
h1{font-size:1.45rem;margin:0 0 .35rem}
.sub{color:#5c6578;margin:0 0 1.25rem;font-size:.9rem}
.card{background:#fff;border:1px solid #d8e0d9;border-radius:14px;padding:1rem 1.1rem;margin:0 0 .85rem;box-shadow:0 6px 18px rgba(26,31,46,.05)}
header{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-bottom:.55rem}
.num{display:inline-flex;align-items:center;justify-content:center;width:1.6rem;height:1.6rem;border-radius:999px;background:#2F6B4F;color:#fff;font-size:.75rem;font-weight:800}
.badge{font-size:.7rem;font-weight:800;padding:.15rem .5rem;border-radius:999px;background:#e7f3ea;color:#2F6B4F}
h2{margin:0;font-size:1.05rem;flex:1 1 12rem}
.script,.notes pre{white-space:pre-wrap;word-break:keep-all;font-family:inherit;font-size:.92rem;line-height:1.65;margin:0}
.notes{margin-top:.7rem;padding-top:.65rem;border-top:1px dashed #d8e0d9;color:#3d4a3f;font-size:.86rem}
@media print{body{background:#fff}.card{box-shadow:none;break-inside:avoid}}
</style></head>
<body><div class="wrap">
<h1>${escapeHtml(deck.title)} — 전체 강의 대본</h1>
<p class="sub">슬라이드마다 말할 대사입니다. 인강 녹화·리허설용 · ${(deck.slides || []).length}장</p>
${rows}
</div></body></html>`;
}

async function renderDeckPdf(deck) {
  let chromium;
  let puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    const err = new Error('PDF 엔진이 없습니다. HTML을 연 뒤 브라우저 인쇄 → PDF로 저장하세요.');
    err.statusCode = 503;
    throw err;
  }
  const html = renderDeckHtml(deck);
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1600, height: 900 },
    executablePath,
    headless: chromium.headless
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
    const pdf = await page.pdf({
      width: '338.67mm',
      height: '190.5mm',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

const CAPTURE_W = 1600;
const CAPTURE_H = 900;

async function launchChromiumBrowser() {
  let chromium;
  let puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    const err = new Error('캡처 엔진이 없습니다. HTML을 사용하거나 서버에 Chromium을 설치하세요.');
    err.statusCode = 503;
    throw err;
  }
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: CAPTURE_W, height: CAPTURE_H },
    executablePath,
    headless: chromium.headless
  });
}

/**
 * Screenshot each HTML chalkboard slide (same pixels teachers see in the browser).
 * Used to build a WYSIWYG PPTX / Google Slides import.
 */
async function captureDeckSlidePngs(deck) {
  const html = renderDeckHtml(deck);
  const browser = await launchChromiumBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: CAPTURE_W, height: CAPTURE_H, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
    await page.evaluate(async () => {
      document.body.classList.add('capture-mode');
      var panel = document.getElementById('scriptPanel');
      if (panel) panel.classList.remove('open');
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
    });
    // Give webfonts a beat after fonts.ready
    await new Promise((r) => setTimeout(r, 120));
    const count = await page.$$eval('.slide', (els) => els.length);
    if (!count) {
      const err = new Error('캡처할 슬라이드가 없습니다.');
      err.statusCode = 500;
      throw err;
    }
    const pngs = [];
    for (let i = 0; i < count; i++) {
      await page.evaluate((idx) => {
        var slides = [].slice.call(document.querySelectorAll('.slide'));
        slides.forEach(function (s, k) { s.classList.toggle('active', k === idx); });
      }, i);
      await new Promise((r) => setTimeout(r, 40));
      const el = await page.$('.stage');
      if (!el) {
        const err = new Error('슬라이드 스테이지를 찾지 못했습니다.');
        err.statusCode = 500;
        throw err;
      }
      const buf = await el.screenshot({ type: 'png', omitBackground: false });
      pngs.push(Buffer.from(buf));
    }
    return pngs;
  } finally {
    await browser.close().catch(() => {});
  }
}

function boardBgDataUri() {
  // Solid chalkboard green + dashed teacher zone — shape-fallback PPTX background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
<rect width="1600" height="900" fill="#2F6B4F"/>
<line x1="1200" y1="0" x2="1200" y2="900" stroke="rgba(255,255,255,0.18)" stroke-width="2" stroke-dasharray="10 10"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function slideSpeakerNotes(s) {
  const notes = [];
  if (s.blockType) notes.push('블록: ' + (BLOCK_LABEL[s.blockType] || s.blockType));
  if (s.script) notes.push('【강의 대본】\n' + s.script);
  if (s.notes) notes.push('【정답·메모】\n' + s.notes);
  return notes.join('\n\n');
}

/** Preferred: full-bleed PNG of HTML slide (imports cleanly into Google Slides). */
async function renderDeckPptxFromCaptures(deck) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE16x9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE16x9';
  pptx.author = 'Salt Morning Grammar Lecture';
  pptx.title = deck.title;

  const pngs = await captureDeckSlidePngs(deck);
  pngs.forEach((png, i) => {
    const s = (deck.slides && deck.slides[i]) || {};
    const slide = pptx.addSlide();
    slide.addImage({
      data: 'data:image/png;base64,' + png.toString('base64'),
      x: 0,
      y: 0,
      w: '100%',
      h: '100%'
    });
    const notes = slideSpeakerNotes(s);
    if (notes) slide.addNotes(notes);
  });

  const buf = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buf);
}

/** Fallback when Chromium is unavailable — approximate shapes (may look off). */
async function renderDeckPptxShapes(deck) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE16x9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE16x9';
  pptx.author = 'Salt Morning Grammar Lecture';
  pptx.title = deck.title;

  const bg = boardBgDataUri();
  const CX = 0.45;
  const CW = 9.4;

  deck.slides.forEach((s) => {
    const slide = pptx.addSlide();
    slide.addImage({ data: bg, x: 0, y: 0, w: '100%', h: '100%' });

    const notes = slideSpeakerNotes(s);
    if (notes) slide.addNotes(notes);

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
      const promptLines = String(s.quiz.prompt).split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const qLines = promptLines.map((l) => ({ text: l, options: { breakLine: true } }))
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

async function renderDeckPptx(deck) {
  try {
    return await renderDeckPptxFromCaptures(deck);
  } catch (e) {
    console.warn('grammar lecture pptx capture failed → shape fallback:', e && e.message);
    return renderDeckPptxShapes(deck);
  }
}

function safeFilename(title) {
  return String(title || 'grammar-lecture').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'grammar-lecture';
}

module.exports = {
  renderDeckScriptHtml,

  MAX_UNITS,
  BLOCK_TYPES,
  BLOCK_LABEL,
  DEFAULT_LECTURE_CLAUDE_MODEL,
  claudeModel,
  lectureClaudeModels,
  startGenerateJob,
  startPatchJob,
  getJob,
  publicJob,
  renderDeckHtml,
  renderDeckPptx,
  renderDeckPptxFromCaptures,
  captureDeckSlidePngs,
  renderDeckPdf,
  safeFilename,
  deckFromClient,
  findStructureIssues,
  jobNotFoundError,
  rememberPptx: function rememberPptx(job, buf) {
    if (!job) return;
    job.pptxBuffer = buf;
    job.updatedAt = Date.now();
    schedulePersist(job, true);
  },
  isClaudeConfigured
};
