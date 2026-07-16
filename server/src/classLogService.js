const { CLASS_LOG_TAB_BY_CLASS_ID, TIMEZONE, STUDENT_WITHDRAWN_SHEET } = require('./config');
const { getSheetRows } = require('./sheets');
const { getEnrolledStudents } = require('./homeworkService');
const {
  getClassLogValues,
  getClassLogColumnA,
  updateClassLogRange,
  batchClassLogUpdate,
  getClassLogSheetId,
  colLetter,
  a1Cell
} = require('./classLogSheets');
const { formatSheetDate } = require('./dateUtils');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH_HEADER_RE = /^[A-Za-z]+, 20\d{2}$/;

function getTabConfig(classId) {
  const cfg = CLASS_LOG_TAB_BY_CLASS_ID[String(classId)];
  if (!cfg) return null;
  return cfg;
}

function monthHeaderForDate(dateStr) {
  const p = dateStr.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]) - 1;
  return MONTH_NAMES[m] + ', ' + y;
}

function monthHeaderToFirstDay(monthHeader) {
  const m = String(monthHeader || '').trim().match(/^([A-Za-z]+),\s*(20\d{2})$/);
  if (!m) return '';
  const idx = MONTH_NAMES.indexOf(m[1]);
  if (idx < 0) return '';
  const month = String(idx + 1).padStart(2, '0');
  return m[2] + '-' + month + '-01';
}

function compareDateStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findClassIdForTab(tabName) {
  const target = String(tabName || '').trim();
  for (const classId of Object.keys(CLASS_LOG_TAB_BY_CLASS_ID)) {
    const cfg = CLASS_LOG_TAB_BY_CLASS_ID[classId];
    if (String(cfg.tab || '').trim() === target) return classId;
  }
  return null;
}

function parseShortDateLabel(shortLabel, fallbackYear) {
  const m = String(shortLabel || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]) >= 70 ? '19' + m[1] : '20' + m[1];
  return y + '-' + m[2] + '-' + m[3];
}

async function getWithdrawalDateMap(classId) {
  classId = String(classId);
  let data;
  try {
    data = await getSheetRows(STUDENT_WITHDRAWN_SHEET);
  } catch (e) {
    return {};
  }
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    const sid = String(data[i][1]);
    const wd = formatSheetDate(data[i][7]);
    if (!wd) continue;
    if (!map[sid] || compareDateStr(wd, map[sid]) < 0) map[sid] = wd;
  }
  return map;
}

/** Students who should have a row in this month's class log block. */
async function getClassLogRosterForMonth(classId, monthFirstDayStr) {
  classId = String(classId);
  monthFirstDayStr = formatSheetDate(monthFirstDayStr);
  const rosterMap = {};
  const enrolled = await getEnrolledStudents(classId);
  enrolled.forEach(s => { rosterMap[String(s.id)] = { id: String(s.id), name: s.name }; });

  let data;
  try {
    data = await getSheetRows(STUDENT_WITHDRAWN_SHEET);
  } catch (e) {
    data = [];
  }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    const sid = String(data[i][1]);
    const wd = formatSheetDate(data[i][7]);
    if (!wd || compareDateStr(wd, monthFirstDayStr) < 0) continue;
    if (!rosterMap[sid]) {
      rosterMap[sid] = { id: sid, name: String(data[i][2] || sid) };
    }
  }
  return Object.values(rosterMap).sort((a, b) => a.name.localeCompare(b.name));
}

function getChambitMarkForStudent(studentId, dateStr, read, leaveMap, withdrawalMap) {
  const wd = withdrawalMap[String(studentId)];
  if (wd && compareDateStr(dateStr, wd) >= 0) return '퇴원';
  if (leaveMap[String(studentId)]) return '휴원';
  return read ? 'O' : 'X';
}

function formatLongDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return DAY_NAMES[d.getDay()] + ', ' + d.getDate();
}

function formatShortDateLabel(dateStr) {
  const p = dateStr.split('-');
  return p[0].slice(-2) + '.' + p[1] + '.' + p[2];
}

