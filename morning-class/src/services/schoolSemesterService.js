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
 * Grades, report cards, lesson plans, and workflow rows are all keyed by the
 * semester LABEL (not the immutable key), so two semesters sharing a label
 * would make getSchoolSemester()/getGradeTerm() etc. silently resolve to the
 * wrong one. Must stay unique (case-insensitive) across the whole list.
 */
function assertUniqueLabel(existing, label, ignoreKey) {
  const q = String(label || '').trim().toLowerCase();
  if (!q) return;
  const dup = existing.find((s) => s.key !== ignoreKey && s.label.trim().toLowerCase() === q);
  if (dup) {
    throw new Error('A semester named "' + dup.label + '" already exists. Choose a different label.');
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
  assertUniqueLabel(existing, label);

  const key = newSemesterKey();
  const now = new Date().toISOString();
  await appendRows(SCHOOL_SEMESTERS_SHEET, [[key, label, startDate, endDate, 'N', now]]);
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return (await listSchoolSemesters()).find((s) => s.key === key);
}

/** Edit label/dates on a semester that is still open. */
async function updateSemester(key, payload) {
  await ensureSchoolSemestersSheet();
  const existing = await listSchoolSemesters();
  const sem = existing.find((s) => s.key === String(key || '').trim());
  if (!sem) throw Object.assign(new Error('Semester not found.'), { status: 404 });
  if (sem.closed) throw Object.assign(new Error('This semester is closed and can no longer be edited.'), { status: 400 });

  const startDate = formatDate((payload && payload.startDate) || sem.startDate);
  const endDate = formatDate((payload && payload.endDate) || sem.endDate);
  const label = String((payload && payload.label) != null ? payload.label : sem.label).trim() || sem.label;
  validateDates(label, startDate, endDate);
  assertNoOverlap(existing, startDate, endDate, sem.key);
  assertUniqueLabel(existing, label, sem.key);

  const now = new Date().toISOString();
  await updateRange(
    SCHOOL_SEMESTERS_SHEET,
    `A${sem._row}:F${sem._row}`,
    [[sem.key, label, startDate, endDate, sem.closed ? 'Y' : 'N', now]]
  );
  invalidateSheetRowsCache(SCHOOL_SEMESTERS_SHEET);
  return (await listSchoolSemesters()).find((s) => s.key === sem.key);
}

async function setSemesterClosed(key, closed, session) {
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

  try {
    const { writeAuditFromSession } = require('./auditService');
    await writeAuditFromSession(
      session,
      closed ? 'semester_close' : 'semester_reopen',
      'semester',
      sem.key,
      { label: sem.label, startDate: sem.startDate, endDate: sem.endDate }
    );
  } catch (_) { /* optional */ }

  return (await listSchoolSemesters()).find((s) => s.key === sem.key);
}

async function closeSemester(key, session) {
  const sem = await setSemesterClosed(key, true, session);
  // Closing only freezes NEW edits (via the closed flag) — it's decoupled
  // from any report-card approval already mid-flight for this semester.
  // That's intentional (an in-flight submission should still be allowed to
  // finish), but flag it so the admin isn't surprised later.
  let inFlightReportCards = 0;
  try {
    const { listWorkflows, STATES } = require('./reportCardWorkflowService');
    const all = await listWorkflows({});
    inFlightReportCards = all.filter((w) =>
      String(w.term) === String(sem && sem.label) &&
      w.state !== STATES.draft &&
      w.state !== STATES.shared_parent
    ).length;
  } catch (e) { /* optional */ }
  return Object.assign({}, sem, {
    warnings: inFlightReportCards
      ? { inFlightReportCards }
      : null
  });
}

async function reopenSemester(key, session) {
  return setSemesterClosed(key, false, session);
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
  closeSemester,
  reopenSemester,
  asTerm,
  suggestLabel
};
