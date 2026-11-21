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
 * - Every slide has a full speaking script (일타강사 톤)
 * - Quiz answers live in notes; speaking script in script (both go to PPT notes)
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
  'CLOSER'          // 핵심 요약·파이팅 마무리
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
  FUN: '어원·잡지식',
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

const SYSTEM_SCRIPT = `당신은 한국 중학생을 대상으로 한 영어 문법 **일타강사**입니다.
전자칠판용 인강 슬라이드와, 각 슬라이드에서 실제로 말할 **전체 강의 대본(script)** 을 JSON으로만 만듭니다.
화면(lines 등)은 굵고 짧게, 입은 script에 풀어 말합니다.

[콘텐츠 블록]
HOOK 도입 / FORMULA 핵심 규칙 / ONE_LINER 한줄 예문 / USAGE 용법 구분 /
PAIR 짝꿍 / FORMS 형태·예시 표 / TRAP 비문↔정문 / BAN 예외·금지 /
TRANSFORM 전환 / FUN 어원·문화 잡지식 / CONCEPT_CHECK 개념확인 /
QUIZ 내신퀴즈 / CLOSER 마무리

[강의 구조 — 덱 전체]
1) title: 오프닝 (오늘 배울 것·기대감)
2) HOOK → FORMULA(규칙 완전 파헤치기) → FORMS/ONE_LINER(풍부한 예 + 암기 꿀팁)
3) TRAP/BAN으로 자주 틀리는 포인트
4) FUN 1~2장: 어원·영어사·문화 꿀잼 잡지식 (1~2분 분량 대본)
5) CONCEPT_CHECK + QUIZ
6) CLOSER: 핵심 요약 + 파이팅 넘치는 당부 (약 1분 분량 대본)
유닛 2개면 중간에 section. 유닛당 대략 8~14장, 전체 최대 28장.

[Pattern B · 품질]
- 규칙 먼저, 예는 다음. FORMULA 뒤에 FORMS.
- ★ 예시 중복 금지: 앞 장에 쓴 영어 쌍·문장을 다음 장에서 복붙하지 말 것.
- 퀴즈 정답·해설은 notes에만. 화면에는 문제·보기만.
- 한 슬라이드 = 블록 1개. lines 최대 6. 한국어 규칙 + 영어 예.

[script — 모든 슬라이드 필수]
각 슬라이드에 script 필드로 **그 장면에서 강사가 읽을 전체 대사**를 씁니다.
- 어린 중학생도 바로 이해하게: 쉬운 비유·질문→답 형식·구어체.
- 문법 요소 이름·뜻·(가능하면) 어원을 꼼꼼히.
- 톤: 파이팅·친근·유쾌. '자, 주목!', '이거 진짜 중요해요!', '별표 세 개 칩니다!' 적극 사용.
- 규칙을 암기 나열이 아니라 "왜 그렇게 쓰는지" 이해시키기.
- FORMULA script: 개념 풀이 + 비유 + (관련 있으면) 짧은 어원.
- FORMS/ONE_LINER script: 예 설명 + 실수 포인트 + 암기 꿀팁/공식.
- FUN script: 1~2분 분량 스토리텔링.
- CLOSER script: 핵심 요약 + 당부·파이팅 (약 1분).
- CONCEPT_CHECK/QUIZ script: 문제를 같이 풀어 주는 진행 멘트(정답은 notes에).
- 분량: title/section 3~6문장, 일반 콘텐츠 8~18문장, FUN/CLOSER은 그에 맞게.
- script는 화면 글자를 그대로 읽지 말고, 판서를 가리키며 풀어 말하는 구어체로.

출력은 JSON만.`;

const SLIDE_SCHEMA_HINT = {
  title: '강의 제목',
  grade: 'M2',
  slides: [{
    kind: 'title|section|content',
    unitId: 'optional unit id for content/section',
    blockType: 'HOOK|FORMULA|ONE_LINER|USAGE|PAIR|FORMS|TRAP|BAN|TRANSFORM|FUN|CONCEPT_CHECK|QUIZ|CLOSER|null for title/section',
    heading: '슬라이드 큰 제목 (짧게)',
    lines: ['화면에 보이는 줄들 — 최대 6줄. FORMULA면 규칙 문장.'],
    columns: [['왼쪽 헤더+항목'], ['오른쪽 헤더+항목']],
    examples: [{ en: '...', ko: '...' }],
    wrongRight: [{ wrong: '...', right: '...' }],
    quiz: {
      prompt: '문제 (CONCEPT_CHECK 또는 QUIZ)',
      choices: ['① …', '② …']
    },
    script: '이 슬라이드에서 강사가 말할 전체 대본 (일타강사 구어체, 필수)',
    notes: 'CONCEPT_CHECK/QUIZ면 정답·해설만. 그 외는 비워도 됨.'
  }]
};

