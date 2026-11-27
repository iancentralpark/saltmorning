'use strict';

const crypto = require('crypto');
const { askGemini, isClaudeConfigured } = require('./geminiService');
const { isOpsDbEnabled, query, table } = require('../db/pool');
const { listChapters, listCurricula, getChapter } = require('./mathCurriculum');
const { verifyQuestion } = require('./mathVerify');
const { renderWorkbookHtml } = require('./mathWorkbookHtml');

const jobs = new Map();
const MAX_JOBS = 40;
const BATCH = 8;
const SECTION_ORDER = ['guided', 'basic', 'intermediate', 'advanced', 'word', 'mastery'];
const DEFAULT_COUNTS = {
  guided: 6,
  basic: 10,
  intermediate: 10,
  advanced: 6,
  word: 6,
  mastery: 8
};
const MAX_SECTION = 20;
const MAX_TOTAL = 60;

const SYSTEM = [
  'You write Salt Academy Pre-Algebra workbook content.',
  'Return one JSON object only. No markdown.',
  'Student-facing math uses $...$ inline LaTeX.',
  'Use only the learning-objective ids that are provided.',
  'When a question has a numeric or linear answer, include "expression" that a calculator can check:',
  '- arithmetic: digits, parentheses, + - * / ^ only. Example: "(3+4)*2"',
  '- linear equation in x: exactly one "=". Example: "2*x+5=17"',
  'Answers are simplified integers, fractions like 3/4, a simplified expression in x such as 5x+3, or an ordered pair such as 3, -2. A perfect-square root is sqrt(25). No units and no words.',
  'If a question cannot be written that way, omit expression.',
  'Do not repeat a question stem.',
  'Steps state why each operation happens.'
].join('\n');

let askOverride = null;
let schemaReady = null;

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function claudeModel() {
  return String(process.env.MATH_WORKBOOK_CLAUDE_MODEL || 'claude-sonnet-4-5').trim() || 'claude-sonnet-4-5';
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

function clampCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(MAX_SECTION, v);
}

function normalizeOptions(body, chapter) {
  const src = body || {};
  const countsIn = src.counts || {};
  const includeIn = src.include || {};
  const counts = {};
  let total = 0;
  SECTION_ORDER.forEach((key) => {
    const fallback = DEFAULT_COUNTS[key];
    const n = countsIn[key] == null ? fallback : clampCount(countsIn[key]);
    const on = includeIn[key] !== false && includeIn[key] !== 0 && includeIn[key] !== '0';
    counts[key] = on ? n : 0;
    total += counts[key];
  });
  if (total > MAX_TOTAL) {
    const err = new Error('문항 수는 챕터마다 ' + MAX_TOTAL + '개까지입니다. 섹션 수를 줄여 주세요.');
    err.statusCode = 400;
    throw err;
  }
  if (total < 1) {
    const err = new Error('연습 문항을 1개 이상 켜 주세요.');
    err.statusCode = 400;
    throw err;
  }
  const level = ['beginner', 'standard', 'advanced'].includes(src.level) ? src.level : 'standard';
  const language = src.language === 'ko' ? 'ko' : 'en';
  const title = String(src.title || '').trim().slice(0, 120) ||
    ((chapter.title || 'Workbook') + ' Workbook');
  const examples = src.include && src.include.examples === false ? 0 : 4;
  return { title, level, language, counts, examples, total };
}

function levelNote(level) {
  if (level === 'beginner') return 'Use small whole numbers, usually 1 through 20, and one clear step beyond the definition.';
  if (level === 'advanced') return 'Use multi-step items, integers, and numbers into the hundreds when the chapter allows.';
  return 'Use typical grade 6–8 numbers and a steady rise from basic to advanced.';
}

function languageNote(language) {
  if (language === 'ko') return 'Write explanations, prompts, steps, and mistakes in Korean. Keep mathematical notation in LaTeX.';
  return 'Write explanations, prompts, steps, and mistakes in English.';
}

