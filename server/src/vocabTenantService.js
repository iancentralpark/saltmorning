/**
 * Vocab Booster multi-tenant registry + session JWT helpers.
 *
 * Host servers authenticate with a tenant API secret (stored hashed in
 * vocab_tenants.secret_hash). Central then mints a short-lived student
 * session token signed with VOCAB_PLATFORM_SECRET for the embed /v1 API.
 */
'use strict';

const crypto = require('crypto');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

const SESSION_TTL_MS = Number(process.env.VOCAB_SESSION_TTL_MS) || 12 * 60 * 60 * 1000;
const TENANT_CACHE_TTL_MS = 60 * 1000;
const tenantCache = new Map();

function platformSecret() {
  return (
    process.env.VOCAB_PLATFORM_SECRET ||
    process.env.STUDENT_AUTH_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    'vocab-platform-dev-secret'
  );
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
}

function generateApiSecret() {
  return 'vbsec_' + crypto.randomBytes(24).toString('base64url');
}

function timingSafeEqualHex(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(aa, 'utf8'), Buffer.from(bb, 'utf8'));
  } catch (e) {
    return false;
  }
}

function readBearerToken(req) {
  const h = (req && req.headers && req.headers.authorization) || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

function cacheGet(key) {
  const hit = tenantCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    tenantCache.delete(key);
    return null;
  }
  return hit.tenant;
}

function cacheSet(tenant) {
  if (!tenant || !tenant.id) return tenant;
  const entry = { tenant, exp: Date.now() + TENANT_CACHE_TTL_MS };
  tenantCache.set('id:' + tenant.id, entry);
  if (tenant.public_key) tenantCache.set('pk:' + tenant.public_key, entry);
  return tenant;
}

function normalizeTenant(row) {
  if (!row) return null;
  let features = row.features || {};
  if (typeof features === 'string') {
    try {
      features = JSON.parse(features);
    } catch (e) {
      features = {};
    }
  }
  return {
    id: String(row.id),
    name: row.name || row.id,
    publicKey: row.public_key || null,
    secretHash: row.secret_hash || null,
    features: features && typeof features === 'object' ? features : {},
    active: row.active !== false
  };
}

async function loadTenantRow(column, value) {
  if (!isSupabaseEnabled()) throw new Error('Supabase is required for Vocab Booster tenants.');
  const db = getSupabase();
  const { data, error } = await db
    .from('vocab_tenants')
    .select('id,name,public_key,secret_hash,features,active')
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeTenant(data);
}

async function getTenantById(tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) return null;
  const cached = cacheGet('id:' + id);
  if (cached) return cached;
  return cacheSet(await loadTenantRow('id', id));
}

async function getTenantByPublicKey(publicKey) {
  const pk = String(publicKey || '').trim();
  if (!pk) return null;
  const cached = cacheGet('pk:' + pk);
  if (cached) return cached;
  return cacheSet(await loadTenantRow('public_key', pk));
}

async function listTenants() {
  if (!isSupabaseEnabled()) return [];
  const db = getSupabase();
  const { data, error } = await db
    .from('vocab_tenants')
    .select('id,name,public_key,features,active,created_at,updated_at')
    .order('id');
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeTenant);
}

/**
 * Verify a host-presented tenant API secret.
 * Accepts tenant id or public_key via opts.
 */
async function verifyTenantApiSecret(secret, opts) {
  opts = opts || {};
  const raw = String(secret || '').trim();
  if (!raw) return null;

  let tenant = null;
  if (opts.tenantId) tenant = await getTenantById(opts.tenantId);
  else if (opts.publicKey) tenant = await getTenantByPublicKey(opts.publicKey);

  if (!tenant || !tenant.active) return null;
  if (!tenant.secretHash) return null;
  if (!timingSafeEqualHex(hashSecret(raw), tenant.secretHash)) return null;
  return tenant;
}

function signStudentSession(payload) {
  const tenantId = String(payload.tenantId || '').trim();
  const studentId = String(payload.studentId || '').trim();
  const classId = String(payload.classId || '').trim();
  if (!tenantId || !studentId || !classId) {
    throw new Error('tenantId, studentId, and classId are required');
  }
  const body = {
    typ: 'vocab_v1',
    tenantId,
    studentId,
    classId,
    name: payload.name ? String(payload.name).slice(0, 120) : undefined,
    exp: Date.now() + SESSION_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', platformSecret()).update(data).digest('base64url');
  return {
    token: data + '.' + sig,
    expiresAt: body.exp,
    session: {
      tenantId,
      studentId,
      classId,
      name: body.name || null
    }
  };
}

function verifyStudentSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', platformSecret()).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (body.typ !== 'vocab_v1') return null;
    if (!body.tenantId || !body.studentId || !body.classId || !body.exp) return null;
    if (Date.now() > Number(body.exp)) return null;
    return {
      tenantId: String(body.tenantId),
      studentId: String(body.studentId),
      classId: String(body.classId),
      name: body.name ? String(body.name) : null,
      exp: Number(body.exp)
    };
  } catch (e) {
    return null;
  }
}

