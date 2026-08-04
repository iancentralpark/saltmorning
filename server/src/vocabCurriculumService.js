/**
 * Curriculum packs — optional per-tenant word subsets over the global bank.
 *
 * If a tenant has one or more active packs assigned, placement / daily word
 * picks are restricted to the union of those pack words. Tenants with no
 * packs keep the full global bank.
 */
'use strict';

const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

function requireDb() {
  if (!isSupabaseEnabled()) throw new Error('Supabase is required for curriculum packs.');
  return getSupabase();
}

function slugify(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function listPacks() {
  const db = requireDb();
  const { data, error } = await db
    .from('vocab_curriculum_packs')
    .select('id,name,description,active,created_at,updated_at')
    .order('name');
  if (error) throw new Error(error.message);
  const packs = data || [];
  if (!packs.length) return [];

  const ids = packs.map((p) => p.id);
  const { data: links, error: linkErr } = await db
    .from('vocab_pack_words')
    .select('pack_id')
    .in('pack_id', ids);
  if (linkErr) throw new Error(linkErr.message);
  const counts = {};
  (links || []).forEach((row) => {
    counts[row.pack_id] = (counts[row.pack_id] || 0) + 1;
  });

  const { data: assigns, error: aErr } = await db
    .from('vocab_tenant_packs')
    .select('pack_id,tenant_id,active')
    .in('pack_id', ids);
  if (aErr) throw new Error(aErr.message);
  const tenantsByPack = {};
  (assigns || []).forEach((row) => {
    if (!tenantsByPack[row.pack_id]) tenantsByPack[row.pack_id] = [];
    if (row.active !== false) tenantsByPack[row.pack_id].push(row.tenant_id);
  });

  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description || '',
    active: p.active !== false,
    wordCount: counts[p.id] || 0,
    tenantIds: tenantsByPack[p.id] || [],
    createdAt: p.created_at,
    updatedAt: p.updated_at
  }));
}

