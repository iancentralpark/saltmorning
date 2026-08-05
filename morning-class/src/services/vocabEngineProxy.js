'use strict';

/**
 * Thin proxy client → Mr.Park Vocab Booster `/api/vocab/v1`.
 *
 * Preferred auth (engine contract):
 *   Authorization: Bearer <VOCAB_ENGINE_TOKEN>
 *   X-Vocab-Tenant: salt-morning
 *   X-Vocab-Student-Id / X-Vocab-Class-Id
 *
 * Fallbacks (until engine token routes are live):
 *   1) Mint student JWT via POST /session (tenant API secret) and call v1
 *   2) Caller falls back to local vocabShared vendor
 */

const TENANT_ID = String(process.env.VOCAB_TENANT_ID || 'salt-morning').trim() || 'salt-morning';

function engineOrigin() {
  return String(
    process.env.VOCAB_ENGINE_URL ||
      process.env.VOCAB_CENTRAL_API_BASE ||
      ''
  ).replace(/\/$/, '');
}

function engineToken() {
  return String(process.env.VOCAB_ENGINE_TOKEN || '').trim();
}

function tenantApiSecret() {
  return String(process.env.VOCAB_TENANT_API_SECRET || '').trim();
}

function publicKey() {
  return String(process.env.VOCAB_TENANT_PUBLIC_KEY || 'pk_salt_morning').trim();
}

function isConfigured() {
  return !!(engineOrigin() && (engineToken() || tenantApiSecret()));
}

async function parseJson(res) {
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { error: text && text.slice(0, 200) };
  }
  return data;
}

/**
 * @param {string} enginePath e.g. '/summary' or '/placement/item'
 * @param {{ method?: string, body?: object, query?: string, studentId: string, classId: string }} opts
 */
async function engineFetch(enginePath, opts) {
  const origin = engineOrigin();
  if (!origin) {
    const err = new Error('VOCAB_ENGINE_URL (or VOCAB_CENTRAL_API_BASE) is not set.');
    err.statusCode = 503;
    err.code = 'ENGINE_NOT_CONFIGURED';
    throw err;
  }

  const method = (opts.method || 'GET').toUpperCase();
  const studentId = String(opts.studentId || '').trim();
  const classId = String(opts.classId || '').trim();
  const q = opts.query ? (opts.query.startsWith('?') ? opts.query : '?' + opts.query) : '';
  const url = origin + '/api/vocab/v1' + enginePath + q;

  const token = engineToken();
  if (token) {
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'X-Vocab-Engine-Token': token,
      'X-Vocab-Tenant': TENANT_ID,
      'X-Vocab-Tenant-Id': TENANT_ID,
      'X-Vocab-Student-Id': studentId,
      'X-Vocab-Class-Id': classId
    };
    if (opts.body != null) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined
    });
    const data = await parseJson(res);
    if (res.ok) {
      return { ok: true, status: res.status, data, mode: 'engine-token' };
    }
    // 401/404/501 → try session JWT fallback for older v1 surface
    if (![401, 403, 404, 501, 502, 503].includes(res.status)) {
      const err = new Error(data.error || data.message || ('Vocab engine HTTP ' + res.status));
      err.statusCode = res.status;
      err.engine = data;
      throw err;
    }
  }

  // Session JWT fallback (legacy multi-tenant v1)
  const secret = tenantApiSecret();
  if (!secret) {
    const err = new Error(
      token
        ? 'Vocab engine rejected the request and no VOCAB_TENANT_API_SECRET fallback is set.'
        : 'VOCAB_ENGINE_TOKEN not set and VOCAB_TENANT_API_SECRET fallback is missing.'
    );
    err.statusCode = 503;
    err.code = 'ENGINE_UNAVAILABLE';
    throw err;
  }

  const session = await mintStudentSession(studentId, classId, opts.name);
  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + session.token
  };
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  const data = await parseJson(res);
  if (!res.ok) {
    const err = new Error(data.error || data.message || ('Vocab engine HTTP ' + res.status));
    err.statusCode = res.status;
    err.engine = data;
    err.code = res.status === 404 ? 'ENGINE_ROUTE_MISSING' : 'ENGINE_ERROR';
    throw err;
  }
  return { ok: true, status: res.status, data, mode: 'session-jwt' };
}

async function mintStudentSession(studentId, classId, name) {
  const origin = engineOrigin();
  const secret = tenantApiSecret();
  const res = await fetch(origin + '/api/vocab/v1/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + secret,
      'X-Vocab-Tenant-Id': TENANT_ID,
      'X-Vocab-Public-Key': publicKey()
    },
    body: JSON.stringify({
      studentId,
      classId,
      name,
      tenantId: TENANT_ID,
      publicKey: publicKey()
    })
  });
  const data = await parseJson(res);
  if (!res.ok || !data.token) {
    const err = new Error(data.error || 'Could not mint Vocab engine session.');
    err.statusCode = res.status || 502;
    throw err;
  }
  return data;
}

async function probeHealth() {
  const origin = engineOrigin();
  const out = {
    configured: isConfigured(),
    origin: origin || null,
    tenantId: TENANT_ID,
    hasEngineToken: !!engineToken(),
    hasTenantSecret: !!tenantApiSecret(),
    health: null,
    meta: null,
    mode: null,
    error: null
  };
  if (!origin) {
    out.error = 'VOCAB_ENGINE_URL not set';
    return out;
  }

  try {
    const token = engineToken();
    const headers = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
      headers['X-Vocab-Engine-Token'] = token;
      headers['X-Vocab-Tenant'] = TENANT_ID;
      headers['X-Vocab-Tenant-Id'] = TENANT_ID;
    }
    const hRes = await fetch(origin + '/api/vocab/v1/health', { headers });
    if (hRes.ok) {
      out.health = await parseJson(hRes);
      out.mode = token ? 'engine-token' : 'open-health';
    } else {
      out.health = { ok: false, status: hRes.status, ...(await parseJson(hRes)) };
    }
  } catch (e) {
    out.error = e.message || String(e);
  }

  try {
    const mRes = await fetch(
      origin + '/api/vocab/v1/meta?publicKey=' + encodeURIComponent(publicKey()),
      { headers: { Accept: 'application/json' } }
    );
    if (mRes.ok) out.meta = await parseJson(mRes);
  } catch (e) {
    /* ignore */
  }

  return out;
}

/**
 * Proxy helper: try engine, on missing-route / unavailable return null so caller
 * can use local vocabShared.
 */
async function tryEngine(enginePath, opts) {
  if (!isConfigured()) return null;
  try {
    const result = await engineFetch(enginePath, opts);
    return result.data;
  } catch (e) {
    if (
      e.code === 'ENGINE_ROUTE_MISSING' ||
      e.code === 'ENGINE_NOT_CONFIGURED' ||
      e.code === 'ENGINE_UNAVAILABLE' ||
      e.statusCode === 404 ||
      e.statusCode === 501 ||
      e.statusCode === 503
    ) {
      console.warn('[vocab-engine] fallback local:', enginePath, e.message);
      return null;
    }
    throw e;
  }
}

module.exports = {
  TENANT_ID,
  engineOrigin,
  engineToken,
  isConfigured,
  engineFetch,
  tryEngine,
  probeHealth,
  mintStudentSession
};
