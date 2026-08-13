const crypto = require('crypto');
const {
  BUSES_SHEET,
  BUS_RUNS_SHEET,
  BUS_ASSIGNMENTS_SHEET,
  BUS_DUTY_SHEET,
  BUS_DUTY_DAILY_SHEET,
  BUS_OVERRIDES_SHEET,
  BUS_CHANGE_LOG_SHEET,
  BUS_NOSHOWS_SHEET,
  STUDENT_LIST_SHEET,
  STUDENT_PROFILE_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { formatSheetDate, todayStr, formatDateTimeNow } = require('../dateUtils');
const { TIMEZONE } = require('../config');
const { isOpsDbEnabled, table, query } = require('../db/pool');

const BUS_HEADERS = [
  'BusID', 'Name', 'DriverName', 'DriverPhone', 'VehiclePlate', 'VehicleInfo',
  'Active', 'Notes', 'UpdatedAt'
];
const RUN_HEADERS = [
  'RunID', 'BusID', 'RunType', 'Label', 'StartTime', 'SortOrder', 'Active', 'UpdatedAt'
];
const ASSIGN_HEADERS = [
  'AssignmentID', 'StudentID', 'RunID', 'Days', 'Active', 'UpdatedAt'
];
const DUTY_HEADERS = [
  'DutyID', 'RunID', 'TeacherID', 'Days', 'Active', 'UpdatedAt'
];
const DUTY_DAILY_HEADERS = [
  'DutyDailyID', 'Date', 'RunID', 'TeacherID', 'Active', 'UpdatedAt', 'ActorRole', 'ActorId'
];
const OVERRIDE_HEADERS = [
  'OverrideID', 'Date', 'RunID', 'StudentID', 'Action', 'Reason', 'Source',
  'ActorRole', 'ActorId', 'CreatedAt'
];
const LOG_HEADERS = [
  'LogID', 'Date', 'RunID', 'StudentID', 'Action', 'Detail',
  'ActorRole', 'ActorId', 'CreatedAt'
];
const NOSHOW_HEADERS = [
  'NoShowID', 'Date', 'RunID', 'StudentID', 'Note', 'ReportedBy', 'CreatedAt'
];

const RUN_PICKUP = 'pickup';
const RUN_DISMISSAL = 'dismissal';

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function parseDays(raw) {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => n >= 1 && n <= 5);
  }
  const s = String(raw || '').trim();
  if (!s) return [1, 2, 3, 4, 5];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parseDays(parsed);
  } catch (_) { /* csv */ }
  return s.split(/[,|]/).map((n) => Number(String(n).trim())).filter((n) => n >= 1 && n <= 5);
}

function serializeDays(days) {
  const list = parseDays(days);
  return JSON.stringify(list.length ? list : [1, 2, 3, 4, 5]);
}

function parseBool(val, fallback) {
  if (val == null || val === '') return fallback;
  const s = String(val).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return fallback;
}

function dowOf(dateStr) {
  return new Date(String(dateStr).slice(0, 10) + 'T12:00:00').getDay(); // 0 Sun .. 6 Sat
}

async function ensureBusSheets() {
  await Promise.all([
    ensureSheet(BUSES_SHEET, BUS_HEADERS),
    ensureSheet(BUS_RUNS_SHEET, RUN_HEADERS),
    ensureSheet(BUS_ASSIGNMENTS_SHEET, ASSIGN_HEADERS),
    ensureSheet(BUS_DUTY_SHEET, DUTY_HEADERS),
    ensureSheet(BUS_DUTY_DAILY_SHEET, DUTY_DAILY_HEADERS),
    ensureSheet(BUS_OVERRIDES_SHEET, OVERRIDE_HEADERS),
    ensureSheet(BUS_CHANGE_LOG_SHEET, LOG_HEADERS),
    ensureSheet(BUS_NOSHOWS_SHEET, NOSHOW_HEADERS)
  ]);
}

function parseBus(row, rowIndex) {
  return {
    busId: String(row[0] || ''),
    name: String(row[1] || ''),
    driverName: String(row[2] || ''),
    driverPhone: String(row[3] || ''),
    vehiclePlate: String(row[4] || ''),
    vehicleInfo: String(row[5] || ''),
    active: parseBool(row[6], true),
    notes: String(row[7] || ''),
    updatedAt: String(row[8] || ''),
    _row: rowIndex
  };
}

function parseRun(row, rowIndex) {
  return {
    runId: String(row[0] || ''),
    busId: String(row[1] || ''),
    runType: String(row[2] || RUN_PICKUP).toLowerCase() === RUN_DISMISSAL ? RUN_DISMISSAL : RUN_PICKUP,
    label: String(row[3] || ''),
    startTime: String(row[4] || '').slice(0, 5),
    sortOrder: Number(row[5]) || 0,
    active: parseBool(row[6], true),
    updatedAt: String(row[7] || ''),
    _row: rowIndex
  };
}

