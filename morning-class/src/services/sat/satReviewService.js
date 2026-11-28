'use strict';

/**
 * SAT mistake review. Every question a student missed (or left blank) in a finished test becomes a note:
 *   1. blind retry  - the question again, the wrong answer already crossed out, no answer or explanation.
 *                     Two tries; then the explanation opens.
 *   2. new question - an unseen question of the same kind. It must be answered correctly to finish the note.
 *                     A wrong answer opens the explanation and the next try is a different question.
 */

const { query, table, withTransaction, isOpsDbEnabled } = require('../../db/pool');
const logic = require('./satExamLogic');
const exam = require('./satExamService');

const NOTES = () => table('sat_review_notes');
const SESS = () => table('sat_sessions');
const ANS = () => table('sat_answers');
const Q = () => table('sat_questions');
const SETS = () => table('sat_test_sets');
const ASSETS = () => table('sat_assets');

const BLIND_TRIES = 2;
const ADJACENT = { easy: ['medium'], medium: ['easy', 'hard'], hard: ['medium'] };

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function requireDb() {
  if (!isOpsDbEnabled()) throw httpError(503, '데이터베이스가 연결되지 않아 복습을 쓸 수 없습니다.');
}

function snippet(text) {
  return String(text || '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\[\[fig[0-9a-z_-]*\]\]/gi, '[figure]')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 110);
}

async function ensureNotes(studentId) {
  await query(
    'INSERT INTO ' + NOTES() + ' (id, session_id, student_id, question_id, module_key, position, first_answer)' +
      " SELECT 'rn_' || substr(md5(random()::text || clock_timestamp()::text || a.question_id), 1, 16)," +
      ' a.session_id, s.student_id, a.question_id, a.module_key, a.position, a.answer' +
      ' FROM ' + ANS() + ' a JOIN ' + SESS() + ' s ON s.id = a.session_id' +
      " WHERE s.student_id = $1 AND s.step = 'done' AND NOT s.is_preview AND NOT COALESCE(a.is_correct, false)" +
      ' ON CONFLICT (session_id, question_id) DO NOTHING',
    [String(studentId)]
  );
}

function noteStatus(row) {
  if (row.stage === 'done') return 'done';
  if (row.stage === 'verify') return 'verify';
  return row.blind_attempts > 0 ? 'blind_started' : 'new';
}

async function list(user) {
  requireDb();
  await ensureNotes(user.studentId);
  const r = await query(
    'SELECT n.id, n.stage, n.blind_attempts, n.module_key, n.position, n.exhausted, n.verify_history,' +
      ' q.section, q.domain, q.skill, q.difficulty, q.qtype, q.stem, q.passage,' +
      ' st.name AS set_name, s.completed_at AS taken_at' +
      ' FROM ' + NOTES() + ' n JOIN ' + Q() + ' q ON q.id = n.question_id' +
      ' JOIN ' + SESS() + ' s ON s.id = n.session_id JOIN ' + SETS() + ' st ON st.id = s.set_id' +
      " WHERE n.student_id = $1 ORDER BY (n.stage = 'done'), s.completed_at DESC, n.module_key, n.position",
    [String(user.studentId)]
  );
  const notes = r.rows.map((row) => ({
    id: row.id,
    status: noteStatus(row),
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    qtype: row.qtype,
    setName: row.set_name,
    takenAt: row.taken_at,
    position: row.position,
    moduleKey: row.module_key,
    tries: (row.verify_history || []).length,
    exhausted: row.exhausted,
    snippet: snippet(row.stem || row.passage)
  }));
  const done = notes.filter((n) => n.status === 'done').length;
  return { notes: notes, summary: { total: notes.length, done: done, open: notes.length - done } };
}

async function summary(user) {
  requireDb();
  await ensureNotes(user.studentId);
  const r = await query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE stage = 'done')::int AS done FROM " + NOTES() + ' WHERE student_id = $1',
    [String(user.studentId)]
  );
  return { total: r.rows[0].total, done: r.rows[0].done, open: r.rows[0].total - r.rows[0].done };
}

async function loadNote(client, id, user, lock) {
  const run = client ? client.query.bind(client) : query;
  const r = await run('SELECT * FROM ' + NOTES() + ' WHERE id = $1' + (lock ? ' FOR UPDATE' : ''), [String(id || '')]);
  const row = r.rows[0];
  if (!row || row.student_id !== String(user.studentId)) throw httpError(404, '복습 항목을 찾을 수 없습니다.');
  return row;
}

async function loadQuestion(id, client) {
  const run = client ? client.query.bind(client) : query;
  const r = await run('SELECT * FROM ' + Q() + ' WHERE id = $1', [String(id || '')]);
  return r.rows[0] || null;
}

async function viewQuestion(row) {
  const r = await query('SELECT id, ref FROM ' + ASSETS() + ' WHERE question_id = $1', [row.id]);
  const map = {};
  r.rows.forEach((a) => { map[a.ref] = a.id; });
  return exam.studentQuestion(row, map);
}

