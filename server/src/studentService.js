const { ATTENDANCE_SHEET } = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRow, invalidateSheetRowsCache } = require('./sheets');
const { formatSheetDate } = require('./dateUtils');
const { cacheDeletePrefix } = require('./cache');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

function normalizeVocabScore(val) {
  if (val === '' || val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function vocabForStorage(val) {
  const n = normalizeVocabScore(val);
  return n == null ? null : n;
}

function findAttendanceRowIndexes(data, classId, studentId, dateStr) {
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (formatSheetDate(data[i][0]) === dateStr &&
        String(data[i][1]) === classId &&
        String(data[i][2]) === studentId) {
      rows.push(i + 1);
    }
  }
  return rows;
}

async function loadAttendanceRecord(classId, studentId, dateStr) {
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db
      .from('attendance_records')
      .select('attendance, vocab_score')
      .eq('record_date', dateStr)
      .eq('class_id', classId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const data = await getSheetRows(ATTENDANCE_SHEET, { skipCache: true });
  const rows = findAttendanceRowIndexes(data, classId, studentId, dateStr);
  if (!rows.length) return null;
  const row = data[rows[rows.length - 1] - 1];
  return {
    attendance: row[3] || '',
    vocab_score: normalizeVocabScore(row[4])
  };
}

async function upsertAttendanceSupabase(classId, studentId, dateStr, attendance, vocabScore) {
  const db = getSupabase();
  const { error } = await db.from('attendance_records').upsert({
    record_date: dateStr,
    class_id: classId,
    student_id: studentId,
    attendance: String(attendance || ''),
    vocab_score: vocabForStorage(vocabScore)
  }, { onConflict: 'record_date,class_id,student_id' });
  if (error) throw new Error(error.message);
}

async function deleteAttendanceSupabase(classId, studentId, dateStr) {
  const db = getSupabase();
  const { error } = await db.from('attendance_records').delete().match({
    record_date: dateStr,
    class_id: classId,
    student_id: studentId
  });
  if (error) throw new Error(error.message);
}

function afterAttendanceWrite(classId, dateStr) {
  cacheDeletePrefix('sidebar_v1_');
  invalidateWorkCache(classId, dateStr);
  invalidateSheetRowsCache(ATTENDANCE_SHEET);
}

async function getStudentHistory(classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(ATTENDANCE_SHEET, { skipCache: true });
  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || String(data[i][2]) !== studentId) continue;
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
  dateStr = formatSheetDate(dateStr);

  const existing = await loadAttendanceRecord(classId, studentId, dateStr);
  let attVal = String(attendance || '');
  let vocabVal = vocabForStorage(vocabScore);

  if (!attVal && existing && existing.attendance) attVal = String(existing.attendance);
  if (vocabVal == null && existing && existing.vocab_score != null) {
    vocabVal = normalizeVocabScore(existing.vocab_score);
  }

  if (!attVal && (vocabVal == null || vocabVal === 0)) {
    return 'Nothing to save.';
  }

  if (isSupabaseEnabled()) {
    await upsertAttendanceSupabase(classId, studentId, dateStr, attVal, vocabVal);
    afterAttendanceWrite(classId, dateStr);
    return existing ? 'Saved changes.' : 'Saved new record.';
  }

  const data = await getSheetRows(ATTENDANCE_SHEET, { skipCache: true });
  const rows = findAttendanceRowIndexes(data, classId, studentId, dateStr);
  const vocabCell = vocabVal == null ? '' : vocabVal;
  if (rows.length) {
    const target = rows[rows.length - 1];
    await updateRange(ATTENDANCE_SHEET, `D${target}:E${target}`, [[attVal, vocabCell]]);
    for (let j = rows.length - 2; j >= 0; j--) {
      await deleteRow(ATTENDANCE_SHEET, rows[j]);
    }
    afterAttendanceWrite(classId, dateStr);
    return 'Saved changes.';
  }
  await appendRows(ATTENDANCE_SHEET, [[dateStr, classId, studentId, attVal, vocabCell]]);
  afterAttendanceWrite(classId, dateStr);
  return 'Saved new record.';
}

async function deleteStudentRecord(classId, studentId, dateStr) {
  classId = String(classId);
  studentId = String(studentId);
  dateStr = formatSheetDate(dateStr);

  if (isSupabaseEnabled()) {
    const existing = await loadAttendanceRecord(classId, studentId, dateStr);
    if (!existing) return 'No record to clear.';
    await deleteAttendanceSupabase(classId, studentId, dateStr);
    afterAttendanceWrite(classId, dateStr);
    return 'Cleared.';
  }

  const data = await getSheetRows(ATTENDANCE_SHEET, { skipCache: true });
  const rows = findAttendanceRowIndexes(data, classId, studentId, dateStr);
  if (!rows.length) return 'No record to clear.';
  for (let j = rows.length - 1; j >= 0; j--) {
    await deleteRow(ATTENDANCE_SHEET, rows[j]);
  }
  afterAttendanceWrite(classId, dateStr);
  return 'Cleared.';
}

module.exports = { getStudentHistory, updateStudentRecord, deleteStudentRecord };
