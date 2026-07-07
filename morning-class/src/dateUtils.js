const { TIMEZONE } = require('./config');

function formatDateInTz(value, tz = TIMEZONE) {
  if (value == null || value === '') return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function formatSheetDate(val, tz = TIMEZONE) {
  return formatDateInTz(val, tz);
}

function todayStr(tz = TIMEZONE) {
  return formatDateInTz(new Date(), tz);
}

module.exports = { formatDateInTz, formatSheetDate, todayStr };
