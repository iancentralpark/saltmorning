'use strict';

const { isOpsDbEnabled, healthCheck } = require('./pool');
const { applyOpsMigrations } = require('./migrate');
const { backfillGradesFromSheets } = require('./backfillGrades');
const { backfillRosterFromSheets } = require('./backfillRoster');
const { backfillSheetsStoreFromGoogle } = require('./backfillSheetStore');

let started = null;
let gradesReady = false;
let rosterReady = false;
let sheetsStoreReady = false;
let lastStatus = { ok: false, reason: 'Not started yet' };

function isOpsGradesReady() {
  return isOpsDbEnabled() && gradesReady;
}

function isOpsRosterReady() {
  return isOpsDbEnabled() && rosterReady;
}

function isOpsSheetsStoreReady() {
  return isOpsDbEnabled() && sheetsStoreReady;
}

function getGradesStorageStatus() {
  if (isOpsGradesReady()) return { mode: 'postgres', ready: true };
  return {
    mode: 'google-sheets-fallback',
    ready: false,
    reason: (lastStatus && (lastStatus.reason || lastStatus.error)) || 'Postgres grades backend not ready'
  };
}

function getRosterStorageStatus() {
  if (isOpsRosterReady()) return { mode: 'postgres', ready: true };
  return {
    mode: 'google-sheets-fallback',
    ready: false,
    reason: (lastStatus && lastStatus.rosterReason) ||
      (lastStatus && (lastStatus.reason || lastStatus.error)) ||
      'Postgres roster backend not ready'
  };
}

function getSheetsStoreStatus() {
  if (isOpsSheetsStoreReady()) return { mode: 'postgres', ready: true };
  return {
    mode: 'google-sheets-fallback',
    ready: false,
    reason: (lastStatus && lastStatus.sheetsStoreReason) ||
      (lastStatus && (lastStatus.reason || lastStatus.error)) ||
      'Postgres sheets store not ready'
  };
}

async function recoverFlagFromMeta(prior, metaField, setReady) {
  try {
    const hc = await healthCheck();
    if (hc && hc.ok && hc[metaField]) {
      setReady(true);
      return {
        ok: true,
        recovered: true,
        priorError: prior && (prior.error || prior.reason)
      };
    }
  } catch (_) { /* keep prior */ }
  return prior;
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
    backfill = await recoverFlagFromMeta(backfill, 'gradesBackfilled', (v) => { gradesReady = v; });
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
    rosterBackfill = await recoverFlagFromMeta(rosterBackfill, 'rosterBackfilled', (v) => { rosterReady = v; });
    rosterReady = !!(rosterBackfill && rosterBackfill.ok);
  }

  let sheetsStoreBackfill = null;
  try {
    sheetsStoreBackfill = await backfillSheetsStoreFromGoogle();
  } catch (e) {
    console.warn('[ops-db] sheets-store backfill failed:', e.message);
    sheetsStoreBackfill = { ok: false, error: e.message };
  }
  sheetsStoreReady = !!(sheetsStoreBackfill && sheetsStoreBackfill.ok);
  if (!sheetsStoreReady) {
    sheetsStoreBackfill = await recoverFlagFromMeta(
      sheetsStoreBackfill,
      'sheetsStoreBackfilled',
      (v) => { sheetsStoreReady = v; }
    );
    sheetsStoreReady = !!(sheetsStoreBackfill && sheetsStoreBackfill.ok);
  }

  lastStatus = {
    ok: !!(gradesReady || rosterReady || sheetsStoreReady || (migrated && migrated.ok)),
    migrated,
    backfill,
    rosterBackfill,
    sheetsStoreBackfill,
    migrateError: migrateError || undefined,
    reason: gradesReady
      ? undefined
      : (migrateError || (backfill && (backfill.error || backfill.reason)) || 'Postgres grades backend not ready'),
    rosterReason: rosterReady
      ? undefined
      : (migrateError || (rosterBackfill && (rosterBackfill.error || rosterBackfill.reason)) ||
        'Postgres roster backend not ready'),
    sheetsStoreReason: sheetsStoreReady
      ? undefined
      : (migrateError || (sheetsStoreBackfill && (sheetsStoreBackfill.error || sheetsStoreBackfill.reason)) ||
        'Postgres sheets store not ready')
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
          console.warn('[ops-db] migration error (data may still use Postgres):', r.migrateError);
        }
        if (r.backfill && r.backfill.copied) console.log('[ops-db] grades backfill', r.backfill.copied);
        else if (r.backfill && r.backfill.skipped) console.log('[ops-db] grades already backfilled');
        else if (r.backfill && r.backfill.recovered) console.log('[ops-db] grades ready via existing backfill meta');

        if (r.rosterBackfill && r.rosterBackfill.copied) console.log('[ops-db] roster backfill', r.rosterBackfill.copied);
        else if (r.rosterBackfill && r.rosterBackfill.skipped) console.log('[ops-db] roster already backfilled');
        else if (r.rosterBackfill && r.rosterBackfill.recovered) console.log('[ops-db] roster ready via existing backfill meta');

        if (r.sheetsStoreBackfill && r.sheetsStoreBackfill.scanned) {
          console.log('[ops-db] sheets-store backfill', r.sheetsStoreBackfill.scanned);
        } else if (r.sheetsStoreBackfill && r.sheetsStoreBackfill.skipped) {
          console.log('[ops-db] sheets-store already backfilled');
        } else if (r.sheetsStoreBackfill && r.sheetsStoreBackfill.recovered) {
          console.log('[ops-db] sheets-store ready via existing backfill meta');
        }
        return r;
      })
      .catch((e) => {
        const msg = e.message || String(e);
        console.warn('[ops-db] boot failed:', msg);
        lastStatus = { ok: false, error: msg, reason: msg };
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
  isOpsSheetsStoreReady,
  getGradesStorageStatus,
  getRosterStorageStatus,
  getSheetsStoreStatus
};
