'use strict';

/**
 * AI 내신 문법 학습지 생성기 (A4 worksheet) for Class Tools / grammar-clinic.
 * Claude JSON → printable A4 HTML (concept column + lined notes).
 */

const crypto = require('crypto');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const { getUnitsByIds } = require('./grammarClinic/catalog');

const MAX_TOPICS = 8;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const jobs = new Map();

const GRADE_LABELS = {
  E6: '초6',
  M1: '중1',
  M2: '중2',
  M3: '중3',
  H1: '고1'
};

const THEME_COLORS = {
  blue: { accent: '#1e4d8c', soft: '#e8f0fa', ink: '#1a1f2e', line: '#c5d4eb' },
  green: { accent: '#2f6b4f', soft: '#e7f3ea', ink: '#1a2e24', line: '#b9d9c6' },
  purple: { accent: '#5b3d8a', soft: '#f0e8fa', ink: '#241a2e', line: '#d4c5eb' },
  orange: { accent: '#b85c2e', soft: '#faf0e8', ink: '#2e1f1a', line: '#ebcfc5' }
};

const SYSTEM_PROMPT = `당신은 한국 중·고등 영어 내신 문법 학습지를 만드는 전문 교사입니다.
반드시 유효한 JSON만 출력하세요. 설명 문장·마크다운·코드펜스는 금지입니다.

목표: 선생님이 바로 인쇄해 쓸 수 있는 '개념+예문+내신 함정' 학습지 페이지를 주제별로 1페이지씩 만듭니다.

규칙:
- pages 배열: 입력 주제마다 정확히 1개 page (순서 유지)
- unitNumber: "01","02",… 두 자리
- themeColor: blue | green | purple | orange 중 하나 (주제마다 순환 권장)
- steps: 3~5개. description에는 핵심 표현만 <mark>…</mark>, <strong>…</strong>, <em>…</em> HTML 허용 (다른 태그 금지)
- examples: 4~7개. tag는 짧은 한글 용법 라벨. en은 학년 수준 예문, ko는 자연스러운 해석
- examTips: 2~4개. badge는 "함정 주의"|"빈출"|"비교"|"암기" 중 하나
- 학년(schoolGrade)에 맞는 난이도·어휘. 초6은 쉽고 짧게, 고1은 내신·수능형 함정 포함
- 한국어 설명은 교사·학생 모두 읽기 쉽게
- JSON 스키마를 엄수`;

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

