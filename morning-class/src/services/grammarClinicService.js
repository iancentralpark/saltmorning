'use strict';

/**
 * Korean middle-school English grammar exam generator (Class Tools).
 */
const crypto = require('crypto');
const {
  askGemini,
  isClaudeConfigured,
  formatGeminiClientError
} = require('./geminiService');
const {
  QUESTION_TYPES,
  MVP_TYPES,
  listCatalog,
  getUnitsByIds,
  listCategories
} = require('./grammarClinic/catalog');

const SYSTEM_PROMPT = `당신은 대한민국 중학교 영어 내신 기출문제를 전문적으로 출제하는 수석 출제위원입니다.
제공된 GrammarRuleSpec과 QuestionType에 정확히 부합하는 평가 문항을 생성하십시오.
각 문항은 할당된 unitId의 문법만 다루십시오. 다른 문법을 섞지 마십시오.

[출제 필수 규칙]
1. 난이도 및 어휘 통제: 중학교 교육과정 수준(중1~중3) 기본 어휘만 사용. 고난도 수능 어휘 금지.
2. 정답의 무결성: 문법적으로 복수 정답이 나거나 해석 이견이 없도록 구문을 명확히 통제.
   객관식 5지선다는 정답 선지를 제외한 나머지 문장은 완벽한 정문이어야 함.
3. 부정 발문 강조: 발문 내 '옳은','틀린','어색한','모두','두 개' 등 핵심 키워드는 <u>태그 적용.
4. 오답 트랩: 각 GrammarRuleSpec.errorTraps의 전형적 내신 오답을 1개 이상 주입.
5. 출력 형식: 지정 JSON만 반환. 마크다운 코드펜스 금지. 순수 JSON만.

[문항 완전성 — 절대 어기지 말 것]
- 모든 문항에 한국어 instruction(발문)을 반드시 채울 것. 빈 문자열 금지.
- contextBox를 쓰는 유형은 content를 실제로 채울 것. 빈 배열/빈 문자열/빈 박스 금지.
- SENTENCE_AUTHENTICITY_COMBINED / MULTIPLE: contextBox.type=SENTENCE_LIST, content에 ⓐ~ⓔ 문장 5개.
- UNDERLINE_CORRECTION / USAGE_CLASSIFICATION: 선지 또는 context 문장 안에 밑줄 부분을 <u>...</u>로 표시. 발문에 '밑줄'이 있으면 반드시 밑줄 존재.
- BLANK_COMPLETION: 본문/선지에 빈칸을 ______ 로 명시. 빈칸 없는 빈칸 문제 금지.
- FULL_SENTENCE_COMPOSITION / ORDERING_WITH_CONDITIONS: koreanPrompt 필수. ORDERING은 VOCAB_POOL(단어 목록) 필수.
- 객관식은 choices 5개, 각 text 비어 있지 않게.
- 할당된 문법(예: should have p.p.만, 관계대명사 which만) 외의 문법을 정답 포인트로 쓰지 말 것.

선지 기호는 객관식에서 ①②③④⑤ 텍스트 대신 choices[].number 1~5와 text만 사용.
서술형 조건은 conditions 배열에 한국어로.`;

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
  const startObj = raw.indexOf('{');
  const endObj = raw.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    try { return JSON.parse(raw.slice(startObj, endObj + 1)); } catch (e3) { /* continue */ }
  }
  const startArr = raw.indexOf('[');
  const endArr = raw.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) {
    try { return JSON.parse(raw.slice(startArr, endArr + 1)); } catch (e4) { /* continue */ }
  }
  return null;
}

/** Grammar clinic always uses Claude (no Gemini fallback). */
function claudeModel() {
  return String(
    process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

function clampCount(n) {
  const x = Math.round(Number(n) || 10);
  return Math.max(4, Math.min(50, x));
}

/** Claude batch size — larger sets are generated in chunks then merged. */
const GENERATE_CHUNK_SIZE = 6;
/** Keep finished/failed jobs briefly so the UI can poll the result. */
const JOB_TTL_MS = 45 * 60 * 1000;
const generateJobs = new Map();

function pruneGenerateJobs() {
  const now = Date.now();
  for (const [id, job] of generateJobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) generateJobs.delete(id);
  }
}

function normalizeGrade(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'M1' || s === 'M2' || s === 'M3') return s;
  if (s.includes('1')) return 'M1';
  if (s.includes('3')) return 'M3';
  return 'M2';
}