function normalizeCell(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Match roster name ↔ class-log column A.
 * Exact (case-insensitive), or the sheet cell contains the full roster name.
 * Do NOT match on first/last name alone — "Paul Lee" must not hit "Sean Lee".
 */
function matchStudentName(backendName, logName) {
  const bn = normalizeCell(backendName);
  const ln = normalizeCell(logName);
  if (!bn || !ln) return false;
  if (ln === bn) return true;
  if (ln.includes(bn)) return true;
  return false;
}

async function resolveBlockEnd(tabName, monthStart0) {
  const colA = await getClassLogColumnA(tabName, Math.max(400, monthStart0 + 120));
  return findNextMonthStart(colA, monthStart0);
}

function findMonthBlockStart(colA, monthHeader) {
  const exact = String(monthHeader).trim();
  for (let i = 0; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && String(cell).trim() === exact) return i;
  }
  const monthName = exact.split(',')[0].trim();
  const yearPart = (exact.split(',')[1] || '').trim();
  for (let i = 0; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (!cell) continue;
    const t = String(cell).trim();
    if (t === monthName) return i;
    if (yearPart && (t === monthName + ' ' + yearPart || t === monthName + ', ' + yearPart)) return i;
  }
  return -1;
}

function findLastMonthBlockStart(colA) {
  let last = -1;
  for (let i = 0; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && MONTH_HEADER_RE.test(String(cell).trim())) last = i;
  }
  return last;
}

/** Clone the latest month block when a new month (e.g. July, 2026) is not in column A yet. */
async function ensureMonthBlockStart(tabName, config, monthHeader, classId) {
  let colA = await getClassLogColumnA(tabName, 400);
  let monthStart0 = findMonthBlockStart(colA, monthHeader);
  if (monthStart0 >= 0) return monthStart0;

  const templateStart0 = findLastMonthBlockStart(colA);
  if (templateStart0 < 0) {
    throw new Error(
      'Class log has no month template. Add a row "' + monthHeader + '" in column A of tab "' +
      tabName + '", or copy an existing month block.'
    );
  }

  if (!classId) classId = findClassIdForTab(tabName);
  const monthFirstDay = monthHeaderToFirstDay(monthHeader);
  const roster = classId && monthFirstDay
    ? await getClassLogRosterForMonth(classId, monthFirstDay)
    : [];

  const templateEnd0 = findNextMonthStart(colA, templateStart0);
  const templateStart1 = templateStart0 + 1;
  const templateEnd1 = templateEnd0;
  const insertAt1 = templateEnd0 + 1;
  const blockRows = await getClassLogValues(tabName, `A${templateStart1}:ZZ${templateEnd1}`);
  const studentOffset = rowOffset(config, 'students');

  const headerRows = blockRows.slice(0, studentOffset).map(function(row, idx) {
    const out = row.map(function(cell, c) { return c === 0 ? cell : ''; });
    if (idx === 0) out[0] = monthHeader;
    else out[0] = row[0] || '';
    return out;
  });
  const studentRows = roster.length
    ? roster.map(function(s) { return [s.name]; })
    : blockRows.slice(studentOffset).map(function(row) {
      const out = row.map(function(cell, c) { return c === 0 ? cell : ''; });
      out[0] = row[0] || '';
      return out;
    });
  const newRows = headerRows.concat(studentRows);

  await updateClassLogRange(tabName, `A${insertAt1}`, newRows);
  return templateEnd0;
}

function findNextMonthStart(colA, fromRow) {
  for (let i = fromRow + 1; i < colA.length; i++) {
    const cell = colA[i] && colA[i][0];
    if (cell && MONTH_HEADER_RE.test(String(cell).trim())) return i;
  }
  return colA.length;
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

async function readSheetRow(tabName, row1) {
  const rows = await getClassLogValues(tabName, `${row1}:${row1}`);
  return rows[0] || [];
}

function findDateColumnInRow(row, dateStr) {
  const longLabel = formatLongDateLabel(dateStr);
  const shortLabel = formatShortDateLabel(dateStr);
  for (let c = 1; c < row.length; c++) {
    const v = String(row[c] || '').trim();
    if (!v) continue;
    if (v === longLabel || v === shortLabel) return c;
    if (v.replace(/\s+/g, ' ') === longLabel) return c;
  }
  return -1;
}

function findLastUsedColumn(dateRow) {
  let last = 0;
  for (let c = 1; c < dateRow.length; c++) {
    if (String(dateRow[c] || '').trim()) last = c;
  }
  return last;
}

async function findStudentRow(tabName, monthStart0, config, studentName, blockEnd0) {
  const startRow1 = monthStart0 + rowOffset(config, 'students') + 1;
  const endRow1 = blockEnd0 > 0 ? blockEnd0 : await resolveBlockEnd(tabName, monthStart0);
  const rows = await getClassLogValues(tabName, `A${startRow1}:A${endRow1}`);
  const target = normalizeCell(studentName);
  let fuzzy = -1;
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i] && rows[i][0];
    if (!name || !String(name).trim()) continue; // blank rows can appear after bad inserts — skip, don't stop
    const cell = String(name);
    if (normalizeCell(cell) === target) return startRow1 + i;
    if (fuzzy < 0 && matchStudentName(studentName, cell)) fuzzy = startRow1 + i;
  }
  return fuzzy;
}