function parseAssign(row, rowIndex) {
  return {
    assignmentId: String(row[0] || ''),
    studentId: String(row[1] || ''),
    runId: String(row[2] || ''),
    days: parseDays(row[3]),
    active: parseBool(row[4], true),
    updatedAt: String(row[5] || ''),
    _row: rowIndex
  };
}

function parseDuty(row, rowIndex) {
  return {
    dutyId: String(row[0] || ''),
    runId: String(row[1] || ''),
    teacherId: String(row[2] || ''),
    days: parseDays(row[3]),
    active: parseBool(row[4], true),
    updatedAt: String(row[5] || ''),
    _row: rowIndex
  };
}

function parseDutyDaily(row, rowIndex) {
  return {
    dutyDailyId: String(row[0] || ''),
    dateStr: formatSheetDate(row[1]),
    runId: String(row[2] || ''),
    teacherId: String(row[3] || ''),
    active: parseBool(row[4], true),
    updatedAt: String(row[5] || ''),
    actorRole: String(row[6] || ''),
    actorId: String(row[7] || ''),
    _row: rowIndex
  };
}

async function listBuses({ includeInactive } = {}) {
  await ensureBusSheets();
  const rows = await getSheetRows(BUSES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const b = parseBus(rows[i], i + 1);
    if (!includeInactive && !b.active) continue;
    out.push(b);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function saveBus(payload) {
  await ensureBusSheets();
  const busId = String(payload.busId || '').trim() || newId('bus');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Bus name is required.');
  const now = formatDateTimeNow(TIMEZONE);
  const row = [
    busId,
    name,
    String(payload.driverName || '').trim(),
    String(payload.driverPhone || '').trim(),
    String(payload.vehiclePlate || '').trim(),
    String(payload.vehicleInfo || '').trim(),
    payload.active === false ? 'FALSE' : 'TRUE',
    String(payload.notes || '').trim(),
    now
  ];
  const rows = await getSheetRows(BUSES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === busId) {
      await updateRange(BUSES_SHEET, `A${i + 1}:I${i + 1}`, [row]);
      return parseBus(row, i + 1);
    }
  }
  await appendRows(BUSES_SHEET, [row]);
  return parseBus(row, null);
}

async function listRuns({ busId, includeInactive } = {}) {
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_RUNS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const r = parseRun(rows[i], i + 1);
    if (busId && r.busId !== String(busId)) continue;
    if (!includeInactive && !r.active) continue;
    out.push(r);
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime));
  return out;
}

async function saveRun(payload) {
  await ensureBusSheets();
  const busId = String(payload.busId || '').trim();
  if (!busId) throw new Error('Bus is required.');
  const runType = String(payload.runType || RUN_PICKUP).toLowerCase() === RUN_DISMISSAL
    ? RUN_DISMISSAL
    : RUN_PICKUP;
  let startTime = String(payload.startTime || '').trim().slice(0, 5);
  if (runType === RUN_PICKUP && !/^\d{2}:\d{2}$/.test(startTime)) {
    startTime = '08:00'; // Morning pickup has no staggered times — shared boarding window
  }
  if (!/^\d{2}:\d{2}$/.test(startTime)) throw new Error('Start time is required (HH:MM).');
  const runId = String(payload.runId || '').trim() || newId('run');
  const label = String(payload.label || '').trim() ||
    (runType === RUN_PICKUP ? '등교' : ('하교 ' + startTime));
  const now = formatDateTimeNow(TIMEZONE);
  const row = [
    runId,
    busId,
    runType,
    label,
    startTime,
    Number(payload.sortOrder) || (runType === RUN_PICKUP ? 10 : 50),
    payload.active === false ? 'FALSE' : 'TRUE',
    now
  ];
  const rows = await getSheetRows(BUS_RUNS_SHEET, { skipCache: true });
  // Update by runId, or reuse existing bus+type(+time for dismissal) row
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === runId) {
      await updateRange(BUS_RUNS_SHEET, `A${i + 1}:H${i + 1}`, [row]);
      return parseRun(row, i + 1);
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (!parseBool(rows[i][6], true)) continue;
    if (String(rows[i][1]) !== busId) continue;
    if (String(rows[i][2] || '').toLowerCase() !== runType) continue;
    if (runType === RUN_DISMISSAL && String(rows[i][4] || '').slice(0, 5) !== startTime) continue;
    row[0] = String(rows[i][0]) || runId;
    await updateRange(BUS_RUNS_SHEET, `A${i + 1}:H${i + 1}`, [row]);
    return parseRun(row, i + 1);
  }
  await appendRows(BUS_RUNS_SHEET, [row]);
  return parseRun(row, null);
}