function normalizeDifficulty(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'EASY' || s === 'HARD') return s;
  return 'MEDIUM';
}

/** Build a mix of question types for N items. */
function buildTypePlan(count, preferredTypes) {
  const pool = (preferredTypes && preferredTypes.length)
    ? preferredTypes.filter((t) => QUESTION_TYPES.includes(t))
    : MVP_TYPES.slice();
  if (!pool.length) pool.push(...MVP_TYPES);
  const weights = {
    SENTENCE_AUTHENTICITY_SINGLE: 3,
    SENTENCE_AUTHENTICITY_MULTIPLE: 1,
    SENTENCE_AUTHENTICITY_COMBINED: 2,
    UNDERLINE_CORRECTION: 2,
    USAGE_CLASSIFICATION: 1,
    BLANK_COMPLETION: 2,
    SENTENCE_TRANSFORM: 2,
    DESCRIPTIVE_CORRECTION: 2,
    ORDERING_WITH_CONDITIONS: 2,
    FULL_SENTENCE_COMPOSITION: 2
  };
  const expanded = [];
  pool.forEach((t) => {
    const w = weights[t] || 1;
    for (let i = 0; i < w; i++) expanded.push(t);
  });
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push(expanded[i % expanded.length]);
  }
  // shuffle lightly
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = plan[i];
    plan[i] = plan[j];
    plan[j] = tmp;
  }
  return plan;
}

function assignUnitsRoundRobin(count, units) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(units[i % units.length].unitId);
  }
  return out;
}

function coerceChoice(raw, idx) {
  const number = Number(raw && raw.number != null ? raw.number : idx + 1);
  return {
    number: Math.min(5, Math.max(1, number || (idx + 1))),
    text: String((raw && (raw.text || raw.label)) || '').trim(),
    isCorrect: !!(raw && raw.isCorrect)
  };
}

function coerceItem(raw, fallback) {
  fallback = fallback || {};
  const type = QUESTION_TYPES.includes(raw && raw.questionType)
    ? raw.questionType
    : (fallback.questionType || 'SENTENCE_AUTHENTICITY_SINGLE');
  const choices = Array.isArray(raw && raw.choices)
    ? raw.choices.map(coerceChoice).filter((c) => c.text)
    : [];
  let answer = (raw && raw.answer) || {};
  if (typeof answer !== 'object') answer = {};
  const correctChoiceNumbers = Array.isArray(answer.correctChoiceNumbers)
    ? answer.correctChoiceNumbers.map(Number).filter((n) => n >= 1 && n <= 5)
    : choices.filter((c) => c.isCorrect).map((c) => c.number);

  // sync isCorrect flags
  if (correctChoiceNumbers.length && choices.length) {
    const set = new Set(correctChoiceNumbers);
    choices.forEach((c) => { c.isCorrect = set.has(c.number); });
  }

  let contextBox = raw && raw.contextBox ? raw.contextBox : undefined;
  if (contextBox) {
    const content = Array.isArray(contextBox.content)
      ? contextBox.content.map((x) => String(x || '').trim()).filter(Boolean)
      : String(contextBox.content || '').trim();
    const empty = Array.isArray(content) ? !content.length : !content;
    contextBox = empty
      ? undefined
      : {
        type: String(contextBox.type || 'SENTENCE_LIST'),
        content
      };
  }

  return {
    id: String((raw && raw.id) || newId('qi')),
    unitId: String((raw && raw.unitId) || fallback.unitId || ''),
    questionType: type,
    difficulty: normalizeDifficulty((raw && raw.difficulty) || fallback.difficulty),
    instruction: String((raw && raw.instruction) || '').trim(),
    contextBox,
    koreanPrompt: raw && raw.koreanPrompt ? String(raw.koreanPrompt).trim() : undefined,
    conditions: Array.isArray(raw && raw.conditions)
      ? raw.conditions.map((c) => String(c || '').trim()).filter(Boolean)
      : undefined,
    choices,
    answer: {
      correctChoiceNumbers: correctChoiceNumbers.length ? correctChoiceNumbers : undefined,
      descriptiveAnswers: Array.isArray(answer.descriptiveAnswers)
        ? answer.descriptiveAnswers
        : undefined,
      acceptableAlternatives: Array.isArray(answer.acceptableAlternatives)
        ? answer.acceptableAlternatives.map(String)
        : undefined
    },
    explanation: String((raw && raw.explanation) || '').trim()
  };
}