async function deleteClassLogRows(tabName, row1List) {
  if (!row1List.length) return;
  const sheetId = await getClassLogSheetId(tabName);
  const requests = row1List
    .slice()
    .sort((a, b) => b - a)
    .map(function(row1) {
      return {
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: row1 - 1,
            endIndex: row1
          }
        }
      };
    });
  await batchClassLogUpdate(requests);
}

/**
 * Keep one row per roster student. Remove blank name rows, duplicate names,
 * and names no longer on the roster. Append missing students as a single new
 * row each — name in column A, prior date columns left blank (no inherited O/X).
 * Returns the refreshed month-block end (0-based next-month index / exclusive end).
 */
async function ensureStudentRows(tabName, monthStart0, config, blockEnd0, classId, monthFirstDay) {
  const roster = await getClassLogRosterForMonth(classId, monthFirstDay);
  let end0 = blockEnd0 > 0 ? blockEnd0 : await resolveBlockEnd(tabName, monthStart0);
  const startRow1 = monthStart0 + rowOffset(config, 'students') + 1;

  async function readNameRows() {
    end0 = await resolveBlockEnd(tabName, monthStart0);
    if (end0 < startRow1) return [];
    const rows = await getClassLogValues(tabName, `A${startRow1}:A${end0}`);
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] && rows[i][0];
      out.push({
        row1: startRow1 + i,
        name: raw != null && String(raw).trim() ? String(raw).trim() : ''
      });
    }
    // Trailing empty slots past the last named student are fine; still scan the packed range.
    return out;
  }

  let nameRows = await readNameRows();

  // Prefer keeping the duplicate row that already has Chambit marks.
  const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
  const shortRowForWidth = await readSheetRow(tabName, shortRow1);
  const markCols = Math.max(findLastUsedColumn(shortRowForWidth), 1);
  const markGrid = nameRows.length
    ? await getClassLogValues(
      tabName,
      `B${startRow1}:${colLetter(markCols)}${startRow1 + nameRows.length - 1}`
    )
    : [];
  function filledMarkCount(idx) {
    const row = markGrid[idx] || [];
    let n = 0;
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] || '').trim()) n++;
    }
    return n;
  }

  // 1) Choose keepers, then delete blanks / extras / non-roster (bottom → top).
  const bestByKey = new Map(); // normalized name → { row1, idx, marks }
  for (let i = 0; i < nameRows.length; i++) {
    const entry = nameRows[i];
    if (!entry.name) continue;
    const inRoster = roster.some(s => matchStudentName(s.name, entry.name));
    if (!inRoster) continue;
    const key = normalizeCell(entry.name);
    const marks = filledMarkCount(i);
    const prev = bestByKey.get(key);
    if (!prev || marks > prev.marks || (marks === prev.marks && entry.row1 < prev.row1)) {
      bestByKey.set(key, { row1: entry.row1, idx: i, marks });
    }
  }
  const keepRows = new Set([...bestByKey.values()].map(v => v.row1));
  const toDelete = [];
  for (let i = 0; i < nameRows.length; i++) {
    const entry = nameRows[i];
    if (!entry.name || !keepRows.has(entry.row1)) toDelete.push(entry.row1);
  }
  if (toDelete.length) {
    await deleteClassLogRows(tabName, toDelete);
    nameRows = await readNameRows();
  }

  // 2) Append missing roster students once each.
  const existing = nameRows.filter(e => e.name);
  const append = [];
  for (const st of roster) {
    const found = existing.some(e => matchStudentName(st.name, e.name));
    if (!found) append.push([st.name]);
  }

  if (append.length) {
    const lastNamed = existing.length ? existing[existing.length - 1].row1 : startRow1 - 1;
    const insertAt = lastNamed + 1;
    const sheetId = await getClassLogSheetId(tabName);
    await batchClassLogUpdate([{
      insertDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: insertAt - 1,
          endIndex: insertAt - 1 + append.length
        },
        inheritFromBefore: true
      }
    }]);
    await updateClassLogRange(tabName, `A${insertAt}:A${insertAt + append.length - 1}`, append);

    // Clear inherited Chambit marks on prior date columns — new joiners start blank.
    const shortRow = await readSheetRow(tabName, shortRow1);
    const lastCol = findLastUsedColumn(shortRow);
    if (lastCol >= 1) {
      const empty = append.map(function() {
        return Array(lastCol).fill('');
      });
      await updateClassLogRange(
        tabName,
        `B${insertAt}:${colLetter(lastCol)}${insertAt + append.length - 1}`,
        empty
      );
    }
  }

  return resolveBlockEnd(tabName, monthStart0);
}

