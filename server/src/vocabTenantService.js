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

const PROMOTE_AT = 400;

function learnerRowFromState(st, daily, profile) {
  const placed = !!(st && st.placement_at);
  const score = Math.max(0, Math.min(PROMOTE_AT, Number(st && st.promotion_score) || 0));
  const shield = Math.max(0, Math.round(Number(st && st.promotion_shield_count) || 0));
  const division = score >= PROMOTE_AT / 2 ? 2 : 1;
  profile = profile || {};
  return {
    studentId: st.student_id,
    name: profile.name || null,
    schoolName: profile.schoolName || null,
    schoolGrade: profile.schoolGrade != null ? profile.schoolGrade : null,
    classId: profile.classId || st.class_id || null,
    className: profile.className || null,
    placed,
    placementAt: st.placement_at || null,
    tierName: placed ? st.tier_name : null,
    tierLabel: placed ? (st.tier_name + ' ' + division) : null,
    tierDivision: placed ? division : null,
    gradeLevel: placed ? st.grade_level : null,
    ratingScore: placed ? st.rating_score : null,
    promotionScore: placed ? score : 0,
    promotionScoreMax: PROMOTE_AT,
    promotionPercent: placed ? Math.round((score / PROMOTE_AT) * 1000) / 10 : 0,
    remainingToPromote: placed ? Math.round(Math.max(0, PROMOTE_AT - score) * 10) / 10 : PROMOTE_AT,
    shieldCount: placed ? shield : 0,
    streakDays: st.streak_days || 0,
    longestStreak: st.longest_streak || 0,
    updatedAt: st.updated_at || null,
    todayStudied: daily ? daily.studied_count || 0 : 0,
    todayTarget: daily ? daily.target_count || null : null,
    todayTestPassed: daily ? !!daily.test_passed : false,
    todayTestScore: daily ? daily.test_score : null
  };
}

async function upsertLearnerProfile(tenantId, studentId, fields) {
  const tid = String(tenantId || '').trim();
  const sid = String(studentId || '').trim();
  if (!tid || !sid || !isSupabaseEnabled()) return null;
  fields = fields || {};
  const row = {
    tenant_id: tid,
    student_id: sid,
    updated_at: new Date().toISOString()
  };
  if (fields.name != null) row.name = String(fields.name).trim() || null;
  if (fields.schoolName != null) row.school_name = String(fields.schoolName).trim() || null;
  if (fields.classId != null) row.class_id = String(fields.classId).trim() || null;
  if (fields.className != null) row.class_name = String(fields.className).trim() || null;
  if (fields.schoolGrade != null) {
    const g = Number(fields.schoolGrade);
    row.school_grade = Number.isFinite(g) ? Math.round(g) : null;
  }
  const db = getSupabase();
  const { error } = await db.from('vocab_learner_profiles').upsert(row, {
    onConflict: 'tenant_id,student_id'
  });
  if (error) {
    // Table may not exist yet on older deploys.
    if (!/does not exist|relation/i.test(error.message)) {
      console.warn('upsertLearnerProfile', error.message);
    }
    return null;
  }
  return row;
}

async function loadStoredProfiles(tenantId, studentIds) {
  const map = new Map();
  if (!isSupabaseEnabled() || !studentIds.length) return map;
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('vocab_learner_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('student_id', studentIds);
    if (error) throw error;
    (data || []).forEach((row) => {
      map.set(String(row.student_id), {
        name: row.name || null,
        schoolName: row.school_name || null,
        classId: row.class_id || null,
        className: row.class_name || null,
        schoolGrade: row.school_grade != null ? Number(row.school_grade) : null
      });
    });
  } catch (e) {
    /* profiles table optional */
  }
  return map;
}

