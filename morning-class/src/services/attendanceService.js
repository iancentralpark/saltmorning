const { formatSheetDate, todayStr } = require('../dateUtils');
const {
  ATTENDANCE_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, updateRange, appendRows } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');
const { getPlannedByClassAndDate } = require('./plannedAttendanceService');
const {
  resolveDay,
  defaultAcademicYearRange,
  listEntries,
  getClassMeta
} = require('./schoolCalendarService');
const { getHolidaysForRange } = require('../holiday');

const VALID_STATUS = ['출석', '지각', '결석', '조퇴'];

function normalizeNote(val) {
  return String(val == null ? '' : val).trim();
}

function countsAsPresent(attendance, excuse) {
  if (attendance === '출석') return true;
  if ((attendance === '지각' || attendance === '결석' || attendance === '조퇴') &&
      String(excuse || '').trim()) {
    return true;
  }
  return false;
}

function parseAttendanceRow(row) {
  return {
    attendance: String(row[3] || ''),
    note: normalizeNote(row[4]),
    excuse: String(row[5] || '').trim()
  };
}

async function ensureAttendanceColumns() {
  const data = await getSheetRows(ATTENDANCE_SHEET);
  if (!data.length) {
    await appendRows(ATTENDANCE_SHEET, [['Date', 'ClassID', 'StudentID', 'Attendance', 'Note', 'Excuse']]);
    return;
  }
  const header = (data[0] || []).map((c) => String(c || '').trim());
  if (header[0] !== 'Date') return;
  if (header[4] === 'VocabScore') {
    await updateRange(ATTENDANCE_SHEET, 'E1', [['Note']]);
  } else if (!header[4]) {
    await updateRange(ATTENDANCE_SHEET, 'E1', [['Note']]);
  }
  if (header[5] !== 'Excuse') {
    await updateRange(ATTENDANCE_SHEET, 'F1', [['Excuse']]);
  }
}

function normalizeAllowedDays(raw) {
  return String(raw || '1,2,3,4,5')
    .split(',')
    .map((n) => Number(n))
    .filter((n) => !isNaN(n));
}

async function getClassScheduleInfo(classId, dateStr) {
  const day = await resolveDay(classId, dateStr);
  const holidayName = day.krHoliday ||
    ((day.dayType === 'holiday' || day.dayType === 'break' || day.dayType === 'kr_holiday')
      ? day.title
      : '');
  return {
    holidayName,
    allowedDays: day.allowedDays,
    scheduledDay: day.isClassDay,
    className: day.className,
    dayOfWeek: day.dayOfWeek,
    dayType: day.dayType,
    dayTitle: day.title,
    events: day.events || [],
    reason: day.reason,
    blocksAttendance: !day.isClassDay
  };
}

async function getClassWorkData(classId, dateStr) {
  await ensureAttendanceColumns();
  classId = String(classId);
  dateStr = dateStr || todayStr();

  const schedule = await getClassScheduleInfo(classId, dateStr);
  const roster = await getClassRoster(classId);
  const rows = await getSheetRows(ATTENDANCE_SHEET);
  const existing = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== classId) continue;
    if (formatSheetDate(rows[i][0]) !== dateStr) continue;
    existing[String(rows[i][2])] = parseAttendanceRow(rows[i]);
  }

  const plannedMap = schedule.scheduledDay
    ? await getPlannedByClassAndDate(classId, dateStr)
    : {};

  const students = roster.map((s) => {
    const rec = existing[s.studentId] || {};
    const planned = plannedMap[s.studentId];
    let attendance = rec.attendance || (schedule.scheduledDay ? '출석' : '');
    let excuse = rec.excuse || '';
    if (!rec.attendance && planned) {
      attendance = planned.type;
    }
    return {
      studentId: s.studentId,
      name: s.name,
      attendance,
      excuse,
      plannedNotice: planned || null,
      countsAsPresent: attendance ? countsAsPresent(attendance, excuse) : false,
      attendanceEditable: !!schedule.scheduledDay
    };
  });

  return {
    date: dateStr,
    classId,
    ...schedule,
    students
  };
}

async function upsertStudentRecord(classId, studentId, dateStr, attendance, note, excuse) {
  await ensureAttendanceColumns();
  classId = String(classId);
  studentId = String(studentId);
  dateStr = String(dateStr);
  attendance = String(attendance || '').trim();
  note = normalizeNote(note);
  excuse = String(excuse || '').trim();

  if (!VALID_STATUS.includes(attendance)) {
    throw new Error('Invalid attendance status.');
  }

  const schedule = await getClassScheduleInfo(classId, dateStr);
  if (!schedule.scheduledDay) {
    const label = schedule.dayTitle || schedule.holidayName || 'This day';
    throw new Error(label + ' — no class. Attendance cannot be recorded (unless Admin marks it as a school day).');
  }

  const data = await getSheetRows(ATTENDANCE_SHEET);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (formatSheetDate(data[i][0]) !== dateStr) continue;
    if (String(data[i][1]) !== classId) continue;
    if (String(data[i][2]) !== studentId) continue;
    foundRow = i + 1;
    break;
  }

  const values = [[attendance, note, excuse]];
  if (foundRow !== -1) {
    await updateRange(ATTENDANCE_SHEET, `D${foundRow}:F${foundRow}`, values);
  } else {
    await appendRows(ATTENDANCE_SHEET, [[dateStr, classId, studentId, attendance, note, excuse]]);
  }

  return {
    saved: true,
    studentId,
    attendance,
    note,
    excuse,
    countsAsPresent: countsAsPresent(attendance, excuse)
  };
}

