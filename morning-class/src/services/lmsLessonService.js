'use strict';

/**
 * Online LMS video lessons (Phase 5).
 *
 * Teachers/admins create a lesson for a class, upload the video straight to
 * Cloudflare Stream, then publish it. Students only ever see published,
 * ready lessons of their own class and receive a short-lived signed player URL.
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table } = require('../db/pool');
const stream = require('./lmsStreamService');

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 2000;
const COMPLETE_RATIO = 0.9;

/** @type {Map<string, object>} */
const lessons = new Map();
/** @type {Map<string, Map<string, object>>} */
const progressByLesson = new Map();
/** @type {Map<string, string[]|null>} */
const lessonStudents = new Map();

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
    createdBy: r.created_by || '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
  };
}

function rowToProgress(r) {
  return {
    lessonId: r.lesson_id,
    studentId: r.student_id,
    studentName: r.student_name || '',
    classId: r.class_id,
    lastPosition: Number(r.last_position) || 0,
    watchedSeconds: Number(r.watched_seconds) || 0,
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    viewCount: Number(r.view_count) || 0,
    lastPlaybackRate: Number(r.last_playback_rate) || 1,
    maxPercent: Number(r.max_percent) || 0,
    completedAt: r.completed_at ? new Date(r.completed_at).getTime() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
  };
}

async function persistLesson(l) {
  if (!isOpsDbEnabled()) return;
  await query(
    'INSERT INTO ' + table('lms_lessons') + ' (' +
      'id, class_id, library_video_id, title, description, provider, video_uid, status, status_message, ' +
      'duration_seconds, order_index, published, created_by, created_at, updated_at' +
    ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14/1000.0),to_timestamp($15/1000.0)) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
      'library_video_id = EXCLUDED.library_video_id, title = EXCLUDED.title, description = EXCLUDED.description, ' +
      'video_uid = EXCLUDED.video_uid, status = EXCLUDED.status, status_message = EXCLUDED.status_message, ' +
      'duration_seconds = EXCLUDED.duration_seconds, order_index = EXCLUDED.order_index, ' +
      'published = EXCLUDED.published, updated_at = EXCLUDED.updated_at',
    [
      l.id, l.classId, l.libraryVideoId || null, l.title, l.description || '', l.provider || 'cloudflare',
      l.videoUid || '', l.status, l.statusMessage || '', l.durationSeconds, l.orderIndex || 0,
      !!l.published, l.createdBy || '', l.createdAt, l.updatedAt
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
      'SELECT * FROM ' + table('lms_progress') + ' WHERE lesson_id = $1 ORDER BY student_name ASC',
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
      'SELECT * FROM ' + table('lms_progress') + ' WHERE class_id = $1 AND student_id = $2',
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

async function progressCounts(classId) {
  const out = new Map();
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT lesson_id, COUNT(*)::int AS started, COUNT(completed_at)::int AS completed ' +
        'FROM ' + table('lms_progress') + ' WHERE class_id = $1 GROUP BY lesson_id',
      [String(classId)]
    );
    r.rows.forEach((row) => out.set(row.lesson_id, { started: row.started, completed: row.completed }));
    return out;
  }
  progressByLesson.forEach((m, lessonId) => {
    let started = 0;
    let completed = 0;
    m.forEach((p) => {
      if (p.classId !== String(classId)) return;
      started += 1;
      if (p.completedAt) completed += 1;
    });
    if (started) out.set(lessonId, { started, completed });
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

async function loadLessonStudentIds(lessonId) {
  lessonId = String(lessonId || '');
  if (lessonStudents.has(lessonId)) return lessonStudents.get(lessonId);
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT student_id FROM ' + table('lms_lesson_students') + ' WHERE lesson_id = $1 ORDER BY student_id',
      [lessonId]
    );
    const ids = r.rows.map((row) => String(row.student_id));
    const val = ids.length ? ids : null;
    lessonStudents.set(lessonId, val);
    return val;
  }
  return null;
}

async function setLessonStudents(lessonId, studentIds) {
  const l = await loadLesson(lessonId);
  if (!l) throw httpError(404, 'Lesson not found.');
  const ids = normalizeStudentIds(studentIds);
  lessonStudents.set(l.id, ids);
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('lms_lesson_students') + ' WHERE lesson_id = $1', [l.id]);
    if (ids) {
      for (const sid of ids) {
        await query(
          'INSERT INTO ' + table('lms_lesson_students') + ' (lesson_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [l.id, sid]
        );
      }
    }
  }
  const counts = await progressCounts(l.classId);
  const out = staffLesson(l, counts.get(l.id));
  out.studentIds = ids;
  out.targeted = !!(ids && ids.length);
  return out;
}

async function studentCanAccessLesson(lessonId, studentId) {
  const ids = await loadLessonStudentIds(lessonId);
  if (!ids || !ids.length) return true;
  return ids.includes(String(studentId || ''));
}