async function realAsk(userPrompt, maxTokens) {
  if (!isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  const result = await askGemini(userPrompt, {
    provider: 'claude',
    noGeminiFallback: true,
    systemInstruction: SYSTEM,
    temperature: 0.4,
    maxOutputTokens: maxTokens || 8000,
    responseMimeType: 'application/json',
    model: claudeModel()
  });
  const text = (result && (result.answer || result.text)) || result;
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('AI returned invalid JSON.');
    err.statusCode = 502;
    throw err;
  }
  return parsed;
}

async function askJson(userPrompt, maxTokens) {
  const fn = askOverride || realAsk;
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn(userPrompt, maxTokens);
    } catch (e) {
      last = e;
      if (e.statusCode === 503) throw e;
    }
  }
  throw last;
}

function setAskForTests(fn) { askOverride = fn; }

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = new Date().toISOString();
}

function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const list = Array.from(jobs.values()).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  while (jobs.size > MAX_JOBS && list.length) {
    const old = list.shift();
    if (old && old.status !== 'running') jobs.delete(old.id);
  }
}

async function ensureSchema() {
  if (!isOpsDbEnabled()) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await query(
        'CREATE TABLE IF NOT EXISTS ' + table('math_chapters') + ' (' +
        'id TEXT PRIMARY KEY, curriculum_id TEXT NOT NULL, sort_order INT NOT NULL DEFAULT 0, payload JSONB NOT NULL)'
      );
      await query(
        'CREATE TABLE IF NOT EXISTS ' + table('math_workbooks') + ' (' +
        'id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL DEFAULT \'\', chapter_id TEXT NOT NULL DEFAULT \'\',' +
        'title TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'running\',' +
        'progress JSONB, options JSONB, document JSONB, error TEXT,' +
        'created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
      );
      await query(
        'CREATE INDEX IF NOT EXISTS sm_math_workbooks_teacher_idx ON ' +
        table('math_workbooks') + ' (teacher_id, updated_at DESC)'
      );
      for (const chapter of listChapters()) {
        await query(
          'INSERT INTO ' + table('math_chapters') + ' (id, curriculum_id, sort_order, payload) VALUES ($1,$2,$3,$4::jsonb) ' +
          'ON CONFLICT (id) DO UPDATE SET curriculum_id = EXCLUDED.curriculum_id, sort_order = EXCLUDED.sort_order, payload = EXCLUDED.payload',
          [chapter.id, chapter.curriculumId, chapter.number, JSON.stringify(chapter)]
        );
      }
    })().catch((e) => {
      schemaReady = null;
      console.warn('math workbook schema', e.message);
    });
  }
  await schemaReady;
}

async function persistJob(job) {
  if (!job || !isOpsDbEnabled()) return;
  try {
    await ensureSchema();
    await query(
      'INSERT INTO ' + table('math_workbooks') +
      ' (id, teacher_id, chapter_id, title, status, progress, options, document, error, created_at, updated_at) ' +
      'VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::timestamptz,$11::timestamptz) ' +
      'ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress = EXCLUDED.progress, ' +
      'options = EXCLUDED.options, document = EXCLUDED.document, error = EXCLUDED.error, title = EXCLUDED.title, ' +
      'updated_at = EXCLUDED.updated_at',
      [
        job.id,
        job.ownerKey || '',
        (job.chapter && job.chapter.id) || '',
        job.title || '',
        job.status || 'running',
        JSON.stringify(job.progress || null),
        JSON.stringify(job.options || null),
        JSON.stringify(job.document || null),
        job.error || null,
        job.createdAt,
        job.updatedAt
      ]
    );
  } catch (e) {
    console.warn('math workbook persist', job.id, e.message);
  }
}

function bucket(job) {
  return job.part || job.document;
}

function allQuestions(doc) {
  if (doc && Array.isArray(doc.parts) && doc.parts.length) {
    return doc.parts.reduce(function (acc, part) { return acc.concat(part.questions || []); }, []);
  }
  return (doc && doc.questions) || [];
}