async function listAssignments({ runId, studentId, includeInactive } = {}) {
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_ASSIGNMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const a = parseAssign(rows[i], i + 1);
    if (runId && a.runId !== String(runId)) continue;
    if (studentId && a.studentId !== String(studentId)) continue;
    if (!includeInactive && !a.active) continue;
    out.push(a);
  }
  return out;
}

async function saveAssignment(payload) {
  await ensureBusSheets();
  const studentId = String(payload.studentId || '').trim();
  const runId = String(payload.runId || '').trim();
  if (!studentId || !runId) throw new Error('Student and run are required.');
  const days = parseDays(payload.days);
  const assignmentId = String(payload.assignmentId || '').trim() || newId('bas');
  const now = formatDateTimeNow(TIMEZONE);
  const row = [
    assignmentId,
    studentId,
    runId,
    serializeDays(days),
    payload.active === false ? 'FALSE' : 'TRUE',
    now
  ];
  const rows = await getSheetRows(BUS_ASSIGNMENTS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === assignmentId ||
      (String(rows[i][1]) === studentId && String(rows[i][2]) === runId && parseBool(rows[i][4], true))) {
      row[0] = String(rows[i][0]) || assignmentId;
      await updateRange(BUS_ASSIGNMENTS_SHEET, `A${i + 1}:F${i + 1}`, [row]);
      return parseAssign(row, i + 1);
    }
  }
  await appendRows(BUS_ASSIGNMENTS_SHEET, [row]);
  return parseAssign(row, null);
}

async function deleteAssignment(assignmentId) {
  await ensureBusSheets();
  assignmentId = String(assignmentId || '').trim();
  const rows = await getSheetRows(BUS_ASSIGNMENTS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== assignmentId) continue;
    const row = rows[i].slice();
    row[4] = 'FALSE';
    row[5] = formatDateTimeNow(TIMEZONE);
    await updateRange(BUS_ASSIGNMENTS_SHEET, `A${i + 1}:F${i + 1}`, [row]);
    return { deleted: true };
  }
  throw new Error('Assignment not found.');
}

async function listDuty({ runId, teacherId, includeInactive } = {}) {
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_DUTY_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const d = parseDuty(rows[i], i + 1);
    if (runId && d.runId !== String(runId)) continue;
    if (teacherId && d.teacherId !== String(teacherId)) continue;
    if (!includeInactive && !d.active) continue;
    out.push(d);
  }
  return out;
}

async function saveDuty(payload) {
  await ensureBusSheets();
  const runId = String(payload.runId || '').trim();
  const teacherId = String(payload.teacherId || '').trim();
  if (!runId || !teacherId) throw new Error('Run and teacher are required.');
  const dutyId = String(payload.dutyId || '').trim() || newId('duty');
  const now = formatDateTimeNow(TIMEZONE);
  const row = [
    dutyId,
    runId,
    teacherId,
    serializeDays(payload.days),
    payload.active === false ? 'FALSE' : 'TRUE',
    now
  ];
  const rows = await getSheetRows(BUS_DUTY_SHEET, { skipCache: true });
  // Deactivate other active teachers on this run when replacing semester duty
  if (payload.active !== false) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) !== runId) continue;
      if (!parseBool(rows[i][4], true)) continue;
      if (String(rows[i][2]) === teacherId) continue;
      const old = rows[i].slice();
      old[4] = 'FALSE';
      old[5] = now;
      await updateRange(BUS_DUTY_SHEET, `A${i + 1}:F${i + 1}`, [old]);
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === dutyId ||
      (String(rows[i][1]) === runId && String(rows[i][2]) === teacherId)) {
      row[0] = String(rows[i][0]) || dutyId;
      await updateRange(BUS_DUTY_SHEET, `A${i + 1}:F${i + 1}`, [row]);
      invalidateSheetRowsCache(BUS_DUTY_SHEET);
      return parseDuty(row, i + 1);
    }
  }
  await appendRows(BUS_DUTY_SHEET, [row]);
  invalidateSheetRowsCache(BUS_DUTY_SHEET);
  return parseDuty(row, null);
}