function staffLesson(l, counts) {
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
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    startedCount: (counts && counts.started) || 0,
    completedCount: (counts && counts.completed) || 0
  };
}

function studentLesson(l, p) {
  const dur = l.durationSeconds || (p && p.durationSeconds) || null;
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    durationSeconds: dur,
    orderIndex: l.orderIndex,
    lastPosition: p ? p.lastPosition : 0,
    percent: p && dur ? Math.min(100, Math.round((p.watchedSeconds / dur) * 100)) : 0,
    completed: !!(p && p.completedAt)
  };
}

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
          video.title !== l.title;
        if (changed) {
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

function isConfigured() {
  return stream.isConfigured();
}

async function listForStaff(classId) {
  const list = await loadClassLessons(classId);
  await Promise.all(list.map((l) => syncLesson(l)));
  const counts = await progressCounts(classId);
  const out = [];
  for (const l of list) {
    const row = staffLesson(l, counts.get(l.id));
    row.studentIds = await loadLessonStudentIds(l.id);
    row.targeted = !!(row.studentIds && row.studentIds.length);
    out.push(row);
  }
  return out;
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
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
  lessons.set(lesson.id, lesson);
  await persistLesson(lesson);
  if (body && body.studentIds) await setLessonStudents(lesson.id, body.studentIds);
  const row = staffLesson(lesson);
  row.studentIds = await loadLessonStudentIds(lesson.id);
  row.targeted = !!(row.studentIds && row.studentIds.length);
  return { lesson: row, uploadURL: upload.uploadURL };
}

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

  // One assignment per class per library video.
  const existing = await loadClassLessons(classId);
  const dup = existing.find((l) => l.libraryVideoId === video.id);
  if (dup) throw httpError(409, '이 영상은 이미 이 클래스에 배정되어 있습니다.');

  const now = Date.now();
  const lesson = {
    id: newId(),
    classId,
    libraryVideoId: video.id,
    title: clean((body && body.title) || video.title, MAX_TITLE) || video.title,
    description: clean((body && body.description) != null ? body.description : video.description, MAX_DESCRIPTION),
    provider: video.provider || 'cloudflare',
    videoUid: video.videoUid,
    status: video.status,
    statusMessage: video.statusMessage || '',
    durationSeconds: video.durationSeconds,
    orderIndex: existing.reduce((m, l) => Math.max(m, l.orderIndex), 0) + 1,
    published: body && body.published === true,
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
  lessons.set(lesson.id, lesson);
  await persistLesson(lesson);
  if (body && body.studentIds) await setLessonStudents(lesson.id, body.studentIds);
  const counts = await progressCounts(classId);
  const row = staffLesson(lesson, counts.get(lesson.id));
  row.studentIds = await loadLessonStudentIds(lesson.id);
  row.targeted = !!(row.studentIds && row.studentIds.length);
  return { lesson: row };
}

async function getForStaff(id) {
  const l = await loadLesson(id);
  if (!l) throw httpError(404, 'Lesson not found.');
  await syncLesson(l);
  const counts = await progressCounts(l.classId);
  return staffLesson(l, counts.get(l.id));
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
  l.updatedAt = Date.now();
  lessons.set(l.id, l);
  await persistLesson(l);
  if (patch.studentIds !== undefined) {
    return setLessonStudents(l.id, patch.studentIds);
  }
  const counts = await progressCounts(l.classId);
  const row = staffLesson(l, counts.get(l.id));
  row.studentIds = await loadLessonStudentIds(l.id);
  row.targeted = !!(row.studentIds && row.studentIds.length);
  return row;
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
      const percent = l.durationSeconds
        ? Math.min(100, Math.round((p.watchedSeconds / l.durationSeconds) * 100))
        : (p.maxPercent || 0);
      return {
        studentId: p.studentId,
        studentName: p.studentName,
        watchedSeconds: p.watchedSeconds,
        percent: Math.max(percent, p.maxPercent || 0),
        maxPercent: Math.max(percent, p.maxPercent || 0),
        viewCount: p.viewCount || 0,
        lastPlaybackRate: p.lastPlaybackRate || 1,
        completed: !!p.completedAt,
        updatedAt: p.updatedAt
      };
    })
  };
}

async function listForStudent(classId, studentId) {
  const [list, prog] = await Promise.all([
    loadClassLessons(classId),
    loadProgressForStudent(classId, studentId)
  ]);
  const visible = [];
  for (const l of list) {
    if (!l.published || l.status !== 'ready') continue;
    const ids = await loadLessonStudentIds(l.id);
    if (ids && ids.length && !ids.includes(String(studentId || ''))) continue;
    const row = studentLesson(l, prog.get(l.id));
    row.targeted = !!(ids && ids.length);
    visible.push(row);
  }
  return {
    available: stream.isConfigured(),
    lessons: visible
  };
}

