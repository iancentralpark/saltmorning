'use strict';

const { isOpsDbEnabled, healthCheck } = require('./pool');
const { applyOpsMigrations } = require('./migrate');
const { backfillGradesFromSheets } = require('./backfillGrades');

let started = null;
let gradesReady = false;
let lastStatus = { ok: false, reason: 'Not started yet' };

function isOpsGradesReady() {
  return isOpsDbEnabled() && gradesReady;
}

/**
 * Grades are silently written to Google Sheets whenever Postgres isn't
 * ready (no DATABASE_URL, migration failure, or backfill failure) — this
 * surfaces which mode is actually active so it shows up in /api/health
 * instead of only in server logs.
 */
function getGradesStorageStatus() {
  if (isOpsGradesReady()) {
    return { mode: 'postgres', ready: true };
  }
  return {
    mode: 'google-sheets-fallback',
    ready: false,
    reason: (lastStatus && (lastStatus.reason || lastStatus.error)) || 'Postgres grades backend not ready'
  };
}

/**
 * Once grades have been backfilled into Postgres, keep serving them from
 * Postgres even if a later unrelated migration fails. Falling back to
 * Sheets after teachers wrote to PG makes the gradebook look wiped.
 */
async function recoverGradesReadyFromMeta(priorBackfill) {
  try {
    const hc = await healthCheck();
    if (hc && hc.ok && hc.gradesBackfilled) {
      gradesReady = true;
      return {
        ok: true,
        recovered: true,
        priorError: priorBackfill && (priorBackfill.error || priorBackfill.reason)
      };
    }
  } catch (_) { /* keep prior result */ }
  return priorBackfill;
}

async function startOpsDb() {
  if (!isOpsDbEnabled()) {
    lastStatus = { ok: false, reason: 'DATABASE_URL not set' };
    return lastStatus;
  }

  let migrated = null;
  let migrateError = null;
  try {
    migrated = await applyOpsMigrations();
  } catch (e) {
    migrateError = e.message || String(e);
    console.warn('[ops-db] migration failed:', migrateError);
  }

  let backfill = null;
  try {
    backfill = await backfillGradesFromSheets();
  } catch (e) {
    console.warn('[ops-db] grades backfill failed:', e.message);
    backfill = { ok: false, error: e.message };
  }

  gradesReady = !!(backfill && backfill.ok);
  if (!gradesReady) {
    backfill = await recoverGradesReadyFromMeta(backfill);
    gradesReady = !!(backfill && backfill.ok);
  }

  const reason = gradesReady
    ? undefined
    : (migrateError || (backfill && (backfill.error || backfill.reason)) || 'Postgres grades backend not ready');

  lastStatus = {
    ok: !!(gradesReady || (migrated && migrated.ok)),
    migrated,
    backfill,
    migrateError: migrateError || undefined,
    reason
  };
  return lastStatus;
}

function ensureOpsDbStarted() {
  if (!started) {
    started = startOpsDb()
      .then((r) => {
        if (r.migrated) {
          console.log('[ops-db] schema v' + r.migrated.version +
            (r.migrated.applied && r.migrated.applied.length
              ? ' applied ' + r.migrated.applied.join(', ')
              : ''));
        }
        if (r.migrateError) {
          console.warn('[ops-db] migration error (grades may still use Postgres):', r.migrateError);
        }
        if (r.backfill && r.backfill.copied) {
          console.log('[ops-db] grades backfill', r.backfill.copied);
        } else if (r.backfill && r.backfill.skipped) {
          console.log('[ops-db] grades already backfilled');
        } else if (r.backfill && r.backfill.recovered) {
          console.log('[ops-db] grades ready via existing backfill meta');
        }
        return r;
      })
      .catch((e) => {
        const msg = e.message || String(e);
        console.warn('[ops-db] boot failed:', msg);
        lastStatus = { ok: false, error: msg, reason: msg };
        // Allow a later request to retry boot (transient DB blip on cold start).
        started = null;
        return lastStatus;
      });
  }
  return started;
}

module.exports = { ensureOpsDbStarted, isOpsGradesReady, getGradesStorageStatus };
