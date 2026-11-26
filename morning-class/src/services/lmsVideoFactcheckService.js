'use strict';

/**
 * Gemini lecture fact-check for LMS library videos.
 * Flow: Cloudflare Stream download → Gemini Files API → JSON error report.
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { askGemini, hasGeminiKey, formatGeminiClientError } = require('./geminiService');
const stream = require('./lmsStreamService');
const library = require('./lmsLibraryService');
const { isOpsDbEnabled, query, table } = require('../db/pool');

const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_SEC = 60 * 60; // 60 min hard cap
const VIDEO_MODE_MAX_SEC = 20 * 60; // prefer full video under 20 min
const MAX_DOWNLOAD_BYTES = 900 * 1024 * 1024; // ~900MB safety
const jobs = new Map();
/** @type {Map<string, string>} videoId → active jobId */
const activeByVideo = new Map();
/** @type {Map<string, object>} */
const batches = new Map();
const MAX_BATCH_VIDEOS = 40;
let activeBatchId = null;

let schemaReady = false;

function httpError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

function newId() {
  return 'vfc_' + crypto.randomBytes(6).toString('hex');
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function factcheckModel() {
  return String(
    process.env.LMS_FACTCHECK_GEMINI_MODEL
    || process.env.TEACHER_GEMINI_MODEL
    || process.env.GEMINI_MODEL
    || 'gemini-3.6-flash'
  ).trim() || 'gemini-3.6-flash';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureSchema() {
  if (schemaReady || !isOpsDbEnabled()) return;
  try {
    await query(
      'ALTER TABLE ' + table('lms_library_videos') +
      ' ADD COLUMN IF NOT EXISTS factcheck_json JSONB'
    );
    await query(
      'ALTER TABLE ' + table('lms_library_videos') +
      ' ADD COLUMN IF NOT EXISTS factcheck_at TIMESTAMPTZ'
    );
    await query(
      'ALTER TABLE ' + table('lms_library_videos') +
      ' ADD COLUMN IF NOT EXISTS factcheck_status TEXT'
    );
    await query(
      'CREATE TABLE IF NOT EXISTS ' + table('lms_factcheck_batches') + ' (' +
        'id TEXT PRIMARY KEY,' +
        'status TEXT NOT NULL DEFAULT \'running\',' +
        'requested_mode TEXT NOT NULL DEFAULT \'smart\',' +
        'progress JSONB,' +
        'items JSONB,' +
        'error TEXT,' +
        'created_at TIMESTAMPTZ NOT NULL DEFAULT now(),' +
        'updated_at TIMESTAMPTZ NOT NULL DEFAULT now()' +
      ')'
    );
    schemaReady = true;
  } catch (e) {
    console.warn('lms factcheck schema ensure failed', e.message);
  }
}

async function persistBatch(batch) {
  if (!batch || !batch.id || !isOpsDbEnabled()) return;
  await ensureSchema();
  if (!schemaReady) return;
  try {
    await query(
      'INSERT INTO ' + table('lms_factcheck_batches') +
        ' (id, status, requested_mode, progress, items, error, created_at, updated_at) VALUES (' +
        '$1,$2,$3,$4::jsonb,$5::jsonb,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0)' +
      ') ON CONFLICT (id) DO UPDATE SET ' +
        'status = EXCLUDED.status, requested_mode = EXCLUDED.requested_mode, ' +
        'progress = EXCLUDED.progress, items = EXCLUDED.items, error = EXCLUDED.error, ' +
        'updated_at = EXCLUDED.updated_at',
      [
        batch.id,
        batch.status,
        batch.requestedMode || 'smart',
        JSON.stringify(batch.progress || {}),
        JSON.stringify(batch.items || []),
        batch.error || null,
        batch.createdAt || Date.now(),
        batch.updatedAt || Date.now()
      ]
    );
  } catch (e) {
    console.warn('persist factcheck batch failed', batch.id, e.message);
  }
}

function rowToBatch(row) {
  return {
    id: row.id,
    status: row.status,
    requestedMode: row.requested_mode || 'smart',
    progress: row.progress || {},
    items: Array.isArray(row.items) ? row.items : [],
    error: row.error || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    live: false,
    fromDb: true
  };
}

async function loadBatchFromDb(batchId) {
  if (!isOpsDbEnabled()) return null;
  await ensureSchema();
  if (!schemaReady) return null;
  try {
    const r = await query(
      'SELECT * FROM ' + table('lms_factcheck_batches') + ' WHERE id = $1 LIMIT 1',
      [String(batchId || '')]
    );
    if (!r.rows[0]) return null;
    const batch = rowToBatch(r.rows[0]);
    batches.set(batch.id, batch);
    return batch;
  } catch (e) {
    console.warn('load factcheck batch failed', batchId, e.message);
    return null;
  }
}

async function markBatchInterrupted(batch) {
  (batch.items || []).forEach((it) => {
    if (it.status === 'running') {
      it.status = 'error';
      it.error = '서버 재시작으로 중단됨 — 다시 검수해 주세요';
    }
  });
  batch.status = 'interrupted';
  batch.live = false;
  batch.error = '서버 재시작으로 일괄 검수가 중단되었습니다.';
  batch.progress = {
    message: '중단됨. 원하는 영상을 체크한 뒤 「선택 검수」로 이어서 돌리세요.',
    pct: batch.progress && batch.progress.pct ? batch.progress.pct : 0
  };
  batch.updatedAt = Date.now();
  if (activeBatchId === batch.id) activeBatchId = null;
  await persistBatch(batch);
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) {
      jobs.delete(id);
      if (job.videoId && activeByVideo.get(job.videoId) === id) activeByVideo.delete(job.videoId);
    }
  }
  for (const [id, batch] of batches.entries()) {
    if (now - (batch.updatedAt || batch.createdAt) > JOB_TTL_MS) {
      batches.delete(id);
      if (activeBatchId === id) activeBatchId = null;
    }
  }
}

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
}

