const { formatSheetDate, todayStr } = require('../dateUtils');
const { ATTENDANCE_SHEET } = require('../config');
const { getSheetRows, updateRange, appendRows } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const ATTENDANCE_OPTIONS = ['출석', '지각', '결석', '조퇴', '휴원'];

async function getAttendanceForDate(classId, dateStr) {
  classId = String(classId);
  dateStr = dateStr || todayStr();
  const roster = await getClassRoster(classId);
  const rows = await getSheetRows(ATTENDANCE_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== classId) continue;
    if (formatSheetDate(rows[i][0]) !== dateStr) continue;
    map[String(rows[i][2])] = {
      attendance: String(rows[i][3] || ''),
      vocabScore: Number(rows[i][4]) || 0
    };
  }
  return {
    date: dateStr,
    classId,
    options: ATTENDANCE_OPTIONS,
    students: roster.map((s) => ({
      studentId: s.studentId,
      name: s.name,
      attendance: (map[s.studentId] && map[s.studentId].attendance) || '출석',
      vocabScore: (map[s.studentId] && map[s.studentId].vocabScore) || 0
    }))
  };
}

async function saveAttendance(classId, dateStr, records) {
  classId = String(classId);
  dateStr = String(dateStr);
  if (!Array.isArray(records) || !records.length) {
    throw new Error('No attendance records to save.');
  }

  const data = await getSheetRows(ATTENDANCE_SHEET);
  const updates = [];
  const appends = [];

  for (const rec of records) {
    const studentId = String(rec.studentId);
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (formatSheetDate(data[i][0]) !== dateStr) continue;
      if (String(data[i][1]) !== classId) continue;
      if (String(data[i][2]) !== studentId) continue;
      foundRow = i + 1;
      break;
    }
    const attendance = String(rec.attendance || '출석');
    const vocabScore = Number(rec.vocabScore) || 0;
    if (foundRow !== -1) {
      updates.push({ row: foundRow, attendance, vocabScore });
    } else {
      appends.push([dateStr, classId, studentId, attendance, vocabScore]);
    }
  }

  for (const u of updates) {
    await updateRange(ATTENDANCE_SHEET, `D${u.row}:E${u.row}`, [[u.attendance, u.vocabScore]]);
  }
  if (appends.length) await appendRows(ATTENDANCE_SHEET, appends);
  return { saved: records.length };
}

module.exports = { getAttendanceForDate, saveAttendance, ATTENDANCE_OPTIONS };
