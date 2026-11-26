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
  return { uid: r.uid, uploadURL: r.uploadURL, mode: 'post' };
}

/**
 * TUS direct upload for files over 200MB (Cloudflare basic POST is capped at 200MB).
 * Client must upload with tus-js-client to the returned uploadURL.
 * @param {{ name?: string, creator?: string, uploadLength: number }} opts
 */
async function createTusUpload({ name, creator, uploadLength }) {
  if (!isConfigured()) {
    throw stageError(503, '영상 서비스(Cloudflare Stream)가 아직 설정되지 않았습니다.');
  }
  const length = Math.floor(Number(uploadLength));
  if (!Number.isFinite(length) || length <= 0) {
    throw stageError(400, 'uploadLength (bytes) is required for large uploads.');
  }
  // Cloudflare Stream max object size is 30GB.
  if (length > 30 * 1024 * 1024 * 1024) {
    throw stageError(400, '영상은 최대 30GB까지 업로드할 수 있습니다.');
  }

  function b64(s) {
    return Buffer.from(String(s), 'utf8').toString('base64');
  }
  const metaParts = [
    'name ' + b64(String(name || 'Lesson').slice(0, 120)),
    'requiresignedurls'
  ];
  if (creator) metaParts.push('creator ' + b64(String(creator).slice(0, 64)));
  const origins = allowedOrigins();
  // allowedOrigins is set after upload via API if needed; TUS metadata is limited.

  const url = API_BASE() + '/accounts/' + encodeURIComponent(accountId()) +
    '/stream?direct_user=true';
  const headers = {
    Authorization: 'Bearer ' + apiToken(),
    'Tus-Resumable': '1.0.0',
    'Upload-Length': String(length),
    'Upload-Metadata': metaParts.join(',')
  };
  if (creator) headers['Upload-Creator'] = String(creator).slice(0, 64);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    throw stageError(502, '영상 서비스에 연결하지 못했습니다.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) { /* ignore */ }
    throw stageError(502, 'TUS 업로드 URL을 받지 못했습니다. (HTTP ' + res.status + ') ' + String(detail).slice(0, 180));
  }
  const location = res.headers.get('Location') || res.headers.get('location');
  // Stream returns stream-media.video… Location; uid is last path segment before query.
  const uidMatch = String(location || '').match(/\/([a-f0-9]{32})/i) ||
    String(location || '').match(/\/([A-Za-z0-9_-]{16,})(?:\?|$)/);
  const uid = uidMatch ? uidMatch[1] : '';
  if (!location) throw stageError(502, 'TUS Location 헤더가 없습니다.');
  return { uid, uploadURL: location, mode: 'tus', uploadLength: length, allowedOrigins: origins };
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

async function signPlaybackToken(uid, opts) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const body = { exp };
  if (opts && opts.downloadable) body.downloadable = true;
  const r = await cf('POST', '/' + encodeURIComponent(uid) + '/token', body);
  if (!r || !r.token) throw stageError(502, '재생 토큰을 만들지 못했습니다.');
  return r.token;
}

function customerHost() {
  const code = String(process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || '').trim();
  return code ? 'customer-' + code + '.cloudflarestream.com' : 'iframe.videodelivery.net';
}

function playerUrl(token) {
  const base = String(process.env.CLOUDFLARE_STREAM_PLAYER_BASE || '').replace(/\/+$/, '');
  return (base || 'https://' + customerHost()) + '/' + token;
}

/**
 * Enable / poll Cloudflare Stream MP4 or audio download.
 * @param {string} uid
 * @param {'default'|'audio'} downloadType
 */
async function getDownloads(uid) {
  return cf('GET', '/' + encodeURIComponent(uid) + '/downloads');
}

async function createDownload(uid, downloadType) {
  const type = downloadType === 'audio' ? 'audio' : 'default';
  // Prefer typed endpoint; fall back to generic /downloads (creates default).
  try {
    return await cf('POST', '/' + encodeURIComponent(uid) + '/downloads/' + type);
  } catch (e) {
    if (type === 'default') {
      return cf('POST', '/' + encodeURIComponent(uid) + '/downloads');
    }
    throw e;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure a downloadable asset is ready and return a signed absolute URL.
 * @returns {Promise<{ type: string, url: string, mimeType: string }>}
 */
async function ensureSignedDownload(uid, downloadType) {
  const type = downloadType === 'audio' ? 'audio' : 'default';
  let info = null;
  try {
    info = await getDownloads(uid);
  } catch (e) {
    info = null;
  }
  const slot = info && info[type];
  if (!slot || slot.status === 'error' || !slot.url) {
    await createDownload(uid, type);
  }

  const deadline = Date.now() + 8 * 60 * 1000;
  let ready = null;
  while (Date.now() < deadline) {
    const cur = await getDownloads(uid);
    ready = cur && cur[type];
    if (ready && ready.status === 'ready' && ready.url) break;
    if (ready && ready.status === 'error') {
      throw stageError(502, 'Cloudflare 다운로드 생성에 실패했습니다.');
    }
    await sleep(2500);
  }
  if (!ready || ready.status !== 'ready' || !ready.url) {
    throw stageError(504, '다운로드 파일이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
  }

  const token = await signPlaybackToken(uid, { downloadable: true });
  // Replace uid path segment with signed token for private videos.
  let url = String(ready.url);
  if (url.includes('/' + uid + '/')) {
    url = url.replace('/' + uid + '/', '/' + token + '/');
  } else {
    // Fallback: customer host + token path
    const file = type === 'audio' ? 'audio.m4a' : 'default.mp4';
    url = 'https://' + customerHost() + '/' + token + '/downloads/' + file;
  }
  return {
    type,
    url,
    mimeType: type === 'audio' ? 'audio/mp4' : 'video/mp4'
  };
}

module.exports = {
  isConfigured,
  createDirectUpload,
  createTusUpload,
  getVideo,
  deleteVideo,
  signPlaybackToken,
  playerUrl,
  getDownloads,
  createDownload,
  ensureSignedDownload,
  TOKEN_TTL_SECONDS,
  MAX_UPLOAD_DURATION_SECONDS
};
