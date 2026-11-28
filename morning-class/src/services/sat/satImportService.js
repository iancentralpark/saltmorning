'use strict';

/**
 * SAT question bank import: a teacher uploads a question PDF in pieces, the server splits
 * it into one unit per question, and Claude converts the units one at a time into
 * sat_questions rows that wait for review.
 *
 * A job first converts a spread-out sample of units and stops ("checkpoint") so a person
 * can compare the result with the PDF before paying for the rest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { query, table, withTransaction, isOpsDbEnabled } = require('../../db/pool');
const pdf = require('./satPdfClient');
const extract = require('./satExtract');
const validate = require('./satValidate');

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 600 * 1024 * 1024;
const SAMPLE_UNITS = 50;
const MAX_ATTEMPTS = 3;
const MAX_UNIT_PAGES = 6;
const WINDOW_PAGES = 3;
const SCAN_BATCH = 40;
const PAGE_EDGE_FOR_AI = 1568;
const STALE_WORKING = '30 minutes';
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SAT_IMPORT_CONCURRENCY) || 3));
const TMP_DIR = path.join(os.tmpdir(), 'salt-sat');

// Rough tokens for one question before any has been converted: page images, prompt, answer.
const EST_TOKENS_IN_PER_PAGE = 2300;
const EST_TOKENS_IN_FIXED = 1800;
const EST_TOKENS_OUT = 1100;

const T = {
  jobs: () => table('sat_import_jobs'),
  chunks: () => table('sat_import_chunks'),
  units: () => table('sat_import_units'),
  questions: () => table('sat_questions'),
  assets: () => table('sat_assets')
};

const running = new Map();
const assembling = new Map();
const analyzing = new Set();

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function requireDb() {
  if (!isOpsDbEnabled()) throw httpError(503, '데이터베이스가 연결되지 않아 SAT 문제은행을 쓸 수 없습니다.');
}

function newId(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localPath(jobId) {
  return path.join(TMP_DIR, String(jobId).replace(/[^a-z0-9_]/gi, '') + '.pdf');
}

async function loadJob(jobId) {
  const r = await query('SELECT * FROM ' + T.jobs() + ' WHERE id = $1', [String(jobId || '')]);
  if (!r.rows[0]) throw httpError(404, '가져오기 작업을 찾을 수 없습니다.');
  return r.rows[0];
}

async function setJob(jobId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => k + ' = $' + (i + 2));
  await query(
    'UPDATE ' + T.jobs() + ' SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1',
    [jobId].concat(keys.map((k) => fields[k]))
  );
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function receivedChunks(jobId) {
  const r = await query('SELECT idx FROM ' + T.chunks() + ' WHERE job_id = $1 ORDER BY idx', [jobId]);
  return r.rows.map((row) => row.idx);
}

async function createJob(input, userKey) {
  requireDb();
  const filename = String((input && input.filename) || '').trim().slice(0, 200);
  const sizeBytes = Number(input && input.sizeBytes);
  if (!/\.pdf$/i.test(filename)) throw httpError(400, 'PDF 파일만 올릴 수 있습니다.');
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw httpError(400, '파일 크기를 알 수 없습니다.');
  if (sizeBytes > MAX_PDF_BYTES) {
    throw httpError(400, 'PDF는 ' + Math.round(MAX_PDF_BYTES / (1024 * 1024)) + 'MB 이하로 올려 주세요.');
  }

  const existing = await query(
    'SELECT * FROM ' + T.jobs() +
      " WHERE status = 'uploading' AND filename = $1 AND size_bytes = $2 AND created_by = $3" +
      ' ORDER BY created_at DESC LIMIT 1',
    [filename, sizeBytes, userKey]
  );
  if (existing.rows[0]) {
    const job = existing.rows[0];
    return { id: job.id, chunkSize: job.chunk_size, chunkCount: job.chunk_count, received: await receivedChunks(job.id) };
  }

  const id = newId('si_');
  const chunkCount = Math.ceil(sizeBytes / CHUNK_BYTES);
  await query(
    'INSERT INTO ' + T.jobs() +
      ' (id, filename, size_bytes, chunk_size, chunk_count, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, filename, sizeBytes, CHUNK_BYTES, chunkCount, 'uploading', userKey]
  );
  return { id: id, chunkSize: CHUNK_BYTES, chunkCount: chunkCount, received: [] };
}

async function putChunk(jobId, idx, buffer) {
  requireDb();
  const job = await loadJob(jobId);
  if (job.status !== 'uploading') throw httpError(409, '이미 업로드가 끝난 파일입니다.');
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= job.chunk_count) throw httpError(400, '조각 번호가 올바르지 않습니다.');
  const expected = i === job.chunk_count - 1
    ? Number(job.size_bytes) - job.chunk_size * (job.chunk_count - 1)
    : job.chunk_size;
  if (!Buffer.isBuffer(buffer) || buffer.length !== expected) {
    throw httpError(400, '조각 크기가 맞지 않습니다. 다시 올려 주세요.');
  }
  await query(
    'INSERT INTO ' + T.chunks() + ' (job_id, idx, data) VALUES ($1,$2,$3)' +
      ' ON CONFLICT (job_id, idx) DO UPDATE SET data = EXCLUDED.data',
    [job.id, i, buffer]
  );
  await query('UPDATE ' + T.jobs() + ' SET updated_at = now() WHERE id = $1', [job.id]);
  return { ok: true, idx: i };
}

async function completeUpload(jobId) {
  requireDb();
  const job = await loadJob(jobId);
  if (job.status !== 'uploading') return { ok: true, status: job.status };
  const r = await query(
    'SELECT count(*)::int AS n, coalesce(sum(octet_length(data)), 0)::bigint AS bytes FROM ' + T.chunks() +
      ' WHERE job_id = $1',
    [job.id]
  );
  if (r.rows[0].n !== job.chunk_count || Number(r.rows[0].bytes) !== Number(job.size_bytes)) {
    throw httpError(409, '아직 올라오지 않은 조각이 있습니다. 같은 파일을 다시 선택하면 이어서 올립니다.');
  }
  const head = await query(
    'SELECT substring(data from 1 for 1024) AS head FROM ' + T.chunks() + ' WHERE job_id = $1 AND idx = 0',
    [job.id]
  );
  if (!head.rows[0] || head.rows[0].head.indexOf('%PDF-') < 0) {
    await query('DELETE FROM ' + T.jobs() + ' WHERE id = $1', [job.id]);
    throw httpError(400, 'PDF 파일이 아닙니다.');
  }
  await setJob(job.id, { status: 'analyzing', status_message: '' });
  startAnalyze(job.id);
  return { ok: true, status: 'analyzing' };
}

// ---------------------------------------------------------------------------
// Local copy of the PDF (the durable copy lives in sat_import_chunks)
// ---------------------------------------------------------------------------

async function ensureLocalPdf(job) {
  const file = localPath(job.id);
  try {
    if (fs.statSync(file).size === Number(job.size_bytes)) return file;
  } catch (_) { /* not on disk yet */ }
  if (assembling.has(job.id)) return assembling.get(job.id);

  const work = (async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const part = file + '.' + process.pid + '.part';
    const fd = fs.openSync(part, 'w');
    try {
      for (let i = 0; i < job.chunk_count; i++) {
        const r = await query('SELECT data FROM ' + T.chunks() + ' WHERE job_id = $1 AND idx = $2', [job.id, i]);
        if (!r.rows[0]) throw new Error('원본 PDF 조각 ' + i + '번이 없습니다.');
        fs.writeSync(fd, r.rows[0].data);
      }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(part, file);
    return file;
  })();
  assembling.set(job.id, work);
  try {
    return await work;
  } finally {
    assembling.delete(job.id);
  }
}

