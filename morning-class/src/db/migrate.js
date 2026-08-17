'use strict';

/**
 * Apply salt_morning SQL migrations on boot (Railway Postgres).
 */

const fs = require('fs');
const path = require('path');
const { isOpsDbEnabled, query, table, SCHEMA } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

function sqlStatements(sql) {
  return String(sql || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      const body = s
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('--'))
        .join('\n');
      return /[A-Za-z]/.test(body);
    });
}

async function currentVersion() {
  try {
    const r = await query(
      'SELECT value FROM ' + table('meta') + " WHERE key = 'schema_version'"
    );
    return Number(r.rows[0] && r.rows[0].value) || 0;
  } catch (e) {
    return 0;
  }
}

async function setVersion(n) {
  await query(
    'INSERT INTO ' + table('meta') +
      ' (key, value, updated_at) VALUES ($1, $2, now())' +
      ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    ['schema_version', String(n)]
  );
}

async function applyOpsMigrations() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };

  await query('CREATE SCHEMA IF NOT EXISTS ' + SCHEMA);
  await query(
    'CREATE TABLE IF NOT EXISTS ' + table('meta') +
      ' (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'\', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  let version = await currentVersion();
  const applied = [];
  for (const file of files) {
    const n = parseInt(file, 10);
    if (!Number.isFinite(n) || n <= version) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sqlStatements(sql)) {
      await query(stmt);
    }
    version = n;
    await setVersion(n);
    applied.push(file);
  }

  return { ok: true, schema: SCHEMA, version, applied };
}

module.exports = { applyOpsMigrations };
