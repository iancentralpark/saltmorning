'use strict';

/** SAT question bank: list, read, edit, approve, and manage the figures of converted questions. */

const crypto = require('crypto');
const { query, table, isOpsDbEnabled } = require('../../db/pool');
const validate = require('./satValidate');
const taxonomy = require('./satTaxonomy');
const satImport = require('./satImportService');

const STATUSES = ['review', 'approved', 'excluded'];
// Raised when a question is converted; they cannot be recomputed from the stored fields.
const CONVERSION_FLAGS = ['text_drift', 'unit_count', 'truncated', 'fig_crop_failed'];

const Q = () => table('sat_questions');
const A = () => table('sat_assets');
const J = () => table('sat_import_jobs');

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function requireDb() {
  if (!isOpsDbEnabled()) throw httpError(503, '데이터베이스가 연결되지 않아 SAT 문제은행을 쓸 수 없습니다.');
}

function snippet(text) {
  return String(text || '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\[\[fig[0-9a-z_-]*\]\]/gi, '[그림]')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

function buildWhere(filters) {
  const f = filters || {};
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', '$' + params.length));
  };
  if (f.jobId) add('import_job_id = ?', String(f.jobId));
  if (f.section && taxonomy.SECTIONS[f.section]) add('section = ?', f.section);
  if (f.domain) add('domain = ?', String(f.domain));
  if (f.difficulty && taxonomy.DIFFICULTIES.indexOf(f.difficulty) >= 0) add('difficulty = ?', f.difficulty);
  if (f.qtype === 'mcq' || f.qtype === 'spr') add('qtype = ?', f.qtype);
  if (f.search) {
    add('(source_id ILIKE ? OR stem ILIKE ? OR passage ILIKE ?)'.replace(/\?/g, '$' + (params.length + 1)),
      '%' + String(f.search).replace(/[%_\\]/g, '\\$&').slice(0, 80) + '%');
  }
  return { where: where, params: params };
}

async function listQuestions(filters) {
  requireDb();
  const f = filters || {};
  const base = buildWhere(f);
  const where = base.where.slice();
  const params = base.params.slice();
  if (STATUSES.indexOf(f.status) >= 0) {
    params.push(f.status);
    where.push('status = $' + params.length);
  }
  if (f.flagged === true || f.flagged === 'true' || f.flagged === '1') {
    where.push('jsonb_array_length(flags) > 0');
  }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const limit = Math.max(1, Math.min(200, Number(f.limit) || 60));
  const offset = Math.max(0, Number(f.offset) || 0);

  const baseClause = base.where.length ? ' WHERE ' + base.where.join(' AND ') : '';
  const [rows, total, counts] = await Promise.all([
    query(
      'SELECT id, source_id, import_job_id, page_from, section, domain, skill, difficulty, qtype, status, edited,' +
        ' jsonb_array_length(flags) AS flag_count, left(stem, 300) AS stem, left(passage, 200) AS passage' +
        ' FROM ' + Q() + clause +
        ' ORDER BY import_job_id NULLS LAST, unit_idx NULLS LAST, id' +
        ' LIMIT ' + limit + ' OFFSET ' + offset,
      params
    ),
    query('SELECT count(*)::int AS n FROM ' + Q() + clause, params),
    query(
      'SELECT status, count(*)::int AS n,' +
        ' count(*) FILTER (WHERE jsonb_array_length(flags) > 0)::int AS flagged' +
        ' FROM ' + Q() + baseClause + ' GROUP BY status',
      base.params
    )
  ]);

  const summary = { review: 0, approved: 0, excluded: 0, reviewFlagged: 0, reviewClean: 0 };
  counts.rows.forEach((r) => {
    summary[r.status] = r.n;
    if (r.status === 'review') {
      summary.reviewFlagged = r.flagged;
      summary.reviewClean = r.n - r.flagged;
    }
  });

  return {
    total: total.rows[0].n,
    offset: offset,
    summary: summary,
    questions: rows.rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      jobId: r.import_job_id,
      page: r.page_from,
      section: r.section,
      domain: r.domain,
      skill: r.skill,
      difficulty: r.difficulty,
      qtype: r.qtype,
      status: r.status,
      edited: r.edited,
      flagCount: r.flag_count,
      snippet: snippet(r.stem) || snippet(r.passage)
    }))
  };
}

