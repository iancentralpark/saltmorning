'use strict';

/** SAT mock tests: sets, assignments, and a student's sitting from first module to score. */

const crypto = require('crypto');
const { query, table, withTransaction, isOpsDbEnabled } = require('../../db/pool');
const logic = require('./satExamLogic');
const taxonomy = require('./satTaxonomy');

const SETS = () => table('sat_test_sets');
const ITEMS = () => table('sat_test_set_items');
const ASSIGN = () => table('sat_assignments');
const SESS = () => table('sat_sessions');
const ANS = () => table('sat_answers');
const Q = () => table('sat_questions');
const ASSETS = () => table('sat_assets');
const SCORES = () => table('sat_score_tables');

// Answers are still accepted this long after a module's clock ends, for requests already on the wire.
const GRACE_MS = 8000;

const MODULE_LABEL = {
  rw1: { section: 'Section 1', number: 1, name: 'Reading and Writing' },
  rw2: { section: 'Section 1', number: 2, name: 'Reading and Writing' },
  m1: { section: 'Section 2', number: 1, name: 'Math' },
  m2: { section: 'Section 2', number: 2, name: 'Math' }
};

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function requireDb() {
  if (!isOpsDbEnabled()) throw httpError(503, '데이터베이스가 연결되지 않아 SAT 모의고사를 쓸 수 없습니다.');
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function snippet(text) {
  return String(text || '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\[\[fig[0-9a-z_-]*\]\]/gi, '[그림]')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function moduleTitle(step) {
  const m = MODULE_LABEL[step];
  return m ? m.section + ', Module ' + m.number + ': ' + m.name : '';
}

// -------------------------------------------------------------------- sets

function publicSet(row, extra) {
  const structure = logic.normalizeStructure(row.structure);
  let total = 0;
  let minutes = 0;
  logic.MODULE_STEPS.forEach((s) => {
    total += structure.modules[s].count;
    minutes += structure.modules[s].minutes;
  });
  return Object.assign({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.archived_at ? 'archived' : row.status,
    structure: structure,
    studentQuestions: total,
    studentMinutes: minutes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }, extra || {});
}

async function loadSetRow(id) {
  const r = await query('SELECT * FROM ' + SETS() + ' WHERE id = $1', [String(id || '')]);
  if (!r.rows[0]) throw httpError(404, '세트를 찾을 수 없습니다.');
  return r.rows[0];
}

async function listSets() {
  requireDb();
  const r = await query(
    'SELECT s.*,' +
      ' (SELECT count(*) FROM ' + ITEMS() + ' i WHERE i.set_id = s.id) AS item_count,' +
      ' (SELECT count(*) FROM ' + SESS() + ' x WHERE x.set_id = s.id AND NOT x.is_preview) AS session_count,' +
      ' (SELECT count(*) FROM ' + ASSIGN() + ' a WHERE a.set_id = s.id AND a.removed_at IS NULL) AS assignment_count' +
      ' FROM ' + SETS() + ' s WHERE s.archived_at IS NULL ORDER BY s.created_at DESC'
  );
  return r.rows.map((row) => {
    const set = publicSet(row, {
      itemCount: Number(row.item_count),
      sessionCount: Number(row.session_count),
      assignmentCount: Number(row.assignment_count)
    });
    set.itemTarget = setItemTarget(set.structure);
    return set;
  });
}

function setItemTarget(structure) {
  const m = structure.modules;
  return m.rw1.count + 2 * m.rw2.count + m.m1.count + 2 * m.m2.count;
}

function questionBrief(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    qtype: row.qtype,
    status: row.status,
    snippet: snippet(row.stem || row.passage)
  };
}

async function loadItems(setId) {
  const r = await query(
    'SELECT i.module_key, i.position, q.id, q.source_id, q.section, q.domain, q.skill, q.difficulty, q.qtype,' +
      ' q.status, q.stem, q.passage' +
      ' FROM ' + ITEMS() + ' i JOIN ' + Q() + ' q ON q.id = i.question_id' +
      ' WHERE i.set_id = $1 ORDER BY i.module_key, i.position',
    [setId]
  );
  const out = {};
  logic.MODULE_KEYS.forEach((k) => { out[k] = []; });
  r.rows.forEach((row) => {
    if (out[row.module_key]) out[row.module_key].push(Object.assign({ position: row.position }, questionBrief(row)));
  });
  return out;
}

/** Everything that stops a set from being handed to students. */
function setProblems(set, items) {
  const problems = [];
  const seen = new Set();
  logic.MODULE_KEYS.forEach((key) => {
    const want = logic.structureKeyCount(set.structure, key);
    const list = items[key] || [];
    if (list.length < want) problems.push(key + ' 모듈에 문항이 ' + (want - list.length) + '개 모자랍니다.');
    list.forEach((q) => {
      if (seen.has(q.id)) problems.push('같은 문항이 두 번 들어 있습니다: ' + (q.sourceId || q.id));
      seen.add(q.id);
      if (q.status !== 'approved') problems.push((q.sourceId || q.id) + ' 문항이 승인 상태가 아닙니다.');
      if (key.indexOf('rw') === 0 && q.section !== 'rw') problems.push((q.sourceId || q.id) + ' 문항은 Reading and Writing이 아닙니다.');
      if (key.indexOf('m') === 0 && q.section !== 'math') problems.push((q.sourceId || q.id) + ' 문항은 Math가 아닙니다.');
    });
  });
  return Array.from(new Set(problems));
}

async function getSet(id) {
  requireDb();
  const row = await loadSetRow(id);
  const items = await loadItems(row.id);
  const counts = await query(
    'SELECT (SELECT count(*) FROM ' + SESS() + ' WHERE set_id = $1 AND NOT is_preview) AS sessions',
    [row.id]
  );
  const set = publicSet(row, { sessionCount: Number(counts.rows[0].sessions) });
  set.itemTarget = setItemTarget(set.structure);
  return { set: set, items: items, problems: setProblems(set, items) };
}

async function approvedPool() {
  const r = await query(
    'SELECT id, section, domain, difficulty FROM ' + Q() + " WHERE status = 'approved' AND qtype IN ('mcq','spr')"
  );
  return r.rows;
}

async function poolSummary() {
  requireDb();
  const r = await query(
    'SELECT section, domain, difficulty, count(*)::int AS n FROM ' + Q() + " WHERE status = 'approved' GROUP BY 1,2,3"
  );
  const bySection = { rw: 0, math: 0 };
  r.rows.forEach((x) => { if (bySection[x.section] != null) bySection[x.section] += x.n; });
  return { bySection: bySection, rows: r.rows };
}

async function createSet(input, user) {
  requireDb();
  const name = String((input && input.name) || '').trim().slice(0, 120);
  if (!name) throw httpError(400, '세트 이름을 입력해 주세요.');
  const preset = input && input.preset === 'mini' ? logic.MINI_STRUCTURE : logic.FULL_STRUCTURE;
  const structure = logic.normalizeStructure(input && input.structure ? input.structure : preset);
  const id = newId('ss');
  await query(
    'INSERT INTO ' + SETS() + ' (id, name, description, status, structure, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, name, String((input && input.description) || '').trim().slice(0, 600), 'draft', JSON.stringify(structure), user]
  );
  let composed = null;
  if (!input || input.auto !== false) composed = await composeSet(id, null);
  return { id: id, composed: composed };
}

async function assertEditable(row) {
  if (row.archived_at) throw httpError(409, '보관된 세트입니다.');
  if (row.status !== 'draft') throw httpError(409, '배포된 세트는 고칠 수 없습니다. 먼저 초안으로 되돌려 주세요.');
}

/** Fill the whole set, or one module list, from approved questions. */
async function composeSet(setId, onlyKey) {
  requireDb();
  const row = await loadSetRow(setId);
  await assertEditable(row);
  const structure = logic.normalizeStructure(row.structure);
  const pool = await approvedPool();
  const existing = await loadItems(row.id);
  const keys = onlyKey ? [onlyKey] : logic.MODULE_KEYS;
  if (onlyKey && logic.MODULE_KEYS.indexOf(onlyKey) < 0) throw httpError(400, '알 수 없는 모듈입니다.');

  const used = [];
  logic.MODULE_KEYS.forEach((k) => {
    if (keys.indexOf(k) < 0) (existing[k] || []).forEach((q) => used.push(q.id));
  });
  const result = logic.composeModules(pool, structure, keys, used);

  await withTransaction(async (client) => {
    for (const key of keys) {
      await client.query('DELETE FROM ' + ITEMS() + ' WHERE set_id = $1 AND module_key = $2', [row.id, key]);
      const ids = result.items[key] || [];
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          'INSERT INTO ' + ITEMS() + ' (set_id, module_key, position, question_id) VALUES ($1,$2,$3,$4)',
          [row.id, key, i + 1, ids[i]]
        );
      }
    }
    await client.query('UPDATE ' + SETS() + ' SET updated_at = now() WHERE id = $1', [row.id]);
  });
  return result.notes;
}

