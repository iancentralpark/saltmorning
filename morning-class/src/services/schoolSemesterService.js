const { SCHOOL_SEMESTERS_SHEET } = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet } = require('../sheets');
const { todayStr } = require('../dateUtils');

const HEADERS = ['SemesterKey', 'Label', 'StartDate', 'EndDate', 'UpdatedAt'];

const DEFAULTS = [
  { key: 'sem1', label: 'Semester 1' },
  { key: 'sem2', label: 'Semester 2' }
];

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

async function ensureSchoolSemestersSheet() {
  await ensureSheet(SCHOOL_SEMESTERS_SHEET, HEADERS);
}

function parseRow(row, rowIndex) {
  return {
    key: String(row[0] || '').trim(),
    label: String(row[1] || '').trim(),
    startDate: formatDate(row[2]),
    endDate: formatDate(row[3]),
    updatedAt: String(row[4] || ''),
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
    semesterKey: sem.key
  };
}

async function listSchoolSemesters() {
  await ensureSchoolSemestersSheet();
  const rows = await getSheetRows(SCHOOL_SEMESTERS_SHEET);
  const byKey = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const sem = parseRow(rows[i], i + 1);
    byKey[sem.key] = sem;
  }

  return DEFAULTS.map((d) => {
    const existing = byKey[d.key];
    return {
      key: d.key,
      label: (existing && existing.label) || d.label,
      startDate: existing ? existing.startDate : '',
      endDate: existing ? existing.endDate : '',
      updatedAt: existing ? existing.updatedAt : '',
      _row: existing ? existing._row : null,
      configured: !!(existing && existing.startDate && existing.endDate)
    };
  });
}

async function getSchoolSemester(keyOrLabel) {
  const semesters = await listSchoolSemesters();
  const q = String(keyOrLabel || '').trim().toLowerCase();
  if (!q) return null;
  return semesters.find((s) =>
    s.key.toLowerCase() === q ||
    s.label.toLowerCase() === q ||
    (q === '1' && s.key === 'sem1') ||
    (q === '2' && s.key === 'sem2') ||
    (q === 'term1' && s.key === 'sem1') ||
    (q === 'term2' && s.key === 'sem2') ||
    (q === '1학기' && s.key === 'sem1') ||
    (q === '2학기' && s.key === 'sem2')
  ) || null;
}

function addYearsToDate(dateStr, years) {
  const s = String(dateStr || '').slice(0, 10);
  const n = Number(years) || 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !n) return s;
  const y = Number(s.slice(0, 4)) + n;
  const mm = s.slice(5, 7);
  const dd = s.slice(8, 10);
  if (mm === '02' && dd === '29') {
    const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    return y + '-02-' + (leap ? '29' : '28');
  }
  return y + '-' + mm + '-' + dd;
}

/** School-year span from configured Semester 1 + Semester 2 (min start → max end). */
async function academicYearFromSemesters(offsetYears) {
  const semesters = await listSchoolSemesters();
  const starts = [];
  const ends = [];
  (semesters || []).forEach((s) => {
    if (s.startDate && s.endDate) {
      starts.push(s.startDate);
      ends.push(s.endDate);
    }
  });
  if (!starts.length) return null;
  starts.sort();
  ends.sort();
  const o = Number(offsetYears) || 0;
  const startDate = addYearsToDate(starts[0], o);
  const endDate = addYearsToDate(ends[ends.length - 1], o);
  return {
    startDate,
    endDate,
    label: startDate.slice(0, 4) + '-' + endDate.slice(0, 4),
    fromSemesters: true
  };
}

async function getActiveSchoolSemester() {
  const semesters = await listSchoolSemesters();
  const configured = semesters.filter((s) => s.startDate && s.endDate);
  if (!configured.length) return null;
  const today = todayStr();
  const current = configured.find((s) => s.startDate <= today && today <= s.endDate);
  if (current) return current;
  const past = configured.filter((s) => s.startDate <= today);
  if (past.length) return past[past.length - 1];
  return configured[0];
}

/**
 * Grade/lesson compatibility: school-wide semesters exposed as "terms".
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

async function saveSchoolSemesters(payload) {
  await ensureSchoolSemestersSheet();
  const incoming = payload && payload.semesters ? payload.semesters : payload;
  const sem1 = incoming.sem1 || incoming.semester1 || (Array.isArray(incoming) ? incoming.find((s) => s.key === 'sem1') : null);
  const sem2 = incoming.sem2 || incoming.semester2 || (Array.isArray(incoming) ? incoming.find((s) => s.key === 'sem2') : null);

  const updates = [
    { key: 'sem1', label: 'Semester 1', startDate: formatDate(sem1 && sem1.startDate), endDate: formatDate(sem1 && sem1.endDate) },
    { key: 'sem2', label: 'Semester 2', startDate: formatDate(sem2 && sem2.startDate), endDate: formatDate(sem2 && sem2.endDate) }
  ];

  for (const u of updates) {
    if ((u.startDate && !u.endDate) || (!u.startDate && u.endDate)) {
      throw new Error(u.label + ': set both start and end dates.');
    }
    if (u.startDate && u.endDate && u.endDate < u.startDate) {
      throw new Error(u.label + ': end date must be on or after start date.');
    }
  }
  if (updates[0].startDate && updates[0].endDate && updates[1].startDate && updates[1].endDate) {
    if (updates[0].startDate <= updates[1].endDate && updates[1].startDate <= updates[0].endDate) {
      throw new Error('Semester 1 and Semester 2 date ranges must not overlap.');
    }
  }

  const existing = await listSchoolSemesters();
  const byKey = {};
  existing.forEach((s) => { byKey[s.key] = s; });
  const now = new Date().toISOString();
  const sheetRows = await getSheetRows(SCHOOL_SEMESTERS_SHEET, { skipCache: true });

  for (const u of updates) {
    const row = [u.key, u.label, u.startDate, u.endDate, now];
    const prev = byKey[u.key];
    if (prev && prev._row) {
      await updateRange(SCHOOL_SEMESTERS_SHEET, `A${prev._row}:E${prev._row}`, [row]);
    } else {
      // Prefer updating a blank-key row if any leftover
      let appended = false;
      for (let i = 1; i < sheetRows.length; i++) {
        if (String(sheetRows[i][0] || '').trim() === u.key) {
          await updateRange(SCHOOL_SEMESTERS_SHEET, `A${i + 1}:E${i + 1}`, [row]);
          appended = true;
          break;
        }
      }
      if (!appended) await appendRows(SCHOOL_SEMESTERS_SHEET, [row]);
    }
  }

  return { semesters: await listSchoolSemesters() };
}

module.exports = {
  ensureSchoolSemestersSheet,
  listSchoolSemesters,
  academicYearFromSemesters,
  addYearsToDate,
  getSchoolSemester,
  getActiveSchoolSemester,
  listTermsForClass,
  getActiveTermForClass,
  getTermForClass,
  saveSchoolSemesters,
  asTerm
};