function publicJob(job) {
  return {
    jobId: job.id,
    videoId: job.videoId,
    status: job.status,
    progress: job.progress,
    error: job.error || undefined,
    mode: job.mode,
    report: job.report || undefined,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) { /* continue */ }
  }
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(raw.slice(s, e + 1)); } catch (_) { /* continue */ }
  }
  return null;
}

function chooseMode(durationSeconds, requested) {
  const req = String(requested || 'smart').toLowerCase();
  const dur = Number(durationSeconds) || 0;
  if (req === 'audio') return 'audio';
  if (req === 'video') {
    if (dur > VIDEO_MODE_MAX_SEC * 1.5) {
      throw httpError(400, '영상 모드는 약 30분 이하 권장입니다. 스마트/오디오로 다시 시도해 주세요.');
    }
    return 'video';
  }
  // smart
  if (dur > 0 && dur <= VIDEO_MODE_MAX_SEC) return 'video';
  return 'audio';
}

async function downloadToTemp(url, mimeType) {
  const ext = /audio/i.test(mimeType) ? '.m4a' : '.mp4';
  const tmpPath = path.join(os.tmpdir(), 'lms-fc-' + crypto.randomBytes(8).toString('hex') + ext);
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(12 * 60 * 1000)
  });
  if (!res.ok) {
    throw httpError(502, 'Cloudflare 다운로드 실패 (HTTP ' + res.status + ')');
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_DOWNLOAD_BYTES) {
    throw httpError(413, '다운로드 파일이 너무 큽니다. 오디오 모드로 시도하거나 영상을 짧게 나눠 주세요.');
  }
  if (!res.body) throw httpError(502, '다운로드 본문이 비어 있습니다.');
  const nodeStream = require('stream').Readable.fromWeb(res.body);
  await pipeline(nodeStream, fs.createWriteStream(tmpPath));
  const st = await fsp.stat(tmpPath);
  if (!st.size) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw httpError(502, '다운로드 파일이 비어 있습니다.');
  }
  if (st.size > MAX_DOWNLOAD_BYTES) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw httpError(413, '다운로드 파일이 너무 큽니다.');
  }
  return { path: tmpPath, size: st.size, mimeType };
}

