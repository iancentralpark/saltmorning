/**
 * AI Jeopardy board generation (Gemini) for Class Tools.
 */
'use strict';

const { askGemini, isGeminiConfigured, teacherGeminiOptions } = require('./geminiService');

const POINTS = [100, 200, 300, 400, 500];
const CATEGORY_COUNT = 5;
const CELLS_PER_CATEGORY = 5;
const TEAM_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

function uid(prefix) {
  return String(prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizeDifficulty(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'elementary' || s === 'middle' || s === 'high') return s;
  if (s === 'high school' || s === 'highschool') return 'high';
  if (s === 'middle school' || s === 'middleschool') return 'middle';
  return 'elementary';
}

function normalizeLanguage(raw) {
  const s = String(raw || '').toLowerCase();
  return s === 'ko' || s === 'korean' || s === '한국어' ? 'ko' : 'en';
}

function blankCell(points) {
  return {
    id: uid('cell'),
    points: points,
    clue: '',
    answer: '',
    explanation: '',
    isRevealed: false
  };
}

function blankCategory(index) {
  return {
    id: uid('cat'),
    title: 'Category ' + (index + 1),
    cells: POINTS.map(blankCell)
  };
}

function blankBoard(opts) {
  opts = opts || {};
  const title = String(opts.title || opts.subject || 'Jeopardy').trim() || 'Jeopardy';
  const subject = String(opts.subject || title).trim();
  return {
    title: title,
    subject: subject,
    difficulty: normalizeDifficulty(opts.difficulty),
    language: normalizeLanguage(opts.language),
    categories: Array.from({ length: CATEGORY_COUNT }, function (_, i) {
      return blankCategory(i);
    }),
    teams: defaultTeams(opts.teamCount)
  };
}

function defaultTeams(count) {
  const n = Math.max(2, Math.min(6, Math.round(Number(count) || 3)));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: uid('team'),
      name: 'Team ' + (i + 1),
      score: 0,
      color: TEAM_COLORS[i % TEAM_COLORS.length]
    });
  }
  return out;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) { /* fall through */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (e2) { /* fall through */ }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (e3) { /* ignore */ }
  }
  return null;
}

function coerceBoard(parsed, opts) {
  const base = blankBoard(opts);
  if (!parsed || typeof parsed !== 'object') return base;

  if (parsed.title) base.title = String(parsed.title).trim().slice(0, 80) || base.title;
  if (parsed.subject) base.subject = String(parsed.subject).trim().slice(0, 120) || base.subject;

  const cats = Array.isArray(parsed.categories) ? parsed.categories : [];
  base.categories = base.categories.map(function (cat, i) {
    const src = cats[i] || {};
    const title = String(src.title || cat.title || ('Category ' + (i + 1))).trim().slice(0, 40);
    const cellsSrc = Array.isArray(src.cells) ? src.cells : [];
    const cells = POINTS.map(function (pts, j) {
      const c = cellsSrc[j] || {};
      const points = Number(c.points) || pts;
      return {
        id: uid('cell'),
        points: points,
        clue: String(c.clue || '').trim(),
        answer: String(c.answer || '').trim(),
        explanation: String(c.explanation || '').trim(),
        isRevealed: false
      };
    });
    return { id: uid('cat'), title: title || cat.title, cells: cells };
  });
  return base;
}

function buildPrompt(opts) {
  const subject = String(opts.subject || '').trim();
  const difficulty = normalizeDifficulty(opts.difficulty);
  const language = normalizeLanguage(opts.language);
  const langLabel = language === 'ko' ? 'Korean' : 'English';
  const diffLabel =
    difficulty === 'high' ? 'high school' : (difficulty === 'middle' ? 'middle school' : 'elementary school');

  return [
    'Create a classroom Jeopardy game board as JSON only (no markdown).',
    'Topic/subject: ' + subject,
    'Audience difficulty: ' + diffLabel,
    'Language for ALL category titles, clues, answers, and explanations: ' + langLabel + '.',
    'Exactly 5 categories. Each category has exactly 5 cells with points 100,200,300,400,500 (harder as points rise).',
    'Jeopardy style: clue is the statement shown on the board; answer should be a response like "What is …?" / "Who is …?" (or Korean equivalent).',
    'Keep clues concise for TV/smartboard reading (max ~20 words). Explanations short for the teacher.',
    'Schema:',
    '{',
    '  "title": string,',
    '  "subject": string,',
    '  "categories": [',
    '    { "title": string, "cells": [',
    '      { "points": 100, "clue": string, "answer": string, "explanation": string },',
    '      { "points": 200, "clue": string, "answer": string, "explanation": string },',
    '      { "points": 300, "clue": string, "answer": string, "explanation": string },',
    '      { "points": 400, "clue": string, "answer": string, "explanation": string },',
    '      { "points": 500, "clue": string, "answer": string, "explanation": string }',
    '    ]}',
    '  ]',
    '}',
    'Return ONLY valid JSON matching that schema.'
  ].join('\n');
}

async function generateJeopardyBoard(opts) {
  opts = opts || {};
  const subject = String(opts.subject || '').trim();
  if (!subject) {
    const err = new Error('Subject / topic is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!isGeminiConfigured()) {
    const err = new Error('Gemini is not configured on the server.');
    err.statusCode = 503;
    throw err;
  }

  const options = Object.assign({}, teacherGeminiOptions(), {
    maxOutputTokens: 8192,
    timeoutMs: 90000,
    temperature: 0.55,
    systemInstruction:
      'You generate classroom Jeopardy quiz boards for teachers. ' +
      'Output must be a single valid JSON object only — no markdown fences, no commentary.'
  });

  const result = await askGemini(buildPrompt(opts), [], options);
  if (!result || !result.ok) {
    const err = new Error((result && result.error) || 'AI generation failed.');
    err.statusCode = 502;
    throw err;
  }

  const parsed = extractJson(result.answer);
  if (!parsed) {
    const err = new Error('AI returned invalid JSON. Please try again.');
    err.statusCode = 502;
    throw err;
  }

  const board = coerceBoard(parsed, opts);
  board.teams = defaultTeams(opts.teamCount);
  board.meta = {
    model: result.model || null,
    generatedAt: new Date().toISOString()
  };
  return board;
}

function createBlankJeopardyBoard(opts) {
  return blankBoard(opts || {});
}

module.exports = {
  POINTS,
  CATEGORY_COUNT,
  CELLS_PER_CATEGORY,
  TEAM_COLORS,
  generateJeopardyBoard,
  createBlankJeopardyBoard,
  defaultTeams,
  blankBoard
};