async function updateSet(id, patch) {
  requireDb();
  const row = await loadSetRow(id);
  if (row.archived_at) throw httpError(409, '보관된 세트입니다.');
  const sets = [];
  const params = [row.id];
  const add = (col, val) => {
    params.push(val);
    sets.push(col + ' = $' + params.length);
  };
  if (patch && patch.name !== undefined) {
    const name = String(patch.name || '').trim().slice(0, 120);
    if (!name) throw httpError(400, '세트 이름을 입력해 주세요.');
    add('name', name);
  }
  if (patch && patch.description !== undefined) add('description', String(patch.description || '').trim().slice(0, 600));
  if (!sets.length) return getSet(id);
  await query('UPDATE ' + SETS() + ' SET ' + sets.join(', ') + ', updated_at = now() WHERE id = $1', params);
  return getSet(id);
}

async function setHasSessions(setId) {
  const r = await query('SELECT 1 FROM ' + SESS() + ' WHERE set_id = $1 AND NOT is_preview LIMIT 1', [setId]);
  return r.rows.length > 0;
}

async function publishSet(id) {
  requireDb();
  const view = await getSet(id);
  if (view.set.status === 'archived') throw httpError(409, '보관된 세트입니다.');
  if (view.problems.length) throw httpError(409, '아직 배포할 수 없습니다. ' + view.problems.slice(0, 3).join(' '));
  await query('UPDATE ' + SETS() + " SET status = 'published', updated_at = now() WHERE id = $1", [id]);
  return getSet(id);
}

async function unpublishSet(id) {
  requireDb();
  const row = await loadSetRow(id);
  if (await setHasSessions(row.id)) {
    throw httpError(409, '이미 응시한 학생이 있어 초안으로 되돌릴 수 없습니다. 새 세트를 복제해서 고쳐 주세요.');
  }
  await query('UPDATE ' + SETS() + " SET status = 'draft', updated_at = now() WHERE id = $1", [row.id]);
  return getSet(id);
}

async function deleteSet(id) {
  requireDb();
  const row = await loadSetRow(id);
  if (await setHasSessions(row.id)) {
    await query('UPDATE ' + SETS() + ' SET archived_at = now(), updated_at = now() WHERE id = $1', [row.id]);
    await query('UPDATE ' + ASSIGN() + ' SET removed_at = now() WHERE set_id = $1 AND removed_at IS NULL', [row.id]);
    return { archived: true };
  }
  await query('DELETE FROM ' + SETS() + ' WHERE id = $1', [row.id]);
  return { deleted: true };
}

async function duplicateSet(id, user) {
  requireDb();
  const row = await loadSetRow(id);
  const newSet = newId('ss');
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO ' + SETS() + ' (id, name, description, status, structure, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [newSet, (row.name + ' (복사)').slice(0, 120), row.description, 'draft', JSON.stringify(row.structure), user]
    );
    await client.query(
      'INSERT INTO ' + ITEMS() + ' (set_id, module_key, position, question_id)' +
        ' SELECT $1, module_key, position, question_id FROM ' + ITEMS() + ' WHERE set_id = $2',
      [newSet, row.id]
    );
  });
  return { id: newSet };
}