function skipLuckyDrawForTenant(tenant) {
  if (!tenant) return false;
  if (tenant.features && tenant.features.luckyDraw === false) return true;
  return false;
}

function invalidateTenantCache() {
  tenantCache.clear();
}

/**
 * Persist a new API secret hash for a tenant. Returns the plaintext secret
 * once (caller must store it); only the hash is written to the DB.
 */
async function rotateTenantApiSecret(tenantId) {
  const id = String(tenantId || '').trim();
  if (!id) throw new Error('tenantId required');
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const secret = generateApiSecret();
  const db = getSupabase();
  const { data, error } = await db
    .from('vocab_tenants')
    .update({
      secret_hash: hashSecret(secret),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('id,name,public_key,features,active')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Tenant not found: ' + id);
  invalidateTenantCache();
  return { tenant: normalizeTenant(data), secret };
}

function slugifyTenantId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function createTenant(opts) {
  opts = opts || {};
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const id = slugifyTenantId(opts.id || opts.name);
  if (!id) throw new Error('Tenant id / name required');
  const name = String(opts.name || id).trim();
  const publicKey = String(opts.publicKey || ('pk_' + id.replace(/-/g, '_'))).trim();
  const features =
    opts.features && typeof opts.features === 'object'
      ? opts.features
      : { luckyDraw: false, dollarsMode: 'none' };
  const secret = generateApiSecret();
  const db = getSupabase();
  const { data, error } = await db
    .from('vocab_tenants')
    .insert({
      id,
      name,
      public_key: publicKey,
      secret_hash: hashSecret(secret),
      features,
      active: opts.active !== false,
      updated_at: new Date().toISOString()
    })
    .select('id,name,public_key,features,active,created_at,updated_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  invalidateTenantCache();
  return { tenant: normalizeTenant(data), secret };
}

async function updateTenant(tenantId, opts) {
  opts = opts || {};
  const id = String(tenantId || '').trim();
  if (!id) throw new Error('tenantId required');
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const patch = { updated_at: new Date().toISOString() };
  if (opts.name != null) patch.name = String(opts.name).trim();
  if (opts.publicKey != null) patch.public_key = String(opts.publicKey).trim();
  if (opts.active != null) patch.active = !!opts.active;
  if (opts.features && typeof opts.features === 'object') patch.features = opts.features;
  const db = getSupabase();
  const { data, error } = await db
    .from('vocab_tenants')
    .update(patch)
    .eq('id', id)
    .select('id,name,public_key,features,active,created_at,updated_at')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Tenant not found: ' + id);
  invalidateTenantCache();
  return normalizeTenant(data);
}

async function getPlatformAnalytics() {
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const db = getSupabase();
  const tenants = await listTenants();

  const { count: wordCount, error: wErr } = await db
    .from('vocab_words')
    .select('word_id', { count: 'exact', head: true })
    .eq('active', true);
  if (wErr) throw new Error(wErr.message);

  const today = new Date().toISOString().slice(0, 10);
  const perTenant = [];

  for (const t of tenants) {
    const [{ count: learners }, { count: placed }, { data: dailyRows }] = await Promise.all([
      db
        .from('vocab_student_state')
        .select('student_id', { count: 'exact', head: true })
        .eq('tenant_id', t.id),
      db
        .from('vocab_student_state')
        .select('student_id', { count: 'exact', head: true })
        .eq('tenant_id', t.id)
        .not('placement_at', 'is', null),
      db
        .from('vocab_daily_progress')
        .select('student_id,test_passed,studied_count')
        .eq('tenant_id', t.id)
        .eq('quest_date', today)
    ]);
    const daily = dailyRows || [];
    perTenant.push({
      tenantId: t.id,
      name: t.name,
      active: t.active,
      learners: learners || 0,
      placed: placed || 0,
      activeToday: daily.length,
      questPassedToday: daily.filter((d) => d.test_passed).length,
      hasSecret: !!t.secretHash
    });
  }

  let packCount = 0;
  try {
    const { count } = await db
      .from('vocab_curriculum_packs')
      .select('id', { count: 'exact', head: true })
      .eq('active', true);
    packCount = count || 0;
  } catch (e) {
    packCount = 0;
  }

  return {
    wordBankActive: wordCount || 0,
    packCount,
    tenants: perTenant,
    totals: {
      tenants: tenants.length,
      activeTenants: tenants.filter((t) => t.active).length,
      learners: perTenant.reduce((s, t) => s + t.learners, 0),
      placed: perTenant.reduce((s, t) => s + t.placed, 0),
      activeToday: perTenant.reduce((s, t) => s + t.activeToday, 0)
    }
  };
}

module.exports = {
  SESSION_TTL_MS,
  hashSecret,
  generateApiSecret,
  readBearerToken,
  getTenantById,
  getTenantByPublicKey,
  listTenants,
  verifyTenantApiSecret,
  signStudentSession,
  verifyStudentSession,
  skipLuckyDrawForTenant,
  rotateTenantApiSecret,
  createTenant,
  updateTenant,
  getPlatformAnalytics,
  invalidateTenantCache,
  platformSecret
};
