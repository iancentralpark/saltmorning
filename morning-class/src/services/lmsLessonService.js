'use strict';

/**
 * Online LMS video lessons.
 *
 * A "lesson" is one video attached to one class. Who can watch it is decided by
 * the assignment rows in lms_lesson_students:
 *   - no rows at all       → the whole class (older lessons)
 *   - rows                 → only students with a row that is not removed
 * Each assignment row has its own due date, so the same video can be assigned
 * to different students at different times. Unassigning only marks the row as
 * removed, so watch history survives and comes back if the video is reassigned.
 *
 * Progress counts video that was actually played. The player reports the
 * stretches it played ("ranges"); skipping ahead adds nothing.
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table, withTransaction } = require('../db/pool');
const stream = require('./lmsStreamService');

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 2000;
const COMPLETE_RATIO = 0.9;
const DEFAULT_DUE_DAYS = 7;
const MAX_DUE_DAYS = 365;
const MAX_ASSIGN_VIDEOS = 50;
const KST_OFFSET_MS = 9 * 3600 * 1000;

const MAX_COVERAGE_SECONDS = 12 * 3600;
const MAX_RANGES_PER_REPORT = 60;
const MIN_RATE = 0.25;
const MAX_RATE = 2;
// Reported play time is paid for with real time. Credit builds up one second per second
// between reports (up to a cap that covers a few minutes without a connection) and each
// report spends it, so no sequence of reports can claim a video faster than it can be played.
const WALL_CREDIT_START = 30;
const WALL_CREDIT_MAX = 300;

/** @type {Map<string, object>} */
const lessons = new Map();
/** @type {Map<string, Map<string, object>>} */
const progressByLesson = new Map();
/** @type {Map<string, Map<string, object>>} lessonId → studentId → assignment */
const assignMem = new Map();
/** @type {Map<string, {defaultDueDays: number}>} */
const settingsMem = new Map();

function httpError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

function newId() {
  return 'les_' + crypto.randomBytes(6).toString('hex');
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function toMs(v) {
  return v ? new Date(v).getTime() : null;
}

/** SQL fragment: nullable epoch-ms parameter → timestamptz. */
function tsParam(n) {
  return 'CASE WHEN $' + n + '::bigint IS NULL THEN NULL ELSE to_timestamp($' + n + '::bigint/1000.0) END';
}

function rowToLesson(r) {
  return {
    id: r.id,
    classId: r.class_id,
    libraryVideoId: r.library_video_id || null,
    title: r.title,
    description: r.description || '',
    provider: r.provider || 'cloudflare',
    videoUid: r.video_uid || '',
    status: r.status,
    statusMessage: r.status_message || '',
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    orderIndex: Number(r.order_index) || 0,
    published: !!r.published,
    availableFrom: toMs(r.available_from),
    dueAt: toMs(r.due_at),
    createdBy: r.created_by || '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
  };
}

// Everything except `coverage`, which can be several KB per row and is only
// needed while saving progress.
const PROGRESS_COLUMNS =
  'lesson_id, student_id, student_name, class_id, last_position, watched_seconds, duration_seconds, ' +
  'view_count, last_playback_rate, max_percent, played_seconds, played_wall_seconds, ' +
  'completed_manually, completed_at, updated_at';

function rowToProgress(r) {
  return {
    lessonId: r.lesson_id,
    studentId: String(r.student_id),
    studentName: r.student_name || '',
    classId: r.class_id,
    lastPosition: Number(r.last_position) || 0,
    watchedSeconds: Number(r.watched_seconds) || 0,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    viewCount: Number(r.view_count) || 0,
    lastPlaybackRate: Number(r.last_playback_rate) || 1,
    maxPercent: Number(r.max_percent) || 0,
    playedSeconds: Number(r.played_seconds) || 0,
    playedWallSeconds: Number(r.played_wall_seconds) || 0,
    coverage: r.coverage == null ? undefined : String(r.coverage),
    wallCredit: r.wall_credit == null ? WALL_CREDIT_START : Number(r.wall_credit),
    completedManually: !!r.completed_manually,
    completedAt: toMs(r.completed_at),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
  };
}

function rowToAssignment(r) {
  return {
    lessonId: r.lesson_id,
    studentId: String(r.student_id),
    assignedAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    dueAt: toMs(r.due_at),
    availableFrom: toMs(r.available_from),
    removedAt: toMs(r.removed_at)
  };
}

async function persistLesson(l) {
  if (!isOpsDbEnabled()) return;
  await query(
    'INSERT INTO ' + table('lms_lessons') + ' (' +
      'id, class_id, library_video_id, title, description, provider, video_uid, status, status_message, ' +
      'duration_seconds, order_index, published, available_from, due_at, created_by, created_at, updated_at' +
    ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,' +
      tsParam(13) + ',' + tsParam(14) + ',' +
      '$15,to_timestamp($16::bigint/1000.0),to_timestamp($17::bigint/1000.0)) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
      'library_video_id = EXCLUDED.library_video_id, title = EXCLUDED.title, description = EXCLUDED.description, ' +
      'video_uid = EXCLUDED.video_uid, status = EXCLUDED.status, status_message = EXCLUDED.status_message, ' +
      'duration_seconds = EXCLUDED.duration_seconds, order_index = EXCLUDED.order_index, ' +
      'published = EXCLUDED.published, available_from = EXCLUDED.available_from, due_at = EXCLUDED.due_at, ' +
      'updated_at = EXCLUDED.updated_at',
    [
      l.id, l.classId, l.libraryVideoId || null, l.title, l.description || '', l.provider || 'cloudflare',
      l.videoUid || '', l.status, l.statusMessage || '', l.durationSeconds, l.orderIndex || 0,
      !!l.published, l.availableFrom, l.dueAt, l.createdBy || '', l.createdAt, l.updatedAt
    ]
  );
}

async function loadLesson(id) {
  id = String(id || '');
  if (!id) return null;
  if (isOpsDbEnabled()) {
    const r = await query('SELECT * FROM ' + table('lms_lessons') + ' WHERE id = $1 LIMIT 1', [id]);
    return r.rows[0] ? rowToLesson(r.rows[0]) : null;
  }
  return lessons.get(id) || null;
}

async function loadClassLessons(classId) {
  classId = String(classId || '');
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT * FROM ' + table('lms_lessons') +
        ' WHERE class_id = $1 ORDER BY order_index ASC, created_at ASC',
      [classId]
    );
    return r.rows.map(rowToLesson);
  }
  return Array.from(lessons.values())
    .filter((l) => l.classId === classId)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt);
}

