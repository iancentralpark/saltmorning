#!/usr/bin/env node
/**
 * Seed / rotate Vocab Booster tenant API secrets (hashed in vocab_tenants).
 *
 * Usage:
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   node scripts/seed-vocab-tenant-secrets.js
 *
 * Optional fixed secrets (otherwise random vbsec_… are generated):
 *   VOCAB_SEED_SECRET_mrpark=vbsec_…
 *   VOCAB_SEED_SECRET_salt-morning=vbsec_…
 *
 * Prints plaintext secrets once to stdout — store them in host env as
 * VOCAB_TENANT_API_SECRET (never commit).
 */
'use strict';

const crypto = require('crypto');

const TENANTS = ['mrpark', 'salt-morning'];

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
}

function generateApiSecret() {
  return 'vbsec_' + crypto.randomBytes(24).toString('base64url');
}

async function main() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const out = [];
  for (const id of TENANTS) {
    const envKey = 'VOCAB_SEED_SECRET_' + id.replace(/-/g, '_');
    const secret =
      process.env['VOCAB_SEED_SECRET_' + id] ||
      process.env[envKey] ||
      generateApiSecret();
    const res = await fetch(
      url + '/rest/v1/vocab_tenants?id=eq.' + encodeURIComponent(id),
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          secret_hash: hashSecret(secret),
          updated_at: new Date().toISOString()
        })
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(id + ': ' + res.status + ' ' + text);
    const rows = text ? JSON.parse(text) : [];
    if (!rows.length) throw new Error('Tenant not found: ' + id);
    out.push({ id, publicKey: rows[0].public_key, secret });
    console.log('Updated secret_hash for', id, '(public_key=' + rows[0].public_key + ')');
  }

  console.log('\n--- Store these as host secrets (shown once) ---');
  for (const row of out) {
    console.log(row.id + '\t' + row.secret);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
