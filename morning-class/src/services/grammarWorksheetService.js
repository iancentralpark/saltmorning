'use strict';

/**
 * AI 내신 문법 학습지 생성기 (A4 master note) for Class Tools / grammar-clinic.
 * Style target: Salt Morning “핵심 영문법 마스터 노트”
 * — 좌측 개념 STEP + 예문 + 내신 포인트, 우측 필기란(44mm), 주제당 1페이지.
 */

const crypto = require('crypto');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const { dualVerifyGrammar, ACCURACY_LAW } = require('./grammarVerifyService');
const { getUnitsByIds } = require('./grammarClinic/catalog');
const { isOpsDbEnabled, query, table } = require('../db/pool');

const MAX_TOPICS = 8;
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const jobs = new Map();
const persistTimers = new Map();
let jobsSchemaReady = false;

const GRADE_LABELS = {
  E6: '초6',
  M1: '중1',
  M2: '중2',
  M3: '중3',
  H1: '고1'
};

const THEME_COLORS = ['blue', 'green', 'purple', 'orange'];

const SYSTEM_PROMPT = `당신은 한국 중학생을 위한 '핵심 영문법 마스터 노트'를 쓰는 친절한 영어 선생님입니다.
반드시 유효한 JSON만 출력하세요. 설명 문장·마크다운·코드펜스는 금지입니다.

목표: 주제마다 A4 1장. 왼쪽은 개념·예문·내신 포인트, 오른쪽은 학생이 필기할 빈 줄노트.
선생님이 바로 인쇄해 수업·숙제에 씁니다.

[말투 · 구성 — 절대 지키세요]
- 학생이 바로 이해하는 구어체 설명. "~이 뭐예요?", 비유(변신 로봇, 양념, 풀), 암기 주문(앞글자 따기) 환영.
- 딱딱한 사전 정의만 나열하지 말 것. 시험에 나오는 핵심만 짧고 또렷하게.
- STEP는 보통 2~3개 (최대 4). 흐름 예:
  STEP 1 기본 개념 → STEP 2 핵심 공식/구분 → (필요 시) STEP 3 합체·시험용 정리
- examples: 4~6개 (기본 5). 학년 어휘. en에 핵심 표현은 <span class="highlight">…</span> 가능.
  tag는 짧은 한글 라벨(목적, ~할 때, 날씨, 간접목적어 등).
- examTips: 1~2개 (최대 2). badge는 다음 중 하나:
  "함정 주의" | "꿀팁" | "초특급 단골" | "출제 1순위" | "콤마 규칙" | "서술형 주의"
  detail은 1~2줄. ❌/⭕ 대조를 짧게. 긴 문단·3개 이상 대조 금지.
- description / detail 안의 허용 HTML만:
  <mark>…</mark>, <strong>…</strong>, <em>…</em>, <span class="highlight">…</span>, <span class="en-bold">…</span>, <br>, <u>…</u>
- themeColor: blue | green | purple | orange (주제마다 순환)
- unitNumber: "01","02",… / unitBadgeLabel 예: "핵심 영문법 01"
- **인쇄 분량(매우 중요)**: 상단 브랜드+헤더+STEP+예문+내신포인트+푸터가 A4 한 장에 반드시 들어가야 함.
  STEP description은 각 2~3문장 이내. 예문 ko는 한 줄. 넘치면 예문·팁부터 줄일 것.
- 학년(schoolGrade)에 맞는 난이도. 초6은 더 쉽고 짧게, 고1은 내신·서술형 함정 강화.

` + ACCURACY_LAW;

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
    console.warn('worksheet jobs schema ensure failed', e.message);
  }
}

function worksheetResult(job) {
  if (!job.packet && !job.htmlPreview && !(job.warnings && job.warnings.length) && !job.input) return null;
  return {
    packet: job.packet || null,
    htmlPreview: job.htmlPreview || null,
    warnings: job.warnings || [],
    input: job.input || null,
    kind: 'worksheet'
  };
}