async function replaceItem(setId, moduleKey, position, questionId) {
  requireDb();
  const row = await loadSetRow(setId);
  await assertEditable(row);
  if (logic.MODULE_KEYS.indexOf(moduleKey) < 0) throw httpError(400, '알 수 없는 모듈입니다.');
  const q = await query('SELECT id, section, status FROM ' + Q() + ' WHERE id = $1', [String(questionId || '')]);
  if (!q.rows[0]) throw httpError(404, '문항을 찾을 수 없습니다.');
  if (q.rows[0].status !== 'approved') throw httpError(409, '승인된 문항만 넣을 수 있습니다.');
  const wantSection = moduleKey.indexOf('rw') === 0 ? 'rw' : 'math';
  if (q.rows[0].section !== wantSection) throw httpError(409, '이 모듈에는 넣을 수 없는 영역의 문항입니다.');
  const pos = Number(position);
  const count = logic.structureKeyCount(logic.normalizeStructure(row.structure), moduleKey);
  if (!(pos >= 1 && pos <= count)) throw httpError(400, '위치가 올바르지 않습니다.');
  const dup = await query(
    'SELECT module_key, position FROM ' + ITEMS() + ' WHERE set_id = $1 AND question_id = $2',
    [row.id, q.rows[0].id]
  );
  await withTransaction(async (client) => {
    const here = await client.query(
      'SELECT question_id FROM ' + ITEMS() + ' WHERE set_id = $1 AND module_key = $2 AND position = $3',
      [row.id, moduleKey, pos]
    );
    const other = dup.rows[0];
    if (other && !(other.module_key === moduleKey && other.position === pos)) {
      // Putting a question that is already in the set somewhere else swaps the two.
      if (here.rows[0]) {
        await client.query(
          'UPDATE ' + ITEMS() + ' SET question_id = $4 WHERE set_id = $1 AND module_key = $2 AND position = $3',
          [row.id, other.module_key, other.position, here.rows[0].question_id]
        );
      } else {
        await client.query(
          'DELETE FROM ' + ITEMS() + ' WHERE set_id = $1 AND module_key = $2 AND position = $3',
          [row.id, other.module_key, other.position]
        );
      }
    }
    await client.query(
      'INSERT INTO ' + ITEMS() + ' (set_id, module_key, position, question_id) VALUES ($1,$2,$3,$4)' +
        ' ON CONFLICT (set_id, module_key, position) DO UPDATE SET question_id = EXCLUDED.question_id',
      [row.id, moduleKey, pos, q.rows[0].id]
    );
    await client.query('UPDATE ' + SETS() + ' SET updated_at = now() WHERE id = $1', [row.id]);
  });
  return getSet(setId);
}

async function removeItem(setId, moduleKey, position) {
  requireDb();
  const row = await loadSetRow(setId);
  await assertEditable(row);
  await query(
    'DELETE FROM ' + ITEMS() + ' WHERE set_id = $1 AND module_key = $2 AND position = $3',
    [row.id, String(moduleKey || ''), Number(position)]
  );
  return getSet(setId);
}

async function candidates(setId, moduleKey, filters) {
  requireDb();
  const f = filters || {};
  const section = String(moduleKey || '').indexOf('rw') === 0 ? 'rw' : 'math';
  const params = [section, String(setId || '')];
  let sql = 'SELECT q.*, (SELECT module_key FROM ' + ITEMS() + ' i WHERE i.set_id = $2 AND i.question_id = q.id LIMIT 1) AS in_module,' +
    ' (SELECT count(*) FROM ' + ITEMS() + ' i2 JOIN ' + SETS() + " s2 ON s2.id = i2.set_id WHERE i2.question_id = q.id AND s2.archived_at IS NULL AND s2.id <> $2) AS other_sets" +
    ' FROM ' + Q() + " q WHERE q.status = 'approved' AND q.section = $1";
  if (f.domain) {
    params.push(String(f.domain));
    sql += ' AND q.domain = $' + params.length;
  }
  if (f.difficulty && taxonomy.DIFFICULTIES.indexOf(f.difficulty) >= 0) {
    params.push(f.difficulty);
    sql += ' AND q.difficulty = $' + params.length;
  }
  if (f.search) {
    params.push('%' + String(f.search).replace(/[%_\\]/g, '\\$&').slice(0, 80) + '%');
    sql += ' AND (q.source_id ILIKE $' + params.length + ' OR q.stem ILIKE $' + params.length + ' OR q.passage ILIKE $' + params.length + ')';
  }
  sql += ' ORDER BY q.domain, q.difficulty, q.source_id LIMIT 80';
  const r = await query(sql, params);
  return r.rows.map((row) => Object.assign(questionBrief(row), {
    inModule: row.in_module || '',
    otherSets: Number(row.other_sets)
  }));
}

// ------------------------------------------------------------- assignments

function publicAssignment(row) {
  return {
    id: row.id,
    setId: row.set_id,
    setName: row.set_name,
    targetType: row.target_type,
    classId: row.class_id,
    className: row.class_name,
    studentId: row.student_id,
    studentName: row.student_name,
    availableFrom: row.available_from,
    dueAt: row.due_at,
    createdAt: row.created_at,
    started: row.started == null ? undefined : Number(row.started),
    completed: row.completed == null ? undefined : Number(row.completed)
  };
}

