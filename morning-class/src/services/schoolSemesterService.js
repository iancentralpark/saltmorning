const { SCHOOL_SEMESTERS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { todayStr } = require('../dateUtils');
const crypto = require('crypto');

/** SemesterKey, Label, StartDate, EndDate, Closed, UpdatedAt */
const HEADERS = ['SemesterKey', 'Label', 'StartDate', 'EndDate', 'Closed', 'UpdatedAt'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.getFullYear() + '-' + pad2(val.getMonth() + 1) + '-' + pad2(val.getDate());
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]);
  return s.slice(0, 10);
}

function newSemesterKey() {
  return 'sem_' + crypto.randomBytes(4).toString('hex');
}

async function ensureSchoolSemestersSheet() {
  await ensureSheet(SCHOOL_SEMESTERS_SHEET, HEADERS);
}

function parseRow(row, rowIndex) {
  const closedRaw = String(row[4] || '').trim().toUpperCase();
  return {
    key: String(row[0] || '').trim(),
    label: String(row[1] || '').trim(),
    startDate: formatDate(row[2]),
    endDate: formatDate(row[3]),
    closed: closedRaw === 'Y' || closedRaw === 'TRUE' || closedRaw === '1',
    updatedAt: String(row[5] || ''),
    _row: rowIndex
  };
}

function asTerm(sem, classId) {
  if (!sem) return null;
  return {
    termId: sem.key,
    classId: classId ? String(classId) : '*',
    label: sem.label,
    startDate: sem.startDate || '',
    endDate: sem.endDate || '',
    semesterKey: sem.key,
    closed: !!sem.closed
  };
}

/** Korean academic year: March–February. 2026-03-01 → 2026 (label 2026–2027). */
function academicYearOfDate(dateStr) {
  const s = formatDate(dateStr);
  if (!s) return 0;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!y || !m) return 0;
  return m >= 3 ? y : y - 1;
}

function academicYearOf(sem) {
  return academicYearOfDate(sem && sem.startDate);
}

function academicYearLabel(year) {
  const y = Number(year) || 0;
  if (!y) return '';
  return y + '–' + (y + 1);
}

function semesterSlotOf(sem) {
  const s = formatDate(sem && sem.startDate);
  if (!s) return 0;
  const m = Number(s.slice(5, 7));
  return m >= 3 && m <= 8 ? 1 : 2;
}

function endOfFeb(year) {
  const y = Number(year);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return y + '-02-' + (leap ? '29' : '28');
}

function defaultDatesForSlot(academicYear, slot) {
  const y = Number(academicYear);
  if (Number(slot) === 1) {
    return { startDate: y + '-03-01', endDate: y + '-08-31' };
  }
  return { startDate: y + '-09-01', endDate: endOfFeb(y + 1) };
}