function claudeModel() {
  return String(
    process.env.GRAMMAR_WORKSHEET_CLAUDE_MODEL
    || process.env.GRAMMAR_CLINIC_CLAUDE_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

function normalizeGrade(g) {
  const s = String(g || 'M2').trim().toUpperCase();
  if (GRADE_LABELS[s]) return s;
  if (s === '초6' || s === 'E6') return 'E6';
  if (s === '고1' || s === 'H1') return 'H1';
  if (/^M[123]$/.test(s)) return s;
  return 'M2';
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

function stripUnsafeHtml(html) {
  return String(html || '')
    .replace(/<(?!\/?(?:mark|strong|em|b|i)\b)[^>]*>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '');
}

function sanitizePage(raw, index) {
  const colors = ['blue', 'green', 'purple', 'orange'];
  let theme = String(raw.themeColor || colors[index % 4]).toLowerCase();
  if (!THEME_COLORS[theme]) theme = colors[index % 4];
  const unitNumber = String(raw.unitNumber || String(index + 1).padStart(2, '0')).padStart(2, '0').slice(-2);
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const examples = Array.isArray(raw.examples) ? raw.examples : [];
  const examTips = Array.isArray(raw.examTips) ? raw.examTips : [];
  return {
    unitNumber,
    title: String(raw.title || ('문법 ' + unitNumber)).trim().slice(0, 80),
    themeColor: theme,
    steps: steps.slice(0, 6).map((s, i) => ({
      stepNum: String((s && s.stepNum) || ('STEP ' + (i + 1))).trim().slice(0, 16),
      title: String((s && s.title) || '').trim().slice(0, 80),
      description: stripUnsafeHtml((s && s.description) || '').slice(0, 1200)
    })).filter((s) => s.title || s.description),
    examples: examples.slice(0, 8).map((ex) => ({
      tag: String((ex && ex.tag) || '예문').trim().slice(0, 24),
      en: String((ex && ex.en) || '').trim().slice(0, 240),
      ko: String((ex && ex.ko) || '').trim().slice(0, 240)
    })).filter((ex) => ex.en),
    examTips: examTips.slice(0, 5).map((t) => ({
      badge: String((t && t.badge) || '함정 주의').trim().slice(0, 16),
      title: String((t && t.title) || '').trim().slice(0, 80),
      detail: String((t && t.detail) || '').trim().slice(0, 600)
    })).filter((t) => t.title || t.detail)
  };
}

function sanitizePacket(parsed, topics) {
  const pagesIn = (parsed && Array.isArray(parsed.pages)) ? parsed.pages : [];
  const pages = [];
  const n = Math.max(topics.length, pagesIn.length, 1);
  for (let i = 0; i < n && i < MAX_TOPICS; i++) {
    const raw = pagesIn[i] || { title: topics[i] || ('문법 ' + (i + 1)) };
    if (!raw.title && topics[i]) raw.title = topics[i];
    pages.push(sanitizePage(raw, i));
  }
  if (!pages.length) {
    const err = new Error('학습지 페이지를 만들지 못했습니다. 주제를 바꿔 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  return { pages };
}

async function askWorksheetJson(prompt) {
  if (!isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  try {
    const result = await askGemini(prompt, {
      provider: 'claude',
      noGeminiFallback: false,
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.5,
      maxOutputTokens: 12000,
      responseMimeType: 'application/json',
      model: claudeModel()
    });
    const text = (result && (result.answer || result.text)) || result;
    const parsed = extractJson(text);
    if (!parsed) {
      const err = new Error('AI returned invalid JSON for worksheet.');
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

function buildUserPrompt({ title, grade, topics, notes, units }) {
  const gradeLabel = GRADE_LABELS[grade] || grade;
  const unitHints = (units || []).map((u) => ({
    unitId: u.unitId,
    subCategory: u.subCategory,
    category: u.category,
    coreRules: u.coreRules,
    errorTraps: u.errorTraps
  }));
  return [
    '다음 입력으로 내신 문법 학습지 JSON을 생성하라.',
    'worksheetTitle: ' + title,
    'schoolGrade: ' + grade + ' (' + gradeLabel + ')',
    '',
    '[topics — 각 주제마다 pages[]에 1페이지]',
    JSON.stringify(topics, null, 2),
    '',
    unitHints.length ? ('[catalogHints]\n' + JSON.stringify(unitHints, null, 2)) : '',
    notes ? ('\n[teacherNotes]\n' + notes) : '',
    '',
    '출력 스키마:',
    JSON.stringify({
      pages: [{
        unitNumber: '01',
        title: '주제명',
        themeColor: 'blue',
        steps: [{ stepNum: 'STEP 1', title: '소제목', description: 'HTML <mark>하이라이트</mark> 포함 설명' }],
        examples: [{ tag: '용법태그', en: 'English example', ko: '한글 해석' }],
        examTips: [{ badge: '함정 주의', title: '포인트', detail: '상세·오답 비교' }]
      }]
    }, null, 2)
  ].filter(Boolean).join('\n');
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLinedNotes() {
  let lines = '';
  for (let i = 0; i < 28; i++) lines += '<div class="note-line"></div>';
  return '<div class="notes-col"><div class="notes-head" contenteditable="true">My Notes</div>' + lines + '</div>';
}

function renderPage(page, meta) {
  const theme = THEME_COLORS[page.themeColor] || THEME_COLORS.blue;
  const steps = (page.steps || []).map((s) =>
    '<div class="step">' +
    '<div class="step-num" contenteditable="true">' + esc(s.stepNum) + '</div>' +
    '<div class="step-body">' +
    '<div class="step-title" contenteditable="true">' + esc(s.title) + '</div>' +
    '<div class="step-desc" contenteditable="true">' + (s.description || '') + '</div>' +
    '</div></div>'
  ).join('');

  const examples = (page.examples || []).map((ex) =>
    '<div class="ex">' +
    '<span class="ex-tag" contenteditable="true">' + esc(ex.tag) + '</span>' +
    '<div class="ex-en" contenteditable="true">' + esc(ex.en) + '</div>' +
    '<div class="ex-ko" contenteditable="true">' + esc(ex.ko) + '</div>' +
    '</div>'
  ).join('');

  const tips = (page.examTips || []).map((t) =>
    '<div class="tip">' +
    '<span class="tip-badge" contenteditable="true">' + esc(t.badge) + '</span>' +
    '<div class="tip-title" contenteditable="true">' + esc(t.title) + '</div>' +
    '<div class="tip-detail" contenteditable="true">' + esc(t.detail) + '</div>' +
    '</div>'
  ).join('');

  return (
    '<section class="a4-page" style="--accent:' + theme.accent + ';--soft:' + theme.soft +
    ';--ink:' + theme.ink + ';--rule:' + theme.line + '">' +
    '<div class="page-grid">' +
    '<div class="concept-col">' +
    '<header class="page-head">' +
    '<div class="unit-pill" contenteditable="true">UNIT ' + esc(page.unitNumber) + '</div>' +
    '<div class="page-meta" contenteditable="true">' + esc(meta.gradeLabel) + ' · Salt Morning</div>' +
    '<h1 contenteditable="true">' + esc(page.title) + '</h1>' +
    '<div class="ws-title" contenteditable="true">' + esc(meta.title) + '</div>' +
    '</header>' +
    (steps ? '<div class="block"><h2 contenteditable="true">개념 정리</h2>' + steps + '</div>' : '') +
    (examples ? '<div class="block"><h2 contenteditable="true">예문 클리닉</h2><div class="ex-list">' + examples + '</div></div>' : '') +
    (tips ? '<div class="block"><h2 contenteditable="true">내신 포인트</h2><div class="tip-list">' + tips + '</div></div>' : '') +
    '</div>' +
    renderLinedNotes() +
    '</div></section>'
  );
}

function renderWorksheetHtml(packet, meta) {
  const pagesHtml = (packet.pages || []).map((p) => renderPage(p, meta)).join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(meta.title)} — 내신 문법 학습지</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;600;700&family=Nunito:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  :root { --page-w: 210mm; --page-h: 297mm; --notes-w: 44mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    background: #e8edf5;
    color: #1a1f2e;
    font-family: 'Noto Sans KR', 'Nunito', sans-serif;
    font-size: 15.5px;
    line-height: 1.55;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 20;
    display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;
    margin: 0 auto 14px; max-width: calc(var(--page-w) + 40px);
    padding: 10px 12px; background: rgba(255,255,255,0.95);
    border: 1px solid #d8deea; border-radius: 12px;
    box-shadow: 0 8px 20px rgba(26,31,46,0.08);
  }
  .toolbar strong { font-family: Nunito, sans-serif; color: #1e4d8c; }
  .toolbar .hint { color: #5c6578; font-size: 0.82rem; flex: 1; }
  .toolbar button {
    border: none; border-radius: 9px; padding: 0.45rem 0.85rem;
    font: inherit; font-weight: 700; cursor: pointer;
    background: linear-gradient(135deg, #24599e, #1e4d8c); color: #fff;
  }
  .a4-page {
    width: var(--page-w); min-height: var(--page-h);
    margin: 0 auto 18px; background: #fff;
    box-shadow: 0 12px 32px rgba(26,31,46,0.12);
    border: 1px solid #d8deea; overflow: hidden;
    page-break-after: always; break-after: page;
  }
  .page-grid {
    display: grid;
    grid-template-columns: 1fr var(--notes-w);
    min-height: var(--page-h);
  }
  .concept-col { padding: 14mm 11mm 12mm 12mm; color: var(--ink); }
  .notes-col {
    border-left: 1.5px solid var(--rule);
    background: linear-gradient(180deg, var(--soft), #fff 40%);
    padding: 12mm 6mm 10mm;
  }
  .notes-head {
    font-family: Jua, 'Noto Sans KR', sans-serif;
    font-size: 1.05rem; color: var(--accent); margin-bottom: 8px;
  }
  .note-line {
    height: 8.2mm; border-bottom: 1px solid var(--rule); opacity: 0.85;
  }
  .page-head { margin-bottom: 10px; }
  .unit-pill {
    display: inline-block; font-family: Nunito, sans-serif; font-weight: 800;
    font-size: 0.72rem; letter-spacing: 0.06em; color: #fff;
    background: var(--accent); border-radius: 999px; padding: 0.2rem 0.65rem;
  }
  .page-meta { margin-top: 6px; font-size: 0.75rem; color: #5c6578; font-weight: 600; }
  h1 {
    font-family: Jua, 'Noto Sans KR', sans-serif;
    font-size: 1.65rem; margin: 0.35rem 0 0.15rem; color: var(--accent);
    font-weight: 400; line-height: 1.25;
  }
  .ws-title { font-size: 0.78rem; color: #5c6578; font-weight: 600; }
  .block { margin-top: 12px; }
  .block h2 {
    font-family: Nunito, 'Noto Sans KR', sans-serif;
    font-size: 0.95rem; margin: 0 0 8px; color: var(--accent);
    border-bottom: 2px solid var(--soft); padding-bottom: 4px;
  }
  .step { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0.45rem; margin-bottom: 0.55rem; }
  .step-num {
    font-family: Nunito, sans-serif; font-weight: 800; font-size: 0.72rem;
    color: var(--accent); background: var(--soft); border-radius: 8px;
    padding: 0.35rem 0.3rem; text-align: center; height: fit-content;
  }
  .step-title { font-weight: 700; margin-bottom: 0.15rem; }
  .step-desc mark { background: #fff3a3; padding: 0 0.15em; border-radius: 3px; }
  .ex-list, .tip-list { display: grid; gap: 0.45rem; }
  .ex {
    border: 1px solid var(--rule); border-radius: 10px; padding: 0.45rem 0.55rem;
    background: #fff;
  }
  .ex-tag {
    display: inline-block; font-size: 0.7rem; font-weight: 700;
    color: var(--accent); background: var(--soft); border-radius: 999px;
    padding: 0.12rem 0.45rem; margin-bottom: 0.2rem;
  }
  .ex-en { font-family: Nunito, 'Noto Sans KR', sans-serif; font-weight: 700; }
  .ex-ko { font-size: 0.88rem; color: #4a5568; margin-top: 0.1rem; }
  .tip {
    border-left: 3px solid var(--accent); padding: 0.4rem 0.55rem;
    background: var(--soft); border-radius: 0 10px 10px 0;
  }
  .tip-badge {
    display: inline-block; font-size: 0.68rem; font-weight: 800;
    color: #fff; background: var(--accent); border-radius: 6px;
    padding: 0.1rem 0.4rem; margin-bottom: 0.2rem;
  }
  .tip-title { font-weight: 700; }
  .tip-detail { font-size: 0.88rem; color: #3d4658; margin-top: 0.15rem; }
  [contenteditable="true"] { outline: none; border-radius: 4px; }
  [contenteditable="true"]:hover { box-shadow: inset 0 0 0 1px rgba(30,77,140,0.25); }
  [contenteditable="true"]:focus { box-shadow: inset 0 0 0 2px rgba(30,77,140,0.45); background: #fffef8; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .a4-page {
      margin: 0; border: none; box-shadow: none;
      width: var(--page-w); min-height: var(--page-h);
    }
    [contenteditable="true"]:hover,
    [contenteditable="true"]:focus { box-shadow: none; background: transparent; }
  }
  @page { size: A4; margin: 0; }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <strong>내신 문법 학습지</strong>
    <span class="hint">텍스트를 클릭해 수정한 뒤 PDF 저장 / 인쇄하세요.</span>
    <button type="button" onclick="window.print()">PDF 저장 / 인쇄</button>
  </div>
  ${pagesHtml}
  <script>
    document.querySelectorAll('[contenteditable]').forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && el.tagName !== 'DIV') {
          e.preventDefault();
        }
      });
    });
  </script>
</body>
</html>`;
}

function publicJob(job) {
  const out = {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error || undefined
  };
  if (job.packet) {
    out.packet = job.packet;
    out.htmlPreview = job.htmlPreview;
    out.htmlUrl = '/api/grammar-clinic/worksheet/jobs/' + job.id + '/html';
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

function resolveTopics(opts) {
  const unitIds = Array.isArray(opts.unitIds) ? opts.unitIds.map(String) : [];
  const units = unitIds.length ? getUnitsByIds(unitIds) : [];
  const customTopics = Array.isArray(opts.topics)
    ? opts.topics.map((t) => String(t || '').trim()).filter(Boolean)
    : [];
  const single = String(opts.customTopic || '').trim();
  if (single) {
    single.split(/[\n,;/|]+/).map((s) => s.trim()).filter(Boolean).forEach((t) => customTopics.push(t));
  }
  const fromUnits = units.map((u) => u.subCategory);
  const topics = [];
  const seen = new Set();
  fromUnits.concat(customTopics).forEach((t) => {
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    topics.push(t);
  });
  return { topics: topics.slice(0, MAX_TOPICS), units };
}

function startGenerateJob(opts, ownerKey) {
  pruneJobs();
  opts = opts || {};
  const { topics, units } = resolveTopics(opts);
  if (!topics.length) {
    const err = new Error('문법 주제를 1개 이상 선택하거나 직접 입력하세요.');
    err.statusCode = 400;
    throw err;
  }
  const grade = normalizeGrade(opts.grade);
  const notes = String(opts.notes || '').trim().slice(0, 800);
  const title = String(opts.title || '').trim()
    || (topics.slice(0, 2).join(' · ') + ' 학습지');

  const id = newId('gw');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { message: 'Claude가 학습지를 쓰는 중…', pct: 12 },
    input: { title, grade, topics, notes, unitIds: units.map((u) => u.unitId) },
    packet: null,
    htmlPreview: null,
    error: null
  };
  jobs.set(id, job);

  setImmediate(async () => {
    try {
      touch(job, { progress: { message: '주제별 개념·예문·함정 정리 중…', pct: 35 } });
      const parsed = await askWorksheetJson(buildUserPrompt({
        title, grade, topics, notes, units
      }));
      touch(job, { progress: { message: 'A4 학습지 레이아웃 만드는 중…', pct: 75 } });
      const packet = sanitizePacket(parsed, topics);
      const meta = {
        title,
        grade,
        gradeLabel: GRADE_LABELS[grade] || grade
      };
      const htmlPreview = renderWorksheetHtml(packet, meta);
      touch(job, {
        status: 'done',
        packet,
        htmlPreview,
        progress: { message: '완료', pct: 100 }
      });
    } catch (e) {
      touch(job, {
        status: 'error',
        error: e.message || '학습지 생성 실패',
        progress: { message: '실패', pct: 100 }
      });
    }
  });

  return { jobId: id, status: job.status, progress: job.progress };
}

module.exports = {
  startGenerateJob,
  getJob,
  publicJob,
  claudeModel,
  GRADE_LABELS,
  renderWorksheetHtml,
  isClaudeConfigured
};
