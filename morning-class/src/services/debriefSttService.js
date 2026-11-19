'use strict';

/**
 * Speech-to-text for Oral Debrief.
 * Prefers OpenAI Whisper (OPENAI_API_KEY), falls back to Groq Whisper (GROQ_API_KEY).
 * Audio is sent for transcription only and never stored.
 */

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_PROMPT_CHARS = 700;

/*
 * Whisper invents text for silence and noise ("Thank you.", "C.", "...").
 * OpenAI exposes a useful no_speech_prob; Groq often reports 0. avg_logprob only
 * partly separates the two, and short real answers ("Yes.") can score poorly on
 * OpenAI, so those trusted one-word replies skip the logprob cutoff.
 */
const DEFAULT_MIN_LOGPROB_SHORT = -0.7;
const DEFAULT_MIN_LOGPROB_ANY = -1.0;
const DEFAULT_MAX_NO_SPEECH = 0.6;
const SHORT_ANSWER_WORDS = 4;
const SILENCE_PHRASES = new Set([
  'you', 'thank you', 'thanks', 'thank you for watching', 'thanks for watching',
  'bye', 'bye bye', 'please subscribe', 'the', 'the s', 'so'
]);
const TRUSTED_SHORT = new Set([
  'yes', 'no', 'yeah', 'yep', 'yup', 'nope', 'nah', 'ok', 'okay', 'sure', 'maybe',
  'right', 'wrong', 'true', 'false', 'idk'
]);

function openaiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function groqKey() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

function isSttConfigured() {
  return !!(openaiKey() || groqKey());
}

function openaiModel() {
  return String(process.env.DEBRIEF_STT_OPENAI_MODEL || 'whisper-1').trim();
}

function groqModel() {
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
 * Returns { ok, text, reason, avgLogprob, noSpeechProb, words }.
 */
function assessTranscript(data) {
  const minShort = envNumber('DEBRIEF_STT_MIN_LOGPROB', DEFAULT_MIN_LOGPROB_SHORT);
  const minAny = envNumber('DEBRIEF_STT_MIN_LOGPROB_ANY', DEFAULT_MIN_LOGPROB_ANY);
  const maxNoSpeech = envNumber('DEBRIEF_STT_MAX_NO_SPEECH', DEFAULT_MAX_NO_SPEECH);
  const segments = (data && Array.isArray(data.segments) ? data.segments : [])
    .filter((s) => s && String(s.text || '').trim());

  let text = String((data && data.text) || '').trim();
  let avgLogprob = null;
  let noSpeechProb = null;

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
    const nspSegs = kept.filter((s) => Number.isFinite(Number(s.no_speech_prob)));
    if (nspSegs.length) {
      noSpeechProb = nspSegs.reduce((n, s) => n + Number(s.no_speech_prob), 0) / nspSegs.length;
    }
  }

  const letters = text.replace(/[^\p{L}\p{N}]/gu, '');
  const words = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const out = { ok: false, text, reason: '', avgLogprob, noSpeechProb, words };

  if (!letters) { out.reason = 'no_speech'; return out; }
  if (letters.length < 2) { out.reason = 'single_character'; return out; }
  if (SILENCE_PHRASES.has(normalized)) { out.reason = 'silence_phrase'; return out; }

  const trustedShort = words <= 2 && TRUSTED_SHORT.has(normalized.replace(/\s+/g, ''));
  // OpenAI often marks real "Yes." with a high no_speech_prob; only use it when the
  // text is not an explicitly trusted short answer.
  if (!trustedShort && noSpeechProb != null && noSpeechProb >= maxNoSpeech) {
    out.reason = 'no_speech_prob';
    return out;
  }
  if (!trustedShort && avgLogprob != null && words <= SHORT_ANSWER_WORDS && avgLogprob < minShort) {
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

function sttProviders() {
  const list = [];
  if (openaiKey()) list.push('openai');
  if (groqKey()) list.push('groq');
  return list;
}

async function requestTranscription(provider, buffer, mimeType, prompt, language) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'answer.' + extForMime(mimeType));
  form.append('model', provider === 'openai' ? openaiModel() : groqModel());
  form.append('language', language || 'en');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt);

  const url = provider === 'openai' ? OPENAI_URL : GROQ_URL;
  const key = provider === 'openai' ? openaiKey() : groqKey();

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form
    });
  } catch (e) {
    const err = new Error('음성 인식 서버에 연결하지 못했습니다.');
    err.statusCode = 502;
    err.retryable = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || '음성 인식에 실패했습니다.');
    err.statusCode = res.status === 429 ? 429 : 502;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  return data;
}

/** Transcribes and returns the full assessment from assessTranscript(). */
async function transcribeDetailed(buffer, mimeType, opts) {
  opts = opts || {};
  const providers = sttProviders();
  if (!providers.length) {
    const err = new Error('음성 인식이 설정되지 않았습니다 (OPENAI_API_KEY 또는 GROQ_API_KEY). 글로 답해 주세요.');
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
  let lastErr = null;

  for (const provider of providers) {
    try {
      let result = assessTranscript(
        await requestTranscription(provider, buffer, mimeType, prompt, opts.language)
      );

      // Name prompts help long answers but often scramble short ones ("Yes." → "The")
      // and get recited back on silence. Re-check without the prompt when needed.
      if (prompt && (!result.ok || result.words <= 2 || isPromptEcho(result.text, prompt))) {
        const plain = assessTranscript(
          await requestTranscription(provider, buffer, mimeType, '', opts.language)
        );
        if (!result.ok) {
          if (plain.ok) result = plain;
        } else if (isPromptEcho(result.text, prompt)) {
          if (plain.ok) result = plain;
          else { result.ok = false; result.reason = 'prompt_echo'; }
        } else if (result.words <= 2 && plain.ok) {
          result = plain;
        }
      }
      result.provider = provider;
      return result;
    } catch (e) {
      lastErr = e;
      if (!e.retryable) throw e;
      console.warn('[debrief-stt] ' + provider + ' failed (' + e.statusCode + '), trying next');
    }
  }
  throw lastErr || new Error('음성 인식에 실패했습니다.');
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
