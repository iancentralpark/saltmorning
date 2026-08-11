const {
  CURRICULUM_MAP_URL,
  CURRICULUM_MAP_API_KEY,
  CURRICULUM_MAP_ORG_CODE
} = require('../config');

async function curriculumMapFetch(pathWithQuery, options = {}) {
  const base = String(CURRICULUM_MAP_URL || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CURRICULUM_MAP_URL is not configured.');
    err.status = 503;
    throw err;
  }
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };
  if (CURRICULUM_MAP_API_KEY) {
    headers['x-api-key'] = CURRICULUM_MAP_API_KEY;
  }
  if (CURRICULUM_MAP_ORG_CODE) {
    headers['x-organization-code'] = CURRICULUM_MAP_ORG_CODE;
  }
  const res = await fetch(base + pathWithQuery, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(body.error || `CurricuMap error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

function deepLink(path, query) {
  const base = String(CURRICULUM_MAP_URL || '').replace(/\/$/, '');
  const usp = new URLSearchParams(query || {});
  return `${base}${path}?${usp.toString()}`;
}

async function collectHolidays(year, months) {
  const { getHolidaysForMonth } = require('../holiday');
  const holidays = {};
  for (const month of months) {
    Object.assign(holidays, await getHolidaysForMonth(year, month));
  }
  return holidays;
}

async function pushHolidayOverlay({
  year,
  months,
  blackouts = [],
  resequence = true,
  organizationCode
}) {
  const holidays = await collectHolidays(year, months);
  const result = await pushCalendarOverlay({
    holidays,
    blackouts,
    resequence,
    organizationCode: organizationCode || CURRICULUM_MAP_ORG_CODE || 'salt-morning'
  });
  return {
    holidays: Object.keys(holidays).length,
    holidayDates: Object.keys(holidays).sort(),
    ...result
  };
}

async function pushCalendarOverlay(payload) {
  return curriculumMapFetch('/api/portal/v1/calendar/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

module.exports = {
  curriculumMapFetch,
  deepLink,
  collectHolidays,
  pushHolidayOverlay,
  getCurriculumMapPublicConfig() {
    return {
      enabled: Boolean(CURRICULUM_MAP_URL),
      baseUrl: CURRICULUM_MAP_URL || null,
      organizationCode: CURRICULUM_MAP_ORG_CODE || null
    };
  },
  pushCalendarOverlay
};
