const { TIMEZONE } = require('./config');

function formatDateInTz(value, tz = TIMEZONE) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      const p = s.split('/');
      return p[0] + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function formatSheetDate(val, tz = TIMEZONE) {
  return formatDateInTz(val, tz);
}

function formatDateStr(value, tz = TIMEZONE) {
  return formatSheetDate(value, tz);
}

function parseHomeworkDate(val) {
  if (!val) return '';
  return formatSheetDate(val).slice(0, 10);
}

function chambitParseDate(dateStr) {
  const p = String(dateStr).split('-');
  return { y: Number(p[0]), m: Number(p[1]) - 1, d: Number(p[2]) };
}

function chambitFormatDate(dt, tz = TIMEZONE) {
  return formatDateInTz(dt, tz);
}

function chambitAddDays(dateStr, days) {
  const p = chambitParseDate(dateStr);
  const dt = new Date(p.y, p.m, p.d);
  dt.setDate(dt.getDate() + days);
  return chambitFormatDate(dt);
}

function chambitWeekMonday(dateStr) {
  const p = chambitParseDate(dateStr);
  const dt = new Date(p.y, p.m, p.d);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return chambitFormatDate(dt);
}

function chambitWeekSunday(weekMonday) {
  return chambitAddDays(weekMonday, 6);
}

function calcWeekNumber(startDateStr, refDateStr) {
  if (!startDateStr || !refDateStr) return null;
  const start = new Date(startDateStr + 'T12:00:00');
  const ref = new Date(refDateStr + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(ref.getTime())) return null;
  if (ref < start) return 0;
  const diffDays = Math.floor((ref - start) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

function calcExpectedFinishDate(startDateStr, refDateStr, currentPos, totalUnits, tz = TIMEZONE) {
  if (!startDateStr || !refDateStr) return null;
  const total = Number(totalUnits) || 0;
  const current = Number(currentPos) || 0;
  if (total <= 0) return null;
  if (current >= total) return refDateStr;
  if (current <= 0) return null;
  const weekNum = calcWeekNumber(startDateStr, refDateStr);
  if (!weekNum || weekNum <= 0) return null;
  const unitsPerWeek = current / weekNum;
  if (unitsPerWeek <= 0) return null;
  const weeksLeft = (total - current) / unitsPerWeek;
  const daysLeft = Math.ceil(weeksLeft * 7);
  const ref = new Date(refDateStr + 'T12:00:00');
  ref.setDate(ref.getDate() + daysLeft);
  return formatDateInTz(ref, tz);
}

function formatDateTimeNow(tz = TIMEZONE) {
  const d = new Date();
  return d.toLocaleString('sv-SE', { timeZone: tz }).replace('T', ' ').slice(0, 19);
}

module.exports = {
  formatDateInTz,
  formatSheetDate,
  formatDateStr,
  formatDateTimeNow,
  parseHomeworkDate,
  chambitParseDate,
  chambitAddDays,
  chambitWeekMonday,
  chambitWeekSunday,
  calcWeekNumber,
  calcExpectedFinishDate
};
