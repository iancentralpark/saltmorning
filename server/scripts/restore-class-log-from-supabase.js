#!/usr/bin/env node
/**
 * Restore wiped Class Log student marks (+ empty lesson/homework cells)
 * from Supabase class_log_student_marks / class_log_daily.
 *
 * Usage:
 *   node scripts/restore-class-log-from-supabase.js
 *   node scripts/restore-class-log-from-supabase.js --months 2026-07-01 --classes C003,C004,C005
 *   node scripts/restore-class-log-from-supabase.js --force   # rewrite even if sheet already has marks
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { CLASS_LOG_TAB_BY_CLASS_ID } = require('../src/config');
const { getSupabase, isSupabaseEnabled } = require('../src/supabaseClient');
const {
  getClassLogColumnA,
  getClassLogValues,
  updateClassLogRange,
  colLetter,
  a1Cell
} = require('../src/classLogSheets');

const MONTH_HEADER_RE = /^[A-Za-z]+, 20\d{2}$/;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function parseArgs(argv) {
  const out = { months: null, classes: null, force: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--months') out.months = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--classes') out.classes = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

function rowOffset(config, key) {
  const split = config.layout === 'split';
  const map = {
    date: 1,
    lesson: 2,
    homework: 3,
    writing: 4,
    shortDate: split ? 7 : 6,
    students: split ? 8 : 7
  };
  return map[key];
}

function monthHeaderForDate(dateStr) {
  const p = String(dateStr).split('-');
  return MONTH_NAMES[Number(p[1]) - 1] + ', ' + p[0];
}

function monthFirstDayFromHeader(header) {
  const m = String(header || '').trim().match(/^([A-Za-z]+),\s*(20\d{2})$/);
  if (!m) return '';
  const idx = MONTH_NAMES.indexOf(m[1]);
  if (idx < 0) return '';
  return m[2] + '-' + String(idx + 1).padStart(2, '0') + '-01';
}

function monthEndDate(monthFirstDayStr) {
  const p = monthFirstDayStr.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  const last = new Date(y, m, 0).getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(last).padStart(2, '0');
}

function parseShortDateLabel(shortLabel) {
  const m = String(shortLabel || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]) >= 70 ? '19' + m[1] : '20' + m[1];
  return y + '-' + m[2] + '-' + m[3];
}

function findMonthStarts(colA) {
  const out = [];
  for (let i = 0; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && MONTH_HEADER_RE.test(String(cell).trim())) {
      out.push({ i, header: String(cell).trim() });
    }
  }
  return out;
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err && (err.status || err.code);
      const msg = String((err && err.message) || err);
      if (status === 429 || /quota|rate limit/i.test(msg)) {
        const wait = Math.min(70000, 8000 * attempt);
        console.warn('  rate-limited on', label, '- waiting', wait + 'ms');
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function loadSupabaseMarks(classId, monthFirstDay) {
  const db = getSupabase();
  const monthEnd = monthEndDate(monthFirstDay);
  const { data, error } = await db
    .from('class_log_student_marks')
    .select('student_name, log_date, mark')
    .eq('class_id', String(classId))
    .gte('log_date', monthFirstDay)
    .lte('log_date', monthEnd);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadSupabaseDaily(classId, monthFirstDay) {
  const db = getSupabase();
  const monthEnd = monthEndDate(monthFirstDay);
  const { data, error } = await db
    .from('class_log_daily')
    .select('log_date, lesson, homework, writing')
    .eq('class_id', String(classId))
    .gte('log_date', monthFirstDay)
    .lte('log_date', monthEnd);
  if (error) throw new Error(error.message);
  return data || [];
}

async function inspectMonth(config, monthStart0, blockEnd0) {
  const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
  const studentStart1 = monthStart0 + rowOffset(config, 'students') + 1;
  const lessonRow1 = monthStart0 + rowOffset(config, 'lesson') + 1;
  const hwRow1 = monthStart0 + rowOffset(config, 'homework') + 1;
  const writingRow1 = monthStart0 + rowOffset(config, 'writing') + 1;

  const shortRow = (await withRetry(
    () => getClassLogValues(config.tab, shortRow1 + ':' + shortRow1),
    'shortRow'
  ))[0] || [];
  const dateCols = [];
  for (let c = 1; c < shortRow.length; c++) {
    const ds = parseShortDateLabel(shortRow[c]);
    if (ds) dateCols.push({ col: c, dateStr: ds });
  }

  const endRow = blockEnd0 > studentStart1 ? blockEnd0 : studentStart1 + 30;
  const nameRows = await withRetry(
    () => getClassLogValues(config.tab, 'A' + studentStart1 + ':A' + endRow),
    'names'
  );
  const names = [];
  for (let i = 0; i < nameRows.length; i++) {
    const n = nameRows[i] && nameRows[i][0];
    if (!n || !String(n).trim()) break;
    names.push({ row1: studentStart1 + i, name: String(n).trim() });
  }

  let filledMarks = 0;
  const totalCells = names.length * dateCols.length;
  if (names.length && dateCols.length) {
    const startCol = dateCols[0].col;
    const endCol = dateCols[dateCols.length - 1].col;
    const grid = await withRetry(
      () => getClassLogValues(
        config.tab,
        colLetter(startCol) + names[0].row1 + ':' + colLetter(endCol) + names[names.length - 1].row1
      ),
      'markGrid'
    );
    for (const row of grid) {
      for (const cell of row) {
        if (String(cell || '').trim()) filledMarks++;
      }
    }
  }

  const lessonRow = (await withRetry(
    () => getClassLogValues(config.tab, lessonRow1 + ':' + lessonRow1),
    'lesson'
  ))[0] || [];
  const hwRow = (await withRetry(
    () => getClassLogValues(config.tab, hwRow1 + ':' + hwRow1),
    'hw'
  ))[0] || [];
  const writingRow = (await withRetry(
    () => getClassLogValues(config.tab, writingRow1 + ':' + writingRow1),
    'writing'
  ))[0] || [];

  let filledLessons = 0;
  let filledHw = 0;
  let filledWriting = 0;
  for (const dc of dateCols) {
    if (String(lessonRow[dc.col] || '').trim()) filledLessons++;
    if (String(hwRow[dc.col] || '').trim()) filledHw++;
    if (String(writingRow[dc.col] || '').trim()) filledWriting++;
  }

  return {
    dateCols,
    names,
    filledMarks,
    totalCells,
    filledLessons,
    filledHw,
    filledWriting,
    lessonRow1,
    hwRow1,
    writingRow1,
    lessonRow,
    hwRow,
    writingRow
  };
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function englishTokens(name) {
  return String(name || '')
    .split(/[\s,]+/)
    .map(function(t) { return t.trim(); })
    .filter(function(t) { return /^[A-Za-z][A-Za-z'-]*$/.test(t); })
    .map(function(t) { return t.toLowerCase(); });
}

function namesLooselyMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = englishTokens(a);
  const tb = englishTokens(b);
  if (!ta.length || !tb.length) return false;
  // Full English names: require token subset (never match Paul Lee ↔ Sean Lee).
  if (ta.length >= 2 && tb.length >= 2) {
    return ta.every(function(t) { return tb.includes(t); }) ||
      tb.every(function(t) { return ta.includes(t); });
  }
  // Historical "한글 GivenName" ↔ "GivenName Last"
  return ta.some(function(t) { return t.length >= 3 && tb.includes(t); });
}

function pickMarkForSheetName(sheetName, dateStr, markRows) {
  const candidates = markRows.filter(function(r) {
    return String(r.log_date).slice(0, 10) === dateStr &&
      namesLooselyMatch(String(r.student_name || ''), sheetName);
  });
  if (!candidates.length) return null;
  candidates.sort(function(a, b) {
    const aExact = normalizeName(a.student_name) === normalizeName(sheetName) ? 0 : 1;
    const bExact = normalizeName(b.student_name) === normalizeName(sheetName) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aKo = /[가-힣]/.test(a.student_name) ? 1 : 0;
    const bKo = /[가-힣]/.test(b.student_name) ? 1 : 0;
    return aKo - bKo;
  });
  return String(candidates[0].mark || '').trim() || null;
}

async function restoreMonth(classId, config, monthFirstDay, opts) {
  const header = monthHeaderForDate(monthFirstDay);
  console.log('\n[' + classId + ' ' + config.label + '] ' + header);

  await sleep(800);
  const colA = await withRetry(() => getClassLogColumnA(config.tab, 500), 'colA');
  const months = findMonthStarts(colA);
  const mi = months.findIndex(function(m) { return m.header === header; });
  if (mi < 0) {
    console.log('  month block missing — skip');
    return { skipped: true, reason: 'no_month' };
  }
  const monthStart0 = months[mi].i;
  const blockEnd0 = mi + 1 < months.length ? months[mi + 1].i : colA.length;

  const info = await inspectMonth(config, monthStart0, blockEnd0);
  const markRows = await loadSupabaseMarks(classId, monthFirstDay);
  const dailyRows = await loadSupabaseDaily(classId, monthFirstDay);

  const fillRatio = info.totalCells ? info.filledMarks / info.totalCells : 1;
  const supabaseMarkCount = markRows.length;
  console.log(
    '  sheet marks', info.filledMarks + '/' + info.totalCells,
    '(' + Math.round(fillRatio * 100) + '%)',
    '| supabase marks', supabaseMarkCount,
    '| lessons', info.filledLessons + '/' + info.dateCols.length,
    '| students', info.names.map(function(n) { return n.name; }).join(', ')
  );

  const looksWiped = info.totalCells > 0 && fillRatio < 0.35 && supabaseMarkCount > info.filledMarks;
  if (!opts.force && !looksWiped) {
    console.log('  looks intact — skip marks (use --force to overwrite)');
  } else if (!info.names.length || !info.dateCols.length) {
    console.log('  no students/dates — skip marks');
  } else {
    let wrote = 0;
    for (const sn of info.names) {
      const rowMarks = [];
      let any = false;
      for (const dc of info.dateCols) {
        const mark = pickMarkForSheetName(sn.name, dc.dateStr, markRows);
        rowMarks.push(mark || '');
        if (mark) any = true;
      }
      if (!any) continue;
      if (!opts.dryRun) {
        await sleep(350);
        await withRetry(function() {
          return updateClassLogRange(
            config.tab,
            colLetter(info.dateCols[0].col) + sn.row1 + ':' +
              colLetter(info.dateCols[info.dateCols.length - 1].col) + sn.row1,
            [rowMarks]
          );
        }, 'writeMarks:' + sn.name);
      }
      wrote++;
    }
    console.log('  restored mark rows for', wrote, 'students' + (opts.dryRun ? ' (dry-run)' : ''));
  }

  // Restore empty lesson/homework/writing cells from Supabase
  let lessonWrites = 0;
  for (const day of dailyRows) {
    const dateStr = String(day.log_date).slice(0, 10);
    const dc = info.dateCols.find(function(d) { return d.dateStr === dateStr; });
    if (!dc) continue;
    const fields = [
      { row1: info.lessonRow1, key: 'lesson', current: info.lessonRow[dc.col], value: day.lesson },
      { row1: info.hwRow1, key: 'homework', current: info.hwRow[dc.col], value: day.homework },
      { row1: info.writingRow1, key: 'writing', current: info.writingRow[dc.col], value: day.writing }
    ];
    for (const f of fields) {
      const next = String(f.value || '').trim();
      const cur = String(f.current || '').trim();
      if (!next) continue;
      if (cur && !opts.force) continue;
      if (!opts.dryRun) {
        await sleep(250);
        await withRetry(function() {
          return updateClassLogRange(config.tab, a1Cell(f.row1, dc.col), [[next]]);
        }, 'writeDaily:' + f.key);
      }
      lessonWrites++;
    }
  }
  console.log('  restored lesson/hw/writing cells:', lessonWrites + (opts.dryRun ? ' (dry-run)' : ''));
  return { restored: true, looksWiped, lessonWrites };
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase is not enabled');
  }
  const opts = parseArgs(process.argv);
  const classIds = opts.classes || Object.keys(CLASS_LOG_TAB_BY_CLASS_ID);
  const months = opts.months || ['2026-07-01'];

  console.log('Restoring classes:', classIds.join(', '));
  console.log('Months:', months.join(', '));
  console.log('force=', opts.force, 'dryRun=', opts.dryRun);

  for (const classId of classIds) {
    const config = CLASS_LOG_TAB_BY_CLASS_ID[classId];
    if (!config) {
      console.warn('Unknown class', classId);
      continue;
    }
    for (const month of months) {
      await restoreMonth(classId, config, month, opts);
      await sleep(1500);
    }
  }
  console.log('\nDone.');
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