function collectWarnings(doc) {
  const out = ((doc && doc.warnings) || []).slice();
  ((doc && doc.parts) || []).forEach(function (part) {
    const name = part.chapter && part.chapter.title;
    (part.warnings || []).forEach(function (w) { out.push(name ? name + ': ' + w : w); });
  });
  return out;
}

function statsOf(doc) {
  const questions = allQuestions(doc);
  const stats = { verified: 0, needsReview: 0, failed: 0, included: 0, total: questions.length };
  questions.forEach((q) => {
    const st = q.verification && q.verification.status;
    if (st === 'verified') stats.verified += 1;
    else if (st === 'failed') stats.failed += 1;
    else stats.needsReview += 1;
    if (st !== 'failed') stats.included += 1;
  });
  return stats;
}

function publicJob(job) {
  if (!job) return null;
  const doc = job.document || {};
  return {
    id: job.id,
    status: job.status,
    progress: job.progress || null,
    error: job.error || null,
    title: job.title,
    chapter: job.chapter || null,
    chapters: job.chapters || (job.chapter ? [job.chapter] : []),
    options: job.options || null,
    warnings: collectWarnings(doc),
    stagesDone: doc.stagesDone || [],
    introduction: doc.introduction || '',
    objectives: doc.objectives || [],
    concepts: doc.concepts || [],
    definitions: doc.definitions || [],
    rules: doc.rules || [],
    examples: doc.examples || [],
    questions: allQuestions(doc),
    parts: (doc.parts || []).map((part) => ({
      chapter: part.chapter || null,
      introduction: part.introduction || '',
      concepts: part.concepts || []
    })),
    stats: statsOf(doc),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function summaryJob(job) {
  const pub = publicJob(job);
  return {
    id: pub.id,
    status: pub.status,
    title: pub.title,
    chapter: pub.chapter,
    stats: pub.stats,
    progress: pub.progress,
    error: pub.error,
    createdAt: pub.createdAt,
    updatedAt: pub.updatedAt
  };
}

function strList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter(Boolean).slice(0, limit || 8);
}

function cleanTeach(parsed, chapter) {
  const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const definitions = Array.isArray(parsed.definitions) ? parsed.definitions : [];
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  const examples = Array.isArray(parsed.examples) ? parsed.examples : [];
  return {
    introduction: String(parsed.introduction || '').trim().slice(0, 2000),
    concepts: concepts.slice(0, 6).map((c) => ({
      title: String(c.title || '').trim().slice(0, 160),
      body: String(c.body || c.explanation || '').trim().slice(0, 1200)
    })).filter((c) => c.title && c.body),
    definitions: definitions.slice(0, 10).map((d) => ({
      term: String(d.term || '').trim().slice(0, 120),
      meaning: String(d.meaning || d.definition || '').trim().slice(0, 500)
    })).filter((d) => d.term && d.meaning),
    rules: rules.slice(0, 8).map((r) => ({
      name: String(r.name || '').trim().slice(0, 160),
      formula: String(r.formula || '').trim().slice(0, 400),
      note: String(r.note || '').trim().slice(0, 400)
    })).filter((r) => r.name && r.formula),
    examples: examples.slice(0, 6).map((ex) => ({
      prompt: String(ex.prompt || '').trim().slice(0, 800),
      steps: strList(ex.steps, 8),
      answer: String(ex.answer || '').trim().slice(0, 200),
      expression: String(ex.expression || '').trim().slice(0, 200)
    })).filter((ex) => ex.prompt && ex.answer),
    objectiveIds: (chapter.objectives || []).map((o) => o.id)
  };
}

function cleanQuestion(raw, section, chapter) {
  const ids = new Set((chapter.objectives || []).map((o) => o.id));
  const objectiveId = ids.has(raw.objectiveId) ? raw.objectiveId : (chapter.objectives[0] && chapter.objectives[0].id) || '';
  const prompt = String(raw.prompt || raw.question || '').trim().slice(0, 900);
  const answer = String(raw.answer || '').trim().slice(0, 200);
  if (!prompt || !answer) return null;
  return {
    id: newId('mq'),
    section: section,
    chapterId: chapter.id,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    objectiveId: objectiveId,
    type: String(raw.type || 'computation').slice(0, 40),
    prompt: prompt,
    hint: String(raw.hint || '').trim().slice(0, 300),
    expression: String(raw.expression || raw.equation || '').trim().slice(0, 240),
    answer: answer,
    steps: strList(raw.steps, 8),
    mistakes: strList(raw.mistakes || raw.commonMistakes, 4)
  };
}

function chapterBrief(chapter) {
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    unitTitle: chapter.unitTitle,
    description: chapter.description,
    checkMode: chapter.checkMode,
    prerequisites: chapter.prerequisites,
    objectives: chapter.objectives
  };
}