async function loadProgressForLesson(lessonId) {
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT ' + PROGRESS_COLUMNS + ' FROM ' + table('lms_progress') +
        ' WHERE lesson_id = $1 ORDER BY student_name ASC',
      [lessonId]
    );
    return r.rows.map(rowToProgress);
  }
  return Array.from((progressByLesson.get(lessonId) || new Map()).values());
}

async function loadProgressForStudent(classId, studentId) {
  const out = new Map();
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT ' + PROGRESS_COLUMNS + ' FROM ' + table('lms_progress') +
        ' WHERE class_id = $1 AND student_id = $2',
      [String(classId), String(studentId)]
    );
    r.rows.forEach((row) => out.set(row.lesson_id, rowToProgress(row)));
    return out;
  }
  progressByLesson.forEach((m, lessonId) => {
    const p = m.get(String(studentId));
    if (p && p.classId === String(classId)) out.set(lessonId, p);
  });
  return out;
}

async function loadAllProgressForClass(classId) {
  classId = String(classId || '');
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT ' + PROGRESS_COLUMNS + ' FROM ' + table('lms_progress') + ' WHERE class_id = $1',
      [classId]
    );
    return r.rows.map(rowToProgress);
  }
  const out = [];
  progressByLesson.forEach((m) => {
    m.forEach((p) => { if (p.classId === classId) out.push(p); });
  });
  return out;
}

async function progressCounts(classId) {
  const out = new Map();
  const rows = await loadAllProgressForClass(classId);
  rows.forEach((p) => {
    const c = out.get(p.lessonId) || { started: 0, completed: 0 };
    c.started += 1;
    if (p.completedAt) c.completed += 1;
    out.set(p.lessonId, c);
  });
  return out;
}

function normalizeStudentIds(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  list.forEach((id) => {
    const x = String(id || '').trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  });
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Assignments (who has which video, and until when)
// ---------------------------------------------------------------------------

/** @returns {Promise<Map<string, Map<string, object>>>} lessonId → studentId → assignment (removed rows included) */
async function loadAssignmentsForLessons(lessonIds) {
  const out = new Map();
  const ids = (lessonIds || []).map(String);
  ids.forEach((id) => out.set(id, new Map()));
  if (!ids.length) return out;
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT lesson_id, student_id, created_at, due_at, available_from, removed_at FROM ' +
        table('lms_lesson_students') + ' WHERE lesson_id = ANY($1::text[])',
      [ids]
    );
    r.rows.forEach((row) => {
      const a = rowToAssignment(row);
      out.get(a.lessonId).set(a.studentId, a);
    });
    return out;
  }
  ids.forEach((id) => {
    const m = assignMem.get(id);
    if (m) m.forEach((a, sid) => out.get(id).set(sid, a));
  });
  return out;
}

async function loadAssignments(lessonId) {
  const all = await loadAssignmentsForLessons([lessonId]);
  return all.get(String(lessonId)) || new Map();
}

async function saveAssignment(a) {
  if (isOpsDbEnabled()) {
    await query(
      'INSERT INTO ' + table('lms_lesson_students') +
        ' (lesson_id, student_id, created_at, due_at, available_from, removed_at) VALUES ' +
        '($1,$2,to_timestamp($3::bigint/1000.0),' + tsParam(4) + ',' + tsParam(5) + ',' + tsParam(6) + ') ' +
      'ON CONFLICT (lesson_id, student_id) DO UPDATE SET ' +
        'created_at = EXCLUDED.created_at, due_at = EXCLUDED.due_at, ' +
        'available_from = EXCLUDED.available_from, removed_at = EXCLUDED.removed_at',
      [a.lessonId, a.studentId, Math.round(a.assignedAt), a.dueAt, a.availableFrom, a.removedAt]
    );
    return;
  }
  if (!assignMem.has(a.lessonId)) assignMem.set(a.lessonId, new Map());
  assignMem.get(a.lessonId).set(a.studentId, Object.assign({}, a));
}

async function clearAssignments(lessonId) {
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('lms_lesson_students') + ' WHERE lesson_id = $1', [lessonId]);
  }
  assignMem.delete(lessonId);
}

/**
 * What a student is allowed for a lesson, or null when it is not assigned to them.
 * A lesson without any assignment rows belongs to the whole class and uses the
 * schedule stored on the lesson itself.
 */
function accessFor(l, rows, studentId) {
  if (!rows || rows.size === 0) {
    return {
      wholeClass: true,
      assignedAt: l.createdAt,
      dueAt: l.dueAt || null,
      availableFrom: l.availableFrom || null
    };
  }
  const a = rows.get(String(studentId || ''));
  if (!a || a.removedAt) return null;
  return { wholeClass: false, assignedAt: a.assignedAt, dueAt: a.dueAt, availableFrom: a.availableFrom };
}

/** Active student ids, or null when the lesson belongs to the whole class. */
function activeStudentIds(rows) {
  if (!rows || rows.size === 0) return null;
  const out = [];
  rows.forEach((a, sid) => { if (!a.removedAt) out.push(sid); });
  return out.sort();
}

async function loadLessonStudentIds(lessonId) {
  return activeStudentIds(await loadAssignments(lessonId));
}

async function studentCanAccessLesson(lessonId, studentId) {
  const l = await loadLesson(lessonId);
  if (!l) return false;
  return !!accessFor(l, await loadAssignments(l.id), studentId);
}

/**
 * Replace the set of students for a lesson (older lesson-first API).
 * Empty list = whole class again. Students who drop out are marked removed.
 */
async function setLessonStudents(lessonId, studentIds) {
  const l = await loadLesson(lessonId);
  if (!l) throw httpError(404, 'Lesson not found.');
  const ids = normalizeStudentIds(studentIds);
  const rows = await loadAssignments(l.id);
  const now = Date.now();
  if (!ids) {
    await clearAssignments(l.id);
  } else {
    const want = new Set(ids);
    for (const [sid, a] of rows) {
      if (!want.has(sid) && !a.removedAt) await saveAssignment(Object.assign({}, a, { removedAt: now }));
    }
    for (const sid of ids) {
      const a = rows.get(sid);
      if (a && !a.removedAt) continue;
      await saveAssignment({
        lessonId: l.id,
        studentId: sid,
        assignedAt: now,
        dueAt: l.dueAt || null,
        availableFrom: l.availableFrom || null,
        removedAt: null
      });
    }
  }
  const counts = await progressCounts(l.classId);
  return staffLesson(l, counts.get(l.id), await loadAssignments(l.id));
}

