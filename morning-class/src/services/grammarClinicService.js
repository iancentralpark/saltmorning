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
const { dualVerifyGrammar, ACCURACY_LAW } = require('./grammarVerifyService');
const {
  QUESTION_TYPES,
  MVP_TYPES,
  QUESTION_TYPE_LABELS,
  listCatalog,
  getUnitsByIds,
  listCategories
} = require('./grammarClinic/catalog');
const { isOpsDbEnabled, query, table } = require('../db/pool');

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

` + ACCURACY_LAW + `

[문항 완전성 — 절대 어기지 말 것]
- 모든 문항에 한국어 instruction(발문)을 반드시 채울 것. 빈 문자열 금지.
- contextBox를 쓰는 유형은 content를 실제로 채울 것. 빈 배열/빈 문자열/빈 박스 금지.
- SENTENCE_AUTHENTICITY_COMBINED / MULTIPLE / ERROR_COUNT: contextBox.type=SENTENCE_LIST, content에 ⓐ~ⓔ 문장 5개.
- UNDERLINE_CORRECTION / USAGE_CLASSIFICATION / USAGE_ODD_ONE: 선지 또는 context에 <u>...</u> 밑줄 필수.
- BLANK_COMPLETION / DIALOGUE_BLANK / PARAPHRASE_BLANK / GUIDED_COMPLETION: ______ 빈칸 명시.
- DIALOGUE_BLANK: contextBox.type=DIALOGUE (A:/B: 또는 말풍선 형태 2~6줄).
- BOX_CHOICE_MATCHING: 본문에 (A)/(B)/(C) 네모 선택지(예: [Create / To create])를 넣고, choices는 짝짓기 선지 5개.
- TRANSLATION_MCQ: koreanPrompt에 우리말, choices에 영어 문장 5개.
- TRANSLATION_EXTRA_WORD: koreanPrompt+단어 목록(VOCAB_POOL). 정답은 '필요 없는 단어'.
- ORDERING_WITH_CONDITIONS / ORDERING_NTH: koreanPrompt+VOCAB_POOL. ORDERING_NTH는 발문에 N번째 명시.
- SENTENCE_INSERT: 지문(PASSAGE) + 삽입할 문장(koreanPrompt 또는 conditions). choices는 위치 ①~⑤.
- FULL_SENTENCE_COMPOSITION / GUIDED_COMPLETION: koreanPrompt 또는 표·제시 정보(contextBox) 필수.
- ★ 지문형(PASSAGE_*) — 중학 내신 핵심:
  contextBox.type=PASSAGE, content는 연결된 영어 본문 4~8문장(약 70~140단어). 단문 나열(SENTENCE_LIST) 금지.
  발문은 '다음 글을 읽고' / '윗글의…' 톤.
  · PASSAGE_UNDERLINE_ERROR: 본문에 <u>ⓐ …</u> ~ <u>ⓔ …</u> 밑줄 5곳, 어법상 틀린 것 고르기.
  · PASSAGE_BOX_MATCHING: 본문에 (A)[opt1 / opt2], (B)…, (C)… 네모 3곳, 알맞은 짝 선지.
  · PASSAGE_BLANK_PAIRING: 본문 빈칸 (A)(B) 또는 (A)~(C), 들어갈 말 짝 선지.
  · PASSAGE_TRANSLATION_MCQ: 본문 속 밑줄 우리말(또는 영작 대상) → 영어 선지 5개.
  · PASSAGE_FIND_REWRITE: 본문 ①~⑤ 중 틀린 곳 번호+고쳐 쓰기(서술형).
  · PASSAGE_USAGE_ODD_ONE: 본문/보기 밑줄 중 쓰임이 나머지와 다른 것.
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
const GENERATE_CHUNK_SIZE = 5;
/** Parallel Claude chunk calls for large papers (keeps 50-item runs under ~10 min). */
const GENERATE_PARALLEL = 3;
/** Keep finished/failed jobs so the UI can poll after Railway restarts. */
const JOB_TTL_MS = 12 * 60 * 60 * 1000;
const generateJobs = new Map();
const persistTimers = new Map();
let jobsSchemaReady = false;

function pruneGenerateJobs() {
  const now = Date.now();
  for (const [id, job] of generateJobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) generateJobs.delete(id);
  }
}

