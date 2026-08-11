const {
  CURRICULUM_MAP_URL,
  CURRICULUM_MAP_API_KEY
} = require('../config');

async function curriculumMapFetch(pathWithQuery) {
  const base = String(CURRICULUM_MAP_URL || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CURRICULUM_MAP_URL is not configured.');
    err.status = 503;
    throw err;
  }
  const headers = { Accept: 'application/json' };
  if (CURRICULUM_MAP_API_KEY) {
    headers['x-api-key'] = CURRICULUM_MAP_API_KEY;
  }
  const res = await fetch(base + pathWithQuery, { headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || `CurricuMap error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function deepLink(path, query) {
  const base = String(CURRICULUM_MAP_URL || '').replace(/\/$/, '');
  const usp = new URLSearchParams(query || {});
  return `${base}${path}?${usp.toString()}`;
}

module.exports = {
  curriculumMapFetch,
  deepLink,
  getCurriculumMapPublicConfig() {
    return {
      enabled: Boolean(CURRICULUM_MAP_URL),
      baseUrl: CURRICULUM_MAP_URL || null
    };
  }
};