function staffLesson(l, counts, rows) {
  const studentIds = activeStudentIds(rows);
  return {
    id: l.id,
    classId: l.classId,
    libraryVideoId: l.libraryVideoId || null,
    title: l.title,
    description: l.description,
    status: l.status,
    statusMessage: l.statusMessage,
    durationSeconds: l.durationSeconds,
    orderIndex: l.orderIndex,
    published: l.published,
    availableFrom: l.availableFrom || null,
    dueAt: l.dueAt || null,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    startedCount: (counts && counts.started) || 0,
    completedCount: (counts && counts.completed) || 0,
    studentIds,
    targeted: studentIds !== null
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseScheduleMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  // date-only → start of that calendar day in Asia/Seoul (+09:00)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s + 'T00:00:00+09:00');
    return Number.isFinite(t) ? t : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
    const t = Date.parse(s + ':00+09:00');
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** A due date given as a plain day means "by the end of that day" in Korea. */
function parseDueMs(v) {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    const t = Date.parse(v.trim() + 'T23:59:59+09:00');
    return Number.isFinite(t) ? t : null;
  }
  return parseScheduleMs(v);
}

/** End of the Korean calendar day that is `days` days after `now`. */
function endOfKstDay(now, days) {
  const k = new Date(now + KST_OFFSET_MS);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + days, 23, 59, 59) - KST_OFFSET_MS;
}

function startOfKstDay(now) {
  const k = new Date(now + KST_OFFSET_MS);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS;
}

function applySchedule(lesson, body) {
  if (!body) return;
  if (body.availableFrom !== undefined) lesson.availableFrom = parseScheduleMs(body.availableFrom);
  if (body.dueAt !== undefined) lesson.dueAt = parseScheduleMs(body.dueAt);
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm';
  return sec + 's';
}

// ---------------------------------------------------------------------------
// Class settings
// ---------------------------------------------------------------------------

async function getClassSettings(classId) {
  classId = String(classId || '');
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT default_due_days FROM ' + table('lms_class_settings') + ' WHERE class_id = $1',
      [classId]
    );
    return { defaultDueDays: r.rows[0] ? Number(r.rows[0].default_due_days) : DEFAULT_DUE_DAYS };
  }
  return settingsMem.get(classId) || { defaultDueDays: DEFAULT_DUE_DAYS };
}

/** defaultDueDays: 0 = new assignments get no due date. */
async function updateClassSettings(classId, body) {
  classId = String(classId || '').trim();
  if (!classId) throw httpError(400, 'classId is required.');
  const days = Number(body && body.defaultDueDays);
  if (!Number.isInteger(days) || days < 0 || days > MAX_DUE_DAYS) {
    throw httpError(400, 'Default due must be between 0 and ' + MAX_DUE_DAYS + ' days.');
  }
  if (isOpsDbEnabled()) {
    await query(
      'INSERT INTO ' + table('lms_class_settings') + ' (class_id, default_due_days, updated_at) ' +
        'VALUES ($1,$2,now()) ON CONFLICT (class_id) DO UPDATE SET ' +
        'default_due_days = EXCLUDED.default_due_days, updated_at = now()',
      [classId, days]
    );
  } else {
    settingsMem.set(classId, { defaultDueDays: days });
  }
  return { defaultDueDays: days };
}

// ---------------------------------------------------------------------------
// Views of a lesson for one student
// ---------------------------------------------------------------------------

function percentOf(p, dur) {
  if (!p) return 0;
  const byTime = dur ? Math.round((p.watchedSeconds / dur) * 100) : 0;
  return Math.max(0, Math.min(100, Math.max(p.maxPercent || 0, byTime)));
}

function isLocked(access, now) {
  return !!(access.availableFrom && access.availableFrom > now);
}

function studentLesson(l, access, p, now) {
  now = now || Date.now();
  const dur = l.durationSeconds || (p && p.durationSeconds) || null;
  const locked = isLocked(access, now);
  const completed = !!(p && p.completedAt);
  const started = !!(p && (p.watchedSeconds > 0 || p.lastPosition > 0));
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    durationSeconds: dur,
    orderIndex: l.orderIndex,
    assignedAt: access.assignedAt,
    availableFrom: access.availableFrom || null,
    dueAt: access.dueAt || null,
    locked,
    overdue: !completed && !!access.dueAt && access.dueAt < now,
    lastPosition: p ? p.lastPosition : 0,
    watchedSeconds: p ? p.watchedSeconds : 0,
    percent: locked ? 0 : percentOf(p, dur),
    completed,
    completedAt: completed ? p.completedAt : null,
    section: completed
      ? 'done'
      : (locked ? 'upcoming' : (started ? 'continue' : 'today'))
  };
}

/** The same lesson as the teacher sees it for one student, with watch statistics. */
function staffStudentLesson(l, access, p, now) {
  const base = studentLesson(l, access, p, now);
  const dur = base.durationSeconds;
  const played = p ? p.playedSeconds : 0;
  const wall = p ? p.playedWallSeconds : 0;
  return {
    id: l.id,
    libraryVideoId: l.libraryVideoId || null,
    title: l.title,
    durationSeconds: dur,
    wholeClass: !!access.wholeClass,
    assignedAt: base.assignedAt,
    availableFrom: base.availableFrom,
    dueAt: base.dueAt,
    locked: base.locked,
    overdue: base.overdue,
    completed: base.completed,
    completedAt: base.completedAt,
    completedManually: !!(p && p.completedAt && p.completedManually),
    started: !!p && (base.watchedSeconds > 0 || base.lastPosition > 0 || (p.viewCount || 0) > 0),
    percent: percentOf(p, dur),
    watchedSeconds: base.watchedSeconds,
    playedSeconds: Math.round(played),
    // How many times over the video was played, e.g. 1.3 = once plus a third again.
    views: dur && played > 0 ? Math.round((played / dur) * 10) / 10 : null,
    // Average playback speed over everything that was played.
    avgSpeed: wall > 0 ? Math.round((played / wall) * 100) / 100 : null,
    lastPlaybackRate: p ? p.lastPlaybackRate : null,
    sessions: p ? (p.viewCount || 0) : 0,
    lastWatchedAt: p ? p.updatedAt : null
  };
}

/** Not finished first (overdue, then nearest due date), finished last. */
function compareForTodo(a, b) {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  if (a.completed) return (b.completedAt || 0) - (a.completedAt || 0);
  if (a.locked !== b.locked) return a.locked ? 1 : -1;
  if (a.locked) return (a.availableFrom || 0) - (b.availableFrom || 0);
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  const da = a.dueAt || Number.MAX_SAFE_INTEGER;
  const db = b.dueAt || Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  return (a.assignedAt || 0) - (b.assignedAt || 0);
}

// ---------------------------------------------------------------------------
// Cloudflare sync
// ---------------------------------------------------------------------------