async function createAssignments(setId, input, user) {
  requireDb();
  const row = await loadSetRow(setId);
  if (row.archived_at || row.status !== 'published') throw httpError(409, '배포된 세트만 학생에게 부여할 수 있습니다.');
  const classId = String((input && input.classId) || '').trim();
  if (!classId) throw httpError(400, '반을 선택해 주세요.');
  const className = String((input && input.className) || classId).slice(0, 120);
  const from = input && input.availableFrom ? new Date(input.availableFrom) : new Date();
  const due = input && input.dueAt ? new Date(input.dueAt) : null;
  if (isNaN(from.getTime())) throw httpError(400, '시작 시각이 올바르지 않습니다.');
  if (due && isNaN(due.getTime())) throw httpError(400, '마감 시각이 올바르지 않습니다.');
  if (due && due <= from) throw httpError(400, '마감은 시작보다 뒤여야 합니다.');
  const students = Array.isArray(input && input.students) ? input.students : [];

  const ids = [];
  await withTransaction(async (client) => {
    if (!students.length) {
      const id = newId('sa');
      ids.push(id);
      await client.query(
        'INSERT INTO ' + ASSIGN() + ' (id, set_id, target_type, class_id, class_name, available_from, due_at, created_by)' +
          " VALUES ($1,$2,'class',$3,$4,$5,$6,$7)",
        [id, row.id, classId, className, from, due, user]
      );
    } else {
      for (const s of students) {
        const id = newId('sa');
        ids.push(id);
        await client.query(
          'INSERT INTO ' + ASSIGN() + ' (id, set_id, target_type, class_id, class_name, student_id, student_name, available_from, due_at, created_by)' +
            " VALUES ($1,$2,'student',$3,$4,$5,$6,$7,$8,$9)",
          [id, row.id, classId, className, String(s.studentId), String(s.name || ''), from, due, user]
        );
      }
    }
  });
  return { ids: ids };
}

async function listAssignments(setId) {
  requireDb();
  const params = [];
  let where = 'a.removed_at IS NULL';
  if (setId) {
    params.push(String(setId));
    where += ' AND a.set_id = $1';
  }
  const r = await query(
    'SELECT a.*, s.name AS set_name,' +
      ' (SELECT count(*) FROM ' + SESS() + ' x WHERE x.assignment_id = a.id) AS started,' +
      " (SELECT count(*) FROM " + SESS() + " x WHERE x.assignment_id = a.id AND x.step = 'done') AS completed" +
      ' FROM ' + ASSIGN() + ' a JOIN ' + SETS() + ' s ON s.id = a.set_id WHERE ' + where +
      ' ORDER BY a.created_at DESC LIMIT 200',
    params
  );
  return r.rows.map(publicAssignment);
}

async function removeAssignment(id) {
  requireDb();
  const r = await query('UPDATE ' + ASSIGN() + ' SET removed_at = now() WHERE id = $1 AND removed_at IS NULL', [String(id || '')]);
  if (!r.rowCount) throw httpError(404, '부여 내역을 찾을 수 없습니다.');
  return { ok: true };
}

async function assignmentRow(id) {
  const r = await query(
    'SELECT a.*, s.name AS set_name FROM ' + ASSIGN() + ' a JOIN ' + SETS() + ' s ON s.id = a.set_id WHERE a.id = $1',
    [String(id || '')]
  );
  if (!r.rows[0]) throw httpError(404, '부여 내역을 찾을 수 없습니다.');
  return r.rows[0];
}

function sessionBrief(s) {
  const result = s.result || null;
  return {
    sessionId: s.id,
    step: s.step,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    total: result ? result.total : null,
    rw: result && result.rw ? result.rw.scaled : null,
    math: result && result.math ? result.math.scaled : null
  };
}

/** Per-student status of one assignment. roster is the class list for a whole-class assignment. */
async function assignmentDetail(id, roster) {
  requireDb();
  const a = await assignmentRow(id);
  const sess = await query('SELECT * FROM ' + SESS() + ' WHERE assignment_id = $1', [a.id]);
  const byStudent = new Map(sess.rows.map((s) => [s.student_id, s]));
  let people;
  if (a.target_type === 'student') people = [{ studentId: a.student_id, name: a.student_name }];
  else people = (roster || []).map((s) => ({ studentId: s.studentId, name: s.name }));
  const rows = people.map((p) => {
    const s = byStudent.get(p.studentId);
    return Object.assign({
      studentId: p.studentId,
      name: p.name,
      status: !s ? 'not_started' : s.step === 'done' ? 'completed' : 'in_progress'
    }, s ? sessionBrief(s) : {});
  });
  return { assignment: publicAssignment(a), students: rows };
}

/** How many questions of the set each student has already seen in an earlier test. */
async function overlap(setId, studentIds) {
  requireDb();
  const ids = (studentIds || []).map(String).filter(Boolean).slice(0, 400);
  if (!ids.length) return [];
  const r = await query(
    'SELECT s.student_id, count(DISTINCT a.question_id)::int AS seen FROM ' + SESS() + ' s' +
      ' JOIN ' + ANS() + ' a ON a.session_id = s.id' +
      ' JOIN ' + ITEMS() + ' i ON i.question_id = a.question_id AND i.set_id = $1' +
      ' WHERE s.student_id = ANY($2::text[]) AND NOT s.is_preview AND s.set_id <> $1' +
      ' GROUP BY s.student_id',
    [String(setId), ids]
  );
  return r.rows.map((x) => ({ studentId: x.student_id, seen: x.seen }));
}

// ---------------------------------------------------------------- sessions

async function loadSession(id, client) {
  const run = client ? client.query.bind(client) : query;
  const r = await run('SELECT * FROM ' + SESS() + ' WHERE id = $1' + (client ? ' FOR UPDATE' : ''), [String(id || '')]);
  if (!r.rows[0]) throw httpError(404, '응시 기록을 찾을 수 없습니다.');
  return r.rows[0];
}

function previewStudentId(userKey) {
  return 'preview:' + userKey;
}

function assertSessionAccess(session, user) {
  if (user.role === 'student') {
    if (session.is_preview || session.student_id !== String(user.studentId)) throw httpError(403, '내 응시 기록이 아닙니다.');
    return;
  }
  if (!session.is_preview || session.student_id !== previewStudentId(user.key)) {
    throw httpError(403, '미리보기를 시작한 선생님만 이 응시를 이어갈 수 있습니다.');
  }
}