async function ensureJobsSchema() {
  if (jobsSchemaReady || !isOpsDbEnabled()) return;
  try {
    await query(
      'CREATE TABLE IF NOT EXISTS ' + table('grammar_clinic_jobs') + ' (' +
        'id TEXT PRIMARY KEY,' +
        'owner_key TEXT NOT NULL DEFAULT \'\',' +
        'status TEXT NOT NULL DEFAULT \'running\',' +
        'progress JSONB,' +
        'result JSONB,' +
        'error TEXT,' +
        'created_at TIMESTAMPTZ NOT NULL DEFAULT now(),' +
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()' +
      ')'
    );
    jobsSchemaReady = true;
  } catch (e) {
    console.warn('grammar clinic jobs schema ensure failed', e.message);
  }
}

async function persistGenerateJob(job, immediate) {
  if (!job || !job.id || !isOpsDbEnabled()) return;
  const write = async () => {
    await ensureJobsSchema();
    if (!jobsSchemaReady) return;
    try {
      await query(
        'INSERT INTO ' + table('grammar_clinic_jobs') +
          ' (id, owner_key, status, progress, result, error, created_at, updated_at) VALUES (' +
          '$1,$2,$3,$4::jsonb,$5::jsonb,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0)' +
        ') ON CONFLICT (id) DO UPDATE SET ' +
          'status = EXCLUDED.status, progress = EXCLUDED.progress, result = EXCLUDED.result, ' +
          'error = EXCLUDED.error, updated_at = EXCLUDED.updated_at',
        [
          job.id,
          job.ownerKey || '',
          job.status,
          JSON.stringify(job.progress || {}),
          job.result ? JSON.stringify(job.result) : null,
          job.error || null,
          job.createdAt || Date.now(),
          job.updatedAt || Date.now()
        ]
      );
    } catch (e) {
      console.warn('grammar clinic job persist failed', job.id, e.message);
    }
  };
  if (immediate) {
    if (persistTimers.has(job.id)) {
      clearTimeout(persistTimers.get(job.id));
      persistTimers.delete(job.id);
    }
    await write();
    return;
  }
  if (persistTimers.has(job.id)) return;
  persistTimers.set(job.id, setTimeout(() => {
    persistTimers.delete(job.id);
    write();
  }, 1200));
}