/** Pull the latest state from Cloudflare for lessons that are not finished yet. */
async function syncLesson(l) {
  if (!l || !l.videoUid) return l;
  if (l.libraryVideoId) {
    try {
      const library = require('./lmsLibraryService');
      let video = await library.getRaw(l.libraryVideoId);
      if (video) {
        video = await library.syncVideo(video);
        const changed = video.status !== l.status ||
          video.durationSeconds !== l.durationSeconds ||
          (video.statusMessage || '') !== (l.statusMessage || '') ||
          (video.videoUid && video.videoUid !== l.videoUid) ||
          video.title !== l.title;
        if (changed) {
          if (video.videoUid) l.videoUid = video.videoUid;
          l.status = video.status;
          l.statusMessage = video.statusMessage || '';
          l.durationSeconds = video.durationSeconds;
          // Keep class-specific title/description unless empty.
          if (!l.title) l.title = video.title;
          if (l.status !== 'ready') l.published = false;
          l.updatedAt = Date.now();
          lessons.set(l.id, l);
          await persistLesson(l);
        }
        return l;
      }
    } catch (_) { /* fall through to direct CF sync */ }
  }
  if (l.status !== 'uploading' && l.status !== 'processing') return l;
  if (!stream.isConfigured()) return l;
  let v;
  try {
    v = await stream.getVideo(l.videoUid);
  } catch (e) {
    return l;
  }
  const changed = v.state !== l.status ||
    (v.duration && v.duration !== l.durationSeconds) ||
    (v.message || '') !== (l.statusMessage || '');
  if (!changed) return l;
  l.status = v.state;
  l.statusMessage = v.message || '';
  if (v.duration) l.durationSeconds = v.duration;
  if (l.status !== 'ready') l.published = false;
  l.updatedAt = Date.now();
  lessons.set(l.id, l);
  await persistLesson(l);
  return l;
}

/** Point cached class lessons at a replaced library file. Assignments are untouched. */
function applyLibraryRetarget(video) {
  const id = video && video.id;
  const uid = video && video.videoUid;
  if (!id || !uid) return;
  for (const l of lessons.values()) {
    const linked = l.libraryVideoId === id ||
      (!l.libraryVideoId && video.oldVideoUid && l.videoUid === video.oldVideoUid);
    if (!linked) continue;
    l.videoUid = uid;
    l.status = 'ready';
    l.statusMessage = '';
    if (video.durationSeconds) l.durationSeconds = video.durationSeconds;
    l.updatedAt = Date.now();
  }
}

function isConfigured() {
  return stream.isConfigured();
}

// ---------------------------------------------------------------------------
// Staff: lessons
// ---------------------------------------------------------------------------

async function listForStaff(classId) {
  const list = await loadClassLessons(classId);
  await Promise.all(list.map((l) => syncLesson(l)));
  const [counts, rowsByLesson] = await Promise.all([
    progressCounts(classId),
    loadAssignmentsForLessons(list.map((l) => l.id))
  ]);
  return list.map((l) => staffLesson(l, counts.get(l.id), rowsByLesson.get(l.id)));
}

async function staffLessonById(l) {
  const counts = await progressCounts(l.classId);
  return staffLesson(l, counts.get(l.id), await loadAssignments(l.id));
}

async function createLesson(classId, body, teacherId) {
  // Prefer assigning from the central library. Legacy direct class upload still works.
  if (body && body.libraryVideoId) {
    return assignFromLibrary(classId, body, teacherId);
  }
  classId = String(classId || '').trim();
  if (!classId) throw httpError(400, 'classId is required.');
  const title = clean(body && body.title, MAX_TITLE);
  if (!title) throw httpError(400, '강의 제목을 입력하세요.');
  const description = clean(body && body.description, MAX_DESCRIPTION);

  const existing = await loadClassLessons(classId);
  const upload = await stream.createDirectUpload({ name: title, creator: teacherId });
  const now = Date.now();
  const lesson = {
    id: newId(),
    classId,
    libraryVideoId: null,
    title,
    description,
    provider: 'cloudflare',
    videoUid: upload.uid,
    status: 'uploading',
    statusMessage: '',
    durationSeconds: null,
    orderIndex: existing.reduce((m, l) => Math.max(m, l.orderIndex), 0) + 1,
    published: false,
    availableFrom: null,
    dueAt: null,
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
  applySchedule(lesson, body);
  lessons.set(lesson.id, lesson);
  await persistLesson(lesson);
  if (body && body.studentIds) await setLessonStudents(lesson.id, body.studentIds);
  return { lesson: await staffLessonById(lesson), uploadURL: upload.uploadURL };
}

function newLibraryLesson(classId, video, existing, teacherId, now) {
  return {
    id: newId(),
    classId,
    libraryVideoId: video.id,
    title: clean(video.title, MAX_TITLE) || 'Video',
    description: clean(video.description, MAX_DESCRIPTION),
    provider: video.provider || 'cloudflare',
    videoUid: video.videoUid,
    status: video.status,
    statusMessage: video.statusMessage || '',
    durationSeconds: video.durationSeconds,
    orderIndex: existing.reduce((m, l) => Math.max(m, l.orderIndex), 0) + 1,
    published: false,
    availableFrom: null,
    dueAt: null,
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
}

/** Older single-video API: attach one library video to a class. */
async function assignFromLibrary(classId, body, teacherId) {
  const library = require('./lmsLibraryService');
  classId = String(classId || '').trim();
  if (!classId) throw httpError(400, 'classId is required.');
  const libId = String((body && body.libraryVideoId) || '').trim();
  if (!libId) throw httpError(400, 'libraryVideoId is required.');
  let video = await library.getRaw(libId);
  if (!video) throw httpError(404, 'Library video not found.');
  video = await library.syncVideo(video);
  if (video.status !== 'ready') {
    throw httpError(409, '영상 처리가 끝난 뒤에 클래스에 배정할 수 있습니다.');
  }

  const existing = await loadClassLessons(classId);
  const dup = existing.find((l) => l.libraryVideoId === video.id);
  if (dup) throw httpError(409, '이 영상은 이미 이 클래스에 배정되어 있습니다.');

  const lesson = newLibraryLesson(classId, video, existing, teacherId, Date.now());
  if (body && body.title) lesson.title = clean(body.title, MAX_TITLE) || lesson.title;
  if (body && body.description != null) lesson.description = clean(body.description, MAX_DESCRIPTION);
  lesson.published = !!(body && body.published === true);
  applySchedule(lesson, body);
  // Scheduled unlock still needs published=true so it appears in Upcoming for students.
  if (lesson.availableFrom && body && body.published !== false) lesson.published = true;
  lessons.set(lesson.id, lesson);
  await persistLesson(lesson);
  if (body && body.studentIds) await setLessonStudents(lesson.id, body.studentIds);
  return { lesson: await staffLessonById(lesson) };
}

async function getForStaff(id) {
  const l = await loadLesson(id);
  if (!l) throw httpError(404, 'Lesson not found.');
  await syncLesson(l);
  return staffLessonById(l);
}

async function getRaw(id) {
  return loadLesson(id);
}

async function updateLesson(id, patch) {
  const l = await loadLesson(id);
  if (!l) throw httpError(404, 'Lesson not found.');
  patch = patch || {};
  if (patch.title != null) {
    const t = clean(patch.title, MAX_TITLE);
    if (!t) throw httpError(400, '강의 제목을 입력하세요.');
    l.title = t;
  }
  if (patch.description != null) l.description = clean(patch.description, MAX_DESCRIPTION);
  if (patch.published != null) {
    const want = patch.published === true;
    if (want) {
      await syncLesson(l);
      if (l.status !== 'ready') throw httpError(409, '영상 처리가 끝난 뒤에 공개할 수 있습니다.');
    }
    l.published = want;
  }
  if (patch.availableFrom !== undefined || patch.dueAt !== undefined) applySchedule(l, patch);
  l.updatedAt = Date.now();
  lessons.set(l.id, l);
  await persistLesson(l);
  if (patch.studentIds !== undefined) {
    return setLessonStudents(l.id, patch.studentIds);
  }
  return staffLessonById(l);
}

async function reorder(classId, ids) {
  if (!Array.isArray(ids) || !ids.length) throw httpError(400, 'ids must be a non-empty array.');
  const list = await loadClassLessons(classId);
  const byId = new Map(list.map((l) => [l.id, l]));
  const seen = new Set();
  const ordered = [];
  ids.forEach((id) => {
    const l = byId.get(String(id));
    if (l && !seen.has(l.id)) {
      seen.add(l.id);
      ordered.push(l);
    }
  });
  list.forEach((l) => { if (!seen.has(l.id)) ordered.push(l); });
  const now = Date.now();
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i].orderIndex !== i + 1) {
      ordered[i].orderIndex = i + 1;
      ordered[i].updatedAt = now;
      lessons.set(ordered[i].id, ordered[i]);
      await persistLesson(ordered[i]);
    }
  }
  return listForStaff(classId);
}