async function startAssignment(assignmentId, user) {
  requireDb();
  const a = await assignmentRow(assignmentId);
  const setRow = await loadSetRow(a.set_id);
  const mine = a.removed_at == null && setRow.status === 'published' && !setRow.archived_at &&
    ((a.target_type === 'class' && a.class_id === String(user.classId)) ||
      (a.target_type === 'student' && a.student_id === String(user.studentId)));
  if (!mine) throw httpError(404, '부여된 시험을 찾을 수 없습니다.');
  const existing = await query(
    'SELECT id FROM ' + SESS() + ' WHERE assignment_id = $1 AND student_id = $2',
    [a.id, String(user.studentId)]
  );
  if (existing.rows[0]) return { sessionId: existing.rows[0].id };
  if (new Date(a.available_from) > new Date()) throw httpError(403, '아직 시작할 수 없는 시험입니다.');
  if (a.due_at && new Date(a.due_at) < new Date()) throw httpError(403, '마감이 지난 시험입니다. 선생님께 말씀해 주세요.');
  const id = newId('sx');
  await query(
    'INSERT INTO ' + SESS() + ' (id, set_id, assignment_id, student_id, student_name, class_id, step)' +
      " VALUES ($1,$2,$3,$4,$5,$6,'rw1') ON CONFLICT DO NOTHING",
    [id, a.set_id, a.id, String(user.studentId), String(user.name || ''), String(user.classId || '')]
  );
  const again = await query(
    'SELECT id FROM ' + SESS() + ' WHERE assignment_id = $1 AND student_id = $2',
    [a.id, String(user.studentId)]
  );
  return { sessionId: again.rows[0].id };
}

async function startPreview(setId, user, fresh) {
  requireDb();
  const row = await loadSetRow(setId);
  if (row.archived_at) throw httpError(409, '보관된 세트입니다.');
  const items = await loadItems(row.id);
  const problems = setProblems(publicSet(row), items);
  if (problems.length) throw httpError(409, '세트가 아직 덜 채워져 미리보기를 할 수 없습니다. ' + problems.slice(0, 2).join(' '));
  const pid = previewStudentId(user.key);
  if (!fresh) {
    const open = await query(
      'SELECT id FROM ' + SESS() + " WHERE set_id = $1 AND student_id = $2 AND is_preview AND step <> 'done' ORDER BY started_at DESC LIMIT 1",
      [row.id, pid]
    );
    if (open.rows[0]) return { sessionId: open.rows[0].id };
  }
  const id = newId('sx');
  await query(
    'INSERT INTO ' + SESS() + ' (id, set_id, student_id, student_name, is_preview, step) VALUES ($1,$2,$3,$4,true,$5)',
    [id, row.id, pid, String(user.name || '선생님'), 'rw1']
  );
  return { sessionId: id };
}

async function moduleQuestionRows(setId, key) {
  const r = await query(
    'SELECT i.position, q.* FROM ' + ITEMS() + ' i JOIN ' + Q() + ' q ON q.id = i.question_id' +
      ' WHERE i.set_id = $1 AND i.module_key = $2 ORDER BY i.position',
    [setId, key]
  );
  return r.rows;
}

function routesOf(session) {
  return { rw: session.route_rw, math: session.route_math };
}

async function setStructure(setId) {
  const row = await loadSetRow(setId);
  return logic.normalizeStructure(row.structure);
}

async function gradeModule(client, session, key) {
  const rows = await client.query(
    'SELECT a.question_id, a.answer, a.time_ms, q.qtype, q.answer AS correct, q.accepted_answers' +
      ' FROM ' + ANS() + ' a JOIN ' + Q() + ' q ON q.id = a.question_id' +
      ' WHERE a.session_id = $1 AND a.module_key = $2',
    [session.id, key]
  );
  let correct = 0;
  let timeMs = 0;
  for (const r of rows.rows) {
    const ok = logic.gradeAnswer({ qtype: r.qtype, answer: r.correct, accepted_answers: r.accepted_answers }, r.answer);
    if (ok) correct++;
    timeMs += r.time_ms;
    await client.query(
      'UPDATE ' + ANS() + ' SET is_correct = $3 WHERE session_id = $1 AND question_id = $2',
      [session.id, r.question_id, ok]
    );
  }
  return { key: key, correct: correct, total: rows.rows.length, timeMs: timeMs };
}

async function loadScoreOverride(section, route) {
  try {
    const r = await query('SELECT points FROM ' + SCORES() + ' WHERE section = $1 AND route = $2', [section, route]);
    return r.rows[0] ? r.rows[0].points : null;
  } catch (e) {
    return null;
  }
}

async function buildResult(client, session) {
  const structure = await setStructure(session.set_id);
  const mr = session.module_results || {};
  const result = { estimated: true, rw: null, math: null, total: null, domains: [], difficulties: [], timeMs: 0 };
  for (const sec of ['rw', 'math']) {
    const steps = sec === 'rw' ? ['rw1', 'rw2'] : ['m1', 'm2'];
    if (!mr[steps[0]] || !mr[steps[1]]) continue;
    const correct = mr[steps[0]].correct + mr[steps[1]].correct;
    const total = mr[steps[0]].total + mr[steps[1]].total;
    const route = sec === 'rw' ? session.route_rw : session.route_math;
    const full = structure.modules[steps[0]].count + structure.modules[steps[1]].count === (sec === 'rw' ? 54 : 44);
    const override = full ? await loadScoreOverride(sec, route) : null;
    const scaled = logic.scoreFromTable(override, correct) || logic.estimateSectionScore(route, correct, total);
    result[sec] = {
      route: route,
      correct: correct,
      total: total,
      scaled: scaled,
      modules: [mr[steps[0]], mr[steps[1]]]
    };
  }
  if (result.rw && result.math) result.total = result.rw.scaled + result.math.scaled;
  const detail = await client.query(
    'SELECT q.section, q.domain, q.difficulty, a.is_correct, a.time_ms FROM ' + ANS() + ' a' +
      ' JOIN ' + Q() + ' q ON q.id = a.question_id WHERE a.session_id = $1',
    [session.id]
  );
  const dom = new Map();
  const dif = new Map();
  detail.rows.forEach((r) => {
    result.timeMs += r.time_ms;
    const dk = r.section + '|' + r.domain;
    const d = dom.get(dk) || { section: r.section, domain: r.domain, correct: 0, total: 0 };
    d.total++;
    if (r.is_correct) d.correct++;
    dom.set(dk, d);
    const fk = r.section + '|' + r.difficulty;
    const f = dif.get(fk) || { section: r.section, difficulty: r.difficulty, correct: 0, total: 0 };
    f.total++;
    if (r.is_correct) f.correct++;
    dif.set(fk, f);
  });
  result.domains = Array.from(dom.values());
  result.difficulties = Array.from(dif.values());
  return result;
}

