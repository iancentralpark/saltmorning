/**
 * Salt Morning AI client.
 * Primary: Anthropic Claude when ANTHROPIC_API_KEY is set.
 * Optional fallback: Google Gemini (GEMINI_API_KEY).
 *
 * Keeps the historical askGemini(...) API so feature modules need no mass rename.
 */

const DEPRECATED_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash-exp'
]);

const CURRENT_FLASH_MODEL = 'gemini-3.6-flash';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';

function anthropicApiKey() {
  return String(process.env.ANTHROPIC_API_KEY || '').trim();
}

function geminiApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function preferredProvider() {
  const forced = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (forced === 'claude' || forced === 'anthropic') {
    return anthropicApiKey() ? 'claude' : null;
  }
  if (forced === 'gemini' || forced === 'google') {
    return geminiApiKey() ? 'gemini' : null;
  }
  if (anthropicApiKey()) return 'claude';
  if (geminiApiKey()) return 'gemini';
  return null;
}

function isClaudeConfigured() {
  return !!anthropicApiKey();
}

function hasGeminiKey() {
  return !!geminiApiKey();
}

/** True when Salt Morning AI can run (Claude or Gemini). */
function isGeminiConfigured() {
  return !!preferredProvider();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCapacityError(msg, status) {
  const s = String(msg || '');
  return status === 429 || status === 503
    || /high demand|unavailable|overloaded|resource.?exhausted|try again later|quota|rate|too many requests/i.test(s);
}

function isModelUnavailableError(msg, status) {
  const s = String(msg || '');
  return status === 404
    || /no longer available|not found|deprecated|invalid model|is not supported/i.test(s);
}

function resolveGeminiModel(model) {
  const m = String(model || '').trim();
  if (!m || DEPRECATED_MODELS.has(m)) return CURRENT_FLASH_MODEL;
  return m;
}

function defaultClaudeModel() {
  return String(
    process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || process.env.TEACHER_CLAUDE_MODEL
    || DEFAULT_CLAUDE_MODEL
  ).trim() || DEFAULT_CLAUDE_MODEL;
}

function defaultGeminiModel() {
  return resolveGeminiModel(
    process.env.TEACHER_GEMINI_MODEL
    || process.env.GEMINI_MODEL
    || CURRENT_FLASH_MODEL
  );
}

function defaultModel() {
  return preferredProvider() === 'claude' ? defaultClaudeModel() : defaultGeminiModel();
}

function resolveModel(model) {
  const m = String(model || '').trim();
  if (!m) return defaultModel();
  if (/^claude/i.test(m)) return m;
  return resolveGeminiModel(m);
}

function formatGeminiClientError(err) {
  const msg = String((err && err.message) || err || '');
  if (/API_KEY|api key|401|403|authentication|invalid.?x-api-key/i.test(msg)) {
    return 'English AI is not configured correctly.';
  }
  if (isCapacityError(msg, err && err.status)) {
    return 'AI is busy right now. Try again in a moment.';
  }
  return msg || 'AI request failed.';
}

function fallbackGeminiModels(preferred) {
  const primary = resolveGeminiModel(preferred || defaultGeminiModel());
  const extras = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => resolveGeminiModel(s.trim()))
    .filter(Boolean);
  const defaults = [
    CURRENT_FLASH_MODEL,
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.5-flash-lite'
  ];
  const seen = new Set();
  const out = [];
  [primary].concat(extras).concat(defaults).forEach((m) => {
    const resolved = resolveGeminiModel(m);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  });
  return out;
}

function fallbackModels(preferred) {
  if (preferredProvider() === 'claude') {
    const primary = resolveModel(preferred || defaultClaudeModel());
    const extras = String(process.env.CLAUDE_FALLBACK_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    [primary].concat(extras).forEach((m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      out.push(m);
    });
    return out.length ? out : [DEFAULT_CLAUDE_MODEL];
  }
  return fallbackGeminiModels(preferred);
}

function normalizeOptions(historyOrOptions, maybeOptions) {
  return (Array.isArray(historyOrOptions) || historyOrOptions == null)
    ? (maybeOptions || {})
    : (historyOrOptions || {});
}

function systemText(options) {
  return String((options && options.systemInstruction) || '').trim();
}

function responseMime(options) {
  return String((options && options.responseMimeType) || '').trim();
}

function wantsJson(options) {
  return /json/i.test(responseMime(options));
}

function geminiPartsFromPrompt(promptOrParts, options) {
  if (Array.isArray(promptOrParts)) return promptOrParts;
  if (options.parts && Array.isArray(options.parts)) {
    return options.parts.concat([{ text: String(promptOrParts || '') }]);
  }
  return [{ text: String(promptOrParts || '') }];
}

function claudeContentFromPrompt(promptOrParts, options) {
  const geminiParts = geminiPartsFromPrompt(promptOrParts, options);
  const content = [];
  geminiParts.forEach((part) => {
    if (!part || typeof part !== 'object') return;
    if (typeof part.text === 'string') {
      if (part.text) content.push({ type: 'text', text: part.text });
      return;
    }
    const inline = part.inlineData || part.inline_data;
    if (inline && inline.data) {
      const mime = String(inline.mimeType || inline.mime_type || 'application/octet-stream');
      const data = String(inline.data);
      if (mime === 'application/pdf' || /\/pdf$/i.test(mime)) {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data }
        });
      } else if (/^image\//i.test(mime)) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: mime, data }
        });
      } else {
        content.push({
          type: 'text',
          text: '[Attached file: ' + mime + ']'
        });
      }
    }
  });
  if (!content.length) content.push({ type: 'text', text: String(promptOrParts || '') });
  return content;
}

