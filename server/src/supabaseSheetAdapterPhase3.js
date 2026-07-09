const { getSupabase } = require('./supabaseClient');
const { queryStudents } = require('./supabaseStudentColumns');
const {
  TEXTBOOK_SHEETS,
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  CHAMBIT_WEEK_SHEET,
  LUCKY_DRAW_SHEET,
  LUCKY_DRAW_TIERS_SHEET,
  LUCKY_DRAW_PRIZES_SHEET,
  MANUAL_PENDING_SHEET,
  STUDENT_LIST_SHEET,
  STUDENT_WITHDRAWN_SHEET,
  STUDENT_LEAVE_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  MAKEUP_SHEET
} = require('./config');

const { hashPassword } = require('./supabaseStudentService');

const PHASE3_SHEETS = new Set([
  STUDENT_WITHDRAWN_SHEET,
  STUDENT_LEAVE_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  MANUAL_PENDING_SHEET,
  TEXTBOOK_SHEETS.BOOKS,
  TEXTBOOK_SHEETS.PROGRESS,
  TEXTBOOK_SHEETS.QUEUE,
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  CHAMBIT_WEEK_SHEET,
  LUCKY_DRAW_TIERS_SHEET,
  LUCKY_DRAW_PRIZES_SHEET,
  LUCKY_DRAW_SHEET,
  MAKEUP_SHEET,
  STUDENT_LIST_SHEET
]);

const HEADERS = {
  [STUDENT_LIST_SHEET]: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'],
  [STUDENT_WITHDRAWN_SHEET]: [
    'WithdrawalID',
    'StudentID',
    'Name',
    'ClassID',
    'LoginID',
    'LoginPassword',
    'PreviousStatus',
    'WithdrawnAt'
  ],
  [STUDENT_LEAVE_SHEET]: [
    'LeaveID',
    'StudentID',
    'Name',
    'ClassID',
    'StartDate',
    'EndDate',
    'Reason',
    'Status',
    'CreatedAt',
    'EndedAt'
  ],
  [STUDENT_PLANNED_ATTENDANCE_SHEET]: [
    'NoticeID',
    'StudentID',
    'Name',
    'ClassID',
    'Date',
    'Type',
    'Note',
    'Status',
    'CreatedAt'
  ],
  [MANUAL_PENDING_SHEET]: ['PendingID', 'ClassID', 'StudentID', 'Title', 'Description', 'CreatedAt', 'FixNote'],
  [TEXTBOOK_SHEETS.BOOKS]: [
    'TextbookID',
    'ClassID',
    'Name',
    'Type',
    'UnitType',
    'TotalUnits',
    'StartDate',
    'Status',
    'CompletedAt'
  ],
  [TEXTBOOK_SHEETS.PROGRESS]: ['Date', 'ClassID', 'TextbookID', 'Position'],
  [TEXTBOOK_SHEETS.QUEUE]: ['QueueID', 'ClassID', 'SortOrder', 'Name', 'Type', 'UnitType', 'TotalUnits', 'CreatedAt'],
  [RULES_SHEET]: ['ClassID', 'Rules', 'UpdatedAt'],
  [LIBRARY_SHEET]: ['BookID', 'ClassID', 'StudentID', 'Title', 'Status', 'CreatedAt', 'ReturnedAt'],
  [ANNOUNCE_SHEET]: ['ClassID', 'Text', 'UpdatedAt'],
  [EVENTS_SHEET]: ['EventID', 'ClassID', 'Date', 'Description', 'CreatedAt'],
  [VIDEO_SHEET]: ['ClassID', 'VideoURL', 'UpdatedAt'],
  [CHAMBIT_DAILY_SHEET]: ['Date', 'ClassID', 'StudentID'],
  [CHAMBIT_COMBO_SHEET]: ['StudentID', 'ComboCount', 'UpdatedAt'],
  [CHAMBIT_WEEK_SHEET]: ['StudentID', 'WeekKey', 'AwardedAt'],
  [LUCKY_DRAW_TIERS_SHEET]: ['TierID', 'TierName', 'Weight', 'SortOrder', 'Active'],
  [LUCKY_DRAW_PRIZES_SHEET]: ['TierID', 'PrizeText', 'SortOrder', 'Active'],
  [LUCKY_DRAW_SHEET]: ['TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'],
  [MAKEUP_SHEET]: [
    'MakeupID',
    'ClassID',
    'StudentID',
    'StudentName',
    'Date',
    'StartTime',
    'EndTime',
    'DurationHours',
    'Notes',
    'Status',
    'RecordedAt'
  ]
};

