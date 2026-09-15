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

async function clearWithdrawnMarkRange(classId, studentName, fromDateStr, toDateStr) {
  const from = formatSheetDate(fromDateStr);
  const to = formatSheetDate(toDateStr);
  if (!from || !to || from > to) return;

  const db = getSupabase();
  const { error } = await db
    .from('class_log_student_marks')
    .delete()
    .eq('class_id', String(classId))
    .eq('student_name', String(studentName).trim())
    .eq('mark', '퇴원')
    .gte('log_date', from)
    .lte('log_date', to);
  if (error) throw new Error(error.message || 'Could not clear withdrawn marks.');
}

/**
 * Move mark history from oldName → newName. Upserts under the new name first
 * so PK conflicts (same date already under newName) keep the newer/existing row,
 * then deletes the old-name rows.
 */
async function renameStudentMarks(classId, oldName, newName) {
  const db = getSupabase();
  classId = String(classId);
  oldName = String(oldName || '').trim();
  newName = String(newName || '').trim();
  if (!oldName || !newName || oldName === newName) return { updated: 0 };

  const { data, error } = await db
    .from('class_log_student_marks')
    .select('log_date, mark')
    .eq('class_id', classId)
    .eq('student_name', oldName);
  if (error) throw new Error(error.message || 'Could not load marks for rename.');
  const rows = data || [];
  if (!rows.length) return { updated: 0 };

  const upsertRows = rows.map(function(r) {
    return {
      class_id: classId,
      student_name: newName,
      log_date: r.log_date,
      mark: r.mark,
      updated_at: isoNow()
    };
  });
  const { error: upErr } = await db.from('class_log_student_marks').upsert(upsertRows, {
    onConflict: 'class_id,student_name,log_date'
  });
  if (upErr) throw new Error(upErr.message || 'Could not rename marks.');

  const { error: delErr } = await db
    .from('class_log_student_marks')
    .delete()
    .eq('class_id', classId)
    .eq('student_name', oldName);
  if (delErr) throw new Error(delErr.message || 'Could not clear old mark name.');

  return { updated: rows.length };
}

module.exports = {
  saveClassLogEntry,
  getDaily,
  upsertStudentMark,
  backfillMarkRange,
  clearWithdrawnMarkRange,
  renameStudentMarks,
  upsertDaily
};
