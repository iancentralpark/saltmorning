'use strict';

/**
 * Central LMS video library (curriculum catalog).
 * Teachers upload once here; class pages assign copies to students.
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table, withTransaction } = require('../db/pool');
const stream = require('./lmsStreamService');

const MAX_TITLE = 160;
const MAX_DESCRIPTION = 2000;
const MAX_TAG = 80;
const POST_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;

/** @type {Map<string, object>} */
const videos = new Map();

function httpError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

function newId() {
  return 'lib_' + crypto.randomBytes(6).toString('hex');
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function rowToVideo(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    category: r.category || '',
    curriculum: r.curriculum || '',
    provider: r.provider || 'cloudflare',
    videoUid: r.video_uid || '',
    status: r.status,
    statusMessage: r.status_message || '',
    replaceVideoUid: r.replace_video_uid || '',
    replaceStatus: r.replace_status || '',
    replaceStatusMessage: r.replace_status_message || '',
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    createdBy: r.created_by || '',
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
  };
}

function publicVideo(v) {
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    category: v.category,
    curriculum: v.curriculum,
    status: v.status,
    statusMessage: v.statusMessage,
    replaceStatus: v.replaceStatus || '',
    replaceStatusMessage: v.replaceStatusMessage || '',
    durationSeconds: v.durationSeconds,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt
  };
}

async function persist(v) {
  if (!isOpsDbEnabled()) return;
  await query(
    'INSERT INTO ' + table('lms_library_videos') + ' (' +
      'id, title, description, category, curriculum, provider, video_uid, status, status_message, ' +
      'duration_seconds, replace_video_uid, replace_status, replace_status_message, ' +
      'created_by, created_at, updated_at' +
    ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,to_timestamp($15/1000.0),to_timestamp($16/1000.0)) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
      'title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, ' +
      'curriculum = EXCLUDED.curriculum, video_uid = EXCLUDED.video_uid, status = EXCLUDED.status, ' +
      'status_message = EXCLUDED.status_message, duration_seconds = EXCLUDED.duration_seconds, ' +
      'replace_video_uid = EXCLUDED.replace_video_uid, replace_status = EXCLUDED.replace_status, ' +
      'replace_status_message = EXCLUDED.replace_status_message, updated_at = EXCLUDED.updated_at',
    [
      v.id, v.title, v.description || '', v.category || '', v.curriculum || '',
      v.provider || 'cloudflare', v.videoUid || '', v.status, v.statusMessage || '',
      v.durationSeconds, v.replaceVideoUid || '', v.replaceStatus || '', v.replaceStatusMessage || '',
      v.createdBy || '', v.createdAt, v.updatedAt
    ]
  );
}

async function loadById(id) {
  id = String(id || '');
  if (!id) return null;
  if (isOpsDbEnabled()) {
    const r = await query('SELECT * FROM ' + table('lms_library_videos') + ' WHERE id = $1 LIMIT 1', [id]);
    return r.rows[0] ? rowToVideo(r.rows[0]) : null;
  }
  return videos.get(id) || null;
}

async function syncVideo(v) {
  if (!v) return v;
  if (v.videoUid && (v.status === 'uploading' || v.status === 'processing') && stream.isConfigured()) {
    let info;
    try {
      info = await stream.getVideo(v.videoUid);
    } catch (e) {
      info = null;
    }
    if (info) {
      const changed = info.state !== v.status ||
        (info.duration && info.duration !== v.durationSeconds) ||
        (info.message || '') !== (v.statusMessage || '');
      if (changed) {
        v.status = info.state;
        v.statusMessage = info.message || '';
        if (info.duration) v.durationSeconds = info.duration;
        v.updatedAt = Date.now();
        videos.set(v.id, v);
        await persist(v);
      }
    }
  }
  if (v.replaceVideoUid && (v.replaceStatus === 'uploading' || v.replaceStatus === 'processing')) {
    v = await advanceReplace(v);
  }
  return v;
}

/**
 * Swap the live Cloudflare uid once the replacement asset is ready.
 * Class assignments keep the same lesson id; only video_uid changes.
 */
