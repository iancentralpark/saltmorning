const {
  SCHOOL_CALENDAR_SHEET,
  CLASS_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { formatSheetDate, todayStr } = require('../dateUtils');
const { getHolidayName, getHolidaysForMonth, getHolidaysForRange } = require('../holiday');
const { academicYearFromSemesters } = require('./schoolSemesterService');

const DAY_TYPES = ['holiday', 'break', 'event', 'school_day'];
const HEADERS = [
  'EntryID', 'Date', 'EndDate', 'DayType', 'Title',
  'BlocksAttendance', 'Source', 'ClassID', 'Notes', 'Active', 'UpdatedAt'
];

function normalizeAllowedDays(raw) {
  return String(raw || '1,2,3,4,5')
    .split(',')
    .map((n) => Number(n))
    .filter((n) => !isNaN(n));
}

function parseBool(val, fallback = false) {
  if (val == null || val === '') return fallback;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return fallback;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function lastDayOfFeb(year) {
  return new Date(year, 2, 0).getDate();
}

function defaultAcademicYearRange(refDate) {
  const today = String(refDate || todayStr()).slice(0, 10);
  const d = new Date(today + 'T12:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 3) {
    return {
      startDate: y + '-03-01',
      endDate: (y + 1) + '-02-' + pad2(lastDayOfFeb(y + 1)),
      label: y + '-' + (y + 1)
    };
  }
  return {
    startDate: (y - 1) + '-03-01',
    endDate: y + '-02-' + pad2(lastDayOfFeb(y)),
    label: (y - 1) + '-' + y
  };
}

function parseEntry(row, rowIndex) {
  const start = formatSheetDate(row[1]);
  const end = formatSheetDate(row[2]) || start;
  const dayType = String(row[3] || '').trim().toLowerCase();
  return {
    entryId: String(row[0] || ''),
    date: start,
    endDate: end,
    dayType,
    title: String(row[4] || '').trim(),
    blocksAttendance: parseBool(row[5], dayType !== 'event' && dayType !== 'school_day'),
    source: String(row[6] || 'admin').trim() || 'admin',
    classId: String(row[7] || '*').trim() || '*',
    notes: String(row[8] || '').trim(),
    active: parseBool(row[9], true),
    updatedAt: String(row[10] || ''),
    _row: rowIndex
  };
}

async function ensureSchoolCalendarSheet() {
  await ensureSheet(SCHOOL_CALENDAR_SHEET, HEADERS);
}

async function listEntries({ from, to, classId, includeInactive } = {}) {
  await ensureSchoolCalendarSheet();
  const rows = await getSheetRows(SCHOOL_CALENDAR_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0] && !rows[i][1]) continue;
    const entry = parseEntry(rows[i], i + 1);
    if (!entry.date || !DAY_TYPES.includes(entry.dayType)) continue;
    if (!includeInactive && !entry.active) continue;
    if (classId && entry.classId !== '*' && entry.classId !== String(classId)) continue;
    if (from && entry.endDate < from) continue;
    if (to && entry.date > to) continue;
    out.push(entry);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId));
  return out;
}

function entriesCoveringDate(entries, dateStr, classId) {
  return entries.filter((e) => {
    if (!e.active) return false;
    if (e.classId !== '*' && e.classId !== String(classId)) return false;
    return e.date <= dateStr && dateStr <= e.endDate;
  });
}

async function getClassMeta(classId) {
  let allowedDays = [1, 2, 3, 4, 5];
  let className = classId;
  const classRows = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < classRows.length; i++) {
    if (String(classRows[i][0]) === String(classId)) {
      allowedDays = normalizeAllowedDays(classRows[i][3]);
      className = String(classRows[i][1] || classId);
      break;
    }
  }
  return { allowedDays, className };
}

/**
 * Resolve whether a date is a class day for a class.
 * Priority:
 *  1. Admin school_day → force ON
 *  2. Admin holiday / break → force OFF
 *  3. Admin event with BlocksAttendance → force OFF
 *  4. KR public holiday → OFF
 *  5. AllowedDays weekday check
 */