/** Close the module that is running: grade it, decide the route, and move to the next step. */
async function closeStep(client, session) {
  const step = session.step;
  const upd = { step: logic.nextStep(step), started: null, deadline: null };
  let moduleResults = session.module_results || {};
  let routeRw = session.route_rw;
  let routeMath = session.route_math;

  if (logic.MODULE_STEPS.indexOf(step) >= 0) {
    const key = logic.moduleKeyFor(step, routesOf(session));
    const res = await gradeModule(client, session, key);
    moduleResults = Object.assign({}, moduleResults, { [step]: res });
    if (step === 'rw1') routeRw = logic.routeFor(res.correct, res.total);
    if (step === 'm1') routeMath = logic.routeFor(res.correct, res.total);
  }

  const next = Object.assign({}, session, {
    step: upd.step,
    module_results: moduleResults,
    route_rw: routeRw,
    route_math: routeMath
  });
  let result = null;
  let completedAt = null;
  if (upd.step === 'done') {
    result = await buildResult(client, next);
    completedAt = new Date();
  }
  await client.query(
    'UPDATE ' + SESS() + ' SET step = $2, step_started_at = NULL, step_deadline = NULL, module_results = $3,' +
      ' route_rw = $4, route_math = $5, result = $6, completed_at = $7, updated_at = now() WHERE id = $1',
    [session.id, upd.step, JSON.stringify(moduleResults), routeRw, routeMath, result ? JSON.stringify(result) : null, completedAt]
  );
  return Object.assign(next, { step_started_at: null, step_deadline: null, result: result, completed_at: completedAt });
}

/** A module whose clock ran out, or a break that ended, is closed by the server on the next visit. */
async function settle(sessionId) {
  return withTransaction(async (client) => {
    let s = await loadSession(sessionId, client);
    for (let guard = 0; guard < 6; guard++) {
      if (s.step === 'done' || !s.step_deadline) break;
      if (new Date(s.step_deadline).getTime() > Date.now()) break;
      s = await closeStep(client, s);
    }
    return s;
  });
}

function stepInfo(structure, step) {
  if (step === 'break') {
    return { step: step, kind: 'break', title: 'Break', minutes: structure.breakMinutes, count: 0 };
  }
  const m = structure.modules[step];
  const label = MODULE_LABEL[step];
  return {
    step: step,
    kind: 'module',
    title: moduleTitle(step),
    section: logic.sectionOfStep(step),
    sectionName: label.name,
    sectionLabel: label.section,
    moduleNumber: label.number,
    count: m.count,
    minutes: m.minutes
  };
}

async function deliverModule(client, session, structure) {
  const key = logic.moduleKeyFor(session.step, routesOf(session));
  const rows = await moduleQuestionRows(session.set_id, key);
  if (!rows.length) throw httpError(409, '이 모듈에 문항이 없습니다. 선생님께 말씀해 주세요.');
  for (const r of rows) {
    await client.query(
      'INSERT INTO ' + ANS() + ' (session_id, question_id, module_key, position) VALUES ($1,$2,$3,$4)' +
        ' ON CONFLICT (session_id, question_id) DO NOTHING',
      [session.id, r.id, key, r.position]
    );
  }
  return key;
}

/** The student pressed Start on a module, or Resume on the break. */
async function startStep(sessionId, user, expectStep) {
  requireDb();
  const probe = await loadSession(sessionId);
  assertSessionAccess(probe, user);
  await settle(sessionId);
  await withTransaction(async (client) => {
    const s = await loadSession(sessionId, client);
    if (s.step === 'done') return;
    if (expectStep && s.step !== expectStep) return;
    const structure = await setStructure(s.set_id);
    if (s.step === 'break') {
      if (s.step_started_at) {
        await closeStep(client, s);
      } else {
        await client.query(
          'UPDATE ' + SESS() + ' SET step_started_at = now(), step_deadline = $2, updated_at = now() WHERE id = $1',
          [s.id, new Date(Date.now() + structure.breakMinutes * 60000)]
        );
      }
      return;
    }
    if (s.step_started_at) return;
    await deliverModule(client, s, structure);
    const minutes = structure.modules[s.step].minutes;
    await client.query(
      'UPDATE ' + SESS() + ' SET step_started_at = now(), step_deadline = $2, updated_at = now() WHERE id = $1',
      [s.id, new Date(Date.now() + minutes * 60000)]
    );
  });
  return getSessionState(sessionId, user);
}

function cleanAnswerFor(qtype, value) {
  const raw = String(value == null ? '' : value);
  if (qtype === 'mcq') {
    const m = raw.trim().toUpperCase();
    return /^[A-D]$/.test(m) ? m : '';
  }
  return logic.cleanSprInput(raw);
}

