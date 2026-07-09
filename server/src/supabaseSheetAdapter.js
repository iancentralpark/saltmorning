/**
 * Routes migrated Google Sheet tabs to Supabase when SUPABASE_* env is set.
 * Returns sheet-shaped row arrays (header row + data) for drop-in compatibility.
 */
const { getSupabase, isSupabaseEnabled } = require('./supabaseClient');
const { queryStudents } = require('./supabaseStudentColumns');
const phase3 = require('./supabaseSheetAdapterPhase3');
const {
  DOLLAR_SHEETS,
  HOMEWORK_SHEETS,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  ATTENDANCE_SHEET
} = require('./config');

const MIGRATED_SHEETS = new Set([
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  ATTENDANCE_SHEET,
  DOLLAR_SHEETS.BALANCES,
  DOLLAR_SHEETS.TRANSACTIONS,
  HOMEWORK_SHEETS.MAP,
  HOMEWORK_SHEETS.LOG,
  HOMEWORK_SHEETS.ITEMS,
  HOMEWORK_SHEETS.COMPLETION
]);

const HEADERS = {
  [CLASS_LIST_SHEET]: ['ClassID', 'Name', 'ScheduleType', 'AllowedDays'],
  [STUDENT_LIST_SHEET]: ['StudentID', 'Name', 'ClassID', 'Status', 'LoginID', 'LoginPassword'],
  [ATTENDANCE_SHEET]: ['Date', 'ClassID', 'StudentID', 'Attendance', 'VocabScore'],
  [DOLLAR_SHEETS.BALANCES]: ['StudentID', 'Balance'],
  [DOLLAR_SHEETS.TRANSACTIONS]: ['Timestamp', 'ClassID', 'StudentID', 'Amount', 'NewBalance', 'Reason'],
  [HOMEWORK_SHEETS.MAP]: ['ClassID', 'CourseID', 'CourseName'],
  [HOMEWORK_SHEETS.LOG]: ['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt'],
  [HOMEWORK_SHEETS.ITEMS]: ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs'],
  [HOMEWORK_SHEETS.COMPLETION]: ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote']
};

function usesSupabaseSheet(sheetName) {
  if (!isSupabaseEnabled()) return false;
  return MIGRATED_SHEETS.has(sheetName) || phase3.PHASE3_SHEETS.has(sheetName);
}

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
    endCol: colToIndex(m[4] || m[1]),
    endRow: Number(m[5] || m[2])
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

async function getRows(sheetName) {
  if (isSupabaseEnabled() && phase3.PHASE3_SHEETS.has(sheetName)) {
    return phase3.getRows(sheetName);
  }

  const db = getSupabase();
  const header = HEADERS[sheetName];

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
    const data = await queryStudents(db, { orderBy: 'name' });
    const rows = [header];
    data.forEach(function(r) {
      rows.push([r.id, r.name, r.class_id, r.status, r.login_id, r.login_password || '']);
    });
    return rows;
  }

  if (sheetName === ATTENDANCE_SHEET) {
    const { data, error } = await db
      .from('attendance_records')
      .select('record_date, class_id, student_id, attendance, vocab_score')
      .order('record_date')
      .order('class_id')
      .order('student_id');
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
    const { data, error } = await db.from('dollar_balances').select('student_id, balance').order('student_id');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([r.student_id, r.balance]);
    });
    return rows;
  }

  if (sheetName === DOLLAR_SHEETS.TRANSACTIONS) {
    const { data, error } = await db
      .from('dollar_transactions')
      .select('created_at, class_id, student_id, amount, new_balance, reason')
      .order('created_at');
    if (error) throw new Error(error.message);
    const rows = [header];
    (data || []).forEach(function(r) {
      rows.push([
        r.created_at ? new Date(r.created_at).toISOString() : '',
        r.class_id || '',
        r.student_id,
        r.amount,
        r.new_balance,
        r.reason || ''
      ]);
    });
    return rows;
  }

  if (sheetName === HOMEWORK_SHEETS.MAP) {
    const { data, error } = await db.from('classroom_map').select('class_id, course_id, course_name').order('class_id');
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
    const { data, error } = await db
      .from('homework_items')
      .select('item_id, homework_id, sort_order, title, description, target_student_ids')
      .order('homework_id')
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = [header];
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
    const { data, error } = await db
      .from('homework_completion')
      .select('item_id, student_id, completed, completed_at, fix_note')
      .order('item_id')
      .order('student_id');
    if (error) throw new Error(error.message);
    const rows = [header];
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

  throw new Error('No Supabase adapter for sheet: ' + sheetName);
}

