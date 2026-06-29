const { ATTENDANCE_SHEET } = require('./config');
const { getSheetRows, updateRange, appendRows } = require('./sheets');
const { formatSheetDate } = require('./dateUtils');

function normalizeVocabScore(val) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

async function getStudentHistory(classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(ATTENDANCE_SHEET);
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || data[i][2] !== studentId) continue;
    records.push({
      dateStr: formatSheetDate(data[i][0]),
      attendance: data[i][3],
      vocabScore: normalizeVocabScore(data[i][4])
    });
  }
  records.sort((a, b) => (a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0));
  return records;
}

async function updateStudentRecord(classId, studentId, dateStr, attendance, vocabScore) {
  classId = String(classId);
  studentId = String(studentId);
  dateStr = String(dateStr);
  const data = await getSheetRows(ATTENDANCE_SHEET);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (formatSheetDate(data[i][0]) === dateStr &&
        String(data[i][1]) === classId &&
        data[i][2] === studentId) {
      foundRow = i + 1;
      break;
    }
  }
  if (foundRow !== -1) {
    await updateRange(ATTENDANCE_SHEET, `D${foundRow}:E${foundRow}`, [[attendance, vocabScore]]);
    return 'Saved changes.';
  }
  await appendRows(ATTENDANCE_SHEET, [[dateStr, classId, studentId, attendance, vocabScore]]);
  return 'Saved new record.';
}

module.exports = { getStudentHistory, updateStudentRecord };