function colToIndex(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseA1Range(a1) {
  const m = String(a1 || '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Invalid range: ' + a1);
  return {
    startCol: colToIndex(m[1]),
    startRow: Number(m[2]),
    endCol: colToIndex(m[3] || m[1]),
    endRow: Number(m[4] || m[2])
  };
}

function formatDate(val) {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

function sheetBool(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 'Y' || val === 'Yes';
}

function isActiveFlag(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '' || v === 'y' || v === 'yes' || v === 'true' || v === '1';
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isHeaderRow(sheetName, row) {
  const header = HEADERS[sheetName];
  if (!header || !row || !row.length) return false;
  if (String(row[0] || '') !== String(header[0] || '')) return false;
  if (row.length < header.length) return false;
  for (let i = 0; i < header.length; i++) {
    if (String(row[i] || '') !== String(header[i] || '')) return false;
  }
  return true;
}

function patchRowCells(existingRow, startCol, rowValues, totalCols) {
  const base = new Array(totalCols).fill('');
  if (Array.isArray(existingRow)) {
    for (let i = 0; i < Math.min(existingRow.length, totalCols); i++) {
      base[i] = existingRow[i] == null ? '' : existingRow[i];
    }
  }
  for (let i = 0; i < rowValues.length; i++) {
    const col = startCol + i;
    if (col >= 0 && col < totalCols) base[col] = rowValues[i];
  }
  return base;
}

function ensureSupports(sheetName) {
  if (!PHASE3_SHEETS.has(sheetName)) {
    throw new Error('Phase 3 Supabase adapter does not support sheet: ' + sheetName);
  }
}

async function getRows(sheetName) {
  ensureSupports(sheetName);
  const db = getSupabase();
  const header = HEADERS[sheetName];

  if (sheetName === STUDENT_LIST_SHEET) {
    const data = await queryStudents(db, { orderBy: 'name' });
    const rows = [header];
    data.forEach(function(r) {
      rows.push([
        String(r.id || ''),
        String(r.name || ''),
        String(r.class_id || ''),
        String(r.status || ''),
        String(r.login_id || ''),
        String(r.login_password || '')
      ]);
    });
    return rows;
  }

  if (sheetName === STUDENT_WITHDRAWN_SHEET) {
    const { data, error } = await db
      .from('students_withdrawn')
      .select('withdrawal_id, student_id, name, class_id, login_id, login_password, previous_status, withdrawn_at')
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

  if (sheetName === STUDENT_LEAVE_SHEET) {
    const { data, error } = await db
      .from('student_leaves')
      .select('leave_id, student_id, name, class_id, start_date, end_date, reason, status, created_at, ended_at')
      .order('created_at');
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
    const { data, error } = await db
      .from('student_planned_attendance')
      .select('notice_id, student_id, name, class_id, notice_date, notice_type, note, status, created_at')
      .order('notice_date')
      .order('created_at');
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
      .order('created_at');
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

  if (sheetName === TEXTBOOK_SHEETS.BOOKS) {
    const { data, error } = await db
      .from('class_textbooks')
      .select('textbook_id, class_id, name, book_type, unit_type, total_units, start_date, status, completed_at')
      .order('created_at');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.textbook_id || ''),
        String(r.class_id || ''),
        String(r.name || ''),
        String(r.book_type || ''),
        String(r.unit_type || ''),
        r.total_units == null ? '' : r.total_units,
        formatDate(r.start_date),
        String(r.status || ''),
        r.completed_at ? String(r.completed_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === TEXTBOOK_SHEETS.PROGRESS) {
    const { data, error } = await db
      .from('textbook_progress')
      .select('record_date, class_id, textbook_id, position')
      .order('record_date')
      .order('class_id')
      .order('textbook_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([formatDate(r.record_date), String(r.class_id || ''), String(r.textbook_id || ''), r.position == null ? '' : Number(r.position)]);
    });
    return rows;
  }

  if (sheetName === TEXTBOOK_SHEETS.QUEUE) {
    const { data, error } = await db
      .from('textbook_queue')
      .select('queue_id, class_id, sort_order, name, book_type, unit_type, total_units, created_at')
      .order('class_id')
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.queue_id || ''),
        String(r.class_id || ''),
        r.sort_order == null ? '' : Number(r.sort_order),
        String(r.name || ''),
        String(r.book_type || ''),
        String(r.unit_type || ''),
        r.total_units == null ? '' : Number(r.total_units),
        r.created_at ? String(r.created_at) : ''
      ]);
    });
    return rows;
  }

  if (sheetName === RULES_SHEET) {
    const { data, error } = await db.from('class_rules').select('class_id, rules, updated_at').order('class_id');
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
    const { data, error } = await db
      .from('class_announcements')
      .select('class_id, body, updated_at')
      .order('class_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.class_id || ''), String(r.body || ''), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === EVENTS_SHEET) {
    const { data, error } = await db
      .from('class_events')
      .select('event_id, class_id, event_date, description, created_at')
      .order('event_date')
      .order('created_at');
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
    const { data, error } = await db.from('class_video').select('class_id, video_url, updated_at').order('class_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.class_id || ''), String(r.video_url || ''), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === CHAMBIT_DAILY_SHEET) {
    const { data, error } = await db
      .from('chambit_daily')
      .select('record_date, class_id, student_id')
      .order('record_date')
      .order('class_id')
      .order('student_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([formatDate(r.record_date), String(r.class_id || ''), String(r.student_id || '')]);
    });
    return rows;
  }

  if (sheetName === CHAMBIT_COMBO_SHEET) {
    const { data, error } = await db
      .from('chambit_combo')
      .select('student_id, combo_count, updated_at')
      .order('student_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.student_id || ''), Number(r.combo_count || 0), r.updated_at ? String(r.updated_at) : '']);
    });
    return rows;
  }

  if (sheetName === CHAMBIT_WEEK_SHEET) {
    const { data, error } = await db
      .from('chambit_week_awards')
      .select('student_id, week_key, awarded_at')
      .order('week_key')
      .order('student_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([String(r.student_id || ''), String(r.week_key || ''), r.awarded_at ? String(r.awarded_at) : '']);
    });
    return rows;
  }

  if (sheetName === LUCKY_DRAW_TIERS_SHEET) {
    const { data, error } = await db
      .from('lucky_draw_tiers')
      .select('tier_id, tier_name, weight, sort_order, active')
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.tier_id || ''),
        String(r.tier_name || ''),
        Number(r.weight || 0),
        Number(r.sort_order || 0),
        r.active ? 'Y' : 'N'
      ]);
    });
    return rows;
  }

  if (sheetName === LUCKY_DRAW_PRIZES_SHEET) {
    const { data, error } = await db
      .from('lucky_draw_prizes')
      .select('tier_id, prize_text, sort_order, active')
      .order('tier_id')
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        String(r.tier_id || ''),
        String(r.prize_text || ''),
        Number(r.sort_order || 0),
        r.active ? 'Y' : 'N'
      ]);
    });
    return rows;
  }

  if (sheetName === LUCKY_DRAW_SHEET) {
    const { data, error } = await db
      .from('lucky_draw_tickets')
      .select('ticket_id, class_id, student_id, tier, prize_text, drawn_at')
      .order('drawn_at');
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

  if (sheetName === MAKEUP_SHEET) {
    const { data, error } = await db
      .from('makeup_lessons')
      .select('makeup_id, class_id, student_id, student_name, lesson_date, lesson_time, note, status, created_at');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      const time = String(r.lesson_time || '');
      const parts = time.split('-');
      const startTime = String(parts[0] || '').trim();
      const endTime = String(parts[1] || '').trim();
      rows.push([
        String(r.makeup_id || ''),
        String(r.class_id || ''),
        String(r.student_id || ''),
        String(r.student_name || ''),
        formatDate(r.lesson_date),
        startTime,
        endTime,
        '',
        String(r.note || ''),
        String(r.status || ''),
        r.created_at ? String(r.created_at) : ''
      ]);
    });
    return rows;
  }

  throw new Error('No Phase 3 Supabase getRows adapter for sheet: ' + sheetName);
}

