function isGeminiConfigured() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCapacityError(msg, status) {
  const s = String(msg || '');
  return status === 429 || status === 503
    || /high demand|unavailable|overloaded|resource.?exhausted|try again later|quota|rate/i.test(s);
}

function formatGeminiClientError(err) {
  const msg = String((err && err.message) || err || '');
  if (/API_KEY|api key|401|403/i.test(msg)) {
    return 'English AI is not configured correctly.';
  }
  if (isCapacityError(msg)) {
    return 'AI is busy right now. Try again in a moment.';
  }
  return msg || 'AI request failed.';
}

function defaultModel() {
  return process.env.TEACHER_GEMINI_MODEL
    || process.env.GEMINI_MODEL
    || 'gemini-2.5-flash-lite';
}

function fallbackModels(preferred) {
  const primary = String(preferred || defaultModel()).trim();
  const extras = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite'
  ];
  const seen = new Set();
  const out = [];
  [primary].concat(extras).concat(defaults).forEach((m) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    out.push(m);
  });
  return out;
}

async function askGeminiOnce(prompt, options, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: String(prompt || '') }] }]
  };
  if (options.systemInstruction) {
    body.systemInstruction = { parts: [{ text: String(options.systemInstruction) }] };
  }
  if (options.temperature != null || options.maxOutputTokens != null) {
    body.generationConfig = {};
    if (options.temperature != null) body.generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens != null) body.generationConfig.maxOutputTokens = options.maxOutputTokens;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data.error && data.error.message) || res.statusText || 'Gemini request failed';
    const err = new Error(errMsg);
    err.status = res.status;
    err.capacity = isCapacityError(errMsg, res.status);
    throw err;
  }
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts;
  const reply = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
  if (!reply.trim()) throw new Error('Empty response from Gemini.');
  return {
    ok: true,
    answer: reply.trim(),
    text: reply.trim(),
    model,
    toString: function () { return this.text; }
  };
}

/**
 * askGemini(prompt, options)
 * askGemini(prompt, history, options) — history unused but accepted for Mr.Park compat
 * Retries on capacity errors and falls back across models.
 */
async function askGemini(prompt, historyOrOptions, maybeOptions) {
  const options = (Array.isArray(historyOrOptions) || historyOrOptions == null)
    ? (maybeOptions || {})
    : (historyOrOptions || {});
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

  const models = options.noFallback
    ? [String(options.model || defaultModel()).trim()].filter(Boolean)
    : fallbackModels(options.model);
  const maxAttemptsPerModel = Math.max(1, Number(options.retries) || (options.noFallback ? 1 : 2));
  let lastError = null;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        return await askGeminiOnce(prompt, options, model, apiKey);
      } catch (e) {
        lastError = e;
        const capacity = e && (e.capacity || isCapacityError(e.message, e.status));
        if (!capacity) {
          throw new Error(formatGeminiClientError(e));
        }
        // brief backoff before next try / next model
        await sleep(400 * attempt + Math.floor(Math.random() * 250));
      }
    }
  }

  throw new Error(formatGeminiClientError(lastError || new Error('AI is busy right now. Try again in a moment.')));
}

module.exports = {
  isGeminiConfigured,
  askGemini,
  formatGeminiClientError,
  defaultModel,
  fallbackModels
};
