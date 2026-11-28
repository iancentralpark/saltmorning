'use strict';

/** Teacher statistics over finished SAT mock tests: scores, hard questions, weak skills, time, review progress. */

const { query, table, isOpsDbEnabled } = require('../../db/pool');

const SESS = () => table('sat_sessions');
const ANS = () => table('sat_answers');
const Q = () => table('sat_questions');
const SETS = () => table('sat_test_sets');
const ASSIGN = () => table('sat_assignments');
const NOTES = () => table('sat_review_notes');

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function requireDb() {
  if (!isOpsDbEnabled()) throw httpError(503, '데이터베이스가 연결되지 않아 통계를 볼 수 없습니다.');
}

function snippet(text) {
  return String(text || '')
    .replace(/\\[()[\]]/g, '')
    .replace(/\[\[fig[0-9a-z_-]*\]\]/gi, '[그림]')
    .replace(/<\/?[a-z][a-z0-9]*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function scope(filter) {
  const f = filter || {};
  const where = ['NOT s.is_preview'];
  const params = [];
  if (f.setId) { params.push(String(f.setId)); where.push('s.set_id = $' + params.length); }
  if (f.classId) { params.push(String(f.classId)); where.push('s.class_id = $' + params.length); }
  if (f.studentId) { params.push(String(f.studentId)); where.push('s.student_id = $' + params.length); }
  if (Array.isArray(f.classIds)) { params.push(f.classIds.map(String)); where.push('s.class_id = ANY($' + params.length + '::text[])'); }
  return { sql: where.join(' AND '), params: params };
}

function mean(list) {
  return list.length ? Math.round(list.reduce((t, x) => t + x, 0) / list.length) : null;
}

function median(list) {
  if (!list.length) return null;
  const s = list.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function scoresOf(rows) {
  const done = rows.filter((r) => r.step === 'done' && r.result && r.result.total != null);
  return {
    total: done.map((r) => r.result.total),
    rw: done.filter((r) => r.result.rw).map((r) => r.result.rw.scaled),
    math: done.filter((r) => r.result.math).map((r) => r.result.math.scaled)
  };
}

function distribution(totals) {
  const bins = [];
  for (let lo = 400; lo < 1600; lo += 100) bins.push({ from: lo, to: lo + 99, n: 0 });
  bins[bins.length - 1].to = 1600;
  totals.forEach((t) => {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor((t - 400) / 100)));
    bins[i].n++;
  });
  return bins;
}

async function skillRows(sc) {
  const r = await query(
    'SELECT q.id, q.source_id, q.section, q.domain, q.skill, q.difficulty, q.qtype, q.answer, q.stem, q.passage,' +
      ' count(*)::int AS attempts,' +
      ' count(*) FILTER (WHERE NOT COALESCE(a.is_correct, false))::int AS wrong,' +
      " count(*) FILTER (WHERE a.answer = '')::int AS blank," +
      ' COALESCE(round(avg(a.time_ms)), 0)::int AS avg_ms' +
      ' FROM ' + ANS() + ' a JOIN ' + SESS() + ' s ON s.id = a.session_id JOIN ' + Q() + ' q ON q.id = a.question_id' +
      " WHERE s.step = 'done' AND " + sc.sql + ' GROUP BY q.id',
    sc.params
  );
  return r.rows;
}

async function topWrongAnswers(sc) {
  const r = await query(
    'SELECT a.question_id, a.answer, count(*)::int AS n FROM ' + ANS() + ' a JOIN ' + SESS() + ' s ON s.id = a.session_id' +
      " WHERE s.step = 'done' AND a.answer <> '' AND NOT COALESCE(a.is_correct, false) AND " + sc.sql + ' GROUP BY a.question_id, a.answer',
    sc.params
  );
  const best = new Map();
  r.rows.forEach((x) => {
    const cur = best.get(x.question_id);
    if (!cur || x.n > cur.n) best.set(x.question_id, x);
  });
  return best;
}

function groupSkills(rows) {
  const map = new Map();
  rows.forEach((q) => {
    const k = q.section + '|' + q.domain + '|' + q.skill;
    const g = map.get(k) || { section: q.section, domain: q.domain, skill: q.skill, attempts: 0, wrong: 0, timeMs: 0 };
    g.attempts += q.attempts;
    g.wrong += q.wrong;
    g.timeMs += q.avg_ms * q.attempts;
    map.set(k, g);
  });
  return Array.from(map.values()).map((g) => ({
    section: g.section,
    domain: g.domain,
    skill: g.skill,
    attempts: g.attempts,
    wrong: g.wrong,
    correctRate: g.attempts ? Math.round((1 - g.wrong / g.attempts) * 100) : null,
    avgSec: g.attempts ? Math.round(g.timeMs / g.attempts / 1000) : 0
  })).sort((a, b) => (a.correctRate - b.correctRate) || (b.attempts - a.attempts));
}

async function overview(filter) {
  requireDb();
  const sc = scope(filter);
  const sessions = await query(
    'SELECT s.id, s.student_id, s.student_name, s.class_id, s.set_id, s.step, s.result, s.route_rw, s.route_math,' +
      ' s.started_at, s.completed_at, st.name AS set_name, a.class_name' +
      ' FROM ' + SESS() + ' s JOIN ' + SETS() + ' st ON st.id = s.set_id LEFT JOIN ' + ASSIGN() + ' a ON a.id = s.assignment_id' +
      ' WHERE ' + sc.sql + ' ORDER BY s.started_at DESC LIMIT 2000',
    sc.params
  );
  const rows = sessions.rows;
  const doneRows = rows.filter((r) => r.step === 'done');
  const scores = scoresOf(rows);

  const reviewBySession = new Map();
  if (rows.length) {
    const rv = await query(
      'SELECT session_id, count(*)::int AS total, count(*) FILTER (WHERE stage = \'done\')::int AS done FROM ' + NOTES() +
        ' WHERE session_id = ANY($1::text[]) GROUP BY session_id',
      [rows.map((r) => r.id)]
    );
    rv.rows.forEach((x) => reviewBySession.set(x.session_id, x));
  }
  let reviewTotal = 0;
  let reviewDone = 0;
  reviewBySession.forEach((x) => { reviewTotal += x.total; reviewDone += x.done; });

  const qrows = await skillRows(sc);
  const wrongBest = await topWrongAnswers(sc);
  const enough = qrows.filter((q) => q.attempts >= 2);
  const pool = enough.length >= 5 ? enough : qrows;
  const hardest = pool.slice().sort((a, b) => (b.wrong / b.attempts) - (a.wrong / a.attempts) || b.attempts - a.attempts).slice(0, 25).map((q) => {
    const top = wrongBest.get(q.id);
    return {
      id: q.id,
      sourceId: q.source_id,
      section: q.section,
      domain: q.domain,
      skill: q.skill,
      difficulty: q.difficulty,
      qtype: q.qtype,
      answer: q.answer,
      attempts: q.attempts,
      wrong: q.wrong,
      blank: q.blank,
      wrongRate: Math.round((q.wrong / q.attempts) * 100),
      avgSec: Math.round(q.avg_ms / 1000),
      topWrong: top ? { answer: top.answer, n: top.n } : null,
      snippet: snippet(q.stem || q.passage)
    };
  });

  const secPer = await query(
    'SELECT s.id, q.section, sum(a.time_ms)::bigint AS ms FROM ' + ANS() + ' a JOIN ' + SESS() + ' s ON s.id = a.session_id JOIN ' + Q() + ' q ON q.id = a.question_id' +
      " WHERE s.step = 'done' AND " + sc.sql + ' GROUP BY s.id, q.section',
    sc.params
  );
  const bySec = { rw: [], math: [] };
  secPer.rows.forEach((x) => { if (bySec[x.section]) bySec[x.section].push(Number(x.ms)); });

  const classesMap = new Map();
  rows.forEach((r) => { if (r.class_id) classesMap.set(r.class_id, r.class_name || r.class_id); });
  const setsMap = new Map();
  rows.forEach((r) => setsMap.set(r.set_id, r.set_name));

  const hardRoute = (key) => {
    const withRoute = doneRows.filter((r) => r[key]);
    return withRoute.length ? Math.round((withRoute.filter((r) => r[key] === 'hard').length / withRoute.length) * 100) : null;
  };

  return {
    counts: {
      sessions: rows.length,
      completed: doneRows.length,
      inProgress: rows.length - doneRows.length,
      students: new Set(rows.map((r) => r.student_id)).size
    },
    scores: {
      avg: mean(scores.total),
      median: median(scores.total),
      min: scores.total.length ? Math.min.apply(null, scores.total) : null,
      max: scores.total.length ? Math.max.apply(null, scores.total) : null,
      avgRw: mean(scores.rw),
      avgMath: mean(scores.math),
      distribution: distribution(scores.total)
    },
    routes: { rwHardPct: hardRoute('route_rw'), mathHardPct: hardRoute('route_math') },
    time: {
      avgRwMin: bySec.rw.length ? Math.round(mean(bySec.rw) / 60000) : null,
      avgMathMin: bySec.math.length ? Math.round(mean(bySec.math) / 60000) : null
    },
    review: { total: reviewTotal, done: reviewDone, pct: reviewTotal ? Math.round((reviewDone / reviewTotal) * 100) : null },
    skills: groupSkills(qrows),
    hardest: hardest,
    students: rows.slice(0, 300).map((r) => {
      const rv = reviewBySession.get(r.id);
      return {
        sessionId: r.id,
        studentId: r.student_id,
        name: r.student_name,
        classId: r.class_id,
        className: r.class_name || r.class_id,
        setName: r.set_name,
        status: r.step === 'done' ? 'completed' : 'in_progress',
        total: r.result ? r.result.total : null,
        rw: r.result && r.result.rw ? r.result.rw.scaled : null,
        math: r.result && r.result.math ? r.result.math.scaled : null,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        reviewTotal: rv ? rv.total : 0,
        reviewDone: rv ? rv.done : 0
      };
    }),
    filters: {
      classes: Array.from(classesMap.entries()).map(([id, name]) => ({ classId: id, className: name })).sort((a, b) => a.className.localeCompare(b.className)),
      sets: Array.from(setsMap.entries()).map(([id, name]) => ({ id: id, name: name }))
    }
  };
}

async function studentReport(studentId, filter) {
  requireDb();
  const sc = scope(Object.assign({}, filter, { studentId: studentId }));
  const sessions = await query(
    'SELECT s.id, s.student_name, s.class_id, s.step, s.result, s.started_at, s.completed_at, st.name AS set_name, a.class_name' +
      ' FROM ' + SESS() + ' s JOIN ' + SETS() + ' st ON st.id = s.set_id LEFT JOIN ' + ASSIGN() + ' a ON a.id = s.assignment_id' +
      ' WHERE ' + sc.sql + ' ORDER BY s.started_at ASC',
    sc.params
  );
  if (!sessions.rows.length) throw httpError(404, '이 학생의 응시 기록이 없습니다.');
  const skills = groupSkills(await skillRows(sc));
  const notes = await query(
    'SELECT n.stage, q.section, q.domain, q.skill, count(*)::int AS n FROM ' + NOTES() + ' n JOIN ' + Q() + ' q ON q.id = n.question_id' +
      ' JOIN ' + SESS() + ' s ON s.id = n.session_id WHERE ' + sc.sql + ' GROUP BY n.stage, q.section, q.domain, q.skill',
    sc.params
  );
  let total = 0;
  let done = 0;
  const openBySkill = new Map();
  notes.rows.forEach((x) => {
    total += x.n;
    if (x.stage === 'done') done += x.n;
    else {
      const k = x.section + '|' + x.domain + '|' + x.skill;
      const g = openBySkill.get(k) || { section: x.section, domain: x.domain, skill: x.skill, open: 0 };
      g.open += x.n;
      openBySkill.set(k, g);
    }
  });
  const first = sessions.rows[0];
  return {
    student: { studentId: studentId, name: first.student_name, className: first.class_name || first.class_id },
    sessions: sessions.rows.map((r) => ({
      sessionId: r.id,
      setName: r.set_name,
      status: r.step === 'done' ? 'completed' : 'in_progress',
      total: r.result ? r.result.total : null,
      rw: r.result && r.result.rw ? r.result.rw.scaled : null,
      math: r.result && r.result.math ? r.result.math.scaled : null,
      startedAt: r.started_at,
      completedAt: r.completed_at
    })),
    skills: skills,
    review: { total: total, done: done, open: total - done, openBySkill: Array.from(openBySkill.values()).sort((a, b) => b.open - a.open).slice(0, 8) }
  };
}

module.exports = { overview, studentReport };
