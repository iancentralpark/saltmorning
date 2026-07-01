const { formatSheetDate } = require('./dateUtils');
const { getSheetRows, updateRange, appendRows } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { getActiveLeavesByClass } = require('./leaveService');

const ATTENDANCE_SHEET = 'Attendance_Data';

async function saveAttendanceData(classId, dateStr, records) {
  classId = String(classId);
  dateStr = String(dateStr);
  if (!Array.isArray(records) || !records.length) {
    throw new Error('No records to save.');
  }

  const leaveMap = await getActiveLeavesByClass(classId, dateStr);
  for (const rec of records) {
    if (leaveMap[String(rec.studentId)]) {
      rec.attendance = '휴원';
    }
  }

  const data = await getSheetRows(ATTENDANCE_SHEET);
  const updates = [];
  const appends = [];

  for (const rec of records) {
    const studentId = rec.studentId;
    let foundRow = -1;

    for (let i = 1; i < data.length; i++) {
      const rDate = formatSheetDate(data[i][0]);
      if (rDate === dateStr && String(data[i][1]) === classId && data[i][2] === studentId) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow !== -1) {
      updates.push({
        range: `D${foundRow}:E${foundRow}`,
        values: [[rec.attendance, rec.vocabScore]]
      });
      data[foundRow - 1][3] = rec.attendance;
      data[foundRow - 1][4] = rec.vocabScore;
    } else {
      appends.push([dateStr, classId, studentId, rec.attendance, rec.vocabScore]);
      data.push([dateStr, classId, studentId, rec.attendance, rec.vocabScore]);
    }
  }

  for (const u of updates) {
    await updateRange(ATTENDANCE_SHEET, u.range, u.values);
  }
  if (appends.length) {
    await appendRows(ATTENDANCE_SHEET, appends);
  }

  cacheDeletePrefix('sidebar_v1_');
  return 'Saved successfully!';
}

async function upsertAttendanceRecord(classId, studentId, dateStr, attendance, vocabScore) {
  await saveAttendanceData(classId, dateStr, [{
    studentId: String(studentId),
    attendance: String(attendance),
    vocabScore: Number(vocabScore) || 0
  }]);
}

/** Batch upsert across multiple dates — one sheet read for leave backfill. */
async function batchUpsertAttendanceRecords(classId, records) {
  if (!Array.isArray(records) || !records.length) return;
  classId = String(classId);

  const data = await getSheetRows(ATTENDANCE_SHEET);
  const updates = [];
  const appends = [];

  for (const rec of records) {
    const dateStr = String(rec.dateStr);
    const studentId = String(rec.studentId);
    const attendance = String(rec.attendance);
    const vocabScore = Number(rec.vocabScore) || 0;
    let foundRow = -1;

    for (let i = 1; i < data.length; i++) {
      const rDate = formatSheetDate(data[i][0]);
      if (rDate === dateStr && String(data[i][1]) === classId && data[i][2] === studentId) {
        foundRow = i;
        break;
      }
    }

    if (foundRow !== -1) {
      updates.push({ row: foundRow + 1, attendance, vocabScore });
      data[foundRow][3] = attendance;
      data[foundRow][4] = vocabScore;
    } else {
      appends.push([dateStr, classId, studentId, attendance, vocabScore]);
      data.push([dateStr, classId, studentId, attendance, vocabScore]);
    }
  }

  for (const u of updates) {
    await updateRange(ATTENDANCE_SHEET, `D${u.row}:E${u.row}`, [[u.attendance, u.vocabScore]]);
  }
  if (appends.length) {
    await appendRows(ATTENDANCE_SHEET, appends);
  }
  cacheDeletePrefix('sidebar_v1_');
}

module.exports = { saveAttendanceData, upsertAttendanceRecord, batchUpsertAttendanceRecords };