async function listDutyDailyForDate(dateStr) {
  dateStr = formatSheetDate(dateStr);
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT id, duty_date, run_id, teacher_id, active, updated_at, actor_role, actor_id FROM ' +
        table('bus_duty_daily') +
        ' WHERE duty_date = $1::date AND active = TRUE AND teacher_id <> \'\'',
      [dateStr]
    );
    return r.rows.map((row) => ({
      dutyDailyId: String(row.id),
      dateStr,
      runId: String(row.run_id),
      teacherId: String(row.teacher_id),
      active: true,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
      actorRole: String(row.actor_role || ''),
      actorId: String(row.actor_id || '')
    }));
  }
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_DUTY_DAILY_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const d = parseDutyDaily(rows[i], i + 1);
    if (d.dateStr !== dateStr || !d.active) continue;
    out.push(d);
  }
  return out;
}

/**
 * Same-day duty substitute (or clear). Does not change semester Bus_Duty.
 * Empty teacherId clears the daily override and falls back to semester duty.
 */
async function saveDutyDaily(payload, actor) {
  const dateStr = formatSheetDate(payload.dateStr || payload.date || todayStr());
  const runId = String(payload.runId || '').trim();
  const teacherId = String(payload.teacherId || '').trim();
  if (!runId) throw new Error('Run is required.');

  if (isOpsDbEnabled()) {
    if (!teacherId) {
      await query(
        'UPDATE ' + table('bus_duty_daily') +
          ' SET active = FALSE, teacher_id = \'\', updated_at = now() WHERE duty_date = $1::date AND run_id = $2',
        [dateStr, runId]
      );
      await appendChangeLog({
        dateStr, runId, studentId: '', action: 'duty_daily_clear',
        detail: 'Cleared same-day duty substitute',
        actorRole: actor && actor.role, actorId: actor && actor.id
      });
      return { dateStr, runId, teacherId: '', cleared: true };
    }
    await query(
      'INSERT INTO ' + table('bus_duty_daily') +
        ' (duty_date, run_id, teacher_id, active, actor_role, actor_id, updated_at)' +
        ' VALUES ($1::date, $2, $3, TRUE, $4, $5, now())' +
        ' ON CONFLICT (duty_date, run_id) DO UPDATE SET' +
        ' teacher_id = EXCLUDED.teacher_id, active = TRUE,' +
        ' actor_role = EXCLUDED.actor_role, actor_id = EXCLUDED.actor_id, updated_at = now()',
      [dateStr, runId, teacherId, actor && actor.role || '', actor && actor.id || '']
    );
    await appendChangeLog({
      dateStr, runId, studentId: '', action: 'duty_daily',
      detail: 'Same-day duty → ' + teacherId,
      actorRole: actor && actor.role, actorId: actor && actor.id
    });
    return { dateStr, runId, teacherId, cleared: false };
  }

  await ensureBusSheets();
  const now = formatDateTimeNow(TIMEZONE);
  const rows = await getSheetRows(BUS_DUTY_DAILY_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (formatSheetDate(rows[i][1]) !== dateStr) continue;
    if (String(rows[i][2]) !== runId) continue;
    if (!parseBool(rows[i][4], true)) continue;
    const old = rows[i].slice();
    while (old.length < 8) old.push('');
    old[4] = 'FALSE';
    old[5] = now;
    await updateRange(BUS_DUTY_DAILY_SHEET, `A${i + 1}:H${i + 1}`, [old]);
  }
  if (!teacherId) {
    invalidateSheetRowsCache(BUS_DUTY_DAILY_SHEET);
    await appendChangeLog({
      dateStr, runId, studentId: '', action: 'duty_daily_clear',
      detail: 'Cleared same-day duty substitute',
      actorRole: actor && actor.role, actorId: actor && actor.id
    });
    return { dateStr, runId, teacherId: '', cleared: true };
  }
  const row = [
    newId('dduty'), dateStr, runId, teacherId, 'TRUE', now,
    actor && actor.role || '', actor && actor.id || ''
  ];
  await appendRows(BUS_DUTY_DAILY_SHEET, [row]);
  invalidateSheetRowsCache(BUS_DUTY_DAILY_SHEET);
  await appendChangeLog({
    dateStr, runId, studentId: '', action: 'duty_daily',
    detail: 'Same-day duty → ' + teacherId,
    actorRole: actor && actor.role, actorId: actor && actor.id
  });
  return parseDutyDaily(row, null);
}

