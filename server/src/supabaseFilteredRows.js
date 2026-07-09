/**
 * Class-scoped Supabase reads for session load (avoids full-table scans).
 */
const { getSupabase } = require('./supabaseClient');
const { queryStudents } = require('./supabaseStudentColumns');
const {
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  STUDENT_WITHDRAWN_SHEET,
  STUDENT_LEAVE_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  ATTENDANCE_SHEET,
  DOLLAR_SHEETS,
  HOMEWORK_SHEETS,
  TEXTBOOK_SHEETS,
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  LUCKY_DRAW_SHEET,
  MANUAL_PENDING_SHEET,
  MAKEUP_SHEET,
  TIMEZONE
} = require('./config');
const { formatSheetDate, formatDateInTz, chambitWeekMonday, chambitWeekSunday } = require('./dateUtils');

const HEADERS = {
  [CLASS_LIST_SHEET]: ['ClassID', 'Name', 'ScheduleType', 'AllowedDays'],
  [STUDENT_LIST_SHEET]: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'],
  [STUDENT_WITHDRAWN_SHEET]: ['WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'],
  [STUDENT_LEAVE_SHEET]: ['LeaveID', 'StudentID', 'Name', 'ClassID', 'StartDate', 'EndDate', 'Reason', 'Status', 'CreatedAt', 'EndedAt'],
  [STUDENT_PLANNED_ATTENDANCE_SHEET]: ['NoticeID', 'StudentID', 'Name', 'ClassID', 'Date', 'Type', 'Note', 'Status', 'CreatedAt'],
  [ATTENDANCE_SHEET]: ['Date', 'ClassID', 'StudentID', 'Attendance', 'VocabScore'],
  [DOLLAR_SHEETS.BALANCES]: ['StudentID', 'Balance'],
  [HOMEWORK_SHEETS.MAP]: ['ClassID', 'CourseID', 'CourseName'],
  [HOMEWORK_SHEETS.LOG]: ['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt'],
  [HOMEWORK_SHEETS.ITEMS]: ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs'],
  [HOMEWORK_SHEETS.COMPLETION]: ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'],
  [TEXTBOOK_SHEETS.BOOKS]: ['TextbookID', 'ClassID', 'Name', 'Type', 'UnitType', 'TotalUnits', 'StartDate', 'Status'],
  [TEXTBOOK_SHEETS.PROGRESS]: ['Date', 'ClassID', 'TextbookID', 'Position'],
  [TEXTBOOK_SHEETS.QUEUE]: ['QueueID', 'ClassID', 'SortOrder', 'Name', 'Type', 'UnitType', 'TotalUnits'],
  [RULES_SHEET]: ['ClassID', 'Rules', 'UpdatedAt'],
  [LIBRARY_SHEET]: ['BookID', 'ClassID', 'StudentID', 'Title', 'Status', 'CreatedAt', 'ReturnedAt'],
  [ANNOUNCE_SHEET]: ['ClassID', 'Text', 'UpdatedAt'],
  [EVENTS_SHEET]: ['EventID', 'ClassID', 'Date', 'Description', 'CreatedAt'],
  [VIDEO_SHEET]: ['ClassID', 'VideoURL', 'UpdatedAt'],
  [CHAMBIT_DAILY_SHEET]: ['Date', 'ClassID', 'StudentID'],
  [CHAMBIT_COMBO_SHEET]: ['StudentID', 'ComboCount', 'UpdatedAt'],
  [LUCKY_DRAW_SHEET]: ['TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'],
  [MANUAL_PENDING_SHEET]: ['PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'],
  [MAKEUP_SHEET]: ['MakeupID', 'ClassID', 'StudentID', 'StudentName', 'Date', 'StartTime', 'EndTime', 'DurationHours', 'Notes', 'Status', 'RecordedAt']
};

function headerRow(sheetName) {
  return HEADERS[sheetName] || [];
}

function formatDate(val) {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return formatSheetDate(val);
}

async function enrolledStudentIds(db, classId, cache) {
  if (!cache.studentIds) {
    const rows = await queryStudents(db, { classId: classId, status: 'Enrolled', orderBy: 'name' });
    cache.studentIds = rows.map(function(r) { return String(r.id); });
  }
  return cache.studentIds;
}

