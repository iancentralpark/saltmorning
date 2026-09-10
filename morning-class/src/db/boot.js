'use strict';

const { isOpsDbEnabled } = require('./pool');
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

async function startOpsDb() {
  if (!isOpsDbEnabled()) {
    lastStatus = { ok: false, reason: 'DATABASE_URL not set' };
    return lastStatus;
  }
  const migrated = await applyOpsMigrations();
  let backfill = null;
  try {
    backfill = await backfillGradesFromSheets();
  } catch (e) {
    console.warn('[ops-db] grades backfill failed:', e.message);
    backfill = { ok: false, error: e.message };
  }
  gradesReady = !!(backfill && backfill.ok);
  lastStatus = { ok: true, migrated, backfill };
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
        if (r.backfill && r.backfill.copied) {
          console.log('[ops-db] grades backfill', r.backfill.copied);
        } else if (r.backfill && r.backfill.skipped) {
          console.log('[ops-db] grades already backfilled');
        }
        return r;
      })
      .catch((e) => {
        console.warn('[ops-db] boot failed:', e.message);
        return { ok: false, error: e.message };
      });
  }
  return started;
}

module.exports = { ensureOpsDbStarted, isOpsGradesReady, getGradesStorageStatus };
