const { HOMEWORK_SHEETS } = require('./config');
const { getSheetRows } = require('./sheets');
const { parseHomeworkDate } = require('./dateUtils');
const { readClassEvents } = require('./sidebarService');
const { getHolidaysForMonth } = require('./holiday');

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function dateStrFor(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

async function readHomeworkForClass(classId) {
  const data = await getSheetRows(HOMEWORK_SHEETS.LOG);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== classId) continue;
    rows.push({
      homeworkId: String(data[i][0]),
      assignedDate: parseHomeworkDate(data[i][2]),
      title: String(data[i][3] || ''),
      description: String(data[i][4] || '')
    });
  }
  return rows;
}

async function getClassCalendarData(classId, year, month, allowedDays) {
  year = Number(year);
  month = Number(month);
  if (!classId) throw new Error('classId is required.');
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('year and month (1–12) are required.');
  }

  const allowed = (allowedDays || []).map(Number).filter(n => !isNaN(n));
  const holidays = await getHolidaysForMonth(year, month);
  const events = await readClassEvents(classId);
  const homework = await readHomeworkForClass(classId);

  const numDays = daysInMonth(year, month);
  const days = {};

  for (let d = 1; d <= numDays; d++) {
    const dateStr = dateStrFor(year, month, d);
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const holiday = holidays[dateStr] || '';
    let offReason = null;
    if (holiday) offReason = 'holiday';
    else if (allowed.length && !allowed.includes(dow)) offReason = 'schedule';

    days[dateStr] = {
      holiday,
      offDay: !!offReason,
      offReason,
      events: events
        .filter(e => e.eventDate === dateStr)
        .map(e => ({ eventId: e.eventId, description: e.description })),
      homework: homework
        .filter(h => h.assignedDate === dateStr)
        .map(h => ({
          homeworkId: h.homeworkId,
          title: h.title,
          description: h.description
        }))
    };
  }

  return { year, month, classId, allowedDays: allowed, days };
}

module.exports = { getClassCalendarData };
