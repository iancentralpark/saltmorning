const { google } = require('googleapis');
const { getServiceAccountAuthOptions } = require('./googleCredentials');
const { cacheGet, cacheSet } = require('./cache');

const KR_HOLIDAY_CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';
const CACHE_SEC = 21600;

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

async function getHolidayName(dateStr) {
  if (!dateStr) return '';
  const cacheKey = 'kr_holiday_' + dateStr;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached === '__NONE__' ? '' : cached;

  try {
    const cal = await getCalendarApi();
    if (!cal) {
      cacheSet(cacheKey, '__NONE__', CACHE_SEC);
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
    cacheSet(cacheKey, name || '__NONE__', CACHE_SEC);
    return name;
  } catch (e) {
    cacheSet(cacheKey, '__NONE__', CACHE_SEC);
    return '';
  }
}

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
      cacheSet(cacheKey, map, CACHE_SEC);
      return map;
    }
    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const res = await cal.events.list({
      calendarId: KR_HOLIDAY_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      maxResults: 50
    });
    for (const ev of res.data.items || []) {
      const ds = (ev.start && ev.start.date) ? ev.start.date : '';
      if (ds) map[ds] = ev.summary || 'Holiday';
    }
  } catch (e) { /* ignore */ }
  cacheSet(cacheKey, map, CACHE_SEC);
  return map;
}

module.exports = { getHolidayName, getHolidaysForMonth };