async function persistJob(job, immediate) {
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
          worksheetResult(job) ? JSON.stringify(worksheetResult(job)) : null,
          job.error || null,
          job.createdAt || Date.now(),
          job.updatedAt || Date.now()
        ]
      );
    } catch (e) {
      console.warn('worksheet job persist failed', job.id, e.message);
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
  }, 800));
}

async function loadJobFromDb(jobId) {
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
    const result = row.result || {};
    if (result.kind && result.kind !== 'worksheet') return null;
    const job = {
      id: row.id,
      ownerKey: row.owner_key || '',
      status: row.status,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
      progress: row.progress || {},
      input: result.input || null,
      packet: result.packet || null,
      htmlPreview: result.htmlPreview || null,
      warnings: result.warnings || [],
      error: row.error || null,
      fromDb: true
    };
    if (job.status === 'running' && !jobs.has(job.id)) {
      job.status = 'error';
      job.error = '서버가 재시작되어 학습지 생성이 중단되었습니다. 다시 만들어 주세요.';
      job.progress = Object.assign({}, job.progress, { message: job.error, pct: 100 });
      job.updatedAt = Date.now();
      await persistJob(job, true);
    }
    jobs.set(job.id, job);
    return job;
  } catch (e) {
    console.warn('worksheet job load failed', jobId, e.message);
    return null;
  }
}

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
}

