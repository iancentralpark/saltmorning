const { formatSheetDate } = require('./dateUtils');
const { getSheetRows, updateRange, appendRows, invalidateSheetRowsCache } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { invalidateWorkCache } = require('./sessionService');
const { getActiveLeavesByClass } = require('./leaveService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

const ATTENDANCE_SHEET = 'Attendance_Data';

function normalizeVocabScore(val) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function afterAttendanceWrite(classId, dateStr) {
  cacheDeletePrefix('sidebar_v1_');
  invalidateWorkCache(classId, dateStr);
  invalidateSheetRowsCache(ATTENDANCE_SHEET);
}

async function upsertAttendanceBatchSupabase(classId, records) {
  const db = getSupabase();
  const payload = records.map(function(rec) {
    return {
      record_date: String(rec.dateStr),
      class_id: String(classId),
      student_id: String(rec.studentId),
      attendance: String(rec.attendance || ''),
      vocab_score: normalizeVocabScore(rec.vocabScore)
    };
  });
  const { error } = await db.from('attendance_records').upsert(payload, {
    onConflict: 'record_date,class_id,student_id'
  });
  if (error) throw new Error(error.message);
}

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

  if (isSupabaseEnabled()) {
    const batch = records.map(function(rec) {
      return {
        dateStr,
        studentId: rec.studentId,
        attendance: rec.attendance,
        vocabScore: rec.vocabScore
      };
    });
    await upsertAttendanceBatchSupabase(classId, batch);
    afterAttendanceWrite(classId, dateStr);
    return 'Saved successfully!';
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

  afterAttendanceWrite(classId, dateStr);
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

  if (isSupabaseEnabled()) {
    const batch = records.map(function(rec) {
      return {
        dateStr: String(rec.dateStr),
        studentId: rec.studentId,
        attendance: rec.attendance,
        vocabScore: rec.vocabScore
      };
    });
    await upsertAttendanceBatchSupabase(classId, batch);
    const dates = new Set(records.map(function(rec) { return String(rec.dateStr); }));
    dates.forEach(function(dateStr) { afterAttendanceWrite(classId, dateStr); });
    return;
  }

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
  const dates = new Set(records.map(function(rec) { return String(rec.dateStr); }));
  dates.forEach(function(dateStr) { afterAttendanceWrite(classId, dateStr); });
}

module.exports = { saveAttendanceData, upsertAttendanceRecord, batchUpsertAttendanceRecords };