const SHORT_DATE_BLUE = { red: 0.8117647, green: 0.8862745, blue: 0.9529412 };
const SOLID_BORDER_EDGE = { style: 'SOLID', width: 1 };

function cellBorders() {
  return {
    top: { ...SOLID_BORDER_EDGE },
    bottom: { ...SOLID_BORDER_EDGE },
    left: { ...SOLID_BORDER_EDGE },
    right: { ...SOLID_BORDER_EDGE }
  };
}

function withBorders(format) {
  return Object.assign({}, format, { borders: cellBorders() });
}

function repeatCellFormat(sheetId, row1, col, userEnteredFormat, fields) {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: row1 - 1,
        endRowIndex: row1,
        startColumnIndex: col,
        endColumnIndex: col + 1
      },
      cell: { userEnteredFormat },
      fields
    }
  };
}

function shortDateCellFormat() {
  return withBorders({
    backgroundColor: SHORT_DATE_BLUE,
    horizontalAlignment: 'CENTER',
    verticalAlignment: 'BOTTOM',
    textFormat: { bold: true, fontFamily: 'Arial', fontSize: 12 },
    wrapStrategy: 'WRAP'
  });
}

function longDateCellFormat() {
  return withBorders({
    horizontalAlignment: 'CENTER',
    verticalAlignment: 'BOTTOM',
    wrapStrategy: 'WRAP'
  });
}

function chambitMarkCellFormat() {
  return withBorders({
    horizontalAlignment: 'CENTER',
    verticalAlignment: 'BOTTOM',
    textFormat: { fontFamily: 'Arial', fontSize: 10 }
  });
}

function lessonCellFormat() {
  return withBorders({
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'WRAP'
  });
}

function homeworkCellFormat() {
  return withBorders({
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'MIDDLE',
    wrapStrategy: 'WRAP'
  });
}

function writingCellFormat() {
  return withBorders({
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'BOTTOM',
    wrapStrategy: 'WRAP'
  });
}

function classLabelCellFormat() {
  return withBorders({
    verticalAlignment: 'BOTTOM',
    wrapStrategy: 'WRAP'
  });
}

function formatFields(keys) {
  return 'userEnteredFormat(' + keys.concat('borders').join(',') + ')';
}

function borderedColumnRows(monthStart0, config, blockEnd0) {
  const rows = [
    { row1: monthStart0 + rowOffset(config, 'date') + 1, format: longDateCellFormat() },
    { row1: monthStart0 + rowOffset(config, 'lesson') + 1, format: lessonCellFormat() },
    { row1: monthStart0 + rowOffset(config, 'homework') + 1, format: homeworkCellFormat() },
    { row1: monthStart0 + rowOffset(config, 'writing') + 1, format: writingCellFormat() }
  ];
  if (config.layout === 'split') {
    rows.push({
      row1: monthStart0 + rowOffset(config, 'classLabel') + 1,
      format: classLabelCellFormat()
    });
  }
  rows.push({
    row1: monthStart0 + rowOffset(config, 'shortDate') + 1,
    format: shortDateCellFormat()
  });

  const studentStart1 = monthStart0 + rowOffset(config, 'students') + 1;
  return { rows, studentStart1, blockEnd0 };
}