async function uploadGeminiFile(filePath, mimeType, displayName) {
  const apiKey = geminiKey();
  if (!apiKey) throw httpError(503, 'Gemini is not configured (set GEMINI_API_KEY).');
  const size = (await fsp.stat(filePath)).size;
  const startRes = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: String(displayName || 'lecture').slice(0, 80) } }),
      signal: AbortSignal.timeout(60000)
    }
  );
  if (!startRes.ok) {
    const t = await startRes.text().catch(() => '');
    throw httpError(502, 'Gemini 파일 업로드 시작 실패: ' + String(t).slice(0, 200));
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url') || startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw httpError(502, 'Gemini 업로드 URL이 없습니다.');

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    // Stream from disk — avoid buffering a whole MP4 in RAM.
    body: fs.createReadStream(filePath),
    duplex: 'half',
    signal: AbortSignal.timeout(15 * 60 * 1000)
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok) {
    const msg = (upData.error && upData.error.message) || ('HTTP ' + upRes.status);
    throw httpError(502, 'Gemini 파일 업로드 실패: ' + msg);
  }
  const file = upData.file || upData;
  if (!file || !file.uri) throw httpError(502, 'Gemini 파일 URI를 받지 못했습니다.');

  // Wait until ACTIVE
  const name = file.name;
  const deadline = Date.now() + 10 * 60 * 1000;
  let meta = file;
  while (Date.now() < deadline) {
    const state = String(meta.state || meta.processingState || '').toUpperCase();
    if (state === 'ACTIVE') break;
    if (state === 'FAILED') throw httpError(502, 'Gemini 파일 처리 실패');
    await sleep(2000);
    const g = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/' + name + '?key=' + encodeURIComponent(apiKey),
      { signal: AbortSignal.timeout(30000) }
    );
    meta = await g.json().catch(() => ({}));
    if (!g.ok) {
      const msg = (meta.error && meta.error.message) || ('HTTP ' + g.status);
      throw httpError(502, 'Gemini 파일 상태 조회 실패: ' + msg);
    }
  }
  if (String(meta.state || '').toUpperCase() !== 'ACTIVE') {
    throw httpError(504, 'Gemini 파일 처리가 시간 초과되었습니다.');
  }
  return {
    name: meta.name || name,
    uri: meta.uri || file.uri,
    mimeType: meta.mimeType || mimeType
  };
}

async function deleteGeminiFile(name) {
  const apiKey = geminiKey();
  if (!apiKey || !name) return;
  try {
    await fetch(
      'https://generativelanguage.googleapis.com/v1beta/' + name + '?key=' + encodeURIComponent(apiKey),
      { method: 'DELETE', signal: AbortSignal.timeout(15000) }
    );
  } catch (_) { /* ignore */ }
}

const SYSTEM_PROMPT = `당신은 한국 중·고등 영어 내신 강의의 팩트체커입니다.
업로드된 강의(영상 또는 오디오)를 듣고/보고, 사실·문법·설명 오류만 찾아 JSON으로 보고하세요.

검수 범위:
- 영문법 규칙 오류, 잘못된 예문, 틀린 한글 해석
- 발음 표기·시제·수일치·전치사·관사 등 명백한 실수
- 칠판/슬라이드에 보이는 틀린 문장(영상 모드일 때)
- 시험 팁이 명백히 틀린 경우

하지 말 것:
- 말투·억양·진행 스타일 평가
- 취향 수준의 표현 교정
- 불확실한 추측을 오류로 단정

severity스탬프는 MM:SS 형식. 확실할 때만 severity를 high로.
반드시 유효한 JSON만 출력.`;