async function applyItems(client, session, items) {
  const key = logic.moduleKeyFor(session.step, routesOf(session));
  const list = Array.isArray(items) ? items.slice(0, 80) : [];
  for (const it of list) {
    const qid = String((it && it.questionId) || '');
    if (!qid) continue;
    const cur = await client.query(
      'SELECT a.answer, a.marked, a.eliminated, q.qtype FROM ' + ANS() + ' a JOIN ' + Q() + ' q ON q.id = a.question_id' +
        ' WHERE a.session_id = $1 AND a.question_id = $2 AND a.module_key = $3',
      [session.id, qid, key]
    );
    if (!cur.rows[0]) continue;
    const row = cur.rows[0];
    const answer = it.answer !== undefined ? cleanAnswerFor(row.qtype, it.answer) : row.answer;
    const marked = it.marked !== undefined ? !!it.marked : row.marked;
    const elim = it.eliminated !== undefined
      ? Array.from(new Set((Array.isArray(it.eliminated) ? it.eliminated : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-D]$/.test(x))))
      : row.eliminated;
    const spent = Math.max(0, Math.min(10 * 60 * 1000, Math.round(Number(it.spentMs) || 0)));
    await client.query(
      'UPDATE ' + ANS() + ' SET answer = $3, marked = $4, eliminated = $5, time_ms = time_ms + $6, updated_at = now()' +
        ' WHERE session_id = $1 AND question_id = $2',
      [session.id, qid, answer, marked, JSON.stringify(elim), spent]
    );
  }
}

async function saveAnswers(sessionId, user, items) {
  requireDb();
  const probe = await loadSession(sessionId);
  assertSessionAccess(probe, user);
  return withTransaction(async (client) => {
    const s = await loadSession(sessionId, client);
    const live = logic.MODULE_STEPS.indexOf(s.step) >= 0 && s.step_started_at && s.step_deadline;
    if (!live) throw httpError(409, '지금 진행 중인 모듈이 없습니다.');
    if (Date.now() > new Date(s.step_deadline).getTime() + GRACE_MS) throw httpError(409, '이 모듈의 시간이 끝났습니다.');
    await applyItems(client, s, items);
    return { ok: true, serverNow: Date.now(), deadline: new Date(s.step_deadline).getTime() };
  });
}

async function submitModule(sessionId, user, items, expectStep) {
  requireDb();
  const probe = await loadSession(sessionId);
  assertSessionAccess(probe, user);
  await withTransaction(async (client) => {
    const s = await loadSession(sessionId, client);
    const live = logic.MODULE_STEPS.indexOf(s.step) >= 0 && s.step_started_at && s.step_deadline;
    if (!live) return;
    if (expectStep && s.step !== expectStep) return;
    if (items && Date.now() <= new Date(s.step_deadline).getTime() + GRACE_MS) {
      await applyItems(client, s, items);
    }
    await closeStep(client, s);
  });
  return getSessionState(sessionId, user);
}

function studentQuestion(row, assets) {
  const choices = Array.isArray(row.choices) ? row.choices : [];
  return {
    id: row.id,
    position: row.position,
    qtype: row.qtype,
    passage: row.passage || '',
    stem: row.stem || '',
    choices: choices.map((c) => ({ label: c.label, text: c.text })),
    assets: assets || {}
  };
}

async function getSessionState(sessionId, user) {
  requireDb();
  const probe = await loadSession(sessionId);
  assertSessionAccess(probe, user);
  const s = await settle(sessionId);
  const set = await loadSetRow(s.set_id);
  const structure = logic.normalizeStructure(set.structure);
  const state = {
    session: {
      id: s.id,
      setName: set.name,
      studentName: s.student_name,
      isPreview: s.is_preview,
      step: s.step,
      started: !!s.step_started_at,
      stepDeadline: s.step_deadline ? new Date(s.step_deadline).getTime() : null,
      serverNow: Date.now(),
      dueAt: null
    },
    info: s.step === 'done' ? null : stepInfo(structure, s.step),
    overview: logic.STEPS.map((st) => stepInfo(structure, st)),
    module: null,
    answers: {},
    result: null,
    config: {
      desmosKey: process.env.DESMOS_API_KEY || '1908e1fbec2148d28cd7a298c66877aa'
    }
  };
  if (s.assignment_id) {
    const a = await query('SELECT due_at FROM ' + ASSIGN() + ' WHERE id = $1', [s.assignment_id]);
    if (a.rows[0] && a.rows[0].due_at) state.session.dueAt = new Date(a.rows[0].due_at).getTime();
  }

  const upcoming = logic.nextStep(s.step);
  if (upcoming !== 'done' && s.step === 'break') state.next = stepInfo(structure, upcoming);

  if (logic.MODULE_STEPS.indexOf(s.step) >= 0 && s.step_started_at) {
    const key = logic.moduleKeyFor(s.step, routesOf(s));
    const rows = await moduleQuestionRows(s.set_id, key);
    const ids = rows.map((r) => r.id);
    const ast = await query('SELECT id, question_id, ref FROM ' + ASSETS() + ' WHERE question_id = ANY($1::text[])', [ids]);
    const byQ = new Map();
    ast.rows.forEach((a) => {
      if (!byQ.has(a.question_id)) byQ.set(a.question_id, {});
      byQ.get(a.question_id)[a.ref] = a.id;
    });
    state.module = {
      key: key,
      step: s.step,
      title: moduleTitle(s.step),
      section: logic.sectionOfStep(s.step),
      questions: rows.map((r) => studentQuestion(r, byQ.get(r.id)))
    };
    const saved = await query(
      'SELECT question_id, answer, marked, eliminated FROM ' + ANS() + ' WHERE session_id = $1 AND module_key = $2',
      [s.id, key]
    );
    saved.rows.forEach((a) => {
      state.answers[a.question_id] = { answer: a.answer, marked: a.marked, eliminated: a.eliminated || [] };
    });
  }
  if (s.step === 'done') {
    state.result = await resultView(s);
  }
  return state;
}

