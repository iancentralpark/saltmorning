'use strict';

const fs = require('fs');
const path = require('path');
const { PORT } = require('../config');

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

function pageCss() {
  return `
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #1c1915; font-family: "Liberation Serif", "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.45; }
h1, h2, h3 { font-family: "Liberation Sans", Arial, sans-serif; color: #1e3a5f; line-height: 1.25; }
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.brand { letter-spacing: .14em; text-transform: uppercase; font-family: "Liberation Sans", Arial, sans-serif; font-size: 11pt; color: #8a6232; font-weight: 700; }
.cover h1 { font-size: 28pt; margin: .4rem 0 .2rem; }
.meta { color: #3d4a57; font-size: 13pt; }
.rule { height: 3px; width: 72px; background: #1e3a5f; margin: 1rem 0; }
.name-line { margin-top: 2.2rem; font-family: "Liberation Sans", Arial, sans-serif; }
.name-line span { display: inline-block; min-width: 42mm; border-bottom: 1px solid #1c1915; margin: 0 .4rem; }
h2 { font-size: 16pt; margin: 0 0 .6rem; page-break-after: avoid; }
h3 { font-size: 13pt; margin: .9rem 0 .3rem; page-break-after: avoid; }
.section { page-break-before: always; }
.section.first { page-break-before: auto; }
p { margin: .35rem 0 .7rem; }
ol, ul { margin: .2rem 0 .8rem; padding-left: 1.2rem; }
li { margin: .25rem 0; }
.item { page-break-inside: avoid; margin: 0 0 1rem; }
.num { font-family: "Liberation Sans", Arial, sans-serif; font-weight: 700; color: #1e3a5f; }
.hint { color: #3d4a57; font-size: 11pt; }
.lines { margin-top: .35rem; }
.lines i { display: block; border-bottom: 1px solid #c8c2b8; height: 1.15rem; }
.steps { margin: .25rem 0 .4rem 1rem; }
.answer { font-weight: 700; }
.small { font-family: "Liberation Sans", Arial, sans-serif; font-size: 10pt; color: #5c564e; }
.toc a { color: inherit; text-decoration: none; }
table { width: 100%; border-collapse: collapse; margin: .4rem 0 1rem; }
td { vertical-align: top; padding: .35rem .4rem .35rem 0; border-bottom: 1px solid #e4dfd6; }
`;
}

function publishable(question) {
  return question && question.verification && question.verification.status !== 'failed';
}

function coverBlock(doc) {
  const ch = doc.chapter || {};
  return `
  <section class="cover">
    <div class="brand">Salt Academy</div>
    <div class="rule"></div>
    <h1>${rich(doc.title || ch.title || 'Mathematics Workbook')}</h1>
    <p class="meta">${escapeHtml(ch.curriculumTitle || 'Pre-Algebra')} · Chapter ${escapeHtml(ch.number || '')}<br>${escapeHtml(ch.title || '')}</p>
    <p class="meta">${escapeHtml(ch.unitTitle || '')}</p>
    <p class="name-line">Name <span></span> Date <span></span></p>
  </section>`;
}

function conceptsBlock(doc) {
  const bits = [];
  if (doc.introduction) bits.push('<h2>Chapter Introduction</h2><p>' + rich(doc.introduction) + '</p>');
  if (doc.objectives && doc.objectives.length) {
    bits.push('<h2>Learning Objectives</h2><ul>' + doc.objectives.map((o) => '<li>' + rich(o.text) + '</li>').join('') + '</ul>');
  }
  if (doc.concepts && doc.concepts.length) {
    bits.push('<h2>Concept Explanations</h2>' + doc.concepts.map((c) => '<h3>' + rich(c.title) + '</h3><p>' + rich(c.body) + '</p>').join(''));
  }
  if (doc.definitions && doc.definitions.length) {
    bits.push('<h2>Key Definitions</h2><table>' + doc.definitions.map((d) => '<tr><td><strong>' + rich(d.term) + '</strong></td><td>' + rich(d.meaning) + '</td></tr>').join('') + '</table>');
  }
  if (doc.rules && doc.rules.length) {
    bits.push('<h2>Rules and Formulas</h2>' + doc.rules.map((r) => '<h3>' + rich(r.name) + '</h3><p>' + rich(r.formula) + '</p>' + (r.note ? '<p class="small">' + rich(r.note) + '</p>' : '')).join(''));
  }
  if (!bits.length) return '';
  return '<section class="section first">' + bits.join('') + '</section>';
}

function examplesBlock(doc) {
  const examples = doc.examples || [];
  if (!examples.length) return '';
  const items = examples.map((ex, i) => {
    const steps = (ex.steps || []).map((s) => '<li>' + rich(s) + '</li>').join('');
    return '<div class="item"><div class="num">Example ' + (i + 1) + '</div><p>' + rich(ex.prompt) + '</p>' +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
      (ex.answer ? '<p class="answer">Answer: ' + rich(ex.answer) + '</p>' : '') + '</div>';
  }).join('');
  return '<section class="section"><h2>Worked Examples</h2>' + items + '</section>';
}

