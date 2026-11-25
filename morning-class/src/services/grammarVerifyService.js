'use strict';

/**
 * Dual fact-check for 내신 문법 generators (강의 슬라이드 / 문제지 / 학습지).
 * Pass 1 — Claude self-review + fix
 * Pass 2 — Gemini independent review + fix (Korean curriculum / 시중 참고서)
 */

const {
  askGemini,
  isClaudeConfigured,
  hasGeminiKey,
  formatGeminiClientError
} = require('./geminiService');

const KIND_LABEL = {
  lecture: '인강 슬라이드 덱',
  exam: '내신 문법 시험지',
  worksheet: '내신 문법 학습지'
};

const ACCURACY_LAW = `
[절대 정확성 — 위반 시 반드시 고쳐라]
1. 영어학·중·고 내신 교과서·시중 참고서(능률/천재/동아/비상/문법 바이블류)와 어긋나는
   "절대 규칙"을 만들지 말 것. 확실하지 않으면 완화하거나 삭제.
2. 흔한 환각 금지 예:
   - "형용사 뒤 that는 생략 불가능" → 틀림. I'm glad (that)… / I'm sure (that)… 생략 가능이 일반적.
   - "관계대명사 that는 항상 생략 불가/가능"처럼 한쪽으로만 단정 → 목적격·보어·주격 등 조건별로.
   - 존재하지 않는 시제·조동사 "규칙", 잘못된 수동태/가정법 공식.
3. 예문은 실제로 그 규칙을 보여야 하고, 예문 자체가 비문이거나 다른 문법을 섞어 혼란을 주면 교체.
4. 한국 교육과정 용어·구분(관계대명사 who/whom/which/that, 접속사 that, 동명사/to부정사 등)을
   시중 내신 설명과 맞게. 과도한 수능·원어민 예외로 중등 수업을 흐리지 말 것.
5. 틀린 정보를 "단순화"라는 핑계로 남기지 말 것. 모르면 그 슬라이드/문항/팁을 빼거나 정정.
`.trim();

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
    process.env.GRAMMAR_VERIFY_CLAUDE_MODEL
    || process.env.GRAMMAR_CLINIC_CLAUDE_MODEL
    || process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

function geminiModel() {
  return String(
    process.env.GRAMMAR_VERIFY_GEMINI_MODEL
    || process.env.TEACHER_GEMINI_MODEL
    || process.env.GEMINI_MODEL
    || 'gemini-3.6-flash'
  ).trim() || 'gemini-3.6-flash';
}