async function appendChangeLog({ dateStr, runId, studentId, action, detail, actorRole, actorId }) {
  const logId = newId('blog');
  const createdAt = formatDateTimeNow(TIMEZONE);
  const d = formatSheetDate(dateStr);
  if (isOpsDbEnabled()) {
    await query(
      'INSERT INTO ' + table('bus_change_log') +
        ' (log_id, log_date, run_id, student_id, action, detail, actor_role, actor_id, created_at)' +
        ' VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9::timestamptz)',
      [
        logId, d, String(runId || ''), String(studentId || ''),
        String(action || ''), String(detail || ''),
        String(actorRole || ''), String(actorId || ''), createdAt
      ]
    );
    return [logId, d, runId, studentId, action, detail, actorRole, actorId, createdAt];
  }
  await ensureBusSheets();
  const row = [
    logId, d, String(runId || ''), String(studentId || ''),
    String(action || ''), String(detail || ''),
    String(actorRole || ''), String(actorId || ''), createdAt
  ];
  await appendRows(BUS_CHANGE_LOG_SHEET, [row]);
  return row;
}

async function listChangeLog({ dateStr, runId, limit } = {}) {
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_CHANGE_LOG_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const date = formatSheetDate(rows[i][1]);
    if (dateStr && date !== formatSheetDate(dateStr)) continue;
    if (runId && String(rows[i][2]) !== String(runId)) continue;
    out.push({
      logId: String(rows[i][0]),
      dateStr: date,
      runId: String(rows[i][2] || ''),
      studentId: String(rows[i][3] || ''),
      action: String(rows[i][4] || ''),
      detail: String(rows[i][5] || ''),
      actorRole: String(rows[i][6] || ''),
      actorId: String(rows[i][7] || ''),
      createdAt: String(rows[i][8] || '')
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

async function saveOverride(payload, actor) {
  await ensureBusSheets();
  const dateStr = formatSheetDate(payload.dateStr || payload.date);
  const runId = String(payload.runId || '').trim();
  const studentId = String(payload.studentId || '').trim();
  const action = String(payload.action || '').trim().toLowerCase(); // exclude | include
  if (!dateStr || !runId || !studentId) throw new Error('Date, run, and student are required.');
  if (action !== 'exclude' && action !== 'include') throw new Error('Action must be exclude or include.');
  const reason = String(payload.reason || '').trim();
  const source = String(payload.source || 'manual').trim();
  const row = [
    newId('bov'),
    dateStr,
    runId,
    studentId,
    action,
    reason,
    source,
    actor && actor.role || '',
    actor && actor.id || '',
    formatDateTimeNow(TIMEZONE)
  ];
  await appendRows(BUS_OVERRIDES_SHEET, [row]);
  await appendChangeLog({
    dateStr,
    runId,
    studentId,
    action: 'override_' + action,
    detail: reason || source,
    actorRole: actor && actor.role,
    actorId: actor && actor.id
  });
  return {
    overrideId: row[0],
    dateStr,
    runId,
    studentId,
    action,
    reason,
    source
  };
}

async function listOverridesForDate(dateStr) {
  await ensureBusSheets();
  dateStr = formatSheetDate(dateStr);
  const rows = await getSheetRows(BUS_OVERRIDES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (formatSheetDate(rows[i][1]) !== dateStr) continue;
    out.push({
      overrideId: String(rows[i][0]),
      dateStr,
      runId: String(rows[i][2] || ''),
      studentId: String(rows[i][3] || ''),
      action: String(rows[i][4] || ''),
      reason: String(rows[i][5] || ''),
      source: String(rows[i][6] || ''),
      createdAt: String(rows[i][9] || '')
    });
  }
  return out;
}

async function reportNoShow(payload, actor) {
  const dateStr = formatSheetDate(payload.dateStr || payload.date || todayStr());
  const runId = String(payload.runId || '').trim();
  const studentId = String(payload.studentId || '').trim();
  if (!runId || !studentId) throw new Error('Run and student are required.');

  const runs = await listRuns({ includeInactive: true });
  const run = runs.find((r) => r.runId === runId);
  if (!run) throw new Error('Run not found.');
  if (run.runType !== RUN_PICKUP) {
    throw new Error('No-show can only be recorded for morning pickup runs.');
  }

  const existing = (await listNoShowsForDate(dateStr)).find(
    (n) => n.runId === runId && n.studentId === studentId
  );
  if (existing) return existing;

  const note = String(payload.note || '').trim();
  const noShowId = newId('bns');
  const createdAt = formatDateTimeNow(TIMEZONE);

  if (isOpsDbEnabled()) {
    await query(
      'INSERT INTO ' + table('bus_noshows') +
        ' (noshow_id, noshow_date, run_id, student_id, note, reported_by, created_at)' +
        ' VALUES ($1, $2::date, $3, $4, $5, $6, $7::timestamptz)',
      [noShowId, dateStr, runId, studentId, note, actor && actor.id || '', createdAt]
    );
  } else {
    await ensureBusSheets();
    await appendRows(BUS_NOSHOWS_SHEET, [[
      noShowId, dateStr, runId, studentId, note, actor && actor.id || '', createdAt
    ]]);
    invalidateSheetRowsCache(BUS_NOSHOWS_SHEET);
  }
  await appendChangeLog({
    dateStr,
    runId,
    studentId,
    action: 'no_show',
    detail: note || 'Reported missing at boarding',
    actorRole: actor && actor.role,
    actorId: actor && actor.id
  });
  return { noShowId, dateStr, runId, studentId, note };
}

async function cancelNoShow(payload, actor) {
  const dateStr = formatSheetDate(payload.dateStr || payload.date || todayStr());
  const runId = String(payload.runId || '').trim();
  const studentId = String(payload.studentId || '').trim();
  if (!runId || !studentId) throw new Error('Run and student are required.');

  let cleared = 0;
  if (isOpsDbEnabled()) {
    const r = await query(
      'UPDATE ' + table('bus_noshows') +
        ' SET cancelled_at = now() WHERE noshow_date = $1::date AND run_id = $2 AND student_id = $3' +
        ' AND cancelled_at IS NULL',
      [dateStr, runId, studentId]
    );
    cleared = r.rowCount || 0;
  } else {
    await ensureBusSheets();
    const rows = await getSheetRows(BUS_NOSHOWS_SHEET, { skipCache: true });
    for (let i = 1; i < rows.length; i++) {
      if (formatSheetDate(rows[i][1]) !== dateStr) continue;
      if (String(rows[i][2]) !== runId) continue;
      if (String(rows[i][3]) !== studentId) continue;
      if (!rows[i][0]) continue;
      await updateRange(BUS_NOSHOWS_SHEET, `A${i + 1}:G${i + 1}`, [new Array(7).fill('')]);
      cleared += 1;
    }
    invalidateSheetRowsCache(BUS_NOSHOWS_SHEET);
  }
  if (!cleared) throw new Error('No-show record not found.');
  await appendChangeLog({
    dateStr,
    runId,
    studentId,
    action: 'no_show_cancel',
    detail: 'Cancelled no-show',
    actorRole: actor && actor.role,
    actorId: actor && actor.id
  });
  return { ok: true, cleared, dateStr, runId, studentId };
}

async function listNoShowsForDate(dateStr) {
  dateStr = formatSheetDate(dateStr);
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT noshow_id, noshow_date, run_id, student_id, note, reported_by, created_at FROM ' +
        table('bus_noshows') +
        ' WHERE noshow_date = $1::date AND cancelled_at IS NULL',
      [dateStr]
    );
    return r.rows.map((row) => ({
      noShowId: String(row.noshow_id),
      dateStr,
      runId: String(row.run_id),
      studentId: String(row.student_id),
      note: String(row.note || ''),
      reportedBy: String(row.reported_by || ''),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : ''
    }));
  }
  await ensureBusSheets();
  const rows = await getSheetRows(BUS_NOSHOWS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (formatSheetDate(rows[i][1]) !== dateStr) continue;
    const studentId = String(rows[i][3] || '');
    if (!studentId) continue;
    out.push({
      noShowId: String(rows[i][0]),
      dateStr,
      runId: String(rows[i][2]),
      studentId,
      note: String(rows[i][4] || ''),
      reportedBy: String(rows[i][5] || ''),
      createdAt: String(rows[i][6] || '')
    });
  }
  return out;
}

async function studentNameMap() {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    map[String(rows[i][0])] = {
      name: String(rows[i][1] || ''),
      classId: String(rows[i][2] || ''),
      status: String(rows[i][3] || '')
    };
  }
  return map;
}