function stripUnsafeHtml(html) {
  return String(html || '')
    .replace(/<(?!\/?(?:mark|strong|em|b|i|br|u|span)\b)[^>]*>/gi, '')
    .replace(/\sson\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<\/?span(?![^>]*class=(["'])(?:highlight|en-bold)\1)[^>]*>/gi, '')
    .replace(/javascript:/gi, '');
}

const TIP_BADGES = new Set([
  '함정 주의', '꿀팁', '초특급 단골', '출제 1순위', '콤마 규칙', '서술형 주의', '빈출', '비교', '암기'
]);

function sanitizePage(raw, index) {
  let theme = String(raw.themeColor || THEME_COLORS[index % 4]).toLowerCase();
  if (!THEME_COLORS.includes(theme)) theme = THEME_COLORS[index % 4];
  const unitNumber = String(raw.unitNumber || String(index + 1).padStart(2, '0')).padStart(2, '0').slice(-2);
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const examples = Array.isArray(raw.examples) ? raw.examples : [];
  const examTips = Array.isArray(raw.examTips) ? raw.examTips : [];
  const badgeDefault = String((raw.unitBadgeLabel || ('핵심 영문법 ' + unitNumber))).trim().slice(0, 24);
  return {
    unitNumber,
    unitBadgeLabel: badgeDefault,
    title: String(raw.title || ('문법 ' + unitNumber)).trim().slice(0, 80),
    themeColor: theme,
    examplesHeading: String(raw.examplesHeading || '교과서 필수 예문으로 익히기').trim().slice(0, 40),
    examHeading: String(raw.examHeading || '내신 100점 포인트 & 주의할 점!').trim().slice(0, 48),
    steps: steps.slice(0, 3).map((s, i) => ({
      stepNum: String((s && s.stepNum) || ('STEP ' + (i + 1))).trim().slice(0, 16),
      title: String((s && s.title) || '').trim().slice(0, 72),
      description: stripUnsafeHtml((s && s.description) || '').slice(0, 700)
    })).filter((s) => s.title || s.description),
    examples: examples.slice(0, 6).map((ex) => ({
      tag: String((ex && ex.tag) || '').trim().slice(0, 20),
      en: stripUnsafeHtml((ex && ex.en) || '').slice(0, 220),
      ko: stripUnsafeHtml((ex && ex.ko) || '').slice(0, 160)
    })).filter((ex) => ex.en),
    examTips: examTips.slice(0, 2).map((t) => {
      let badge = String((t && t.badge) || '함정 주의').trim().slice(0, 16);
      if (!TIP_BADGES.has(badge)) badge = '함정 주의';
      return {
        badge,
        title: String((t && t.title) || '').trim().slice(0, 72),
        detail: stripUnsafeHtml((t && t.detail) || '').slice(0, 420)
      };
    }).filter((t) => t.title || t.detail)
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
      temperature: 0.55,
      maxOutputTokens: 14000,
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
    '다음 입력으로 「핵심 영문법 마스터 노트」 JSON을 생성하라.',
    'worksheetTitle: ' + title,
    'schoolGrade: ' + grade + ' (' + gradeLabel + ')',
    '',
    '레이아웃 참고(반드시 이 구조의 콘텐츠를 채울 것):',
    '- 상단 브랜드 "Salt Academy 핵심 영문법" + unitBadge + 제목 + 이름/날짜는 HTML이 그림',
    '- STEP 카드 2~3개 (친절한 질문형 소제목, 설명은 짧게)',
    '- 예문 박스 4~6개 (✔ 리스트, tag + 영어 + 한글 한 줄)',
    '- 내신 포인트 1~2개만: ❌/⭕ 대조를 짧게 (A4에 잘리지 않게)',
    '- 우측 필기란은 렌더러가 그림 — JSON에 넣지 말 것',
    '- A4 1장에 반드시 들어가게 분량을 줄일 것',
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
        unitBadgeLabel: '핵심 영문법 01',
        title: 'to 부정사의 부사적 용법',
        themeColor: 'blue',
        examplesHeading: '교과서 필수 예문으로 익히기',
        examHeading: '내신 100점 포인트 & 주의할 점!',
        steps: [{
          stepNum: 'STEP 1',
          title: '‘to 부정사’가 뭐예요?',
          description: '<span class="en-bold">to</span> + <span class="highlight">동사원형</span> …'
        }],
        examples: [{
          tag: '목적',
          en: 'I went to the library <span class="highlight">to study</span> English.',
          ko: '나는 영어를 <strong>공부하기 위해서</strong> 도서관에 갔다.'
        }],
        examTips: [{
          badge: '함정 주의',
          title: '‘to + 명사’에 속지 마세요!',
          detail: 'I went <span class="en-bold">to school</span>. ❌ … / I went there <span class="en-bold">to meet</span> him. ⭕'
        }]
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

function renderPage(page, meta, pageIndex, pageTotal) {
  const theme = page.themeColor || 'blue';
  const steps = (page.steps || []).map((s) =>
    '<div class="step-box">' +
    '<div class="step-title"><span class="step-num" contenteditable="true">' + esc(s.stepNum) +
    '</span><span contenteditable="true">' + esc(s.title) + '</span></div>' +
    '<div class="step-desc" contenteditable="true">' + (s.description || '') + '</div>' +
    '</div>'
  ).join('');

  const examples = (page.examples || []).map((ex) =>
    '<li>' +
    '<span class="en-sent" contenteditable="true">' + (ex.en || '') + '</span>' +
    '<span class="ko-trans">' +
    (ex.tag ? '<span class="tag" contenteditable="true">' + esc(ex.tag) + '</span> ' : '') +
    '<span contenteditable="true">' + (ex.ko || '') + '</span>' +
    '</span></li>'
  ).join('');

  const tips = (page.examTips || []).map((t) =>
    '<p>' +
    '<span class="vs-badge" contenteditable="true">' + esc(t.badge) + '</span> ' +
    (t.title ? '<strong contenteditable="true">' + esc(t.title) + '</strong><br>' : '') +
    '<span contenteditable="true">' + (t.detail || '') + '</span>' +
    '</p>'
  ).join('');

  return (
    '<section class="page theme-' + esc(theme) + '">' +
    '<div class="brand-bar" contenteditable="true">Salt Academy 핵심 영문법</div>' +
    '<header class="page-header">' +
    '<div>' +
    '<span class="unit-badge" contenteditable="true">' + esc(page.unitBadgeLabel) + '</span>' +
    '<h1 class="page-title" contenteditable="true">' + esc(page.title) + '</h1>' +
    '</div>' +
    '<div class="student-info">이름: ______________ &nbsp;|&nbsp; 날짜: ____/____</div>' +
    '</header>' +
    '<div class="content-wrapper">' +
    '<div class="main-column">' +
    steps +
    (examples
      ? '<div class="example-box"><div class="box-header" contenteditable="true">✏️ ' +
        esc(page.examplesHeading || '교과서 필수 예문으로 익히기') +
        '</div><ul class="example-list">' + examples + '</ul></div>'
      : '') +
    (tips
      ? '<div class="exam-box"><div class="exam-title" contenteditable="true">🚨 ' +
        esc(page.examHeading || '내신 100점 포인트 & 주의할 점!') +
        '</div><div class="exam-content">' + tips + '</div></div>'
      : '') +
    '</div>' +
    '<aside class="memo-column">' +
    '<div class="memo-header">📝 나만의 필기 노트</div>' +
    '<div class="memo-lines"></div>' +
    '</aside>' +
    '</div>' +
    '<footer class="page-footer" contenteditable="true">' +
    'Salt Academy · ' + esc(meta.title || '핵심 영문법') + ' · ' +
    esc(meta.gradeLabel) + ' · ' + (pageIndex + 1) + ' / ' + pageTotal +
    '</footer>' +
    '</section>'
  );
}

function renderWorksheetHtml(packet, meta) {
  const pages = packet.pages || [];
  const pagesHtml = pages.map((p, i) => renderPage(p, meta, i, pages.length)).join('\n');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(meta.title)} — 핵심 영문법 마스터 노트</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;700;900&family=Nunito:wght@700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --font-title: 'Jua', sans-serif;
    --font-body: 'Noto Sans KR', sans-serif;
    --font-en: 'Nunito', 'Noto Sans KR', sans-serif;
    --text-main: #22252a;
    --text-sub: #4b5563;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #eef2f6;
    font-family: var(--font-body);
    color: var(--text-main);
    font-size: 15.5px; /* reference: 중학생 가독성 */
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .control-bar {
    max-width: 210mm; margin: 16px auto 0;
    background: #1e293b; color: #fff;
    padding: 12px 20px; border-radius: 12px;
    display: flex; justify-content: space-between; align-items: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  .control-bar span { font-size: 14px; }
  .print-btn {
    background: #38bdf8; color: #0f172a; border: none;
    padding: 8px 18px; border-radius: 8px; font-weight: 700;
    font-size: 14px; cursor: pointer; font-family: inherit;
  }
  /* Match reference A4 padding; keep slight extra bottom for printer bleed. */
  .page {
    width: 210mm; height: 297mm; background: #fff;
    margin: 16px auto; padding: 12mm 13mm 14mm 15mm;
    box-shadow: 0 8px 24px rgba(0,0,0,0.08); border-radius: 4px;
    display: flex; flex-direction: column; justify-content: space-between;
    page-break-after: always; break-after: page;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .brand-bar {
    font-family: var(--font-title); font-size: 14px; letter-spacing: 0.04em;
    color: #64748b; margin-bottom: 2px; line-height: 1.2; flex-shrink: 0;
  }
  .page-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding-bottom: 8px; border-bottom: 3px solid var(--theme-main); margin-bottom: 10px;
    flex-shrink: 0;
  }
  .unit-badge {
    display: inline-block; background: var(--theme-main); color: #fff;
    font-family: var(--font-title); font-size: 15px; padding: 3px 12px;
    border-radius: 20px; margin-bottom: 4px; letter-spacing: 0.5px;
  }
  .page-title {
    font-family: var(--font-title); font-size: 28px; color: #111827; line-height: 1.15;
  }
  .student-info {
    font-size: 13.5px; color: var(--text-sub); font-weight: 500;
    border: 1.5px dashed #cbd5e1; padding: 5px 12px; border-radius: 8px; background: #f8fafc;
    white-space: nowrap;
  }
  .content-wrapper {
    display: grid; grid-template-columns: 1fr 44mm; gap: 6mm;
    flex: 1; min-height: 0; overflow: hidden;
  }
  .main-column {
    /* Reference uses space-between, but that stretches empty gaps — pack from top. */
    display: flex; flex-direction: column; justify-content: flex-start;
    gap: 8px; min-width: 0; min-height: 0; overflow: hidden;
  }
  .step-box {
    background: var(--theme-bg); border-left: 5px solid var(--theme-main);
    border-radius: 0 10px 10px 0; padding: 9px 13px; flex: 0 0 auto;
  }
  .step-title {
    font-family: var(--font-title); font-size: 17.5px; color: var(--theme-dark);
    margin-bottom: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .step-num {
    background: var(--theme-main); color: #fff; font-size: 12.5px;
    padding: 1px 8px; border-radius: 10px; font-family: var(--font-en);
  }
  .step-desc { font-size: 14.8px; color: #1f2937; }
  .highlight {
    background: linear-gradient(transparent 55%, var(--theme-highlight) 55%);
    font-weight: 700; padding: 0 2px;
  }
  mark {
    background: linear-gradient(transparent 55%, var(--theme-highlight) 55%);
    font-weight: 700; padding: 0 2px;
  }
  .en-bold { font-family: var(--font-en); font-weight: 800; color: var(--theme-dark); }
  .example-box {
    border: 2px solid var(--theme-border); border-radius: 12px;
    padding: 10px 14px; background: #fff; flex: 0 0 auto;
  }
  .box-header {
    font-family: var(--font-title); font-size: 17px; color: var(--theme-dark);
    margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
  }
  .example-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .example-list li { padding-left: 18px; position: relative; font-size: 14.8px; }
  .example-list li::before {
    content: "✔"; position: absolute; left: 0; color: var(--theme-main); font-weight: bold;
  }
  .en-sent {
    font-family: var(--font-en); font-size: 15.5px; font-weight: 700;
    color: #111827; display: block;
  }
  .ko-trans { font-size: 13.8px; color: #4b5563; display: block; }
  .tag {
    display: inline-block; font-size: 12px; font-weight: 700; padding: 1px 6px;
    border-radius: 5px; background: var(--theme-bg); color: var(--theme-dark);
    margin-right: 4px; vertical-align: middle;
  }
  .exam-box {
    background: #fffbeb; border: 2px solid #f59e0b; border-radius: 12px;
    padding: 10px 14px; flex: 0 0 auto;
  }
  .exam-title { font-family: var(--font-title); font-size: 17px; color: #b45309; margin-bottom: 5px; }
  .exam-content { font-size: 14.3px; color: #374151; }
  .exam-content p + p { margin-top: 5px; }
  .vs-badge {
    display: inline-block; background: #ef4444; color: #fff; font-size: 12px;
    font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-right: 4px;
  }
  .memo-column {
    border: 2px dashed #cbd5e1; border-radius: 12px; background: #fafaf9;
    padding: 10px; display: flex; flex-direction: column; min-height: 0;
  }
  .memo-header {
    font-family: var(--font-title); font-size: 15px; color: #64748b;
    text-align: center; padding-bottom: 6px; border-bottom: 1.5px solid #e2e8f0; margin-bottom: 6px;
    flex-shrink: 0;
  }
  .memo-lines {
    flex: 1;
    background-image: repeating-linear-gradient(
      transparent, transparent 27px, #e2e8f0 27px, #e2e8f0 28px
    );
  }
  .page-footer {
    text-align: right; font-size: 12px; color: #94a3b8;
    margin-top: 6px; flex-shrink: 0;
  }
  .theme-blue {
    --theme-main: #2563eb; --theme-dark: #1e40af; --theme-bg: #eff6ff;
    --theme-border: #93c5fd; --theme-highlight: #bfdbfe;
  }
  .theme-green {
    --theme-main: #059669; --theme-dark: #065f46; --theme-bg: #ecfdf5;
    --theme-border: #6ee7b7; --theme-highlight: #a7f3d0;
  }
  .theme-purple {
    --theme-main: #7c3aed; --theme-dark: #5b21b6; --theme-bg: #f5f3ff;
    --theme-border: #c4b5fd; --theme-highlight: #ddd6fe;
  }
  .theme-orange {
    --theme-main: #ea580c; --theme-dark: #9a3412; --theme-bg: #fff7ed;
    --theme-border: #fdba74; --theme-highlight: #fed7aa;
  }
  [contenteditable="true"] { outline: none; border-radius: 3px; }
  [contenteditable="true"]:hover { box-shadow: inset 0 0 0 1px rgba(37,99,235,0.25); }
  [contenteditable="true"]:focus { box-shadow: inset 0 0 0 2px rgba(37,99,235,0.4); background: #fffef8; }
  @media print {
    html, body { background: none !important; margin: 0 !important; padding: 0 !important; }
    .control-bar { display: none !important; }
    .page {
      margin: 0 !important; box-shadow: none !important; border-radius: 0 !important;
      width: 210mm; height: 297mm;
      padding: 11mm 12mm 14mm 14mm !important;
      page-break-inside: avoid; break-inside: avoid;
    }
    [contenteditable="true"]:hover,
    [contenteditable="true"]:focus { box-shadow: none; background: transparent; }
  }
  @page { size: A4 portrait; margin: 0; }
</style>
</head>
<body>
  <div class="control-bar">
    <span>🖨️ <strong>A4 세로 인쇄</strong>에 최적화 · 주제별 1페이지 (총 ${pages.length}페이지). 문구를 클릭해 수정할 수 있어요.</span>
    <button type="button" class="print-btn" onclick="window.print()">바로 인쇄 / PDF 저장</button>
  </div>
  ${pagesHtml}
  <script>
    document.querySelectorAll('[contenteditable]').forEach(function (el) {
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && el.tagName !== 'DIV' && el.tagName !== 'P') {
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
    error: job.error || undefined,
    warnings: job.warnings || []
  };
  if (job.packet) {
    out.packet = job.packet;
    out.htmlPreview = job.htmlPreview;
    out.htmlUrl = '/api/grammar-clinic/worksheet/jobs/' + job.id + '/html';
  }
  return out;
}

async function getJob(jobId, ownerKey) {
  pruneJobs();
  let job = jobs.get(String(jobId || ''));
  if (!job) job = await loadJobFromDb(jobId);
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
    || (topics.slice(0, 2).join(' · ') + ' 마스터 노트');

  const id = newId('gw');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { message: 'Claude가 마스터 노트를 쓰는 중…', pct: 12 },
    input: { title, grade, topics, notes, unitIds: units.map((u) => u.unitId) },
    packet: null,
    htmlPreview: null,
    error: null,
    warnings: []
  };
  jobs.set(id, job);
  persistJob(job, true);

  setImmediate(async () => {
    try {
      touch(job, { progress: { message: 'STEP·예문·내신 포인트 정리 중…', pct: 28 } });
      persistJob(job, false);
      let parsed = await askWorksheetJson(buildUserPrompt({
        title, grade, topics, notes, units
      }));
      touch(job, { progress: { message: '이중 검증(Claude→Gemini) 중…', pct: 48 } });
      persistJob(job, false);
      const verified = await dualVerifyGrammar({
        kind: 'worksheet',
        document: parsed,
        context: { title, grade, topics, notes, units },
        onProgress: (p) => {
          touch(job, { progress: p });
          persistJob(job, false);
        },
        pctClaude: 55,
        pctGemini: 72,
        maxOutputTokens: 14000
      });
      parsed = verified.document;
      const vr = verified.report || {};
      const warnings = [];
      (vr.claudeIssues || []).forEach((x) => warnings.push('Claude검증: ' + x));
      (vr.geminiIssues || []).forEach((x) => warnings.push('Gemini검증: ' + x));
      if (vr.claudeError) warnings.push('Claude 이중검증 실패: ' + vr.claudeError);
      if (vr.geminiSkipped) warnings.push('Gemini 교차검증 생략: ' + (vr.geminiSkipReason || ''));
      if (vr.geminiError) warnings.push('Gemini 교차검증 실패(Claude본 유지): ' + vr.geminiError);
      touch(job, { progress: { message: 'A4 마스터 노트 레이아웃 만드는 중…', pct: 88 }, warnings });
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
        warnings,
        progress: { message: '완료', pct: 100 }
      });
      await persistJob(job, true);
    } catch (e) {
      touch(job, {
        status: 'error',
        error: e.message || '학습지 생성 실패',
        progress: { message: '실패', pct: 100 }
      });
      await persistJob(job, true);
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