async function deleteLesson(id) {
  const l = await loadLesson(id);
  if (!l) throw httpError(404, 'Lesson not found.');
  // Library-backed assignments only unlink the class copy; CF video stays in the catalog.
  if (!l.libraryVideoId && l.videoUid && stream.isConfigured()) {
    try {
      await stream.deleteVideo(l.videoUid);
    } catch (e) {
      throw httpError(502, '영상 삭제에 실패했습니다. 잠시 후 다시 시도하세요: ' + e.message);
    }
  }
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('lms_lessons') + ' WHERE id = $1', [l.id]);
  }
  lessons.delete(l.id);
  progressByLesson.delete(l.id);
  assignMem.delete(l.id);
  return { ok: true, id: l.id };
}

async function progressForStaff(id) {
  const l = await loadLesson(id);
  if (!l) throw httpError(404, 'Lesson not found.');
  const rows = await loadProgressForLesson(l.id);
  return {
    lessonId: l.id,
    durationSeconds: l.durationSeconds,
    students: rows.map((p) => {
      const percent = percentOf(p, l.durationSeconds || p.durationSeconds);
      const dur = l.durationSeconds || p.durationSeconds;
      return {
        studentId: p.studentId,
        studentName: p.studentName,
        watchedSeconds: p.watchedSeconds,
        percent,
        maxPercent: percent,
        viewCount: p.viewCount || 0,
        lastPlaybackRate: p.lastPlaybackRate || 1,
        playedSeconds: Math.round(p.playedSeconds),
        views: dur && p.playedSeconds > 0 ? Math.round((p.playedSeconds / dur) * 10) / 10 : null,
        avgSpeed: p.playedWallSeconds > 0
          ? Math.round((p.playedSeconds / p.playedWallSeconds) * 100) / 100
          : null,
        completed: !!p.completedAt,
        completedManually: !!(p.completedAt && p.completedManually),
        updatedAt: p.updatedAt
      };
    })
  };
}

// ---------------------------------------------------------------------------
// Staff: assign / unassign / due dates
// ---------------------------------------------------------------------------

function rosterIdsOf(roster) {
  return (roster || [])
    .map((s) => String((s && (s.studentId || s.id)) || '').trim())
    .filter(Boolean);
}

function pickStudents(raw, roster) {
  const inClass = new Set(rosterIdsOf(roster));
  if (!inClass.size) throw httpError(409, 'This class has no enrolled students.');
  const ids = (normalizeStudentIds(raw) || []).filter((sid) => inClass.has(sid));
  if (!ids.length) throw httpError(400, 'Choose at least one student.');
  return ids;
}

function idList(raw) {
  return (normalizeStudentIds(raw) || []).slice(0, MAX_ASSIGN_VIDEOS);
}

function resolveDue(body, settings, now) {
  if (body.noDue === true) return null;
  if (body.dueAt != null && body.dueAt !== '') {
    const t = parseDueMs(body.dueAt);
    if (t == null) throw httpError(400, 'That due date is not valid.');
    if (t < startOfKstDay(now)) throw httpError(400, 'The due date is in the past.');
    return t;
  }
  const hasDays = body.dueDays != null && body.dueDays !== '';
  const days = hasDays ? Number(body.dueDays) : settings.defaultDueDays;
  if (!Number.isInteger(days) || days < 0 || days > MAX_DUE_DAYS) {
    throw httpError(400, 'Due days must be between 0 and ' + MAX_DUE_DAYS + '.');
  }
  return days === 0 ? null : endOfKstDay(now, days);
}

/**
 * A whole-class lesson has no rows. Before one student can be treated differently
 * (unassigned, or given another due date) every enrolled student gets a row that
 * carries what they already had.
 */
async function materializeWholeClass(l, rows, roster) {
  if (rows.size > 0) return rows;
  const ids = rosterIdsOf(roster);
  if (!ids.length) throw httpError(409, 'This class has no enrolled students.');
  for (const sid of ids) {
    await saveAssignment({
      lessonId: l.id,
      studentId: sid,
      assignedAt: l.createdAt,
      dueAt: l.dueAt || null,
      availableFrom: l.availableFrom || null,
      removedAt: null
    });
  }
  return loadAssignments(l.id);
}

/**
 * Assign any number of videos to any number of students in one go.
 * Safe to repeat: a student who already has a video keeps it unchanged.
 *
 * body: { libraryVideoIds[], lessonIds[], studentIds[],
 *         dueDays | dueAt | noDue (none given → class default), availableFrom }
 */
