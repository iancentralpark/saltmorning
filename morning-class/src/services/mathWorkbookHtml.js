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
  const src = String(text || '').replace(/\\\$/g, '\u0001');
  const plain = (s) => escapeHtml(s).replace(/\u0001/g, '$').replace(/\n/g, '<br>');
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    // "$3 flat fee plus $2" is two prices, not one formula.
    if (m[1] == null && /^\d/.test(m[2]) && /\s$/.test(m[2])) {
      re.lastIndex = m.index + 1;
      continue;
    }
    out += plain(src.slice(last, m.index));
    out += renderTex((m[1] != null ? m[1] : m[2]).replace(/\u0001/g, '\\$'), m[1] != null);
    last = m.index + m[0].length;
  }
  out += plain(src.slice(last));
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
    equation: ko ? '식' : 'Equation',
    step: ko ? '단계' : 'Step',
    mistakes: ko ? '자주 하는 실수' : 'Common mistakes',
    name: ko ? '이름' : 'Name',
    className: ko ? '반' : 'Class',
    date: ko ? '날짜' : 'Date',
    workbook: ko ? '수학 워크북' : 'Mathematics Workbook',
    subject: ko ? '수학' : 'Mathematics',
    edition: ko ? '학생용 문제집' : 'Student Workbook',
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
.cover { page: cover; height: 297mm; position: relative; overflow: hidden; background: #fff; color: var(--ink); break-after: page; }
.art { position: absolute; left: 0; right: 0; top: 0; height: 178mm; overflow: hidden; background: #5ec8f5; }
.sun { position: absolute; width: 52mm; height: 52mm; border-radius: 50%; background: #ffe56a; top: 8mm; left: 10mm; box-shadow: 0 0 0 7mm rgba(255, 229, 106, .45); }
.cloud { position: absolute; background: #fff; border-radius: 20mm; }
.cloud::before, .cloud::after { content: ""; position: absolute; background: #fff; border-radius: 50%; }
.cloud.a { width: 48mm; height: 16mm; top: 18mm; right: 14mm; }
.cloud.a::before { width: 22mm; height: 22mm; left: 6mm; top: -12mm; }
.cloud.a::after { width: 16mm; height: 16mm; left: 24mm; top: -8mm; }
.cloud.b { width: 30mm; height: 12mm; top: 34mm; right: 52mm; }
.cloud.b::before { width: 14mm; height: 14mm; left: 4mm; top: -8mm; }
.cloud.b::after { width: 12mm; height: 12mm; left: 14mm; top: -6mm; }
.cloud.c { width: 22mm; height: 9mm; top: 12mm; left: 70mm; }
.cloud.c::before { width: 10mm; height: 10mm; left: 3mm; top: -6mm; }
.cloud.c::after { width: 8mm; height: 8mm; left: 11mm; top: -4mm; }
.hill, .hill2 { position: absolute; border-radius: 50%; background: #3dbe7a; }
.hill { left: -24mm; bottom: -30mm; width: 160mm; height: 74mm; }
.hill2 { right: -28mm; bottom: -38mm; width: 140mm; height: 84mm; background: #2fa86a; }
.blocks { position: absolute; z-index: 5; left: 14mm; bottom: 18mm; display: flex; align-items: flex-end; gap: 3.5mm; }
.blocks i { display: flex; align-items: center; justify-content: center; width: 26mm; height: 26mm; border-radius: 5mm; background: #ffe56b; color: #243044; font-style: normal; font-family: var(--sans); font-weight: 800; font-size: 20pt; box-shadow: 0 2.5mm 0 rgba(29, 60, 110, .12); }
.blocks i:nth-child(2) { height: 34mm; background: #fff; }
.blocks i:nth-child(3) { height: 22mm; background: #ff7b6e; color: #fff; }
.blocks i:nth-child(4) { background: #1d4e89; color: #fff; }
.sym { position: absolute; z-index: 5; font-family: var(--sans); font-weight: 800; line-height: 1; color: #fff; }
.sym.s1 { right: 18mm; top: 52mm; font-size: 36pt; }
.sym.s2 { right: 46mm; bottom: 22mm; font-size: 26pt; color: #ffe56a; }
.sym.s3 { left: 86mm; top: 16mm; font-size: 20pt; color: #1d4e89; }
.geo { display: none; }
.badge { position: absolute; z-index: 4; left: 16mm; top: 164mm; width: 28mm; height: 28mm; border-radius: 50%; background: #ff7b6e; color: #fff; border: 2.5px solid #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.badge span { font-family: var(--sans); font-size: 6.5pt; font-weight: 800; letter-spacing: .06em; line-height: 1; }
.badge strong { font-family: var(--sans); font-size: 12pt; font-weight: 800; line-height: 1; margin-top: .6mm; }
.plate { position: absolute; z-index: 2; left: 0; right: 0; top: 178mm; bottom: 0; background: #fff; display: flex; flex-direction: column; padding: 18mm 16mm 12mm; }
.plate .subject { font-family: var(--sans); font-size: 13pt; font-weight: 800; color: #1f8a70; }
.plate h1 { font-family: var(--display); font-size: 40pt; line-height: .95; font-weight: 800; margin: 1.5mm 0 0; color: #1d3c6e; }
.plate h1.long { font-size: 28pt; line-height: 1.02; }
.plate .sub { font-family: var(--sans); font-size: 13pt; font-weight: 700; color: #d94f3d; margin: 3mm 0 0; }
.plate .pub { margin-top: auto; align-self: flex-start; padding-top: 2.5mm; border-top: 2px solid currentColor; font-family: var(--sans); font-size: 11pt; font-weight: 800; letter-spacing: .24em; color: #1d4e89; }
.ribbon { position: absolute; z-index: 5; top: 22mm; right: -22mm; transform: rotate(32deg); background: #1d4e89; color: #fff; font-family: var(--sans); font-weight: 800; font-size: 11pt; padding: 2mm 24mm; }
.who { display: flex; justify-content: flex-end; align-items: flex-end; gap: 2.5mm; margin: 0 0 6mm; }
.who span { font-family: var(--sans); font-size: 9pt; font-weight: 700; }
.who i { width: 28mm; height: 5mm; border-bottom: 1px solid var(--ink); }
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
.work { min-height: 18mm; }
.ans { display: flex; justify-content: flex-end; align-items: flex-end; gap: 1.8mm; font-size: 11pt; margin-top: 1mm; }
.ans .lab { font-family: var(--sans); font-size: 9.5pt; font-weight: 700; color: var(--accent); margin-right: .6mm; }
.ans .bl { display: inline-block; width: 24mm; height: 6.5mm; border-bottom: 1.3px solid var(--ink); }
.ans .bl.tiny { width: 13mm; }
.ans .bl.wide { width: 46mm; }
.ans .bl.grow { flex: 1; width: auto; margin-right: 4mm; }
.ans .paren { font-size: 13pt; line-height: 1; }
.ans.split { justify-content: flex-start; }
.practice.cols .ans .bl.wide { width: 38mm; }
.scaffold { margin: 1.5mm 0 0; border-top: 1px dashed var(--line); }
.scaffold .st { min-height: 10.5mm; border-bottom: 1px dashed var(--line); padding-top: 1mm; }
.scaffold .st span { font-family: var(--sans); font-size: 8.5pt; font-weight: 700; color: var(--accent2); }
.draw { display: flex; gap: 6mm; align-items: stretch; margin-top: 1.5mm; }
.draw .work { flex: 1; }
.draw .fig { flex: 0 0 auto; margin: 0; }
.draw .fig svg { width: 70mm; }
.grid { flex: 0 0 52mm; }
.grid svg { width: 52mm; height: 52mm; display: block; }
.nline { margin: 2.5mm 0 0; }
.nline svg { width: 100%; max-width: 150mm; height: auto; display: block; }
.practice.test .ans .bl { border: 1.3px solid var(--ink); height: 8mm; }
body.theme-playful .practice.test .ans .bl { border-radius: 2.5mm; }
.akey { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; }
.akey div { display: flex; gap: 3mm; break-inside: avoid; border-bottom: 1px solid var(--line); padding: 1mm 0; }
.akey .n { font-family: var(--sans); font-weight: 700; color: var(--accent); min-width: 8mm; }
.note { font-family: var(--sans); font-size: 10pt; color: var(--muted); }
body.theme-playful .pnum { border-radius: 999px; background: var(--mark); border-color: var(--mark); color: #3a2a10; }
body.theme-playful .concept, body.theme-playful .example, body.theme-playful .rulebox, body.theme-playful .solution { border-radius: 12px; }
body.theme-playful .band { border-radius: 999px; width: fit-content; padding-left: 5mm; padding-right: 5mm; }
body.theme-modern .band, body.theme-editorial .band { background: transparent; color: var(--accent); border-bottom: 1.5px solid var(--accent); padding-left: 0; padding-right: 0; letter-spacing: .16em; }
body.theme-modern .concept, body.theme-modern .example, body.theme-modern .solution { border-width: 0 0 1px; border-radius: 0; }
body.theme-editorial .opener h2, body.theme-editorial .chnum { font-weight: 500; }
body.theme-playful .plate::before { content: ""; position: absolute; left: -10%; top: -14mm; width: 120%; height: 26mm; background: #fff; border-radius: 50%; }
body.theme-classic .cover { background: #f4ead8; }
body.theme-classic .art { height: 168mm; background: #16324f; }
body.theme-classic .sun, body.theme-classic .cloud, body.theme-classic .hill, body.theme-classic .hill2, body.theme-classic .blocks, body.theme-classic .sym { display: none; }
body.theme-classic .geo { display: block; position: absolute; inset: 16mm 14mm 12mm; }
body.theme-classic .geo i { position: absolute; display: block; }
body.theme-classic .geo i:nth-child(1) { width: 74mm; height: 74mm; border-radius: 50%; border: 2.2px solid #e6c98a; left: 6mm; top: 14mm; }
body.theme-classic .geo i:nth-child(2) { width: 0; height: 0; border-left: 30mm solid transparent; border-right: 30mm solid transparent; border-bottom: 52mm solid #e6c98a; right: 8mm; top: 26mm; }
body.theme-classic .geo i:nth-child(3) { width: 26mm; height: 26mm; border: 2.2px solid #e6c98a; left: 58mm; bottom: 6mm; transform: rotate(16deg); }
body.theme-classic .plate { top: 168mm; background: #f4ead8; }
body.theme-classic .badge { top: 154mm; background: #f4ead8; color: #16324f; border-color: #16324f; }
body.theme-classic .badge span { color: #8a6232; }
body.theme-classic .plate .subject { color: #0f5f5a; letter-spacing: .16em; text-transform: uppercase; font-size: 11pt; }
body.theme-classic .plate h1 { color: #16324f; font-weight: 700; font-size: 42pt; }
body.theme-classic .plate .sub { color: #8a6232; }
body.theme-classic .plate .pub { color: #16324f; }
body.theme-classic .ribbon { background: #b08948; color: #16324f; }
body.theme-modern .cover { background: #111; color: #f7f6f3; }
body.theme-modern .art { height: 16mm; background: #c2410c; }
body.theme-modern .sun, body.theme-modern .cloud, body.theme-modern .hill, body.theme-modern .hill2, body.theme-modern .blocks, body.theme-modern .sym { display: none; }
body.theme-modern .plate { top: 16mm; background: #111; padding: 14mm 14mm 64mm; }
body.theme-modern .plate::before { content: attr(data-mark); position: absolute; right: -6mm; top: 18mm; font-family: var(--sans); font-weight: 800; font-size: 140pt; line-height: .8; color: rgba(255,255,255,.07); }
body.theme-modern .plate::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 52mm; background: #c2410c; }
body.theme-modern .plate .subject { position: relative; z-index: 1; color: #c2410c; letter-spacing: .18em; text-transform: uppercase; font-size: 11pt; }
body.theme-modern .plate h1 { position: relative; z-index: 1; color: #fff; font-size: 52pt; letter-spacing: -.04em; }
body.theme-modern .plate .sub { position: absolute; z-index: 2; left: 14mm; bottom: 18mm; margin: 0; color: #fff; letter-spacing: .12em; text-transform: uppercase; }
body.theme-modern .plate .pub { position: absolute; z-index: 2; left: 14mm; top: -11.5mm; margin: 0; padding: 0; border: 0; color: #fff; }
body.theme-modern .badge { left: auto; right: 12mm; top: auto; bottom: 8mm; width: 34mm; height: 34mm; border-radius: 0; background: #111; color: #fff; border: 0; }
body.theme-modern .badge span { color: #c2410c; }
body.theme-modern .ribbon { background: #fff; color: #111; }
body.theme-editorial .cover { background: #6b2d3c; }
body.theme-editorial .art, body.theme-editorial .badge { display: none; }
body.theme-editorial .cover::before { content: ""; position: absolute; inset: 9mm; border: 1px solid #e7c7a1; z-index: 3; pointer-events: none; }
body.theme-editorial .cover::after { content: ""; position: absolute; inset: 12.5mm; border: 1px solid #e7c7a1; z-index: 3; pointer-events: none; }
body.theme-editorial .plate { top: 0; background: transparent; align-items: center; justify-content: center; text-align: center; padding: 28mm 22mm; }
body.theme-editorial .plate .pub { order: 1; margin: 0 0 12mm; padding: 0; border: 0; color: #e7c7a1; align-self: center; }
body.theme-editorial .plate h1 { order: 2; color: #f7f1e6; font-weight: 500; font-size: 44pt; }
body.theme-editorial .plate .subject { order: 3; margin-top: 7mm; padding-top: 4mm; border-top: 1px solid #e7c7a1; width: 62mm; color: #e7c7a1; letter-spacing: .22em; text-transform: uppercase; font-size: 11pt; }
body.theme-editorial .plate .sub { order: 4; color: #f7f1e6; font-weight: 500; }
body.theme-editorial .ribbon { background: #e7c7a1; color: #6b2d3c; }
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

function levelMark(series) {
  const s = String(series || '');
  if (/pre-?calculus/i.test(s)) return 'PC';
  if (/calculus/i.test(s)) return 'C';
  if (/pre-?algebra/i.test(s)) return 'PA';
  if (/algebra\s*2/i.test(s)) return 'A2';
  if (/algebra\s*1/i.test(s)) return 'A1';
  if (/geometry/i.test(s)) return 'G';
  return 'M';
}

function coverBlock(doc, parts, kind) {
  const L = labels(doc.language);
  const ch = (parts[0] && parts[0].chapter) || doc.chapter || {};
  const series = ch.curriculumTitle || '';
  const title = doc.title || ch.title || 'Workbook';
  const subject = series && series !== title ? series : L.subject;
  const band = String(ch.gradeBand || '').replace('-', '–');
  const mark = levelMark(series);
  const long = String(title).length > 18 ? ' long' : '';
  const ribbon = kind === 'answers' ? L.answerKey : (kind === 'solutions' ? L.solutions : (kind === 'teacher' ? L.teacher : ''));
  const art = '<div class="art" aria-hidden="true"><i class="sun"></i><i class="cloud a"></i><i class="cloud b"></i><i class="cloud c"></i>' +
    '<b class="sym s1">+</b><b class="sym s2">×</b>' +
    '<div class="blocks"><i>1</i><i>2</i><i>+</i><i>=</i></div><i class="hill2"></i><i class="hill"></i>' +
    '<div class="geo"><i></i><i></i><i></i></div></div>';
  const badge = '<div class="badge"><span>' + escapeHtml(band ? (doc.language === 'ko' ? '학년' : 'GRADES') : 'LEVEL') + '</span><strong>' +
    escapeHtml(band || mark) + '</strong></div>';
  const plate = '<div class="plate" data-mark="' + escapeHtml(mark) + '"><div class="subject">' + escapeHtml(subject) + '</div><h1 class="' +
    long.trim() + '">' + rich(title) + '</h1><p class="sub">' + escapeHtml(L.edition) + '</p><div class="pub">SALT</div></div>';
  const flag = ribbon ? '<div class="ribbon">' + escapeHtml(ribbon) + '</div>' : '';
  return '<section class="cover">' + art + badge + plate + flag + '</section>';
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
  const who = '<div class="who"><span>' + escapeHtml(L.name) + '</span><i></i><span>' + escapeHtml(L.className) + '</span><i></i><span>' + escapeHtml(L.date) + '</span><i></i></div>';
  return who + '<h2>' + escapeHtml(L.contents) + '</h2>' + rows.join('');
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

function promptVariable(prompt) {
  const src = String(prompt || '');
  const found = new Set();
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let m;
  while ((m = re.exec(src))) {
    const seg = (m[1] != null ? m[1] : m[2]).replace(/\\text\{[^}]*\}/g, ' ').replace(/\\[a-zA-Z]+/g, ' ');
    (seg.match(/[a-zA-Z]/g) || []).forEach((c) => found.add(c));
  }
  if (found.size === 1) return Array.from(found)[0];
  if (!found.size && /(^|[^a-zA-Z])x([^a-zA-Z]|$)/.test(src)) return 'x';
  return '';
}

/**
 * Chooses the writing area from what the item asks for: its section, the
 * chapter's check mode, the shape of the stored answer, and the stem wording.
 */
function answerPlan(q, mode) {
  const prompt = String(q.prompt || '');
  const answer = String(q.answer || '').replace(/\$/g, '').trim();
  const expression = String(q.expression || '');
  const section = q.section;
  const steps = (q.steps || []).length;
  const drawVerb = /(^|[.;:,?]\s+|\band\s+|\bthen\s+)(graph|plot|sketch|draw|mark|locate)\b/i.test(prompt) ||
    /(그리시오|그리세요|그려|나타내시오|나타내어|나타내세요|표시하|찍으)/.test(prompt);
  const isPair = /^\(?\s*[^,()]+,\s*[^,()]+\)?$/.test(answer);
  const isWord = section === 'word' || /word/i.test(String(q.type || ''));

  let blank = 'number';
  if (isWord) blank = 'wide';
  else if (mode === 'system' && isPair) blank = 'system';
  else if (mode === 'quad' || mode === 'roots' || mode === 'trigeq') blank = 'roots';
  else if (isPair && (mode === 'pair' || mode === 'vertex' || mode === 'mixed' || mode === 'conic')) blank = 'pair';
  else if (/^[a-zA-Z]\s*=/.test(answer) || (expression.includes('=') && !expression.includes(';') && (mode === 'equation' || mode === 'mixed'))) blank = 'solve';
  else if (/[a-zA-Z^]/.test(answer)) blank = 'wide';

  let layout = 'work';
  if (drawVerb && /(number line|수직선)/i.test(prompt)) layout = 'numberline';
  else if (drawVerb && !q.figure) layout = 'graph';
  else if (isWord) layout = 'word';
  else if (section === 'guided') layout = 'guided';

  const fallback = { basic: 2, intermediate: 3, advanced: 4, mastery: 3, word: 4, guided: 2 }[section] || 3;
  const depth = Math.max(2, Math.min(6, steps || fallback));
  return {
    layout: layout,
    blank: blank,
    depth: depth,
    percent: /%$/.test(answer),
    variable: blank === 'solve' || blank === 'roots' ? (promptVariable(prompt) || (blank === 'roots' ? 'x' : '')) : ''
  };
}

function blankGrid() {
  const size = 10;
  const cell = 10;
  const span = size * cell;
  let lines = '';
  for (let i = 0; i <= size; i += 1) {
    const p = i * cell;
    lines += '<line x1="' + p + '" y1="0" x2="' + p + '" y2="' + span + '"/><line x1="0" y1="' + p + '" x2="' + span + '" y2="' + p + '"/>';
  }
  const mid = span / 2;
  return '<div class="grid"><svg viewBox="-8 -8 ' + (span + 16) + ' ' + (span + 16) + '" role="img" aria-label="coordinate grid">' +
    '<g stroke="#c9ced6" stroke-width="0.5">' + lines + '</g>' +
    '<g stroke="#2b3340" stroke-width="1.1"><line x1="-4" y1="' + mid + '" x2="' + (span + 4) + '" y2="' + mid + '"/><line x1="' + mid + '" y1="-4" x2="' + mid + '" y2="' + (span + 4) + '"/></g>' +
    '<g fill="#2b3340" font-family="Arial, sans-serif" font-size="6" font-style="italic"><text x="' + (span + 5) + '" y="' + (mid + 6.5) + '" text-anchor="end">x</text><text x="' + (mid + 3) + '" y="-2.5">y</text></g>' +
    '<text x="' + (mid - 2) + '" y="' + (mid + 6.5) + '" text-anchor="end" fill="#2b3340" font-family="Arial, sans-serif" font-size="5.5">O</text>' +
    '</svg></div>';
}

function blankNumberLine() {
  const ticks = 20;
  const step = 9;
  const width = ticks * step;
  let marks = '';
  for (let i = 0; i <= ticks; i += 1) {
    const x = i * step;
    const tall = i % 5 === 0;
    marks += '<line x1="' + x + '" y1="' + (tall ? 5 : 7) + '" x2="' + x + '" y2="' + (tall ? 15 : 13) + '"/>';
  }
  return '<div class="nline"><svg viewBox="-8 0 ' + (width + 16) + ' 26" role="img" aria-label="number line">' +
    '<g stroke="#2b3340" stroke-width="1"><line x1="-6" y1="10" x2="' + (width + 6) + '" y2="10"/>' + marks + '</g>' +
    '<path d="M-8 10 l4 -2.6 v5.2 z M' + (width + 8) + ' 10 l-4 -2.6 v5.2 z" fill="#2b3340"/>' +
    '<text x="' + (width / 2) + '" y="24" text-anchor="middle" fill="#2b3340" font-family="Arial, sans-serif" font-size="7">0</text>' +
    '</svg></div>';
}

function answerBlank(plan, L) {
  const label = '<span class="lab">' + escapeHtml(L.answer) + '</span>';
  if (plan.blank === 'pair') return label + '<span class="paren">(</span><i class="bl tiny"></i><span class="paren">,</span><i class="bl tiny"></i><span class="paren">)</span>';
  if (plan.blank === 'system') return label + renderTex('x =') + '<i class="bl tiny"></i><span class="paren">,</span>' + renderTex('y =') + '<i class="bl tiny"></i>';
  if (plan.blank === 'roots') return label + renderTex(plan.variable + ' =') + '<i class="bl wide"></i>';
  if (plan.blank === 'solve' && plan.variable) return label + renderTex(plan.variable + ' =') + '<i class="bl"></i>';
  if (plan.blank === 'wide') return label + '<i class="bl wide"></i>';
  return label + '<i class="bl"></i>' + (plan.percent ? '<span class="paren">%</span>' : '');
}

function answerSpace(q, mode, L, hint) {
  const plan = answerPlan(q, mode);
  const fig = figureHtml(q.figure);
  const ans = '<div class="ans">' + answerBlank(plan, L) + '</div>';
  const tip = hint || '';
  if (plan.layout === 'guided') {
    const rows = Math.min(4, plan.depth);
    let steps = '';
    for (let i = 1; i <= rows; i += 1) steps += '<div class="st"><span>' + escapeHtml(L.step) + ' ' + i + '</span></div>';
    return fig + tip + '<div class="scaffold">' + steps + '</div>' + ans;
  }
  if (plan.layout === 'word') {
    return fig + tip + '<div class="work" style="min-height:' + (12 + plan.depth * 5) + 'mm"></div>' +
      '<div class="ans split"><span class="lab">' + escapeHtml(L.equation) + '</span><i class="bl grow"></i>' + answerBlank(plan, L) + '</div>';
  }
  if (plan.layout === 'graph') return tip + '<div class="draw">' + blankGrid() + '<div class="work"></div></div>' + ans;
  if (plan.layout === 'numberline') return fig + tip + blankNumberLine() + '<div class="work" style="min-height:8mm"></div>' + ans;
  if (fig) return tip + '<div class="draw">' + fig + '<div class="work"></div></div>' + ans;
  return tip + '<div class="work" style="min-height:' + (7 + plan.depth * 5.5) + 'mm"></div>' + ans;
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
  const mode = (part.chapter && part.chapter.checkMode) || '';
  return groups.map((g) => {
    const wide = g.items.some((q) => q.figure || ['graph', 'numberline'].includes(answerPlan(q, mode).layout));
    const cols = !wide && (g.section === 'basic' || g.section === 'intermediate') && g.items.length >= 4 ? ' cols' : '';
    const items = g.items.map((q) => {
      counter.n += 1;
      const hint = g.section === 'guided' && q.hint ? '<p class="hint">' + escapeHtml(L.hint) + ': ' + rich(q.hint) + '</p>' : '';
      return '<div class="problem"><div class="pnum">' + counter.n + '</div><div class="pbody"><p>' + rich(q.prompt) + '</p>' + answerSpace(q, mode, L, hint) + '</div></div>';
    }).join('');
    const score = g.section === 'mastery' ? '<p class="score">' + escapeHtml(L.score) + ' <i></i> / ' + g.items.length + '</p>' : '';
    return {
      kind: g.section,
      html: '<div id="ch-' + escapeHtml(id) + '-' + escapeHtml(g.section) + '"><h2 class="band">' + escapeHtml(sectionLabel(g.section, doc.language)) + '</h2>' + score + '<div class="practice' + cols + (g.section === 'mastery' ? ' test' : '') + '">' + items + '</div></div>'
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
  answerPlan,
  SECTION_LABELS,
  publishable,
  escapeHtml
};
