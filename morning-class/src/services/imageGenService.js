'use strict';

/**
 * Image generation for Class Tools.
 * Primary: Google Gemini image models (GEMINI_API_KEY) — returns base64 PNG/JPEG.
 * Claude cannot produce raster images, so Bible slides use Claude for the
 * script and Gemini for the pictures.
 */

const DEFAULT_IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation'
];

function geminiApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function isImageGenConfigured() {
  return !!geminiApiKey();
}

function imageModels() {
  const preferred = String(process.env.GEMINI_IMAGE_MODEL || '').trim();
  const out = [];
  const seen = new Set();
  [preferred].concat(DEFAULT_IMAGE_MODELS).forEach((m) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    out.push(m);
  });
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status, msg) {
  const s = String(msg || '');
  return status === 429 || status === 500 || status === 503
    || /overloaded|unavailable|resource.?exhausted|try again|quota|rate|internal/i.test(s);
}

function isModelMissing(status, msg) {
  const s = String(msg || '');
  return status === 404 || /not found|not supported|does not exist|invalid model|deprecated/i.test(s);
}

async function generateImageOnce(prompt, model, apiKey, opts) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const body = {
    contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  };
  if (opts && opts.aspectRatio) {
    body.generationConfig.imageConfig = { aspectRatio: String(opts.aspectRatio) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (opts && opts.timeoutMs) || 90000);
  let res;
  let data;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    data = await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || res.statusText || 'Image request failed';
    const err = new Error(msg);
    err.status = res.status;
    // Some models reject imageConfig — retry once without it.
    if (res.status === 400 && opts && opts.aspectRatio && /imageConfig|aspect/i.test(msg)) {
      return generateImageOnce(prompt, model, apiKey, Object.assign({}, opts, { aspectRatio: null }));
    }
    throw err;
  }
  const cand = (data.candidates || [])[0] || {};
  const parts = (cand.content && cand.content.parts) || [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline && inline.data) {
      return {
        mimeType: String(inline.mimeType || inline.mime_type || 'image/png'),
        data: String(inline.data),
        model
      };
    }
  }
  const finish = cand.finishReason || '';
  const blocked = (data.promptFeedback && data.promptFeedback.blockReason) || '';
  const err = new Error(
    'Image model returned no image' + (finish ? ' (' + finish + ')' : '') + (blocked ? ' blocked:' + blocked : '')
  );
  err.status = 422;
  err.noImage = true;
  throw err;
}

/**
 * generateImage(prompt, { aspectRatio: '16:9' }) → { mimeType, data(base64), model }
 */
async function generateImage(prompt, opts) {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    const err = new Error('Image generation is not configured (set GEMINI_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  const models = imageModels();
  let lastErr = null;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await generateImageOnce(prompt, model, apiKey, opts || {});
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError') {
          e.message = 'Image generation timed out.';
          break;
        }
        if (isModelMissing(e.status, e.message)) break; // try next model
        if (e.noImage && attempt === 1) {
          await sleep(300);
          continue; // one more try with same model (safety flakiness)
        }
        if (isRetryable(e.status, e.message)) {
          await sleep(600 * attempt + Math.floor(Math.random() * 300));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr || new Error('Image generation failed.');
}

module.exports = {
  isImageGenConfigured,
  generateImage,
  imageModels
};
