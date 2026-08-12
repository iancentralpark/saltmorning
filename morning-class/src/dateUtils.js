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

/** Local datetime string for sheet timestamps, e.g. 2026-08-12 13:45:00 */
function formatDateTimeNow(tz = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date());
  const get = (type) => {
    const hit = parts.find((p) => p.type === type);
    return hit ? hit.value : '';
  };
  return (
    get('year') + '-' + get('month') + '-' + get('day') +
    ' ' + get('hour') + ':' + get('minute') + ':' + get('second')
  );
}

module.exports = { formatDateInTz, formatSheetDate, todayStr, formatDateTimeNow };