async function advanceReplace(v) {
  let info;
  try {
    info = await stream.getVideo(v.replaceVideoUid);
  } catch (e) {
    return v;
  }
  if (info.state === 'uploading' || info.state === 'processing') {
    if (info.state !== v.replaceStatus || (info.message || '') !== (v.replaceStatusMessage || '')) {
      v.replaceStatus = info.state;
      v.replaceStatusMessage = info.message || '';
      v.updatedAt = Date.now();
      videos.set(v.id, v);
      await persist(v);
    }
    return v;
  }
  if (info.state === 'error') {
    v.replaceStatus = 'error';
    v.replaceStatusMessage = info.message || '교체 파일 처리에 실패했습니다. 기존 영상이 그대로입니다.';
    v.updatedAt = Date.now();
    videos.set(v.id, v);
    await persist(v);
    return v;
  }
  if (info.state !== 'ready') return v;

  const oldUid = v.videoUid || '';
  const newUid = v.replaceVideoUid;
  const duration = info.duration || v.durationSeconds;
  const now = Date.now();
  if (isOpsDbEnabled()) {
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE ' + table('lms_library_videos') +
          ' SET video_uid = $2, status = $3, status_message = $4, duration_seconds = $5,' +
          ' replace_video_uid = \'\', replace_status = \'\', replace_status_message = \'\',' +
          ' factcheck_json = NULL, factcheck_at = NULL, factcheck_status = NULL,' +
          ' updated_at = to_timestamp($6/1000.0) WHERE id = $1',
        [v.id, newUid, 'ready', '', duration, now]
      );
      await client.query(
        'UPDATE ' + table('lms_lessons') +
          ' SET video_uid = $2, status = \'ready\', status_message = \'\', duration_seconds = $3,' +
          ' updated_at = to_timestamp($4/1000.0)' +
          ' WHERE library_video_id = $1' +
          ' OR ($5 <> \'\' AND COALESCE(library_video_id, \'\') = \'\' AND video_uid = $5)',
        [v.id, newUid, duration, now, oldUid]
      );
    });
  }
  v.videoUid = newUid;
  v.status = 'ready';
  v.statusMessage = '';
  v.durationSeconds = duration;
  v.replaceVideoUid = '';
  v.replaceStatus = '';
  v.replaceStatusMessage = '';
  v.updatedAt = now;
  videos.set(v.id, v);
  try {
    const lessonSvc = require('./lmsLessonService');
    if (typeof lessonSvc.applyLibraryRetarget === 'function') {
      lessonSvc.applyLibraryRetarget({
        id: v.id,
        videoUid: newUid,
        durationSeconds: duration,
        oldVideoUid: oldUid
      });
    }
  } catch (e) {
    console.warn('library retarget memory', v.id, e.message);
  }
  if (oldUid && oldUid !== newUid && stream.isConfigured()) {
    try {
      await stream.deleteVideo(oldUid);
    } catch (e) {
      console.warn('old stream delete failed', v.id, e.message);
    }
  }
  return v;
}

function readUploadLength(body) {
  const uploadLength = Math.floor(Number(body && body.uploadLength));
  return Number.isFinite(uploadLength) ? uploadLength : 0;
}

async function openUpload(title, teacherId, uploadLength) {
  const useTus = uploadLength > POST_UPLOAD_MAX_BYTES;
  if (useTus) {
    return stream.createTusUpload({ name: title, creator: teacherId, uploadLength });
  }
  return stream.createDirectUpload({ name: title, creator: teacherId });
}

function uidFromUpload(upload) {
  if (upload && upload.uid) return upload.uid;
  const m = String((upload && upload.uploadURL) || '').match(/\/([a-f0-9]{32})\b/i);
  return m ? m[1] : '';
}

function isConfigured() {
  return stream.isConfigured();
}

async function listVideos(filters) {
  filters = filters || {};
  let list;
  if (isOpsDbEnabled()) {
    const params = [];
    const where = [];
    if (filters.category) {
      params.push(String(filters.category));
      where.push('category = $' + params.length);
    }
    if (filters.curriculum) {
      params.push(String(filters.curriculum));
      where.push('curriculum = $' + params.length);
    }
    if (filters.q) {
      params.push('%' + String(filters.q).trim().toLowerCase() + '%');
      where.push('(LOWER(title) LIKE $' + params.length + ' OR LOWER(description) LIKE $' + params.length + ')');
    }
    const sql = 'SELECT * FROM ' + table('lms_library_videos') +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY category ASC, curriculum ASC, created_at DESC';
    const r = await query(sql, params);
    list = r.rows.map(rowToVideo);
  } else {
    list = Array.from(videos.values()).sort((a, b) =>
      String(a.category).localeCompare(String(b.category)) ||
      String(a.curriculum).localeCompare(String(b.curriculum)) ||
      b.createdAt - a.createdAt
    );
  }
  await Promise.all(list.map((v) => syncVideo(v)));
  return {
    configured: stream.isConfigured(),
    videos: list.map(publicVideo)
  };
}

