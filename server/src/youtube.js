const { DEFAULT_YOUTUBE_VIDEO_ID } = require('./config');

function parseYoutubeVideoId(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (!s) return DEFAULT_YOUTUBE_VIDEO_ID;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  let m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  return DEFAULT_YOUTUBE_VIDEO_ID;
}

function youtubeEmbedUrl(videoId) {
  return 'https://www.youtube.com/embed/' + videoId + '?rel=0&modestbranding=1';
}

const GLOBAL_VIDEO_CLASS_ID = '*';

function defaultVideoPayload() {
  return {
    videoUrl: 'https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID,
    videoId: DEFAULT_YOUTUBE_VIDEO_ID,
    embedUrl: youtubeEmbedUrl(DEFAULT_YOUTUBE_VIDEO_ID)
  };
}

function videoPayloadFromRaw(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return defaultVideoPayload();
  let videoId = DEFAULT_YOUTUBE_VIDEO_ID;
  try {
    videoId = parseYoutubeVideoId(trimmed);
  } catch (e) {
    videoId = DEFAULT_YOUTUBE_VIDEO_ID;
  }
  return {
    videoUrl: trimmed || ('https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID),
    videoId,
    embedUrl: youtubeEmbedUrl(videoId)
  };
}

/** Shared Vocab Timer video — one URL for every class. */
function resolveSharedClassVideoFromRows(rows, classId) {
  if (!rows || rows.length < 2) return defaultVideoPayload();

  let globalRaw = '';
  let classRaw = '';
  let latestRaw = '';
  let latestTs = '';

  for (let i = 1; i < rows.length; i++) {
    const cid = String(rows[i][0] || '');
    const raw = String(rows[i][1] || '').trim();
    if (!raw) continue;
    const updatedAt = String(rows[i][2] || '');
    if (cid === GLOBAL_VIDEO_CLASS_ID || cid === '_all') globalRaw = raw;
    if (classId && cid === String(classId)) classRaw = raw;
    if (updatedAt >= latestTs) {
      latestTs = updatedAt;
      latestRaw = raw;
    }
  }

  return videoPayloadFromRaw(globalRaw || latestRaw || classRaw);
}

module.exports = {
  parseYoutubeVideoId,
  youtubeEmbedUrl,
  GLOBAL_VIDEO_CLASS_ID,
  defaultVideoPayload,
  videoPayloadFromRaw,
  resolveSharedClassVideoFromRows
};