function practiceBlock(doc) {
  const questions = (doc.questions || []).filter(publishable);
  if (!questions.length) return '';
  const groups = [];
  let current = null;
  questions.forEach((q) => {
    if (!current || current.section !== q.section) {
      current = { section: q.section, items: [] };
      groups.push(current);
    }
    current.items.push(q);
  });
  let n = 0;
  return groups.map((g) => {
    const label = SECTION_LABELS[g.section] || g.section;
    const lines = SECTION_LINES[g.section] || 3;
    const lineHtml = '<div class="lines">' + new Array(lines).fill('<i></i>').join('') + '</div>';
    const items = g.items.map((q) => {
      n += 1;
      const hint = g.section === 'guided' && q.hint ? '<p class="hint">Hint: ' + rich(q.hint) + '</p>' : '';
      return '<div class="item"><div class="num">' + n + '.</div><p>' + rich(q.prompt) + '</p>' + hint + lineHtml + '</div>';
    }).join('');
    return '<section class="section"><h2>' + escapeHtml(label) + '</h2>' + items + '</section>';
  }).join('');
}

function answersBlock(doc) {
  const questions = (doc.questions || []).filter(publishable);
  let n = 0;
  const rows = questions.map((q) => {
    n += 1;
    return '<tr><td class="num">' + n + '</td><td>' + rich(q.answer) + '</td></tr>';
  }).join('');
  return coverish(doc, 'Answer Key') + '<section class="section first"><h2>Answer Key</h2><table>' + rows + '</table></section>';
}

function solutionsBlock(doc) {
  const questions = (doc.questions || []).filter(publishable);
  let n = 0;
  const items = questions.map((q) => {
    n += 1;
    const steps = (q.steps || []).map((s) => '<li>' + rich(s) + '</li>').join('');
    const mistakes = (q.mistakes || []).filter(Boolean).map((s) => '<li>' + rich(s) + '</li>').join('');
    return '<div class="item"><div class="num">' + n + '.</div><p>' + rich(q.prompt) + '</p>' +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
      '<p class="answer">Answer: ' + rich(q.answer) + '</p>' +
      (mistakes ? '<p class="small">Common mistakes</p><ul>' + mistakes + '</ul>' : '') +
      '</div>';
  }).join('');
  return coverish(doc, 'Solution Guide') + '<section class="section first"><h2>Detailed Solutions</h2>' + items + '</section>';
}

function coverish(doc, kind) {
  const ch = doc.chapter || {};
  return `<section class="cover">
    <div class="brand">Salt Academy · ${escapeHtml(kind)}</div>
    <div class="rule"></div>
    <h1>${rich(doc.title || '')}</h1>
    <p class="meta">${escapeHtml(ch.curriculumTitle || '')} · ${escapeHtml(ch.title || '')}</p>
  </section>`;
}

function tocBlock(doc, part) {
  if (part !== 'student') return '';
  const items = ['Chapter Introduction', 'Learning Objectives'];
  if (doc.concepts && doc.concepts.length) items.push('Concept Explanations');
  if (doc.definitions && doc.definitions.length) items.push('Key Definitions');
  if (doc.rules && doc.rules.length) items.push('Rules and Formulas');
  if (doc.examples && doc.examples.length) items.push('Worked Examples');
  const seen = {};
  (doc.questions || []).filter(publishable).forEach((q) => {
    const label = SECTION_LABELS[q.section] || q.section;
    if (!seen[label]) {
      seen[label] = true;
      items.push(label);
    }
  });
  return '<section class="section first"><h2>Contents</h2><ol class="toc">' +
    items.map((t) => '<li>' + escapeHtml(t) + '</li>').join('') + '</ol></section>';
}

function renderWorkbookHtml(doc, options) {
  const opts = options || {};
  const part = opts.part || 'student';
  const forPdf = !!opts.forPdf;
  const ch = (doc && doc.chapter) || {};
  const title = (doc && doc.title) || ch.title || 'Workbook';
  let body = '';
  if (part === 'answers') body = answersBlock(doc || {});
  else if (part === 'solutions') body = solutionsBlock(doc || {});
  else {
    body = coverBlock(doc || {}) + tocBlock(doc || {}, 'student') + conceptsBlock(doc || {}) +
      examplesBlock(doc || {}) + practiceBlock(doc || {});
  }
  return '<!DOCTYPE html><html lang="' + escapeHtml((doc && doc.language) || 'en') + '"><head><meta charset="utf-8">' +
    '<title>' + escapeHtml(title) + '</title>' + katexCss(forPdf) + '<style>' + pageCss() + '</style></head><body>' +
    body + '</body></html>';
}

module.exports = {
  renderWorkbookHtml,
  SECTION_LABELS,
  publishable,
  escapeHtml
};
