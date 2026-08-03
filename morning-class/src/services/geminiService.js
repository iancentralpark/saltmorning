function isGeminiConfigured() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

function formatGeminiClientError(err) {
  const msg = String((err && err.message) || err || '');
  if (/API_KEY|api key|401|403/i.test(msg)) {
    return 'English AI is not configured correctly.';
  }
  if (/429|quota|rate/i.test(msg)) {
    return 'AI is busy right now. Try again in a moment.';
  }
  return msg || 'AI request failed.';
}

/**
 * askGemini(prompt, options)
 * askGemini(prompt, history, options) — history unused but accepted for Mr.Park compat
 */
async function askGemini(prompt, historyOrOptions, maybeOptions) {
  const options = (Array.isArray(historyOrOptions) || historyOrOptions == null)
    ? (maybeOptions || {})
    : (historyOrOptions || {});
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const model = options.model || 'gemini-2.5-flash-lite';
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
    throw new Error(formatGeminiClientError(errMsg));
  }
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts;
  const reply = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
  if (!reply.trim()) throw new Error('Empty response from Gemini.');
  // Object form for deepDiveWord; string still works for Buddy via String()
  return {
    ok: true,
    answer: reply.trim(),
    text: reply.trim(),
    toString: function () { return this.text; }
  };
}

module.exports = { isGeminiConfigured, askGemini, formatGeminiClientError };