/** @deprecated batch — kept for compatibility */
async function getAttendanceForDate(classId, dateStr) {
  const work = await getClassWorkData(classId, dateStr);
  return {
    date: work.date,
    classId: work.classId,
    options: VALID_STATUS,
    students: (work.students || []).map((s) => ({
      studentId: s.studentId,
      name: s.name,
      attendance: s.attendance,
      excuse: s.excuse
    }))
  };
}

async function saveAttendance(classId, dateStr, records) {
  for (const rec of records) {
    await upsertStudentRecord(
      classId,
      rec.studentId,
      dateStr,
      rec.attendance,
      rec.note,
      rec.excuse
    );
  }
  return { saved: records.length };
}

function categorizeAttendance(attendance, excuse) {
  const excused = !!(excuse && String(excuse).trim());
  if (attendance === '출석') return 'present';
  if (attendance === '지각') return excused ? 'tardyExcused' : 'tardy';
  if (attendance === '결석') return excused ? 'absentExcused' : 'absent';
  if (attendance === '조퇴') return excused ? 'earlyLeaveExcused' : 'earlyLeave';
  return null;
}

async function getStudentYearAttendance(classId, studentId, startDate, endDate) {
  await ensureAttendanceColumns();
  classId = String(classId);
  studentId = String(studentId);
  const range = (startDate && endDate)
    ? {
      startDate: String(startDate).slice(0, 10),
      endDate: String(endDate).slice(0, 10),
      label: String(startDate).slice(0, 4) + '-' + String(endDate).slice(0, 4)
    }
    : defaultAcademicYearRange();

  const from = range.startDate;
  const to = range.endDate;
  const classMeta = await getClassMeta(classId);

  let studentName = studentId;
  const roster = await getClassRoster(classId);
  const found = roster.find((s) => String(s.studentId) === studentId);
  if (found) studentName = found.name;
  else {
    const list = await getSheetRows(STUDENT_LIST_SHEET);
    for (let i = 1; i < list.length; i++) {
      if (String(list[i][0]) === studentId) {
        studentName = String(list[i][1] || studentId);
        break;
      }
    }
  }

  const [entries, krHolidayMap, attendRows] = await Promise.all([
    listEntries({ from, to, classId, includeInactive: false }),
    getHolidaysForRange(from, to),
    getSheetRows(ATTENDANCE_SHEET)
  ]);

  const recordByDate = {};
  for (let i = 1; i < attendRows.length; i++) {
    if (String(attendRows[i][1]) !== classId) continue;
    if (String(attendRows[i][2]) !== studentId) continue;
    const ds = formatSheetDate(attendRows[i][0]);
    if (ds < from || ds > to) continue;
    recordByDate[ds] = parseAttendanceRow(attendRows[i]);
  }

  const summary = {
    present: 0,
    absent: 0,
    tardy: 0,
    earlyLeave: 0,
    absentExcused: 0,
    tardyExcused: 0,
    earlyLeaveExcused: 0,
    unmarked: 0,
    schoolDays: 0
  };

  const months = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));

  while (y < endY || (y === endY && m <= endM)) {
    const last = new Date(y, m, 0).getDate();
    const days = [];
    for (let d = 1; d <= last; d++) {
      const dateStr = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      if (dateStr < from || dateStr > to) {
        days.push({
          date: dateStr,
          day: d,
          outOfRange: true,
          isClassDay: false,
          greyOut: true,
          status: null,
          dayType: 'out',
          title: '',
          events: []
        });
        continue;
      }
      const resolved = await resolveDay(classId, dateStr, {
        classMeta,
        entries,
        krHolidayMap
      });
      const rec = recordByDate[dateStr];
      let status = null;
      let category = null;
      if (resolved.isClassDay) {
        summary.schoolDays += 1;
        if (rec && rec.attendance) {
          category = categorizeAttendance(rec.attendance, rec.excuse);
          status = rec.attendance;
          if (category && summary[category] != null) summary[category] += 1;
        } else {
          summary.unmarked += 1;
        }
      }
      days.push({
        date: dateStr,
        day: d,
        outOfRange: false,
        isClassDay: resolved.isClassDay,
        greyOut: !resolved.isClassDay,
        dayType: resolved.dayType,
        title: resolved.title,
        krHoliday: resolved.krHoliday,
        events: resolved.events,
        status,
        category,
        excuse: rec ? rec.excuse : '',
        note: rec ? rec.note : ''
      });
    }
    months.push({ year: y, month: m, days });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const marked = summary.present + summary.absent + summary.tardy + summary.earlyLeave +
    summary.absentExcused + summary.tardyExcused + summary.earlyLeaveExcused;
  const pct = (n) => (marked ? Math.round((n / marked) * 100) : 0);

  return {
    classId,
    className: classMeta.className,
    studentId,
    studentName,
    startDate: from,
    endDate: to,
    yearLabel: range.label,
    schoolDays: summary.schoolDays,
    summary: {
      ...summary,
      marked,
      percentages: {
        present: pct(summary.present),
        absent: pct(summary.absent),
        tardy: pct(summary.tardy),
        earlyLeave: pct(summary.earlyLeave),
        absentExcused: pct(summary.absentExcused),
        tardyExcused: pct(summary.tardyExcused),
        earlyLeaveExcused: pct(summary.earlyLeaveExcused)
      }
    },
    months
  };
}

module.exports = {
  VALID_STATUS,
  countsAsPresent,
  parseAttendanceRow,
  ensureAttendanceColumns,
  getClassScheduleInfo,
  getClassWorkData,
  upsertStudentRecord,
  getAttendanceForDate,
  saveAttendance,
  getStudentYearAttendance,
  normalizeAllowedDays
};
