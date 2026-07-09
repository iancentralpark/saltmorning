#!/usr/bin/env node
/**
 * Import class log spreadsheet → Supabase class_log_daily + class_log_student_marks.
 * Requires: GOOGLE credentials, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, migration 004.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('../src/bootstrapCredentials');
bootstrapCredentials();

const { CLASS_LOG_TAB_BY_CLASS_ID } = require('../src/config');
const { getClassLogColumnA, getClassLogValues } = require('../src/classLogSheets');
const { getSupabase } = require('../src/supabaseClient');

const MONTH_HEADER_RE = /^[A-Za-z]+, 20\d{2}$/;
const BATCH_SIZE = 200;

function isoNow() {
  return new Date().toISOString();
}

function parseShortDateLabel(shortLabel) {
  const m = String(shortLabel || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]) >= 70 ? '19' + m[1] : '20' + m[1];
  return y + '-' + m[2] + '-' + m[3];
}

function rowOffset(config, key) {
  const split = config.layout === 'split';
  const map = {
    date: 1,
    lesson: 2,
    homework: 3,
    writing: 4,
    chambit: 5,
    classLabel: 6,
    shortDate: split ? 7 : 6,
    students: split ? 8 : 7
  };
  return map[key];
}

function findMonthBlocks(colA) {
  const blocks = [];
  for (let i = 0; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && MONTH_HEADER_RE.test(String(cell).trim())) {
      blocks.push({ start0: i, header: String(cell).trim() });
    }
  }
  return blocks;
}

function findNextMonthStart(colA, fromRow) {
  for (let i = fromRow + 1; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && MONTH_HEADER_RE.test(String(cell).trim())) return i;
  }
  return colA.length;
}

async function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function withRetry(fn, label) {
  let delay = 3000;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e && (e.status || e.code);
      if (status !== 429 || attempt === 5) throw e;
      console.log('  rate limited on', label + ', waiting', delay / 1000 + 's...');
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}

function collectClassTab(classId, config) {
  const tabName = config.tab;
  const dailyRows = [];
  const markRows = [];

  return withRetry(function() { return getClassLogColumnA(tabName, 500); }, tabName + ' colA')
    .then(function(colAData) {
    const blocks = findMonthBlocks(colAData);
    return blocks.reduce(function(chain, block) {
      return chain.then(function() {
        const monthStart0 = block.start0;
        const blockEnd0 = findNextMonthStart(colAData, monthStart0);
        const start1 = monthStart0 + 1;
        const end1 = blockEnd0;
        return withRetry(function() {
          return getClassLogValues(tabName, 'A' + start1 + ':ZZ' + end1);
        }, tabName + ' ' + block.header).then(function(rows) {
          if (!rows.length) return;

          const shortRow = rows[rowOffset(config, 'shortDate')] || [];
          const lessonRow = rows[rowOffset(config, 'lesson')] || [];
          const hwRow = rows[rowOffset(config, 'homework')] || [];
          const writingRow = rows[rowOffset(config, 'writing')] || [];
          const studentStart = rowOffset(config, 'students');
          const now = isoNow();

          for (let col = 1; col < shortRow.length; col++) {
            const logDate = parseShortDateLabel(shortRow[col]);
            if (!logDate) continue;

            const lesson = String(lessonRow[col] || '').trim();
            const homework = String(hwRow[col] || '').trim();
            const writing = String(writingRow[col] || '').trim();
            if (lesson || homework || writing) {
              dailyRows.push({
                class_id: String(classId),
                log_date: logDate,
                lesson: lesson || null,
                homework: homework || null,
                writing: writing || null,
                updated_at: now
              });
            }

            for (let r = studentStart; r < rows.length; r++) {
              const name = String((rows[r] && rows[r][0]) || '').trim();
              if (!name || /^이름$/i.test(name)) break;
              const mark = String((rows[r] && rows[r][col]) || '').trim();
              if (!mark || mark === '-' || mark === ' ') continue;
              markRows.push({
                class_id: String(classId),
                student_name: name,
                log_date: logDate,
                mark: mark,
                updated_at: now
              });
            }
          }
        });
      });
    }, Promise.resolve()).then(function() {
      return { dailyRows: dailyRows, markRows: markRows };
    });
  });
}

async function upsertBatch(db, table, payload, onConflict, label) {
  if (!payload.length) return 0;
  let written = 0;
  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const chunk = payload.slice(i, i + BATCH_SIZE);
    const { error } = await db.from(table).upsert(chunk, { onConflict: onConflict });
    if (error) throw new Error(label + ' batch ' + i + ': ' + error.message);
    written += chunk.length;
    process.stdout.write('  ' + label + ': ' + written + '/' + payload.length + '\r');
  }
  if (payload.length) process.stdout.write('\n');
  return written;
}

async function importClassTab(classId, config) {
  const collected = await collectClassTab(classId, config);
  const db = getSupabase();

  const dailyMap = new Map();
  collected.dailyRows.forEach(function(row) {
    dailyMap.set(row.class_id + '|' + row.log_date, row);
  });
  const markMap = new Map();
  collected.markRows.forEach(function(row) {
    markMap.set(row.class_id + '|' + row.student_name + '|' + row.log_date, row);
  });
  const dailyRows = Array.from(dailyMap.values());
  const markRows = Array.from(markMap.values());

  console.log('  collected daily:', dailyRows.length, 'marks:', markRows.length);
  const dailyCount = await upsertBatch(
    db, 'class_log_daily', dailyRows, 'class_id,log_date', 'daily'
  );
  const markCount = await upsertBatch(
    db, 'class_log_student_marks', markRows, 'class_id,student_name,log_date', 'marks'
  );
  return { dailyCount: dailyCount, markCount: markCount };
}

async function main() {
  const t0 = Date.now();
  const onlyClass = process.argv.find(function(a) { return a.startsWith('--class='); });
  const classFilter = onlyClass ? onlyClass.split('=')[1] : '';
  getSupabase();
  let totalDaily = 0;
  let totalMarks = 0;

  const classIds = Object.keys(CLASS_LOG_TAB_BY_CLASS_ID).filter(function(id) {
    return !classFilter || id === classFilter;
  });

  for (const classId of classIds) {
    const config = CLASS_LOG_TAB_BY_CLASS_ID[classId];
    console.log('Importing class log', classId, 'tab', config.tab);
    const result = await importClassTab(classId, config);
    console.log('  done daily:', result.dailyCount, 'marks:', result.markCount);
    totalDaily += result.dailyCount;
    totalMarks += result.markCount;
    await sleep(1500);
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('Done in', sec + 's — class_log_daily:', totalDaily, 'class_log_student_marks:', totalMarks);
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