function itemPlainText(item) {
  const parts = [item.instruction, item.koreanPrompt, item.explanation];
  if (item.contextBox) {
    const c = item.contextBox.content;
    if (Array.isArray(c)) parts.push(c.join('\n'));
    else parts.push(c);
  }
  (item.choices || []).forEach((ch) => parts.push(ch.text));
  (item.conditions || []).forEach((c) => parts.push(c));
  return parts.filter(Boolean).join('\n');
}

function hasUnderlineMarkup(text) {
  const s = String(text || '');
  return /<u>[\s\S]+?<\/u>/i.test(s) || /_{2,}/.test(s) || /‾|＿/.test(s);
}

function hasBlankMarkup(text) {
  const s = String(text || '');
  return /_{3,}|□|\[\s*\]|（\s*）|\(\s*\)/.test(s) || /빈칸/.test(s);
}

function isObjectiveType(type) {
  return /AUTHENTICITY|UNDERLINE|USAGE|BLANK/.test(String(type || ''));
}

function isDescriptiveType(type) {
  return /DESCRIPTIVE|ORDERING|COMPOSITION|TRANSFORM/.test(String(type || ''));
}

function validateItem(item, unitMap) {
  const warnings = [];
  const type = item.questionType;
  const plain = itemPlainText(item);

  if (!item.instruction || item.instruction.length < 6) warnings.push('missing_instruction');
  if (!item.explanation) warnings.push('missing_explanation');
  if (!item.unitId || !unitMap[item.unitId]) warnings.push('unknown_unit');

  const needsSentenceList = type === 'SENTENCE_AUTHENTICITY_COMBINED'
    || type === 'SENTENCE_AUTHENTICITY_MULTIPLE'
    || type === 'DESCRIPTIVE_CORRECTION';
  if (needsSentenceList) {
    const lines = item.contextBox && Array.isArray(item.contextBox.content)
      ? item.contextBox.content
      : [];
    if (lines.length < 4) warnings.push('missing_sentence_list');
  }

  if (type === 'UNDERLINE_CORRECTION' || type === 'USAGE_CLASSIFICATION') {
    if (!hasUnderlineMarkup(plain)) warnings.push('missing_underline');
  } else if (/밑줄/.test(item.instruction || '') && !hasUnderlineMarkup(plain)) {
    warnings.push('missing_underline');
  }

  if (type === 'BLANK_COMPLETION' && !hasBlankMarkup(plain)) {
    warnings.push('missing_blank');
  }

  if (type === 'ORDERING_WITH_CONDITIONS') {
    if (!item.koreanPrompt) warnings.push('missing_korean_prompt');
    const pool = item.contextBox && item.contextBox.content;
    const poolOk = Array.isArray(pool) ? pool.length >= 1 : !!(pool && String(pool).trim());
    if (!poolOk) warnings.push('missing_word_pool');
  }

  if (type === 'FULL_SENTENCE_COMPOSITION' && !item.koreanPrompt) {
    warnings.push('missing_korean_prompt');
  }

  if (type === 'SENTENCE_TRANSFORM') {
    const hasSrc = !!(item.contextBox && item.contextBox.content) || !!item.koreanPrompt;
    if (!hasSrc) warnings.push('missing_transform_source');
  }

  if (isObjectiveType(type)) {
    if (item.choices.length < 4) warnings.push('few_choices');
    if (item.choices.some((c) => !c.text)) warnings.push('empty_choice_text');
    const corrects = (item.answer.correctChoiceNumbers || []).length;
    if (type === 'SENTENCE_AUTHENTICITY_MULTIPLE') {
      if (corrects < 2) warnings.push('need_multi_key');
    } else if (corrects < 1) {
      warnings.push('missing_key');
    }
    item.choices.forEach((c) => {
      if (c.text.length > 120) warnings.push('choice_too_long');
    });
  }

  if (isDescriptiveType(type)) {
    const hasDesc = (item.answer.descriptiveAnswers && item.answer.descriptiveAnswers.length)
      || (item.answer.acceptableAlternatives && item.answer.acceptableAlternatives.length);
    if (!hasDesc && !(item.answer.correctChoiceNumbers || []).length) {
      warnings.push('missing_descriptive_answer');
    }
    if (item.conditions && item.conditions.length) {
      const wordCond = item.conditions.find((c) => /\d+\s*단어/.test(c));
      if (wordCond && item.answer.descriptiveAnswers) {
        item.answer.descriptiveAnswers.forEach((d) => {
          const full = String(d.fullSentence || '').trim();
          if (!full) return;
          const n = full.split(/\s+/).filter(Boolean).length;
          const m = wordCond.match(/(\d+)\s*단어/);
          if (m && Math.abs(n - Number(m[1])) > 2) warnings.push('word_count_mismatch');
        });
      }
    }
  }

  if (item.instruction.length > 220) warnings.push('instruction_long');

  const hardFail = warnings.some((w) =>
    /missing_instruction|missing_key|need_multi_key|unknown_unit|few_choices|missing_descriptive|missing_sentence_list|missing_underline|missing_blank|missing_korean_prompt|missing_word_pool|missing_transform_source|empty_choice_text/.test(w)
  );
  return { ok: !hardFail, warnings };
}

