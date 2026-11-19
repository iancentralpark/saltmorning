'use strict';

/**
 * Natural TTS for Oral Debrief interviewer lines.
 * Uses Gemini TTS when GEMINI_API_KEY is set (warm "Kore" voice).
 * Audio is generated on demand and never stored.
 */

const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE = 'Kore';
const MAX_CHARS = 900;

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function isConfigured() {
  return !!geminiKey();
}

function ttsModel() {
  return String(process.env.DEBRIEF_TTS_MODEL || DEFAULT_MODEL).trim();
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

function parseSampleRate(mime) {
  const m = String(mime || '').match(/rate=(\d+)/i);
  return m ? Number(m[1]) : 24000;
}

/**
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function synthesize(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  if (!clean) throw httpError(400, '읽을 문장이 없습니다.');
  if (!isConfigured()) throw httpError(503, '자연스러운 TTS가 설정되지 않았습니다.');

  const prompt =
    'Speak the following lines aloud as a warm, friendly middle-school English teacher ' +
    'having a natural conversation with a student. Sound encouraging and clear, not robotic. ' +
    'Do not add extra words. Only speak this text:\n\n' + clean;

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(ttsModel()) +
    ':generateContent?key=' + encodeURIComponent(geminiKey());

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: ttsVoice() }
            }
          }
        }
      }),
      signal: AbortSignal.timeout(45000)
    });
  } catch (e) {
    throw httpError(502, '음성 생성 서버에 연결하지 못했습니다.');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('TTS HTTP ' + res.status);
    throw httpError(res.status === 429 ? 429 : 502, msg);
  }

  const part = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts.find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw httpError(502, '음성을 만들지 못했습니다.');

  const mime = String(part.inlineData.mimeType || 'audio/L16');
  const raw = Buffer.from(part.inlineData.data, 'base64');
  if (mime.toLowerCase().includes('wav') || mime.toLowerCase().includes('mpeg') || mime.toLowerCase().includes('mp3')) {
    return { buffer: raw, mimeType: mime.includes('mpeg') || mime.includes('mp3') ? 'audio/mpeg' : 'audio/wav' };
  }
  // Gemini TTS usually returns raw PCM (L16)
  return { buffer: pcmToWav(raw, parseSampleRate(mime)), mimeType: 'audio/wav' };
}

module.exports = {
  isConfigured,
  synthesize,
  MAX_CHARS
};