async function appendRows(sheetName, rows) {
  if (isSupabaseEnabled() && phase3.PHASE3_SHEETS.has(sheetName)) {
    return phase3.appendRows(sheetName, rows);
  }

  const db = getSupabase();
  if (!rows || !rows.length) return;

  if (sheetName === ATTENDANCE_SHEET) {
    const payload = rows.map(function(row) {
      return {
        record_date: formatDate(row[0]),
        class_id: String(row[1]),
        student_id: String(row[2]),
        attendance: String(row[3] || ''),
        vocab_score: row[4] === '' || row[4] == null ? null : Number(row[4])
      };
    });
    const { error } = await db.from('attendance_records').upsert(payload, {
      onConflict: 'record_date,class_id,student_id'
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === DOLLAR_SHEETS.BALANCES) {
    const payload = rows.map(function(row) {
      return { student_id: String(row[0]), balance: Number(row[1]) || 0 };
    });
    const { error } = await db.from('dollar_balances').upsert(payload, { onConflict: 'student_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === DOLLAR_SHEETS.TRANSACTIONS) {
    const payload = rows.map(function(row) {
      return {
        created_at: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString(),
        class_id: row[1] ? String(row[1]) : null,
        student_id: String(row[2]),
        amount: Number(row[3]) || 0,
        new_balance: Number(row[4]) || 0,
        reason: String(row[5] || '')
      };
    });
    const { error } = await db.from('dollar_transactions').insert(payload);
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.MAP) {
    const payload = rows.map(function(row) {
      return {
        class_id: String(row[0]),
        course_id: String(row[1] || ''),
        course_name: String(row[2] || '')
      };
    });
    const { error } = await db.from('classroom_map').upsert(payload, { onConflict: 'class_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.LOG) {
    const payload = rows.map(function(row) {
      return {
        homework_id: String(row[0]),
        class_id: String(row[1]),
        assigned_date: formatDate(row[2]),
        title: String(row[3] || ''),
        description: String(row[4] || ''),
        classroom_work_id: String(row[5] || ''),
        posted_at: row[6] ? new Date(row[6]).toISOString() : null
      };
    });
    const { error } = await db.from('homework_log').upsert(payload, { onConflict: 'homework_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.ITEMS) {
    const payload = rows.map(function(row) {
      return {
        item_id: String(row[0]),
        homework_id: String(row[1]),
        sort_order: Number(row[2]) || 0,
        title: String(row[3] || ''),
        description: String(row[4] || ''),
        target_student_ids: String(row[5] || '')
      };
    });
    const { error } = await db.from('homework_items').upsert(payload, { onConflict: 'item_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.COMPLETION) {
    const payload = rows.map(function(row) {
      return {
        item_id: String(row[0]),
        student_id: String(row[1]),
        completed: sheetBool(row[2]),
        completed_at: row[3] ? new Date(row[3]).toISOString() : null,
        fix_note: String(row[4] || '')
      };
    });
    const { error } = await db.from('homework_completion').upsert(payload, {
      onConflict: 'item_id,student_id'
    });
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error('Supabase append not supported for sheet: ' + sheetName);
}

async function updateRange(sheetName, a1, values) {
  if (isSupabaseEnabled() && phase3.PHASE3_SHEETS.has(sheetName)) {
    return phase3.updateRange(sheetName, a1, values);
  }

  const db = getSupabase();
  const range = parseA1Range(a1);
  const rowValues = values[0] || [];
  const allRows = await getRows(sheetName);
  const dataRow = allRows[range.startRow - 1];
  if (!dataRow) throw new Error('Row not found: ' + a1);

  if (sheetName === ATTENDANCE_SHEET) {
    const patch = {
      attendance: dataRow[3],
      vocab_score: dataRow[4] === '' ? null : Number(dataRow[4])
    };
    for (let c = range.startCol; c <= range.endCol; c++) {
      const v = rowValues[c - range.startCol];
      if (c === 3) patch.attendance = String(v);
      if (c === 4) patch.vocab_score = v === '' || v == null ? null : Number(v);
    }
    const { error } = await db.from('attendance_records').update(patch).match({
      record_date: formatDate(dataRow[0]),
      class_id: String(dataRow[1]),
      student_id: String(dataRow[2])
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === DOLLAR_SHEETS.BALANCES) {
    const balance = range.startCol === 1 ? Number(rowValues[0]) : Number(dataRow[1]);
    const { error } = await db.from('dollar_balances').upsert({
      student_id: String(dataRow[0]),
      balance: balance
    }, { onConflict: 'student_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.MAP) {
    const patch = {
      class_id: String(dataRow[0]),
      course_id: String(dataRow[1] || ''),
      course_name: String(dataRow[2] || '')
    };
    const cols = ['class_id', 'course_id', 'course_name'];
    for (let c = range.startCol; c <= range.endCol; c++) {
      patch[cols[c]] = String(rowValues[c - range.startCol] || '');
    }
    const { error } = await db.from('classroom_map').upsert(patch, { onConflict: 'class_id' });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.LOG) {
    const patch = {};
    const cols = ['homework_id', 'class_id', 'assigned_date', 'title', 'description', 'classroom_work_id', 'posted_at'];
    for (let c = range.startCol; c <= range.endCol; c++) {
      const key = cols[c];
      let v = rowValues[c - range.startCol];
      if (key === 'assigned_date') v = formatDate(v);
      if (key === 'posted_at') v = v ? new Date(v).toISOString() : null;
      patch[key] = v;
    }
    const { error } = await db.from('homework_log').update(patch).eq('homework_id', String(dataRow[0]));
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.COMPLETION) {
    const patch = {};
    for (let c = range.startCol; c <= range.endCol; c++) {
      const v = rowValues[c - range.startCol];
      if (c === 2) patch.completed = sheetBool(v);
      else if (c === 3) patch.completed_at = v ? new Date(v).toISOString() : null;
      else if (c === 4) patch.fix_note = String(v || '');
    }
    const { error } = await db.from('homework_completion').update(patch).match({
      item_id: String(dataRow[0]),
      student_id: String(dataRow[1])
    });
    if (error) throw new Error(error.message);
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.ITEMS && range.startRow === 1) {
    return;
  }

  throw new Error('Supabase updateRange not supported: ' + sheetName + ' ' + a1);
}

async function deleteRows(sheetName, rowIndices1Based) {
  if (isSupabaseEnabled() && phase3.PHASE3_SHEETS.has(sheetName)) {
    return phase3.deleteRows(sheetName, rowIndices1Based);
  }

  const db = getSupabase();
  if (!rowIndices1Based.length) return;
  const allRows = await getRows(sheetName);
  const sorted = [...rowIndices1Based].sort(function(a, b) { return b - a; });

  if (sheetName === ATTENDANCE_SHEET) {
    for (const row of sorted) {
      const dataRow = allRows[row - 1];
      if (!dataRow || row === 1) continue;
      const { error } = await db.from('attendance_records').delete().match({
        record_date: formatDate(dataRow[0]),
        class_id: String(dataRow[1]),
        student_id: String(dataRow[2])
      });
      if (error) throw new Error(error.message);
    }
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.ITEMS) {
    const ids = sorted.map(function(row) {
      const dataRow = allRows[row - 1];
      return dataRow ? String(dataRow[0]) : '';
    }).filter(Boolean);
    if (ids.length) {
      const { error } = await db.from('homework_items').delete().in('item_id', ids);
      if (error) throw new Error(error.message);
    }
    return;
  }

  if (sheetName === HOMEWORK_SHEETS.COMPLETION) {
    for (const row of sorted) {
      const dataRow = allRows[row - 1];
      if (!dataRow || row === 1) continue;
      const { error } = await db.from('homework_completion').delete().match({
        item_id: String(dataRow[0]),
        student_id: String(dataRow[1])
      });
      if (error) throw new Error(error.message);
    }
    return;
  }

  throw new Error('Supabase deleteRows not supported for sheet: ' + sheetName);
}

module.exports = {
  usesSupabaseSheet,
  getRows,
  appendRows,
  updateRange,
  deleteRows,
  MIGRATED_SHEETS,
  PHASE3_SHEETS: phase3.PHASE3_SHEETS
};