async function applyNewDateColumnFormats(tabName, monthStart0, config, blockEnd0, col, dateRow1, shortRow1) {
  const sheetId = await getClassLogSheetId(tabName);
  const { rows, studentStart1 } = borderedColumnRows(monthStart0, config, blockEnd0);
  const requests = rows.map(function(entry) {
    const keys = Object.keys(entry.format).filter(function(k) { return k !== 'borders'; });
    return repeatCellFormat(sheetId, entry.row1, col, entry.format, formatFields(keys));
  });

  const nameCol = await getClassLogValues(tabName, `A${studentStart1}:A${blockEnd0}`);
  const markFmt = chambitMarkCellFormat();
  const markKeys = ['horizontalAlignment', 'verticalAlignment', 'textFormat'];
  for (let i = 0; i < nameCol.length; i++) {
    if (!nameCol[i] || !nameCol[i][0]) break;
    requests.push(repeatCellFormat(
      sheetId, studentStart1 + i, col, markFmt, formatFields(markKeys)
    ));
  }

  await batchClassLogUpdate(requests);
}

async function applyChambitMarkFormat(tabName, row1, col) {
  const sheetId = await getClassLogSheetId(tabName);
  await batchClassLogUpdate([
    repeatCellFormat(
      sheetId, row1, col, chambitMarkCellFormat(),
      formatFields(['horizontalAlignment', 'verticalAlignment', 'textFormat'])
    )
  ]);
}

async function fillStatusMarksForDateColumn(tabName, monthStart0, config, blockEnd0, classId, dateStr, col) {
  const { getActiveLeavesByClass } = require('./leaveService');
  const monthFirstDay = monthHeaderToFirstDay(
    String((await getClassLogColumnA(tabName, monthStart0 + 1))[monthStart0][0] || '').trim()
  ) || dateStr.slice(0, 7) + '-01';
  const roster = await getClassLogRosterForMonth(classId, monthFirstDay);
  const leaveMap = await getActiveLeavesByClass(classId, dateStr);
  const withdrawalMap = await getWithdrawalDateMap(classId);

  for (const st of roster) {
    const mark = getChambitMarkForStudent(st.id, dateStr, false, leaveMap, withdrawalMap);
    if (mark !== '휴원' && mark !== '퇴원') continue;
    const row1 = await findStudentRow(tabName, monthStart0, config, st.name, blockEnd0);
    if (row1 < 0) continue;
    await updateClassLogRange(tabName, a1Cell(row1, col), [[mark]]);
    await applyChambitMarkFormat(tabName, row1, col);
  }
}

async function ensureDateColumn(tabName, monthStart0, config, blockEnd0, dateStr, classId) {
  const dateRow1 = monthStart0 + rowOffset(config, 'date') + 1;
  const dateRow = await readSheetRow(tabName, dateRow1);
  let col = findDateColumnInRow(dateRow, dateStr);
  if (col >= 0) return { col, dateRow1, created: false, blockEnd0 };

  const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
  const shortRow = await readSheetRow(tabName, shortRow1);
  col = findDateColumnInRow(shortRow, dateStr);
  if (col >= 0) return { col, dateRow1, created: false, blockEnd0 };

  col = findLastUsedColumn(dateRow) + 1;
  if (col < 1) col = 1;

  const longLabel = formatLongDateLabel(dateStr);
  const shortLabel = formatShortDateLabel(dateStr);
  const monthFirstDay = monthHeaderToFirstDay(monthHeaderForDate(dateStr));

  await updateClassLogRange(tabName, a1Cell(dateRow1, col), [[longLabel]]);
  await updateClassLogRange(tabName, a1Cell(shortRow1, col), [[shortLabel]]);

  blockEnd0 = await ensureStudentRows(
    tabName, monthStart0, config, blockEnd0, classId, monthFirstDay
  );
  await applyNewDateColumnFormats(
    tabName, monthStart0, config, blockEnd0, col, dateRow1, shortRow1
  );
  await fillStatusMarksForDateColumn(
    tabName, monthStart0, config, blockEnd0, classId, dateStr, col
  );

  return { col, dateRow1, created: true, blockEnd0 };
}

function lessonHomeworkFormatRequest(sheetId, row1, col, isHomework) {
  const format = isHomework ? homeworkCellFormat() : lessonCellFormat();
  const keys = ['horizontalAlignment', 'verticalAlignment', 'wrapStrategy'];
  return repeatCellFormat(sheetId, row1, col, format, formatFields(keys));
}

