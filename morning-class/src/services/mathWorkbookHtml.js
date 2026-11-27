'use strict';

const fs = require('fs');
const path = require('path');
const { PORT } = require('../config');
const { renderFigureSvg } = require('./mathFigures');

let katex = null;
try { katex = require('katex'); } catch (e) { katex = null; }

const SECTION_LABELS = {
  guided: 'Guided Practice',
  basic: 'Basic Practice',
  intermediate: 'Intermediate Practice',
  advanced: 'Advanced Practice',
  word: 'Real-World Problems',
  mastery: 'Chapter Mastery Test'
};

const SECTION_LINES = {
  guided: 2,
  basic: 3,
  intermediate: 4,
  advanced: 5,
  word: 7,
  mastery: 4
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTex(tex, display) {
  const src = String(tex || '').trim();
  if (!src) return '';
  if (!katex) return '<code class="tex">' + escapeHtml(src) + '</code>';
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: !!display,
      output: 'htmlAndMathml'
    });
  } catch (e) {
    return '<code class="tex">' + escapeHtml(src) + '</code>';
  }
}

function rich(text) {
  const src = String(text || '');
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index)).replace(/\n/g, '<br>');
    out += renderTex(m[1] != null ? m[1] : m[2], m[1] != null);
    last = m.index + m[0].length;
  }
  out += escapeHtml(src.slice(last)).replace(/\n/g, '<br>');
  return out;
}