function checkModeNote(mode) {
  if (mode === 'equation') return 'Every practice item is a one-variable linear equation. expression must contain = and the variable x.';
  if (mode === 'expression') {
    return 'Evaluate items use a fully numeric expression after the value is substituted, and a numeric answer. Simplify items use x in the expression, and the answer is the simplified form such as 5x+3, 2x, or 7.';
  }
  if (mode === 'pair') return 'Every item is an ordered pair. expression is two numeric parts separated by a comma, such as "2+1, 5-2". The answer is "3, 3".';
  if (mode === 'mixed') return 'Use a comma pair for a point, sqrt(n) for a perfect-square root, or a numeric or linear expression. Omit expression only for a diagram-only item.';
  return 'Every practice item needs a numeric expression with no variables. A perfect-square root is sqrt(25). For a circle, write 3.14 for pi.';
}

async function stageOutline(job) {
  const doc = bucket(job);
  const chapter = job.chapter;
  const parsed = await askJson([
    'Design the teaching sequence for this chapter. Do not write the practice set yet.',
    languageNote(job.options.language),
    levelNote(job.options.level),
    JSON.stringify(chapterBrief(chapter)),
    'Return JSON: {"introduction":"","lessons":[{"title":"","objectiveIds":[],"beats":[]}]}',
    'introduction is 2 to 4 sentences. lessons has 3 to 5 items. beats are short teaching moves.'
  ].join('\n\n'), 2500);
  const lessons = Array.isArray(parsed.lessons) ? parsed.lessons.slice(0, 6) : [];
  doc.introduction = String(parsed.introduction || '').trim().slice(0, 2000);
  doc.lessons = lessons.map((lesson) => ({
    title: String(lesson.title || '').trim().slice(0, 160),
    objectiveIds: strList(lesson.objectiveIds, 6),
    beats: strList(lesson.beats, 6)
  })).filter((lesson) => lesson.title);
  doc.stagesDone = ['outline'];
}