async function assignVideos(classId, body, teacherId, roster) {
  const library = require('./lmsLibraryService');
  classId = String(classId || '').trim();
  if (!classId) throw httpError(400, 'classId is required.');
  body = body || {};
  const studentIds = pickStudents(body.studentIds, roster);
  const libIds = idList(body.libraryVideoIds);
  const lessonIds = idList(body.lessonIds);
  if (!libIds.length && !lessonIds.length) throw httpError(400, 'Choose at least one video.');

  const now = Date.now();
  const settings = await getClassSettings(classId);
  const dueAt = resolveDue(body, settings, now);
  const availableFrom = parseScheduleMs(body.availableFrom);
  if (body.availableFrom != null && body.availableFrom !== '' && availableFrom == null) {
    throw httpError(400, 'That unlock date is not valid.');
  }
  if (availableFrom && dueAt && availableFrom >= dueAt) {
    throw httpError(400, 'The unlock date must be before the due date.');
  }
  const unlockAt = availableFrom && availableFrom > now ? availableFrom : null;

  const existing = await loadClassLessons(classId);
  const targets = [];
  const skipped = [];
  const seen = new Set();
  const addTarget = (l) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    targets.push(l);
  };

  for (const libId of libIds) {
    let video = await library.getRaw(libId);
    if (!video) {
      skipped.push({ id: libId, title: '', reason: 'This video is no longer in the library.' });
      continue;
    }
    video = await library.syncVideo(video);
    if (video.status !== 'ready') {
      skipped.push({ id: libId, title: video.title, reason: 'Still processing.' });
      continue;
    }
    let l = existing.find((x) => x.libraryVideoId === video.id);
    if (l) {
      await syncLesson(l);
    } else {
      // Created unpublished: it goes live below, after its student rows exist, so it is
      // never visible to the whole class in between.
      l = newLibraryLesson(classId, video, existing, teacherId, now);
      existing.push(l);
      lessons.set(l.id, l);
      await persistLesson(l);
    }
    addTarget(l);
  }
  for (const id of lessonIds) {
    const l = existing.find((x) => x.id === id);
    if (!l) {
      skipped.push({ id, title: '', reason: 'This video is not in this class.' });
      continue;
    }
    await syncLesson(l);
    addTarget(l);
  }

  const rowsByLesson = await loadAssignmentsForLessons(targets.map((l) => l.id));
  let assigned = 0;
  let alreadyAssigned = 0;
  const undo = [];

  for (const l of targets) {
    if (l.status !== 'ready') {
      skipped.push({ id: l.id, title: l.title, reason: 'Still processing.' });
      continue;
    }
    const rows = rowsByLesson.get(l.id) || new Map();
    const wasDraft = !l.published;
    if (!wasDraft && rows.size === 0) {
      alreadyAssigned += studentIds.length;
      continue;
    }
    if (wasDraft) {
      // A draft was visible to nobody. Publishing it must not reveal it to students
      // who are not part of this assignment.
      const want = new Set(studentIds);
      for (const [sid, a] of rows) {
        if (!want.has(sid) && !a.removedAt) await saveAssignment(Object.assign({}, a, { removedAt: now }));
      }
    }
    const added = [];
    for (const sid of studentIds) {
      const a = rows.get(sid);
      if (!wasDraft && a && !a.removedAt) {
        alreadyAssigned += 1;
        continue;
      }
      await saveAssignment({
        lessonId: l.id,
        studentId: sid,
        assignedAt: now,
        dueAt,
        availableFrom: unlockAt,
        removedAt: null
      });
      added.push(sid);
    }
    if (wasDraft) {
      l.published = true;
      l.updatedAt = now;
      lessons.set(l.id, l);
      await persistLesson(l);
    }
    assigned += added.length;
    if (added.length) undo.push({ lessonId: l.id, studentIds: added });
  }

  return { ok: true, assigned, alreadyAssigned, skipped, dueAt, availableFrom: unlockAt, undo };
}

/**
 * Take videos back from students. Watch history is kept.
 * body: { items: [{ lessonId, studentIds[] }] }  or  { lessonIds[], libraryVideoIds[], studentIds[] }
 */
async function unassignVideos(classId, body, roster) {
  classId = String(classId || '').trim();
  if (!classId) throw httpError(400, 'classId is required.');
  body = body || {};
  const existing = await loadClassLessons(classId);
  const byId = new Map(existing.map((l) => [l.id, l]));
  const inClass = new Set(rosterIdsOf(roster));

  const jobs = [];
  if (Array.isArray(body.items)) {
    body.items.slice(0, MAX_ASSIGN_VIDEOS).forEach((it) => {
      const l = byId.get(String((it && it.lessonId) || ''));
      const ids = normalizeStudentIds(it && it.studentIds) || [];
      if (l && ids.length) jobs.push({ lesson: l, studentIds: ids });
    });
  } else {
    const ids = normalizeStudentIds(body.studentIds) || [];
    const libIds = new Set(idList(body.libraryVideoIds));
    const lessonIds = new Set(idList(body.lessonIds));
    existing.forEach((l) => {
      if (lessonIds.has(l.id) || (l.libraryVideoId && libIds.has(l.libraryVideoId))) {
        if (ids.length) jobs.push({ lesson: l, studentIds: ids });
      }
    });
  }
  if (!jobs.length) throw httpError(400, 'Choose at least one video and one student.');

  const now = Date.now();
  let removed = 0;
  for (const job of jobs) {
    const l = job.lesson;
    let rows = await loadAssignments(l.id);
    if (rows.size === 0) {
      if (!l.published) continue;
      rows = await materializeWholeClass(l, rows, roster);
    }
    for (const sid of job.studentIds) {
      const a = rows.get(sid);
      if (!a || a.removedAt) continue;
      if (inClass.size && !inClass.has(sid)) continue;
      await saveAssignment(Object.assign({}, a, { removedAt: now }));
      removed += 1;
    }
  }
  return { ok: true, removed };
}

/** Change one student's due date for one video. dueAt null/'' = no due date. */
async function setStudentDue(lessonId, studentId, body, roster) {
  const l = await loadLesson(lessonId);
  if (!l) throw httpError(404, 'Lesson not found.');
  studentId = String(studentId || '').trim();
  body = body || {};
  let dueAt = null;
  if (body.dueAt != null && body.dueAt !== '') {
    dueAt = parseDueMs(body.dueAt);
    if (dueAt == null) throw httpError(400, 'That due date is not valid.');
  }
  let rows = await loadAssignments(l.id);
  if (rows.size === 0) {
    if (!l.published || !rosterIdsOf(roster).includes(studentId)) {
      throw httpError(404, 'This video is not assigned to that student.');
    }
    rows = await materializeWholeClass(l, rows, roster);
  }
  const a = rows.get(studentId);
  if (!a || a.removedAt) throw httpError(404, 'This video is not assigned to that student.');
  await saveAssignment(Object.assign({}, a, { dueAt }));
  return { ok: true, lessonId: l.id, studentId, dueAt };
}

