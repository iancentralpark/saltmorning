'use strict';

/**
 * Natural TTS for Oral Debrief interviewer lines (Gemini TTS, "Kore" voice).
 * Audio is streamed as it is generated and never stored.
 *
 * Measured Nov 2026 on a 30-word reply: gemini-2.5-flash-preview-tts returns the whole
 * clip at once after 5-7s, while the models below start streaming after about 0.6s.
 * Each model has its own requests-per-minute quota (10 on Tier 1), so a busy or
 * failing model falls through to the next one.
 */

const DEFAULT_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-2.5-flash-preview-tts'
];
// Only these take a style instruction in the prompt. Newer models read it aloud.
const STYLE_PROMPT_MODELS = /gemini-(2\.5|3\.1)-/;
const DEFAULT_VOICE = 'Kore';
const MAX_CHARS = 900;
const SAMPLE_RATE = 24000;
const FIRST_AUDIO_TIMEOUT_MS = 12000;
const TOTAL_TIMEOUT_MS = 45000;
const MAX_COOLDOWN_MS = 60000;

const cooldownUntil = new Map();

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function isConfigured() {
  return !!geminiKey();
}

function ttsModels() {
  const list = String(process.env.DEBRIEF_TTS_MODELS || process.env.DEBRIEF_TTS_MODEL || '')
    .split(',').map((m) => m.trim()).filter(Boolean);
  DEFAULT_MODELS.forEach((m) => { if (!list.includes(m)) list.push(m); });
  return list;
}

function ttsVoice() {
  return String(process.env.DEBRIEF_TTS_VOICE || DEFAULT_VOICE).trim();
}

function httpError(status, msg) {
  const err = new Error(msg);
  err.statusCode = status;
  return err;
}

/** Wrap raw 16-bit PCM in a minimal WAV header for browser playback. */
function pcmToWav(pcm, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  return buffer;
}

function buildPrompt(model, text) {
  if (!STYLE_PROMPT_MODELS.test(model)) return text;
  return 'Speak the following lines aloud as a warm, friendly middle-school English teacher ' +
    'having a natural conversation with a student. Sound encouraging and clear, not robotic. ' +
    'Do not add extra words. Only speak this text:\n\n' + text;
}

function retryDelayMs(data) {
  const details = (data && data.error && data.error.details) || [];
  const hit = details.find((d) => d && d.retryDelay);
  const sec = hit ? parseFloat(String(hit.retryDelay)) : NaN;
  return Number.isFinite(sec) ? Math.min(MAX_COOLDOWN_MS, Math.max(1000, sec * 1000)) : 20000;
}

/**
 * Streams one model's audio as raw 16-bit mono PCM. Resolves with the number of bytes
 * sent. Rejects with err.retryable = true when nothing was sent and another model
 * may still succeed.
 */
async function streamFromModel(model, text, onChunk, outerSignal) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(geminiKey());
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  let sent = 0;
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, FIRST_AUDIO_TIMEOUT_MS);
  const fail = (status, msg, retryable) => {
    const err = httpError(status, msg);
    err.retryable = !!retryable && sent === 0;
    return err;
  };

  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(model, text) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ttsVoice() } } }
          }
        }),
        signal: ctrl.signal
      });
    } catch (e) {
      if (outerSignal && outerSignal.aborted) throw fail(499, 'Client closed the request.', false);
      throw fail(502, '음성 생성 서버에 연결하지 못했습니다.', true);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const msg = (data && data.error && data.error.message) || ('TTS HTTP ' + res.status);
      if (res.status === 429) cooldownUntil.set(model, Date.now() + retryDelayMs(data));
      // A bad key fails the same way on every model; anything else may be model-specific.
      const keyProblem = res.status === 401 || res.status === 403;
      throw fail(res.status === 429 ? 429 : 502, msg, !keyProblem);
    }

    const decoder = new TextDecoder();
    let pending = '';
    let carry = null; // odd trailing byte, so a 16-bit sample is never split between chunks
    const emit = (raw) => {
      let buf = raw;
      if (sent === 0 && !carry && buf.length > 44 && buf.toString('latin1', 0, 4) === 'RIFF') buf = buf.subarray(44);
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      if (buf.length % 2) { carry = buf.subarray(buf.length - 1); buf = buf.subarray(0, buf.length - 1); }
      if (!buf.length) return;
      if (sent === 0) {
        clearTimeout(timer);
        timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TOTAL_TIMEOUT_MS);
      }
      sent += buf.length;
      onChunk(buf);
    };
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch (e) { return; }
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
      parts.forEach((p) => {
        if (p.inlineData && p.inlineData.data) emit(Buffer.from(p.inlineData.data, 'base64'));
      });
    };

    try {
      for await (const chunk of res.body) {
        pending += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = pending.indexOf('\n')) >= 0) {
          handleLine(pending.slice(0, i).trim());
          pending = pending.slice(i + 1);
        }
      }
      handleLine(pending.trim());
    } catch (e) {
      if (outerSignal && outerSignal.aborted) throw fail(499, 'Client closed the request.', false);
      throw fail(502, timedOut ? '음성 생성이 너무 오래 걸립니다.' : '음성 생성이 중단되었습니다.', true);
    }
    if (!sent) throw fail(502, '음성을 만들지 못했습니다.', true);
    return sent;
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Streams the line as raw PCM (16-bit little-endian, mono, SAMPLE_RATE Hz).
 * onChunk(buffer) is called as audio arrives.
 * @returns {Promise<{model: string, bytes: number, sampleRate: number}>}
 */
async function synthesizeStream(text, onChunk, opts) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!clean) throw httpError(400, '읽을 문장이 없습니다.');
  if (!isConfigured()) throw httpError(503, '자연스러운 TTS가 설정되지 않았습니다.');
  const signal = opts && opts.signal;

  const now = Date.now();
  const all = ttsModels();
  const order = all.filter((m) => !(cooldownUntil.get(m) > now));
  // Models that recently hit their quota are skipped, except that the one due back
  // soonest gets a last attempt before the request fails.
  const cooling = all.filter((m) => !order.includes(m))
    .sort((a, b) => cooldownUntil.get(a) - cooldownUntil.get(b));
  if (cooling.length) order.push(cooling[0]);

  let lastErr = null;
  for (const model of order) {
    try {
      const bytes = await streamFromModel(model, clean, onChunk, signal);
      return { model, bytes, sampleRate: SAMPLE_RATE };
    } catch (e) {
      lastErr = e;
      if (!e.retryable) throw e;
      console.warn('[debrief-tts] ' + model + ' failed (' + e.statusCode + '), trying next model');
    }
  }
  throw lastErr || httpError(502, '음성을 만들지 못했습니다.');
}

/**
 * Whole clip as a WAV file, for clients that do not play a stream.
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function synthesize(text) {
  const chunks = [];
  const out = await synthesizeStream(text, (buf) => chunks.push(buf));
  return { buffer: pcmToWav(Buffer.concat(chunks), out.sampleRate), mimeType: 'audio/wav' };
}

module.exports = {
  isConfigured,
  synthesize,
  synthesizeStream,
  SAMPLE_RATE,
  MAX_CHARS
};
