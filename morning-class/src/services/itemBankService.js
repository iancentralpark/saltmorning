/**
 * AI Item Bank & Test Paper Generator (Class Tools)
 * Persists questions/exams in Google Sheets; generation via Gemini.
 */
'use strict';

const crypto = require('crypto');
const { ITEM_BANK_SHEET, EXAM_PAPERS_SHEET } = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');
const { askGemini, isGeminiConfigured, formatGeminiClientError } = require('./geminiService');

const ITEM_HEADERS = [
  'QuestionID', 'TeacherID', 'Subject', 'Chapter', 'Topic', 'Difficulty', 'Type',
  'Passage', 'QuestionText', 'ImageUrl', 'OptionsJSON', 'CorrectAnswer',
  'Explanation', 'HashtagsJSON', 'CreatedAt', 'UpdatedAt'
];

const EXAM_HEADERS = [
  'ExamID', 'TeacherID', 'Title', 'HeaderJSON', 'QuestionsJSON', 'CreatedAt', 'UpdatedAt'
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const TYPES = ['Multiple Choice', 'Short Answer', 'Essay'];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function geminiModel() {
  return process.env.TEACHER_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
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

function normalizeHashtags(raw) {
  let tags = raw;
  if (typeof raw === 'string') {
    try { tags = JSON.parse(raw); } catch (e) {
      tags = String(raw).split(/[,\s]+/);
    }
  }
  if (!Array.isArray(tags)) tags = [];
  return tags
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : '#' + t.replace(/^#+/, '')))
    .slice(0, 12);
}

function normalizeDifficulty(raw) {
  const s = String(raw || '').trim();
  const hit = DIFFICULTIES.find((d) => d.toLowerCase() === s.toLowerCase());
  return hit || 'Medium';
}

function normalizeType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('multiple') || s === 'mcq' || s === 'mc') return 'Multiple Choice';
  if (s.includes('essay') || s.includes('long')) return 'Essay';
  if (s.includes('short')) return 'Short Answer';
  const hit = TYPES.find((t) => t.toLowerCase() === s);
  return hit || 'Multiple Choice';
}

function coerceQuestion(raw, teacherId, opts) {
  opts = opts || {};
  const options = Array.isArray(raw.options)
    ? raw.options.map((o) => String(o || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const type = normalizeType(raw.type);
  return {
    id: String(raw.id || opts.id || newId('q')),
    teacherId: String(raw.teacherId || teacherId || ''),
    subject: String(raw.subject || opts.subject || '').trim() || 'General',
    chapter: String(raw.chapter || opts.chapter || '').trim(),
    topic: String(raw.topic || opts.topic || '').trim(),
    difficulty: normalizeDifficulty(raw.difficulty || opts.difficulty),
    type,
    passage: String(raw.passage || '').trim(),
    questionText: String(raw.questionText || raw.question || '').trim(),
    imageUrl: String(raw.imageUrl || '').trim(),
    options: type === 'Multiple Choice' ? (options.length ? options : ['A', 'B', 'C', 'D']) : options,
    correctAnswer: String(raw.correctAnswer || raw.answer || '').trim(),
    explanation: String(raw.explanation || raw.solution || '').trim(),
    hashtags: normalizeHashtags(raw.hashtags || raw.tags || []),
    createdAt: String(raw.createdAt || opts.createdAt || isoNow()),
    updatedAt: String(raw.updatedAt || isoNow())
  };
}

function questionToRow(q) {
  return [
    q.id,
    q.teacherId,
    q.subject,
    q.chapter,
    q.topic,
    q.difficulty,
    q.type,
    q.passage,
    q.questionText,
    q.imageUrl,
    JSON.stringify(q.options || []),
    q.correctAnswer,
    q.explanation,
    JSON.stringify(q.hashtags || []),
    q.createdAt,
    q.updatedAt
  ];
}

function rowToQuestion(row) {
  if (!row || !row[0]) return null;
  let options = [];
  let hashtags = [];
  try { options = JSON.parse(row[10] || '[]'); } catch (e) { options = []; }
  try { hashtags = JSON.parse(row[13] || '[]'); } catch (e) { hashtags = []; }
  return coerceQuestion({
    id: row[0],
    teacherId: row[1],
    subject: row[2],
    chapter: row[3],
    topic: row[4],
    difficulty: row[5],
    type: row[6],
    passage: row[7],
    questionText: row[8],
    imageUrl: row[9],
    options,
    correctAnswer: row[11],
    explanation: row[12],
    hashtags,
    createdAt: row[14],
    updatedAt: row[15]
  }, row[1]);
}

function defaultHeader(partial) {
  const p = partial || {};
  return {
    schoolName: String(p.schoolName || 'Salt Academy').trim() || 'Salt Academy',
    academicYear: String(p.academicYear || '2026-2027').trim() || '2026-2027',
    term: String(p.term || 'Fall').trim() || 'Fall',
    examType: String(p.examType || 'Final Exam').trim() || 'Final Exam',
    customTitle: String(p.customTitle || '').trim()
  };
}

function headerTitle(header) {
  const h = defaultHeader(header);
  if (h.examType === 'Custom' && h.customTitle) return h.customTitle;
  return h.academicYear + ' ' + h.term + ' ' + h.schoolName + ' ' + h.examType;
}

async function ensureItemBankSheets() {
  await ensureSheet(ITEM_BANK_SHEET, ITEM_HEADERS);
  await ensureSheet(EXAM_PAPERS_SHEET, EXAM_HEADERS);
}

async function listItems(teacherId, filters) {
  await ensureItemBankSheets();
  filters = filters || {};
  const rows = await getSheetRows(ITEM_BANK_SHEET);
  const q = String(filters.q || '').trim().toLowerCase();
  const subject = String(filters.subject || '').trim().toLowerCase();
  const difficulty = String(filters.difficulty || '').trim().toLowerCase();
  const tag = String(filters.tag || '').trim().toLowerCase().replace(/^#/, '');
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(teacherId)) continue;
    const item = rowToQuestion(rows[i]);
    if (!item || !item.questionText) continue;
    if (subject && item.subject.toLowerCase() !== subject) continue;
    if (difficulty && item.difficulty.toLowerCase() !== difficulty) continue;
    if (tag) {
      const tags = (item.hashtags || []).map((t) => t.toLowerCase().replace(/^#/, ''));
      if (!tags.some((t) => t.includes(tag))) continue;
    }
    if (q) {
      const hay = [
        item.subject, item.chapter, item.topic, item.questionText, item.passage,
        item.correctAnswer, (item.hashtags || []).join(' ')
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(item);
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

async function saveItem(teacherId, payload) {
  await ensureItemBankSheets();
  teacherId = String(teacherId);
  let item = coerceQuestion(payload || {}, teacherId);
  if (!item.questionText) throw new Error('Question text is required.');

  if (!item.hashtags.length) {
    try {
      item.hashtags = await autoTagQuestion(item);
    } catch (e) {
      item.hashtags = [
        '#' + item.subject.replace(/\s+/g, ''),
        item.difficulty ? '#' + item.difficulty : ''
      ].filter(Boolean);
    }
  }

  const rows = await getSheetRows(ITEM_BANK_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === item.id) {
      if (String(rows[i][1]) !== teacherId) throw new Error('Not allowed to edit this question.');
      found = i + 1;
      item.createdAt = String(rows[i][14] || item.createdAt);
      break;
    }
  }
  item.teacherId = teacherId;
  item.updatedAt = isoNow();
  const row = questionToRow(item);
  if (found > 0) {
    await updateRange(ITEM_BANK_SHEET, `A${found}:P${found}`, [row]);
  } else {
    if (!item.createdAt) item.createdAt = isoNow();
    row[14] = item.createdAt;
    await appendRows(ITEM_BANK_SHEET, [row]);
  }
  invalidateSheetRowsCache(ITEM_BANK_SHEET);
  return item;
}

async function deleteItem(teacherId, questionId) {
  await ensureItemBankSheets();
  const rows = await getSheetRows(ITEM_BANK_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(questionId)) continue;
    if (String(rows[i][1]) !== String(teacherId)) throw new Error('Not allowed to delete this question.');
    found = i + 1;
    break;
  }
  if (found < 0) throw new Error('Question not found.');
  await updateRange(ITEM_BANK_SHEET, `A${found}:P${found}`, [new Array(16).fill('')]);
  invalidateSheetRowsCache(ITEM_BANK_SHEET);
  return { deleted: true, id: questionId };
}

async function autoTagQuestion(item) {
  if (!isGeminiConfigured()) {
    return ['#' + String(item.subject || 'General').replace(/\s+/g, '')];
  }
  const prompt = `Generate 3-6 educational hashtags for this question. Return ONLY a JSON array of strings like ["#Algebra","#Grade5"].
Subject: ${item.subject}
Chapter: ${item.chapter}
Topic: ${item.topic}
Difficulty: ${item.difficulty}
Type: ${item.type}
Question: ${item.questionText}
Passage: ${item.passage || '(none)'}`;
  const res = await askGemini(prompt, {
    model: geminiModel(),
    temperature: 0.3,
    maxOutputTokens: 256
  });
  const parsed = extractJson(res.text || res.answer || '');
  return normalizeHashtags(parsed);
}

function buildGeneratePrompt(opts) {
  const count = Math.max(1, Math.min(10, Number(opts.count) || 3));
  return `You are an expert EdTech assessment writer for Salt Academy.
Generate ${count} high-quality exam questions as JSON.

Return ONLY valid JSON with this shape:
{
  "questions": [
    {
      "subject": "...",
      "chapter": "...",
      "topic": "...",
      "difficulty": "Easy|Medium|Hard",
      "type": "Multiple Choice|Short Answer|Essay",
      "passage": "optional context/passage or empty string",
      "questionText": "question stem; LaTeX math OK as $...$ or $$...$$",
      "options": ["choice A","choice B","choice C","choice D"],
      "correctAnswer": "exact correct answer text or letter+text",
      "explanation": "step-by-step solution for teachers",
      "hashtags": ["#Tag1","#Tag2"]
    }
  ]
}

Rules:
- Subject: ${opts.subject || 'General'}
- Chapter: ${opts.chapter || 'General'}
- Topic: ${opts.topic || 'General'}
- Preferred type: ${opts.type || 'Multiple Choice'}
- Preferred difficulty: ${opts.difficulty || 'Medium'}
- For Multiple Choice include exactly 4 options; put the full correct choice text in correctAnswer.
- For Short Answer / Essay, options may be [].
- Age-appropriate for school students. Clear, unambiguous wording.
- Include at least one math formula with LaTeX if the subject is Math.`;
}

async function generateQuestions(teacherId, opts) {
  if (!isGeminiConfigured()) {
    const err = new Error('GEMINI_API_KEY is not configured.');
    err.statusCode = 503;
    throw err;
  }
  opts = opts || {};
  const prompt = buildGeneratePrompt(opts);
  let res;
  try {
    res = await askGemini(prompt, {
      model: geminiModel(),
      temperature: 0.7,
      maxOutputTokens: 4096,
      systemInstruction: 'Return only JSON. No markdown commentary.'
    });
  } catch (e) {
    const err = new Error(formatGeminiClientError(e));
    err.statusCode = 502;
    throw err;
  }
  const parsed = extractJson(res.text || res.answer || '');
  const list = (parsed && Array.isArray(parsed.questions))
    ? parsed.questions
    : (Array.isArray(parsed) ? parsed : []);
  if (!list.length) throw new Error('AI returned no questions. Try again.');
  return list.map((q) => coerceQuestion(q, teacherId, {
    subject: opts.subject,
    chapter: opts.chapter,
    topic: opts.topic,
    difficulty: opts.difficulty,
    id: newId('sandbox')
  }));
}

async function generateSimilarQuestion(teacherId, source) {
  if (!isGeminiConfigured()) {
    const err = new Error('GEMINI_API_KEY is not configured.');
    err.statusCode = 503;
    throw err;
  }
  const base = coerceQuestion(source || {}, teacherId);
  const prompt = `Create ONE similar twin question with altered numbers/names/passages but the same skill.
Return ONLY JSON for a single question object with fields:
subject, chapter, topic, difficulty, type, passage, questionText, options, correctAnswer, explanation, hashtags.

Source question:
${JSON.stringify(base, null, 2)}`;
  let res;
  try {
    res = await askGemini(prompt, {
      model: geminiModel(),
      temperature: 0.85,
      maxOutputTokens: 2048,
      systemInstruction: 'Return only one JSON object.'
    });
  } catch (e) {
    const err = new Error(formatGeminiClientError(e));
    err.statusCode = 502;
    throw err;
  }
  const parsed = extractJson(res.text || res.answer || '');
  const raw = (parsed && parsed.questions && parsed.questions[0]) ? parsed.questions[0] : parsed;
  if (!raw || !(raw.questionText || raw.question)) {
    throw new Error('AI could not generate a similar question.');
  }
  return coerceQuestion(raw, teacherId, {
    subject: base.subject,
    chapter: base.chapter,
    topic: base.topic,
    difficulty: base.difficulty,
    id: newId('sandbox')
  });
}

function sortQuestions(questions, rule) {
  const list = (questions || []).map((q) => coerceQuestion(q, q.teacherId || ''));
  const mode = String(rule || 'easy-hard').toLowerCase();
  const diffRank = { Easy: 1, Medium: 2, Hard: 3 };
  const typeRank = { 'Multiple Choice': 1, 'Short Answer': 2, Essay: 3 };

  list.sort((a, b) => {
    if (mode === 'hard-easy') {
      return (diffRank[b.difficulty] || 2) - (diffRank[a.difficulty] || 2)
        || a.chapter.localeCompare(b.chapter)
        || a.topic.localeCompare(b.topic);
    }
    if (mode === 'chapter') {
      return a.chapter.localeCompare(b.chapter)
        || a.topic.localeCompare(b.topic)
        || (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2);
    }
    if (mode === 'type') {
      return (typeRank[a.type] || 9) - (typeRank[b.type] || 9)
        || (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2)
        || a.chapter.localeCompare(b.chapter);
    }
    // easy-hard default
    return (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2)
      || a.chapter.localeCompare(b.chapter)
      || a.topic.localeCompare(b.topic);
  });
  return list;
}

async function listExams(teacherId) {
  await ensureItemBankSheets();
  const rows = await getSheetRows(EXAM_PAPERS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(teacherId)) continue;
    if (!rows[i][0]) continue;
    let header = {};
    let questions = [];
    try { header = JSON.parse(rows[i][3] || '{}'); } catch (e) { header = {}; }
    try { questions = JSON.parse(rows[i][4] || '[]'); } catch (e) { questions = []; }
    out.push({
      id: String(rows[i][0]),
      teacherId: String(rows[i][1]),
      title: String(rows[i][2] || headerTitle(header)),
      header: defaultHeader(header),
      questions: Array.isArray(questions) ? questions.map((q) => coerceQuestion(q, teacherId)) : [],
      createdAt: String(rows[i][5] || ''),
      updatedAt: String(rows[i][6] || '')
    });
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

async function getExam(teacherId, examId) {
  const exams = await listExams(teacherId);
  const exam = exams.find((e) => e.id === String(examId));
  if (!exam) throw new Error('Exam not found.');
  return exam;
}

async function saveExam(teacherId, payload) {
  await ensureItemBankSheets();
  teacherId = String(teacherId);
  const header = defaultHeader(payload && payload.header);
  const questions = (payload && payload.questions ? payload.questions : [])
    .map((q) => coerceQuestion(q, teacherId));
  const id = String((payload && payload.id) || newId('exam'));
  const title = String((payload && payload.title) || headerTitle(header));
  const now = isoNow();

  const rows = await getSheetRows(EXAM_PAPERS_SHEET, { skipCache: true });
  let found = -1;
  let createdAt = now;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) {
      if (String(rows[i][1]) !== teacherId) throw new Error('Not allowed to edit this exam.');
      found = i + 1;
      createdAt = String(rows[i][5] || now);
      break;
    }
  }
  const row = [
    id,
    teacherId,
    title,
    JSON.stringify(header),
    JSON.stringify(questions),
    createdAt,
    now
  ];
  if (found > 0) {
    await updateRange(EXAM_PAPERS_SHEET, `A${found}:G${found}`, [row]);
  } else {
    await appendRows(EXAM_PAPERS_SHEET, [row]);
  }
  invalidateSheetRowsCache(EXAM_PAPERS_SHEET);
  return {
    id,
    teacherId,
    title,
    header,
    questions,
    createdAt,
    updatedAt: now
  };
}

async function deleteExam(teacherId, examId) {
  await ensureItemBankSheets();
  const rows = await getSheetRows(EXAM_PAPERS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(examId)) continue;
    if (String(rows[i][1]) !== String(teacherId)) throw new Error('Not allowed to delete this exam.');
    found = i + 1;
    break;
  }
  if (found < 0) throw new Error('Exam not found.');
  await updateRange(EXAM_PAPERS_SHEET, `A${found}:G${found}`, [new Array(7).fill('')]);
  invalidateSheetRowsCache(EXAM_PAPERS_SHEET);
  return { deleted: true, id: examId };
}

module.exports = {
  ensureItemBankSheets,
  listItems,
  saveItem,
  deleteItem,
  generateQuestions,
  generateSimilarQuestion,
  autoTagQuestion,
  sortQuestions,
  listExams,
  getExam,
  saveExam,
  deleteExam,
  defaultHeader,
  headerTitle,
  isGeminiConfigured
};