function buildUserPrompt(meta) {
  return [
    '다음 영어 강의 미디어를 검수하세요.',
    '제목: ' + (meta.title || ''),
    '카테고리: ' + (meta.category || ''),
    '커리큘럼: ' + (meta.curriculum || ''),
    '길이(초): ' + (meta.durationSeconds == null ? 'unknown' : meta.durationSeconds),
    '분석 모드: ' + meta.mode + (meta.mode === 'audio' ? ' (음성만 — 화면 글자는 못 봄)' : ' (영상+음성)'),
    '',
    '출력 스키마:',
    JSON.stringify({
      summary: '한 줄 총평',
      overallRisk: 'low|medium|high',
      issueCount: 0,
      issues: [{
        timestamp: '03:20',
        severity: 'high|medium|low',
        category: 'grammar|fact|example|slide|pronunciation|other',
        claim: '강사가 말한/보여준 내용',
        problem: '무엇이 잘못인지',
        correction: '올바른 설명/예문',
        confidence: 0.0
      }],
      strengths: ['잘된 점 1~3개'],
      notes: '제한사항·추가 메모'
    }, null, 2)
  ].join('\n');
}

function sanitizeReport(parsed, meta) {
  const issuesIn = Array.isArray(parsed && parsed.issues) ? parsed.issues : [];
  const issues = issuesIn.slice(0, 40).map((it) => ({
    timestamp: String((it && it.timestamp) || '').trim().slice(0, 12),
    severity: ['high', 'medium', 'low'].includes(String(it && it.severity))
      ? String(it.severity)
      : 'medium',
    category: String((it && it.category) || 'other').trim().slice(0, 32),
    claim: String((it && it.claim) || '').trim().slice(0, 400),
    problem: String((it && it.problem) || '').trim().slice(0, 500),
    correction: String((it && it.correction) || '').trim().slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(it && it.confidence) || 0.6))
  })).filter((it) => it.problem || it.claim);

  let overallRisk = String((parsed && parsed.overallRisk) || 'low').toLowerCase();
  if (!['low', 'medium', 'high'].includes(overallRisk)) {
    overallRisk = issues.some((i) => i.severity === 'high')
      ? 'high'
      : (issues.length ? 'medium' : 'low');
  }

  return {
    summary: String((parsed && parsed.summary) || '').trim().slice(0, 400)
      || (issues.length ? ('이슈 ' + issues.length + '건') : '명백한 오류를 찾지 못했습니다.'),
    overallRisk,
    issueCount: issues.length,
    issues,
    strengths: (Array.isArray(parsed && parsed.strengths) ? parsed.strengths : [])
      .map((s) => String(s || '').trim().slice(0, 200)).filter(Boolean).slice(0, 5),
    notes: String((parsed && parsed.notes) || '').trim().slice(0, 500),
    mode: meta.mode,
    model: meta.model,
    analyzedAt: new Date().toISOString(),
    durationSeconds: meta.durationSeconds,
    title: meta.title
  };
}

async function persistReport(videoId, report, status) {
  await ensureSchema();
  if (!isOpsDbEnabled()) return;
  try {
    await query(
      'UPDATE ' + table('lms_library_videos') +
      ' SET factcheck_json = $2::jsonb, factcheck_at = now(), factcheck_status = $3, updated_at = now() WHERE id = $1',
      [videoId, JSON.stringify(report || {}), status || 'done']
    );
  } catch (e) {
    console.warn('persist factcheck failed', videoId, e.message);
  }
}

async function loadSavedReport(videoId) {
  await ensureSchema();
  if (!isOpsDbEnabled()) return null;
  try {
    const r = await query(
      'SELECT factcheck_json, factcheck_at, factcheck_status FROM ' + table('lms_library_videos') +
      ' WHERE id = $1 LIMIT 1',
      [videoId]
    );
    const row = r.rows[0];
    if (!row || !row.factcheck_json) return null;
    return {
      report: row.factcheck_json,
      at: row.factcheck_at,
      status: row.factcheck_status || 'done'
    };
  } catch (_) {
    return null;
  }
}