function reveal(qrow, given) {
  return {
    yourAnswer: given || '',
    correctAnswer: qrow.answer,
    acceptedAnswers: qrow.qtype === 'spr' ? (qrow.accepted_answers || []) : [],
    rationale: qrow.rationale || ''
  };
}

function lastVerify(note) {
  const h = note.verify_history || [];
  return h.length ? h[h.length - 1] : null;
}

/** An unseen question of the same kind, widening step by step. */
async function pickVerifyQuestion(client, note, original) {
  const seen = await client.query(
    'SELECT DISTINCT a.question_id AS id FROM ' + ANS() + ' a JOIN ' + SESS() + ' s ON s.id = a.session_id WHERE s.student_id = $1' +
      ' UNION SELECT question_id FROM ' + NOTES() + ' WHERE student_id = $1',
    [note.student_id]
  );
  const used = new Set(seen.rows.map((x) => x.id));
  const others = await client.query('SELECT verify_history FROM ' + NOTES() + ' WHERE student_id = $1', [note.student_id]);
  others.rows.forEach((o) => (o.verify_history || []).forEach((h) => used.add(h.questionId)));
  used.add(original.id);
  const exclude = Array.from(used);
  const near = ADJACENT[original.difficulty] || [];
  const tiers = [
    { label: 'same skill, same difficulty', sql: 'q.skill = $3 AND q.difficulty = $4', params: [original.skill, original.difficulty] },
    { label: 'same skill, nearby difficulty', sql: 'q.skill = $3 AND q.difficulty = ANY($4::text[])', params: [original.skill, near] },
    { label: 'same skill', sql: 'q.skill = $3', params: [original.skill] },
    { label: 'same domain, same difficulty', sql: 'q.domain = $3 AND q.difficulty = $4', params: [original.domain, original.difficulty] },
    { label: 'same domain', sql: 'q.domain = $3', params: [original.domain] }
  ];
  for (const t of tiers) {
    const r = await client.query(
      'SELECT q.* FROM ' + Q() + " q WHERE q.status = 'approved' AND q.qtype IN ('mcq','spr') AND q.section = $1 AND q.id <> ALL($2::text[]) AND " +
        t.sql + ' ORDER BY random() LIMIT 1',
      [original.section, exclude].concat(t.params)
    );
    if (r.rows[0]) return { row: r.rows[0], tier: t.label };
  }
  return null;
}

function noteMeta(note, original) {
  return {
    id: note.id,
    stage: note.stage,
    section: original.section,
    domain: original.domain,
    skill: original.skill,
    difficulty: original.difficulty,
    position: note.position,
    moduleKey: note.module_key,
    tries: (note.verify_history || []).length,
    exhausted: note.exhausted
  };
}

/** What the student sees now. May pick the next new question. */
async function buildView(id, user) {
  const note = await withTransaction(async (client) => {
    const n = await loadNote(client, id, user, true);
    if (n.stage === 'verify' && !n.verify_question_id) {
      const original = await loadQuestion(n.question_id, client);
      const pick = await pickVerifyQuestion(client, n, original);
      if (!pick) {
        await client.query("UPDATE " + NOTES() + " SET stage = 'done', exhausted = true, completed_at = now(), updated_at = now() WHERE id = $1", [n.id]);
        return Object.assign({}, n, { stage: 'done', exhausted: true });
      }
      const h = (n.verify_history || []).slice();
      h.push({ questionId: pick.row.id, tier: pick.tier, answer: null, correct: null, at: null });
      await client.query('UPDATE ' + NOTES() + ' SET verify_question_id = $2, verify_history = $3, updated_at = now() WHERE id = $1', [n.id, pick.row.id, JSON.stringify(h)]);
      return Object.assign({}, n, { verify_question_id: pick.row.id, verify_history: h });
    }
    return n;
  });

  const original = await loadQuestion(note.question_id);
  const out = { note: noteMeta(note, original), view: '', question: null, eliminated: [], reveal: null, original: null, tier: '' };
  const latest = lastVerify(note);

  if (note.stage === 'blind') {
    const wrong = (note.blind_wrong || []).slice();
    if (original.qtype === 'mcq' && note.first_answer) wrong.push(note.first_answer);
    out.view = 'blind';
    out.question = await viewQuestion(original);
    out.eliminated = original.qtype === 'mcq' ? Array.from(new Set(wrong)) : [];
    out.attempts = note.blind_attempts;
    out.maxAttempts = BLIND_TRIES;
    return out;
  }

  out.original = {
    question: await viewQuestion(original),
    blindCorrect: note.blind_correct,
    reveal: reveal(original, note.first_answer)
  };
  if (note.stage === 'verify') {
    const vq = await loadQuestion(note.verify_question_id);
    out.question = await viewQuestion(vq);
    out.tier = latest ? latest.tier : '';
    out.attemptNo = (note.verify_history || []).length;
    if (latest && latest.answer !== null && latest.questionId === note.verify_question_id) {
      out.view = 'verify_result';
      out.reveal = Object.assign(reveal(vq, latest.answer), { correct: !!latest.correct });
    } else {
      out.view = 'verify';
    }
    return out;
  }

  out.view = 'done';
  if (latest && latest.answer !== null) {
    const vq = await loadQuestion(latest.questionId);
    out.question = await viewQuestion(vq);
    out.reveal = Object.assign(reveal(vq, latest.answer), { correct: !!latest.correct });
  } else {
    out.question = out.original.question;
  }
  return out;
}