function katexCss(forPdf) {
  if (!forPdf) {
    return '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">';
  }
  try {
    const cssPath = require.resolve('katex/dist/katex.min.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const base = 'http://127.0.0.1:' + PORT + '/vendor/katex/';
    const inlined = css.replace(/url\(fonts\//g, 'url(' + base + 'fonts/');
    return '<style>' + inlined + '</style>';
  } catch (e) {
    return '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">';
  }
}

const SECTION_LABELS_KO = {
  guided: '안내 문제',
  basic: '기본 문제',
  intermediate: '중간 문제',
  advanced: '심화 문제',
  word: '문장제',
  mastery: '단원 평가'
};

function labels(lang) {
  const ko = lang === 'ko';
  return {
    contents: ko ? '차례' : 'Contents',
    intro: ko ? '단원 소개' : 'Introduction',
    objectives: ko ? '학습 목표' : 'Learning Objectives',
    concepts: ko ? '개념 설명' : 'Concepts',
    concept: ko ? '개념' : 'Concept',
    definitions: ko ? '용어' : 'Key Terms',
    rules: ko ? '공식' : 'Rules and Formulas',
    rule: ko ? '공식' : 'Rule',
    examples: ko ? '예제' : 'Worked Examples',
    example: ko ? '예제' : 'Example',
    answer: ko ? '답' : 'Answer',
    mistakes: ko ? '자주 하는 실수' : 'Common mistakes',
    name: ko ? '이름' : 'Name',
    className: ko ? '반' : 'Class',
    date: ko ? '날짜' : 'Date',
    workbook: ko ? '수학 워크북' : 'Mathematics Workbook',
    answerKey: ko ? '정답표' : 'Answer Key',
    solutions: ko ? '해설지' : 'Solution Guide',
    hint: ko ? '힌트' : 'Hint',
    score: ko ? '점수' : 'Score',
    teacher: ko ? '교사용' : 'Teacher copy'
  };
}

function sectionLabel(section, lang) {
  const map = lang === 'ko' ? SECTION_LABELS_KO : SECTION_LABELS;
  return map[section] || section;
}

function cssQuote(value) {
  return '"' + String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ').slice(0, 140) + '"';
}

const THEMES = {
  classic: {
    id: 'classic',
    ink: '#1c1915', muted: '#6d6458', paper: '#f7f3ea', desk: '#e4ddd0',
    accent: '#16324f', accent2: '#0f5f5a', mark: '#b08948', line: '#e4dccb',
    wash: '#f4f0e6', soft: '#3d4a57', cover: '#16324f', coverInk: '#f7f1e4', series: '#e6c98a',
    band: '#16324f', bandInk: '#ffffff', display: 'Georgia, "Liberation Serif", serif',
    body: '"Liberation Serif", "Times New Roman", Times, serif',
    sans: '"Liberation Sans", Arial, sans-serif'
  },
  playful: {
    id: 'playful',
    ink: '#243044', muted: '#5c6b7a', paper: '#fffdf8', desk: '#d5ebf2',
    accent: '#d94f3d', accent2: '#1f8a70', mark: '#f2b544', line: '#f3d7bf',
    wash: '#fff4d8', soft: '#3d5a54', cover: '#1f8a70', coverInk: '#fff8ee', series: '#ffe08a',
    band: '#d94f3d', bandInk: '#ffffff', display: '"Trebuchet MS", "Segoe UI", sans-serif',
    body: '"Trebuchet MS", "Segoe UI", sans-serif',
    sans: '"Trebuchet MS", "Segoe UI", sans-serif'
  },
  modern: {
    id: 'modern',
    ink: '#161616', muted: '#5f5f5f', paper: '#f7f6f3', desk: '#e6e4df',
    accent: '#111111', accent2: '#c2410c', mark: '#c2410c', line: '#e3e0da',
    wash: '#ffffff', soft: '#3f3f3f', cover: '#111111', coverInk: '#f7f6f3', series: '#c2410c',
    band: 'transparent', bandInk: '#111111', display: '"Liberation Sans", Arial, sans-serif',
    body: '"Liberation Sans", Arial, sans-serif',
    sans: '"Liberation Sans", Arial, sans-serif'
  },
  editorial: {
    id: 'editorial',
    ink: '#1a1814', muted: '#6e645b', paper: '#f3efe6', desk: '#ddd4c6',
    accent: '#6b2d3c', accent2: '#2c4a3e', mark: '#6b2d3c', line: '#e0d5c4',
    wash: '#f7f1e6', soft: '#4e463e', cover: '#6b2d3c', coverInk: '#f7f1e6', series: '#e7c7a1',
    band: 'transparent', bandInk: '#6b2d3c', display: 'Georgia, "Liberation Serif", serif',
    body: 'Georgia, "Liberation Serif", serif',
    sans: '"Liberation Sans", Arial, sans-serif'
  }
};

function themeOf(id) {
  return THEMES[id] || THEMES.classic;
}

function pageCss(bookTitle, partName, themeId) {
  const title = cssQuote(bookTitle);
  const part = cssQuote(partName);
  const theme = themeOf(themeId);
  const vars = Object.keys(theme).filter((key) => key !== 'id').map((key) => {
    const cssKey = key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    return '--' + cssKey + ':' + theme[key];
  }).join(';');
  return `
:root { ${vars}; }
@page {
  size: A4;
  margin: 16mm 15mm 16mm;
  @top-center { content: ${title}; font-family: var(--sans); font-size: 8.5pt; color: var(--muted); }
  @bottom-left { content: ${part}; font-family: var(--sans); font-size: 8.5pt; color: var(--muted); }
  @bottom-right { content: counter(page); font-family: var(--sans); font-size: 9pt; color: var(--accent); }
}
@page cover { margin: 0; @top-center { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { color: var(--ink); background: #fff; font-family: var(--body); font-size: 11.5pt; line-height: 1.45; }
p, li { orphans: 3; widows: 3; }
.running { display: none; }
.cover { page: cover; height: 297mm; display: flex; flex-direction: column; background: var(--paper); color: var(--ink); break-after: page; }
.cover-top { background: var(--cover); color: var(--cover-ink); padding: 18mm 16mm 12mm; }
.cover-top .brand { font-family: var(--sans); letter-spacing: .22em; font-size: 11pt; font-weight: 700; }
.cover-top .series { margin-top: 3mm; font-family: var(--display); font-size: 16pt; color: var(--series); }
.stamp { display: inline-block; margin-top: 6mm; border: 1px solid var(--series); color: var(--series); letter-spacing: .16em; text-transform: uppercase; font-family: var(--sans); font-size: 9pt; padding: 1.5mm 3mm; }
.cover-main { flex: 1; padding: 14mm 16mm 6mm; }
.eyebrow { font-family: var(--sans); letter-spacing: .16em; text-transform: uppercase; font-size: 9pt; color: var(--accent2); font-weight: 700; }
.cover-main h1 { font-family: var(--display); font-size: 34pt; line-height: 1.05; color: var(--accent); margin: 4mm 0 2mm; font-weight: 700; }
.gold { width: 28mm; height: 1.4mm; background: var(--mark); margin: 5mm 0 7mm; }
.cover-list { list-style: none; margin: 0; padding: 0; }
.cover-list li { font-family: var(--sans); border-top: 1px solid var(--line); padding: 2.6mm 0; font-size: 12pt; }
.cover-list li:last-child { border-bottom: 1px solid var(--line); }
.cover-foot { margin: 0 16mm 14mm; display: grid; grid-template-columns: 1.5fr .8fr .8fr; border: 1.5px solid var(--accent); }
.cover-foot div { padding: 3.5mm 4mm 5mm; border-right: 1px solid var(--accent); }
.cover-foot div:last-child { border-right: 0; }
.cover-foot span { display: block; font-family: var(--sans); font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.cover-foot i { display: block; height: 7mm; }
.chapter { break-before: auto; }
.sheet { break-before: page; }
h2, h3, .band, .opener, .kicker { break-after: avoid; }
h2 { font-family: var(--sans); color: var(--accent); font-size: 16pt; margin: 0 0 4mm; }
h3 { font-family: var(--sans); color: var(--accent); font-size: 12.5pt; margin: 0 0 1.5mm; }
.kicker { font-family: var(--sans); font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: var(--accent2); font-weight: 700; margin-bottom: 1mm; }
.toc-row { display: flex; align-items: baseline; gap: 2mm; margin: 1.6mm 0; text-decoration: none; color: inherit; break-inside: avoid; }
.toc-row .fill { flex: 1; border-bottom: 1px dotted var(--line); transform: translateY(-1px); }
.toc-row.sub { margin-left: 6mm; font-size: 11pt; color: var(--soft); }
a.toc-row::after { content: target-counter(attr(href), page); font-family: var(--sans); color: var(--accent); font-size: 10pt; }
.opener { border-bottom: 2px solid var(--accent); margin: 0 0 6mm; padding-bottom: 4mm; break-inside: avoid; }
.chnum { font-family: var(--display); font-size: 28pt; color: var(--mark); line-height: 1; }
.opener h2 { font-family: var(--display); font-size: 22pt; margin: 1mm 0; }
.lead { margin: 2mm 0 0; }
.block { break-inside: avoid; margin: 0 0 4.5mm; }
.concept, .rulebox, .example, .solution { border: 1px solid var(--line); background: #fff; padding: 3.5mm 4mm; break-inside: avoid; margin: 0 0 4mm; }
.concept { border-left: 2.5px solid var(--accent2); }
.rulebox { background: var(--wash); }
.formula { font-size: 13pt; margin: 1mm 0; }
.def { display: grid; grid-template-columns: 42mm 1fr; gap: 3mm; padding: 2mm 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
.def .term { font-family: var(--sans); font-weight: 700; color: var(--accent); }
.example .exhead, .solution .exhead { font-family: var(--sans); font-weight: 700; color: var(--accent); letter-spacing: .04em; }
.steps { margin: 2mm 0 2mm 5mm; padding: 0; }
.steps li { margin: 1mm 0; }
.exanswer { margin-top: 2mm; padding-top: 2mm; border-top: 1px solid var(--line); font-weight: 700; }
.band { font-family: var(--sans); font-size: 11pt; letter-spacing: .06em; text-transform: uppercase; background: var(--band); color: var(--band-ink); padding: 2mm 4mm; margin: 0 0 4mm; }
.score { font-family: var(--sans); text-align: right; font-size: 10pt; margin: -2mm 0 3mm; }
.score i { display: inline-block; min-width: 22mm; border-bottom: 1px solid var(--ink); }
.practice.cols { column-count: 2; column-gap: 8mm; }
.problem { display: flex; gap: 3mm; break-inside: avoid; margin: 0 0 4.5mm; }
.pnum { flex: 0 0 8mm; height: 8mm; border: 1.5px solid var(--accent); color: var(--accent); font-family: var(--sans); font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 10pt; }
.pbody { flex: 1; min-width: 0; }
.pbody p { margin: 0 0 1.5mm; }
.fig { margin: 1.5mm 0 2mm; break-inside: avoid; }
.fig svg { width: 78mm; max-width: 100%; height: auto; display: block; }
.hint { color: var(--soft); font-size: 10.5pt; }
.lines i { display: block; border-bottom: 1px solid var(--line); height: 6.2mm; }
.akey { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; }
.akey div { display: flex; gap: 3mm; break-inside: avoid; border-bottom: 1px solid var(--line); padding: 1mm 0; }
.akey .n { font-family: var(--sans); font-weight: 700; color: var(--accent); min-width: 8mm; }
.note { font-family: var(--sans); font-size: 10pt; color: var(--muted); }
body.theme-playful .pnum { border-radius: 999px; background: var(--mark); border-color: var(--mark); color: #3a2a10; }
body.theme-playful .concept, body.theme-playful .example, body.theme-playful .rulebox, body.theme-playful .solution, body.theme-playful .stamp { border-radius: 12px; }
body.theme-playful .gold { height: 3.2mm; border-radius: 99px; }
body.theme-playful .band { border-radius: 999px; width: fit-content; padding-left: 5mm; padding-right: 5mm; }
body.theme-modern .cover-top, body.theme-editorial .band, body.theme-modern .band { background: transparent; color: var(--accent); }
body.theme-modern .cover { background: #fff; }
body.theme-modern .cover-top { color: var(--ink); padding-bottom: 4mm; }
body.theme-modern .cover-top .brand { color: var(--accent2); }
body.theme-modern .cover-top .series { color: var(--accent2); }
body.theme-modern .stamp { color: var(--accent2); border-color: var(--accent2); }
body.theme-modern .gold { width: 16mm; height: .5mm; }
body.theme-modern .band, body.theme-editorial .band { border-bottom: 1.5px solid var(--accent); padding-left: 0; padding-right: 0; letter-spacing: .16em; }
body.theme-modern .concept, body.theme-modern .example, body.theme-modern .solution { border-width: 0 0 1px; border-radius: 0; }
body.theme-editorial .cover-main h1, body.theme-editorial .opener h2, body.theme-editorial .chnum { font-weight: 500; }
@media screen {
  body { background: var(--desk); padding: 18px 0 40px; }
  .cover, .sheet { width: 210mm; min-height: 297mm; margin: 0 auto 16px; background: var(--paper); box-shadow: 0 10px 28px rgba(22, 28, 40, .16); }
  .sheet { padding: 16mm 15mm; }
  .chapter { width: auto; min-height: 0; margin: 0; padding: 0; background: transparent; box-shadow: none; }
}
@media print {
  body { background: #fff; }
  .cover { background: var(--paper); }
  .chapter, .sheet { width: auto; min-height: 0; margin: 0; box-shadow: none; padding: 0; }
  .sheet { background: transparent; }
}
`;
}

function figureHtml(figure) {
  const svg = renderFigureSvg(figure);
  return svg ? '<div class="fig">' + svg + '</div>' : '';
}

function publishable(question) {
  return question && question.verification && question.verification.status !== 'failed';
}

function partsOf(doc) {
  if (doc && Array.isArray(doc.parts) && doc.parts.length) return doc.parts;
  return [doc || {}];
}

function chapterLabel(part, index) {
  const ch = (part && part.chapter) || {};
  const n = ch.number || (index + 1);
  return 'Chapter ' + n + '. ' + (ch.title || '');
}

function pad2(n) {
  const v = Number(n) || 0;
  return (v < 10 ? '0' : '') + v;
}

function chapterId(part, index) {
  const ch = (part && part.chapter) || {};
  return String(ch.id || ('ch' + (index + 1)));
}

function coverBlock(doc, parts, kind) {
  const L = labels(doc.language);
  const ch = (parts[0] && parts[0].chapter) || doc.chapter || {};
  const series = ch.curriculumTitle || 'Pre-Algebra';
  const items = parts.map((part, i) => {
    const c = part.chapter || {};
    return '<li>' + escapeHtml(pad2(c.number || (i + 1)) + '  ' + (c.title || '')) + '</li>';
  }).join('');
  const stamp = kind === 'answers'
    ? '<div class="stamp">' + escapeHtml(L.answerKey) + '</div>'
    : (kind === 'solutions' ? '<div class="stamp">' + escapeHtml(L.solutions) + '</div>' : '');
  const foot = kind
    ? '<div class="cover-foot"><div><span>' + escapeHtml(L.teacher) + '</span><i></i></div><div><span>' + escapeHtml(L.className) + '</span><i></i></div><div><span>' + escapeHtml(L.date) + '</span><i></i></div></div>'
    : '<div class="cover-foot"><div><span>' + escapeHtml(L.name) + '</span><i></i></div><div><span>' + escapeHtml(L.className) + '</span><i></i></div><div><span>' + escapeHtml(L.date) + '</span><i></i></div></div>';
  const eyebrow = L.workbook;
  return '<section class="cover"><div class="cover-top"><div class="brand">Salt Academy</div><div class="series">' +
    escapeHtml(series) + '</div>' + stamp + '</div><div class="cover-main"><div class="eyebrow">' +
    escapeHtml(eyebrow) + '</div><h1>' + rich(doc.title || ch.title || 'Workbook') + '</h1><div class="gold"></div><ol class="cover-list">' +
    items + '</ol></div>' + foot + '</section>';
}

function tocBlock(doc, parts) {
  const L = labels(doc.language);
  const rows = [];
  parts.forEach((part, i) => {
    const id = chapterId(part, i);
    rows.push('<a class="toc-row" href="#ch-' + escapeHtml(id) + '"><span>' + escapeHtml(chapterLabel(part, i)) + '</span><span class="fill"></span></a>');
    rows.push('<a class="toc-row sub" href="#ch-' + escapeHtml(id) + '-teach"><span>' + escapeHtml(L.intro) + '</span><span class="fill"></span></a>');
    if (part.examples && part.examples.length) {
      rows.push('<a class="toc-row sub" href="#ch-' + escapeHtml(id) + '-ex"><span>' + escapeHtml(L.examples) + '</span><span class="fill"></span></a>');
    }
    const seen = {};
    (part.questions || []).filter(publishable).forEach((q) => {
      const label = sectionLabel(q.section, doc.language);
      if (seen[q.section]) return;
      seen[q.section] = true;
      rows.push('<a class="toc-row sub" href="#ch-' + escapeHtml(id) + '-' + escapeHtml(q.section) + '"><span>' + escapeHtml(label) + '</span><span class="fill"></span></a>');
    });
  });
  return '<h2>' + escapeHtml(L.contents) + '</h2>' + rows.join('');
}

function teachBlock(part, index, doc) {
  const L = labels(doc.language);
  const ch = part.chapter || {};
  const id = chapterId(part, index);
  const bits = [];
  bits.push('<header class="opener" id="ch-' + escapeHtml(id) + '"><div class="kicker">' + escapeHtml(ch.unitTitle || ch.curriculumTitle || '') + '</div><div class="chnum">' + escapeHtml(pad2(ch.number || (index + 1))) + '</div><h2>' + escapeHtml(ch.title || '') + '</h2>' + (part.introduction ? '<p class="lead">' + rich(part.introduction) + '</p>' : '') + '</header>');
  bits.push('<div id="ch-' + escapeHtml(id) + '-teach">');
  if (part.objectives && part.objectives.length) {
    bits.push('<div class="block"><div class="kicker">' + escapeHtml(L.objectives) + '</div><ol>' + part.objectives.map((o) => '<li>' + rich(o.text) + '</li>').join('') + '</ol></div>');
  }
  if (part.concepts && part.concepts.length) {
    bits.push('<div class="block"><div class="kicker">' + escapeHtml(L.concepts) + '</div>' + part.concepts.map((c) => '<div class="concept"><h3>' + rich(c.title) + '</h3><p>' + rich(c.body) + '</p></div>').join('') + '</div>');
  }
  if (part.definitions && part.definitions.length) {
    bits.push('<div class="block"><div class="kicker">' + escapeHtml(L.definitions) + '</div>' + part.definitions.map((d) => '<div class="def"><div class="term">' + rich(d.term) + '</div><div>' + rich(d.meaning) + '</div></div>').join('') + '</div>');
  }
  if (part.rules && part.rules.length) {
    bits.push('<div class="block"><div class="kicker">' + escapeHtml(L.rules) + '</div>' + part.rules.map((r) => '<div class="rulebox"><h3>' + rich(r.name) + '</h3><div class="formula">' + rich(r.formula) + '</div>' + (r.note ? '<p class="note">' + rich(r.note) + '</p>' : '') + '</div>').join('') + '</div>');
  }
  bits.push('</div>');
  return bits.join('');
}

function examplesBlock(part, index, doc) {
  const examples = part.examples || [];
  if (!examples.length) return '';
  const L = labels(doc.language);
  const id = chapterId(part, index);
  const items = examples.map((ex, i) => {
    const steps = (ex.steps || []).map((s) => '<li>' + rich(s) + '</li>').join('');
    return '<div class="example"><div class="exhead">' + escapeHtml(L.example) + ' ' + (i + 1) + '</div><p>' + rich(ex.prompt) + '</p>' +
      figureHtml(ex.figure) +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
      (ex.answer ? '<div class="exanswer">' + escapeHtml(L.answer) + ' · ' + rich(ex.answer) + '</div>' : '') + '</div>';
  }).join('');
  return '<div id="ch-' + escapeHtml(id) + '-ex"><h2>' + escapeHtml(L.examples) + '</h2>' + items + '</div>';
}

function practiceBlock(part, index, doc, counter) {
  const questions = (part.questions || []).filter(publishable);
  if (!questions.length) return [];
  const L = labels(doc.language);
  const id = chapterId(part, index);
  const groups = [];
  let current = null;
  questions.forEach((q) => {
    if (!current || current.section !== q.section) {
      current = { section: q.section, items: [] };
      groups.push(current);
    }
    current.items.push(q);
  });
  return groups.map((g) => {
    const lines = SECTION_LINES[g.section] || 3;
    const lineHtml = '<div class="lines">' + new Array(lines).fill('<i></i>').join('') + '</div>';
    const hasFig = g.items.some((q) => q.figure);
    const cols = !hasFig && (g.section === 'basic' || g.section === 'intermediate') && g.items.length >= 4 ? ' cols' : '';
    const items = g.items.map((q) => {
      counter.n += 1;
      const hint = g.section === 'guided' && q.hint ? '<p class="hint">' + escapeHtml(L.hint) + ': ' + rich(q.hint) + '</p>' : '';
      return '<div class="problem"><div class="pnum">' + counter.n + '</div><div class="pbody"><p>' + rich(q.prompt) + '</p>' + figureHtml(q.figure) + hint + lineHtml + '</div></div>';
    }).join('');
    const score = g.section === 'mastery' ? '<p class="score">' + escapeHtml(L.score) + ' <i></i> / ' + g.items.length + '</p>' : '';
    return {
      kind: g.section,
      html: '<div id="ch-' + escapeHtml(id) + '-' + escapeHtml(g.section) + '"><h2 class="band">' + escapeHtml(sectionLabel(g.section, doc.language)) + '</h2>' + score + '<div class="practice' + cols + '">' + items + '</div></div>'
    };
  });
}

function groupSheets(blocks, doc) {
  const flow = new Set(((doc && doc.layout && doc.layout.flow) || []).filter((kind) => kind !== 'contents'));
  const groups = [];
  blocks.forEach((block) => {
    if (!block || !block.html) return;
    if (block.kind !== 'contents' && flow.has(block.kind) && groups.length) groups[groups.length - 1].push(block);
    else groups.push([block]);
  });
  return groups.map((group) => '<section class="sheet">' + group.map((block) => block.html).join('') + '</section>').join('');
}

function answersBlock(doc) {
  const parts = partsOf(doc);
  const L = labels(doc.language);
  const counter = { n: 0 };
  const body = parts.map((part, i) => {
    const questions = (part.questions || []).filter(publishable);
    if (!questions.length) return '';
    const rows = questions.map((q) => {
      counter.n += 1;
      return '<div><span class="n">' + counter.n + '</span><span>' + rich(q.answer) + '</span></div>';
    }).join('');
    return '<section class="back sheet" id="ans-' + escapeHtml(chapterId(part, i)) + '"><h2>' + escapeHtml(chapterLabel(part, i)) + '</h2><div class="akey">' + rows + '</div></section>';
  }).join('');
  return coverBlock(doc, parts, 'answers') + body;
}

function solutionsBlock(doc) {
  const parts = partsOf(doc);
  const L = labels(doc.language);
  const counter = { n: 0 };
  const body = parts.map((part, i) => {
    const questions = (part.questions || []).filter(publishable);
    if (!questions.length) return '';
    const items = questions.map((q) => {
      counter.n += 1;
      const steps = (q.steps || []).map((s) => '<li>' + rich(s) + '</li>').join('');
      const mistakes = (q.mistakes || []).filter(Boolean).map((s) => '<li>' + rich(s) + '</li>').join('');
      return '<div class="solution"><div class="exhead">' + counter.n + '</div><p>' + rich(q.prompt) + '</p>' +
        figureHtml(q.figure) +
        (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
        '<div class="exanswer">' + escapeHtml(L.answer) + ' · ' + rich(q.answer) + '</div>' +
        (mistakes ? '<p class="note">' + escapeHtml(L.mistakes) + '</p><ul>' + mistakes + '</ul>' : '') +
        '</div>';
    }).join('');
    return '<section class="back sheet"><h2>' + escapeHtml(chapterLabel(part, i)) + '</h2>' + items + '</section>';
  }).join('');
  return coverBlock(doc, parts, 'solutions') + body;
}

function renderWorkbookHtml(doc, options) {
  const opts = options || {};
  const part = opts.part || 'student';
  const forPdf = !!opts.forPdf;
  const book = doc || {};
  const parts = partsOf(book);
  const ch = (parts[0] && parts[0].chapter) || book.chapter || {};
  const title = book.title || ch.title || 'Workbook';
  const L = labels(book.language);
  const partName = part === 'answers' ? L.answerKey : (part === 'solutions' ? L.solutions : L.workbook);
  const theme = themeOf(book.theme);
  let body = '<span class="running title">' + escapeHtml(title) + '</span><span class="running part">' + escapeHtml(partName) + '</span>';
  if (part === 'answers') body += answersBlock(book);
  else if (part === 'solutions') body += solutionsBlock(book);
  else {
    const counter = { n: 0 };
    const blocks = [{ kind: 'contents', html: tocBlock(book, parts) }];
    parts.forEach((piece, i) => {
      blocks.push({ kind: 'teach', html: teachBlock(piece, i, book) });
      const examples = examplesBlock(piece, i, book);
      if (examples) blocks.push({ kind: 'examples', html: examples });
      practiceBlock(piece, i, book, counter).forEach((block) => blocks.push(block));
    });
    body += coverBlock(book, parts) + groupSheets(blocks, book);
  }
  return '<!DOCTYPE html><html lang="' + escapeHtml(book.language || 'en') + '"><head><meta charset="utf-8">' +
    '<title>' + escapeHtml(title) + '</title>' + katexCss(forPdf) + '<style>' + pageCss(title, partName, theme.id) + '</style></head><body class="theme-' + theme.id + '">' +
    body + '</body></html>';
}

module.exports = {
  renderWorkbookHtml,
  SECTION_LABELS,
  publishable,
  escapeHtml
};