async function applyLessonHomeworkFormat(tabName, lessonRow1, hwRow1, col) {
  const sheetId = await getClassLogSheetId(tabName);
  await batchClassLogUpdate([
    lessonHomeworkFormatRequest(sheetId, lessonRow1, col, false),
    lessonHomeworkFormatRequest(sheetId, hwRow1, col, true)
  ]);
}

async function findDateColumnForDate(tabName, monthStart0, config, dateStr) {
  const dateRow1 = monthStart0 + rowOffset(config, 'date') + 1;
  const dateRow = await readSheetRow(tabName, dateRow1);
  let col = findDateColumnInRow(dateRow, dateStr);
  if (col >= 0) return col;

  const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
  const shortRow = await readSheetRow(tabName, shortRow1);
  return findDateColumnInRow(shortRow, dateStr);
}

async function syncChambitToClassLogSupabase(classId, studentName, dateStr, read) {
  const config = getTabConfig(classId);
  if (!config) return { synced: false, reason: 'no_tab_config' };

  dateStr = formatSheetDate(dateStr);
  const monthFirstDay = monthHeaderToFirstDay(monthHeaderForDate(dateStr));
  const roster = await getClassLogRosterForMonth(classId, monthFirstDay);
  const student = roster.find(s => matchStudentName(s.name, studentName));
  if (!student) return { synced: false, reason: 'not_in_roster', studentName };

  const { getActiveLeavesByClass } = require('./leaveService');
  const [leaveMap, withdrawalMap] = await Promise.all([
    getActiveLeavesByClass(classId, dateStr),
    getWithdrawalDateMap(classId)
  ]);
  const mark = getChambitMarkForStudent(student.id, dateStr, read, leaveMap, withdrawalMap);
  const store = require('./supabaseClassLogStore');
  await store.upsertStudentMark(classId, student.name, dateStr, mark);
  return { synced: true, tab: config.tab, mark, source: 'supabase' };
}

async function syncChambitToClassLog(classId, studentName, dateStr, read) {
  const config = getTabConfig(classId);
  if (!config) return { synced: false, reason: 'no_tab_config' };

  dateStr = formatSheetDate(dateStr);
  const monthHeader = monthHeaderForDate(dateStr);
  const monthFirstDay = monthHeaderToFirstDay(monthHeader);

  let colA = await getClassLogColumnA(config.tab, 400);
  let monthStart0 = findMonthBlockStart(colA, monthHeader);
  if (monthStart0 < 0) {
    monthStart0 = await ensureMonthBlockStart(config.tab, config, monthHeader, classId);
    colA = await getClassLogColumnA(config.tab, 400);
  }
  let blockEnd0 = findNextMonthStart(colA, monthStart0);

  // Always reconcile roster first so mid-month joins get one clean row
  // (and leftover duplicate/blank rows from older bugs are pruned).
  blockEnd0 = await ensureStudentRows(
    config.tab, monthStart0, config, blockEnd0, classId, monthFirstDay
  );

  const existingCol = await findDateColumnForDate(config.tab, monthStart0, config, dateStr);
  if (existingCol >= 0) {
    const studentRow1 = await findStudentRow(
      config.tab, monthStart0, config, studentName, blockEnd0
    );
    if (studentRow1 >= 0) {
      const roster = await getClassLogRosterForMonth(classId, monthFirstDay);
      const student = roster.find(s => matchStudentName(s.name, studentName));
      if (student) {
        const { getActiveLeavesByClass } = require('./leaveService');
        const [leaveMap, withdrawalMap] = await Promise.all([
          getActiveLeavesByClass(classId, dateStr),
          getWithdrawalDateMap(classId)
        ]);
        const mark = getChambitMarkForStudent(student.id, dateStr, read, leaveMap, withdrawalMap);
        await updateClassLogRange(config.tab, a1Cell(studentRow1, existingCol), [[mark]]);
        await applyChambitMarkFormat(config.tab, studentRow1, existingCol);
        const quickResult = {
          synced: true,
          tab: config.tab,
          cell: a1Cell(studentRow1, existingCol),
          mark
        };
        const { isSupabaseEnabled } = require('./supabaseClient');
        if (isSupabaseEnabled()) {
          try {
            await syncChambitToClassLogSupabase(classId, studentName, dateStr, read);
            quickResult.mirroredToSupabase = true;
          } catch (err) {
            console.error('syncChambitToClassLog supabase mirror', err.message || err);
          }
        }
        return quickResult;
      }
    }
  }

  const dateInfo = await ensureDateColumn(
    config.tab, monthStart0, config, blockEnd0, dateStr, classId
  );
  const col = dateInfo.col;
  if (dateInfo.blockEnd0) blockEnd0 = dateInfo.blockEnd0;
  else blockEnd0 = await resolveBlockEnd(config.tab, monthStart0);

  const roster = await getClassLogRosterForMonth(classId, monthFirstDay);
  const student = roster.find(s => matchStudentName(s.name, studentName));
  if (!student) return { synced: false, reason: 'not_in_roster', studentName };

  blockEnd0 = await ensureStudentRows(
    config.tab, monthStart0, config, blockEnd0, classId, monthFirstDay
  );
  const studentRow1 = await findStudentRow(
    config.tab, monthStart0, config, student.name, blockEnd0
  );
  if (studentRow1 < 0) {
    return { synced: false, reason: 'student_row_not_found', studentName };
  }

  const { getActiveLeavesByClass } = require('./leaveService');
  const leaveMap = await getActiveLeavesByClass(classId, dateStr);
  const withdrawalMap = await getWithdrawalDateMap(classId);
  const mark = getChambitMarkForStudent(student.id, dateStr, read, leaveMap, withdrawalMap);
  await updateClassLogRange(config.tab, a1Cell(studentRow1, col), [[mark]]);
  await applyChambitMarkFormat(config.tab, studentRow1, col);

  const result = {
    synced: true,
    tab: config.tab,
    cell: a1Cell(studentRow1, col),
    mark
  };

  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    try {
      await syncChambitToClassLogSupabase(classId, studentName, dateStr, read);
      result.mirroredToSupabase = true;
    } catch (err) {
      console.error('syncChambitToClassLog supabase mirror', err.message || err);
    }
  }

  return result;
}