async function appendRows(sheetName, rows) {
  ensureSupports(sheetName);
  const db = getSupabase();
  if (!rows || !rows.length) return;

  const bodyRows = rows.filter(function(row) {
    return !isHeaderRow(sheetName, row);
  });
  if (!bodyRows.length) return;

  if (sheetName === STUDENT_LIST_SHEET) {
    const payload = [];
    for (const row of bodyRows) {
      const plain = String(row[5] || '');
      const passwordHash = plain ? await hashPassword(plain) : '';
      payload.push({
        id: String(row[0]),
        name: String(row[1] || ''),
        class_id: String(row[2] || ''),
        status: String(row[3] || ''),
        login_id: String(row[4] || ''),
        login_password: plain,
        password_hash: passwordHash
      });
    }
    const { error } = await db.from('students').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === STUDENT_WITHDRAWN_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        withdrawal_id: String(row[0]),
        student_id: String(row[1]),
        name: String(row[2] || ''),
        class_id: String(row[3] || ''),
        login_id: String(row[4] || ''),
        login_password: String(row[5] || ''),
        previous_status: String(row[6] || ''),
        withdrawn_at: row[7] ? new Date(row[7]).toISOString() : null
      };
    });
    const { error } = await db.from('students_withdrawn').upsert(payload, { onConflict: 'withdrawal_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === STUDENT_LEAVE_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        leave_id: String(row[0]),
        student_id: String(row[1]),
        name: String(row[2] || ''),
        class_id: String(row[3] || ''),
        start_date: formatDate(row[4]),
        end_date: formatDate(row[5]),
        reason: String(row[6] || ''),
        status: String(row[7] || ''),
        created_at: row[8] ? new Date(row[8]).toISOString() : null,
        ended_at: row[9] ? new Date(row[9]).toISOString() : null
      };
    });
    const { error } = await db.from('student_leaves').upsert(payload, { onConflict: 'leave_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === STUDENT_PLANNED_ATTENDANCE_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        notice_id: String(row[0]),
        student_id: String(row[1]),
        name: String(row[2] || ''),
        class_id: String(row[3] || ''),
        notice_date: formatDate(row[4]),
        notice_type: String(row[5] || ''),
        note: String(row[6] || ''),
        status: String(row[7] || ''),
        created_at: row[8] ? new Date(row[8]).toISOString() : null
      };
    });
    const { error } = await db.from('student_planned_attendance').upsert(payload, { onConflict: 'notice_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === MANUAL_PENDING_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        pending_id: String(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2]),
        title: String(row[3] || ''),
        description: String(row[4] || ''),
        created_at: row[5] ? new Date(row[5]).toISOString() : null,
        fix_note: String(row[6] || '')
      };
    });
    const { error } = await db.from('homework_manual_pending').upsert(payload, { onConflict: 'pending_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === TEXTBOOK_SHEETS.BOOKS) {
    const payload = bodyRows.map(function(row) {
      return {
        textbook_id: String(row[0]),
        class_id: String(row[1]),
        name: String(row[2] || ''),
        book_type: String(row[3] || ''),
        unit_type: String(row[4] || 'chapter'),
        total_units: toNum(row[5], 0),
        start_date: row[6] ? formatDate(row[6]) : null,
        status: String(row[7] || 'Active'),
        completed_at: row[8] ? new Date(row[8]).toISOString() : null
      };
    });
    const { error } = await db.from('class_textbooks').upsert(payload, { onConflict: 'textbook_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === TEXTBOOK_SHEETS.PROGRESS) {
    const payload = bodyRows.map(function(row) {
      return {
        record_date: formatDate(row[0]),
        class_id: String(row[1]),
        textbook_id: String(row[2]),
        position: toNum(row[3], 0)
      };
    });
    const { error } = await db.from('textbook_progress').upsert(payload, {
      onConflict: 'record_date,class_id,textbook_id'
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === TEXTBOOK_SHEETS.QUEUE) {
    const payload = bodyRows.map(function(row) {
      return {
        queue_id: String(row[0]),
        class_id: String(row[1]),
        sort_order: toNum(row[2], 0),
        name: String(row[3] || ''),
        book_type: String(row[4] || ''),
        unit_type: String(row[5] || 'chapter'),
        total_units: toNum(row[6], 0),
        created_at: row[7] ? new Date(row[7]).toISOString() : null
      };
    });
    const { error } = await db.from('textbook_queue').upsert(payload, { onConflict: 'queue_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === RULES_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        class_id: String(row[0]),
        rules: String(row[1] || ''),
        updated_at: row[2] ? new Date(row[2]).toISOString() : null
      };
    });
    const { error } = await db.from('class_rules').upsert(payload, { onConflict: 'class_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === LIBRARY_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        book_id: String(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2]),
        title: String(row[3] || ''),
        status: String(row[4] || 'Pending'),
        created_at: row[5] ? new Date(row[5]).toISOString() : null,
        returned_at: row[6] ? new Date(row[6]).toISOString() : null
      };
    });
    const { error } = await db.from('library_books').upsert(payload, { onConflict: 'book_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === ANNOUNCE_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        class_id: String(row[0]),
        body: String(row[1] || ''),
        updated_at: row[2] ? new Date(row[2]).toISOString() : null
      };
    });
    const { error } = await db.from('class_announcements').upsert(payload, { onConflict: 'class_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === EVENTS_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        event_id: String(row[0]),
        class_id: String(row[1]),
        event_date: formatDate(row[2]),
        description: String(row[3] || ''),
        created_at: row[4] ? new Date(row[4]).toISOString() : null
      };
    });
    const { error } = await db.from('class_events').upsert(payload, { onConflict: 'event_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === VIDEO_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        class_id: String(row[0] || ''),
        video_url: String(row[1] || ''),
        updated_at: row[2] ? new Date(row[2]).toISOString() : null
      };
    });
    const { error } = await db.from('class_video').upsert(payload, { onConflict: 'class_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === CHAMBIT_DAILY_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        record_date: formatDate(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2])
      };
    });
    const { error } = await db.from('chambit_daily').upsert(payload, {
      onConflict: 'record_date,class_id,student_id'
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === CHAMBIT_COMBO_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        student_id: String(row[0]),
        combo_count: Math.max(0, Math.round(toNum(row[1], 0))),
        updated_at: row[2] ? new Date(row[2]).toISOString() : null
      };
    });
    const { error } = await db.from('chambit_combo').upsert(payload, { onConflict: 'student_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === CHAMBIT_WEEK_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        student_id: String(row[0]),
        week_key: String(row[1]),
        awarded_at: row[2] ? new Date(row[2]).toISOString() : null
      };
    });
    const { error } = await db.from('chambit_week_awards').upsert(payload, { onConflict: 'student_id,week_key' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === LUCKY_DRAW_TIERS_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        tier_id: String(row[0]),
        tier_name: String(row[1] || ''),
        weight: Math.max(0, toNum(row[2], 0)),
        sort_order: toNum(row[3], 0),
        active: isActiveFlag(row[4])
      };
    });
    const { error } = await db.from('lucky_draw_tiers').upsert(payload, { onConflict: 'tier_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === LUCKY_DRAW_PRIZES_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        tier_id: String(row[0]),
        prize_text: String(row[1] || ''),
        sort_order: toNum(row[2], 0),
        active: isActiveFlag(row[3])
      };
    });
    const { error } = await db.from('lucky_draw_prizes').upsert(payload, { onConflict: 'tier_id,sort_order' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === LUCKY_DRAW_SHEET) {
    const payload = bodyRows.map(function(row) {
      return {
        ticket_id: String(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2]),
        tier: String(row[3] || ''),
        prize_text: String(row[4] || ''),
        drawn_at: row[5] ? new Date(row[5]).toISOString() : null
      };
    });
    const { error } = await db.from('lucky_draw_tickets').upsert(payload, { onConflict: 'ticket_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === MAKEUP_SHEET) {
    const payload = bodyRows.map(function(row) {
      const lessonTime = String(row[5] || '').trim() + '-' + String(row[6] || '').trim();
      return {
        makeup_id: String(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2]),
        student_name: String(row[3] || ''),
        lesson_date: formatDate(row[4]),
        lesson_time: lessonTime,
        note: String(row[8] || ''),
        status: String(row[9] || 'Scheduled'),
        created_at: row[10] ? new Date(row[10]).toISOString() : null
      };
    });
    const { error } = await db.from('makeup_lessons').upsert(payload, { onConflict: 'makeup_id' });
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error('Phase 3 Supabase append not supported for sheet: ' + sheetName);
}

async function updateRange(sheetName, a1, values) {
  ensureSupports(sheetName);
  if (!Array.isArray(values) || !values.length) return;
  const db = getSupabase();
  const range = parseA1Range(a1);
  const allRows = await getRows(sheetName);
  const totalCols = (HEADERS[sheetName] || []).length;

  for (let i = 0; i < values.length; i++) {
    const rowNum = range.startRow + i;
    const rowValues = Array.isArray(values[i]) ? values[i] : [values[i]];

    if (rowNum === 1) {
      if (sheetName === LUCKY_DRAW_TIERS_SHEET || sheetName === LUCKY_DRAW_PRIZES_SHEET || sheetName === STUDENT_LIST_SHEET) {
        continue;
      }
      throw new Error('Header row updates are not supported for sheet: ' + sheetName);
    }

    const existingRow = allRows[rowNum - 1] || null;
    if (!existingRow && range.startCol > 0) {
      throw new Error('Cannot update partial row without existing data: ' + sheetName + ' ' + a1);
    }
    const patched = patchRowCells(existingRow, range.startCol, rowValues, totalCols);

    if (sheetName === STUDENT_LIST_SHEET) {
      if (!existingRow) throw new Error('Student row not found for update: ' + a1);
      const studentId = String(existingRow[0] || '');
      const patch = {};
      for (let c = range.startCol; c < range.startCol + rowValues.length; c++) {
        const v = rowValues[c - range.startCol];
        if (c === 3) patch.status = String(v || '');
        if (c === 4) patch.login_id = String(v || '');
        if (c === 5) {
          const plain = String(v || '');
          patch.login_password = plain;
          patch.password_hash = plain ? await hashPassword(plain) : '';
        }
        if (c < 3) {
          throw new Error('Student list update only supports columns D-F in Supabase mode.');
        }
      }
      const { error } = await db.from('students').update(patch).eq('id', studentId);
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === STUDENT_WITHDRAWN_SHEET) {
      const payload = {
        withdrawal_id: String(patched[0]),
        student_id: String(patched[1]),
        name: String(patched[2] || ''),
        class_id: String(patched[3] || ''),
        login_id: String(patched[4] || ''),
        login_password: String(patched[5] || ''),
        previous_status: String(patched[6] || ''),
        withdrawn_at: patched[7] ? new Date(patched[7]).toISOString() : null
      };
      const { error } = await db.from('students_withdrawn').upsert(payload, { onConflict: 'withdrawal_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === STUDENT_LEAVE_SHEET) {
      const payload = {
        leave_id: String(patched[0]),
        student_id: String(patched[1]),
        name: String(patched[2] || ''),
        class_id: String(patched[3] || ''),
        start_date: formatDate(patched[4]),
        end_date: formatDate(patched[5]),
        reason: String(patched[6] || ''),
        status: String(patched[7] || ''),
        created_at: patched[8] ? new Date(patched[8]).toISOString() : null,
        ended_at: patched[9] ? new Date(patched[9]).toISOString() : null
      };
      const { error } = await db.from('student_leaves').upsert(payload, { onConflict: 'leave_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === STUDENT_PLANNED_ATTENDANCE_SHEET) {
      const payload = {
        notice_id: String(patched[0]),
        student_id: String(patched[1]),
        name: String(patched[2] || ''),
        class_id: String(patched[3] || ''),
        notice_date: formatDate(patched[4]),
        notice_type: String(patched[5] || ''),
        note: String(patched[6] || ''),
        status: String(patched[7] || ''),
        created_at: patched[8] ? new Date(patched[8]).toISOString() : null
      };
      const { error } = await db.from('student_planned_attendance').upsert(payload, { onConflict: 'notice_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === MANUAL_PENDING_SHEET) {
      const payload = {
        pending_id: String(patched[0]),
        class_id: String(patched[1]),
        student_id: String(patched[2]),
        title: String(patched[3] || ''),
        description: String(patched[4] || ''),
        created_at: patched[5] ? new Date(patched[5]).toISOString() : null,
        fix_note: String(patched[6] || '')
      };
      const { error } = await db.from('homework_manual_pending').upsert(payload, { onConflict: 'pending_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.BOOKS) {
      const payload = {
        textbook_id: String(patched[0]),
        class_id: String(patched[1]),
        name: String(patched[2] || ''),
        book_type: String(patched[3] || ''),
        unit_type: String(patched[4] || 'chapter'),
        total_units: toNum(patched[5], 0),
        start_date: patched[6] ? formatDate(patched[6]) : null,
        status: String(patched[7] || 'Active'),
        completed_at: patched[8] ? new Date(patched[8]).toISOString() : null
      };
      const { error } = await db.from('class_textbooks').upsert(payload, { onConflict: 'textbook_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.PROGRESS) {
      const payload = {
        record_date: formatDate(patched[0]),
        class_id: String(patched[1]),
        textbook_id: String(patched[2]),
        position: toNum(patched[3], 0)
      };
      const { error } = await db.from('textbook_progress').upsert(payload, {
        onConflict: 'record_date,class_id,textbook_id'
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.QUEUE) {
      const payload = {
        queue_id: String(patched[0]),
        class_id: String(patched[1]),
        sort_order: toNum(patched[2], 0),
        name: String(patched[3] || ''),
        book_type: String(patched[4] || ''),
        unit_type: String(patched[5] || 'chapter'),
        total_units: toNum(patched[6], 0),
        created_at: patched[7] ? new Date(patched[7]).toISOString() : null
      };
      const { error } = await db.from('textbook_queue').upsert(payload, { onConflict: 'queue_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === RULES_SHEET) {
      const payload = {
        class_id: String(patched[0]),
        rules: String(patched[1] || ''),
        updated_at: patched[2] ? new Date(patched[2]).toISOString() : null
      };
      const { error } = await db.from('class_rules').upsert(payload, { onConflict: 'class_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LIBRARY_SHEET) {
      const payload = {
        book_id: String(patched[0]),
        class_id: String(patched[1]),
        student_id: String(patched[2]),
        title: String(patched[3] || ''),
        status: String(patched[4] || 'Pending'),
        created_at: patched[5] ? new Date(patched[5]).toISOString() : null,
        returned_at: patched[6] ? new Date(patched[6]).toISOString() : null
      };
      const { error } = await db.from('library_books').upsert(payload, { onConflict: 'book_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === ANNOUNCE_SHEET) {
      const payload = {
        class_id: String(patched[0]),
        body: String(patched[1] || ''),
        updated_at: patched[2] ? new Date(patched[2]).toISOString() : null
      };
      const { error } = await db.from('class_announcements').upsert(payload, { onConflict: 'class_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === EVENTS_SHEET) {
      const payload = {
        event_id: String(patched[0]),
        class_id: String(patched[1]),
        event_date: formatDate(patched[2]),
        description: String(patched[3] || ''),
        created_at: patched[4] ? new Date(patched[4]).toISOString() : null
      };
      const { error } = await db.from('class_events').upsert(payload, { onConflict: 'event_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === VIDEO_SHEET) {
      const payload = {
        class_id: String(patched[0] || ''),
        video_url: String(patched[1] || ''),
        updated_at: patched[2] ? new Date(patched[2]).toISOString() : null
      };
      const { error } = await db.from('class_video').upsert(payload, { onConflict: 'class_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_DAILY_SHEET) {
      const payload = {
        record_date: formatDate(patched[0]),
        class_id: String(patched[1]),
        student_id: String(patched[2])
      };
      const { error } = await db.from('chambit_daily').upsert(payload, {
        onConflict: 'record_date,class_id,student_id'
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_COMBO_SHEET) {
      const payload = {
        student_id: String(patched[0]),
        combo_count: Math.max(0, Math.round(toNum(patched[1], 0))),
        updated_at: patched[2] ? new Date(patched[2]).toISOString() : null
      };
      const { error } = await db.from('chambit_combo').upsert(payload, { onConflict: 'student_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_WEEK_SHEET) {
      const payload = {
        student_id: String(patched[0]),
        week_key: String(patched[1]),
        awarded_at: patched[2] ? new Date(patched[2]).toISOString() : null
      };
      const { error } = await db.from('chambit_week_awards').upsert(payload, { onConflict: 'student_id,week_key' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_TIERS_SHEET) {
      const payload = {
        tier_id: String(patched[0]),
        tier_name: String(patched[1] || ''),
        weight: Math.max(0, toNum(patched[2], 0)),
        sort_order: toNum(patched[3], 0),
        active: isActiveFlag(patched[4])
      };
      if (!payload.tier_id) continue;
      const { error } = await db.from('lucky_draw_tiers').upsert(payload, { onConflict: 'tier_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_PRIZES_SHEET) {
      const payload = {
        tier_id: String(patched[0]),
        prize_text: String(patched[1] || ''),
        sort_order: toNum(patched[2], 0),
        active: isActiveFlag(patched[3])
      };
      if (!payload.tier_id) continue;
      const { error } = await db.from('lucky_draw_prizes').upsert(payload, {
        onConflict: 'tier_id,sort_order'
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_SHEET) {
      const payload = {
        ticket_id: String(patched[0]),
        class_id: String(patched[1]),
        student_id: String(patched[2]),
        tier: String(patched[3] || ''),
        prize_text: String(patched[4] || ''),
        drawn_at: patched[5] ? new Date(patched[5]).toISOString() : null
      };
      const { error } = await db.from('lucky_draw_tickets').upsert(payload, { onConflict: 'ticket_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === MAKEUP_SHEET) {
      const lessonTime = String(patched[5] || '').trim() + '-' + String(patched[6] || '').trim();
      const payload = {
        makeup_id: String(patched[0]),
        class_id: String(patched[1]),
        student_id: String(patched[2]),
        student_name: String(patched[3] || ''),
        lesson_date: formatDate(patched[4]),
        lesson_time: lessonTime,
        note: String(patched[8] || ''),
        status: String(patched[9] || 'Scheduled'),
        created_at: patched[10] ? new Date(patched[10]).toISOString() : null
      };
      const { error } = await db.from('makeup_lessons').upsert(payload, { onConflict: 'makeup_id' });
      if (error) throw new Error(error.message);
      continue;
    }

    throw new Error('Phase 3 Supabase updateRange not supported: ' + sheetName + ' ' + a1);
  }
}

async function deleteRows(sheetName, rowIndices1Based) {
  ensureSupports(sheetName);
  const db = getSupabase();
  if (!rowIndices1Based || !rowIndices1Based.length) return;
  const allRows = await getRows(sheetName);
  const sorted = [...rowIndices1Based].sort(function(a, b) { return b - a; });

  for (const rowIdx of sorted) {
    if (rowIdx === 1) continue;
    const dataRow = allRows[rowIdx - 1];
    if (!dataRow) continue;

    if (sheetName === STUDENT_LIST_SHEET) {
      throw new Error('Deleting rows is not supported for Student_List in Supabase mode.');
    }

    if (sheetName === STUDENT_WITHDRAWN_SHEET) {
      const { error } = await db.from('students_withdrawn').delete().eq('withdrawal_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === STUDENT_LEAVE_SHEET) {
      const { error } = await db.from('student_leaves').delete().eq('leave_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === STUDENT_PLANNED_ATTENDANCE_SHEET) {
      const { error } = await db.from('student_planned_attendance').delete().eq('notice_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === MANUAL_PENDING_SHEET) {
      const { error } = await db.from('homework_manual_pending').delete().eq('pending_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.BOOKS) {
      const { error } = await db.from('class_textbooks').delete().eq('textbook_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.PROGRESS) {
      const { error } = await db.from('textbook_progress').delete().match({
        record_date: formatDate(dataRow[0]),
        class_id: String(dataRow[1]),
        textbook_id: String(dataRow[2])
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === TEXTBOOK_SHEETS.QUEUE) {
      const { error } = await db.from('textbook_queue').delete().eq('queue_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === RULES_SHEET) {
      const { error } = await db.from('class_rules').delete().eq('class_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LIBRARY_SHEET) {
      const { error } = await db.from('library_books').delete().eq('book_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === ANNOUNCE_SHEET) {
      const { error } = await db.from('class_announcements').delete().eq('class_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === EVENTS_SHEET) {
      const { error } = await db.from('class_events').delete().eq('event_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === VIDEO_SHEET) {
      const { error } = await db.from('class_video').delete().eq('class_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_DAILY_SHEET) {
      const { error } = await db.from('chambit_daily').delete().match({
        record_date: formatDate(dataRow[0]),
        class_id: String(dataRow[1]),
        student_id: String(dataRow[2])
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_COMBO_SHEET) {
      const { error } = await db.from('chambit_combo').delete().eq('student_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === CHAMBIT_WEEK_SHEET) {
      const { error } = await db.from('chambit_week_awards').delete().match({
        student_id: String(dataRow[0]),
        week_key: String(dataRow[1])
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_TIERS_SHEET) {
      const { error } = await db.from('lucky_draw_tiers').delete().eq('tier_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_PRIZES_SHEET) {
      const { error } = await db.from('lucky_draw_prizes').delete().match({
        tier_id: String(dataRow[0]),
        sort_order: toNum(dataRow[2], 0)
      });
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === LUCKY_DRAW_SHEET) {
      const { error } = await db.from('lucky_draw_tickets').delete().eq('ticket_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    if (sheetName === MAKEUP_SHEET) {
      const { error } = await db.from('makeup_lessons').delete().eq('makeup_id', String(dataRow[0]));
      if (error) throw new Error(error.message);
      continue;
    }

    throw new Error('Phase 3 Supabase deleteRows not supported for sheet: ' + sheetName);
  }
}

module.exports = {
  PHASE3_SHEETS,
  getRows,
  appendRows,
  updateRange,
  deleteRows
};