async function homeworkIdsForClass(db, classId, cache) {
  if (cache.homeworkIds) return cache.homeworkIds;
  const { data, error } = await db
    .from('homework_log')
    .select('homework_id')
    .eq('class_id', String(classId));
  if (error) throw new Error(error.message);
  cache.homeworkIds = (data || []).map(function(r) { return String(r.homework_id); });
  return cache.homeworkIds;
}

async function getRowsFiltered(sheetName, classId, options) {
  const db = getSupabase();
  if (!db) throw new Error('Supabase not configured');
  classId = String(classId || '');
  const opts = options || {};
  const cache = opts._cache || (opts._cache = {});
  const dateStr = opts.dateStr ? String(opts.dateStr) : '';
  const header = headerRow(sheetName);

  if (sheetName === CLASS_LIST_SHEET) {
    const { data, error } = await db.from('classes').select('id, name, schedule_type, allowed_days').order('name');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      const days = Array.isArray(r.allowed_days) ? r.allowed_days.join(',') : '';
      rows.push([r.id, r.name, r.schedule_type || '', days]);
    });
    return rows;
  }

  if (sheetName === STUDENT_LIST_SHEET) {
    const data = await queryStudents(db, { classId: classId, orderBy: 'name' });
    const rows = [header];
    data.forEach(function(r) {
      rows.push([r.id, r.name, r.class_id, r.status, r.login_id, r.login_password || '']);
    });
    return rows;
  }

  if (sheetName === STUDENT_WITHDRAWN_SHEET) {
    const { data, error } = await db
      .from('students_withdrawn')
      .select('withdrawal_id, student_id, name, class_id, login_id, login_password, previous_status, withdrawn_at')
      .eq('class_id', classId)
      .order('created_at');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.withdrawal_id || ''),
        String(r.student_id || ''),
        String(r.name || ''),
        String(r.class_id || ''),
        String(r.login_id || ''),
        String(r.login_password || ''),
        String(r.previous_status || ''),
        r.withdrawn_at ? String(r.withdrawn_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === ATTENDANCE_SHEET) {
    let q = db
      .from('attendance_records')
      .select('record_date, class_id, student_id, attendance, vocab_score')
      .eq('class_id', classId);
    if (dateStr) q = q.eq('record_date', dateStr);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        formatDate(r.record_date),
        r.class_id,
        r.student_id,
        r.attendance || '',
        r.vocab_score == null ? '' : r.vocab_score
      ]);
    });
    return rows;
  }

  if (sheetName === DOLLAR_SHEETS.BALANCES) {
    const ids = await enrolledStudentIds(db, classId, cache);
    const rows = [header];
    if (!ids.length) return rows;
    const { data, error } = await db.from('dollar_balances').select('student_id, balance').in('student_id', ids);
    if (error) throw new Error(error.message);
    (data || []).forEach(function(r) {
      rows.push([r.student_id, r.balance]);
    });
    return rows;
  }

  if (sheetName === HOMEWORK_SHEETS.MAP) {
    const { data, error } = await db.from('classroom_map').select('class_id, course_id, course_name').eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([r.class_id, r.course_id || '', r.course_name || '']);
    });
    return rows;
  }

  if (sheetName === HOMEWORK_SHEETS.LOG) {
    const { data, error } = await db
      .from('homework_log')
      .select('homework_id, class_id, assigned_date, title, description, classroom_work_id, posted_at')
      .eq('class_id', classId)
      .order('assigned_date', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        r.homework_id,
        r.class_id,
        formatDate(r.assigned_date),
        r.title || '',
        r.description || '',
        r.classroom_work_id || '',
        r.posted_at ? String(r.posted_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === HOMEWORK_SHEETS.ITEMS) {
    const hwIds = await homeworkIdsForClass(db, classId, cache);
    const rows = [header];
    if (!hwIds.length) return rows;
    const { data, error } = await db
      .from('homework_items')
      .select('item_id, homework_id, sort_order, title, description, target_student_ids')
      .in('homework_id', hwIds)
      .order('homework_id')
      .order('sort_order');
    if (error) throw new Error(error.message);
    (data || []).forEach(function(r) {
      rows.push([
        r.item_id,
        r.homework_id,
        r.sort_order,
        r.title || '',
        r.description || '',
        r.target_student_ids || ''
      ]);
    });
    return rows;
  }

  if (sheetName === HOMEWORK_SHEETS.COMPLETION) {
    const hwIds = await homeworkIdsForClass(db, classId, cache);
    const rows = [header];
    if (!hwIds.length) return rows;
    const { data: items, error: itemErr } = await db
      .from('homework_items')
      .select('item_id')
      .in('homework_id', hwIds);
    if (itemErr) throw new Error(itemErr.message);
    const itemIds = (items || []).map(function(r) { return String(r.item_id); });
    if (!itemIds.length) return rows;
    const { data, error } = await db
      .from('homework_completion')
      .select('item_id, student_id, completed, completed_at, fix_note')
      .in('item_id', itemIds);
    if (error) throw new Error(error.message);
    (data || []).forEach(function(r) {
      rows.push([
        r.item_id,
        r.student_id,
        r.completed ? 'TRUE' : 'FALSE',
        r.completed_at ? String(r.completed_at) : '',
        r.fix_note || ''
      ]);
    });
    return rows;
  }

  if (sheetName === RULES_SHEET) {
    const { data, error } = await db.from('class_rules').select('class_id, rules, updated_at').eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.class_id || ''), String(r.rules || ''), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === LIBRARY_SHEET) {
    const { data, error } = await db
      .from('library_books')
      .select('book_id, class_id, student_id, title, status, created_at, returned_at')
      .eq('class_id', classId)
      .order('created_at');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.book_id || ''),
        String(r.class_id || ''),
        String(r.student_id || ''),
        String(r.title || ''),
        String(r.status || ''),
        r.created_at ? String(r.created_at) : '',
        r.returned_at ? String(r.returned_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === ANNOUNCE_SHEET) {
    const { data, error } = await db.from('class_announcements').select('class_id, body, updated_at').eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.class_id || ''), String(r.body || ''), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === EVENTS_SHEET) {
    const today = formatDateInTz(new Date(), TIMEZONE);
    const { data, error } = await db
      .from('class_events')
      .select('event_id, class_id, event_date, description, created_at')
      .eq('class_id', classId)
      .gte('event_date', today)
      .order('event_date');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.event_id || ''),
        String(r.class_id || ''),
        formatDate(r.event_date),
        String(r.description || ''),
        r.created_at ? String(r.created_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === VIDEO_SHEET) {
    const { data, error } = await db
      .from('class_video')
      .select('class_id, video_url, updated_at')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.class_id || ''), String(r.video_url || ''), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === CHAMBIT_DAILY_SHEET) {
    let q = db
      .from('chambit_daily')
      .select('record_date, class_id, student_id')
      .eq('class_id', classId);
    if (dateStr) {
      const weekMonday = chambitWeekMonday(dateStr);
      const weekSunday = chambitWeekSunday(weekMonday);
      q = q.gte('record_date', weekMonday).lte('record_date', weekSunday);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([formatDate(r.record_date), r.class_id, r.student_id]);
    });
    return rows;
  }

  if (sheetName === CHAMBIT_COMBO_SHEET) {
    const ids = await enrolledStudentIds(db, classId, cache);
    const rows = [header];
    if (!ids.length) return rows;
    const { data, error } = await db.from('chambit_combo').select('student_id, combo_count, updated_at').in('student_id', ids);
    if (error) throw new Error(error.message);
    (data || []).forEach(function(r) {
      rows.push([String(r.student_id || ''), Number(r.combo_count || 0), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === LUCKY_DRAW_SHEET) {
    const { data, error } = await db
      .from('lucky_draw_tickets')
      .select('ticket_id, class_id, student_id, tier, prize_text, drawn_at')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.ticket_id || ''),
        String(r.class_id || ''),
        String(r.student_id || ''),
        String(r.tier || ''),
        String(r.prize_text || ''),
        r.drawn_at ? String(r.drawn_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === STUDENT_LEAVE_SHEET) {
    const { data, error } = await db
      .from('student_leaves')
      .select('leave_id, student_id, name, class_id, start_date, end_date, reason, status, created_at, ended_at')
      .eq('class_id', classId)
      .eq('status', 'Active');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.leave_id || ''),
        String(r.student_id || ''),
        String(r.name || ''),
        String(r.class_id || ''),
        formatDate(r.start_date),
        formatDate(r.end_date),
        String(r.reason || ''),
        String(r.status || ''),
        r.created_at ? String(r.created_at) : '',
        r.ended_at ? String(r.ended_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === STUDENT_PLANNED_ATTENDANCE_SHEET) {
    let q = db
      .from('student_planned_attendance')
      .select('notice_id, student_id, name, class_id, notice_date, notice_type, note, status, created_at')
      .eq('class_id', classId)
      .eq('status', 'Active');
    if (dateStr) q = q.eq('notice_date', dateStr);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.notice_id || ''),
        String(r.student_id || ''),
        String(r.name || ''),
        String(r.class_id || ''),
        formatDate(r.notice_date),
        String(r.notice_type || ''),
        String(r.note || ''),
        String(r.status || ''),
        r.created_at ? String(r.created_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === MANUAL_PENDING_SHEET) {
    const { data, error } = await db
      .from('homework_manual_pending')
      .select('pending_id, class_id, student_id, title, description, created_at, fix_note')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.pending_id || ''),
        String(r.class_id || ''),
        String(r.student_id || ''),
        String(r.title || ''),
        String(r.description || ''),
        r.created_at ? String(r.created_at) : '',
        String(r.fix_note || '')
      ]);
    });
    return rows;
  }

  if (sheetName === MAKEUP_SHEET) {
    const today = formatDateInTz(new Date(), TIMEZONE);
    const { data, error } = await db
      .from('makeup_lessons')
      .select('makeup_id, class_id, student_id, student_name, lesson_date, lesson_time, note, status, created_at')
      .eq('class_id', classId)
      .gte('lesson_date', today)
      .order('lesson_date');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      const timeParts = String(r.lesson_time || '').split('-');
      rows.push([
        String(r.makeup_id || ''),
        String(r.class_id || ''),
        String(r.student_id || ''),
        String(r.student_name || ''),
        formatDate(r.lesson_date),
        timeParts[0] || '',
        timeParts[1] || '',
        '',
        String(r.note || ''),
        String(r.status || ''),
        r.created_at ? String(r.created_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === TEXTBOOK_SHEETS.BOOKS) {
    const { data, error } = await db
      .from('class_textbooks')
      .select('textbook_id, class_id, name, book_type, unit_type, total_units, start_date, status')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.textbook_id || ''),
        String(r.class_id || ''),
        String(r.name || ''),
        String(r.book_type || ''),
        String(r.unit_type || 'chapter'),
        Number(r.total_units || 0),
        r.start_date ? formatDate(r.start_date) : '',
        String(r.status || '')
      ]);
    });
    return rows;
  }

  if (sheetName === TEXTBOOK_SHEETS.PROGRESS) {
    const { data, error } = await db
      .from('textbook_progress')
      .select('record_date, class_id, textbook_id, position')
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        formatDate(r.record_date),
        String(r.class_id || ''),
        String(r.textbook_id || ''),
        Number(r.position || 0)
      ]);
    });
    return rows;
  }

  if (sheetName === TEXTBOOK_SHEETS.QUEUE) {
    const { data, error } = await db
      .from('textbook_queue')
      .select('queue_id, class_id, sort_order, name, book_type, unit_type, total_units')
      .eq('class_id', classId)
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.queue_id || ''),
        String(r.class_id || ''),
        Number(r.sort_order || 0),
        String(r.name || ''),
        String(r.book_type || ''),
        String(r.unit_type || 'chapter'),
        Number(r.total_units || 0)
      ]);
    });
    return rows;
  }

  return null;
}

module.exports = { getRowsFiltered };