async function runJob(job) {
  let tmpPath = '';
  let geminiName = '';
  try {
    touch(job, { progress: { message: '라이브러리 영상 확인 중…', pct: 5 } });
    const video = await library.getRaw(job.videoId);
    if (!video) throw httpError(404, 'Video not found.');
    if (!video.videoUid) throw httpError(400, 'Cloudflare video uid가 없습니다.');
    await library.syncVideo(video);
    if (video.status !== 'ready') {
      throw httpError(409, '영상이 아직 준비되지 않았습니다. ready 상태에서만 검수할 수 있습니다.');
    }
    const dur = Number(video.durationSeconds) || 0;
    if (dur > MAX_DURATION_SEC) {
      throw httpError(400, '60분 초과 영상은 검수할 수 없습니다. 구간을 나눠 올려 주세요.');
    }

    const mode = chooseMode(dur, job.requestedMode);
    job.mode = mode;
    touch(job, {
      mode,
      progress: {
        message: mode === 'video'
          ? '영상 다운로드 준비 중… (비용↑, 화면 글자도 검수)'
          : '오디오 다운로드 준비 중… (비용↓, 말한 내용 위주)',
        pct: 12
      }
    });

    if (!stream.isConfigured()) throw httpError(503, 'Cloudflare Stream이 설정되지 않았습니다.');
    if (!hasGeminiKey()) throw httpError(503, 'Gemini is not configured (set GEMINI_API_KEY).');

    const dl = await stream.ensureSignedDownload(
      video.videoUid,
      mode === 'audio' ? 'audio' : 'default'
    );
    touch(job, { progress: { message: '미디어 다운로드 중…', pct: 28 } });
    const local = await downloadToTemp(dl.url, dl.mimeType);
    tmpPath = local.path;

    touch(job, { progress: { message: 'Gemini에 업로드 중…', pct: 48 } });
    const gFile = await uploadGeminiFile(tmpPath, local.mimeType, video.title || video.id);
    geminiName = gFile.name;
    // Free local disk ASAP
    await fsp.unlink(tmpPath).catch(() => {});
    tmpPath = '';

    touch(job, { progress: { message: 'Gemini가 강의 내용 검수 중…', pct: 62 } });
    const meta = {
      title: video.title,
      category: video.category,
      curriculum: video.curriculum,
      durationSeconds: dur || null,
      mode,
      model: factcheckModel()
    };
    const parts = [
      { fileData: { mimeType: gFile.mimeType, fileUri: gFile.uri } },
      { text: buildUserPrompt(meta) }
    ];
    let raw;
    try {
      raw = await askGemini(parts, {
        provider: 'gemini',
        forceProvider: 'gemini',
        noGeminiFallback: true,
        model: factcheckModel(),
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        systemInstruction: SYSTEM_PROMPT,
        mediaResolution: mode === 'video' ? 'MEDIA_RESOLUTION_LOW' : undefined
      });
    } catch (e) {
      throw httpError(502, formatGeminiClientError(e));
    }

    touch(job, { progress: { message: '리포트 정리 중…', pct: 88 } });
    const parsed = extractJson((raw && (raw.answer || raw.text)) || raw);
    if (!parsed) throw httpError(502, 'Gemini가 유효한 JSON 리포트를 반환하지 않았습니다.');
    const report = sanitizeReport(parsed, meta);
    await persistReport(job.videoId, report, 'done');
    touch(job, {
      status: 'done',
      report,
      progress: { message: '완료 — 이슈 ' + report.issueCount + '건', pct: 100 }
    });
  } catch (e) {
    const msg = e.message || '검수 실패';
    touch(job, {
      status: 'error',
      error: msg,
      progress: { message: msg, pct: 100 }
    });
    try {
      await persistReport(job.videoId, { error: msg }, 'error');
    } catch (_) { /* ignore */ }
  } finally {
    if (tmpPath) await fsp.unlink(tmpPath).catch(() => {});
    if (geminiName) await deleteGeminiFile(geminiName);
    if (activeByVideo.get(job.videoId) === job.id) activeByVideo.delete(job.videoId);
  }
}

