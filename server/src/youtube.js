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

module.exports = { parseYoutubeVideoId, youtubeEmbedUrl };