async function loadRow(id) {
  const r = await query('SELECT * FROM ' + Q() + ' WHERE id = $1', [String(id || '')]);
  if (!r.rows[0]) throw httpError(404, '문항을 찾을 수 없습니다.');
  return r.rows[0];
}

async function loadAssets(questionId) {
  const r = await query(
    'SELECT id, ref, page, width, height FROM ' + A() + ' WHERE question_id = $1 ORDER BY ref',
    [questionId]
  );
  return r.rows;
}

async function questionView(row) {
  const [assets, job] = await Promise.all([
    loadAssets(row.id),
    row.import_job_id
      ? query('SELECT page_count FROM ' + J() + ' WHERE id = $1', [row.import_job_id])
      : Promise.resolve({ rows: [] })
  ]);
  return {
    id: row.id,
    sourceId: row.source_id,
    jobId: row.import_job_id,
    hasSource: job.rows.length > 0,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    qtype: row.qtype,
    passage: row.passage,
    stem: row.stem,
    choices: row.choices || [],
    answer: row.answer,
    acceptedAnswers: row.accepted_answers || [],
    rationale: row.rationale,
    status: row.status,
    flags: row.flags || [],
    notes: row.notes,
    edited: row.edited,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    updatedAt: row.updated_at,
    assets: assets.map((a) => ({ id: a.id, ref: a.ref, page: a.page, width: a.width, height: a.height }))
  };
}

async function getQuestion(id) {
  requireDb();
  return questionView(await loadRow(id));
}

/** Recompute flags from the stored fields. keepCodes: conversion-time flags to carry over. */
async function storeNormalized(row, input, opts) {
  const assets = await loadAssets(row.id);
  const norm = validate.normalizeQuestion(input, {
    facts: row.source_facts || {},
    assetRefs: assets.map((a) => a.ref)
  });
  const kept = (row.flags || []).filter((f) => f && opts.keepCodes.indexOf(f.code) >= 0);
  const q = norm.question;
  const flags = norm.flags.concat(kept);
  const r = await query(
    'UPDATE ' + Q() + ' SET source_id = $2, section = $3, domain = $4, skill = $5, difficulty = $6, qtype = $7,' +
      ' passage = $8, stem = $9, choices = $10, answer = $11, accepted_answers = $12, rationale = $13,' +
      ' flags = $14, notes = $15, edited = edited OR $16, updated_at = now() WHERE id = $1 RETURNING *',
    [
      row.id, q.sourceId, q.section, q.domain, q.skill, q.difficulty, q.qtype, q.passage, q.stem,
      JSON.stringify(q.choices), q.answer, JSON.stringify(q.acceptedAnswers), q.rationale,
      JSON.stringify(flags), q.notes, !!opts.edited
    ]
  );
  return r.rows[0];
}

function storedFields(row) {
  return {
    sourceId: row.source_id,
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    passage: row.passage,
    stem: row.stem,
    choices: row.choices || [],
    answer: row.answer,
    acceptedAnswers: row.accepted_answers || [],
    rationale: row.rationale,
    notes: row.notes
  };
}

/** Save a person's edit. The AI note and the conversion-time warnings are cleared: a person has now read it. */
async function updateQuestion(id, patch) {
  requireDb();
  const row = await loadRow(id);
  const p = patch || {};
  const input = storedFields(row);
  ['section', 'domain', 'skill', 'difficulty', 'passage', 'stem', 'answer', 'rationale'].forEach((k) => {
    if (typeof p[k] === 'string') input[k] = p[k];
  });
  if (typeof p.sourceId === 'string') input.sourceId = p.sourceId;
  if (Array.isArray(p.choices)) input.choices = p.choices;
  if (Array.isArray(p.acceptedAnswers)) input.acceptedAnswers = p.acceptedAnswers;
  input.notes = '';

  if (input.sourceId && input.sourceId.trim().toLowerCase() !== row.source_id) {
    const dup = await query('SELECT id FROM ' + Q() + ' WHERE source_id = $1 AND id <> $2',
      [input.sourceId.trim().toLowerCase(), row.id]);
    if (dup.rows.length) throw httpError(409, '같은 Question ID의 문항이 이미 있습니다.');
  }
  const updated = await storeNormalized(row, input, { keepCodes: [], edited: true });
  return questionView(updated);
}