function createJobRecord(videoId, opts) {
  const id = newId();
  const job = {
    id,
    videoId: String(videoId),
    status: 'running',
    requestedMode: (opts && opts.mode) || 'smart',
    mode: null,
    progress: { message: '대기열에 등록…', pct: 1 },
    error: null,
    report: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    batchId: (opts && opts.batchId) || null
  };
  jobs.set(id, job);
  activeByVideo.set(String(videoId), id);
  return job;
}

async function startFactcheck(videoId, opts) {
  pruneJobs();
  if (!hasGeminiKey()) throw httpError(503, 'Gemini is not configured (set GEMINI_API_KEY).');
  if (!stream.isConfigured()) throw httpError(503, 'Cloudflare Stream이 설정되지 않았습니다.');

  const video = await library.getRaw(videoId);
  if (!video) throw httpError(404, 'Video not found.');
  await library.syncVideo(video);
  if (video.status !== 'ready') {
    throw httpError(409, '영상이 ready 상태일 때만 검수할 수 있습니다.');
  }
  const existingId = activeByVideo.get(String(videoId));
  if (existingId && jobs.get(existingId) && jobs.get(existingId).status === 'running') {
    return publicJob(jobs.get(existingId));
  }

  const job = createJobRecord(videoId, opts);
  setImmediate(() => { runJob(job); });
  return publicJob(job);
}

function publicBatch(batch) {
  const items = (batch.items || []).map((it) => ({
    videoId: it.videoId,
    title: it.title,
    status: it.status,
    jobId: it.jobId || undefined,
    issueCount: it.issueCount,
    overallRisk: it.overallRisk,
    error: it.error || undefined,
    mode: it.mode || undefined
  }));
  const done = items.filter((i) => i.status === 'done' || i.status === 'error' || i.status === 'skipped').length;
  return {
    batchId: batch.id,
    status: batch.status,
    progress: batch.progress,
    mode: batch.requestedMode,
    total: items.length,
    done,
    items,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    error: batch.error || undefined
  };
}

async function collectReadyVideos(videoIds) {
  const wanted = Array.isArray(videoIds)
    ? videoIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null;
  const listed = await library.listVideos({});
  const candidates = (listed.videos || []).filter((v) => {
    if (wanted && wanted.length && !wanted.includes(v.id)) return false;
    return v.status === 'ready';
  });
  // Prefer current filter order; cap to protect Gemini spend / Railway memory.
  return candidates.slice(0, MAX_BATCH_VIDEOS);
}

async function runBatch(batch) {
  try {
    const n = batch.items.length;
    for (let i = 0; i < n; i++) {
      const item = batch.items[i];
      touch(batch, {
        progress: {
          message: '(' + (i + 1) + '/' + n + ') ' + (item.title || item.videoId) + ' 검수 중…',
          pct: Math.round((i / Math.max(1, n)) * 100)
        }
      });
      item.status = 'running';
      const video = await library.getRaw(item.videoId);
      if (!video || video.status !== 'ready') {
        item.status = 'skipped';
        item.error = 'ready 아님';
        continue;
      }
      const dur = Number(video.durationSeconds) || 0;
      if (dur > MAX_DURATION_SEC) {
        item.status = 'skipped';
        item.error = '60분 초과';
        continue;
      }
      const job = createJobRecord(item.videoId, {
        mode: batch.requestedMode,
        batchId: batch.id
      });
      item.jobId = job.id;
      await runJob(job);
      const finished = jobs.get(job.id);
      if (finished && finished.status === 'done' && finished.report) {
        item.status = 'done';
        item.issueCount = finished.report.issueCount;
        item.overallRisk = finished.report.overallRisk;
        item.mode = finished.mode || finished.report.mode;
      } else {
        item.status = 'error';
        item.error = (finished && finished.error) || '검수 실패';
      }
      touch(batch, {});
      await persistBatch(batch);
    }
    const failed = batch.items.filter((it) => it.status === 'error').length;
    const skipped = batch.items.filter((it) => it.status === 'skipped').length;
    const ok = batch.items.filter((it) => it.status === 'done').length;
    touch(batch, {
      status: 'done',
      progress: {
        message: '완료 — 성공 ' + ok + ' · 실패 ' + failed + (skipped ? (' · 건너뜀 ' + skipped) : ''),
        pct: 100
      }
    });
    batch.live = false;
    await persistBatch(batch);
  } catch (e) {
    touch(batch, {
      status: 'error',
      error: e.message || '일괄 검수 실패',
      progress: { message: e.message || '일괄 검수 실패', pct: 100 }
    });
    batch.live = false;
    await persistBatch(batch);
  } finally {
    if (activeBatchId === batch.id) activeBatchId = null;
  }
}

