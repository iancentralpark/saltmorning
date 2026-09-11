'use strict';

const { isOpsDbEnabled, healthCheck } = require('./pool');
const { applyOpsMigrations } = require('./migrate');
const { backfillGradesFromSheets } = require('./backfillGrades');
const { backfillRosterFromSheets } = require('./backfillRoster');

let started = null;
let gradesReady = false;
let rosterReady = false;
let lastStatus = { ok: false, reason: 'Not started yet' };

function isOpsGradesReady() {
  return isOpsDbEnabled() && gradesReady;
}

function isOpsRosterReady() {
  return isOpsDbEnabled() && rosterReady;
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

function getRosterStorageStatus() {
  if (isOpsRosterReady()) {
    return { mode: 'postgres', ready: true };
  }
  return {
    mode: 'google-sheets-fallback',
    ready: false,
    reason: (lastStatus && lastStatus.rosterReason) ||
      (lastStatus && (lastStatus.reason || lastStatus.error)) ||
      'Postgres roster backend not ready'
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

async function recoverRosterReadyFromMeta(priorBackfill) {
  try {
    const hc = await healthCheck();
    if (hc && hc.ok && hc.rosterBackfilled) {
      rosterReady = true;
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

  let rosterBackfill = null;
  try {
    rosterBackfill = await backfillRosterFromSheets();
  } catch (e) {
    console.warn('[ops-db] roster backfill failed:', e.message);
    rosterBackfill = { ok: false, error: e.message };
  }
  rosterReady = !!(rosterBackfill && rosterBackfill.ok);
  if (!rosterReady) {
    rosterBackfill = await recoverRosterReadyFromMeta(rosterBackfill);
    rosterReady = !!(rosterBackfill && rosterBackfill.ok);
  }

  const reason = gradesReady
    ? undefined
    : (migrateError || (backfill && (backfill.error || backfill.reason)) || 'Postgres grades backend not ready');
  const rosterReason = rosterReady
    ? undefined
    : (migrateError || (rosterBackfill && (rosterBackfill.error || rosterBackfill.reason)) ||
      'Postgres roster backend not ready');

  lastStatus = {
    ok: !!(gradesReady || rosterReady || (migrated && migrated.ok)),
    migrated,
    backfill,
    rosterBackfill,
    migrateError: migrateError || undefined,
    reason,
    rosterReason
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
          console.warn('[ops-db] migration error (grades/roster may still use Postgres):', r.migrateError);
        }
        if (r.backfill && r.backfill.copied) {
          console.log('[ops-db] grades backfill', r.backfill.copied);
        } else if (r.backfill && r.backfill.skipped) {
          console.log('[ops-db] grades already backfilled');
        } else if (r.backfill && r.backfill.recovered) {
          console.log('[ops-db] grades ready via existing backfill meta');
        }
        if (r.rosterBackfill && r.rosterBackfill.copied) {
          console.log('[ops-db] roster backfill', r.rosterBackfill.copied);
        } else if (r.rosterBackfill && r.rosterBackfill.skipped) {
          console.log('[ops-db] roster already backfilled');
        } else if (r.rosterBackfill && r.rosterBackfill.recovered) {
          console.log('[ops-db] roster ready via existing backfill meta');
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

module.exports = {
  ensureOpsDbStarted,
  isOpsGradesReady,
  isOpsRosterReady,
  getGradesStorageStatus,
  getRosterStorageStatus
};
