const { google } = require('googleapis');
const { KR_HOLIDAY_CALENDAR_ID, CACHE_SEC } = require('./config');
const { cacheGet, cacheSet } = require('./cache');
const { getServiceAccountAuthOptions } = require('./googleCredentials');

let calendarApi = null;

async function getCalendarApi() {
  if (calendarApi) return calendarApi;
  try {
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/calendar.readonly']);
    if (!authOpts) return null;
    const auth = new google.auth.GoogleAuth(authOpts);
    calendarApi = google.calendar({ version: 'v3', auth });
    return calendarApi;
  } catch (e) {
    return null;
  }
}

/** Returns Korean public holiday name or empty string. */
async function getHolidayName(dateStr) {
  if (!dateStr) return '';

  const cacheKey = 'kr_holiday_' + dateStr;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached === '__NONE__' ? '' : cached;

  try {
    const cal = await getCalendarApi();
    if (!cal) {
      cacheSet(cacheKey, '__NONE__', CACHE_SEC.HOLIDAY);
      return '';
    }

    const parts = dateStr.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));

    const res = await cal.events.list({
      calendarId: KR_HOLIDAY_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults: 3,
      singleEvents: true
    });

    const name = (res.data.items && res.data.items[0]) ? res.data.items[0].summary : '';
    cacheSet(cacheKey, name || '__NONE__', CACHE_SEC.HOLIDAY);
    return name;
  } catch (e) {
    cacheSet(cacheKey, '__NONE__', CACHE_SEC.HOLIDAY);
    return '';
  }
}

/** Returns { "yyyy-MM-dd": holidayName } for all holidays in the given month (month 1–12). */
async function getHolidaysForMonth(year, month) {
  year = Number(year);
  month = Number(month);
  if (!year || !month || month < 1 || month > 12) return {};

  const cacheKey = 'kr_holidays_' + year + '_' + month;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const map = {};
  try {
    const cal = await getCalendarApi();
    if (!cal) {
      cacheSet(cacheKey, map, CACHE_SEC.HOLIDAY);
      return map;
    }

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));

    const res = await cal.events.list({
      calendarId: KR_HOLIDAY_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults: 50,
      singleEvents: true
    });

    for (const item of res.data.items || []) {
      const ds = item.start && item.start.date;
      if (ds && !map[ds]) map[ds] = item.summary || '';
    }
  } catch (e) {
    /* ignore */
  }

  cacheSet(cacheKey, map, CACHE_SEC.HOLIDAY);
  return map;
}

module.exports = { getHolidayName, getHolidaysForMonth };