async function startBatchFactcheck(opts) {
  pruneJobs();
  if (!hasGeminiKey()) throw httpError(503, 'Gemini is not configured (set GEMINI_API_KEY).');
  if (!stream.isConfigured()) throw httpError(503, 'Cloudflare Stream이 설정되지 않았습니다.');
  if (activeBatchId && batches.get(activeBatchId) && batches.get(activeBatchId).status === 'running' && batches.get(activeBatchId).live) {
    throw httpError(409, '이미 일괄 검수가 진행 중입니다. 끝난 뒤 선택 검수해 주세요.');
  }

  const ready = await collectReadyVideos(opts && opts.videoIds);
  if (!ready.length) {
    throw httpError(400, '검수할 ready 영상이 없습니다.');
  }

  const id = 'bfc_' + crypto.randomBytes(5).toString('hex');
  const batch = {
    id,
    status: 'running',
    requestedMode: (opts && opts.mode) || 'smart',
    progress: { message: '일괄 검수 시작…', pct: 1 },
    items: ready.map((v) => ({
      videoId: v.id,
      title: v.title,
      status: 'queued',
      jobId: null,
      issueCount: null,
      overallRisk: null,
      error: null,
      mode: null
    })),
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  batch.live = true;
  batches.set(id, batch);
  activeBatchId = id;
  await persistBatch(batch);
  setImmediate(() => { runBatch(batch); });
  return publicBatch(batch);
}

async function getBatch(batchId) {
  pruneJobs();
  let batch = batches.get(String(batchId || ''));
  if (!batch) batch = await loadBatchFromDb(batchId);
  if (!batch) return null;
  // A running row with no live worker means this process restarted mid-batch.
  if (batch.status === 'running' && !batch.live) {
    await markBatchInterrupted(batch);
  }
  return publicBatch(batch);
}

function getActiveBatch() {
  if (activeBatchId && batches.get(activeBatchId)) return publicBatch(batches.get(activeBatchId));
  return null;
}

function getJob(jobId) {
  pruneJobs();
  const job = jobs.get(String(jobId || ''));
  return job ? publicJob(job) : null;
}

async function getLatestForVideo(videoId) {
  pruneJobs();
  const activeId = activeByVideo.get(String(videoId));
  if (activeId && jobs.get(activeId)) return publicJob(jobs.get(activeId));
  // newest in-memory job for this video
  let best = null;
  for (const job of jobs.values()) {
    if (job.videoId === String(videoId)) {
      if (!best || job.updatedAt > best.updatedAt) best = job;
    }
  }
  if (best) return publicJob(best);
  const saved = await loadSavedReport(videoId);
  if (!saved) return null;
  return {
    jobId: null,
    videoId: String(videoId),
    status: saved.status === 'error' ? 'error' : 'done',
    progress: { message: '저장된 리포트', pct: 100 },
    report: saved.report,
    error: saved.report && saved.report.error,
    mode: saved.report && saved.report.mode,
    createdAt: saved.at ? new Date(saved.at).getTime() : null,
    updatedAt: saved.at ? new Date(saved.at).getTime() : null,
    fromDb: true
  };
}

module.exports = {
  startFactcheck,
  startBatchFactcheck,
  getBatch,
  getActiveBatch,
  getJob,
  getLatestForVideo,
  MAX_DURATION_SEC,
  VIDEO_MODE_MAX_SEC,
  MAX_BATCH_VIDEOS
};
