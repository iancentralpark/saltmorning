const { formatSheetDate } = require('./dateUtils');
const { getSheetRows, updateRange, appendRows } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');

const ATTENDANCE_SHEET = 'Attendance_Data';

async function saveAttendanceData(classId, dateStr, records) {
  classId = String(classId);
  dateStr = String(dateStr);
  if (!Array.isArray(records) || !records.length) {
    throw new Error('No records to save.');
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

module.exports = { saveAttendanceData };
