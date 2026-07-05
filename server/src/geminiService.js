const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const CLASSROOM_SYSTEM_HINT =
  'You are a helpful assistant for an English classroom teacher (children and teens). ' +
  'Give clear, practical answers. When asked for lesson ideas, vocabulary, or explanations, ' +
  'keep them classroom-ready and age-appropriate. Be concise unless more detail is requested.';

function isGeminiConfigured() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

async function askGemini(prompt, history, options) {
  const opts = options || {};
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Enter a question for Gemini.');
  if (!apiKey) {
    return { ok: false, fallbackWeb: true, error: 'Gemini API key not configured on server.' };
  }

  const prior = Array.isArray(history) ? history : [];
  const contents = [];
  prior.forEach(function(msg) {
    const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
    const body = String(msg.text || msg.content || '').trim();
    if (!body) return;
    contents.push({ role: role, parts: [{ text: body }] });
  });
  contents.push({ role: 'user', parts: [{ text }] });

  const model = opts.model || GEMINI_MODEL;
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemInstruction || CLASSROOM_SYSTEM_HINT }] },
      contents: contents,
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens || 1200,
        temperature: opts.temperature != null ? opts.temperature : 0.65
      }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      (data.error && data.error.message) ||
      (data[0] && data[0].error && data[0].error.message) ||
      ('Gemini API error (' + res.status + ')');
    return { ok: false, error: errMsg };
  }

  const parts = data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts;
  const answer = (parts || [])
    .map(p => String(p.text || ''))
    .join('')
    .trim();

  if (!answer) {
    return { ok: false, error: 'Gemini returned an empty response.' };
  }

  return { ok: true, answer, model: model };
}

module.exports = { isGeminiConfigured, askGemini };