async function resolveDay(classId, dateStr, opts = {}) {
  dateStr = String(dateStr || '').slice(0, 10);
  classId = String(classId || '');
  const { allowedDays, className } = opts.classMeta || await getClassMeta(classId);
  const dow = new Date(dateStr + 'T12:00:00').getDay();

  let entries = opts.entries;
  if (!entries) {
    entries = await listEntries({ from: dateStr, to: dateStr, classId, includeInactive: false });
  }
  const covering = entriesCoveringDate(entries, dateStr, classId);

  const schoolDay = covering.find((e) => e.dayType === 'school_day');
  const holidayOrBreak = covering.find((e) => e.dayType === 'holiday' || e.dayType === 'break');
  const blockingEvent = covering.find((e) => e.dayType === 'event' && e.blocksAttendance);
  const events = covering.filter((e) => e.dayType === 'event');

  const krHoliday = opts.krHolidayMap
    ? (opts.krHolidayMap[dateStr] || '')
    : await getHolidayName(dateStr);

  let isClassDay = false;
  let reason = '';
  let dayType = 'weekday';
  let title = '';
  let blocksAttendance = false;

  if (schoolDay) {
    isClassDay = true;
    reason = 'admin_school_day';
    dayType = 'school_day';
    title = schoolDay.title || 'School day (admin)';
    blocksAttendance = false;
  } else if (holidayOrBreak) {
    isClassDay = false;
    reason = 'admin_' + holidayOrBreak.dayType;
    dayType = holidayOrBreak.dayType;
    title = holidayOrBreak.title || (holidayOrBreak.dayType === 'break' ? 'School break' : 'School holiday');
    blocksAttendance = true;
  } else if (blockingEvent) {
    isClassDay = false;
    reason = 'admin_event';
    dayType = 'event';
    title = blockingEvent.title || 'School event';
    blocksAttendance = true;
  } else if (krHoliday) {
    isClassDay = false;
    reason = 'kr_public_holiday';
    dayType = 'kr_holiday';
    title = krHoliday;
    blocksAttendance = true;
  } else if (allowedDays.includes(dow)) {
    isClassDay = true;
    reason = 'scheduled_weekday';
    dayType = 'class_day';
    title = '';
    blocksAttendance = false;
  } else {
    isClassDay = false;
    reason = 'not_allowed_weekday';
    dayType = 'off';
    title = '';
    blocksAttendance = true;
  }

  return {
    date: dateStr,
    classId,
    className,
    dayOfWeek: dow,
    allowedDays,
    isClassDay,
    blocksAttendance: !isClassDay,
    reason,
    dayType,
    title,
    krHoliday: krHoliday || '',
    events: events.map((e) => ({
      entryId: e.entryId,
      title: e.title,
      blocksAttendance: e.blocksAttendance,
      notes: e.notes
    })),
    adminEntries: covering.map((e) => ({
      entryId: e.entryId,
      dayType: e.dayType,
      title: e.title,
      blocksAttendance: e.blocksAttendance
    }))
  };
}

async function getMonthCalendar(classId, year, month) {
  year = Number(year);
  month = Number(month);
  const from = year + '-' + pad2(month) + '-01';
  const last = new Date(year, month, 0).getDate();
  const to = year + '-' + pad2(month) + '-' + pad2(last);
  const classMeta = await getClassMeta(classId || '*');
  const [entries, krHolidayMap] = await Promise.all([
    listEntries({ from, to, classId: classId || undefined, includeInactive: false }),
    getHolidaysForMonth(year, month)
  ]);

  const days = [];
  for (let d = 1; d <= last; d++) {
    const dateStr = year + '-' + pad2(month) + '-' + pad2(d);
    const resolved = await resolveDay(classId || '*', dateStr, {
      classMeta: classId ? classMeta : { allowedDays: [1, 2, 3, 4, 5], className: 'All' },
      entries,
      krHolidayMap
    });
    days.push(resolved);
  }
  return {
    year,
    month,
    from,
    to,
    classId: classId || '*',
    className: classMeta.className,
    days,
    entries
  };
}

