const { getSupabase } = require('./supabaseClient');
const { formatSheetDate } = require('./dateUtils');

function isoNow() {
  return new Date().toISOString();
}

async function upsertDaily(classId, dateStr, fields) {
  const db = getSupabase();
  const logDate = formatSheetDate(dateStr);
  const row = {
    class_id: String(classId),
    log_date: logDate,
    updated_at: isoNow()
  };
  if (fields.lesson !== undefined) row.lesson = fields.lesson || null;
  if (fields.homework !== undefined) row.homework = fields.homework || null;
  if (fields.writing !== undefined) row.writing = fields.writing || null;

  const { error } = await db.from('class_log_daily').upsert(row, {
    onConflict: 'class_id,log_date'
  });
  if (error) throw new Error(error.message || 'Could not save class log.');
  return row;
}

async function getDaily(classId, dateStr) {
  const db = getSupabase();
  const logDate = formatSheetDate(dateStr);
  const { data, error } = await db
    .from('class_log_daily')
    .select('*')
    .eq('class_id', String(classId))
    .eq('log_date', logDate)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Database error.');
  if (!data) {
    return { configured: true, found: false, lesson: '', homework: '', writing: '' };
  }
  return {
    configured: true,
    found: true,
    lesson: String(data.lesson || '').trim(),
    homework: String(data.homework || '').trim(),
    writing: String(data.writing || '').trim()
  };
}

async function saveClassLogEntry(classId, dateStr, lesson, homework, writing) {
  const fields = {};
  if (lesson != null && String(lesson).trim()) fields.lesson = String(lesson).trim();
  if (homework != null && String(homework).trim()) fields.homework = String(homework).trim();
  if (writing != null && String(writing).trim()) fields.writing = String(writing).trim();
  await upsertDaily(classId, dateStr, fields);
  return {
    message: 'Class log saved.',
    date: formatSheetDate(dateStr),
    source: 'supabase'
  };
}

async function upsertStudentMark(classId, studentName, dateStr, mark) {
  const db = getSupabase();
  const row = {
    class_id: String(classId),
    student_name: String(studentName).trim(),
    log_date: formatSheetDate(dateStr),
    mark: String(mark || '').trim(),
    updated_at: isoNow()
  };
  const { error } = await db.from('class_log_student_marks').upsert(row, {
    onConflict: 'class_id,student_name,log_date'
  });
  if (error) throw new Error(error.message || 'Could not save class log mark.');
  return row;
}

async function backfillMarkRange(classId, studentName, fromDateStr, toDateStr, mark) {
  const from = formatSheetDate(fromDateStr);
  const to = formatSheetDate(toDateStr);
  if (!from || !to || from > to) return;

  const db = getSupabase();
  const rows = [];
  const cursor = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    rows.push({
      class_id: String(classId),
      student_name: String(studentName).trim(),
      log_date: y + '-' + m + '-' + d,
      mark: String(mark),
      updated_at: isoNow()
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  if (!rows.length) return;
  const { error } = await db.from('class_log_student_marks').upsert(rows, {
    onConflict: 'class_id,student_name,log_date'
  });
  if (error) throw new Error(error.message || 'Could not backfill marks.');
}

module.exports = {
  saveClassLogEntry,
  getDaily,
  upsertStudentMark,
  backfillMarkRange,
  upsertDaily
};