function removeLocalPdf(jobId) {
  const file = localPath(jobId);
  pdf.close(file).catch(() => {});
  fs.rm(file, { force: true }, () => {});
}

// ---------------------------------------------------------------------------
// Analysis: page count, question boundaries, units
// ---------------------------------------------------------------------------

const MARKER_RE = /Question\s*ID:?\s*([0-9a-z]{6,12})\b/gi;

/** Question starts found in the text layer, in page order. */
function findMarkers(pages) {
  const markers = [];
  pages.forEach((p) => {
    const text = String(p.text || '');
    let m;
    MARKER_RE.lastIndex = 0;
    while ((m = MARKER_RE.exec(text))) {
      const id = m[1].toLowerCase();
      if (!/\d/.test(id)) continue;
      const last = markers[markers.length - 1];
      if (last && last.id === id) continue;
      markers.push({ page: p.page, id: id, atTop: text.slice(0, m.index).trim().length < 40 });
    }
  });
  return markers;
}

function buildUnits(markers, pageCount) {
  const units = [];
  const useMarkers = markers.length > 0 && markers.length >= pageCount / 8;
  if (useMarkers) {
    markers.forEach((m, i) => {
      const next = markers[i + 1];
      let pageTo = pageCount;
      if (next) pageTo = next.page > m.page ? (next.atTop ? next.page - 1 : next.page) : m.page;
      pageTo = Math.min(pageTo, m.page + MAX_UNIT_PAGES - 1);
      units.push({ pageFrom: m.page, pageTo: pageTo, contextTo: 0, sourceId: m.id });
    });
  } else {
    for (let p = 1; p <= pageCount; p += WINDOW_PAGES) {
      const pageTo = Math.min(pageCount, p + WINDOW_PAGES - 1);
      units.push({ pageFrom: p, pageTo: pageTo, contextTo: Math.min(pageCount, pageTo + 1), sourceId: '' });
    }
  }
  const sample = new Set();
  if (units.length <= SAMPLE_UNITS) {
    units.forEach((u, i) => sample.add(i));
  } else {
    for (let k = 0; k < SAMPLE_UNITS; k++) {
      sample.add(Math.round(k * (units.length - 1) / (SAMPLE_UNITS - 1)));
    }
  }
  units.forEach((u, i) => { u.inSample = sample.has(i); });
  return { units: units, mode: useMarkers ? 'marker' : 'window' };
}