async function resultView(s) {
  const detail = await query(
    'SELECT a.module_key, a.position, a.is_correct, a.marked, a.time_ms, a.answer, q.id AS question_id, q.source_id,' +
      ' q.section, q.domain, q.skill, q.difficulty, q.qtype' +
      ' FROM ' + ANS() + ' a JOIN ' + Q() + ' q ON q.id = a.question_id WHERE a.session_id = $1' +
      ' ORDER BY a.module_key, a.position',
    [s.id]
  );
  const order = { rw1: 1, rw2e: 2, rw2h: 2, m1: 3, m2e: 4, m2h: 4 };
  const stepOf = { rw1: 'rw1', rw2e: 'rw2', rw2h: 'rw2', m1: 'm1', m2e: 'm2', m2h: 'm2' };
  const questions = detail.rows
    .sort((x, y) => (order[x.module_key] - order[y.module_key]) || (x.position - y.position))
    .map((r) => ({
      step: stepOf[r.module_key],
      moduleTitle: moduleTitle(stepOf[r.module_key]),
      position: r.position,
      questionId: r.question_id,
      sourceId: r.source_id,
      section: r.section,
      domain: r.domain,
      skill: r.skill,
      difficulty: r.difficulty,
      qtype: r.qtype,
      correct: !!r.is_correct,
      answered: !!r.answer,
      marked: r.marked,
      timeMs: r.time_ms
    }));
  return {
    summary: s.result,
    routes: { rw: s.route_rw, math: s.route_math },
    questions: questions,
    completedAt: s.completed_at
  };
}

/** For teachers: the same result a student sees. */
async function sessionResult(sessionId) {
  requireDb();
  const s = await settle(sessionId);
  const set = await loadSetRow(s.set_id);
  return {
    session: {
      id: s.id,
      setName: set.name,
      studentId: s.student_id,
      studentName: s.student_name,
      isPreview: s.is_preview,
      step: s.step
    },
    result: s.step === 'done' ? await resultView(s) : null
  };
}

async function myAssignments(user) {
  requireDb();
  const r = await query(
    'SELECT a.*, s.name AS set_name, s.structure, x.id AS session_id, x.step, x.step_deadline, x.result, x.completed_at' +
      ' FROM ' + ASSIGN() + ' a JOIN ' + SETS() + ' s ON s.id = a.set_id' +
      ' LEFT JOIN ' + SESS() + ' x ON x.assignment_id = a.id AND x.student_id = $2' +
      " WHERE a.removed_at IS NULL AND s.status = 'published' AND s.archived_at IS NULL AND a.available_from <= now()" +
      " AND ((a.target_type = 'class' AND a.class_id = $1 AND $1 <> '') OR (a.target_type = 'student' AND a.student_id = $2))" +
      ' ORDER BY a.created_at DESC LIMIT 50',
    [String(user.classId || ''), String(user.studentId)]
  );
  const now = Date.now();
  return r.rows.map((row) => {
    const structure = logic.normalizeStructure(row.structure);
    let total = 0;
    let minutes = 0;
    logic.MODULE_STEPS.forEach((st) => {
      total += structure.modules[st].count;
      minutes += structure.modules[st].minutes;
    });
    const status = !row.session_id ? 'not_started' : row.step === 'done' ? 'completed' : 'in_progress';
    const due = row.due_at ? new Date(row.due_at).getTime() : null;
    return {
      id: row.id,
      setName: row.set_name,
      questions: total,
      minutes: minutes,
      dueAt: due,
      overdue: status !== 'completed' && due != null && due < now,
      status: status,
      sessionId: row.session_id || '',
      total: row.result ? row.result.total : null
    };
  });
}

async function getScoreTables() {
  requireDb();
  const r = await query('SELECT section, route, points, updated_at FROM ' + SCORES());
  return r.rows;
}

async function putScoreTable(section, route, points, user) {
  requireDb();
  if (['rw', 'math'].indexOf(section) < 0 || ['easy', 'hard'].indexOf(route) < 0) throw httpError(400, '영역이나 경로가 올바르지 않습니다.');
  const total = section === 'rw' ? 54 : 44;
  if (!Array.isArray(points) || points.length !== total + 1) throw httpError(400, '점수 ' + (total + 1) + '개(0개~' + total + '개 맞힘)가 필요합니다.');
  const clean = points.map((p) => {
    const n = Math.round(Number(p));
    if (!(n >= 200 && n <= 800)) throw httpError(400, '점수는 200~800 사이여야 합니다.');
    return n;
  });
  await query(
    'INSERT INTO ' + SCORES() + ' (section, route, points, updated_by) VALUES ($1,$2,$3,$4)' +
      ' ON CONFLICT (section, route) DO UPDATE SET points = EXCLUDED.points, updated_by = EXCLUDED.updated_by, updated_at = now()',
    [section, route, JSON.stringify(clean), user]
  );
  return { ok: true };
}

async function assetForSession(sessionId, assetId, user) {
  requireDb();
  const s = await loadSession(sessionId);
  assertSessionAccess(s, user);
  const r = await query(
    'SELECT a.mime, a.data FROM ' + ASSETS() + ' a' +
      ' WHERE a.id = $1 AND EXISTS (SELECT 1 FROM ' + ANS() + ' x WHERE x.session_id = $2 AND x.question_id = a.question_id)',
    [String(assetId || ''), s.id]
  );
  if (!r.rows[0]) throw httpError(404, '그림을 찾을 수 없습니다.');
  return { mime: r.rows[0].mime, data: r.rows[0].data };
}

module.exports = {
  listSets,
  getSet,
  poolSummary,
  createSet,
  composeSet,
  updateSet,
  publishSet,
  unpublishSet,
  deleteSet,
  duplicateSet,
  replaceItem,
  removeItem,
  candidates,
  createAssignments,
  listAssignments,
  removeAssignment,
  assignmentDetail,
  overlap,
  startAssignment,
  startPreview,
  startStep,
  saveAnswers,
  submitModule,
  getSessionState,
  sessionResult,
  myAssignments,
  getScoreTables,
  putScoreTable,
  assetForSession,
  GRACE_MS
};