async function saveClassLogEntry(classId, dateStr, lesson, homework, writing) {
  const config = getTabConfig(classId);
  if (!config) throw new Error('No class log tab configured for this class.');

  dateStr = formatSheetDate(dateStr);
  const monthHeader = monthHeaderForDate(dateStr);
  const monthFirstDay = monthHeaderToFirstDay(monthHeader);
  const monthStart0 = await ensureMonthBlockStart(config.tab, config, monthHeader, classId);
  let blockEnd0 = await resolveBlockEnd(config.tab, monthStart0);
  blockEnd0 = await ensureStudentRows(
    config.tab, monthStart0, config, blockEnd0, classId, monthFirstDay
  );
  const dateInfo = await ensureDateColumn(
    config.tab, monthStart0, config, blockEnd0, dateStr, classId
  );
  const col = dateInfo.col;

  const lessonRow1 = monthStart0 + rowOffset(config, 'lesson') + 1;
  const hwRow1 = monthStart0 + rowOffset(config, 'homework') + 1;
  const writingRow1 = monthStart0 + rowOffset(config, 'writing') + 1;

  let wroteLessonOrHw = false;
  if (lesson != null && String(lesson).trim()) {
    await updateClassLogRange(config.tab, a1Cell(lessonRow1, col), [[String(lesson).trim()]]);
    wroteLessonOrHw = true;
  }
  if (homework != null && String(homework).trim()) {
    await updateClassLogRange(config.tab, a1Cell(hwRow1, col), [[String(homework).trim()]]);
    wroteLessonOrHw = true;
  }
  if (writing != null && String(writing).trim()) {
    await updateClassLogRange(config.tab, a1Cell(writingRow1, col), [[String(writing).trim()]]);
  }
  if (wroteLessonOrHw) {
    await applyLessonHomeworkFormat(config.tab, lessonRow1, hwRow1, col);
  }

  const result = {
    message: 'Class log saved.',
    tab: config.tab,
    date: dateStr,
    column: colLetter(col),
    source: 'sheet'
  };

  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    try {
      await require('./supabaseClassLogStore').saveClassLogEntry(
        classId, dateStr, lesson, homework, writing
      );
      result.mirroredToSupabase = true;
    } catch (err) {
      console.error('saveClassLogEntry supabase mirror', err.message || err);
    }
  }

  return result;
}