function packResult(text, model, provider) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Empty response from AI.');
  return {
    ok: true,
    answer: trimmed,
    text: trimmed,
    model,
    provider,
    toString: function toString() { return this.text; }
  };
}

async function askClaudeOnce(promptOrParts, options, model, apiKey) {
  let system = systemText(options);
  if (wantsJson(options)) {
    system = (system ? system + '\n\n' : '')
      + 'Return valid JSON only. No markdown fences, no commentary.';
  }
  const body = {
    model,
    max_tokens: Math.max(256, Number(options.maxOutputTokens) || 4096),
    messages: [{ role: 'user', content: claudeContentFromPrompt(promptOrParts, options) }]
  };
  if (system) body.system = system;
  if (options.temperature != null) body.temperature = Number(options.temperature);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data.error && data.error.message) || res.statusText || 'Claude request failed';
    const err = new Error(errMsg);
    err.status = res.status;
    err.capacity = isCapacityError(errMsg, res.status);
    err.modelUnavailable = isModelUnavailableError(errMsg, res.status);
    throw err;
  }
  const blocks = Array.isArray(data.content) ? data.content : [];
  const reply = blocks.map((b) => (b && b.type === 'text' ? b.text : '')).join('');
  return packResult(reply, model, 'claude');
}

async function askGeminiOnce(promptOrParts, options, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parts = geminiPartsFromPrompt(promptOrParts, options);
  const body = {
    contents: [{ role: 'user', parts }]
  };
  const system = systemText(options);
  if (system) {
    body.systemInstruction = { parts: [{ text: system }] };
  }
  const mime = responseMime(options);
  if (options.temperature != null || options.maxOutputTokens != null || mime) {
    body.generationConfig = {};
    if (options.temperature != null) body.generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens != null) body.generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (mime) body.generationConfig.responseMimeType = mime;
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
    err.modelUnavailable = isModelUnavailableError(errMsg, res.status);
    throw err;
  }
  const outParts = (((data.candidates || [])[0] || {}).content || {}).parts;
  const reply = Array.isArray(outParts) ? outParts.map((p) => p.text || '').join('') : '';
  return packResult(reply, model, 'gemini');
}

async function runWithRetries(models, runner, options) {
  const maxAttemptsPerModel = Math.max(1, Number(options.retries) || (options.noFallback ? 1 : 2));
  let lastError = null;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        return await runner(model);
      } catch (e) {
        lastError = e;
        const retryable = e && (
          e.capacity
          || isCapacityError(e.message, e.status)
          || e.modelUnavailable
          || isModelUnavailableError(e.message, e.status)
        );
        if (!retryable) throw new Error(formatGeminiClientError(e));
        await sleep(400 * attempt + Math.floor(Math.random() * 250));
      }
    }
  }
  throw new Error(formatGeminiClientError(lastError || new Error('AI is busy right now. Try again in a moment.')));
}

/**
 * askGemini(prompt, options)
 * askGemini(prompt, history, options) — history unused (Mr.Park compat)
 * askGemini(partsArray, options) — multimodal
 */
async function askGemini(prompt, historyOrOptions, maybeOptions) {
  const options = normalizeOptions(historyOrOptions, maybeOptions);
  const provider = preferredProvider();
  if (!provider) {
    throw new Error('AI is not configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY).');
  }

  if (provider === 'claude') {
    const apiKey = anthropicApiKey();
    const models = (Array.isArray(options.models) && options.models.length)
      ? Array.from(new Set(options.models.map((m) => resolveModel(m)).filter(Boolean)))
      : (options.noFallback
        ? [resolveModel(options.model || defaultClaudeModel())].filter(Boolean)
        : fallbackModels(options.model));
    try {
      return await runWithRetries(
        models,
        (model) => askClaudeOnce(prompt, options, model, apiKey),
        options
      );
    } catch (claudeErr) {
      if (!geminiApiKey() || options.noGeminiFallback) throw claudeErr;
      console.warn('Claude failed; falling back to Gemini:', claudeErr.message);
    }
  }

  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const models = (Array.isArray(options.models) && options.models.length)
    ? Array.from(new Set(options.models.map((m) => resolveGeminiModel(m)).filter(Boolean)))
    : (options.noFallback
      ? [resolveGeminiModel(options.model || defaultGeminiModel())].filter(Boolean)
      : fallbackGeminiModels(options.model));
  return runWithRetries(
    models,
    (model) => askGeminiOnce(prompt, options, model, apiKey),
    options
  );
}

module.exports = {
  isGeminiConfigured,
  isClaudeConfigured,
  hasGeminiKey,
  preferredProvider,
  askGemini,
  formatGeminiClientError,
  defaultModel,
  fallbackModels,
  resolveModel,
  CURRENT_FLASH_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEPRECATED_MODELS
};
