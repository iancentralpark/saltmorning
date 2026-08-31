'use strict';

/**
 * Salt Morning ops database (Railway Postgres, schema salt_morning).
 * Completely separate from Mr.Park Supabase — never query public Mr.Park tables from here.
 */

const { Pool } = require('pg');

let pool = null;
const SCHEMA = process.env.OPS_DB_SCHEMA || 'salt_morning';

function isOpsDbEnabled() {
  return !!(process.env.DATABASE_URL || process.env.OPS_DATABASE_URL);
}

function getPool() {
  if (!isOpsDbEnabled()) return null;
  if (!pool) {
    const connectionString = process.env.OPS_DATABASE_URL || process.env.DATABASE_URL;
    pool = new Pool({
      connectionString,
      ssl: /railway\.internal|localhost|127\.0\.0\.1/.test(connectionString)
        ? false
        : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000
    });
    pool.on('error', (err) => {
      console.error('[ops-db] pool error', err.message);
    });
  }
  return pool;
}

function table(name) {
  return SCHEMA + '.' + name;
}

async function query(text, params) {
  const p = getPool();
  if (!p) throw new Error('Ops database (DATABASE_URL) is not configured.');
  return p.query(text, params);
}

async function withTransaction(fn) {
  const p = getPool();
  if (!p) throw new Error('Ops database (DATABASE_URL) is not configured.');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Per-student advisory lock namespace for dollar RMW */
async function withStudentLock(studentId, fn) {
  return withTransaction(async (client) => {
    // hashtext → int4 advisory lock key
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sm_dollar:' + String(studentId)]);
    return fn(client);
  });
}

async function healthCheck() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };
  try {
    const r = await query('SELECT value FROM ' + table('meta') + " WHERE key = 'schema_version'");
    return { ok: true, schema: SCHEMA, version: r.rows[0] && r.rows[0].value };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  SCHEMA,
  isOpsDbEnabled,
  getPool,
  table,
  query,
  withTransaction,
  withStudentLock,
  healthCheck
};
