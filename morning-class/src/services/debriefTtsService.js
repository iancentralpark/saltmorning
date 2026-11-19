'use strict';

/**
 * Natural TTS for Oral Debrief interviewer lines.
 * Prefers OpenAI (gpt-4o-mini-tts, streaming PCM) when OPENAI_API_KEY is set.
 * Falls back through Gemini TTS models when GEMINI_API_KEY is set.
 * Audio is streamed as it is generated and never stored.
 */

const OPENAI_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_OPENAI_MODELS = ['gpt-4o-mini-tts', 'tts-1'];
const DEFAULT_GEMINI_MODELS = [
  'gemini-3.1-flash-tts-preview',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-2.5-flash-preview-tts'
];
// Only these Gemini models take a style instruction in the prompt. Newer ones read it aloud.
const GEMINI_STYLE_PROMPT_MODELS = /gemini-(2\.5|3\.1)-/;
const DEFAULT_OPENAI_VOICE = 'coral';
const DEFAULT_GEMINI_VOICE = 'Kore';
const MAX_CHARS = 900;
const SAMPLE_RATE = 24000;
const FIRST_AUDIO_TIMEOUT_MS = 12000;
const TOTAL_TIMEOUT_MS = 45000;
const MAX_COOLDOWN_MS = 60000;
const TEACHER_STYLE =
  'Speak as a warm, friendly middle-school English teacher having a natural conversation ' +
  'with a student. Sound encouraging and clear, not robotic. Do not add or change words.';

const cooldownUntil = new Map();

function openaiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function isConfigured() {
  return !!(openaiKey() || geminiKey());
}

function envList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

function openaiModels() {
  if (!openaiKey()) return [];
  const list = envList('DEBRIEF_TTS_OPENAI_MODELS');
  if (!list.length && process.env.DEBRIEF_TTS_MODEL && !String(process.env.DEBRIEF_TTS_MODEL).startsWith('gemini-')) {
    list.push(String(process.env.DEBRIEF_TTS_MODEL).trim());
  }
  DEFAULT_OPENAI_MODELS.forEach((m) => { if (!list.includes(m)) list.push(m); });
  return list;
}

function geminiModels() {
  if (!geminiKey()) return [];
  const list = envList('DEBRIEF_TTS_MODELS');
  if (!list.length && process.env.DEBRIEF_TTS_MODEL && String(process.env.DEBRIEF_TTS_MODEL).startsWith('gemini-')) {
    list.push(String(process.env.DEBRIEF_TTS_MODEL).trim());
  }
  DEFAULT_GEMINI_MODELS.forEach((m) => { if (!list.includes(m)) list.push(m); });
  return list;
}

function openaiVoice() {
  return String(process.env.DEBRIEF_TTS_VOICE || process.env.DEBRIEF_TTS_OPENAI_VOICE || DEFAULT_OPENAI_VOICE).trim();
}

