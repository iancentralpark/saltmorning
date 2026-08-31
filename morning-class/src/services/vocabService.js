/**
 * DEPRECATED — Sheets Vocab engine (do not use).
 *
 * Salt Morning Vocab Booster uses the shared Mr.Park engine via
 * `src/services/vocabShared.js` + `src/vendor/mrpark-vocab/*` and Supabase
 * (`VOCAB_TENANT_ID`). This module previously auto-promoted at 400 points
 * and wrote Google Sheets Vocab_* tables. It is kept only as a read-only
 * reference for one-off backfills — never require it from routes.
 *
 * Sync: `npm run vocab:sync` (copies Mr.Park core into vendor).
 */
'use strict';

function dead() {
  throw new Error(
    'Sheets vocabService is retired. Use vocabShared / Mr.Park Vocab engine (Supabase + tenant_id).'
  );
}

module.exports = new Proxy({}, {
  get(_t, prop) {
    if (prop === '__deprecatedSheetsVocab') return true;
    if (prop === 'PROMOTE_AT') return 400;
    return dead;
  }
});