function buildGeneratePrompt({ title, units, grade, customTopic }) {
  const specs = (units || []).map((u) => ({
    unitId: u.unitId,
    grade: u.grade,
    category: u.category,
    subCategory: u.subCategory,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
  const custom = String(customTopic || '').trim();
  const parts = [
    '다음 문법/주제로 인강 슬라이드 대본을 작성하라. Pattern B(규칙→예) + 개념확인 + 내신퀴즈.',
    'title: ' + title,
    'schoolGrade: ' + grade
  ];
  if (custom) {
    parts.push(
      'customTopic (카탈로그에 없는 직접 주제 — 이 주제를 중심으로 강의하라):',
      custom,
      '',
      '직접 주제 가이드:',
      '- 중등 영어 수업에서 통하는 표준 개요·정의·구분·대표 예를 빠짐없이.',
      '- 개요형(예: 8품사)이면 큰 지도(목록·한줄 정의) → 각 항목 핵심 → 비교/함정 → 개념확인·퀴즈 흐름.',
      '- 한 장에 모든 품사를 우겨 넣지 말고 section/FORMULA/FORMS로 나누되 전체 최대 28장.'
    );
  }
  if (specs.length) {
    parts.push('catalog units (최대 2개' + (custom ? ' — 보조 힌트' : '') + '):', JSON.stringify(specs, null, 2));
  } else {
    parts.push('catalog units: (없음 — customTopic만 사용)');
  }
  parts.push(
    '',
    '필수 커버리지:',
    specs.length
      ? '- catalog의 coreRules·errorTraps는 반드시 화면에 반영.'
      : '- customTopic에 대해 교과서·참고서가 공통으로 다루는 정의·분류·예·예외를 빠뜨리지 말 것.',
    '- 한국 중등 교과서·참고서가 이 주제에서 공통으로 가르치는 규칙·형태·예외·짝꿍 표현이 있으면 누락하지 말 것.',
    '  (예: 비교급 → 단기 -er / CVC 자음 중복+-er / y→ier / 3음절+ more / than / 이중비교 금지 등)',
    '- FORMULA에 규칙, FORMS에 대응 예시. 규칙 없는 예시 표만 두지 말 것.',
    '- 주제(또는 유닛)마다 CONCEPT_CHECK ≥1, QUIZ(내신) ≥1.',
    '- 예시 중복 금지: FORMULA lines에 이미 나온 영어 쌍을 바로 뒤 FORMS에 다시 나열하지 말 것.',
    '',
    'JSON 스키마:',
    JSON.stringify(SLIDE_SCHEMA_HINT, null, 2),
    '',
    'columns / examples / wrongRight / quiz 는 해당 블록에만 채우고 나머지는 생략 가능.',
    'TRAP은 wrongRight 필수. USAGE·FORMS는 columns 2열 권장.',
    'CONCEPT_CHECK·QUIZ는 quiz+notes 필수. CONCEPT_CHECK는 보기 2~3개 또는 O/X로 단순하게.',
    '모든 슬라이드에 script(전체 강의 대사) 필수. FUN ≥1, CLOSER ≥1.',
    'script에 문법 용어의 쉬운 뜻·필요 시 어원, 암기 꿀팁, 질문→답 멘트를 넣을 것.'
  );
  return parts.join('\n');
}

const SYSTEM_REVIEW = `당신은 중등 영어 문법 교재·인강 감수자입니다.
인강 슬라이드 JSON을 검수하고, 누락된 공통 규칙·개념확인·내신퀴즈·FUN·CLOSER·script를 보완한 최종 JSON만 출력합니다.
Pattern B: FORMULA(규칙) 다음에 FORMS(예시). 예만 있는 표는 규칙 장을 앞에 추가하세요.
인접 슬라이드에 같은 영어 예시(단어 쌍·문장)가 반복되면 FORMS/examples를 새 예시로 교체하세요.
모든 슬라이드에 일타강사 톤의 script(전체 대사)가 있어야 합니다. 짧거나 없으면 보강하세요.
정답은 notes에만. 화면은 굵고 짧게. JSON만.`;

function buildReviewPrompt({ title, units, grade, draft, customTopic }) {
  const specs = (units || []).map((u) => ({
    unitId: u.unitId,
    subCategory: u.subCategory,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
  const custom = String(customTopic || '').trim();
  return [
    '아래 초안 슬라이드를 상업용 퀄리티로 검수·보완하라.',
    'title: ' + title,
    'grade: ' + grade,
    custom ? ('customTopic: ' + custom) : '',
    'units:',
    JSON.stringify(specs, null, 2),
    '',
    '체크리스트 (미달이면 slides를 고쳐 최종본을 다시 작성):',
    '1) 주제/문법의 교과서·참고서 공통 규칙·정의가 FORMULA lines에 명시되어 있는가?',
    '2) 형태/규칙이 있으면 FORMULA 바로 뒤에 FORMS(또는 예)가 있는가? 예만 단독으로 있지 않은가?',
    '3) CONCEPT_CHECK ≥1, QUIZ ≥1, FUN ≥1, CLOSER ≥1, 정답은 notes만인가?',
    '4) catalog가 있으면 coreRules·errorTraps 반영. customTopic이면 표준 개요·분류 누락 없는가?',
    '5) 불필요하게 장황하면 나누거나 줄이되, 공통 규칙은 삭제하지 말 것.',
    '6) ★ 예시 중복: FORMULA에 이미 나온 영어 쌍·문장이 FORMS에 다시 나오면 새 예시로 교체.',
    '7) 모든 슬라이드에 script가 있고, 일타강사 구어체·쉬운 비유·(가능하면) 어원/꿀팁이 들어 있는가?',
    '',
    '초안 JSON:',
    JSON.stringify(draft, null, 2),
    '',
    '출력: 최종 { title, grade, slides[] } JSON만. 스키마는 초안과 동일.'
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
  // CONCEPT_CHECK / QUIZ without quiz payload → keep as content with lines only if present
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
  // Legacy: some drafts put the whole lecture into notes — keep as script if no script.
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

async function generateThenReview({ title, units, grade, customTopic, onProgress }) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};
  const firstPrompt = buildGeneratePrompt({ title, units, grade, customTopic });
  report({ message: 'Claude가 인강 대본을 쓰는 중…', pct: 20 });
  const draft = await askClaudeJson(SYSTEM_SCRIPT, firstPrompt, {
    temperature: 0.45,
    maxOutputTokens: 16000
  });
  let finalDoc = draft;
  report({ message: '교과서 공통 규칙·대본 검수·보완 중…', pct: 55 });
  try {
    finalDoc = await askClaudeJson(
      SYSTEM_REVIEW,
      buildReviewPrompt({ title, units: units || [], grade, draft, customTopic }),
      { temperature: 0.25, maxOutputTokens: 16000 }
    );
  } catch (e) {
    // Review failure → keep draft (still usable); caller may record warning
    finalDoc = draft;
    finalDoc.__reviewError = e.message || 'review failed';
  }
  return finalDoc;
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
    progress: { message: 'Claude가 인강 대본을 쓰는 중…', pct: 10 },
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
      if (parsed && parsed.__reviewError) {
        job.warnings.push('검수 패스 실패 — 초안을 사용합니다: ' + parsed.__reviewError);
        delete parsed.__reviewError;
      }
      touch(job, { progress: { message: '칠판 슬라이드 조립 중…', pct: 78 } });
      const deck = coerceDeck(parsed, title, grade);
      const htmlPreview = renderDeckHtml(deck);
      const scriptHtml = renderDeckScriptHtml(deck);
      const pptxBuffer = await renderDeckPptx(deck);
      touch(job, {
        status: 'done',
        deck,
        htmlPreview,
        scriptHtml,
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

const SYSTEM_PATCH = `당신은 중등 영어 인강 슬라이드 편집자입니다.
기존 덱 JSON에서 사용자가 말한 부분만 고칩니다. 전체 재작성 금지.
출력은 JSON만.

[규칙]
- 사용자가 지칭한 슬라이드(번호·제목·내용)만 변경.
- 언급 없는 슬라이드는 손대지 말 것.
- Pattern B·예시 중복 금지·퀴즈 정답은 notes만 — 기존 품질 규칙 유지.
- 슬라이드를 고치면 script(강의 대사)도 그 장면에 맞게 함께 고칠 것.
- 번호는 1부터 (화면에 보이는 N / 총장수).
- op: replace | insertAfter | delete
- replace/insertAfter의 slide는 기존 스키마(+ script, notes).`;

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
      const pptxBuffer = await renderDeckPptx(nextDeck);
      const summary = String((parsed && parsed.summary) || '').trim();
      touch(job, {
        status: 'done',
        deck: nextDeck,
        htmlPreview,
        scriptHtml,
        pptxBuffer,
        progress: { message: summary ? ('수정 완료 — ' + summary) : '수정 완료', pct: 100 }
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
.quiz .q { font-size: 2vw; font-weight: 900; margin-bottom: 0.8vw; }
.quiz .c { font-size: 1.7vw; font-weight: 700; margin: 0.35vw 0; }
.pagenum { position: absolute; left: 4%; bottom: 3%; font-size: 1.1vw; color: rgba(247,241,222,0.7); }
.script-panel {
  position: fixed; left: 0; right: 0; bottom: 52px; max-height: 32vh; overflow: auto;
  background: rgba(15, 23, 42, 0.92); color: #f4f6fb; padding: 10px 16px 12px;
  font-size: 13px; line-height: 1.55; z-index: 4; display: none;
  border-top: 1px solid rgba(255,255,255,0.12);
}
.script-panel.open { display: block; }
.script-panel h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: #FFE08A; }
.script-panel p { margin: 0; white-space: pre-wrap; word-break: keep-all; }
.hud {
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
  display: flex; gap: 8px; align-items: center; background: rgba(0,0,0,0.55);
  color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 13px; z-index: 5;
}
.hud button { background: rgba(255,255,255,0.15); border: 0; color: #fff; border-radius: 999px; width: 32px; height: 32px; cursor: pointer; }
@media print {
  .hud, .script-panel { display: none !important; }
  .stage { width: 338.67mm; height: 190.5mm; max-width: none; max-height: none; }
  .slide { display: block !important; position: relative; width: 338.67mm; height: 190.5mm; page-break-after: always; }
}
`;
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

  const scriptsJson = JSON.stringify(deck.slides.map((s) => ({
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
<div class="stage">${slides}
<div class="script-panel open" id="scriptPanel">
  <h3 id="scriptLabel">강의 대본</h3>
  <p id="scriptBody"></p>
</div>
<div class="hud">
  <button type="button" id="prev" title="이전">‹</button>
  <span id="c">1 / ${deck.slides.length}</span>
  <button type="button" id="next" title="다음">›</button>
  <button type="button" id="togScript" title="대본" style="width:auto;padding:0 10px;font-size:12px">대본</button>
  <button type="button" id="fs" title="전체화면" style="width:auto;padding:0 10px;font-size:12px">전체화면</button>
</div></div>
<script>
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')); var i=0;
  var scripts = ${scriptsJson};
  var panel=document.getElementById('scriptPanel');
  var body=document.getElementById('scriptBody');
  var label=document.getElementById('scriptLabel');
  function fillScript(){
    var s=scripts[i]||{};
    label.textContent = '강의 대본 · ' + (i+1) + ' · ' + (s.block||'') + (s.heading?(' — '+s.heading):'');
    var text = s.script || '(이 슬라이드 대본이 없습니다)';
    if (s.notes) text += '\n\n—— 정답·메모 ——\n' + s.notes;
    body.textContent = text;
  }
  function show(n){ i=Math.max(0,Math.min(slides.length-1,n));
    slides.forEach(function(s,k){s.classList.toggle('active',k===i);});
    document.getElementById('c').textContent=(i+1)+' / '+slides.length;
    fillScript(); }
  document.getElementById('prev').onclick=function(){show(i-1);};
  document.getElementById('next').onclick=function(){show(i+1);};
  var tog=document.getElementById('togScript');
  if(tog) tog.onclick=function(){ panel.classList.toggle('open'); };
  var fsBtn=document.getElementById('fs');
  if(fsBtn) fsBtn.onclick=function(){
    var el=document.documentElement;
    if(!document.fullscreenElement){ if(el.requestFullscreen) el.requestFullscreen(); }
    else if(document.exitFullscreen) document.exitFullscreen();
  };
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' ') { e.preventDefault(); show(i+1); }
    if(e.key==='ArrowLeft') show(i-1);
    if(e.key==='f'||e.key==='F') { if(fsBtn) fsBtn.click(); }
    if(e.key==='s'||e.key==='S') { if(tog) tog.click(); }
  });
  fillScript();
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

function boardBgDataUri() {
  // Solid chalkboard green + dashed teacher zone — used as PPTX slide background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
<rect width="1600" height="900" fill="#2F6B4F"/>
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
    if (s.script) notes.push('【강의 대본】\n' + s.script);
    if (s.notes) notes.push('【정답·메모】\n' + s.notes);
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
  renderDeckPdf,
  safeFilename,
  isClaudeConfigured
};
