const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const DEPRECATED_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-exp'];

const CLASSROOM_SYSTEM_HINT =
  'You are a helpful assistant for an English classroom teacher (children and teens). ' +
  'Give clear, practical answers. When asked for lesson ideas, vocabulary, or explanations, ' +
  'keep them classroom-ready and age-appropriate. Be concise unless more detail is requested.';

let sdkPromise = null;

function getAiSdk() {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('ai'),
      import('@ai-sdk/google')
    ]).then(function(mods) {
      return {
        generateText: mods[0].generateText,
        streamText: mods[0].streamText,
        createGoogleGenerativeAI: mods[1].createGoogleGenerativeAI
      };
    });
  }
  return sdkPromise;
}

function isGeminiConfigured() {
  return !!String(process.env.GEMINI_API_KEY || '').trim();
}

function extractErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.message) return String(err.message);
  if (err.cause && err.cause.message) return String(err.cause.message);
  if (err.data && err.data.error && err.data.error.message) return String(err.data.error.message);
  return String(err);
}

function parseRetryDelayMs(errorMsg) {
  const m = String(errorMsg || '').match(/retry in ([\d.]+)s/i);
  if (!m) return 0;
  const sec = Number(m[1]);
  if (!sec || sec <= 0 || sec > 120) return 0;
  return Math.ceil(sec * 1000) + 250;
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function isQuotaError(errorMsg) {
  return /quota|rate limit|resource_exhausted|429/i.test(String(errorMsg || ''));
}

function isTransientGeminiError(errorMsg) {
  if (isQuotaError(errorMsg)) return false;
  return /high demand|experiencing high demand|overloaded|temporarily unavailable|503|UNAVAILABLE/i.test(
    String(errorMsg || '')
  );
}

let geminiChain = Promise.resolve();
let lastGeminiCallAt = 0;
const GEMINI_MIN_GAP_MS = Number(process.env.GEMINI_MIN_GAP_MS) || 0;
let geminiCallsToday = 0;
let geminiCallsDayKey = '';

function pacificDateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function bumpGeminiCallCount() {
  const key = pacificDateKey();
  if (key !== geminiCallsDayKey) {
    geminiCallsDayKey = key;
    geminiCallsToday = 0;
  }
  geminiCallsToday += 1;
}

function getGeminiCallStats() {
  return { day: geminiCallsDayKey || pacificDateKey(), calls: geminiCallsToday };
}

function parseQuotaKind(errorMsg) {
  const msg = String(errorMsg || '');
  if (/PerDay|per day|PerModelPerDay|RequestsPerDay/i.test(msg)) return 'daily';
  if (/PerMinute|per minute|RequestsPerMinute/i.test(msg)) return 'minute';
  if (/free_tier/i.test(msg) && /limit:\s*20\b/i.test(msg)) return 'daily';
  return 'unknown';
}

function runGeminiQueued(fn, opts) {
  if (opts && opts.skipGeminiQueue) return fn();
  const run = geminiChain.then(async function() {
    const elapsed = Date.now() - lastGeminiCallAt;
    const wait = Math.max(0, GEMINI_MIN_GAP_MS - elapsed);
    if (wait > 0) await sleep(wait);
    lastGeminiCallAt = Date.now();
    return fn();
  });
  geminiChain = run.catch(function() {});
  return run;
}

function formatGeminiClientError(errorMsg, options) {
  const opts = options || {};
  const msg = String(errorMsg || '');
  if (/high demand|experiencing high demand|overloaded/i.test(msg)) {
    if (opts.audience === 'student') {
      return 'English Buddy could not connect just now. Please try again in a moment.';
    }
    return 'Ask Genius could not connect just now. Please try again in a moment.';
  }
  if (/no longer available/i.test(msg)) {
    if (opts.audience === 'student') {
      return 'English Buddy is updating. Please try again in a moment.';
    }
    return 'Ask Genius is updating. Please try again in a moment.';
  }
  if (/free_tier|generate_content_free_tier/i.test(msg)) {
    const kind = parseQuotaKind(msg);
    const retryM = msg.match(/retry in ([\d.]+)s/i);
    if (kind === 'minute' && retryM) {
      const sec = Math.ceil(Number(retryM[1]));
      if (opts.audience === 'student') {
        return 'English Buddy is busy right now. Wait about ' + sec + ' seconds and try again.';
      }
      return 'Ask Genius is busy — wait about ' + sec + ' seconds and try again.';
    }
    if (opts.audience === 'student') {
      return 'English Buddy used up today\'s free AI limit for this class (~20 requests/day per model on Google\'s free plan). Try again after about 5 PM Korea time, or ask Mr. Park.';
    }
    return 'Today\'s free Gemini limit is used up (~20 requests/day per model). Resets after midnight US Pacific time, or enable billing in Google AI Studio.';
  }
  if (/quota|rate limit|resource_exhausted|429/i.test(msg)) {
    const kind = parseQuotaKind(msg);
    const m = msg.match(/retry in ([\d.]+)s/i);
    if (kind === 'minute' && m) {
      const sec = Math.ceil(Number(m[1]));
      if (opts.audience === 'student') {
        return 'English Buddy is busy right now. Please wait about ' + sec + ' seconds and try again.';
      }
      return 'Ask Genius is busy — wait about ' + sec + ' seconds and try again.';
    }
    if (kind === 'daily' || /limit:\s*20\b/i.test(msg)) {
      if (opts.audience === 'student') {
        return 'English Buddy used up today\'s free AI limit. Try again after about 5 PM Korea time, or ask Mr. Park.';
      }
      return 'Today\'s free Gemini limit is used up. Resets after midnight US Pacific time.';
    }
    if (opts.audience === 'student') {
      return 'English Buddy is busy right now. Please wait a moment and try again.';
    }
    return 'Ask Genius is busy right now. Please wait a moment and try again.';
  }
  if (/timed out|timeout|AbortError/i.test(msg)) {
    if (opts.audience === 'student') {
      return 'English Buddy took too long. Please try a shorter message.';
    }
    return 'Ask Genius timed out. Please try a shorter message.';
  }
  return msg || 'Could not get a response. Please try again.';
}

function buildProviderOptions(opts, model) {
  const thinkingBudget = opts.thinkingBudget != null
    ? opts.thinkingBudget
    : (/gemini-2\.5/i.test(String(model || '')) ? 0 : undefined);
  if (thinkingBudget == null) return undefined;
  return { google: { thinkingConfig: { thinkingBudget: thinkingBudget } } };
}

function buildContents(prompt, history) {
  const prior = Array.isArray(history) ? history : [];
  const contents = [];
  prior.forEach(function(msg) {
    const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
    const body = String(msg.text || msg.content || '').trim();
    if (!body) return;
    contents.push({ role: role, parts: [{ text: body }] });
  });
  contents.push({ role: 'user', parts: [{ text: String(prompt || '').trim() }] });
  return contents;
}

function buildSdkMessages(contents) {
  return contents.map(function(c) {
    return {
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts[0].text
    };
  });
}

function buildGenerateParams(apiKey, model, contents, opts) {
  const params = {
    model: null,
    system: opts.systemInstruction || CLASSROOM_SYSTEM_HINT,
    messages: buildSdkMessages(contents),
    maxOutputTokens: opts.maxOutputTokens || 1200,
    temperature: opts.temperature != null ? opts.temperature : 0.65
  };
  const providerOptions = buildProviderOptions(opts, model);
  if (providerOptions) params.providerOptions = providerOptions;
  if (opts.timeoutMs > 0 && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    params.abortSignal = AbortSignal.timeout(opts.timeoutMs);
  }
  return getAiSdk().then(function(sdk) {
    const google = sdk.createGoogleGenerativeAI({ apiKey: apiKey });
    params.model = google(model);
    return { sdk: sdk, params: params };
  });
}

async function callGeminiOnce(apiKey, model, contents, opts) {
  bumpGeminiCallCount();
  try {
    const built = await buildGenerateParams(apiKey, model, contents, opts);
    const result = await built.sdk.generateText(built.params);
    const answer = String(result.text || '').trim();
    if (!answer) {
      return {
        ok: false,
        error: 'Gemini returned an empty response.',
        transient: true
      };
    }
    return { ok: true, answer: answer, model: model };
  } catch (err) {
    const errMsg = extractErrorMessage(err);
    if (err && (err.name === 'AbortError' || /timed out|timeout/i.test(errMsg))) {
      return { ok: false, error: 'Gemini request timed out.', status: 408 };
    }
    return {
      ok: false,
      error: errMsg,
      status: /429/.test(errMsg) ? 429 : undefined,
      transient: /503|UNAVAILABLE/i.test(errMsg) || isTransientGeminiError(errMsg)
    };
  }
}

async function askGemini(prompt, history, options) {
  const opts = options || {};
  return runGeminiQueued(function() {
    return askGeminiInner(prompt, history, opts);
  }, opts);
}

async function askGeminiInner(prompt, history, options) {
  const opts = options || {};
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Enter a question for Gemini.');
  if (!apiKey) {
    return { ok: false, fallbackWeb: true, error: 'Gemini API key not configured on server.' };
  }

  const contents = buildContents(text, history);

  const models = [];
  if (opts.model) models.push(opts.model);
  if (Array.isArray(opts.fallbackModels)) {
    opts.fallbackModels.forEach(function(m) {
      if (m && models.indexOf(m) === -1 && DEPRECATED_MODELS.indexOf(m) === -1) models.push(m);
    });
  }
  if (!models.length) models.push(GEMINI_MODEL);

  let last = { ok: false, error: 'Gemini API error.' };
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const callOpts = Object.assign({}, opts, { model: model });
    last = await callGeminiOnce(apiKey, model, contents, callOpts);
    if (last.ok) return last;

    const maxOverloadRetries = opts.overloadRetries || 0;
    for (let r = 0; r < maxOverloadRetries; r++) {
      const overloadHit = last.transient || isTransientGeminiError(last.error);
      if (!overloadHit) break;
      const delay = (opts.overloadRetryDelayMs || 3000) * (r + 1);
      await sleep(delay);
      last = await callGeminiOnce(apiKey, model, contents, callOpts);
      if (last.ok) return last;
    }

    const quota = isQuotaError(last.error);
    const quotaKind = parseQuotaKind(last.error);
    const overload = !quota && (last.transient || isTransientGeminiError(last.error));

    if (quota && quotaKind === 'minute' && !opts.skipQuotaSleep) {
      const retryMs = parseRetryDelayMs(last.error);
      const maxWait = opts.maxQuotaRetryMs != null ? opts.maxQuotaRetryMs : 15000;
      const capped = retryMs > 0 ? Math.min(retryMs, maxWait) : 0;
      if (capped > 0) {
        await sleep(capped);
        last = await callGeminiOnce(apiKey, model, contents, callOpts);
        if (last.ok) return last;
      }
    }

    if (quota) {
      console.warn('[gemini] quota', { model: model, kind: quotaKind, error: String(last.error || '').slice(0, 240) });
      break;
    }

    const hasMoreModels = i < models.length - 1;
    if (hasMoreModels && overload) {
      const delay = opts.fallbackDelayMs != null ? opts.fallbackDelayMs : 500;
      if (delay > 0) await sleep(delay);
      continue;
    }
    if (!overload && !quota) break;
  }

  return { ok: false, error: formatGeminiClientError(last.error, opts) };
}

