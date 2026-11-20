'use strict';

/**
 * Central LMS video library (curriculum catalog).
 * Teachers upload once here; class pages assign copies to students.
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table } = require('../db/pool');
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
      'duration_seconds, created_by, created_at, updated_at' +
    ') VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12/1000.0),to_timestamp($13/1000.0)) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
      'title = EXCLUDED.title, description = EXCLUDED.description, category = EXCLUDED.category, ' +
      'curriculum = EXCLUDED.curriculum, video_uid = EXCLUDED.video_uid, status = EXCLUDED.status, ' +
      'status_message = EXCLUDED.status_message, duration_seconds = EXCLUDED.duration_seconds, ' +
      'updated_at = EXCLUDED.updated_at',
    [
      v.id, v.title, v.description || '', v.category || '', v.curriculum || '',
      v.provider || 'cloudflare', v.videoUid || '', v.status, v.statusMessage || '',
      v.durationSeconds, v.createdBy || '', v.createdAt, v.updatedAt
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
  if (!v || !v.videoUid || (v.status !== 'uploading' && v.status !== 'processing')) return v;
  if (!stream.isConfigured()) return v;
  let info;
  try {
    info = await stream.getVideo(v.videoUid);
  } catch (e) {
    return v;
  }
  const changed = info.state !== v.status ||
    (info.duration && info.duration !== v.durationSeconds) ||
    (info.message || '') !== (v.statusMessage || '');
  if (!changed) return v;
  v.status = info.state;
  v.statusMessage = info.message || '';
  if (info.duration) v.durationSeconds = info.duration;
  v.updatedAt = Date.now();
  videos.set(v.id, v);
  await persist(v);
  return v;
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
  const uploadLength = Math.floor(Number(body && body.uploadLength));
  const useTus = Number.isFinite(uploadLength) && uploadLength > POST_UPLOAD_MAX_BYTES;

  let upload;
  if (useTus) {
    upload = await stream.createTusUpload({
      name: title,
      creator: teacherId,
      uploadLength
    });
  } else {
    upload = await stream.createDirectUpload({ name: title, creator: teacherId });
  }

  const now = Date.now();
  const video = {
    id: newId(),
    title,
    description,
    category,
    curriculum,
    provider: 'cloudflare',
    videoUid: upload.uid || '',
    status: 'uploading',
    statusMessage: '',
    durationSeconds: null,
    createdBy: String(teacherId || ''),
    createdAt: now,
    updatedAt: now
  };
  // TUS Location sometimes embeds uid; if empty, poll by listing later is hard — require uid.
  if (!video.videoUid && upload.mode === 'tus') {
    // Some Stream accounts return stream media id in stream-media host path.
    const m = String(upload.uploadURL || '').match(/\/([a-f0-9]{32})\b/i);
    if (m) video.videoUid = m[1];
  }
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

async function deleteVideo(id) {
  const v = await loadById(id);
  if (!v) throw httpError(404, 'Video not found.');

  // Block delete if still assigned to classes.
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT COUNT(*)::int AS n FROM ' + table('lms_lessons') + ' WHERE library_video_id = $1',
      [v.id]
    );
    if ((r.rows[0] && r.rows[0].n) > 0) {
      throw httpError(409, '이 영상이 클래스에 배정되어 있습니다. 클래스 배정을 먼저 해제하세요.');
    }
  }

  if (v.videoUid && stream.isConfigured()) {
    try {
      await stream.deleteVideo(v.videoUid);
    } catch (e) {
      throw httpError(502, '영상 삭제에 실패했습니다: ' + e.message);
    }
  }
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('lms_library_videos') + ' WHERE id = $1', [v.id]);
  }
  videos.delete(v.id);
  return { ok: true, id: v.id };
}

async function getRaw(id) {
  return loadById(id);
}

module.exports = {
  isConfigured,
  listVideos,
  createUpload,
  updateVideo,
  deleteVideo,
  getRaw,
  syncVideo,
  publicVideo,
  POST_UPLOAD_MAX_BYTES
};
