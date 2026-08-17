'use strict';

const { isOpsDbEnabled } = require('./pool');
const { applyOpsMigrations } = require('./migrate');
const { backfillGradesFromSheets } = require('./backfillGrades');

let started = null;
let gradesReady = false;

function isOpsGradesReady() {
  return isOpsDbEnabled() && gradesReady;
}

async function startOpsDb() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };
  const migrated = await applyOpsMigrations();
  let backfill = null;
  try {
    backfill = await backfillGradesFromSheets();
  } catch (e) {
    console.warn('[ops-db] grades backfill failed:', e.message);
    backfill = { ok: false, error: e.message };
  }
  gradesReady = !!(backfill && backfill.ok);
  return { ok: true, migrated, backfill };
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

module.exports = { ensureOpsDbStarted, isOpsGradesReady };