function cleanGiven(qtype, raw) {
  if (qtype === 'mcq') {
    const m = String(raw == null ? '' : raw).trim().toUpperCase();
    return /^[A-D]$/.test(m) ? m : '';
  }
  return logic.cleanSprInput(raw);
}

async function answer(id, user, given) {
  requireDb();
  const result = await withTransaction(async (client) => {
    const note = await loadNote(client, id, user, true);
    if (note.stage === 'blind') {
      const original = await loadQuestion(note.question_id, client);
      const a = cleanGiven(original.qtype, given);
      if (!a) throw httpError(400, '답을 입력해 주세요.');
      const blocked = original.qtype === 'mcq'
        ? (note.blind_wrong || []).concat(note.first_answer ? [note.first_answer] : [])
        : [];
      if (blocked.indexOf(a) >= 0) throw httpError(409, '이미 지운 선택지입니다.');
      const tries = note.blind_attempts + 1;
      const ok = logic.gradeAnswer(original, a);
      if (ok) {
        await client.query(
          "UPDATE " + NOTES() + " SET blind_attempts = $2, blind_correct = true, stage = 'verify', updated_at = now() WHERE id = $1",
          [note.id, tries]
        );
        return { correct: true, final: true, reveal: reveal(original, a) };
      }
      const wrong = (note.blind_wrong || []).concat([a]);
      if (tries >= BLIND_TRIES) {
        await client.query(
          "UPDATE " + NOTES() + " SET blind_attempts = $2, blind_wrong = $3, blind_correct = false, stage = 'verify', updated_at = now() WHERE id = $1",
          [note.id, tries, JSON.stringify(wrong)]
        );
        return { correct: false, final: true, reveal: reveal(original, a) };
      }
      await client.query('UPDATE ' + NOTES() + ' SET blind_attempts = $2, blind_wrong = $3, updated_at = now() WHERE id = $1', [note.id, tries, JSON.stringify(wrong)]);
      return { correct: false, final: false };
    }
    if (note.stage === 'verify') {
      const latest = lastVerify(note);
      if (!note.verify_question_id || !latest || latest.questionId !== note.verify_question_id || latest.answer !== null) {
        throw httpError(409, '지금은 답할 수 있는 새 문제가 없습니다.');
      }
      const vq = await loadQuestion(note.verify_question_id, client);
      const a = cleanGiven(vq.qtype, given);
      if (!a) throw httpError(400, '답을 입력해 주세요.');
      const ok = logic.gradeAnswer(vq, a);
      const h = (note.verify_history || []).slice();
      h[h.length - 1] = Object.assign({}, latest, { answer: a, correct: ok, at: new Date().toISOString() });
      if (ok) {
        await client.query(
          "UPDATE " + NOTES() + " SET verify_history = $2, stage = 'done', completed_at = now(), updated_at = now() WHERE id = $1",
          [note.id, JSON.stringify(h)]
        );
      } else {
        await client.query('UPDATE ' + NOTES() + ' SET verify_history = $2, updated_at = now() WHERE id = $1', [note.id, JSON.stringify(h)]);
      }
      return { correct: ok, final: true, reveal: reveal(vq, a) };
    }
    throw httpError(409, '이미 끝낸 복습입니다.');
  });
  return { result: result, state: await buildView(id, user) };
}

/** After a wrong answer to the new question: move on to a different one. */
async function next(id, user) {
  requireDb();
  await withTransaction(async (client) => {
    const note = await loadNote(client, id, user, true);
    if (note.stage !== 'verify') return;
    const latest = lastVerify(note);
    if (!latest || latest.answer === null || latest.correct) return;
    await client.query('UPDATE ' + NOTES() + ' SET verify_question_id = NULL, updated_at = now() WHERE id = $1', [note.id]);
  });
  return buildView(id, user);
}

async function assetForNote(noteId, assetId, user) {
  requireDb();
  const note = await loadNote(null, noteId, user, false);
  const ids = [note.question_id].concat((note.verify_history || []).map((h) => h.questionId));
  const r = await query(
    'SELECT a.mime, a.data FROM ' + ASSETS() + ' a WHERE a.id = $1 AND a.question_id = ANY($2::text[])',
    [String(assetId || ''), ids]
  );
  if (!r.rows[0]) throw httpError(404, '그림을 찾을 수 없습니다.');
  return { mime: r.rows[0].mime, data: r.rows[0].data };
}

module.exports = { list, summary, getNote: buildView, answer, next, assetForNote, BLIND_TRIES };