function geminiVoice() {
  // Keep Kore when the shared voice env still holds a Gemini name; otherwise default Kore.
  const v = String(process.env.DEBRIEF_TTS_GEMINI_VOICE || '').trim();
  if (v) return v;
  const shared = String(process.env.DEBRIEF_TTS_VOICE || '').trim();
  if (shared && !/^(alloy|ash|ballad|coral|echo|fable|onyx|nova|sage|shimmer|verse|marin|cedar)$/i.test(shared)) {
    return shared;
  }
  return DEFAULT_GEMINI_VOICE;
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

function geminiPrompt(model, text) {
  if (!GEMINI_STYLE_PROMPT_MODELS.test(model)) return text;
  return 'Speak the following lines aloud as a warm, friendly middle-school English teacher ' +
    'having a natural conversation with a student. Sound encouraging and clear, not robotic. ' +
    'Do not add extra words. Only speak this text:\n\n' + text;
}

function retryDelayMs(data, fallbackMs) {
  const details = (data && data.error && data.error.details) || [];
  const hit = details.find((d) => d && d.retryDelay);
  const sec = hit ? parseFloat(String(hit.retryDelay)) : NaN;
  if (Number.isFinite(sec)) return Math.min(MAX_COOLDOWN_MS, Math.max(1000, sec * 1000));
  return fallbackMs || 20000;
}

function makeEmitter(onChunk, ctrl, timers) {
  let sent = 0;
  let carry = null;
  return {
    get sent() { return sent; },
    emit(raw) {
      let buf = raw;
      if (sent === 0 && !carry && buf.length > 44 && buf.toString('latin1', 0, 4) === 'RIFF') {
        buf = buf.subarray(44);
      }
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      if (buf.length % 2) {
        carry = buf.subarray(buf.length - 1);
        buf = buf.subarray(0, buf.length - 1);
      }
      if (!buf.length) return;
      if (sent === 0) {
        clearTimeout(timers.first);
        timers.total = setTimeout(() => { timers.timedOut = true; ctrl.abort(); }, TOTAL_TIMEOUT_MS);
      }
      sent += buf.length;
      onChunk(buf);
    }
  };
}

function attachAbort(outerSignal, ctrl) {
  const onOuterAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  return () => {
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
  };
}

async function streamOpenAi(model, text, onChunk, outerSignal) {
  const ctrl = new AbortController();
  const detach = attachAbort(outerSignal, ctrl);
  const timers = { first: null, total: null, timedOut: false };
  timers.first = setTimeout(() => { timers.timedOut = true; ctrl.abort(); }, FIRST_AUDIO_TIMEOUT_MS);
  const fail = (status, msg, retryable) => {
    const err = httpError(status, msg);
    err.retryable = !!retryable && emitter.sent === 0;
    return err;
  };
  const emitter = makeEmitter(onChunk, ctrl, timers);

  const body = {
    model,
    voice: openaiVoice(),
    input: text,
    response_format: 'pcm',
    speed: 1.0
  };
  // Style instructions and SSE audio deltas are supported on gpt-4o-mini-tts, not tts-1.
  if (model.startsWith('gpt-4o-mini-tts') || model.includes('gpt-4o-mini-tts')) {
    body.instructions = TEACHER_STYLE;
    body.stream_format = 'audio';
  }

  try {
    let res;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + openaiKey(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
    } catch (e) {
      if (outerSignal && outerSignal.aborted) throw fail(499, 'Client closed the request.', false);
      throw fail(502, '음성 생성 서버에 연결하지 못했습니다.', true);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const msg = (data && data.error && data.error.message) || ('TTS HTTP ' + res.status);
      if (res.status === 429) cooldownUntil.set(model, Date.now() + retryDelayMs(data, 20000));
      const keyProblem = res.status === 401 || res.status === 403;
      throw fail(res.status === 429 ? 429 : 502, msg, !keyProblem);
    }

    try {
      for await (const chunk of res.body) emitter.emit(Buffer.from(chunk));
    } catch (e) {
      if (outerSignal && outerSignal.aborted) throw fail(499, 'Client closed the request.', false);
      throw fail(502, timers.timedOut ? '음성 생성이 너무 오래 걸립니다.' : '음성 생성이 중단되었습니다.', true);
    }
    if (!emitter.sent) throw fail(502, '음성을 만들지 못했습니다.', true);
    return emitter.sent;
  } finally {
    clearTimeout(timers.first);
    clearTimeout(timers.total);
    detach();
  }
}

async function streamGemini(model, text, onChunk, outerSignal) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(geminiKey());
  const ctrl = new AbortController();
  const detach = attachAbort(outerSignal, ctrl);
  const timers = { first: null, total: null, timedOut: false };
  timers.first = setTimeout(() => { timers.timedOut = true; ctrl.abort(); }, FIRST_AUDIO_TIMEOUT_MS);
  const fail = (status, msg, retryable) => {
    const err = httpError(status, msg);
    err.retryable = !!retryable && emitter.sent === 0;
    return err;
  };
  const emitter = makeEmitter(onChunk, ctrl, timers);

  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: geminiPrompt(model, text) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice() } } }
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
      if (res.status === 429) cooldownUntil.set(model, Date.now() + retryDelayMs(data, 20000));
      const keyProblem = res.status === 401 || res.status === 403;
      throw fail(res.status === 429 ? 429 : 502, msg, !keyProblem);
    }

    const decoder = new TextDecoder();
    let pending = '';
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch (e) { return; }
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) || [];
      parts.forEach((p) => {
        if (p.inlineData && p.inlineData.data) emitter.emit(Buffer.from(p.inlineData.data, 'base64'));
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
      throw fail(502, timers.timedOut ? '음성 생성이 너무 오래 걸립니다.' : '음성 생성이 중단되었습니다.', true);
    }
    if (!emitter.sent) throw fail(502, '음성을 만들지 못했습니다.', true);
    return emitter.sent;
  } finally {
    clearTimeout(timers.first);
    clearTimeout(timers.total);
    detach();
  }
}

/**
 * Streams the line as raw PCM (16-bit little-endian, mono, SAMPLE_RATE Hz).
 * onChunk(buffer) is called as audio arrives.
 * @returns {Promise<{model: string, bytes: number, sampleRate: number, provider: string}>}
 */
async function synthesizeStream(text, onChunk, opts) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!clean) throw httpError(400, '읽을 문장이 없습니다.');
  if (!isConfigured()) throw httpError(503, '자연스러운 TTS가 설정되지 않았습니다.');
  const signal = opts && opts.signal;

  const targets = []
    .concat(openaiModels().map((model) => ({ provider: 'openai', model })))
    .concat(geminiModels().map((model) => ({ provider: 'gemini', model })));

  const now = Date.now();
  const order = targets.filter((t) => !(cooldownUntil.get(t.model) > now));
  const cooling = targets.filter((t) => !order.includes(t))
    .sort((a, b) => cooldownUntil.get(a.model) - cooldownUntil.get(b.model));
  if (cooling.length) order.push(cooling[0]);

  let lastErr = null;
  for (const t of order) {
    try {
      const bytes = t.provider === 'openai'
        ? await streamOpenAi(t.model, clean, onChunk, signal)
        : await streamGemini(t.model, clean, onChunk, signal);
      return { model: t.model, bytes, sampleRate: SAMPLE_RATE, provider: t.provider };
    } catch (e) {
      lastErr = e;
      if (!e.retryable) throw e;
      console.warn('[debrief-tts] ' + t.provider + '/' + t.model + ' failed (' + e.statusCode + '), trying next');
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
