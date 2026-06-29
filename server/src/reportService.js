const {
  ATTENDANCE_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('./config');
const { getSheetRows } = require('./sheets');
const { formatSheetDate } = require('./dateUtils');
const { getHolidaysForMonth } = require('./holiday');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeAllowedDays(raw) {
  if (!raw && raw !== 0) return [1, 2, 3, 4, 5];
  if (Array.isArray(raw)) {
    const out = raw.map(Number).filter(n => !isNaN(n));
    return out.length ? out : [1, 2, 3, 4, 5];
  }
  const out = String(raw).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  return out.length ? out : [1, 2, 3, 4, 5];
}

function dateStrFor(year, month, day) {
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function buildScheduledDates(year, month, allowedDays, holidays) {
  const allowed = normalizeAllowedDays(allowedDays);
  const numDays = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= numDays; d++) {
    const dateStr = dateStrFor(year, month, d);
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
    const status = studentData[i][3];
    if (!sid || status !== 'Enrolled') continue;
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
    recordMap[cid][rDate][sid] = {
      attendance: attendData[i][3],
      vocabScore: attendData[i][4]
    };
  }

  const report = classList.map(cls => {
    const dates = buildScheduledDates(y, m, cls.allowedDays, holidays);
    const students = (studentsByClass[cls.id] || []).map(std => ({
      id: std.id,
      name: std.name,
      cells: dates.map(d => {
        if (d.holiday) {
          return { attendance: null, vocabScore: null, holiday: d.holiday };
        }
        const rec = recordMap[cls.id] && recordMap[cls.id][d.dateStr] && recordMap[cls.id][d.dateStr][std.id];
        if (rec && rec.attendance) {
          return {
            attendance: rec.attendance,
            vocabScore: rec.vocabScore,
            holiday: ''
          };
        }
        return { attendance: null, vocabScore: null, holiday: '' };
      })
    }));
    return {
      id: cls.id,
      name: cls.name,
      allowedDays: cls.allowedDays,
      dates,
      students
    };
  });

  return { year: y, month: m, monthLabel: monthPrefix, classes: report };
}

module.exports = { getMonthlyReport };