async function emergencyContactMap(studentIds) {
  const want = new Set((studentIds || []).map(String));
  const rows = await getSheetRows(STUDENT_PROFILE_SHEET).catch(() => []);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const sid = String(rows[i][0] || '');
    if (!sid || (want.size && !want.has(sid))) continue;
    map[sid] = {
      parentPhone: String(rows[i][9] || ''),
      emergencyContact: String(rows[i][11] || ''),
      emergencyPhone: String(rows[i][12] || '')
    };
  }
  return map;
}

async function teacherNameMap() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    map[String(rows[i][0])] = String(rows[i][1] || rows[i][0]);
  }
  return map;
}

/**
 * Build today's boarding list per run.
 * exclusions: { [studentId]: { skipPickup, skipDismissal, reason } }
 */
async function getDailyManifest(dateStr, exclusionsMap) {
  await ensureBusSheets();
  dateStr = formatSheetDate(dateStr || todayStr());
  const dow = dowOf(dateStr); // JS: 0 Sun
  if (dow === 0 || dow === 6) {
    return { dateStr, runs: [], note: 'Weekend — no regular bus runs.' };
  }

  const [buses, runs, assignments, duties, dutyDaily, overrides, noShows, students, teachers] = await Promise.all([
    listBuses({ includeInactive: false }),
    listRuns({ includeInactive: false }),
    listAssignments({ includeInactive: false }),
    listDuty({ includeInactive: false }),
    listDutyDailyForDate(dateStr),
    listOverridesForDate(dateStr),
    listNoShowsForDate(dateStr),
    studentNameMap(),
    teacherNameMap()
  ]);

  const busById = {};
  buses.forEach((b) => { busById[b.busId] = b; });
  const exclusions = exclusionsMap || {};

  const overrideKey = (runId, studentId) => runId + '|' + studentId;
  const overrideMap = {};
  overrides.forEach((o) => {
    overrideMap[overrideKey(o.runId, o.studentId)] = o;
  });
  const noShowSet = new Set(noShows.map((n) => overrideKey(n.runId, n.studentId)));
  const dailyByRun = {};
  dutyDaily.forEach((d) => {
    if (!dailyByRun[d.runId]) dailyByRun[d.runId] = [];
    dailyByRun[d.runId].push(d);
  });

  const resultRuns = [];
  for (const run of runs) {
    const bus = busById[run.busId];
    if (!bus) continue;

    const semesterDuty = duties
      .filter((d) => d.runId === run.runId && d.days.includes(dow))
      .map((d) => ({
        teacherId: d.teacherId,
        teacherName: teachers[d.teacherId] || d.teacherId
      }));
    const dailyForRun = dailyByRun[run.runId] || [];
    const dutyTeachers = dailyForRun.length
      ? dailyForRun.map((d) => ({
        teacherId: d.teacherId,
        teacherName: teachers[d.teacherId] || d.teacherId,
        substitute: true
      }))
      : semesterDuty.map((d) => Object.assign({}, d, { substitute: false }));
    const dutySource = dailyForRun.length ? 'daily' : 'semester';

    const riders = [];
    for (const a of assignments) {
      if (a.runId !== run.runId) continue;
      if (!a.days.includes(dow)) continue;
      const st = students[a.studentId];
      if (!st || st.status !== 'Enrolled') continue;

      const ex = exclusions[a.studentId] || {};
      let excluded = false;
      let excludeReason = '';
      if (run.runType === RUN_PICKUP && ex.skipPickup) {
        excluded = true;
        excludeReason = ex.reason || 'Skipped pickup';
      }
      if (run.runType === RUN_DISMISSAL && ex.skipDismissal) {
        excluded = true;
        excludeReason = ex.reason || 'Skipped dismissal';
      }

      const ov = overrideMap[overrideKey(run.runId, a.studentId)];
      if (ov) {
        if (ov.action === 'exclude') {
          excluded = true;
          excludeReason = ov.reason || ov.source || 'Manual exclude';
        }
        if (ov.action === 'include') {
          excluded = false;
          excludeReason = '';
        }
      }

      if (excluded) continue;

      riders.push({
        studentId: a.studentId,
        name: st.name,
        classId: st.classId,
        noShow: noShowSet.has(overrideKey(run.runId, a.studentId)),
        source: 'assignment'
      });
    }

    // Manual includes not in assignment
    for (const ov of overrides) {
      if (ov.runId !== run.runId || ov.action !== 'include') continue;
      if (riders.some((r) => r.studentId === ov.studentId)) continue;
      const st = students[ov.studentId];
      if (!st) continue;
      riders.push({
        studentId: ov.studentId,
        name: st.name,
        classId: st.classId,
        noShow: noShowSet.has(overrideKey(run.runId, ov.studentId)),
        source: 'override_include'
      });
    }

    riders.sort((a, b) => a.name.localeCompare(b.name));
    const contacts = await emergencyContactMap(riders.map((r) => r.studentId));
    riders.forEach((r) => {
      r.emergency = contacts[r.studentId] || {};
    });

    resultRuns.push({
      runId: run.runId,
      busId: run.busId,
      busName: bus.name,
      runType: run.runType,
      label: run.label,
      startTime: run.startTime,
      driverName: bus.driverName,
      driverPhone: bus.driverPhone,
      vehiclePlate: bus.vehiclePlate,
      vehicleInfo: bus.vehicleInfo,
      dutyTeachers,
      dutySource,
      semesterDutyTeachers: semesterDuty,
      riders,
      riderCount: riders.length
    });
  }

  resultRuns.sort((a, b) =>
    a.startTime.localeCompare(b.startTime) || a.busName.localeCompare(b.busName)
  );

  return { dateStr, runs: resultRuns };
}

