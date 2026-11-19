'use strict';

/**
 * Speech-to-text for Oral Debrief (Groq-hosted Whisper).
 * Audio is sent for transcription only and never stored.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_CHARS = 700;

/*
 * Whisper invents text for silence and noise ("Thank you.", "C.", "..."). On Groq
 * no_speech_prob is always 0, and avg_logprob only partly separates the two: measured on
 * whisper-large-v3-turbo, real one-word answers scored as low as -0.65, noise scored
 * -0.75 and below, but silence scored anywhere from -0.29 to -1.03 depending on the
 * prompt. So the cutoff sits between the first two and the usual silence phrases are
 * rejected by name.
 */
const DEFAULT_MIN_LOGPROB_SHORT = -0.7;
const DEFAULT_MIN_LOGPROB_ANY = -1.0;
const SHORT_ANSWER_WORDS = 4;
const SILENCE_PHRASES = new Set([
  'you', 'thank you', 'thanks', 'thank you for watching', 'thanks for watching',
  'bye', 'bye bye', 'please subscribe'
]);

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

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return process.env[name] != null && process.env[name] !== '' && Number.isFinite(n) ? n : fallback;
}

/**
 * Decide whether a Whisper result is a real answer or noise.
 * Returns { ok, text, reason, avgLogprob, words }.
 */
function assessTranscript(data) {
  const minShort = envNumber('DEBRIEF_STT_MIN_LOGPROB', DEFAULT_MIN_LOGPROB_SHORT);
  const minAny = envNumber('DEBRIEF_STT_MIN_LOGPROB_ANY', DEFAULT_MIN_LOGPROB_ANY);
  const segments = (data && Array.isArray(data.segments) ? data.segments : [])
    .filter((s) => s && String(s.text || '').trim());

  let text = String((data && data.text) || '').trim();
  let avgLogprob = null;

  if (segments.length) {
    const scored = segments.filter((s) => Number.isFinite(Number(s.avg_logprob)));
    const kept = scored.length === segments.length
      ? segments.filter((s) => Number(s.avg_logprob) >= minAny)
      : segments;
    text = kept.map((s) => String(s.text || '').trim()).join(' ').trim();
    const weighted = kept.filter((s) => Number.isFinite(Number(s.avg_logprob)));
    const totalLen = weighted.reduce((n, s) => n + String(s.text || '').trim().length, 0);
    if (totalLen) {
      avgLogprob = weighted.reduce(
        (n, s) => n + Number(s.avg_logprob) * String(s.text || '').trim().length, 0
      ) / totalLen;
    }
  }

  const letters = text.replace(/[^\p{L}\p{N}]/gu, '');
  const words = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const out = { ok: false, text, reason: '', avgLogprob, words };

  if (!letters) { out.reason = 'no_speech'; return out; }
  if (letters.length < 2) { out.reason = 'single_character'; return out; }
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (SILENCE_PHRASES.has(normalized)) { out.reason = 'silence_phrase'; return out; }
  if (avgLogprob != null && words <= SHORT_ANSWER_WORDS && avgLogprob < minShort) {
    out.reason = 'low_confidence';
    return out;
  }
  out.ok = true;
  return out;
}

/**
 * Bias Whisper toward character/place names so "Wilbur" is not heard as "will bur".
 * The prompt is a plain sentence: a label such as "Names: ..." leaked into short
 * answers as "Names & ...".
 */
function buildPrompt(properNouns) {
  const names = (Array.isArray(properNouns) ? properNouns : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!names.length) return '';
  const list = names.length > 1
    ? names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1]
    : names[0];
  return ('We are talking about ' + list).slice(0, MAX_PROMPT_CHARS - 1) + '.';
}

function wordsOf(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

function isPromptEcho(text, prompt) {
  const promptWords = new Set(wordsOf(prompt));
  const words = wordsOf(text);
  return words.length > 0 && words.every((w) => promptWords.has(w));
}

async function requestTranscription(buffer, mimeType, prompt, language) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'answer.' + extForMime(mimeType));
  form.append('model', sttModel());
  form.append('language', language || 'en');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
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
  return data;
}

/** Transcribes and returns the full assessment from assessTranscript(). */
async function transcribeDetailed(buffer, mimeType, opts) {
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

  const prompt = buildPrompt(opts.properNouns);
  const result = assessTranscript(await requestTranscription(buffer, mimeType, prompt, opts.language));

  // Given noise, Whisper can recite the prompt back ("Wilbur, Charlotte, and Fern.").
  // When the answer contains nothing but prompt words, ask again with no prompt and
  // keep the answer only if speech is still heard.
  if (result.ok && prompt && isPromptEcho(result.text, prompt)) {
    const plain = assessTranscript(await requestTranscription(buffer, mimeType, '', opts.language));
    if (!plain.ok) {
      result.ok = false;
      result.reason = 'prompt_echo';
    }
  }
  return result;
}

async function transcribe(buffer, mimeType, opts) {
  const result = await transcribeDetailed(buffer, mimeType, opts);
  return result.ok ? result.text : '';
}

module.exports = {
  isSttConfigured,
  transcribe,
  transcribeDetailed,
  assessTranscript,
  buildPrompt,
  isPromptEcho,
  MAX_AUDIO_BYTES
};
