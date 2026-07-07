const { formatSheetDate, todayStr } = require('../dateUtils');
const {
  ATTENDANCE_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const { getSheetRows, updateRange, appendRows } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');
const { getHolidayName } = require('../holiday');
const { getPlannedByClassAndDate } = require('./plannedAttendanceService');

const VALID_STATUS = ['출석', '지각', '결석'];

function normalizeVocabScore(val) {
  if (val === '' || val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function countsAsPresent(attendance, excuse) {
  if (attendance === '출석') return true;
  if ((attendance === '지각' || attendance === '결석') && String(excuse || '').trim()) return true;
  return false;
}

function parseAttendanceRow(row) {
  return {
    attendance: String(row[3] || ''),
    vocabScore: normalizeVocabScore(row[4]),
    excuse: String(row[5] || '').trim()
  };
}

async function ensureExcuseColumn() {
  const data = await getSheetRows(ATTENDANCE_SHEET);
  if (!data.length) {
    await appendRows(ATTENDANCE_SHEET, [['Date', 'ClassID', 'StudentID', 'Attendance', 'VocabScore', 'Excuse']]);
    return;
  }
  const header = (data[0] || []).map((c) => String(c || '').trim());
  if (header[5] === 'Excuse') return;
  if (header[0] === 'Date') {
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
  const holidayName = await getHolidayName(dateStr);
  let allowedDays = [1, 2, 3, 4, 5];
  let className = classId;
  const classRows = await getSheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < classRows.length; i++) {
    if (String(classRows[i][0]) === String(classId)) {
      allowedDays = normalizeAllowedDays(classRows[i][3]);
      className = String(classRows[i][1] || classId);
      break;
    }
  }
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const scheduledDay = !holidayName && allowedDays.includes(dow);
  return { holidayName, allowedDays, scheduledDay, className, dayOfWeek: dow };
}

async function getClassWorkData(classId, dateStr) {
  await ensureExcuseColumn();
  classId = String(classId);
  dateStr = dateStr || todayStr();

  const schedule = await getClassScheduleInfo(classId, dateStr);
  if (!schedule.scheduledDay) {
    return {
      date: dateStr,
      classId,
      ...schedule,
      students: []
    };
  }

  const roster = await getClassRoster(classId);
  const rows = await getSheetRows(ATTENDANCE_SHEET);
  const existing = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== classId) continue;
    if (formatSheetDate(rows[i][0]) !== dateStr) continue;
    existing[String(rows[i][2])] = parseAttendanceRow(rows[i]);
  }

  const plannedMap = await getPlannedByClassAndDate(classId, dateStr);

  const students = roster.map((s) => {
    const rec = existing[s.studentId] || {};
    const planned = plannedMap[s.studentId];
    let attendance = rec.attendance || '출석';
    let excuse = rec.excuse || '';
    if (!rec.attendance && planned) {
      attendance = planned.type;
      excuse = planned.note || '';
    }
    return {
      studentId: s.studentId,
      name: s.name,
      attendance,
      vocabScore: rec.vocabScore || 0,
      excuse,
      plannedNotice: planned || null,
      countsAsPresent: countsAsPresent(attendance, excuse)
    };
  });

  return {
    date: dateStr,
    classId,
    ...schedule,
    students
  };
}

async function upsertStudentRecord(classId, studentId, dateStr, attendance, vocabScore, excuse) {
  await ensureExcuseColumn();
  classId = String(classId);
  studentId = String(studentId);
  dateStr = String(dateStr);
  attendance = String(attendance || '').trim();
  excuse = String(excuse || '').trim();

  if (!VALID_STATUS.includes(attendance)) {
    throw new Error('Invalid attendance status.');
  }

  const vocab = normalizeVocabScore(vocabScore);
  const data = await getSheetRows(ATTENDANCE_SHEET);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (formatSheetDate(data[i][0]) !== dateStr) continue;
    if (String(data[i][1]) !== classId) continue;
    if (String(data[i][2]) !== studentId) continue;
    foundRow = i + 1;
    break;
  }

  const values = [[attendance, vocab, excuse]];
  if (foundRow !== -1) {
    await updateRange(ATTENDANCE_SHEET, `D${foundRow}:F${foundRow}`, values);
  } else {
    await appendRows(ATTENDANCE_SHEET, [[dateStr, classId, studentId, attendance, vocab, excuse]]);
  }

  return {
    saved: true,
    studentId,
    attendance,
    vocabScore: vocab,
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
      vocabScore: s.vocabScore,
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
      rec.vocabScore,
      rec.excuse
    );
  }
  return { saved: records.length };
}

module.exports = {
  VALID_STATUS,
  countsAsPresent,
  parseAttendanceRow,
  ensureExcuseColumn,
  getClassWorkData,
  upsertStudentRecord,
  getAttendanceForDate,
  saveAttendance
};