async function getTeacherDutyManifest(teacherId, dateStr, exclusionsMap) {
  const full = await getDailyManifest(dateStr, exclusionsMap);
  const runs = full.runs.filter((r) =>
    (r.dutyTeachers || []).some((t) => t.teacherId === String(teacherId))
  );
  return { dateStr: full.dateStr, runs };
}

async function getAdminBusBoard(dateStr, exclusionsMap) {
  const [manifest, log] = await Promise.all([
    getDailyManifest(dateStr, exclusionsMap),
    listChangeLog({ dateStr, limit: 40 })
  ]);
  return { ...manifest, changeLog: log };
}

async function getBusSetupBundle() {
  const [buses, runs, assignments, duties, students, teachers] = await Promise.all([
    listBuses({ includeInactive: true }),
    listRuns({ includeInactive: true }),
    listAssignments({ includeInactive: false }),
    listDuty({ includeInactive: false }),
    studentNameMap(),
    teacherNameMap()
  ]);
  const studentList = Object.keys(students)
    .filter((id) => students[id].status === 'Enrolled')
    .map((id) => ({ studentId: id, name: students[id].name, classId: students[id].classId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teacherList = Object.keys(teachers).map((id) => ({
    teacherId: id,
    name: teachers[id]
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    buses,
    runs,
    assignments,
    duties,
    students: studentList,
    teachers: teacherList
  };
}

async function getParentBusAssignments(session) {
  const studentId = String(session.studentId || '').trim();
  if (!studentId) throw Object.assign(new Error('Student required.'), { status: 400 });
  const [assignments, runs, buses] = await Promise.all([
    listAssignments({ studentId, includeInactive: false }),
    listRuns({ includeInactive: false }),
    listBuses({ includeInactive: true }).catch(() => [])
  ]);
  const busMap = {};
  (buses || []).forEach((b) => { busMap[b.busId] = b; });
  const runMap = {};
  runs.forEach((r) => { runMap[r.runId] = r; });
  const enriched = assignments.map((a) => {
    const run = runMap[a.runId] || {};
    const bus = busMap[run.busId] || {};
    return Object.assign({}, a, {
      runType: run.runType || '',
      runLabel: run.label || a.runId,
      startTime: run.startTime || '',
      busName: bus.name || bus.busName || run.busId || '',
      busNo: bus.busNo || bus.number || ''
    });
  });
  return {
    studentId,
    assignments: enriched,
    availableRuns: runs.map((r) => ({
      runId: r.runId,
      runType: r.runType,
      label: r.label || r.runId,
      startTime: r.startTime || '',
      busId: r.busId || ''
    }))
  };
}

async function parentUpdateBusAssignment(session, payload) {
  const studentId = String(session.studentId || '').trim();
  if (!studentId) throw Object.assign(new Error('Student required.'), { status: 400 });
  const action = String(payload.action || 'save').trim().toLowerCase();
  if (action === 'cancel' || action === 'delete') {
    const assignmentId = String(payload.assignmentId || '').trim();
    if (!assignmentId) throw Object.assign(new Error('Assignment id required.'), { status: 400 });
    const mine = await listAssignments({ studentId, includeInactive: true });
    if (!mine.some((a) => a.assignmentId === assignmentId)) {
      throw Object.assign(new Error('Not your assignment.'), { status: 403 });
    }
    return deleteAssignment(assignmentId);
  }
  const runId = String(payload.runId || '').trim();
  if (!runId) throw Object.assign(new Error('Run required.'), { status: 400 });
  const runs = await listRuns({ includeInactive: false });
  const run = runs.find((r) => r.runId === runId);
  if (!run) throw Object.assign(new Error('Run not found.'), { status: 404 });
  // Replace same runType assignment for this student
  const existing = await listAssignments({ studentId, includeInactive: false });
  for (const a of existing) {
    const er = runs.find((r) => r.runId === a.runId);
    if (er && er.runType === run.runType && a.runId !== runId) {
      await deleteAssignment(a.assignmentId);
    }
  }
  return saveAssignment({
    studentId,
    runId,
    days: payload.days || [1, 2, 3, 4, 5],
    active: true
  });
}

module.exports = {
  RUN_PICKUP,
  RUN_DISMISSAL,
  ensureBusSheets,
  listBuses,
  saveBus,
  listRuns,
  saveRun,
  listAssignments,
  saveAssignment,
  deleteAssignment,
  listDuty,
  saveDuty,
  listDutyDailyForDate,
  saveDutyDaily,
  saveOverride,
  listOverridesForDate,
  reportNoShow,
  cancelNoShow,
  listNoShowsForDate,
  listChangeLog,
  getDailyManifest,
  getTeacherDutyManifest,
  getAdminBusBoard,
  getBusSetupBundle,
  getParentBusAssignments,
  parentUpdateBusAssignment
};