async function loadStudentLesson(lessonId, classId, studentId) {
  const l = await loadLesson(lessonId);
  if (!l || String(l.classId) !== String(classId) || !l.published || l.status !== 'ready') {
    throw httpError(404, 'Lesson not found.');
  }
  if (studentId != null && !(await studentCanAccessLesson(lessonId, studentId))) {
    throw httpError(403, '이 강의는 배정되지 않았습니다.');
  }
  return l;
}

async function playbackForStudent(lessonId, student) {
  const l = await loadStudentLesson(lessonId, student.classId, student.studentId);
  const token = await stream.signPlaybackToken(l.videoUid);
  const prog = (await loadProgressForStudent(student.classId, student.studentId)).get(l.id);
  return {
    lesson: studentLesson(l, prog),
    playerUrl: stream.playerUrl(token),
    expiresInSeconds: stream.TOKEN_TTL_SECONDS
  };
}

function toInt(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

async function saveProgress(lessonId, student, body) {
  const l = await loadStudentLesson(lessonId, student.classId, student.studentId);
  body = body || {};
  const dur = l.durationSeconds || toInt(body.duration, 24 * 3600) || null;
  const cap = dur || 24 * 3600;
  const position = Math.min(toInt(body.position, cap), cap);

  const prevMap = await loadProgressForStudent(student.classId, student.studentId);
  const prev = prevMap.get(l.id);
  const watched = Math.max(prev ? prev.watchedSeconds : 0, position);
  const reachedEnd = body.ended === true || (dur && watched / dur >= COMPLETE_RATIO);
  const completedAt = (prev && prev.completedAt) || (reachedEnd ? Date.now() : null);
  const rateRaw = Number(body.playbackRate);
  const playbackRate = Number.isFinite(rateRaw) && rateRaw > 0 && rateRaw <= 4 ? rateRaw : (prev && prev.lastPlaybackRate) || 1;
  const pctNow = dur ? Math.min(100, Math.round((watched / dur) * 100)) : 0;
  const maxPercent = Math.max(prev ? (prev.maxPercent || 0) : 0, pctNow, body.ended === true ? 100 : 0);
  const bumpView = body.viewStart === true;
  const viewCount = (prev ? (prev.viewCount || 0) : 0) + (bumpView ? 1 : 0);

  const p = {
    lessonId: l.id,
    studentId: String(student.studentId),
    studentName: String(student.studentName || (prev && prev.studentName) || ''),
    classId: String(student.classId),
    lastPosition: body.ended === true ? 0 : position,
    watchedSeconds: body.ended === true && dur ? Math.max(watched, dur) : watched,
    durationSeconds: dur,
    viewCount,
    lastPlaybackRate: playbackRate,
    maxPercent,
    completedAt,
    updatedAt: Date.now()
  };

  if (isOpsDbEnabled()) {
    await query(
      'INSERT INTO ' + table('lms_progress') + ' (' +
        'lesson_id, student_id, student_name, class_id, last_position, watched_seconds, ' +
        'duration_seconds, view_count, last_playback_rate, max_percent, completed_at, updated_at' +
      ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,' +
        'CASE WHEN $11::bigint IS NULL THEN NULL ELSE to_timestamp($11::bigint/1000.0) END, now()) ' +
      'ON CONFLICT (lesson_id, student_id) DO UPDATE SET ' +
        'student_name = EXCLUDED.student_name, last_position = EXCLUDED.last_position, ' +
        'watched_seconds = GREATEST(' + table('lms_progress') + '.watched_seconds, EXCLUDED.watched_seconds), ' +
        'duration_seconds = EXCLUDED.duration_seconds, ' +
        'view_count = GREATEST(' + table('lms_progress') + '.view_count, EXCLUDED.view_count), ' +
        'last_playback_rate = EXCLUDED.last_playback_rate, ' +
        'max_percent = GREATEST(' + table('lms_progress') + '.max_percent, EXCLUDED.max_percent), ' +
        'completed_at = COALESCE(' + table('lms_progress') + '.completed_at, EXCLUDED.completed_at), ' +
        'updated_at = now()',
      [
        p.lessonId, p.studentId, p.studentName, p.classId, p.lastPosition, p.watchedSeconds,
        p.durationSeconds, p.viewCount, p.lastPlaybackRate, p.maxPercent, p.completedAt
      ]
    );
  } else {
    if (!progressByLesson.has(l.id)) progressByLesson.set(l.id, new Map());
    progressByLesson.get(l.id).set(p.studentId, p);
  }
  return studentLesson(l, p);
}

module.exports = {
  isConfigured,
  listForStaff,
  createLesson,
  assignFromLibrary,
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
  saveProgress
};