async function loadGenerateJobFromDb(jobId) {
  if (!isOpsDbEnabled()) return null;
  await ensureJobsSchema();
  if (!jobsSchemaReady) return null;
  try {
    const r = await query(
      'SELECT * FROM ' + table('grammar_clinic_jobs') + ' WHERE id = $1 LIMIT 1',
      [String(jobId || '')]
    );
    const row = r.rows[0];
    if (!row) return null;
    const job = {
      id: row.id,
      ownerKey: row.owner_key || '',
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
      progress: row.progress || {},
      result: row.result || null,
      error: row.error || null,
      fromDb: true
    };
    // Process restart: a "running" row with no live worker is orphaned.
    if (job.status === 'running' && !generateJobs.has(job.id)) {
      job.status = 'error';
      job.error = '서버가 재시작되어 출제가 중단되었습니다. 다시 Generate 해 주세요.';
      job.progress = Object.assign({}, job.progress, { message: job.error });
      job.updatedAt = Date.now();
      await persistGenerateJob(job, true);
    }
    generateJobs.set(job.id, job);
    return job;
  } catch (e) {
    console.warn('grammar clinic job load failed', jobId, e.message);
    return null;
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

/**
 * Build a mix of question types for N items.
 * Large papers (25–50) use the FULL type catalog with the same weights —
 * dual verify (Claude→Gemini) already guards quality; shrinking the pool
 * just made long exams feel monotonous.
 */
function buildTypePlan(count, preferredTypes) {
  let pool;
  if (preferredTypes && preferredTypes.length) {
    pool = preferredTypes.filter((t) => QUESTION_TYPES.includes(t));
  } else {
    pool = MVP_TYPES.slice();
  }
  if (!pool.length) pool.push(...MVP_TYPES);
  const weights = {
    SENTENCE_AUTHENTICITY_SINGLE: 2,
    SENTENCE_AUTHENTICITY_MULTIPLE: 1,
    SENTENCE_AUTHENTICITY_COMBINED: 2,
    UNDERLINE_CORRECTION: 2,
    USAGE_CLASSIFICATION: 1,
    USAGE_ODD_ONE: 2,
    BLANK_COMPLETION: 2,
    DIALOGUE_BLANK: 2,
    BOX_CHOICE_MATCHING: 2,
    ERROR_COUNT: 1,
    SENTENCE_TRANSFORM: 2,
    DESCRIPTIVE_CORRECTION: 1,
    ORDERING_WITH_CONDITIONS: 1,
    ORDERING_NTH: 1,
    FULL_SENTENCE_COMPOSITION: 1,
    TRANSLATION_MCQ: 2,
    TRANSLATION_EXTRA_WORD: 1,
    PARAPHRASE_BLANK: 1,
    SENTENCE_INSERT: 2,
    GUIDED_COMPLETION: 1,
    PASSAGE_UNDERLINE_ERROR: 3,
    PASSAGE_BOX_MATCHING: 3,
    PASSAGE_BLANK_PAIRING: 2,
    PASSAGE_TRANSLATION_MCQ: 2,
    PASSAGE_FIND_REWRITE: 2,
    PASSAGE_USAGE_ODD_ONE: 2
  };
  const expanded = [];
  pool.forEach((t) => {
    const w = Math.max(1, weights[t] || 1);
    for (let i = 0; i < w; i++) expanded.push(t);
  });
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push(expanded[i % expanded.length]);
  }
  // shuffle order only — relative type frequencies stay near the weights
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
  return /AUTHENTICITY|UNDERLINE|USAGE|BLANK_COMPLETION|DIALOGUE_BLANK|BOX_CHOICE|ERROR_COUNT|TRANSLATION_MCQ|TRANSLATION_EXTRA|ORDERING_NTH|SENTENCE_INSERT|PASSAGE_UNDERLINE|PASSAGE_BOX|PASSAGE_BLANK|PASSAGE_TRANSLATION|PASSAGE_USAGE/.test(String(type || ''));
}

function isDescriptiveType(type) {
  return /DESCRIPTIVE|ORDERING_WITH|COMPOSITION|TRANSFORM|GUIDED_COMPLETION|PARAPHRASE_BLANK|PASSAGE_FIND_REWRITE/.test(String(type || ''));
}

function isPassageType(type) {
  return /^PASSAGE_/.test(String(type || '')) || type === 'SENTENCE_INSERT';
}

function passageWordCount(item) {
  const box = item && item.contextBox && item.contextBox.content;
  const text = Array.isArray(box) ? box.join(' ') : String(box || '');
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/[①-⑩ⓐ-ⓩ（）()\[\]\/]/g, ' ');
  return plain.split(/\s+/).filter(Boolean).length;
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
    || type === 'DESCRIPTIVE_CORRECTION'
    || type === 'ERROR_COUNT';
  if (needsSentenceList) {
    const lines = item.contextBox && Array.isArray(item.contextBox.content)
      ? item.contextBox.content
      : [];
    if (lines.length < 4) warnings.push('missing_sentence_list');
  }

  if (
    type === 'UNDERLINE_CORRECTION'
    || type === 'USAGE_CLASSIFICATION'
    || type === 'USAGE_ODD_ONE'
  ) {
    if (!hasUnderlineMarkup(plain)) warnings.push('missing_underline');
  } else if (/밑줄/.test(item.instruction || '') && !hasUnderlineMarkup(plain)) {
    warnings.push('missing_underline');
  }

  if (
    (type === 'BLANK_COMPLETION'
      || type === 'DIALOGUE_BLANK'
      || type === 'PARAPHRASE_BLANK')
    && !hasBlankMarkup(plain)
  ) {
    warnings.push('missing_blank');
  }

  if (type === 'DIALOGUE_BLANK') {
    const box = item.contextBox && item.contextBox.content;
    const ok = Array.isArray(box) ? box.length >= 2 : !!(box && String(box).trim().length > 10);
    if (!ok) warnings.push('missing_dialogue');
  }

  if (type === 'BOX_CHOICE_MATCHING') {
    if (!/\([A-C]\)|（[A-C]）|\[.+\s*\/\s*.+\]/.test(plain)) {
      warnings.push('missing_box_choices');
    }
  }

  if (type === 'ORDERING_WITH_CONDITIONS' || type === 'ORDERING_NTH' || type === 'TRANSLATION_EXTRA_WORD') {
    if (!item.koreanPrompt) warnings.push('missing_korean_prompt');
    const pool = item.contextBox && item.contextBox.content;
    const poolOk = Array.isArray(pool) ? pool.length >= 1 : !!(pool && String(pool).trim());
    if (!poolOk) warnings.push('missing_word_pool');
  }

  if (
    (type === 'FULL_SENTENCE_COMPOSITION' || type === 'TRANSLATION_MCQ' || type === 'GUIDED_COMPLETION')
    && !item.koreanPrompt
    && !(item.contextBox && item.contextBox.content)
  ) {
    warnings.push('missing_korean_prompt');
  }

  if (type === 'SENTENCE_TRANSFORM') {
    const hasSrc = !!(item.contextBox && item.contextBox.content) || !!item.koreanPrompt;
    if (!hasSrc) warnings.push('missing_transform_source');
  }

  if (type === 'SENTENCE_INSERT') {
    const hasPassage = !!(item.contextBox && item.contextBox.content);
    if (!hasPassage) warnings.push('missing_passage');
  }

  if (isPassageType(type) && type !== 'SENTENCE_INSERT') {
    const box = item.contextBox;
    if (!box || !box.content) {
      warnings.push('missing_passage');
    } else {
      const ctype = String(box.type || '').toUpperCase();
      if (ctype && ctype !== 'PASSAGE' && ctype !== 'DIALOGUE') {
        // Prefer PASSAGE; still accept if long enough connected text
        if (passageWordCount(item) < 45) warnings.push('passage_too_short');
      } else if (passageWordCount(item) < 45) {
        warnings.push('passage_too_short');
      }
    }
    if (type === 'PASSAGE_UNDERLINE_ERROR' || type === 'PASSAGE_USAGE_ODD_ONE' || type === 'PASSAGE_FIND_REWRITE') {
      if (!hasUnderlineMarkup(plain) && !/[①-⑤ⓐ-ⓔ]/.test(plain)) {
        warnings.push('missing_underline');
      }
    }
    if (type === 'PASSAGE_BOX_MATCHING' && !/\([A-C]\)|（[A-C]）|\[.+\s*\/\s*.+\]/.test(plain)) {
      warnings.push('missing_box_choices');
    }
    if (type === 'PASSAGE_BLANK_PAIRING' && !hasBlankMarkup(plain)) {
      warnings.push('missing_blank');
    }
    if (type === 'PASSAGE_TRANSLATION_MCQ' && !item.koreanPrompt && !/우리말|영작|영어로/.test(item.instruction || '')) {
      // soft: translation target should be visible in passage underline or koreanPrompt
      if (!hasUnderlineMarkup(plain)) warnings.push('missing_korean_prompt');
    }
  }

  if (type === 'PARAPHRASE_BLANK') {
    const lines = item.contextBox && Array.isArray(item.contextBox.content)
      ? item.contextBox.content
      : [];
    if (lines.length < 2 && !hasBlankMarkup(plain)) warnings.push('missing_paraphrase_pair');
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
    /missing_instruction|missing_key|need_multi_key|unknown_unit|few_choices|missing_descriptive|missing_sentence_list|missing_underline|missing_blank|missing_korean_prompt|missing_word_pool|missing_transform_source|missing_dialogue|missing_box_choices|missing_passage|passage_too_short|missing_paraphrase_pair|empty_choice_text/.test(w)
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
          content: ['ⓐ ... 또는 PASSAGE면 연결 본문 한 덩어리 문자열']
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
    'instruction 필수. COMBINED/MULTIPLE/ERROR_COUNT는 ⓐ~ⓔ SENTENCE_LIST 필수.',
    'UNDERLINE/USAGE/USAGE_ODD_ONE는 <u>밑줄</u> 필수. BLANK/DIALOGUE_BLANK는 ______ 필수.',
    'TRANSLATION_MCQ는 koreanPrompt+영어 선지. BOX_CHOICE는 (A)~(C) 네모 선택.',
    'PASSAGE_* 는 contextBox.type=PASSAGE 로 70단어 이상 연결 본문. 단문 나열 금지.',
    '영작/배열은 koreanPrompt(+단어풀) 필수. 빈 contextBox 금지.'
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
  // Large sets: skip/limit repairs — retries dominate wall time.
  const maxRepairPasses = count >= 30 ? 0 : (count >= 20 ? 1 : 2);
  const parallel = count >= 20 ? GENERATE_PARALLEL : 1;
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

  const chunkSpecs = [];
  for (let offset = 0; offset < count; offset += GENERATE_CHUNK_SIZE) {
    const sliceTypes = typePlan.slice(offset, offset + GENERATE_CHUNK_SIZE);
    const sliceUnits = unitPlan.slice(offset, offset + GENERATE_CHUNK_SIZE);
    chunkSpecs.push({
      offset,
      chunkIndex: Math.floor(offset / GENERATE_CHUNK_SIZE) + 1,
      sliceTypes,
      sliceUnits
    });
  }
  const totalChunks = chunkSpecs.length;

  const itemsByIndex = new Array(count);
  const warnings = [];
  let paperTitle = title;
  let itemsReady = 0;

  const report = (message, extra) => {
    if (!onProgress) return;
    onProgress(Object.assign({
      itemsReady,
      target: count,
      message
    }, extra || {}));
  };
  report('출제 시작… (병렬 ' + parallel + ')', { chunk: 0, totalChunks });

  async function runOneChunk(spec) {
    const { offset, chunkIndex, sliceTypes, sliceUnits } = spec;
    const chunkUnits = [];
    const seen = new Set();
    sliceUnits.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      if (unitMap[id]) chunkUnits.push(unitMap[id]);
    });
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
        maxOutputTokens: Math.min(10000, 1500 + sliceTypes.length * 650)
      });
    } catch (chunkErr) {
      if (chunkErr && (chunkErr.statusCode === 503 || /not configured|ANTHROPIC/i.test(chunkErr.message || ''))) {
        throw chunkErr;
      }
      return {
        chunkIndex,
        title: null,
        warnings: [{
          index: offset + 1,
          warnings: ['chunk_failed'],
          error: chunkErr.message,
          soft: false
        }],
        placed: []
      };
    }

    const rawItems = Array.isArray(parsed.items)
      ? parsed.items
      : (Array.isArray(parsed) ? parsed : []);
    const placed = [];
    const localWarnings = [];

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
      if (!check.ok && maxRepairPasses > 0) {
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
            localWarnings.push({
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
        localWarnings.push({ index: i + 1, warnings: check.warnings, dropped: true });
        continue;
      }
      if (check.warnings && check.warnings.length) {
        localWarnings.push({ index: i + 1, warnings: check.warnings, soft: true });
      }
      placed.push({ index: i, item });
    }

    return {
      chunkIndex,
      title: parsed.title ? String(parsed.title).trim() : null,
      warnings: localWarnings,
      placed
    };
  }

  for (let batchStart = 0; batchStart < chunkSpecs.length; batchStart += parallel) {
    const batch = chunkSpecs.slice(batchStart, batchStart + parallel);
    const from = batch[0].chunkIndex;
    const to = batch[batch.length - 1].chunkIndex;
    report(
      '청크 ' + from + (to !== from ? '–' + to : '') + '/' + totalChunks + ' 생성 중… (' + itemsReady + '/' + count + ')',
      { chunk: to, totalChunks }
    );
    const results = await Promise.all(batch.map((spec) => runOneChunk(spec)));
    results
      .slice()
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .forEach((res) => {
        if (res.title && batchStart === 0 && res.chunkIndex === 1) {
          paperTitle = res.title || paperTitle;
        }
        (res.warnings || []).forEach((w) => warnings.push(w));
        (res.placed || []).forEach((p) => {
          itemsByIndex[p.index] = p.item;
        });
      });
    itemsReady = itemsByIndex.filter(Boolean).length;
    report(itemsReady + '/' + count + ' 문항 확보', { chunk: to, totalChunks });
  }

  const items = itemsByIndex.filter(Boolean);
  if (!items.length) {
    const err = new Error('완전한 문항을 만들지 못했습니다. 문법 포인트를 바꿔 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }

  report('시험지 조립 중… (' + items.length + '문항)', { chunk: totalChunks, totalChunks });

  let paper = {
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

  // Dual verify (Claude → Gemini). Large papers: verify in chunks of 10 to stay under token limits.
  const VERIFY_CHUNK = 10;
  const verifiedItems = [];
  for (let offset = 0; offset < paper.items.length; offset += VERIFY_CHUNK) {
    const slice = paper.items.slice(offset, offset + VERIFY_CHUNK);
    const chunkNo = Math.floor(offset / VERIFY_CHUNK) + 1;
    const chunkTotal = Math.ceil(paper.items.length / VERIFY_CHUNK);
    report(
      '이중 검증 ' + chunkNo + '/' + chunkTotal + ' (Claude→Gemini)…',
      { chunk: totalChunks, totalChunks, verifyChunk: chunkNo, verifyTotal: chunkTotal }
    );
    try {
      const verified = await dualVerifyGrammar({
        kind: 'exam',
        document: {
          title: paper.title,
          schoolGrade: paper.schoolGrade,
          items: slice
        },
        context: { title: paper.title, grade, units },
        onProgress: (p) => report(p.message || '검증 중…', {
          chunk: totalChunks,
          totalChunks,
          verifyPass: p.verifyPass
        }),
        pctClaude: 70,
        pctGemini: 85,
        maxOutputTokens: Math.min(16000, 4000 + slice.length * 1200)
      });
      const vr = verified.report || {};
      (vr.claudeIssues || []).forEach((x) => warnings.push({ index: offset + 1, warnings: ['claude_verify'], note: x, soft: true }));
      (vr.geminiIssues || []).forEach((x) => warnings.push({ index: offset + 1, warnings: ['gemini_verify'], note: x, soft: true }));
      if (vr.claudeError) warnings.push({ index: offset + 1, warnings: ['claude_verify_fail'], error: vr.claudeError, soft: true });
      if (vr.geminiSkipped) warnings.push({ index: offset + 1, warnings: ['gemini_verify_skip'], note: vr.geminiSkipReason, soft: true });
      if (vr.geminiError) warnings.push({ index: offset + 1, warnings: ['gemini_verify_fail'], error: vr.geminiError, soft: true });
      const outItems = Array.isArray(verified.document && verified.document.items)
        ? verified.document.items
        : slice;
      // Keep original length; pad/truncate to slice size
      for (let i = 0; i < slice.length; i++) {
        verifiedItems.push(outItems[i] || slice[i]);
      }
    } catch (e) {
      warnings.push({ index: offset + 1, warnings: ['dual_verify_failed'], error: e.message, soft: true });
      slice.forEach((it) => verifiedItems.push(it));
    }
  }

  // Re-coerce / re-validate after verify so schema stays sound
  const finalItems = [];
  verifiedItems.forEach((raw, i) => {
    const fallback = paper.items[i] || raw;
    let item = coerceItem(raw || {}, {
      unitId: fallback.unitId,
      questionType: fallback.questionType,
      difficulty: fallback.difficulty || difficulty
    });
    if (!item.unitId) item.unitId = fallback.unitId;
    const check = validateItem(item, unitMap);
    if (!check.ok) {
      // Keep pre-verify item if verify broke the schema
      item = paper.items[i];
      warnings.push({ index: i + 1, warnings: (check.warnings || []).concat(['verify_reverted']), soft: true });
    } else if (check.warnings && check.warnings.length) {
      warnings.push({ index: i + 1, warnings: check.warnings, soft: true });
    }
    if (item) finalItems.push(item);
  });

  paper = Object.assign({}, paper, {
    items: finalItems.length ? finalItems : paper.items,
    totalQuestions: (finalItems.length ? finalItems : paper.items).length
  });

  report('검증 반영·시험지 렌더 중…', { chunk: totalChunks, totalChunks });

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
      message: '대기열에 등록됨… (50문항은 수 분 소요)'
    },
    result: null,
    error: null
  };
  generateJobs.set(id, job);
  persistGenerateJob(job, true);

  setImmediate(() => {
    generateExamPaper(Object.assign({}, opts || {}, {
      onProgress(p) {
        job.progress = Object.assign({}, job.progress, p || {});
        job.updatedAt = Date.now();
        persistGenerateJob(job, false);
      }
    })).then((result) => {
      job.status = 'done';
      job.result = result;
      job.progress = Object.assign({}, job.progress, {
        itemsReady: (result.paper && result.paper.totalQuestions) || 0,
        message: '완료'
      });
      job.updatedAt = Date.now();
      persistGenerateJob(job, true);
    }).catch((e) => {
      job.status = 'error';
      job.error = e.message || '생성 실패';
      job.progress = Object.assign({}, job.progress, { message: job.error });
      job.updatedAt = Date.now();
      persistGenerateJob(job, true);
      console.error('grammarClinic job', id, e);
    });
  });

  return { jobId: id, status: job.status, progress: job.progress };
}

function publicGenerateJob(job) {
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

async function getGenerateJob(jobId, ownerKey) {
  pruneGenerateJobs();
  let job = generateJobs.get(String(jobId || ''));
  if (!job) {
    job = await loadGenerateJobFromDb(jobId);
  }
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== String(ownerKey)) {
    const err = new Error('Job not found.');
    err.statusCode = 404;
    throw err;
  }
  return publicGenerateJob(job);
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
  return (QUESTION_TYPE_LABELS && QUESTION_TYPE_LABELS[type]) || type;
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
