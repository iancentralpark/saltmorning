'use strict';

/**
 * Generic sheet_tabs / sheet_rows store — virtualizes arbitrary Sheets tabs
 * in Postgres so Salt Morning can run without Google Sheets at runtime.
 */

const { query, table, withTransaction } = require('./pool');

async function ensureTab(sheetName, headers) {
  sheetName = String(sheetName || '').trim();
  if (!sheetName) throw new Error('sheetName required');
  const hdrs = Array.isArray(headers) ? headers.map((h) => String(h == null ? '' : h)) : [];
  await query(
    'INSERT INTO ' + table('sheet_tabs') +
      ' (sheet_name, headers, updated_at) VALUES ($1, $2::jsonb, now())' +
      ' ON CONFLICT (sheet_name) DO UPDATE SET' +
      ' headers = CASE WHEN EXCLUDED.headers <> \'[]\'::jsonb THEN EXCLUDED.headers ELSE ' +
      table('sheet_tabs') + '.headers END, updated_at = now()',
    [sheetName, JSON.stringify(hdrs)]
  );
}

async function replaceSheet(sheetName, allRows) {
  sheetName = String(sheetName || '').trim();
  const rows = Array.isArray(allRows) ? allRows : [];
  const headers = (rows[0] || []).map((h) => String(h == null ? '' : h));
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO ' + table('sheet_tabs') +
        ' (sheet_name, headers, updated_at) VALUES ($1, $2::jsonb, now())' +
        ' ON CONFLICT (sheet_name) DO UPDATE SET headers = EXCLUDED.headers, updated_at = now()',
      [sheetName, JSON.stringify(headers)]
    );
    await client.query(
      'DELETE FROM ' + table('sheet_rows') + ' WHERE sheet_name = $1',
      [sheetName]
    );
    for (let i = 1; i < rows.length; i++) {
      const cells = (rows[i] || []).map((c) => (c == null ? '' : c));
      await client.query(
        'INSERT INTO ' + table('sheet_rows') +
          ' (sheet_name, sort_order, cells, updated_at) VALUES ($1, $2, $3::jsonb, now())',
        [sheetName, i, JSON.stringify(cells)]
      );
    }
  });
}

async function readSheet(sheetName) {
  sheetName = String(sheetName || '').trim();
  const tab = await query(
    'SELECT headers FROM ' + table('sheet_tabs') + ' WHERE sheet_name = $1',
    [sheetName]
  );
  if (!tab.rows.length) return [[]];
  const headers = Array.isArray(tab.rows[0].headers) ? tab.rows[0].headers : [];
  const data = await query(
    'SELECT cells FROM ' + table('sheet_rows') +
      ' WHERE sheet_name = $1 ORDER BY sort_order ASC, id ASC',
    [sheetName]
  );
  return [
    headers.map(String),
    ...data.rows.map((r) => {
      const cells = Array.isArray(r.cells) ? r.cells : [];
      return cells.map((c) => (c == null ? '' : c));
    })
  ];
}

function colToIndex(col) {
  let n = 0;
  const s = String(col || '').toUpperCase();
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function parseA1(a1) {
  const m = String(a1 || '').trim().match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
  if (!m) return null;
  return {
    c1: colToIndex(m[1]),
    r1: Number(m[2]),
    c2: colToIndex(m[3] || m[1]),
    r2: Number(m[4] || m[2])
  };
}

async function writeRange(sheetName, a1, values) {
  const parsed = parseA1(a1);
  if (!parsed) throw new Error('Unsupported sheet range: ' + a1);
  values = values || [];

  const current = await readSheet(sheetName);
  const rows = current.map((r) => (r || []).slice());
  if (!rows.length) rows.push([]);

  const maxRow = Math.max(parsed.r2, rows.length);
  while (rows.length < maxRow) rows.push([]);

  for (let r = parsed.r1; r <= parsed.r2; r++) {
    const valueRow = values[r - parsed.r1] || [];
    if (!rows[r - 1]) rows[r - 1] = [];
    for (let c = parsed.c1; c <= parsed.c2; c++) {
      const vi = c - parsed.c1;
      while (rows[r - 1].length <= c) rows[r - 1].push('');
      if (vi >= 0 && vi < valueRow.length) rows[r - 1][c] = valueRow[vi];
    }
  }

  await replaceSheet(sheetName, rows);
}

async function appendSheetRows(sheetName, rows) {
  const current = await readSheet(sheetName);
  const next = current.length ? current.slice() : [[]];
  for (const row of rows || []) {
    next.push((row || []).map((c) => (c == null ? '' : c)));
  }
  await replaceSheet(sheetName, next);
}

async function deleteSheetRows(sheetName, rowIndices1Based) {
  const current = await readSheet(sheetName);
  const remove = new Set(
    (rowIndices1Based || []).map(Number).filter((n) => n > 1)
  );
  if (!remove.size) return;
  const next = current.filter((_, idx) => {
    const rowNum = idx + 1;
    if (rowNum === 1) return true;
    return !remove.has(rowNum);
  });
  await replaceSheet(sheetName, next);
}

async function listStoredSheetNames() {
  const r = await query(
    'SELECT sheet_name FROM ' + table('sheet_tabs') + ' ORDER BY sheet_name'
  );
  return r.rows.map((row) => row.sheet_name);
}

async function hasStoredSheet(sheetName) {
  const r = await query(
    'SELECT 1 FROM ' + table('sheet_tabs') + ' WHERE sheet_name = $1 LIMIT 1',
    [String(sheetName || '')]
  );
  return r.rows.length > 0;
}

module.exports = {
  ensureTab,
  replaceSheet,
  readSheet,
  writeRange,
  appendSheetRows,
  deleteSheetRows,
  listStoredSheetNames,
  hasStoredSheet
};