async function getYearCalendar(classId, startDate, endDate) {
  let range;
  if (startDate && endDate) {
    range = { startDate, endDate, label: startDate.slice(0, 4) + '-' + endDate.slice(0, 4) };
  } else {
    range = (await academicYearFromSemesters()) || defaultAcademicYearRange();
  }
  const from = range.startDate;
  const to = range.endDate;
  const classMeta = await getClassMeta(classId || '*');
  const [entries, krHolidayMap] = await Promise.all([
    listEntries({ from, to, classId: classId || undefined, includeInactive: false }),
    getHolidaysForRange(from, to)
  ]);

  const months = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const monthFrom = y + '-' + pad2(m) + '-01';
    const last = new Date(y, m, 0).getDate();
    const monthTo = y + '-' + pad2(m) + '-' + pad2(last);
    const days = [];
    for (let d = 1; d <= last; d++) {
      const dateStr = y + '-' + pad2(m) + '-' + pad2(d);
      if (dateStr < from || dateStr > to) {
        days.push({
          date: dateStr,
          outOfRange: true,
          isClassDay: false,
          dayType: 'out',
          title: '',
          events: []
        });
        continue;
      }
      days.push(await resolveDay(classId || '*', dateStr, {
        classMeta: classId ? classMeta : { allowedDays: [1, 2, 3, 4, 5], className: 'All' },
        entries,
        krHolidayMap
      }));
    }
    months.push({ year: y, month: m, from: monthFrom, to: monthTo, days });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  let schoolDayCount = 0;
  months.forEach((mo) => {
    mo.days.forEach((d) => {
      if (!d.outOfRange && d.isClassDay) schoolDayCount += 1;
    });
  });

  return {
    startDate: from,
    endDate: to,
    label: range.label,
    classId: classId || '*',
    className: classMeta.className,
    schoolDayCount,
    months,
    entries,
    krHolidays: krHolidayMap
  };
}

function newEntryId() {
  return 'SC' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function upsertEntry(payload) {
  await ensureSchoolCalendarSheet();
  const date = formatSheetDate(payload.date || payload.startDate);
  const endDate = formatSheetDate(payload.endDate || date) || date;
  const dayType = String(payload.dayType || '').trim().toLowerCase();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Valid date is required.');
  if (endDate < date) throw new Error('End date must be on or after start date.');
  if (!DAY_TYPES.includes(dayType)) {
    throw new Error('Day type must be holiday, break, event, or school_day.');
  }
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Title is required.');
  const blocksDefault = dayType === 'holiday' || dayType === 'break';
  const blocksAttendance = payload.blocksAttendance == null
    ? blocksDefault
    : parseBool(payload.blocksAttendance, blocksDefault);
  const classId = String(payload.classId || '*').trim() || '*';
  const notes = String(payload.notes || '').trim();
  const active = payload.active == null ? true : parseBool(payload.active, true);
  const source = String(payload.source || 'admin').trim() || 'admin';
  const updatedAt = new Date().toISOString();
  const entryId = String(payload.entryId || '').trim() || newEntryId();

  const data = await getSheetRows(SCHOOL_CALENDAR_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === entryId) {
      found = i + 1;
      break;
    }
  }
  const row = [
    entryId, date, endDate, dayType, title,
    blocksAttendance ? 'true' : 'false', source, classId, notes,
    active ? 'true' : 'false', updatedAt
  ];
  if (found !== -1) {
    await updateRange(SCHOOL_CALENDAR_SHEET, `A${found}:K${found}`, [row]);
  } else {
    await appendRows(SCHOOL_CALENDAR_SHEET, [row]);
  }
  invalidateSheetRowsCache(SCHOOL_CALENDAR_SHEET);
  return parseEntry(row, found !== -1 ? found : null);
}

async function deleteEntry(entryId) {
  await ensureSchoolCalendarSheet();
  entryId = String(entryId || '').trim();
  if (!entryId) throw new Error('entryId is required.');
  const data = await getSheetRows(SCHOOL_CALENDAR_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === entryId) {
      await updateRange(SCHOOL_CALENDAR_SHEET, `J${i + 1}`, [['false']]);
      invalidateSheetRowsCache(SCHOOL_CALENDAR_SHEET);
      return { deleted: true, entryId };
    }
  }
  throw new Error('Calendar entry not found.');
}

module.exports = {
  DAY_TYPES,
  defaultAcademicYearRange,
  ensureSchoolCalendarSheet,
  listEntries,
  resolveDay,
  getMonthCalendar,
  getYearCalendar,
  upsertEntry,
  deleteEntry,
  getClassMeta
};