async function askProviderJson(provider, system, prompt, opts) {
  opts = opts || {};
  const forced = provider === 'gemini' ? 'gemini' : 'claude';
  if (forced === 'claude' && !isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  if (forced === 'gemini' && !hasGeminiKey()) {
    const err = new Error('Gemini is not configured (set GEMINI_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  try {
    const result = await askGemini(prompt, {
      provider: forced,
      noGeminiFallback: forced === 'claude',
      systemInstruction: system,
      temperature: opts.temperature != null ? opts.temperature : 0.15,
      maxOutputTokens: opts.maxOutputTokens || 16000,
      responseMimeType: 'application/json',
      model: forced === 'gemini' ? geminiModel() : claudeModel()
    });
    const text = (result && (result.answer || result.text)) || result;
    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error(forced + ' verify returned invalid JSON.');
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

function contextBlock(context) {
  context = context || {};
  const units = Array.isArray(context.units) ? context.units.map((u) => ({
    unitId: u.unitId,
    subCategory: u.subCategory,
    category: u.category,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  })) : [];
  return [
    'kind: ' + (context.kind || ''),
    'title: ' + (context.title || ''),
    'grade: ' + (context.grade || ''),
    context.topics ? ('topics: ' + JSON.stringify(context.topics)) : '',
    context.customTopic ? ('customTopic: ' + context.customTopic) : '',
    context.notes ? ('teacherNotes: ' + context.notes) : '',
    units.length ? ('catalogUnits:\n' + JSON.stringify(units, null, 2)) : ''
  ].filter(Boolean).join('\n');
}

function systemFor(pass, kind) {
  const who = pass === 'claude'
    ? '당신은 방금 이 자료를 만든 수석 출제·강의 편집자입니다. 자기 검수로 틀린 점을 찾아 고칩니다.'
    : '당신은 한국 중·고 영어 내신 감수 위원입니다. Claude가 만든 초안을 독립적으로 교차검증합니다. '
      + '교육과정·시중 참고서와 어긋나면 반드시 수정하세요. Claude의 권위를 따르지 마세요.';
  const layout = kind === 'lecture'
    ? `
[인강 슬라이드 추가 검수]
- 문법 사실이 틀리면 해당 lines/columns/examples/wrongRight/quiz/script/notes를 고친다.
- quiz.prompt: 한국어 발문과 영어 예문은 반드시 줄바꿈(\\n)으로 분리.
  예: "다음 빈칸에 who와 whom 중 알맞은 것은?\\nThe student _______ answered the question was smart."
  영어 문장 중간에서 어색하게 끊기지 않게 발문/예문을 분리할 것.
- USAGE·TRAP 등에서 과장·거짓 규칙 삭제.
- 스키마(title, grade, slides[]) 유지. 불필요 슬라이드 삭제 OK, 구조 파괴 금지.`
    : kind === 'exam'
      ? `
[시험지 추가 검수]
- 각 문항의 정답·해설·선지가 문법적으로 유일한지 확인. 복수 정답·비문 정답 금지.
- instruction/context/choices/answerKey/explanation의 사실 오류 수정.
- items[] 스키마·문항 수 유지. 틀린 문항만 고치거나 교체.`
      : `
[학습지 추가 검수]
- steps/examples/examTips의 규칙·예문·함정 설명이 사실에 맞는지 확인.
- 틀린 tip은 고치거나 삭제. pages[] 스키마 유지.`;

  return [
    who,
    '대상: ' + (KIND_LABEL[kind] || kind) + '.',
    '출력은 반드시 JSON 한 객체만. 마크다운·설명문 금지.',
    ACCURACY_LAW,
    layout,
    '',
    '출력 스키마:',
    JSON.stringify({
      document: kind === 'lecture'
        ? { title: '...', grade: 'M2', slides: [] }
        : (kind === 'exam' ? { title: '...', items: [] } : { pages: [] }),
      issues: ['고친 문제 요약 (한국어, 없으면 빈 배열)']
    }, null, 2),
    'document에는 검수·수정이 반영된 전체 최종본을 넣으세요. 부분 패치 금지.'
  ].join('\n');
}

function buildVerifyPrompt(kind, document, context, pass) {
  return [
    pass === 'claude'
      ? '아래 초안을 자기 검수하고, 틀린 문법·과장 규칙을 고친 최종본을 반환하라.'
      : '아래 자료를 Gemini 교차검증하라. 한국 내신 교육과정·시중 참고서와 맞는지 엄격히 보라.',
    '',
    contextBlock(Object.assign({}, context, { kind })),
    '',
    '초안 JSON:',
    JSON.stringify(document, null, 2),
    '',
    'issues에 실제로 고친 항목만 짧게. 문제 없으면 issues:[].'
  ].join('\n');
}

function unwrapDocument(parsed, fallback) {
  if (!parsed || typeof parsed !== 'object') return { document: fallback, issues: [] };
  const doc = parsed.document != null ? parsed.document : parsed;
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 40)
    : [];
  if (!doc || typeof doc !== 'object') return { document: fallback, issues };
  return { document: doc, issues };
}

/**
 * @param {{ kind: 'lecture'|'exam'|'worksheet', document: object, context?: object, onProgress?: Function }} opts
 * @returns {Promise<{ document: object, report: object }>}
 */
async function dualVerifyGrammar(opts) {
  const kind = opts && opts.kind;
  if (!KIND_LABEL[kind]) {
    const err = new Error('Unknown grammar verify kind.');
    err.statusCode = 400;
    throw err;
  }
  let document = opts.document;
  if (!document || typeof document !== 'object') {
    const err = new Error('Nothing to verify.');
    err.statusCode = 400;
    throw err;
  }
  const context = opts.context || {};
  const report = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const outReport = {
    claudeIssues: [],
    geminiIssues: [],
    geminiSkipped: false,
    geminiSkipReason: null,
    claudeError: null,
    geminiError: null
  };

  report({
    message: 'Claude 자기검증 — 문법 사실·교육과정 검수 중…',
    pct: opts.pctClaude || 62,
    verifyPass: 'claude'
  });
  try {
    const claudeRaw = await askProviderJson(
      'claude',
      systemFor('claude', kind),
      buildVerifyPrompt(kind, document, context, 'claude'),
      { temperature: 0.12, maxOutputTokens: opts.maxOutputTokens || 16000 }
    );
    const unwrapped = unwrapDocument(claudeRaw, document);
    document = unwrapped.document;
    outReport.claudeIssues = unwrapped.issues;
  } catch (e) {
    outReport.claudeError = e.message || 'claude verify failed';
  }

  if (!hasGeminiKey()) {
    outReport.geminiSkipped = true;
    outReport.geminiSkipReason = 'GEMINI_API_KEY not set';
    report({
      message: 'Gemini 교차검증 생략 (키 없음) — Claude 검수본 사용',
      pct: opts.pctGemini || 78,
      verifyPass: 'gemini-skip'
    });
    return { document, report: outReport };
  }

  report({
    message: 'Gemini 교차검증 — 내신·참고서 부합 여부 확인 중…',
    pct: opts.pctGemini || 78,
    verifyPass: 'gemini'
  });
  try {
    const geminiRaw = await askProviderJson(
      'gemini',
      systemFor('gemini', kind),
      buildVerifyPrompt(kind, document, context, 'gemini'),
      { temperature: 0.1, maxOutputTokens: opts.maxOutputTokens || 16000 }
    );
    const unwrapped = unwrapDocument(geminiRaw, document);
    document = unwrapped.document;
    outReport.geminiIssues = unwrapped.issues;
  } catch (e) {
    outReport.geminiError = e.message || 'gemini verify failed';
  }

  return { document, report: outReport };
}

/** Split Korean stem + English example onto separate lines when AI glued them. */
function formatQuizPromptLines(prompt) {
  let p = String(prompt || '').replace(/\r\n/g, '\n').trim();
  if (!p) return p;
  if (p.includes('\n')) {
    return p.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  }
  // Best: after Korean question/imperative close, then English sentence.
  const m = p.match(
    /^([\s\S]*?(?:[？?]|(?:다|요|시오|까)\.))\s+([A-Z“"‘'][\s\S]+)$/
  );
  if (m && m[1].trim().length >= 6) {
    return m[1].trim() + '\n' + m[2].trim();
  }
  // Fallback: instruction keywords + capitalised English sentence.
  const m2 = p.match(/^([\s\S]*[\uAC00-\uD7A3][？?\.\s]*)([A-Z][A-Za-z][\s\S]+)$/);
  if (
    m2
    && m2[1].trim().length >= 8
    && /다음|빈칸|고르|알맞|옳은|틀린|어색|괄호|밑줄|보기|개념/.test(m2[1])
  ) {
    return m2[1].trim() + '\n' + m2[2].trim();
  }
  return p;
}

module.exports = {
  dualVerifyGrammar,
  formatQuizPromptLines,
  ACCURACY_LAW,
  extractJson,
  hasGeminiKey,
  isClaudeConfigured
};