async function createUpload(body, teacherId) {
  const title = clean(body && body.title, MAX_TITLE);
  if (!title) throw httpError(400, '영상 제목을 입력하세요.');
  const description = clean(body && body.description, MAX_DESCRIPTION);
  const category = clean(body && body.category, MAX_TAG) || 'General';
  const curriculum = clean(body && body.curriculum, MAX_TAG);
  const uploadLength = readUploadLength(body);
  const upload = await openUpload(title, teacherId, uploadLength);

  const now = Date.now();
  const video = {
    id: newId(),
    title,
    description,
    category,
    curriculum,
    provider: 'cloudflare',
    videoUid: uidFromUpload(upload),
    status: 'uploading',
    statusMessage: '',
    replaceVideoUid: '',
    replaceStatus: '',
    replaceStatusMessage: '',
    durationSeconds: null,
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
  videos.set(video.id, video);
  await persist(video);
  return {
    video: publicVideo(video),
    uploadURL: upload.uploadURL,
    mode: upload.mode || 'post',
    postMaxBytes: POST_UPLOAD_MAX_BYTES
  };
}

async function updateVideo(id, patch) {
  const v = await loadById(id);
  if (!v) throw httpError(404, 'Video not found.');
  patch = patch || {};
  if (patch.title != null) {
    const t = clean(patch.title, MAX_TITLE);
    if (!t) throw httpError(400, '영상 제목을 입력하세요.');
    v.title = t;
  }
  if (patch.description != null) v.description = clean(patch.description, MAX_DESCRIPTION);
  if (patch.category != null) v.category = clean(patch.category, MAX_TAG) || 'General';
  if (patch.curriculum != null) v.curriculum = clean(patch.curriculum, MAX_TAG);
  v.updatedAt = Date.now();
  videos.set(v.id, v);
  await persist(v);
  return publicVideo(await syncVideo(v));
}

/**
 * Upload a new file onto an existing library video.
 * Assignments stay. The previous file keeps playing until the new one is ready.
 */
async function startReplace(id, body, teacherId) {
  if (!stream.isConfigured()) throw httpError(503, 'Cloudflare Stream이 설정되지 않았습니다.');
  let v = await loadById(id);
  if (!v) throw httpError(404, 'Video not found.');
  if (!v.videoUid) throw httpError(409, '아직 연결된 영상이 없습니다. 새로 업로드하세요.');
  v = await syncVideo(v);
  if (v.replaceVideoUid) {
    try { await stream.deleteVideo(v.replaceVideoUid); } catch (_) { /* unfinished upload */ }
    v.replaceVideoUid = '';
    v.replaceStatus = '';
    v.replaceStatusMessage = '';
  }
  const uploadLength = readUploadLength(body);
  const upload = await openUpload(v.title, teacherId, uploadLength);
  const uid = uidFromUpload(upload);
  if (!uid) throw httpError(502, '교체 업로드 주소를 받지 못했습니다.');
  v.replaceVideoUid = uid;
  v.replaceStatus = 'uploading';
  v.replaceStatusMessage = '';
  v.updatedAt = Date.now();
  videos.set(v.id, v);
  await persist(v);
  return {
    video: publicVideo(v),
    uploadURL: upload.uploadURL,
    mode: upload.mode || 'post',
    postMaxBytes: POST_UPLOAD_MAX_BYTES
  };
}

/** Drop an unfinished replacement. The live video and assignments stay. */
async function cancelReplace(id) {
  let v = await loadById(id);
  if (!v) throw httpError(404, 'Video not found.');
  v = await syncVideo(v);
  if (!v.replaceVideoUid) return publicVideo(v);
  if (stream.isConfigured()) {
    try { await stream.deleteVideo(v.replaceVideoUid); } catch (_) { /* already gone */ }
  }
  v.replaceVideoUid = '';
  v.replaceStatus = '';
  v.replaceStatusMessage = '';
  v.updatedAt = Date.now();
  videos.set(v.id, v);
  await persist(v);
  return publicVideo(v);
}

async function deleteVideo(id) {
  const v = await loadById(id);
  if (!v) throw httpError(404, 'Video not found.');

  // Cascade: drop every class copy that points at this library video (progress rows
  // cascade in Postgres). Library-backed lesson delete does not touch Cloudflare —
  // we remove the Stream object once below.
  let unlinkedClasses = 0;
  if (isOpsDbEnabled()) {
    const linked = await query(
      'SELECT id FROM ' + table('lms_lessons') + ' WHERE library_video_id = $1',
      [v.id]
    );
    if (linked.rows.length) {
      const lessonSvc = require('./lmsLessonService');
      for (const row of linked.rows) {
        await lessonSvc.deleteLesson(row.id);
        unlinkedClasses += 1;
      }
    }
  }

  if (stream.isConfigured()) {
    if (v.replaceVideoUid && v.replaceVideoUid !== v.videoUid) {
      try { await stream.deleteVideo(v.replaceVideoUid); } catch (_) { /* unfinished upload */ }
    }
    if (v.videoUid) {
      try {
        await stream.deleteVideo(v.videoUid);
      } catch (e) {
        throw httpError(502, '영상 삭제에 실패했습니다: ' + e.message);
      }
    }
  }
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('lms_library_videos') + ' WHERE id = $1', [v.id]);
  }
  videos.delete(v.id);
  return { ok: true, id: v.id, unlinkedClasses };
}

async function getRaw(id) {
  return loadById(id);
}

module.exports = {
  isConfigured,
  listVideos,
  createUpload,
  startReplace,
  cancelReplace,
  updateVideo,
  deleteVideo,
  getRaw,
  syncVideo,
  publicVideo,
  POST_UPLOAD_MAX_BYTES
};