/**
 * Everything the teacher's Online Lessons page needs for one class:
 * each student with their assigned videos and watch statistics.
 */
async function overviewForClass(classId, roster) {
  const now = Date.now();
  const list = await loadClassLessons(classId);
  await Promise.all(list.map((l) => syncLesson(l)));
  const [progress, rowsByLesson, settings] = await Promise.all([
    loadAllProgressForClass(classId),
    loadAssignmentsForLessons(list.map((l) => l.id)),
    getClassSettings(classId)
  ]);

  const progByKey = new Map();
  const counts = new Map();
  progress.forEach((p) => {
    progByKey.set(p.lessonId + '|' + p.studentId, p);
    const c = counts.get(p.lessonId) || { started: 0, completed: 0 };
    c.started += 1;
    if (p.completedAt) c.completed += 1;
    counts.set(p.lessonId, c);
  });

  const live = list.filter((l) => l.published && l.status === 'ready');
  const assignedByLesson = new Map(list.map((l) => [l.id, []]));

  const students = (roster || []).map((st) => {
    const sid = String(st.studentId || st.id || '');
    const rows = [];
    live.forEach((l) => {
      const access = accessFor(l, rowsByLesson.get(l.id), sid);
      if (!access) return;
      assignedByLesson.get(l.id).push(sid);
      rows.push(staffStudentLesson(l, access, progByKey.get(l.id + '|' + sid), now));
    });
    rows.sort(compareForTodo);
    const completed = rows.filter((r) => r.completed).length;
    const overdue = rows.filter((r) => r.overdue).length;
    const inProgress = rows.filter((r) => !r.completed && r.started).length;
    const watchedSeconds = rows.reduce((n, r) => n + (r.playedSeconds || r.watchedSeconds || 0), 0);
    const lastWatchedAt = rows.reduce((m, r) => Math.max(m, r.lastWatchedAt || 0), 0) || null;
    return {
      studentId: sid,
      name: st.name || sid,
      assigned: rows.length,
      completed,
      inProgress,
      notStarted: rows.length - completed - inProgress,
      overdue,
      watchedSeconds,
      watchedLabel: fmtDuration(watchedSeconds),
      lastWatchedAt,
      lessons: rows
    };
  });

  const lessonRows = list.map((l) => {
    const row = staffLesson(l, counts.get(l.id), rowsByLesson.get(l.id));
    row.assignedStudentIds = assignedByLesson.get(l.id) || [];
    return row;
  });

  const totalAssigned = students.reduce((n, s) => n + s.assigned, 0);
  const totalCompleted = students.reduce((n, s) => n + s.completed, 0);
  const totalWatched = students.reduce((n, s) => n + s.watchedSeconds, 0);
  return {
    settings,
    summary: {
      students: students.length,
      lessons: list.length,
      published: live.length,
      assignments: totalAssigned,
      completed: totalCompleted,
      overdue: students.reduce((n, s) => n + s.overdue, 0),
      overdueStudents: students.filter((s) => s.overdue > 0).length,
      avgCompletePercent: totalAssigned ? Math.round((totalCompleted / totalAssigned) * 100) : 0,
      totalWatchedSeconds: totalWatched,
      totalWatchedLabel: fmtDuration(totalWatched)
    },
    students,
    lessons: lessonRows
  };
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

async function listForStudent(classId, studentId) {
  const now = Date.now();
  const [list, prog] = await Promise.all([
    loadClassLessons(classId),
    loadProgressForStudent(classId, studentId)
  ]);
  const live = list.filter((l) => l.published && l.status === 'ready');
  const rowsByLesson = await loadAssignmentsForLessons(live.map((l) => l.id));
  const visible = [];
  live.forEach((l) => {
    const access = accessFor(l, rowsByLesson.get(l.id), studentId);
    if (!access) return;
    const row = studentLesson(l, access, prog.get(l.id), now);
    row.targeted = !access.wholeClass;
    visible.push(row);
  });
  const sections = {
    continue: visible.filter((x) => x.section === 'continue'),
    today: visible.filter((x) => x.section === 'today'),
    upcoming: visible.filter((x) => x.section === 'upcoming'),
    done: visible.filter((x) => x.section === 'done')
  };
  const ordered = visible.slice().sort(compareForTodo);
  return {
    available: stream.isConfigured(),
    lessons: visible,
    sections,
    toWatch: ordered.filter((x) => !x.completed),
    watched: ordered.filter((x) => x.completed),
    summary: {
      assigned: visible.length,
      completed: sections.done.length,
      overdue: visible.filter((x) => x.overdue).length,
      watchedSeconds: visible.reduce((n, x) => n + (x.watchedSeconds || 0), 0)
    }
  };
}

async function loadStudentLesson(lessonId, classId, studentId) {
  const l = await loadLesson(lessonId);
  if (!l || String(l.classId) !== String(classId) || !l.published || l.status !== 'ready') {
    throw httpError(404, 'Lesson not found.');
  }
  const access = accessFor(l, await loadAssignments(l.id), studentId);
  if (!access) throw httpError(403, '이 강의는 배정되지 않았습니다.');
  if (isLocked(access, Date.now())) {
    throw httpError(403, '아직 열리지 않은 강의입니다. 예정일을 기다려 주세요.');
  }
  return { lesson: l, access };
}

async function playbackForStudent(lessonId, student) {
  const { lesson: l, access } = await loadStudentLesson(lessonId, student.classId, student.studentId);
  const token = await stream.signPlaybackToken(l.videoUid);
  const prog = (await loadProgressForStudent(student.classId, student.studentId)).get(l.id);
  return {
    lesson: studentLesson(l, access, prog),
    playerUrl: stream.playerUrl(token),
    expiresInSeconds: stream.TOKEN_TTL_SECONDS
  };
}

function toInt(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

/** Validate the played stretches a player reports: [[fromSeconds, toSeconds, rate], ...]. */
function parseRanges(raw, cap) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.slice(0, MAX_RANGES_PER_REPORT).forEach((r) => {
    if (!Array.isArray(r)) return;
    const from = Math.max(0, Number(r[0]));
    const to = Math.min(cap, Number(r[1]));
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return;
    let rate = Number(r[2]);
    if (!Number.isFinite(rate) || rate <= 0) rate = 1;
    out.push({ from, to, rate: Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) });
  });
  return out;
}

