'use strict';

/**
 * Cloudflare Stream client for LMS video lessons (Phase 5).
 *
 * Videos are uploaded straight from the teacher's browser to Cloudflare
 * (direct creator upload) so large files never pass through Railway.
 * Every video requires a signed token, so only students of the lesson's
 * class (checked by our API) can obtain a playable URL.
 */

const API_BASE = () => String(process.env.CLOUDFLARE_STREAM_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MAX_UPLOAD_DURATION_SECONDS = 4 * 60 * 60;

function accountId() {
  return String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
}

function apiToken() {
  return String(process.env.CLOUDFLARE_STREAM_API_TOKEN || '').trim();
}

function isConfigured() {
  return !!(accountId() && apiToken());
}

function allowedOrigins() {
  const raw = process.env.LMS_ALLOWED_ORIGINS;
  const list = (raw == null ? 'www.saltmorning.study,saltmorning.study' : raw)
    .split(',').map((s) => s.trim()).filter(Boolean);
  return list;
}

function stageError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

async function cf(method, path, body) {
  if (!isConfigured()) {
    throw stageError(503, '영상 서비스(Cloudflare Stream)가 아직 설정되지 않았습니다.');
  }
  const url = API_BASE() + '/accounts/' + encodeURIComponent(accountId()) + '/stream' + path;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + apiToken(),
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    throw stageError(502, '영상 서비스에 연결하지 못했습니다.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok || (data && data.success === false)) {
    const first = data && data.errors && data.errors[0];
    const e = stageError(res.status === 404 ? 404 : 502,
      (first && first.message) || ('영상 서비스 오류 (HTTP ' + res.status + ')'));
    e.cfStatus = res.status;
    throw e;
  }
  return data && data.result;
}

async function createDirectUpload({ name, creator }) {
  const body = {
    maxDurationSeconds: MAX_UPLOAD_DURATION_SECONDS,
    requireSignedURLs: true,
    meta: { name: String(name || 'Lesson').slice(0, 120) }
  };
  if (creator) body.creator = String(creator).slice(0, 64);
  const origins = allowedOrigins();
  if (origins.length) body.allowedOrigins = origins;
  const r = await cf('POST', '/direct_upload', body);
  if (!r || !r.uid || !r.uploadURL) throw stageError(502, '업로드 URL을 받지 못했습니다.');
  return { uid: r.uid, uploadURL: r.uploadURL };
}

/** Normalised view of a Cloudflare video: state is uploading | processing | ready | error. */
async function getVideo(uid) {
  const v = await cf('GET', '/' + encodeURIComponent(uid));
  const st = (v && v.status && v.status.state) || '';
  let state = 'processing';
  if (v && v.readyToStream) state = 'ready';
  else if (st === 'error') state = 'error';
  else if (st === 'pendingupload') state = 'uploading';
  const duration = v && Number(v.duration) > 0 ? Math.round(Number(v.duration)) : null;
  return {
    state,
    duration,
    message: state === 'error'
      ? String((v.status && (v.status.errorReasonText || v.status.errorReasonCode)) || '영상 처리에 실패했습니다.')
      : ''
  };
}

async function deleteVideo(uid) {
  try {
    await cf('DELETE', '/' + encodeURIComponent(uid));
  } catch (e) {
    if (e.cfStatus === 404 || e.statusCode === 404) return;
    throw e;
  }
}

async function signPlaybackToken(uid) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const r = await cf('POST', '/' + encodeURIComponent(uid) + '/token', { exp });
  if (!r || !r.token) throw stageError(502, '재생 토큰을 만들지 못했습니다.');
  return r.token;
}

function playerUrl(token) {
  const code = String(process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || '').trim();
  const host = code ? 'customer-' + code + '.cloudflarestream.com' : 'iframe.videodelivery.net';
  const base = String(process.env.CLOUDFLARE_STREAM_PLAYER_BASE || '').replace(/\/+$/, '');
  return (base || 'https://' + host) + '/' + token;
}

module.exports = {
  isConfigured,
  createDirectUpload,
  getVideo,
  deleteVideo,
  signPlaybackToken,
  playerUrl,
  TOKEN_TTL_SECONDS
};
