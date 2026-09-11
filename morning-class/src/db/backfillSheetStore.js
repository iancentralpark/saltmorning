'use strict';

/**
 * One-time copy of remaining Google Sheets tabs → salt_morning.sheet_*.
 * Safe to re-run: gated by meta.sheets_store_backfilled.
 * Does not modify typed grade/roster tables.
 */

const { isOpsDbEnabled, query, table } = require('./pool');
const { replaceSheet } = require('./sheetStore');
const { sheetStoreTargets } = require('./sheetCatalog');

const META_KEY = 'sheets_store_backfilled';

async function getMeta(key) {
  const r = await query(
    'SELECT value FROM ' + table('meta') + ' WHERE key = $1',
    [key]
  );
  return r.rows[0] ? String(r.rows[0].value || '') : '';
}

async function setMeta(key, value) {
  await query(
    'INSERT INTO ' + table('meta') +
      ' (key, value, updated_at) VALUES ($1, $2, now())' +
      ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [key, String(value)]
  );
}

async function readGoogleSheet(sheetName) {
  try {
    const { getSheetRows } = require('../sheets');
    return await getSheetRows(sheetName, { skipCache: true, forceGoogle: true });
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (/Unable to parse range|Unable to find|not found|Unable to parse/i.test(msg)) {
      console.warn('[ops-db] sheet missing during store backfill ' + sheetName + ':', msg);
      return null;
    }
    throw e;
  }
}

async function backfillSheetsStoreFromGoogle() {
  if (!isOpsDbEnabled()) return { ok: false, reason: 'DATABASE_URL not set' };
  if ((await getMeta(META_KEY)) === '1') {
    return { ok: true, skipped: true };
  }

  const targets = sheetStoreTargets();
  const copied = {};
  const missing = [];
  let totalRows = 0;

  for (const sheetName of targets) {
    const rows = await readGoogleSheet(sheetName);
    if (rows == null) {
      missing.push(sheetName);
      // Still register an empty tab so runtime does not fall back to Google.
      await replaceSheet(sheetName, [['']]);
      copied[sheetName] = 0;
      continue;
    }
    await replaceSheet(sheetName, rows.length ? rows : [['']]);
    const dataRows = Math.max(0, rows.length - 1);
    copied[sheetName] = dataRows;
    totalRows += dataRows;
  }

  await setMeta(META_KEY, '1');
  return {
    ok: true,
    copied,
    missing,
    scanned: { sheets: targets.length, rows: totalRows }
  };
}

module.exports = { backfillSheetsStoreFromGoogle };