async function loadMrParkHostProfiles(studentIds) {
  const map = new Map();
  if (!isSupabaseEnabled() || !studentIds.length) return map;
  const db = getSupabase();
  const { data: students, error } = await db
    .from('students')
    .select('id,name,class_id,school_grade')
    .in('id', studentIds);
  if (error) {
    console.warn('loadMrParkHostProfiles', error.message);
    return map;
  }
  const classIds = Array.from(
    new Set((students || []).map((s) => s.class_id).filter(Boolean).map(String))
  );
  let classNames = {};
  if (classIds.length) {
    const { data: classes } = await db.from('classes').select('id,name').in('id', classIds);
    (classes || []).forEach((c) => {
      classNames[String(c.id)] = String(c.name || c.id);
    });
  }
  (students || []).forEach((s) => {
    const classId = s.class_id ? String(s.class_id) : null;
    map.set(String(s.id), {
      name: s.name ? String(s.name) : null,
      schoolName: 'Mr. Park App',
      classId,
      className: classId ? classNames[classId] || classId : null,
      schoolGrade: s.school_grade != null ? Number(s.school_grade) : null
    });
  });
  return map;
}

async function loadRemoteHostProfiles(tenant, studentIds) {
  const map = new Map();
  if (!tenant || !studentIds.length) return map;
  const features = tenant.features || {};
  const url =
    features.directoryUrl ||
    process.env['VOCAB_DIRECTORY_URL_' + String(tenant.id).replace(/-/g, '_')] ||
    (tenant.id === 'salt-morning'
      ? process.env.VOCAB_DIRECTORY_URL_salt_morning ||
        'https://www.saltmorning.study/api/vocab/directory'
      : null);
  const platformKey = platformSecret();
  if (!url || !platformKey || platformKey === 'vocab-platform-dev-secret') return map;
  try {
    const endpoint =
      String(url).replace(/\/$/, '') +
      '?ids=' +
      encodeURIComponent(studentIds.join(','));
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'X-Vocab-Platform-Key': platformKey,
        'X-Vocab-Tenant-Id': tenant.id
      },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(8000)
        : undefined
    });
    if (!res.ok) {
      console.warn('loadRemoteHostProfiles', tenant.id, res.status);
      return map;
    }
    const payload = await res.json();
    const list = (payload && payload.students) || [];
    list.forEach((s) => {
      if (!s || !s.studentId) return;
      map.set(String(s.studentId), {
        name: s.name || null,
        schoolName: s.schoolName || tenant.name || null,
        classId: s.classId || null,
        className: s.className || null,
        schoolGrade: s.schoolGrade != null ? Number(s.schoolGrade) : null
      });
    });
  } catch (e) {
    console.warn('loadRemoteHostProfiles', tenant.id, e.message || e);
  }
  return map;
}

function mergeProfileMaps() {
  const out = new Map();
  Array.from(arguments).forEach((m) => {
    if (!m) return;
    m.forEach((val, key) => {
      const prev = out.get(key) || {};
      out.set(key, {
        name: val.name || prev.name || null,
        schoolName: val.schoolName || prev.schoolName || null,
        classId: val.classId || prev.classId || null,
        className: val.className || prev.className || null,
        schoolGrade:
          val.schoolGrade != null
            ? val.schoolGrade
            : prev.schoolGrade != null
              ? prev.schoolGrade
              : null
      });
    });
  });
  return out;
}

async function enrichLearnerProfiles(tenant, studentIds) {
  const tid = tenant && tenant.id;
  const ids = (studentIds || []).map(String);
  if (!tid || !ids.length) return new Map();
  const stored = await loadStoredProfiles(tid, ids);
  let host = new Map();
  if (tid === 'mrpark') {
    host = await loadMrParkHostProfiles(ids);
  } else {
    host = await loadRemoteHostProfiles(tenant, ids);
  }
  const merged = mergeProfileMaps(stored, host);
  // Cache fresh host data into profiles for faster next open.
  const writes = [];
  merged.forEach((p, sid) => {
    if (!p.name && !p.className) return;
    writes.push(
      upsertLearnerProfile(tid, sid, {
        name: p.name,
        schoolName: p.schoolName || tenant.name,
        classId: p.classId,
        className: p.className,
        schoolGrade: p.schoolGrade
      })
    );
  });
  if (writes.length) Promise.all(writes).catch(() => {});
  return merged;
}

/**
 * Platform admin: all learners for a tenant (from vocab_student_state, no host roster).
 */