async function askJson(prompt, opts) {
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
      systemInstruction: SYSTEM_PROMPT,
      temperature: opts.temperature != null ? opts.temperature : 0.55,
      maxOutputTokens: opts.maxOutputTokens || 8192,
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

function buildGenerateUserPrompt({ title, grade, difficulty, units, typePlan, unitPlan }) {
  const specs = units.map((u) => ({
    unitId: u.unitId,
    grade: u.grade,
    category: u.category,
    subCategory: u.subCategory,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
  const assignments = typePlan.map((qt, i) => ({
    index: i + 1,
    questionType: qt,
    unitId: unitPlan[i]
  }));
  return [
    '다음 명세로 중학교 내신 문법 시험 문항을 생성하라.',
    'title: ' + title,
    'schoolGrade: ' + grade,
    'defaultDifficulty: ' + difficulty,
    '',
    '[GrammarRuleSpec 목록]',
    JSON.stringify(specs, null, 2),
    '',
    '[문항 할당 — 각 index마다 지정된 questionType과 unitId를 따를 것]',
    JSON.stringify(assignments, null, 2),
    '',
    '출력 JSON 스키마:',
    JSON.stringify({
      title: 'string',
      schoolGrade: grade,
      items: [{
        id: 'string',
        unitId: 'string',
        questionType: 'SENTENCE_AUTHENTICITY_SINGLE',
        difficulty: 'MEDIUM',
        instruction: 'string with optional <u>tags</u>',
        contextBox: {
          type: 'SENTENCE_LIST|PASSAGE|DIALOGUE|VOCAB_POOL',
          content: ['ⓐ ...', '또는 단일 문자열']
        },
        koreanPrompt: 'optional',
        conditions: ['optional'],
        choices: [{ number: 1, text: 'string', isCorrect: false }],
        answer: {
          correctChoiceNumbers: [4],
          descriptiveAnswers: [{
            targetSymbol: 'ⓐ',
            incorrectPart: 'learn',
            correctedPart: 'to learn',
            fullSentence: '...'
          }],
          acceptableAlternatives: []
        },
        explanation: '한국어 해설'
      }]
    }, null, 2),
    '',
    'items 길이는 반드시 ' + typePlan.length + '개.',
    '객관식은 choices 5개. 서술형은 choices를 빈 배열로.',
    '각 문항은 할당된 unitId의 문법만 다루고 errorTraps를 반영할 것.',
    'instruction·필요한 contextBox·밑줄·빈칸·koreanPrompt를 빠짐없이 채울 것. 빈 박스 금지.'
  ].join('\n');
}

async function regenerateOneItem({ unit, questionType, difficulty, grade, reason }) {
  const parsed = await askJson([
    '다음 단일 문항만 재생성하라. JSON 객체 하나(AssessmentItem)만 반환.',
    '이전 문항이 불완전했다. 반드시 고쳐서 완전한 문항으로 낼 것.',
    '실패 사유: ' + (reason || 'incomplete'),
    'grade: ' + grade,
    'difficulty: ' + difficulty,
    'questionType: ' + questionType,
    '이 unitId의 문법만 다룰 것: ' + unit.unitId + ' (' + unit.subCategory + ')',
    'GrammarRuleSpec: ' + JSON.stringify(unit),
    '스키마는 AssessmentItem과 동일. 객관식이면 choices 5개.',
    'instruction 필수. COMBINED/MULTIPLE는 ⓐ~ⓔ SENTENCE_LIST 필수.',
    'UNDERLINE/USAGE는 <u>밑줄</u> 필수. BLANK는 ______ 필수.',
    '영작/배열은 koreanPrompt 필수. 빈 contextBox 금지.'
  ].join('\n'), { temperature: 0.4, maxOutputTokens: 4096 });
  const raw = parsed.items ? parsed.items[0] : parsed;
  return coerceItem(raw, { unitId: unit.unitId, questionType, difficulty });
}

async function generateExamPaper(opts) {
  opts = opts || {};
  const grade = normalizeGrade(opts.grade);
  const difficulty = normalizeDifficulty(opts.difficulty);
  const count = clampCount(opts.questionCount || opts.totalQuestions || 10);
  const unitIds = Array.isArray(opts.unitIds) ? opts.unitIds.map(String) : [];
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  // Large sets: one repair pass only — retries dominate wall time and cause proxy 502s.
  const maxRepairPasses = count >= 20 ? 1 : 2;
  if (unitIds.length < 1) {
    const err = new Error('문법 요소를 하나 이상 선택하세요.');
    err.statusCode = 400;
    throw err;
  }
  const units = getUnitsByIds(unitIds);
  if (!units.length) {
    const err = new Error('선택한 문법 유닛을 찾을 수 없습니다.');
    err.statusCode = 400;
    throw err;
  }

  const typePlan = buildTypePlan(count, opts.questionTypes);
  const unitPlan = assignUnitsRoundRobin(count, units);
  const title = String(opts.title || '').trim()
    || (grade.replace('M', '중') + ' 내신 문법 맞춤 클리닉');

  const unitMap = {};
  units.forEach((u) => { unitMap[u.unitId] = u; });

  const items = [];
  const warnings = [];
  let paperTitle = title;
  const totalChunks = Math.ceil(count / GENERATE_CHUNK_SIZE);

  const report = (message, extra) => {
    if (!onProgress) return;
    onProgress(Object.assign({
      itemsReady: items.length,
      target: count,
      message
    }, extra || {}));
  };
  report('출제 시작…', { chunk: 0, totalChunks });

  for (let offset = 0; offset < count; offset += GENERATE_CHUNK_SIZE) {
    const chunkIndex = Math.floor(offset / GENERATE_CHUNK_SIZE) + 1;
    const sliceTypes = typePlan.slice(offset, offset + GENERATE_CHUNK_SIZE);
    const sliceUnits = unitPlan.slice(offset, offset + GENERATE_CHUNK_SIZE);
    const chunkUnits = [];
    const seen = new Set();
    sliceUnits.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      if (unitMap[id]) chunkUnits.push(unitMap[id]);
    });
    report(
      '청크 ' + chunkIndex + '/' + totalChunks + ' 생성 중… (' + items.length + '/' + count + ')',
      { chunk: chunkIndex, totalChunks }
    );
    const prompt = buildGenerateUserPrompt({
      title,
      grade,
      difficulty,
      units: chunkUnits.length ? chunkUnits : units,
      typePlan: sliceTypes,
      unitPlan: sliceUnits
    });
    let parsed;
    try {
      parsed = await askJson(prompt, {
        maxOutputTokens: Math.min(12000, 1800 + sliceTypes.length * 700)
      });
    } catch (chunkErr) {
      // Config / hard AI failures should surface immediately.
      if (chunkErr && (chunkErr.statusCode === 503 || /not configured|ANTHROPIC/i.test(chunkErr.message || ''))) {
        throw chunkErr;
      }
      // One chunk failure should not kill a 50-item paper — skip and continue.
      warnings.push({
        index: offset + 1,
        warnings: ['chunk_failed'],
        error: chunkErr.message,
        soft: false
      });
      report('청크 ' + chunkIndex + ' 실패 — 다음 청크 계속', { chunk: chunkIndex, totalChunks });
      continue;
    }
    if (offset === 0 && parsed.title) paperTitle = String(parsed.title).trim() || title;
    const rawItems = Array.isArray(parsed.items)
      ? parsed.items
      : (Array.isArray(parsed) ? parsed : []);

    for (let j = 0; j < sliceTypes.length; j++) {
      const i = offset + j;
      const fallback = {
        unitId: sliceUnits[j],
        questionType: sliceTypes[j],
        difficulty
      };
      let item = coerceItem(rawItems[j] || {}, fallback);
      if (!item.unitId) item.unitId = sliceUnits[j];
      if (!QUESTION_TYPES.includes(item.questionType)) item.questionType = sliceTypes[j];

      let check = validateItem(item, unitMap);
      if (!check.ok) {
        for (let pass = 0; pass < maxRepairPasses && !check.ok; pass++) {
          try {
            const unit = unitMap[item.unitId] || units[0];
            item = await regenerateOneItem({
              unit,
              questionType: sliceTypes[j],
              difficulty,
              grade,
              reason: (pass ? 'retry_' + (pass + 1) + ':' : '') + check.warnings.join(',')
            });
            check = validateItem(item, unitMap);
          } catch (e) {
            warnings.push({
              index: i + 1,
              warnings: (check.warnings || []).concat(['retry_failed']),
              error: e.message
            });
            check = { ok: false, warnings: (check.warnings || []).concat(['retry_failed']) };
            break;
          }
        }
      }

      if (!check.ok) {
        warnings.push({ index: i + 1, warnings: check.warnings, dropped: true });
        continue; // do not put incomplete items on the paper
      }
      if (check.warnings && check.warnings.length) {
        warnings.push({ index: i + 1, warnings: check.warnings, soft: true });
      }
      items.push(item);
      if (items.length % 5 === 0 || items.length === count) {
        report(items.length + '/' + count + ' 문항 확보', { chunk: chunkIndex, totalChunks });
      }
    }
  }

  if (!items.length) {
    const err = new Error('완전한 문항을 만들지 못했습니다. 문법 포인트를 바꿔 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }

  report('시험지 조립 중… (' + items.length + '문항)', { chunk: totalChunks, totalChunks });

  const paper = {
    title: paperTitle,
    schoolGrade: grade,
    totalQuestions: items.length,
    selectedUnits: units.map((u) => ({
      unitId: u.unitId,
      grade: u.grade,
      category: u.category,
      subCategory: u.subCategory
    })),
    layout: {
      columns: 2,
      columnGapMm: 9,
      fontSizePt: 10,
      showScore: true
    },
    items,
    generatedAt: new Date().toISOString()
  };

  return {
    paper,
    htmlQuestions: renderQuestionsHtml(paper),
    htmlAnswers: renderAnswersHtml(paper),
    warnings
  };
}

/**
 * Start background generation so Railway/proxy timeouts do not kill 30–50 item runs.
 * Returns immediately with a jobId; poll getGenerateJob().
 */
function startGenerateJob(opts, ownerKey) {
  pruneGenerateJobs();
  const id = newId('gcjob');
  const target = clampCount((opts && (opts.questionCount || opts.totalQuestions)) || 10);
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: {
      itemsReady: 0,
      target,
      chunk: 0,
      totalChunks: Math.ceil(target / GENERATE_CHUNK_SIZE),
      message: '대기열에 등록됨…'
    },
    result: null,
    error: null
  };
  generateJobs.set(id, job);

  setImmediate(() => {
    generateExamPaper(Object.assign({}, opts || {}, {
      onProgress(p) {
        job.progress = Object.assign({}, job.progress, p || {});
        job.updatedAt = Date.now();
      }
    })).then((result) => {
      job.status = 'done';
      job.result = result;
      job.progress = Object.assign({}, job.progress, {
        itemsReady: (result.paper && result.paper.totalQuestions) || 0,
        message: '완료'
      });
      job.updatedAt = Date.now();
    }).catch((e) => {
      job.status = 'error';
      job.error = e.message || '생성 실패';
      job.progress = Object.assign({}, job.progress, { message: job.error });
      job.updatedAt = Date.now();
      console.error('grammarClinic job', id, e);
    });
  });

  return { jobId: id, status: job.status, progress: job.progress };
}

function getGenerateJob(jobId, ownerKey) {
  pruneGenerateJobs();
  const job = generateJobs.get(String(jobId || ''));
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== String(ownerKey)) {
    const err = new Error('Job not found.');
    err.statusCode = 404;
    throw err;
  }
  const out = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error || undefined
  };
  if (job.status === 'done' && job.result) {
    out.ok = true;
    out.paper = job.result.paper;
    out.htmlQuestions = job.result.htmlQuestions;
    out.htmlAnswers = job.result.htmlAnswers;
    out.warnings = job.result.warnings || [];
  }
  return out;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Allow only <u>…</u> inside instructions. */
function formatInstruction(raw) {
  const escaped = escapeHtml(String(raw || ''));
  return escaped
    .replace(/&lt;u&gt;/gi, '<u>')
    .replace(/&lt;\/u&gt;/gi, '</u>');
}

function choiceGlyph(n) {
  return ['①', '②', '③', '④', '⑤'][n - 1] || String(n);
}

function typeLabel(type) {
  const map = {
    SENTENCE_AUTHENTICITY_SINGLE: '어법 판단',
    SENTENCE_AUTHENTICITY_MULTIPLE: '복수 선택',
    SENTENCE_AUTHENTICITY_COMBINED: '기호 조합',
    UNDERLINE_CORRECTION: '밑줄 수정',
    USAGE_CLASSIFICATION: '용법 구별',
    BLANK_COMPLETION: '빈칸 완성',
    SENTENCE_TRANSFORM: '문장 전환',
    DESCRIPTIVE_CORRECTION: '서술형 수정',
    ORDERING_WITH_CONDITIONS: '어순 배열',
    FULL_SENTENCE_COMPOSITION: '조건부 영작'
  };
  return map[type] || type;
}

function renderItemHtml(item, index) {
  let html = '<div class="q-item">';
  html += '<div class="q-num">' + index + '.</div>';
  html += '<div class="q-body">';
  html += '<div class="q-inst">' + formatInstruction(item.instruction) + '</div>';

  if (item.koreanPrompt) {
    html += '<div class="q-ko">' + escapeHtml(item.koreanPrompt) + '</div>';
  }
  if (item.conditions && item.conditions.length) {
    html += '<div class="q-cond"><div class="q-cond-title">[조건]</div><ol>';
    item.conditions.forEach((c) => {
      html += '<li>' + escapeHtml(c) + '</li>';
    });
    html += '</ol></div>';
  }
  if (item.contextBox) {
    const c = item.contextBox.content;
    if (Array.isArray(c) && c.length) {
      html += '<div class="q-box">';
      c.forEach((line) => {
        html += '<div class="q-box-line">' + formatInstruction(line) + '</div>';
      });
      html += '</div>';
    } else if (c && String(c).trim()) {
      html += '<div class="q-box"><div class="q-box-line">' +
        formatInstruction(String(c)).replace(/\n/g, '<br>') + '</div></div>';
    }
  }
  if (item.choices && item.choices.length) {
    html += '<div class="q-choices">';
    item.choices
      .slice()
      .sort((a, b) => a.number - b.number)
      .forEach((ch) => {
        html += '<div class="q-choice">' + choiceGlyph(ch.number) + ' ' +
          formatInstruction(ch.text) + '</div>';
      });
    html += '</div>';
  } else if (isDescriptiveType(item.questionType)) {
    html += '<div class="q-lines"><div class="q-line"></div><div class="q-line"></div></div>';
  }
  html += '</div></div>';
  return html;
}

function sharedPrintCss() {
  return `
@page { size: A4; margin: 12mm 10mm; }
* { box-sizing: border-box; }
body {
  margin: 0;
  color: #111;
  font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  font-size: 10pt;
  line-height: 1.45;
  background: #fff;
}
.sheet-header {
  border-bottom: 2px solid #222;
  padding-bottom: 8px;
  margin-bottom: 12px;
  break-inside: avoid;
}
.sheet-header h1 {
  margin: 0 0 4px;
  font-size: 14pt;
  text-align: center;
  letter-spacing: -0.02em;
}
.sheet-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 9pt;
  color: #333;
}
.sheet-meta .score {
  border: 1px solid #333;
  padding: 2px 10px;
  min-width: 72px;
  text-align: center;
}
.units {
  margin-top: 4px;
  font-size: 8.5pt;
  color: #444;
}
.columns {
  column-count: 2;
  column-gap: 9mm;
  column-fill: balance;
}
.q-item {
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 0 0 11px;
  display: flex;
  gap: 4px;
  font-size: 9.5pt;
}
.q-num { font-weight: 700; min-width: 1.4em; }
.q-body { flex: 1; min-width: 0; }
.q-inst { margin-bottom: 4px; }
.q-inst u { font-weight: 700; text-decoration: underline; }
.q-ko {
  background: #f7f7f7;
  border: 1px solid #ddd;
  padding: 4px 6px;
  margin: 4px 0;
  font-size: 9pt;
}
.q-cond {
  border: 1px solid #bbb;
  padding: 4px 6px;
  margin: 4px 0;
  font-size: 8.5pt;
}
.q-cond-title { font-weight: 700; }
.q-cond ol { margin: 2px 0 0 1.1em; padding: 0; }
.q-box {
  border: 1px solid #999;
  padding: 5px 7px;
  margin: 5px 0;
  font-size: 9pt;
  background: #fff;
}
.q-box-line { margin: 2px 0; }
.q-choices { margin-top: 3px; }
.q-choice { margin: 1px 0; padding-left: 0.1em; }
.q-lines { margin-top: 6px; }
.q-line {
  border-bottom: 1px dotted #888;
  height: 1.15em;
  margin: 4px 0;
}
.ans-item {
  break-inside: avoid;
  margin: 0 0 10px;
  font-size: 9.5pt;
}
.ans-head { font-weight: 700; margin-bottom: 2px; }
.ans-key { color: #0b3d91; margin-bottom: 2px; }
.ans-exp { color: #222; }
.screen-only { }
@media print {
  .screen-only { display: none !important; }
  body { background: #fff; }
}
`;
}

function renderQuestionsHtml(paper) {
  const unitLine = (paper.selectedUnits || [])
    .map((u) => u.subCategory)
    .join(' · ');
  const dateStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  let body = '';
  (paper.items || []).forEach((item, i) => {
    body += renderItemHtml(item, i + 1);
  });
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(paper.title)} — 문제지</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&display=swap" rel="stylesheet">
<style>${sharedPrintCss()}</style>
</head>
<body>
  <header class="sheet-header">
    <h1>${escapeHtml(paper.title)}</h1>
    <div class="sheet-meta">
      <span>학년: ${escapeHtml(String(paper.schoolGrade || '').replace('M', '중'))}</span>
      <span>출제일: ${escapeHtml(dateStr)}</span>
      <span>문항 수: ${paper.totalQuestions}</span>
      ${paper.layout && paper.layout.showScore ? '<span class="score">점수 &nbsp;/&nbsp;</span>' : ''}
    </div>
    <div class="units">범위: ${escapeHtml(unitLine || '선택 문법')}</div>
  </header>
  <main class="columns">
    ${body}
  </main>
</body>
</html>`;
}

function formatAnswerKey(item) {
  const parts = [];
  const nums = item.answer && item.answer.correctChoiceNumbers;
  if (nums && nums.length) {
    parts.push(nums.map(choiceGlyph).join(', '));
  }
  const descs = item.answer && item.answer.descriptiveAnswers;
  if (descs && descs.length) {
    descs.forEach((d) => {
      const bits = [];
      if (d.targetSymbol) bits.push(d.targetSymbol);
      if (d.incorrectPart && d.correctedPart) {
        bits.push(d.incorrectPart + ' → ' + d.correctedPart);
      } else if (d.correctedPart) {
        bits.push(d.correctedPart);
      }
      if (d.fullSentence) bits.push(d.fullSentence);
      if (bits.length) parts.push(bits.join(' | '));
    });
  }
  const alts = item.answer && item.answer.acceptableAlternatives;
  if (alts && alts.length) parts.push('(인정: ' + alts.join(' / ') + ')');
  return parts.join(' · ') || '(정답 없음)';
}

function renderAnswersHtml(paper) {
  const dateStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
  let body = '';
  (paper.items || []).forEach((item, i) => {
    body += '<div class="ans-item">';
    body += '<div class="ans-head">' + (i + 1) + '. [' + escapeHtml(typeLabel(item.questionType)) +
      '] <span style="font-weight:400;color:#666">' + escapeHtml(item.unitId) + '</span></div>';
    body += '<div class="ans-key">정답: ' + escapeHtml(formatAnswerKey(item)) + '</div>';
    body += '<div class="ans-exp">해설: ' + escapeHtml(item.explanation || '') + '</div>';
    body += '</div>';
  });
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(paper.title)} — 정답·해설</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&display=swap" rel="stylesheet">
<style>${sharedPrintCss()}
.columns { column-count: 1; }
@media (min-width: 700px) { .columns { column-count: 2; } }
@media print { .columns { column-count: 2; } }
</style>
</head>
<body>
  <header class="sheet-header">
    <h1>${escapeHtml(paper.title)} — 정답 및 해설</h1>
    <div class="sheet-meta">
      <span>학년: ${escapeHtml(String(paper.schoolGrade || '').replace('M', '중'))}</span>
      <span>출제일: ${escapeHtml(dateStr)}</span>
      <span>문항 수: ${paper.totalQuestions}</span>
    </div>
  </header>
  <main class="columns">${body}</main>
</body>
</html>`;
}

module.exports = {
  QUESTION_TYPES,
  MVP_TYPES,
  listCatalog,
  listCategories,
  getUnitsByIds,
  generateExamPaper,
  startGenerateJob,
  getGenerateJob,
  renderQuestionsHtml,
  renderAnswersHtml,
  validateItem,
  isClaudeConfigured,
  /** @deprecated use isClaudeConfigured — catalog route compat */
  isGeminiConfigured: isClaudeConfigured,
  claudeModel
};