async function getPack(packId) {
  const db = requireDb();
  const id = String(packId || '').trim();
  const { data, error } = await db
    .from('vocab_curriculum_packs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: words, error: wErr } = await db
    .from('vocab_pack_words')
    .select('word_id')
    .eq('pack_id', id);
  if (wErr) throw new Error(wErr.message);

  const wordIds = (words || []).map((w) => w.word_id);
  let wordRows = [];
  if (wordIds.length) {
    const { data: rows, error: rErr } = await db
      .from('vocab_words')
      .select('word_id,word,grade_level,tier_name,part_of_speech,active')
      .in('word_id', wordIds.slice(0, 500));
    if (rErr) throw new Error(rErr.message);
    wordRows = rows || [];
  }

  const { data: assigns } = await db
    .from('vocab_tenant_packs')
    .select('tenant_id,active,priority')
    .eq('pack_id', id);

  return {
    id: data.id,
    name: data.name,
    description: data.description || '',
    active: data.active !== false,
    words: wordRows,
    wordIds,
    tenants: assigns || [],
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}

async function createPack(opts) {
  const db = requireDb();
  opts = opts || {};
  const name = String(opts.name || '').trim();
  if (!name) throw new Error('Pack name is required.');
  let id = slugify(opts.id || name);
  if (!id) id = 'pack-' + Date.now().toString(36);

  const row = {
    id,
    name,
    description: String(opts.description || '').trim() || null,
    active: opts.active !== false,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db
    .from('vocab_curriculum_packs')
    .insert(row)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (Array.isArray(opts.wordIds) && opts.wordIds.length) {
    await setPackWords(id, opts.wordIds);
  }
  return getPack(data.id);
}

async function updatePack(packId, opts) {
  const db = requireDb();
  const id = String(packId || '').trim();
  opts = opts || {};
  const patch = { updated_at: new Date().toISOString() };
  if (opts.name != null) patch.name = String(opts.name).trim();
  if (opts.description != null) patch.description = String(opts.description).trim() || null;
  if (opts.active != null) patch.active = !!opts.active;
  const { error } = await db.from('vocab_curriculum_packs').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
  if (Array.isArray(opts.wordIds)) await setPackWords(id, opts.wordIds);
  return getPack(id);
}

async function deletePack(packId) {
  const db = requireDb();
  const id = String(packId || '').trim();
  await db.from('vocab_tenant_packs').delete().eq('pack_id', id);
  await db.from('vocab_pack_words').delete().eq('pack_id', id);
  const { error } = await db.from('vocab_curriculum_packs').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function setPackWords(packId, wordIds) {
  const db = requireDb();
  const id = String(packId || '').trim();
  const ids = Array.from(
    new Set((wordIds || []).map((w) => String(w || '').trim()).filter(Boolean))
  );
  const { error: delErr } = await db.from('vocab_pack_words').delete().eq('pack_id', id);
  if (delErr) throw new Error(delErr.message);
  if (!ids.length) return { ok: true, count: 0 };

  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize).map((word_id) => ({ pack_id: id, word_id }));
    const { error } = await db.from('vocab_pack_words').upsert(chunk, {
      onConflict: 'pack_id,word_id'
    });
    if (error) throw new Error(error.message);
  }
  await db
    .from('vocab_curriculum_packs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);
  return { ok: true, count: ids.length };
}

async function addWordsToPackByGrade(packId, gradeLevel) {
  const db = requireDb();
  const id = String(packId || '').trim();
  const grade = Math.round(Number(gradeLevel));
  if (!Number.isFinite(grade)) throw new Error('gradeLevel required');
  const { data, error } = await db
    .from('vocab_words')
    .select('word_id')
    .eq('active', true)
    .eq('grade_level', grade);
  if (error) throw new Error(error.message);
  const wordIds = (data || []).map((r) => r.word_id);
  if (!wordIds.length) return { ok: true, added: 0 };

  const rows = wordIds.map((word_id) => ({ pack_id: id, word_id }));
  const { error: upErr } = await db.from('vocab_pack_words').upsert(rows, {
    onConflict: 'pack_id,word_id'
  });
  if (upErr) throw new Error(upErr.message);
  return { ok: true, added: wordIds.length };
}

async function listTenantPacks(tenantId) {
  const db = requireDb();
  const tid = String(tenantId || '').trim();
  const { data, error } = await db
    .from('vocab_tenant_packs')
    .select('tenant_id,pack_id,active,priority,vocab_curriculum_packs(id,name,description,active)')
    .eq('tenant_id', tid)
    .order('priority', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    tenantId: row.tenant_id,
    packId: row.pack_id,
    active: row.active !== false,
    priority: row.priority || 100,
    pack: row.vocab_curriculum_packs || null
  }));
}

async function setTenantPacks(tenantId, packIds) {
  const db = requireDb();
  const tid = String(tenantId || '').trim();
  const ids = Array.from(
    new Set((packIds || []).map((p) => String(p || '').trim()).filter(Boolean))
  );
  const { error: delErr } = await db.from('vocab_tenant_packs').delete().eq('tenant_id', tid);
  if (delErr) throw new Error(delErr.message);
  if (!ids.length) return listTenantPacks(tid);

  const rows = ids.map((pack_id, i) => ({
    tenant_id: tid,
    pack_id,
    active: true,
    priority: (i + 1) * 10
  }));
  const { error } = await db.from('vocab_tenant_packs').upsert(rows, {
    onConflict: 'tenant_id,pack_id'
  });
  if (error) throw new Error(error.message);
  return listTenantPacks(tid);
}

/**
 * Returns null when tenant should use the full global bank.
 * Returns a Set/array of word_ids when packs restrict the pool.
 */
async function getTenantAllowedWordIds(tenantId) {
  const db = requireDb();
  const tid = String(tenantId || '').trim();
  if (!tid) return null;

  const { data: assigns, error } = await db
    .from('vocab_tenant_packs')
    .select('pack_id')
    .eq('tenant_id', tid)
    .eq('active', true);
  if (error) throw new Error(error.message);
  if (!assigns || !assigns.length) return null;

  const packIds = assigns.map((a) => a.pack_id);
  const { data: packs, error: pErr } = await db
    .from('vocab_curriculum_packs')
    .select('id')
    .in('id', packIds)
    .eq('active', true);
  if (pErr) throw new Error(pErr.message);
  const activePackIds = (packs || []).map((p) => p.id);
  if (!activePackIds.length) return null;

  const { data: words, error: wErr } = await db
    .from('vocab_pack_words')
    .select('word_id')
    .in('pack_id', activePackIds);
  if (wErr) throw new Error(wErr.message);
  const set = new Set((words || []).map((w) => String(w.word_id)));
  if (!set.size) return []; // assigned packs but empty → no words available
  return Array.from(set);
}

module.exports = {
  listPacks,
  getPack,
  createPack,
  updatePack,
  deletePack,
  setPackWords,
  addWordsToPackByGrade,
  listTenantPacks,
  setTenantPacks,
  getTenantAllowedWordIds
};