function addDays(isoDate, days) {
  const s = formatDate(isoDate);
  if (!s) return '';
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function decorateSemester(sem, activeKey) {
  if (!sem) return null;
  const academicYear = academicYearOf(sem);
  return Object.assign({}, sem, {
    academicYear,
    academicYearLabel: academicYearLabel(academicYear),
    slot: semesterSlotOf(sem),
    isActive: !!(activeKey && sem.key === activeKey),
    isFuture: !!(sem.startDate && sem.startDate > todayStr()),
    isPast: !!(sem.endDate && sem.endDate < todayStr())
  });
}

function groupSemestersByYear(semesters, activeKey) {
  const years = [];
  const byYear = new Map();
  (semesters || []).forEach((raw) => {
    const sem = decorateSemester(raw, activeKey);
    if (!sem || !sem.academicYear) return;
    if (!byYear.has(sem.academicYear)) {
      const group = { year: sem.academicYear, label: sem.academicYearLabel, semesters: [] };
      byYear.set(sem.academicYear, group);
      years.push(group);
    }
    byYear.get(sem.academicYear).semesters.push(sem);
  });
  years.sort((a, b) => a.year - b.year);
  years.forEach((g) => g.semesters.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')));
  return years;
}

/** Default 1H/2H label suggestion for a new semester starting on `startDate`. */
function suggestLabel(startDate) {
  const s = formatDate(startDate);
  if (!s) return '';
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const slot = month >= 3 && month <= 8 ? 1 : 2;
  return year + ' Semester ' + slot;
}

/**
 * All configured semesters (current + historical), oldest first.
 * No forced 2-slot shape any more — a school's history can be any length.
 */
async function listSchoolSemesters() {
  await ensureSchoolSemestersSheet();
  const rows = await getSheetRows(SCHOOL_SEMESTERS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const sem = parseRow(rows[i], i + 1);
    sem.configured = !!(sem.startDate && sem.endDate);
    out.push(sem);
  }
  out.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return out;
}

async function getSchoolSemester(keyOrLabel) {
  const semesters = await listSchoolSemesters();
  const q = String(keyOrLabel || '').trim().toLowerCase();
  if (!q) return null;
  return semesters.find((s) =>
    s.key.toLowerCase() === q ||
    s.label.toLowerCase() === q
  ) || null;
}

async function getActiveSchoolSemester() {
  const semesters = await listSchoolSemesters();
  const configured = semesters.filter((s) => s.startDate && s.endDate);
  if (!configured.length) return null;
  const today = todayStr();
  const openCurrent = configured.find((s) => !s.closed && s.startDate <= today && today <= s.endDate);
  if (openCurrent) return openCurrent;
  const anyCurrent = configured.find((s) => s.startDate <= today && today <= s.endDate);
  if (anyCurrent) return anyCurrent;
  const openPast = configured.filter((s) => !s.closed && s.startDate <= today);
  if (openPast.length) return openPast[openPast.length - 1];
  const past = configured.filter((s) => s.startDate <= today);
  if (past.length) return past[past.length - 1];
  return configured[0];
}

/**
 * Grade/lesson/report compatibility: school-wide semesters exposed as "terms".
 * Includes closed (historical) semesters so past data stays viewable.
 */
async function listTermsForClass(classId) {
  const semesters = await listSchoolSemesters();
  return semesters
    .filter((s) => s.startDate && s.endDate)
    .map((s) => asTerm(s, classId));
}

async function getActiveTermForClass(classId) {
  return asTerm(await getActiveSchoolSemester(), classId);
}

async function getTermForClass(classId, label) {
  const sem = await getSchoolSemester(label);
  if (!sem || !sem.startDate || !sem.endDate) return null;
  return asTerm(sem, classId);
}

function validateDates(label, startDate, endDate) {
  if (!startDate || !endDate) {
    throw new Error(label + ': set both start and end dates.');
  }
  if (endDate < startDate) {
    throw new Error(label + ': end date must be on or after start date.');
  }
}

function assertNoOverlap(existing, startDate, endDate, ignoreKey) {
  const overlap = existing.find((s) => {
    if (ignoreKey && s.key === ignoreKey) return false;
    if (!s.startDate || !s.endDate) return false;
    return startDate <= s.endDate && s.startDate <= endDate;
  });
  if (overlap) {
    throw new Error('Dates overlap with "' + overlap.label + '" (' + overlap.startDate + ' – ' + overlap.endDate + ').');
  }
}

/**
 * Create a new semester. Label defaults to a "{year} Semester {1|2}" guess
 * from the start date, but admins may type any label (e.g. "2025 Fall").
 */
async function createSemester(payload) {
  await ensureSchoolSemestersSheet();
  const startDate = formatDate(payload && payload.startDate);
  const endDate = formatDate(payload && payload.endDate);
  const label = String((payload && payload.label) || '').trim() || suggestLabel(startDate);
  validateDates(label || 'New semester', startDate, endDate);

  const existing = await listSchoolSemesters();
  assertNoOverlap(existing, startDate, endDate);

  const key = newSemesterKey();
  const now = new Date().toISOString();
  await appendRows(SCHOOL_SEMESTERS_SHEET, [[key, label, startDate, endDate, 'N', now]]);
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return (await listSchoolSemesters()).find((s) => s.key === key);
}

/** Edit label/dates. Closed only locks teacher gradebooks, not admin dates. */
async function updateSemester(key, payload) {
  await ensureSchoolSemestersSheet();
  const existing = await listSchoolSemesters();
  const sem = existing.find((s) => s.key === String(key || '').trim());
  if (!sem) throw Object.assign(new Error('Semester not found.'), { status: 404 });

  const startDate = formatDate((payload && payload.startDate) || sem.startDate);
  const endDate = formatDate((payload && payload.endDate) || sem.endDate);
  const label = String((payload && payload.label) != null ? payload.label : sem.label).trim() || sem.label;
  validateDates(label, startDate, endDate);
  assertNoOverlap(existing, startDate, endDate, sem.key);

  const now = new Date().toISOString();
  await updateRange(
    SCHOOL_SEMESTERS_SHEET,
    `A${sem._row}:F${sem._row}`,
    [[sem.key, label, startDate, endDate, sem.closed ? 'Y' : 'N', now]]
  );
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return (await listSchoolSemesters()).find((s) => s.key === sem.key);
}

async function deleteSemester(key) {
  await ensureSchoolSemestersSheet();
  const existing = await listSchoolSemesters();
  const sem = existing.find((s) => s.key === String(key || '').trim());
  if (!sem) throw Object.assign(new Error('Semester not found.'), { status: 404 });
  await updateRange(
    SCHOOL_SEMESTERS_SHEET,
    `A${sem._row}:F${sem._row}`,
    [new Array(6).fill('')]
  );
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return { deleted: true, key: sem.key, label: sem.label };
}

async function setSemesterClosed(key, closed) {
  await ensureSchoolSemestersSheet();
  const existing = await listSchoolSemesters();
  const sem = existing.find((s) => s.key === String(key || '').trim());
  if (!sem) throw Object.assign(new Error('Semester not found.'), { status: 404 });

  const now = new Date().toISOString();
  await updateRange(
    SCHOOL_SEMESTERS_SHEET,
    `A${sem._row}:F${sem._row}`,
    [[sem.key, sem.label, sem.startDate, sem.endDate, closed ? 'Y' : 'N', now]]
  );
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return (await listSchoolSemesters()).find((s) => s.key === sem.key);
}

async function closeSemester(key) {
  return setSemesterClosed(key, true);
}

async function reopenSemester(key) {
  return setSemesterClosed(key, false);
}

function findOverlapping(list, startDate, endDate) {
  return (list || []).find((s) => {
    if (!s.startDate || !s.endDate) return false;
    return startDate <= s.endDate && s.startDate <= endDate;
  }) || null;
}

async function findOrCreateSemester(payload) {
  const startDate = formatDate(payload && payload.startDate);
  const endDate = formatDate(payload && payload.endDate);
  const label = String((payload && payload.label) || '').trim() || suggestLabel(startDate);
  const existing = await listSchoolSemesters();
  const hit = findOverlapping(existing, startDate, endDate);
  if (hit) return hit;
  return createSemester({ label, startDate, endDate });
}

/**
 * Next semester after `fromKey` (or the active semester). Creates default
 * 1H/2H dates when that slot does not exist yet.
 */
async function ensureNextSemester(fromKey) {
  const list = await listSchoolSemesters();
  const configured = list.filter((s) => s.startDate && s.endDate);
  const from = (fromKey && configured.find((s) => s.key === String(fromKey)))
    || await getActiveSchoolSemester()
    || configured[configured.length - 1]
    || null;

  if (from) {
    const later = configured
      .filter((s) => s.startDate > from.startDate)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (later.length) return later[0];
  }

  const fromYear = from ? academicYearOf(from) : academicYearOfDate(todayStr());
  const fromSlot = from ? semesterSlotOf(from) : (Number(todayStr().slice(5, 7)) >= 3 && Number(todayStr().slice(5, 7)) <= 8 ? 1 : 2);
  const nextYear = fromSlot === 1 ? fromYear : fromYear + 1;
  const nextSlot = fromSlot === 1 ? 2 : 1;
  let dates = defaultDatesForSlot(nextYear, nextSlot);
  if (from && dates.startDate <= from.endDate) {
    const startDate = addDays(from.endDate, 1);
    const endGuess = addDays(startDate, 180);
    dates = { startDate, endDate: endGuess };
  }
  return findOrCreateSemester({
    label: suggestLabel(dates.startDate),
    startDate: dates.startDate,
    endDate: dates.endDate
  });
}

/**
 * Create (or reuse) both semesters of the next academic year.
 * Returns the year group with `focus` = Semester 1 of that year.
 */
async function ensureNextSchoolYear(fromKey) {
  const list = await listSchoolSemesters();
  const configured = list.filter((s) => s.startDate && s.endDate);
  const from = (fromKey && configured.find((s) => s.key === String(fromKey)))
    || await getActiveSchoolSemester()
    || configured[configured.length - 1]
    || null;
  const fromYear = from ? academicYearOf(from) : academicYearOfDate(todayStr());
  const nextYear = (fromYear || academicYearOfDate(todayStr())) + 1;

  const s1dates = defaultDatesForSlot(nextYear, 1);
  const s2dates = defaultDatesForSlot(nextYear, 2);
  const s1 = await findOrCreateSemester({
    label: nextYear + ' Semester 1',
    startDate: s1dates.startDate,
    endDate: s1dates.endDate
  });
  let s2 = null;
  try {
    s2 = await findOrCreateSemester({
      label: nextYear + ' Semester 2',
      startDate: s2dates.startDate,
      endDate: s2dates.endDate
    });
  } catch (_) {
    s2 = null;
  }
  const semesters = [s1, s2].filter(Boolean);
  return {
    year: nextYear,
    label: academicYearLabel(nextYear),
    semesters,
    focus: s1
  };
}

async function getPlanningContext() {
  const [semesters, active] = await Promise.all([
    listSchoolSemesters(),
    getActiveSchoolSemester()
  ]);
  const activeKey = active ? active.key : '';
  const decorated = semesters.map((s) => decorateSemester(s, activeKey));
  return {
    semesters: decorated,
    years: groupSemestersByYear(semesters, activeKey),
    activeSemesterKey: activeKey,
    activeSemester: decorateSemester(active, activeKey)
  };
}

module.exports = {
  ensureSchoolSemestersSheet,
  listSchoolSemesters,
  getSchoolSemester,
  getActiveSchoolSemester,
  listTermsForClass,
  getActiveTermForClass,
  getTermForClass,
  createSemester,
  updateSemester,
  deleteSemester,
  closeSemester,
  reopenSemester,
  asTerm,
  suggestLabel,
  academicYearOf,
  academicYearOfDate,
  academicYearLabel,
  semesterSlotOf,
  decorateSemester,
  groupSemestersByYear,
  ensureNextSemester,
  ensureNextSchoolYear,
  getPlanningContext,
  defaultDatesForSlot
};