async function stageTeach(job) {
  const doc = bucket(job);
  const parsed = await askJson([
    'Write the instructional pages for this chapter.',
    languageNote(job.options.language),
    levelNote(job.options.level),
    'Chapter: ' + JSON.stringify(chapterBrief(job.chapter)),
    'Sequence: ' + JSON.stringify(doc.lessons || []),
    'Return JSON with introduction, concepts (3 to 5), definitions (4 to 8), rules (3 to 6), examples (' + job.options.examples + ').',
    'Each example has prompt, steps (array of why-this-step strings), answer, and expression when the answer is numeric.',
    'Schema: {"introduction":"","concepts":[{"title":"","body":""}],"definitions":[{"term":"","meaning":""}],"rules":[{"name":"","formula":"","note":""}],"examples":[{"prompt":"","steps":[],"answer":"","expression":""}]}'
  ].join('\n\n'), 7000);
  const teach = cleanTeach(parsed, job.chapter);
  if (!teach.concepts.length || !teach.examples.length) {
    const err = new Error('수업 본문이 비어 있습니다. 다시 생성해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  doc.introduction = teach.introduction || doc.introduction;
  doc.concepts = teach.concepts;
  doc.definitions = teach.definitions;
  doc.rules = teach.rules;
  doc.examples = teach.examples.map((ex) => {
    const verification = ex.expression ? verifyQuestion(ex) : { status: 'needs_review', reason: 'example' };
    if (verification.status === 'failed') return null;
    return {
      prompt: ex.prompt,
      steps: ex.steps,
      answer: ex.answer,
      verification: verification
    };
  }).filter(Boolean);
  if (!doc.examples.length) {
    const err = new Error('예제 검산을 통과한 항목이 없습니다. 다시 생성해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  doc.stagesDone = ['outline', 'teach'];
}

async function fetchBatch(job, section, need, already) {
  const parsed = await askJson([
    'Write ' + need + ' ' + section + ' practice questions for this chapter.',
    languageNote(job.options.language),
    levelNote(job.options.level),
    checkModeNote(job.chapter.checkMode),
    'Chapter: ' + JSON.stringify(chapterBrief(job.chapter)),
    'Rules already taught: ' + JSON.stringify((bucket(job).rules || []).map((r) => r.name)),
    already.length ? ('Do not repeat these stems: ' + JSON.stringify(already.slice(-12))) : '',
    'Each question: section "' + section + '", objectiveId, type, prompt, expression, answer, steps (2 or more), mistakes (1 or 2).',
    section === 'guided' ? 'Include a short hint.' : 'Leave hint empty.',
    'Return {"questions":[...]} with exactly ' + need + ' questions.'
  ].filter(Boolean).join('\n\n'), 7000);
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  return rows.map((row) => cleanQuestion(row, section, job.chapter)).filter(Boolean);
}

async function stagePractice(job) {
  const doc = bucket(job);
  const done = new Set(doc.sectionsDone || []);
  const seen = new Set((doc.questions || []).map((q) => q.prompt.toLowerCase()));
  for (const section of SECTION_ORDER) {
    if (job.status === 'cancelled') return;
    const need = job.options.counts[section] || 0;
    if (!need || done.has(section)) continue;
    touch(job, {
      progress: {
        message: (job.chapter.title || '') + ' · ' + section + ' 문항 생성 중…',
        pct: Math.min(96, (job._pctBase || 30) + done.size * 4),
        section: section
      }
    });
    await persistJob(job);
    let got = [];
    let guard = 0;
    while (got.length < need && guard < 4) {
      guard += 1;
      const batchNeed = Math.min(BATCH, need - got.length);
      const rows = await fetchBatch(job, section, batchNeed, Array.from(seen));
      if (job.status === 'cancelled') return;
      rows.forEach((row) => {
        const key = row.prompt.toLowerCase();
        if (seen.has(key) || got.length >= need) return;
        seen.add(key);
        got.push(row);
      });
    }
    if (got.length < need) {
      doc.warnings = doc.warnings || [];
      doc.warnings.push(section + ' 문항이 ' + got.length + '/' + need + '개입니다.');
    }
    doc.questions = (doc.questions || []).concat(got);
    doc.sectionsDone = (doc.sectionsDone || []).concat([section]);
    done.add(section);
    await persistJob(job);
  }
  doc.stagesDone = ['outline', 'teach', 'practice'];
}

function stageVerify(job) {
  const doc = bucket(job);
  const objectives = new Set();
  doc.warnings = (doc.warnings || []).filter((w) => !String(w).startsWith('학습목표'));
  doc.questions = (doc.questions || []).map((q) => {
    const verification = verifyQuestion(q);
    if (q.objectiveId) objectives.add(q.objectiveId);
    return Object.assign({}, q, { verification: verification });
  });
  (job.chapter.objectives || []).forEach((o) => {
    if (!objectives.has(o.id)) {
      doc.warnings = doc.warnings || [];
      doc.warnings.push('학습목표에 문항이 없습니다: ' + o.text);
    }
  });
  doc.stagesDone = ['outline', 'teach', 'practice', 'verify'];
}

async function processJob(job) {
  if (job._running) return;
  job._running = true;
  try {
    const chapters = job.chapters && job.chapters.length ? job.chapters : [job.chapter];
    for (let i = 0; i < chapters.length; i++) {
      if (job.status === 'cancelled') return;
      const chapter = chapters[i];
      job.chapter = chapter;
      job.part = ensurePart(job, chapter);
      job._pctBase = Math.round((i / chapters.length) * 90);
      const done = new Set(job.part.stagesDone || []);
      const label = '챕터 ' + (i + 1) + '/' + chapters.length + ' · ' + chapter.title;
      if (!done.has('outline')) {
        touch(job, { status: 'running', progress: { message: label + ' · 구성 요청…', pct: job._pctBase + 4, chapterIndex: i + 1, chapterCount: chapters.length } });
        await persistJob(job);
        await stageOutline(job);
        if (job.status === 'cancelled') return;
        await persistJob(job);
      }
      if (!(job.part.stagesDone || []).includes('teach')) {
        touch(job, { progress: { message: label + ' 설명과 예제…', pct: job._pctBase + 12 } });
        await persistJob(job);
        await stageTeach(job);
        if (job.status === 'cancelled') return;
        await persistJob(job);
      }
      if (!(job.part.stagesDone || []).includes('practice')) {
        await stagePractice(job);
        if (job.status === 'cancelled') return;
      }
      if (!(job.part.stagesDone || []).includes('verify')) {
        touch(job, { progress: { message: label + ' 검산 중…', pct: job._pctBase + 20 } });
        stageVerify(job);
        await persistJob(job);
      }
    }
    job.part = null;
    const included = statsOf(job.document).included;
    if (!included) {
      const err = new Error('검산을 통과한 문항이 없습니다. 다시 생성해 주세요.');
      err.statusCode = 502;
      throw err;
    }
    touch(job, { status: 'done', error: null, progress: { message: '완료', pct: 100 } });
    await persistJob(job);
  } catch (e) {
    if (job.status === 'cancelled') return;
    touch(job, {
      status: 'error',
      error: e.message || '워크북 생성에 실패했습니다.',
      progress: { message: '실패', pct: 100 }
    });
    await persistJob(job);
  } finally {
    job._running = false;
    job.part = null;
  }
}

function chapterSummary(chapter) {
  return {
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    unitTitle: chapter.unitTitle,
    curriculumTitle: chapter.curriculumTitle
  };
}

function ensurePart(job, chapter) {
  if (!Array.isArray(job.document.parts)) job.document.parts = [];
  let part = job.document.parts.find((p) => p.chapter && p.chapter.id === chapter.id);
  if (!part) {
    part = {
      chapter: chapterSummary(chapter),
      objectives: chapter.objectives || [],
      introduction: '',
      lessons: [],
      concepts: [],
      definitions: [],
      rules: [],
      examples: [],
      questions: [],
      warnings: [],
      sectionsDone: [],
      stagesDone: []
    };
    job.document.parts.push(part);
  }
  return part;
}

function blankDocument(chapters, options) {
  const first = chapters[0];
  return {
    title: options.title,
    language: options.language,
    level: options.level,
    chapter: chapterSummary(first),
    chapters: chapters.map(chapterSummary),
    parts: [],
    warnings: []
  };
}

function defaultTitle(chapters) {
  const series = (chapters[0] && chapters[0].curriculumTitle) || 'Workbook';
  if (chapters.length === 1) return chapters[0].title + ' Workbook';
  const all = listChapters().filter((c) => c.curriculumId === chapters[0].curriculumId);
  if (chapters.length === all.length) return series + ' Workbook';
  const nums = chapters.map((c) => c.number);
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (contiguous) return series + ' Chapters ' + nums[0] + '–' + nums[nums.length - 1];
  return series + ' Chapters ' + nums.join(', ');
}

function resolveChapters(body) {
  const src = body || {};
  let ids = [];
  if (Array.isArray(src.chapterIds) && src.chapterIds.length) ids = src.chapterIds.map(String);
  else if (src.chapterId) ids = [String(src.chapterId)];
  ids = Array.from(new Set(ids.filter(Boolean)));
  if (!ids.length) {
    const err = new Error('챕터를 하나 이상 선택해 주세요.');
    err.statusCode = 400;
    throw err;
  }
  const chapters = ids.map(getChapter).filter(Boolean);
  if (chapters.length !== ids.length) {
    const err = new Error('고른 챕터를 찾지 못했습니다.');
    err.statusCode = 400;
    throw err;
  }
  const levelId = chapters[0].curriculumId;
  if (chapters.some((c) => c.curriculumId !== levelId)) {
    const err = new Error('한 권에는 같은 수학 레벨의 챕터만 넣을 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  chapters.sort((a, b) => a.number - b.number);
  return chapters;
}

function runningMatch(ownerKey, chapterKey) {
  for (const job of jobs.values()) {
    if (job.ownerKey === ownerKey && job.chapterKey === chapterKey && job.status === 'running') return job;
  }
  return null;
}

function startGenerateJob(body, ownerKey) {
  const chapters = resolveChapters(body);
  const titled = Object.assign({}, body || {}, {
    title: String((body && body.title) || '').trim() || defaultTitle(chapters)
  });
  const options = normalizeOptions(titled, chapters[0]);
  options.chapterIds = chapters.map((c) => c.id);
  const chapterKey = options.chapterIds.join(',');
  const existing = runningMatch(String(ownerKey || ''), chapterKey);
  if (existing) {
    return { jobId: existing.id, status: existing.status, progress: existing.progress, reused: true };
  }
  pruneJobs();
  const now = new Date().toISOString();
  const job = {
    id: newId('mw'),
    ownerKey: String(ownerKey || ''),
    status: 'running',
    createdAt: now,
    updatedAt: now,
    title: options.title,
    chapter: chapters[0],
    chapters: chapters,
    chapterKey: chapterKey,
    options: options,
    progress: { message: '준비 중…', pct: 4 },
    error: null,
    document: blankDocument(chapters, options)
  };
  jobs.set(job.id, job);
  void persistJob(job);
  setImmediate(() => { void processJob(job); });
  return { jobId: job.id, status: job.status, progress: job.progress };
}

function jobFromRow(row) {
  if (!row) return null;
  const doc = row.document || {};
  const ids = (row.options && row.options.chapterIds) ||
    (doc.chapters || []).map((c) => c.id).filter(Boolean);
  const chapters = (ids.length ? ids : [row.chapter_id]).map(getChapter).filter(Boolean);
  const chapter = chapters[0] || getChapter(row.chapter_id) ||
    (doc.chapter ? Object.assign({ objectives: doc.objectives || [] }, doc.chapter) : null);
  return {
    id: row.id,
    ownerKey: row.teacher_id || '',
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    title: row.title || doc.title || '',
    chapter: chapter,
    chapters: chapters.length ? chapters : (chapter ? [chapter] : []),
    chapterKey: (chapters.length ? chapters : (chapter ? [chapter] : [])).map((c) => c.id).join(','),
    options: row.options || null,
    progress: row.progress || null,
    error: row.error || null,
    document: doc
  };
}

async function loadJob(id) {
  if (jobs.has(id)) return jobs.get(id);
  if (!isOpsDbEnabled()) return null;
  try {
    await ensureSchema();
    const r = await query('SELECT * FROM ' + table('math_workbooks') + ' WHERE id = $1', [id]);
    const job = jobFromRow(r.rows[0]);
    if (!job) return null;
    if (job.status === 'running') {
      job.status = 'interrupted';
      job.error = '생성이 중간에 멈췄습니다. 이어할 수 있습니다.';
      jobs.set(job.id, job);
      await persistJob(job);
    } else {
      jobs.set(job.id, job);
    }
    return job;
  } catch (e) {
    console.warn('math workbook load', e.message);
    return null;
  }
}

async function getJob(id, ownerKey) {
  const job = await loadJob(String(id || ''));
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== ownerKey) return null;
  return job;
}

function resumeJob(id, ownerKey) {
  const job = jobs.get(String(id || ''));
  if (!job || (ownerKey && job.ownerKey && job.ownerKey !== ownerKey)) return null;
  if (job.status === 'running') return { jobId: job.id, status: job.status, progress: job.progress };
  if (job.status !== 'interrupted' && job.status !== 'error') {
    const err = new Error('이 워크북은 이어할 상태가 아닙니다.');
    err.statusCode = 400;
    throw err;
  }
  touch(job, { status: 'running', error: null, progress: { message: '이어서 생성 중…', pct: job.progress && job.progress.pct || 20 } });
  setImmediate(() => { void processJob(job); });
  return { jobId: job.id, status: job.status, progress: job.progress };
}

function cancelJob(id, ownerKey) {
  const job = jobs.get(String(id || ''));
  if (!job || (ownerKey && job.ownerKey && job.ownerKey !== ownerKey)) return null;
  if (job.status === 'running') {
    touch(job, { status: 'cancelled', progress: { message: '취소됨', pct: job.progress && job.progress.pct || 0 } });
    void persistJob(job);
  }
  return publicJob(job);
}

function updateJob(id, ownerKey, body) {
  const job = jobs.get(String(id || ''));
  if (!job || (ownerKey && job.ownerKey && job.ownerKey !== ownerKey)) return null;
  if (job.status === 'running') {
    const err = new Error('생성이 끝난 뒤에 고칠 수 있습니다.');
    err.statusCode = 409;
    throw err;
  }
  const remove = new Set(Array.isArray(body.removeQuestionIds) ? body.removeQuestionIds.map(String) : []);
  const edits = {};
  (Array.isArray(body.edits) ? body.edits : []).forEach((edit) => {
    if (edit && edit.id) edits[String(edit.id)] = String(edit.prompt || '').trim().slice(0, 900);
  });
  const mapQuestions = (list) => (list || []).filter((q) => !remove.has(q.id)).map((q) => {
    if (!edits[q.id]) return q;
    return Object.assign({}, q, { prompt: edits[q.id] || q.prompt });
  });
  if (job.document.parts && job.document.parts.length) {
    job.document.parts.forEach((part) => { part.questions = mapQuestions(part.questions); });
  } else {
    job.document.questions = mapQuestions(job.document.questions);
  }
  touch(job, { updatedAt: new Date().toISOString() });
  void persistJob(job);
  return publicJob(job);
}

async function listWorkbooks(ownerKey) {
  const mine = [];
  jobs.forEach((job) => {
    if (!ownerKey || job.ownerKey === ownerKey) mine.push(summaryJob(job));
  });
  if (isOpsDbEnabled()) {
    try {
      await ensureSchema();
      const r = await query(
        'SELECT * FROM ' + table('math_workbooks') + ' WHERE teacher_id = $1 ORDER BY updated_at DESC LIMIT 30',
        [ownerKey || '']
      );
      r.rows.forEach((row) => {
        if (mine.some((item) => item.id === row.id)) return;
        const job = jobFromRow(row);
        if (job) mine.push(summaryJob(job));
      });
    } catch (e) {
      console.warn('math workbook list', e.message);
    }
  }
  mine.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return mine.slice(0, 30);
}

async function renderPdf(html) {
  let chromium;
  let puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    const err = new Error('PDF 엔진이 없습니다. HTML을 저장한 뒤 브라우저에서 인쇄해 주세요.');
    err.statusCode = 503;
    throw err;
  }
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 794, height: 1123 },
    executablePath: executablePath,
    headless: chromium.headless
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  listChapters,
  listCurricula,
  normalizeOptions,
  startGenerateJob,
  getJob,
  publicJob,
  resumeJob,
  cancelJob,
  updateJob,
  listWorkbooks,
  renderWorkbookHtml,
  renderPdf,
  processJob,
  setAskForTests,
  verifyQuestion,
  DEFAULT_COUNTS
};