async function getClassLogEntry(classId, dateStr) {
  const config = getTabConfig(classId);
  if (!config) {
    return { configured: false, found: false, lesson: '', homework: '', writing: '' };
  }

  dateStr = formatSheetDate(dateStr);
  const monthHeader = monthHeaderForDate(dateStr);
  const colA = await getClassLogColumnA(config.tab, 250);
  const monthStart0 = findMonthBlockStart(colA, monthHeader);
  if (monthStart0 >= 0) {
    const dateRow1 = monthStart0 + rowOffset(config, 'date') + 1;
    let dateRow = await readSheetRow(config.tab, dateRow1);
    let col = findDateColumnInRow(dateRow, dateStr);
    if (col < 0) {
      const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
      const shortRow = await readSheetRow(config.tab, shortRow1);
      col = findDateColumnInRow(shortRow, dateStr);
    }
    if (col >= 0) {
      const lessonRow1 = monthStart0 + rowOffset(config, 'lesson') + 1;
      const hwRow1 = monthStart0 + rowOffset(config, 'homework') + 1;
      const writingRow1 = monthStart0 + rowOffset(config, 'writing') + 1;
      const lessonRow = await readSheetRow(config.tab, lessonRow1);
      const hwRow = await readSheetRow(config.tab, hwRow1);
      const writingRow = await readSheetRow(config.tab, writingRow1);
      const lesson = String(lessonRow[col] || '').trim();
      const homework = String(hwRow[col] || '').trim();
      const writing = String(writingRow[col] || '').trim();
      if (lesson || homework || writing) {
        return { configured: true, found: true, lesson, homework, writing, source: 'sheet' };
      }
    }
  }

  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    return require('./supabaseClassLogStore').getDaily(classId, dateStr);
  }

  return { configured: true, found: false, lesson: '', homework: '', writing: '' };
}

function monthEndDate(dateStr) {
  const p = dateStr.split('-');
  const y = Number(p[0]);
  const m = Number(p[1]);
  const last = new Date(y, m, 0).getDate();
  return y + '-' + String(m).padStart(2, '0') + '-' + String(last).padStart(2, '0');
}

/** Write 퇴원/휴원 (or other mark) across existing date columns from fromDate through toDate. */
async function backfillClassLogMarkRange(classId, studentName, fromDateStr, toDateStr, mark) {
  const config = getTabConfig(classId);
  if (!config) return;

  fromDateStr = formatSheetDate(fromDateStr);
  toDateStr = formatSheetDate(toDateStr);
  if (!fromDateStr || !toDateStr || compareDateStr(fromDateStr, toDateStr) > 0) return;

  const tabName = config.tab;
  const monthHeader = monthHeaderForDate(fromDateStr);
  const colA = await getClassLogColumnA(tabName, 400);
  const monthStart0 = findMonthBlockStart(colA, monthHeader);
  if (monthStart0 < 0) return;

  const blockEnd0 = findNextMonthStart(colA, monthStart0);
  const studentRow1 = await findStudentRow(tabName, monthStart0, config, studentName, blockEnd0);
  if (studentRow1 < 0) return; // caller should ensureStudentRows first if needed

  const shortRow1 = monthStart0 + rowOffset(config, 'shortDate') + 1;
  const shortRow = await readSheetRow(tabName, shortRow1);
  for (let c = 1; c < shortRow.length; c++) {
    const colDate = parseShortDateLabel(shortRow[c]);
    if (!colDate) continue;
    if (compareDateStr(colDate, fromDateStr) < 0 || compareDateStr(colDate, toDateStr) > 0) continue;
    await updateClassLogRange(tabName, a1Cell(studentRow1, c), [[mark]]);
    await applyChambitMarkFormat(tabName, studentRow1, c);
  }

  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    try {
      await require('./supabaseClassLogStore').backfillMarkRange(
        classId, studentName, fromDateStr, toDateStr, mark
      );
    } catch (err) {
      console.error('backfillClassLogMarkRange supabase mirror', err.message || err);
    }
  }
}

async function backfillWithdrawnInClassLog(classId, studentName, fromDateStr) {
  const end = monthEndDate(fromDateStr);
  await backfillClassLogMarkRange(classId, studentName, fromDateStr, end, '퇴원');
}

async function backfillLeaveInClassLog(classId, studentName, startDate, endDate) {
  await backfillClassLogMarkRange(classId, studentName, startDate, endDate, '휴원');
}

module.exports = {
  syncChambitToClassLog,
  saveClassLogEntry,
  getClassLogEntry,
  getTabConfig,
  matchStudentName,
  getClassLogRosterForMonth,
  backfillWithdrawnInClassLog,
  backfillLeaveInClassLog
};
