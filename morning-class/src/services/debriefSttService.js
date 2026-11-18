'use strict';

/**
 * Speech-to-text for Oral Debrief (Groq-hosted Whisper).
 * Audio is sent for transcription only and never stored.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_CHARS = 700;

function groqKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function isSttConfigured() {
  return !!groqKey();
}

function sttModel() {
  return String(process.env.DEBRIEF_STT_MODEL || 'whisper-large-v3-turbo').trim();
}

function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

/** Bias Whisper toward character/place names so "Wilbur" is not heard as "will bur". */
function buildPrompt(properNouns) {
  const names = (Array.isArray(properNouns) ? properNouns : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!names.length) return '';
  return ('Book discussion. Names: ' + names.join(', ')).slice(0, MAX_PROMPT_CHARS);
}

async function transcribe(buffer, mimeType, opts) {
  opts = opts || {};
  if (!isSttConfigured()) {
    const err = new Error('음성 인식이 설정되지 않았습니다 (GROQ_API_KEY). 글로 답해 주세요.');
    err.statusCode = 503;
    throw err;
  }
  if (!buffer || !buffer.length) {
    const err = new Error('녹음이 비어 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    const err = new Error('녹음이 너무 깁니다. 짧게 나눠 말해 주세요.');
    err.statusCode = 413;
    throw err;
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'answer.' + extForMime(mimeType));
  form.append('model', sttModel());
  form.append('language', opts.language || 'en');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const prompt = buildPrompt(opts.properNouns);
  if (prompt) form.append('prompt', prompt);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + groqKey() },
      body: form
    });
  } catch (e) {
    const err = new Error('음성 인식 서버에 연결하지 못했습니다.');
    err.statusCode = 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || '음성 인식에 실패했습니다.');
    err.statusCode = res.status === 429 ? 429 : 502;
    throw err;
  }
  return String((data && data.text) || '').trim();
}

module.exports = {
  isSttConfigured,
  transcribe,
  buildPrompt,
  MAX_AUDIO_BYTES
};
