const crypto = require('crypto');
const { BELL_SCHEDULE_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');

const HEADERS = ['PeriodID', 'Label', 'PeriodType', 'StartTime', 'EndTime', 'SortOrder'];
const COL = { periodId: 0, label: 1, periodType: 2, startTime: 3, endTime: 4, sortOrder: 5 };

const DEFAULT_PERIODS = [
  ['P01', '1st period', 'lesson', '09:00', '09:50', '0'],
  ['P02', '2nd period', 'lesson', '10:00', '10:50', '1'],
  ['R01', 'Recess', 'recess', '10:50', '11:10', '2'],
  ['P03', '3rd period', 'lesson', '11:10', '12:00', '3'],
  ['L01', 'Lunch', 'lunch', '12:00', '13:00', '4'],
  ['P04', '4th period', 'lesson', '13:00', '13:50', '5'],
  ['P05', '5th period', 'lesson', '14:00', '14:50', '6']
];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

function normalizeTime(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Time must be HH:MM.');
  return String(Number(m[1])).padStart(2, '0') + ':' + m[2];
}

function rowToPeriod(row) {
  if (!row || !row[COL.periodId]) return null;
  return {
    periodId: String(row[COL.periodId]),
    label: String(row[COL.label] || ''),
    periodType: String(row[COL.periodType] || 'lesson').trim() || 'lesson',
    startTime: String(row[COL.startTime] || ''),
    endTime: String(row[COL.endTime] || ''),
    sortOrder: Number(row[COL.sortOrder]) || 0
  };
}

async function ensureBellScheduleSheet() {
  await ensureSheet(BELL_SCHEDULE_SHEET, HEADERS);
  const rows = await getSheetRows(BELL_SCHEDULE_SHEET, { skipCache: true });
  if (rows.length <= 1) {
    await appendRows(BELL_SCHEDULE_SHEET, DEFAULT_PERIODS);
    invalidateSheetRowsCache(BELL_SCHEDULE_SHEET);
  }
}

async function getBellSchedule() {
  await ensureBellScheduleSheet();
  const rows = await getSheetRows(BELL_SCHEDULE_SHEET);
  const periods = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rowToPeriod(rows[i]);
    if (p) periods.push(p);
  }
  periods.sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));
  const lessonPeriods = periods.filter((p) => p.periodType === 'lesson');
  return { periods, lessonPeriods };
}

async function saveBellSchedule(periods) {
  if (!Array.isArray(periods) || !periods.length) {
    throw new Error('At least one period is required.');
  }

  await ensureBellScheduleSheet();
  const rows = periods.map((p, idx) => {
    const startTime = normalizeTime(p.startTime);
    const endTime = normalizeTime(p.endTime);
    if (endTime <= startTime) throw new Error('End time must be after start for ' + (p.label || 'period'));
    const periodType = String(p.periodType || 'lesson').trim();
    if (!['lesson', 'recess', 'lunch', 'break'].includes(periodType)) {
      throw new Error('Invalid period type: ' + periodType);
    }
    return [
      String(p.periodId || '').trim() || newId('per'),
      String(p.label || '').trim() || ('Period ' + (idx + 1)),
      periodType,
      startTime,
      endTime,
      String(Number(p.sortOrder) || idx)
    ];
  });

  const existing = await getSheetRows(BELL_SCHEDULE_SHEET, { skipCache: true });
  const oldCount = Math.max(0, existing.length - 1);
  const width = HEADERS.length;

  if (!oldCount) {
    await appendRows(BELL_SCHEDULE_SHEET, rows);
  } else {
    const maxRows = Math.max(oldCount, rows.length);
    const toWrite = [];
    for (let i = 0; i < maxRows; i++) {
      toWrite.push(i < rows.length ? rows[i] : new Array(width).fill(''));
    }
    await updateRange(BELL_SCHEDULE_SHEET, `A2:F${maxRows + 1}`, toWrite);
  }
  invalidateSheetRowsCache(BELL_SCHEDULE_SHEET);
  return getBellSchedule();
}

module.exports = { ensureBellScheduleSheet, getBellSchedule, saveBellSchedule, DEFAULT_PERIODS };