async function analyze(jobId) {
  const job = await loadJob(jobId);
  const file = await ensureLocalPdf(job);
  const opened = await pdf.open(file);
  const pageCount = opened.pages;
  await setJob(job.id, { page_count: pageCount, pages_scanned: 0 });

  const pages = [];
  for (let from = 1; from <= pageCount; from += SCAN_BATCH) {
    const to = Math.min(pageCount, from + SCAN_BATCH - 1);
    const r = await pdf.texts(file, from, to);
    r.pages.forEach((p) => pages.push(p));
    await setJob(job.id, { pages_scanned: to });
  }

  const built = buildUnits(findMarkers(pages), pageCount);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM ' + T.units() + ' WHERE job_id = $1', [job.id]);
    for (let i = 0; i < built.units.length; i += 500) {
      const slice = built.units.slice(i, i + 500);
      await client.query(
        'INSERT INTO ' + T.units() + ' (job_id, idx, page_from, page_to, context_to, source_id, in_sample)' +
          ' SELECT $1::text, * FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::text[], $7::bool[])',
        [
          job.id,
          slice.map((u, k) => i + k),
          slice.map((u) => u.pageFrom),
          slice.map((u) => u.pageTo),
          slice.map((u) => u.contextTo),
          slice.map((u) => u.sourceId),
          slice.map((u) => u.inSample)
        ]
      );
    }
  });
  await setJob(job.id, {
    status: 'ready',
    split_mode: built.mode,
    status_message: '',
    model: extract.model()
  });
}