function teacherGeminiOptions() {
  const primary = process.env.TEACHER_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const fallbacks = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'].filter(function(m) {
    return m && m !== primary && DEPRECATED_MODELS.indexOf(m) === -1;
  });
  return {
    model: primary,
    fallbackModels: fallbacks,
    skipQuotaSleep: true,
    overloadRetries: 2,
    overloadRetryDelayMs: 3000,
    fallbackDelayMs: 500,
    timeoutMs: 35000,
    maxOutputTokens: 1200,
    temperature: 0.65
  };
}

function writeSse(res, payload) {
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
}

async function streamAskGemini(res, prompt, history, options) {
  const opts = options || teacherGeminiOptions();
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    res.status(503).json({ ok: false, error: 'Gemini is not configured.' });
    return;
  }

  const model = opts.model || GEMINI_MODEL;
  const text = String(prompt || '').trim();
  if (!text) {
    res.status(400).json({ ok: false, error: 'prompt is required' });
    return;
  }

  try {
    const contents = buildContents(text, history);
    bumpGeminiCallCount();
    const built = await buildGenerateParams(apiKey, model, contents, opts);
    const result = built.sdk.streamText(built.params);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let full = '';
    for await (const delta of result.textStream) {
      if (!delta) continue;
      full += delta;
      writeSse(res, { text: delta });
    }

    const finalAnswer = String((await result.text) || full || '').trim();
    let extras = {};
    if (typeof opts.onComplete === 'function') {
      extras = opts.onComplete({ answer: finalAnswer, model: model }) || {};
    }
    writeSse(res, Object.assign({ done: true, answer: finalAnswer, model: model }, extras));
    res.end();
  } catch (err) {
    const errMsg = extractErrorMessage(err);
    const clientMsg = formatGeminiClientError(errMsg, opts);
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: clientMsg });
      return;
    }
    writeSse(res, { error: clientMsg, done: true });
    res.end();
  }
}

module.exports = {
  isGeminiConfigured,
  askGemini,
  streamAskGemini,
  formatGeminiClientError,
  teacherGeminiOptions,
  getGeminiCallStats
};