async function setStatus(id, status, userKey) {
  requireDb();
  if (STATUSES.indexOf(status) < 0) throw httpError(400, '상태가 올바르지 않습니다.');
  const r = await query(
    'UPDATE ' + Q() + ' SET status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()' +
      ' WHERE id = $1 RETURNING *',
    [String(id || ''), status, String(userKey || '')]
  );
  if (!r.rows[0]) throw httpError(404, '문항을 찾을 수 없습니다.');
  return questionView(r.rows[0]);
}

/** Approve every question still waiting for review that has no warnings, within the given filters. */
async function approveClean(filters, userKey) {
  requireDb();
  const base = buildWhere(filters);
  const params = base.params.slice();
  params.push(String(userKey || ''));
  const where = base.where.concat(["status = 'review'", 'jsonb_array_length(flags) = 0']);
  const r = await query(
    'UPDATE ' + Q() + " SET status = 'approved', reviewed_by = $" + params.length +
      ', reviewed_at = now(), updated_at = now() WHERE ' + where.join(' AND '),
    params
  );
  return { approved: r.rowCount };
}

async function assetData(assetId) {
  requireDb();
  const r = await query('SELECT mime, data FROM ' + A() + ' WHERE id = $1', [String(assetId || '')]);
  if (!r.rows[0]) throw httpError(404, '그림을 찾을 수 없습니다.');
  return r.rows[0];
}

function nextRef(assets) {
  let n = 1;
  while (assets.some((a) => a.ref === 'fig' + n)) n++;
  return 'fig' + n;
}

/** Cut a figure from the original PDF page. With ref, replaces that figure; otherwise adds a new one. */
async function cropAsset(questionId, input) {
  requireDb();
  const row = await loadRow(questionId);
  if (!row.import_job_id) throw httpError(409, '원본 PDF가 없어 그림을 자를 수 없습니다.');
  const page = Number(input && input.page);
  const crop = await satImport.cropFromJob(row.import_job_id, page, input && input.box, false);
  const assets = await loadAssets(row.id);
  const wanted = String((input && input.ref) || '').toLowerCase();
  const ref = wanted && assets.some((a) => a.ref === wanted) ? wanted : nextRef(assets);
  await query(
    'INSERT INTO ' + A() + ' (id, question_id, ref, page, box, mime, width, height, data)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)' +
      ' ON CONFLICT (question_id, ref) DO UPDATE SET id = EXCLUDED.id, page = EXCLUDED.page, box = EXCLUDED.box,' +
      ' mime = EXCLUDED.mime, width = EXCLUDED.width, height = EXCLUDED.height, data = EXCLUDED.data',
    [
      'sa_' + crypto.randomBytes(8).toString('hex'), row.id, ref, page, JSON.stringify(crop.box),
      crop.mime, crop.width, crop.height, crop.data
    ]
  );
  const input2 = storedFields(row);
  const referenced = [input2.passage, input2.stem, input2.rationale]
    .concat(input2.choices.map((c) => c && c.text))
    .some((t) => validate.figureRefs(t).indexOf(ref) >= 0);
  if (!referenced) input2.stem = (input2.stem ? input2.stem + '\n\n' : '') + '[[' + ref + ']]';
  const keep = CONVERSION_FLAGS.filter((c) => c !== 'fig_crop_failed');
  const updated = await storeNormalized(row, input2, { keepCodes: keep, edited: true });
  return { ref: ref, question: await questionView(updated) };
}

async function deleteAsset(questionId, ref) {
  requireDb();
  const row = await loadRow(questionId);
  const name = String(ref || '').toLowerCase();
  await query('DELETE FROM ' + A() + ' WHERE question_id = $1 AND ref = $2', [row.id, name]);
  const fields = storedFields(row);
  // A choice that is only a figure keeps its marker so the missing figure stays visible as a warning.
  const marker = new RegExp('\\[\\[\\s*' + name.replace(/[^a-z0-9]/g, '') + '\\s*\\]\\]', 'gi');
  const strip = (text) => String(text || '')
    .replace(marker, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  fields.passage = strip(fields.passage);
  fields.stem = strip(fields.stem);
  fields.rationale = strip(fields.rationale);
  const updated = await storeNormalized(row, fields, { keepCodes: CONVERSION_FLAGS, edited: true });
  return questionView(updated);
}

module.exports = {
  listQuestions,
  getQuestion,
  updateQuestion,
  setStatus,
  approveClean,
  assetData,
  cropAsset,
  deleteAsset,
  STATUSES
};