async function listTenantLearners(tenantId, opts) {
  opts = opts || {};
  const tid = String(tenantId || '').trim();
  if (!tid) throw new Error('tenantId required');
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const db = getSupabase();
  const tenant = await getTenantById(tid);
  if (!tenant) throw new Error('Tenant not found');
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200));
  const search = String(opts.search || '').trim();

  let query = db
    .from('vocab_student_state')
    .select('*')
    .eq('tenant_id', tid)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (search) {
    // Match student id; name filter applied after enrichment.
    query = query.ilike('student_id', '%' + search + '%');
  }

  const { data: states, error } = await query;
  if (error) throw new Error(error.message);
  let rows = states || [];

  // If search looks like a name, also pull profiles and filter.
  if (search && !/^s?\d+/i.test(search)) {
    try {
      const { data: named } = await db
        .from('vocab_learner_profiles')
        .select('student_id')
        .eq('tenant_id', tid)
        .ilike('name', '%' + search + '%')
        .limit(limit);
      const extraIds = (named || []).map((r) => r.student_id);
      if (extraIds.length) {
        const { data: extraStates } = await db
          .from('vocab_student_state')
          .select('*')
          .eq('tenant_id', tid)
          .in('student_id', extraIds);
        const seen = new Set(rows.map((r) => r.student_id));
        (extraStates || []).forEach((st) => {
          if (!seen.has(st.student_id)) rows.push(st);
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  if (!rows.length) return { learners: [], total: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const ids = rows.map((r) => r.student_id);
  const [{ data: dailies, error: dErr }, profiles] = await Promise.all([
    db
      .from('vocab_daily_progress')
      .select('*')
      .eq('tenant_id', tid)
      .eq('quest_date', today)
      .in('student_id', ids),
    enrichLearnerProfiles(tenant, ids)
  ]);
  if (dErr) throw new Error(dErr.message);
  const dailyById = new Map((dailies || []).map((d) => [String(d.student_id), d]));

  let learners = rows.map((st) =>
    learnerRowFromState(st, dailyById.get(String(st.student_id)), profiles.get(String(st.student_id)))
  );
  if (search) {
    const q = search.toLowerCase();
    learners = learners.filter(
      (L) =>
        String(L.studentId).toLowerCase().includes(q) ||
        String(L.name || '')
          .toLowerCase()
          .includes(q)
    );
  }
  return { learners, total: learners.length, questDate: today };
}

async function getTenantLearnerDetail(tenantId, studentId) {
  const tid = String(tenantId || '').trim();
  const sid = String(studentId || '').trim();
  if (!tid || !sid) throw new Error('tenantId and studentId required');
  if (!isSupabaseEnabled()) throw new Error('Supabase is required');
  const db = getSupabase();
  const tenant = await getTenantById(tid);
  if (!tenant) throw new Error('Tenant not found');

  const { data: state, error } = await db
    .from('vocab_student_state')
    .select('*')
    .eq('tenant_id', tid)
    .eq('student_id', sid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!state) return null;

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: daily }, { count: wordProgressCount }, { data: recentDaily }, profiles] =
    await Promise.all([
      db
        .from('vocab_daily_progress')
        .select('*')
        .eq('tenant_id', tid)
        .eq('student_id', sid)
        .eq('quest_date', today)
        .maybeSingle(),
      db
        .from('vocab_student_progress')
        .select('word_id', { count: 'exact', head: true })
        .eq('tenant_id', tid)
        .eq('student_id', sid),
      db
        .from('vocab_daily_progress')
        .select('quest_date,studied_count,target_count,test_passed,test_score')
        .eq('tenant_id', tid)
        .eq('student_id', sid)
        .order('quest_date', { ascending: false })
        .limit(14),
      enrichLearnerProfiles(tenant, [sid])
    ]);

  const { data: boxRows } = await db
    .from('vocab_student_progress')
    .select('box')
    .eq('tenant_id', tid)
    .eq('student_id', sid);

  const byBox = {};
  (boxRows || []).forEach((r) => {
    const b = String(r.box != null ? r.box : 0);
    byBox[b] = (byBox[b] || 0) + 1;
  });

  return {
    learner: learnerRowFromState(state, daily || null, profiles.get(sid)),
    wordProgressCount: wordProgressCount || 0,
    leitnerByBox: byBox,
    recentDaily: recentDaily || []
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
  listTenantLearners,
  getTenantLearnerDetail,
  upsertLearnerProfile,
  invalidateTenantCache,
  platformSecret
};