function startAnalyze(jobId) {
  if (analyzing.has(jobId)) return;
  analyzing.add(jobId);
  analyze(jobId)
    .catch(async (e) => {
      console.warn('[sat-import] analyze failed', jobId, e.message);
      try {
        await setJob(jobId, { status: 'failed', status_message: 'PDF를 읽지 못했습니다: ' + e.message });
      } catch (_) { /* job was deleted */ }
    })
    .finally(() => analyzing.delete(jobId));
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

async function claimUnit(jobId, sampleOnly) {
  const r = await query(
    'UPDATE ' + T.units() + " SET status = 'working', attempts = attempts + 1, updated_at = now()" +
      ' WHERE (job_id, idx) IN (' +
      '   SELECT job_id, idx FROM ' + T.units() +
      "   WHERE job_id = $1 AND (status = 'pending' OR (status = 'working' AND updated_at < now() - interval '" +
      STALE_WORKING + "'))" + (sampleOnly ? ' AND in_sample' : '') +
      '   ORDER BY idx LIMIT 1 FOR UPDATE SKIP LOCKED' +
      ' ) RETURNING *',
    [jobId]
  );
  return r.rows[0] || null;
}

async function loadUnitPages(job, unit) {
  const file = await ensureLocalPdf(job);
  const last = Math.min(Math.max(unit.page_to, unit.context_to || 0), unit.page_from + MAX_UNIT_PAGES - 1);
  const texts = await pdf.texts(file, unit.page_from, last);
  const pages = [];
  for (const t of texts.pages) {
    const img = await pdf.render(file, t.page, { maxEdge: PAGE_EDGE_FOR_AI });
    pages.push({ page: t.page, text: t.text, image: img.data, mime: img.mime });
  }
  return { file: file, pages: pages };
}

async function cropFigures(file, pages, rawFigures) {
  const assets = [];
  const failed = [];
  const pageNos = pages.map((p) => p.page);
  for (const f of Array.isArray(rawFigures) ? rawFigures.slice(0, 8) : []) {
    const ref = String((f && f.ref) || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const box = Array.isArray(f && f.box) ? f.box.map((v) => Number(v) / 1000) : [];
    const page = Number(f && f.page);
    if (!/^fig/.test(ref) || assets.some((a) => a.ref === ref)) continue;
    if (pageNos.indexOf(page) < 0 || box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < -0.01 || v > 1.01)) {
      failed.push(ref);
      continue;
    }
    try {
      const crop = await pdf.crop(file, page, box, true);
      assets.push({ ref: ref, page: page, box: crop.box, mime: crop.mime, width: crop.width, height: crop.height, data: crop.data });
    } catch (e) {
      failed.push(ref);
    }
  }
  return { assets: assets, failed: failed };
}

async function insertQuestion(client, job, unit, q, flags, facts, assets) {
  const id = newId('sq_');
  await client.query(
    'INSERT INTO ' + T.questions() +
      ' (id, source_id, import_job_id, unit_idx, page_from, page_to, section, domain, skill, difficulty, qtype,' +
      ' passage, stem, choices, answer, accepted_answers, rationale, status, flags, source_facts, notes)' +
      " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'review',$18,$19,$20)",
    [
      id, q.sourceId, job.id, unit.idx, unit.page_from, Math.max(unit.page_to, unit.page_from),
      q.section, q.domain, q.skill, q.difficulty, q.qtype, q.passage, q.stem,
      JSON.stringify(q.choices), q.answer, JSON.stringify(q.acceptedAnswers), q.rationale,
      JSON.stringify(flags), JSON.stringify(facts || {}), q.notes
    ]
  );
  for (const a of assets) {
    await client.query(
      'INSERT INTO ' + T.assets() + ' (id, question_id, ref, page, box, mime, width, height, data)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [newId('sa_'), id, a.ref, a.page, JSON.stringify(a.box), a.mime, a.width, a.height, a.data]
    );
  }
  return id;
}

/**
 * Convert one unit and store its questions. With force, the unit's earlier questions are
 * replaced even if someone edited or approved them (used by "convert again").
 */
async function convertUnit(job, unit, opts) {
  const force = !!(opts && opts.force);
  if (!force && unit.source_id) {
    // First import wins: a Question ID that is already in the bank is kept as it is, so do not pay to convert it again.
    const kept = await query(
      'SELECT 1 FROM ' + T.questions() + ' WHERE source_id = $1' +
        " AND NOT (import_job_id = $2 AND unit_idx = $3 AND status = 'review' AND NOT edited)",
      [unit.source_id, job.id, unit.idx]
    );
    if (kept.rows.length) {
      await query(
        'UPDATE ' + T.units() + " SET status = 'done', error = NULL, question_count = 0, skipped_count = 1, updated_at = now()" +
          ' WHERE job_id = $1 AND idx = $2',
        [job.id, unit.idx]
      );
      return { questionIds: [], skipped: 1 };
    }
  }
  const loaded = await loadUnitPages(job, unit);
  const result = await extract.extractQuestions({ sourceId: unit.source_id, pageTo: unit.page_to }, loaded.pages);
  const single = !!unit.source_id;
  if (single && !result.questions.length) {
    const err = new Error('이 쪽에서 문항을 찾지 못했습니다.');
    err.tokensIn = result.tokensIn;
    err.tokensOut = result.tokensOut;
    throw err;
  }

  const ownText = loaded.pages.filter((p) => p.page <= unit.page_to).map((p) => p.text).join('\n');
  const allText = loaded.pages.map((p) => p.text).join('\n');
  const prepared = [];
  for (const raw of result.questions.slice(0, 12)) {
    const figs = await cropFigures(loaded.file, loaded.pages, raw && raw.figures);
    const extraFlags = [];
    if (figs.failed.length) extraFlags.push({ code: 'fig_crop_failed', detail: figs.failed.join(', ') });
    if (single && result.questions.length !== 1) extraFlags.push({ code: 'unit_count', detail: String(result.questions.length) });
    if (result.truncated) extraFlags.push({ code: 'truncated' });
    const facts = single ? validate.sourceFacts(ownText, unit.source_id) : {};
    const input = Object.assign({}, raw);
    if (single && !String(input.source_id || '').trim()) input.source_id = unit.source_id;
    const norm = validate.normalizeQuestion(input, {
      facts: facts,
      pageText: allText,
      assetRefs: figs.assets.map((a) => a.ref),
      extraFlags: extraFlags
    });
    prepared.push({ q: norm.question, flags: norm.flags, facts: facts, assets: figs.assets });
  }

  const saved = [];
  let skipped = 0;
  await withTransaction(async (client) => {
    const alive = await client.query('SELECT 1 FROM ' + T.jobs() + ' WHERE id = $1 FOR SHARE', [job.id]);
    if (!alive.rows.length) throw new Error('가져오기 작업이 삭제되었습니다.');
    await client.query(
      'DELETE FROM ' + T.questions() + ' WHERE import_job_id = $1 AND unit_idx = $2' +
        (force ? '' : " AND status = 'review' AND NOT edited"),
      [job.id, unit.idx]
    );
    for (const item of prepared) {
      if (item.q.sourceId) {
        const dup = await client.query('SELECT 1 FROM ' + T.questions() + ' WHERE source_id = $1', [item.q.sourceId]);
        if (dup.rows.length) {
          skipped++;
          continue;
        }
      }
      saved.push(await insertQuestion(client, job, unit, item.q, item.flags, item.facts, item.assets));
    }
    await client.query(
      'UPDATE ' + T.units() + " SET status = 'done', error = NULL, question_count = $3, skipped_count = $4," +
        ' tokens_in = tokens_in + $5, tokens_out = tokens_out + $6, updated_at = now()' +
        ' WHERE job_id = $1 AND idx = $2',
      [job.id, unit.idx, saved.length, skipped, result.tokensIn, result.tokensOut]
    );
  });
  return { questionIds: saved, skipped: skipped };
}

async function releaseUnit(job, unit, fields) {
  await query(
    'UPDATE ' + T.units() + ' SET status = $3, error = $4, attempts = $5,' +
      ' tokens_in = tokens_in + $6, tokens_out = tokens_out + $7, updated_at = now()' +
      ' WHERE job_id = $1 AND idx = $2',
    [job.id, unit.idx, fields.status, fields.error || null, fields.attempts, fields.tokensIn || 0, fields.tokensOut || 0]
  );
}

async function workerLoop(job, state, sampleOnly) {
  while (!state.stop) {
    const unit = await claimUnit(job.id, sampleOnly);
    if (!unit) return;
    try {
      await convertUnit(job, unit);
      state.busyStreak = 0;
    } catch (e) {
      const message = String((e && e.message) || e).slice(0, 400);
      const tokens = { tokensIn: e && e.tokensIn, tokensOut: e && e.tokensOut };
      if (e && e.fatal) {
        await releaseUnit(job, unit, Object.assign({ status: 'pending', attempts: unit.attempts - 1 }, tokens));
        if (!state.stop) {
          state.stop = true;
          await setJob(job.id, { status: 'paused', status_message: 'Claude 요청이 거절되어 멈췄습니다: ' + message });
        }
        return;
      }
      if (e && e.busy) {
        await releaseUnit(job, unit, Object.assign({ status: 'pending', attempts: unit.attempts - 1 }, tokens));
        state.busyStreak = (state.busyStreak || 0) + 1;
        if (state.busyStreak > 30 && !state.stop) {
          state.stop = true;
          await setJob(job.id, { status: 'paused', status_message: 'Claude가 계속 혼잡해서 멈췄습니다. 잠시 뒤 계속을 눌러 주세요.' });
          return;
        }
        await sleep(Math.min(60000, 4000 * state.busyStreak));
        continue;
      }
      await releaseUnit(job, unit, Object.assign({
        status: unit.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: message,
        attempts: unit.attempts
      }, tokens));
      await sleep(1500);
    }
  }
}

async function runJob(jobId, state) {
  try {
    const job = await loadJob(jobId);
    if (job.status !== 'running') return;
    await ensureLocalPdf(job);
    const sampleOnly = !job.sample_passed;
    const loops = [];
    for (let i = 0; i < CONCURRENCY; i++) loops.push(workerLoop(job, state, sampleOnly));
    await Promise.all(loops);
    if (state.stop) return;

    const left = await query(
      'SELECT count(*)::int AS n FROM ' + T.units() + " WHERE job_id = $1 AND status IN ('pending', 'working')",
      [jobId]
    );
    const fresh = await loadJob(jobId);
    if (fresh.status !== 'running') return;
    if (left.rows[0].n > 0 && sampleOnly) {
      await setJob(jobId, { status: 'checkpoint', status_message: '' });
    } else {
      await setJob(jobId, { status: 'done', sample_passed: true, status_message: '' });
    }
  } catch (e) {
    console.warn('[sat-import] run failed', jobId, e.message);
    try {
      await setJob(jobId, { status: 'paused', status_message: '변환이 멈췄습니다: ' + String(e.message || e).slice(0, 300) });
    } catch (_) { /* job was deleted */ }
  } finally {
    if (running.get(jobId) === state) running.delete(jobId);
  }
}

function launch(jobId) {
  const current = running.get(jobId);
  if (current) {
    // A paused run may still be finishing the questions it had in hand. Start after it ends.
    if (current.stop) current.promise.then(() => launch(jobId));
    return;
  }
  const state = { stop: false, busyStreak: 0, promise: null };
  running.set(jobId, state);
  state.promise = runJob(jobId, state).catch((e) => console.warn('[sat-import] run error', jobId, e.message));
}

async function startJob(jobId) {
  requireDb();
  const job = await loadJob(jobId);
  if (job.status === 'running') return publicJob(jobId);
  if (['ready', 'checkpoint', 'paused', 'done'].indexOf(job.status) < 0) {
    throw httpError(409, '아직 시작할 수 없는 상태입니다.');
  }
  if (!extract.isConfigured()) throw httpError(503, 'Claude API 키가 설정되지 않았습니다.');
  const fields = { status: 'running', status_message: '', model: extract.model() };
  if (job.status === 'checkpoint') fields.sample_passed = true;
  await setJob(job.id, fields);
  launch(job.id);
  return publicJob(jobId);
}

async function pauseJob(jobId) {
  requireDb();
  const job = await loadJob(jobId);
  if (job.status !== 'running') return publicJob(jobId);
  const state = running.get(job.id);
  if (state) state.stop = true;
  await setJob(job.id, { status: 'paused', status_message: '' });
  return publicJob(jobId);
}

async function retryFailed(jobId) {
  requireDb();
  const job = await loadJob(jobId);
  await query(
    'UPDATE ' + T.units() + " SET status = 'pending', attempts = 0, error = NULL, updated_at = now()" +
      " WHERE job_id = $1 AND status = 'failed'",
    [job.id]
  );
  return startJob(jobId);
}

async function deleteJob(jobId) {
  requireDb();
  const job = await loadJob(jobId);
  const state = running.get(job.id);
  if (state) state.stop = true;
  const removed = await query(
    'DELETE FROM ' + T.questions() + " WHERE import_job_id = $1 AND status <> 'approved'",
    [job.id]
  );
  await query('DELETE FROM ' + T.jobs() + ' WHERE id = $1', [job.id]);
  removeLocalPdf(job.id);
  return { ok: true, removedQuestions: removed.rowCount };
}

/** Convert again the unit a question came from. Returns the ids of the new questions. */
async function reconvertQuestion(questionId) {
  requireDb();
  const r = await query(
    'SELECT import_job_id, unit_idx FROM ' + T.questions() + ' WHERE id = $1',
    [String(questionId || '')]
  );
  const row = r.rows[0];
  if (!row) throw httpError(404, '문항을 찾을 수 없습니다.');
  if (!row.import_job_id) throw httpError(409, '원본 PDF가 없어 다시 변환할 수 없습니다.');
  let job;
  try {
    job = await loadJob(row.import_job_id);
  } catch (e) {
    throw httpError(409, '원본 PDF가 삭제되어 다시 변환할 수 없습니다.');
  }
  const u = await query('SELECT * FROM ' + T.units() + ' WHERE job_id = $1 AND idx = $2', [job.id, row.unit_idx]);
  if (!u.rows[0]) throw httpError(409, '원본 위치를 찾을 수 없습니다.');
  if (!extract.isConfigured()) throw httpError(503, 'Claude API 키가 설정되지 않았습니다.');
  try {
    return await convertUnit(job, u.rows[0], { force: true });
  } catch (e) {
    if (e.tokensIn || e.tokensOut) {
      await query(
        'UPDATE ' + T.units() + ' SET tokens_in = tokens_in + $3, tokens_out = tokens_out + $4 WHERE job_id = $1 AND idx = $2',
        [job.id, row.unit_idx, e.tokensIn || 0, e.tokensOut || 0]
      ).catch(() => {});
    }
    throw httpError(e.statusCode || 502, '다시 변환하지 못했습니다: ' + String(e.message || e).slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// Reading jobs, pages and crops
// ---------------------------------------------------------------------------

function jobView(job, units, questions, chunks) {
  const u = units || {};
  const q = questions || {};
  const unitTotal = Number(u.total) || 0;
  const done = Number(u.done) || 0;
  const tokensIn = Number(u.tokens_in) || 0;
  const tokensOut = Number(u.tokens_out) || 0;
  const pages = Number(u.pages) || 0;
  const remaining = Math.max(0, unitTotal - done);
  const modelName = job.model || extract.model();
  const price = extract.priceFor(modelName);

  // Before anything is converted the estimate comes from page counts, afterwards from real usage.
  const perUnitIn = done > 0 ? tokensIn / done : EST_TOKENS_IN_FIXED + EST_TOKENS_IN_PER_PAGE * (unitTotal ? pages / unitTotal : 1);
  const perUnitOut = done > 0 ? tokensOut / done : EST_TOKENS_OUT;

  return {
    id: job.id,
    filename: job.filename,
    sizeBytes: Number(job.size_bytes),
    status: job.status,
    statusMessage: job.status_message || '',
    chunkCount: job.chunk_count,
    chunksReceived: Number(chunks) || 0,
    pageCount: job.page_count,
    pagesScanned: job.pages_scanned,
    splitMode: job.split_mode,
    samplePassed: !!job.sample_passed,
    units: {
      total: unitTotal,
      done: done,
      failed: Number(u.failed) || 0,
      pending: Number(u.pending) || 0,
      sampleTotal: Number(u.sample_total) || 0,
      sampleDone: Number(u.sample_done) || 0,
      skipped: Number(u.skipped) || 0
    },
    questions: {
      total: Number(q.total) || 0,
      review: Number(q.review) || 0,
      approved: Number(q.approved) || 0,
      excluded: Number(q.excluded) || 0,
      flagged: Number(q.flagged) || 0
    },
    usage: {
      model: modelName,
      priceLabel: price.label,
      priceIn: price.input,
      priceOut: price.output,
      tokensIn: tokensIn,
      tokensOut: tokensOut,
      spentUsd: extract.costUsd(modelName, tokensIn, tokensOut),
      remainingUsd: extract.costUsd(modelName, perUnitIn * remaining, perUnitOut * remaining),
      measured: done > 0
    },
    createdBy: job.created_by,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  };
}

async function listJobs(onlyId) {
  requireDb();
  const where = onlyId != null ? ' WHERE id = $1' : '';
  const params = onlyId != null ? [String(onlyId)] : [];
  const jobs = await query('SELECT * FROM ' + T.jobs() + where + ' ORDER BY created_at DESC LIMIT 50', params);
  if (!jobs.rows.length) return [];
  const ids = jobs.rows.map((j) => j.id);
  const [units, questions, chunks] = await Promise.all([
    query(
      'SELECT job_id, count(*) AS total,' +
        " count(*) FILTER (WHERE status = 'done') AS done," +
        " count(*) FILTER (WHERE status = 'failed') AS failed," +
        " count(*) FILTER (WHERE status IN ('pending', 'working')) AS pending," +
        ' count(*) FILTER (WHERE in_sample) AS sample_total,' +
        " count(*) FILTER (WHERE in_sample AND status = 'done') AS sample_done," +
        ' coalesce(sum(skipped_count), 0) AS skipped,' +
        ' coalesce(sum(tokens_in), 0) AS tokens_in, coalesce(sum(tokens_out), 0) AS tokens_out,' +
        ' coalesce(sum(greatest(page_to, context_to) - page_from + 1), 0) AS pages' +
        ' FROM ' + T.units() + ' WHERE job_id = ANY($1) GROUP BY job_id',
      [ids]
    ),
    query(
      'SELECT import_job_id AS job_id, count(*) AS total,' +
        " count(*) FILTER (WHERE status = 'review') AS review," +
        " count(*) FILTER (WHERE status = 'approved') AS approved," +
        " count(*) FILTER (WHERE status = 'excluded') AS excluded," +
        " count(*) FILTER (WHERE status = 'review' AND jsonb_array_length(flags) > 0) AS flagged" +
        ' FROM ' + T.questions() + ' WHERE import_job_id = ANY($1) GROUP BY import_job_id',
      [ids]
    ),
    query(
      'SELECT job_id, count(*) AS n FROM ' + T.chunks() + ' WHERE job_id = ANY($1) GROUP BY job_id',
      [ids]
    )
  ]);
  const by = (rows) => rows.reduce((acc, r) => { acc[r.job_id] = r; return acc; }, {});
  const u = by(units.rows);
  const q = by(questions.rows);
  const c = by(chunks.rows);
  return jobs.rows.map((j) => jobView(j, u[j.id], q[j.id], c[j.id] && c[j.id].n));
}

async function publicJob(jobId) {
  const list = await listJobs(String(jobId || ''));
  if (!list.length) throw httpError(404, '가져오기 작업을 찾을 수 없습니다.');
  return list[0];
}

async function failedUnits(jobId) {
  requireDb();
  const r = await query(
    'SELECT idx, page_from, page_to, source_id, error FROM ' + T.units() +
      " WHERE job_id = $1 AND status = 'failed' ORDER BY idx LIMIT 200",
    [String(jobId || '')]
  );
  return r.rows.map((row) => ({
    idx: row.idx, pageFrom: row.page_from, pageTo: row.page_to, sourceId: row.source_id, error: row.error || ''
  }));
}

async function pageImage(jobId, pageNo, edge) {
  requireDb();
  const job = await loadJob(jobId);
  const n = Number(pageNo);
  if (!Number.isInteger(n) || n < 1 || (job.page_count && n > job.page_count)) {
    throw httpError(404, '쪽을 찾을 수 없습니다.');
  }
  const file = await ensureLocalPdf(job);
  const maxEdge = Math.max(400, Math.min(2200, Number(edge) || 1400));
  return pdf.render(file, n, { maxEdge: maxEdge, quality: 84 });
}

/** Cut a figure out of a page of the original PDF (box values are 0 to 1). */
async function cropFromJob(jobId, pageNo, box, snap) {
  const job = await loadJob(jobId);
  const file = await ensureLocalPdf(job);
  const b = (Array.isArray(box) ? box : []).map(Number);
  if (b.length !== 4 || b.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
    throw httpError(400, '자를 영역이 올바르지 않습니다.');
  }
  try {
    return await pdf.crop(file, Number(pageNo), b, !!snap);
  } catch (e) {
    throw httpError(400, '그림을 자르지 못했습니다: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Health: can this server open and draw a PDF at all?
// ---------------------------------------------------------------------------

function tinyPdf() {
  const stream = 'BT /F1 18 Tf 20 150 Td (Question ID 0a1b2c3d) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach((o) => { out += String(o).padStart(10, '0') + ' 00000 n \n'; });
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

let readerStatus = null;

/** Result of a one-time self test, started on the first call. Never blocks the caller. */
function pdfReaderStatus() {
  if (readerStatus) return readerStatus;
  readerStatus = { pdfReader: 'checking' };
  (async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const file = path.join(TMP_DIR, 'selftest-' + process.pid + '.pdf');
    fs.writeFileSync(file, tinyPdf());
    try {
      const opened = await pdf.open(file);
      const text = await pdf.texts(file, 1, 1);
      const image = await pdf.render(file, 1, { maxEdge: 300 });
      const ok = opened.pages === 1 && findMarkers(text.pages).length === 1 && image.data.length > 200;
      readerStatus = ok ? { pdfReader: 'ok' } : { pdfReader: 'error', reason: 'self test mismatch' };
      await pdf.close(file).catch(() => {});
    } finally {
      fs.rm(file, { force: true }, () => {});
    }
  })().catch((e) => {
    readerStatus = { pdfReader: 'error', reason: String((e && e.message) || e).slice(0, 200) };
  });
  return readerStatus;
}

/** After a restart, continue whatever was in progress. */
async function resumeOnBoot() {
  if (!isOpsDbEnabled()) return;
  try {
    await query(
      'UPDATE ' + T.units() + " SET status = 'pending', updated_at = now() WHERE status = 'working'" +
        ' AND job_id IN (SELECT id FROM ' + T.jobs() + " WHERE status = 'running')"
    );
    const r = await query('SELECT id, status FROM ' + T.jobs() + " WHERE status IN ('running', 'analyzing')");
    r.rows.forEach((row) => {
      if (row.status === 'running') launch(row.id);
      else startAnalyze(row.id);
    });
    if (r.rows.length) console.log('[sat-import] resumed ' + r.rows.length + ' job(s)');
  } catch (e) {
    console.warn('[sat-import] resume failed:', e.message);
  }
}

module.exports = {
  createJob,
  putChunk,
  completeUpload,
  startJob,
  pauseJob,
  retryFailed,
  deleteJob,
  reconvertQuestion,
  listJobs,
  publicJob,
  failedUnits,
  pageImage,
  cropFromJob,
  resumeOnBoot,
  pdfReaderStatus,
  findMarkers,
  buildUnits,
  CHUNK_BYTES,
  MAX_PDF_BYTES,
  SAMPLE_UNITS
};
