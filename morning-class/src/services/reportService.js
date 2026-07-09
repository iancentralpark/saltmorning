const {
  ATTENDANCE_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows } = require('../sheets');
const { formatSheetDate } = require('../dateUtils');
const { getHolidaysForMonth } = require('../holiday');
const { countsAsPresent, parseAttendanceRow } = require('./attendanceService');
const { getPlannedForClassMonth } = require('./plannedAttendanceService');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ATT_MAP = {
  '출석': { label: 'O', cls: 'att-present' },
  '지각': { label: '△', cls: 'att-tardy' },
  '결석': { label: 'X', cls: 'att-absent' }
};

function normalizeAllowedDays(raw) {
  if (!raw && raw !== 0) return [1, 2, 3, 4, 5];
  const out = String(raw).split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
  return out.length ? out : [1, 2, 3, 4, 5];
}

function buildScheduledDates(year, month, allowedDays, holidays) {
  const allowed = normalizeAllowedDays(allowedDays);
  const numDays = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= numDays; d++) {
    const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    if (!allowed.includes(dow)) continue;
    dates.push({
      dateStr,
      dayLabel: DAY_LABELS[dow],
      holiday: holidays[dateStr] || ''
    });
  }
  return dates;
}

async function getMonthlyReport(classId, year, month) {
  const y = Number(year);
  const m = Number(month);
  const monthPrefix = y + '-' + String(m).padStart(2, '0');
  const holidays = await getHolidaysForMonth(y, m);

  const classData = await getSheetRows(CLASS_LIST_SHEET);
  const classList = [];
  for (let i = 1; i < classData.length; i++) {
    const cid = classData[i][0];
    if (!cid) continue;
    if (classId !== 'ALL' && cid !== classId) continue;
    classList.push({
      id: cid,
      name: classData[i][1],
      allowedDays: normalizeAllowedDays(classData[i][3])
    });
  }

  const studentData = await getSheetRows(STUDENT_LIST_SHEET);
  const studentsByClass = {};
  for (let i = 1; i < studentData.length; i++) {
    const sid = studentData[i][0];
    const cid = studentData[i][2];
    if (!sid || studentData[i][3] !== 'Enrolled') continue;
    if (!studentsByClass[cid]) studentsByClass[cid] = [];
    studentsByClass[cid].push({ id: sid, name: studentData[i][1] });
  }

  const attendData = await getSheetRows(ATTENDANCE_SHEET);
  const recordMap = {};
  for (let i = 1; i < attendData.length; i++) {
    const rDate = formatSheetDate(attendData[i][0]);
    if (rDate.slice(0, 7) !== monthPrefix) continue;
    const cid = attendData[i][1];
    const sid = attendData[i][2];
    if (!recordMap[cid]) recordMap[cid] = {};
    if (!recordMap[cid][rDate]) recordMap[cid][rDate] = {};
    recordMap[cid][rDate][sid] = parseAttendanceRow(attendData[i]);
  }

  const plannedByClass = {};
  for (const cls of classList) {
    plannedByClass[cls.id] = await getPlannedForClassMonth(cls.id, y, m);
  }

  const report = [];
  for (const cls of classList) {
    const dates = buildScheduledDates(y, m, cls.allowedDays, holidays);
    const students = (studentsByClass[cls.id] || []).map((std) => {
      let present = 0;
      let tardy = 0;
      let absent = 0;
      let excusedCount = 0;

      const cells = dates.map((d) => {
        if (d.holiday) {
          return { attendance: null, holiday: d.holiday, excused: false, planned: false };
        }
        let rec = recordMap[cls.id] && recordMap[cls.id][d.dateStr] && recordMap[cls.id][d.dateStr][std.id];
        let planned = false;
        if ((!rec || !rec.attendance) && plannedByClass[cls.id] && plannedByClass[cls.id][d.dateStr]) {
          const p = plannedByClass[cls.id][d.dateStr][std.id];
          if (p) {
            rec = { attendance: p.type, excuse: '', note: p.note || '' };
            planned = true;
          }
        }
        if (!rec || !rec.attendance) {
          return { attendance: null, holiday: '', excused: false, planned: false };
        }
        const isExcused = !!(rec.excuse && (rec.attendance === '지각' || rec.attendance === '결석'));
        if (countsAsPresent(rec.attendance, rec.excuse)) present++;
        else if (rec.attendance === '지각') tardy++;
        else if (rec.attendance === '결석') absent++;
        if (isExcused) excusedCount++;
        return {
          attendance: rec.attendance,
          holiday: '',
          excuse: rec.excuse,
          excused: isExcused,
          planned
        };
      });

      return {
        id: std.id,
        name: std.name,
        summary: {
          present,
          tardy,
          absent,
          excused: excusedCount
        },
        cells
      };
    });

    report.push({ id: cls.id, name: cls.name, allowedDays: cls.allowedDays, dates, students });
  }

  return { year: y, month: m, monthLabel: monthPrefix, classes: report, attMap: ATT_MAP };
}

module.exports = { getMonthlyReport, ATT_MAP };