/**
 * Fold played stretches into the coverage map (one character per second of video).
 * A second counts once at least half of it was played, so tapping through the
 * timeline does not fill it in.
 */
function applyRanges(coverage, ranges, wallBudget, limit) {
  const bits = String(coverage || '').split('');
  let played = 0;
  let wall = 0;
  for (const r of ranges) {
    let len = r.to - r.from;
    let w = len / r.rate;
    if (wall + w > wallBudget) {
      w = Math.max(0, wallBudget - wall);
      len = w * r.rate;
    }
    if (!(len > 0)) break;
    played += len;
    wall += w;
    const end = Math.min(limit, Math.round(r.from + len));
    for (let i = Math.round(r.from); i < end; i += 1) bits[i] = '1';
  }
  let covered = 0;
  let text = '';
  const n = Math.min(bits.length, limit);
  for (let i = 0; i < n; i += 1) {
    const on = bits[i] === '1';
    if (on) covered += 1;
    text += on ? '1' : '0';
  }
  return { coverage: text, covered, played, wall };
}

/** Next progress row from the previous one plus one report from the player. */
function nextProgress(prev, l, student, body, idleSeconds, now) {
  const dur = l.durationSeconds || toInt(body.duration, MAX_COVERAGE_SECONDS) || null;
  const limit = dur ? Math.max(1, Math.floor(dur)) : MAX_COVERAGE_SECONDS;
  const cap = dur ? dur + 1 : MAX_COVERAGE_SECONDS;
  const position = Math.min(toInt(body.position, cap), Math.floor(cap));

  const credit = Math.min(
    WALL_CREDIT_MAX,
    (prev && prev.wallCredit != null ? prev.wallCredit : WALL_CREDIT_START) + Math.max(0, idleSeconds || 0)
  );
  const ranges = parseRanges(body.ranges, cap);
  const r = applyRanges(prev ? prev.coverage : '', ranges, credit, limit);

  const watched = Math.max(prev ? prev.watchedSeconds : 0, r.covered);
  const coveredEnough = !!dur && r.covered / limit >= COMPLETE_RATIO;
  const pctNow = dur ? Math.min(100, Math.floor((r.covered / limit) * 100)) : 0;
  const rateRaw = Number(body.playbackRate);

  let completedAt = prev ? prev.completedAt : null;
  let completedManually = prev ? !!prev.completedManually : false;
  if (coveredEnough) {
    if (!completedAt) completedAt = now;
    completedManually = false;
  } else if (!completedAt && body.manualDone === true) {
    // Only offered when the player could not report play time at all.
    completedAt = now;
    completedManually = true;
  }

  return {
    lessonId: l.id,
    studentId: String(student.studentId),
    studentName: String(student.studentName || (prev && prev.studentName) || ''),
    classId: String(student.classId),
    lastPosition: body.ended === true ? 0 : position,
    watchedSeconds: watched,
    durationSeconds: dur,
    viewCount: (prev ? (prev.viewCount || 0) : 0) + (body.viewStart === true ? 1 : 0),
    lastPlaybackRate: Number.isFinite(rateRaw) && rateRaw > 0 && rateRaw <= 4
      ? rateRaw
      : ((prev && prev.lastPlaybackRate) || 1),
    maxPercent: Math.max(prev ? (prev.maxPercent || 0) : 0, pctNow),
    playedSeconds: (prev ? prev.playedSeconds : 0) + r.played,
    playedWallSeconds: (prev ? prev.playedWallSeconds : 0) + r.wall,
    coverage: r.coverage,
    wallCredit: Math.max(0, credit - r.wall),
    completedManually,
    completedAt,
    updatedAt: now
  };
}

async function saveProgress(lessonId, student, body) {
  const { lesson: l, access } = await loadStudentLesson(lessonId, student.classId, student.studentId);
  body = body || {};
  const sid = String(student.studentId);
  const now = Date.now();
  let p;

  if (isOpsDbEnabled()) {
    const t = table('lms_progress');
    p = await withTransaction(async (client) => {
      await client.query(
        'INSERT INTO ' + t + ' (lesson_id, student_id, student_name, class_id) VALUES ($1,$2,$3,$4) ' +
          'ON CONFLICT (lesson_id, student_id) DO NOTHING',
        [l.id, sid, String(student.studentName || ''), String(student.classId)]
      );
      // Lock the row so two reports from the same student cannot overwrite each other.
      const cur = await client.query(
        'SELECT *, EXTRACT(EPOCH FROM (now() - updated_at)) AS idle_seconds FROM ' + t +
          ' WHERE lesson_id = $1 AND student_id = $2 FOR UPDATE',
        [l.id, sid]
      );
      const prev = rowToProgress(cur.rows[0]);
      const next = nextProgress(prev, l, student, body, Number(cur.rows[0].idle_seconds), now);
      await client.query(
        'UPDATE ' + t + ' SET student_name = $3, last_position = $4, watched_seconds = $5, ' +
          'duration_seconds = $6, view_count = $7, last_playback_rate = $8, max_percent = $9, ' +
          'played_seconds = $10, played_wall_seconds = $11, coverage = $12, completed_manually = $13, ' +
          'completed_at = ' + tsParam(14) + ', wall_credit = $15, updated_at = now() ' +
          'WHERE lesson_id = $1 AND student_id = $2',
        [
          l.id, sid, next.studentName, next.lastPosition, next.watchedSeconds, next.durationSeconds,
          next.viewCount, next.lastPlaybackRate, next.maxPercent, next.playedSeconds,
          next.playedWallSeconds, next.coverage, next.completedManually, next.completedAt,
          next.wallCredit
        ]
      );
      return next;
    });
  } else {
    if (!progressByLesson.has(l.id)) progressByLesson.set(l.id, new Map());
    const prev = progressByLesson.get(l.id).get(sid) || null;
    p = nextProgress(prev, l, student, body, prev ? (now - prev.updatedAt) / 1000 : 0, now);
    progressByLesson.get(l.id).set(sid, p);
  }
  return studentLesson(l, access, p, now);
}

module.exports = {
  isConfigured,
  applyLibraryRetarget,
  listForStaff,
  createLesson,
  assignFromLibrary,
  assignVideos,
  unassignVideos,
  setStudentDue,
  getClassSettings,
  updateClassSettings,
  setLessonStudents,
  loadLessonStudentIds,
  studentCanAccessLesson,
  getForStaff,
  getRaw,
  updateLesson,
  reorder,
  deleteLesson,
  progressForStaff,
  listForStudent,
  playbackForStudent,
  saveProgress,
  overviewForClass,
  parseScheduleMs,
  fmtDuration
};
