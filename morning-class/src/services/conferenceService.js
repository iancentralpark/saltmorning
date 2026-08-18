'use strict';

const crypto = require('crypto');
const {
  CONFERENCE_SCHEDULES_SHEET,
  CONFERENCE_BOOKINGS_SHEET,
  TEACHER_LIST_SHEET,
  CLASS_TEACHERS_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const SCHEDULE_HEADERS = [
  'ScheduleID', 'TeacherID', 'TargetGrade', 'Date', 'TimeSlot', 'Type', 'Status', 'Location', 'SlotMinutes'
];
const BOOKING_HEADERS = [
  'BookingID', 'ScheduleID', 'StudentID', 'ParentID', 'ParentNote', 'TeacherNote', 'Status', 'BookedAt'
];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureConferenceSheets() {
  await ensureSheet(CONFERENCE_SCHEDULES_SHEET, SCHEDULE_HEADERS);
  await ensureSheet(CONFERENCE_BOOKINGS_SHEET, BOOKING_HEADERS);
}

function parseScheduleRow(row) {
  if (!row || !row[0]) return null;
  return {
    scheduleId: String(row[0]),
    teacherId: String(row[1] || ''),
    targetGrade: String(row[2] || '*'),
    date: String(row[3] || ''),
    timeSlot: String(row[4] || ''),
    type: String(row[5] || 'InPerson'),
    status: String(row[6] || 'Open'),
    location: String(row[7] || ''),
    slotMinutes: Number(row[8] || 15) || 15
  };
}

function parseBookingRow(row) {
  if (!row || !row[0]) return null;
  return {
    bookingId: String(row[0]),
    scheduleId: String(row[1] || ''),
    studentId: String(row[2] || ''),
    parentId: String(row[3] || ''),
    parentNote: String(row[4] || ''),
    teacherNote: String(row[5] || ''),
    status: String(row[6] || 'Booked'),
    bookedAt: String(row[7] || '')
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseHm(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatHm(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return pad2(h) + ':' + pad2(m);
}

function buildSlots(startHm, endHm, slotMinutes) {
  const start = parseHm(startHm);
  const end = parseHm(endHm);
  const step = Number(slotMinutes) || 15;
  if (start == null || end == null || step < 5 || end <= start) return [];
  const out = [];
  for (let t = start; t + step <= end; t += step) {
    out.push(formatHm(t) + '-' + formatHm(t + step));
  }
  return out;
}

async function listSchedules(opts) {
  opts = opts || {};
  await ensureConferenceSheets();
  const rows = await getSheetRows(CONFERENCE_SCHEDULES_SHEET, opts.skipCache ? { skipCache: true } : undefined);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const s = parseScheduleRow(rows[i]);
    if (!s) continue;
    if (opts.teacherId && s.teacherId !== String(opts.teacherId)) continue;
    if (opts.date && s.date !== String(opts.date)) continue;
    if (opts.status && s.status !== String(opts.status)) continue;
    out.push(s);
  }
  return out;
}

async function listBookings(opts) {
  opts = opts || {};
  await ensureConferenceSheets();
  const rows = await getSheetRows(CONFERENCE_BOOKINGS_SHEET, opts.skipCache ? { skipCache: true } : undefined);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const b = parseBookingRow(rows[i]);
    if (!b) continue;
    if (opts.scheduleId && b.scheduleId !== String(opts.scheduleId)) continue;
    if (opts.studentId && b.studentId !== String(opts.studentId)) continue;
    if (opts.parentId && b.parentId !== String(opts.parentId)) continue;
    if (opts.status && b.status !== String(opts.status)) continue;
    out.push(b);
  }
  return out;
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

async function studentMeta(studentId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(studentId)) continue;
    return {
      studentId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      classId: String(rows[i][2] || ''),
      status: String(rows[i][3] || '')
    };
  }
  return null;
}

/**
 * Open conference slots for a date range window (single date + start/end + interval).
 */
async function createSchedules(teacherId, payload) {
  await ensureConferenceSheets();
  teacherId = String(teacherId || '').trim();
  if (!teacherId) throw Object.assign(new Error('Teacher required.'), { status: 400 });

  const date = String(payload.date || '').trim();
  const type = String(payload.type || 'InPerson').trim() || 'InPerson';
  const location = String(payload.location || '').trim();
  const targetGrade = String(payload.targetGrade || payload.targetClassId || '*').trim() || '*';
  const slotMinutes = Number(payload.slotMinutes) || 15;
  const slots = Array.isArray(payload.timeSlots) && payload.timeSlots.length
    ? payload.timeSlots.map(String)
    : buildSlots(payload.startTime || '09:00', payload.endTime || '12:00', slotMinutes);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Valid date (YYYY-MM-DD) is required.'), { status: 400 });
  }
  if (!slots.length) {
    throw Object.assign(new Error('No time slots generated. Check start/end/interval.'), { status: 400 });
  }

  const existing = await listSchedules({ teacherId, date, skipCache: true });
  const existingSlots = new Set(existing.map((s) => s.timeSlot));
  const rows = [];
  const created = [];
  for (const slot of slots) {
    if (existingSlots.has(slot)) continue;
    const scheduleId = newId('cfs');
    const row = [
      scheduleId, teacherId, targetGrade, date, slot, type, 'Open', location, String(slotMinutes)
    ];
    rows.push(row);
    created.push(parseScheduleRow(row));
  }
  if (!rows.length) {
    throw Object.assign(new Error('All slots already exist for this date.'), { status: 400 });
  }
  await appendRows(CONFERENCE_SCHEDULES_SHEET, rows);
  invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);

  // Notify parents of linked students (best-effort)
  try {
    const push = require('./pushService');
    if (push.isPushEnabled()) {
      const classIds = targetGrade === '*' ? null : new Set(targetGrade.split(/[,|]/).map((x) => x.trim()).filter(Boolean));
      const students = await getSheetRows(STUDENT_LIST_SHEET);
      const { listParentsForStudent } = require('./parentRegistryService');
      const parentIds = new Set();
      for (let i = 1; i < students.length; i++) {
        if (!students[i][0] || String(students[i][3] || '') !== 'Enrolled') continue;
        const classId = String(students[i][2] || '');
        if (classIds && !classIds.has(classId) && !classIds.has('*')) continue;
        const parents = await listParentsForStudent(String(students[i][0])).catch(() => []);
        (parents || []).forEach((p) => {
          const id = typeof p === 'string' ? p : (p.parentId || p);
          if (id) parentIds.add(String(id));
        });
      }
      const names = await teacherNameMap();
      const tName = names[teacherId] || teacherId;
      await Promise.all(Array.from(parentIds).map((pid) =>
        push.sendToParent(pid, {
          title: 'Parent conference open',
          body: tName + ' — ' + date + ' slots available',
          url: '/parent#/conferences'
        }).catch(() => null)
      ));
    }
  } catch (_) { /* optional */ }

  return { created, count: created.length };
}

async function listTeacherDashboard(teacherId) {
  teacherId = String(teacherId || '').trim();
  const [schedules, bookings, names] = await Promise.all([
    listSchedules({ teacherId, skipCache: true }),
    listBookings({ skipCache: true }),
    Promise.resolve({})
  ]);
  const scheduleIds = new Set(schedules.map((s) => s.scheduleId));
  const mine = bookings.filter((b) => scheduleIds.has(b.scheduleId) && b.status !== 'Cancelled');
  const bySchedule = {};
  mine.forEach((b) => { bySchedule[b.scheduleId] = b; });

  const studentIds = mine.map((b) => b.studentId);
  const studentMap = {};
  await Promise.all(studentIds.map(async (sid) => {
    studentMap[sid] = await studentMeta(sid);
  }));

  const open = schedules.filter((s) => s.status === 'Open').sort(sortSchedule);
  const booked = schedules
    .filter((s) => s.status === 'Booked' || bySchedule[s.scheduleId])
    .map((s) => {
      const b = bySchedule[s.scheduleId];
      const st = b && studentMap[b.studentId];
      return Object.assign({}, s, {
        booking: b || null,
        studentName: (st && st.name) || (b && b.studentId) || '',
        classId: (st && st.classId) || ''
      });
    })
    .sort(sortSchedule);

  return { open, booked, schedules, names };
}

function sortSchedule(a, b) {
  const da = String(a.date || '') + ' ' + String(a.timeSlot || '');
  const db = String(b.date || '') + ' ' + String(b.timeSlot || '');
  return da < db ? -1 : da > db ? 1 : 0;
}

async function listAvailableForParent(session) {
  const studentId = String(session.studentId || '').trim();
  const student = await studentMeta(studentId);
  const classId = (student && student.classId) || String(session.classId || '');

  const [schedules, bookings, names, classTeachers] = await Promise.all([
    listSchedules({ skipCache: true }),
    listBookings({ skipCache: true }),
    teacherNameMap(),
    getSheetRows(CLASS_TEACHERS_SHEET)
  ]);

  const teacherIdsForClass = new Set();
  for (let i = 1; i < classTeachers.length; i++) {
    if (String(classTeachers[i][0]) === classId && classTeachers[i][1]) {
      teacherIdsForClass.add(String(classTeachers[i][1]));
    }
  }

  const bookedScheduleIds = new Set(
    bookings.filter((b) => b.status === 'Booked' || b.status === 'Completed').map((b) => b.scheduleId)
  );
  const myBookings = bookings.filter((b) => b.studentId === studentId && b.status !== 'Cancelled');

  const byTeacher = {};
  for (const s of schedules) {
    if (s.status === 'Closed') continue;
    const targets = String(s.targetGrade || '*').split(/[,|]/).map((x) => x.trim()).filter(Boolean);
    const openToClass = !targets.length || targets.includes('*') || targets.includes(classId);
    if (!openToClass) continue;
    // Prefer teachers linked to the child's class; still show others if targeted
    if (teacherIdsForClass.size && !teacherIdsForClass.has(s.teacherId) && !targets.includes(classId) && targets[0] !== '*') {
      // keep if wildcard already handled
    }
    if (!byTeacher[s.teacherId]) {
      byTeacher[s.teacherId] = {
        teacherId: s.teacherId,
        teacherName: names[s.teacherId] || s.teacherId,
        slots: []
      };
    }
    const isBooked = s.status === 'Booked' || bookedScheduleIds.has(s.scheduleId);
    byTeacher[s.teacherId].slots.push({
      scheduleId: s.scheduleId,
      date: s.date,
      timeSlot: s.timeSlot,
      type: s.type,
      location: s.location,
      status: isBooked ? 'Booked' : 'Open',
      available: !isBooked && s.status === 'Open'
    });
  }

  Object.keys(byTeacher).forEach((tid) => {
    byTeacher[tid].slots.sort(sortSchedule);
  });

  return {
    teachers: Object.keys(byTeacher).map((k) => byTeacher[k]),
    myBookings: myBookings.map((b) => {
      const s = schedules.find((x) => x.scheduleId === b.scheduleId);
      return Object.assign({}, b, {
        date: s && s.date,
        timeSlot: s && s.timeSlot,
        type: s && s.type,
        location: s && s.location,
        teacherId: s && s.teacherId,
        teacherName: s ? (names[s.teacherId] || s.teacherId) : ''
      });
    })
  };
}

/**
 * First-come booking with re-read check (Sheets best-effort lock).
 */
async function bookSlot(session, payload) {
  await ensureConferenceSheets();
  const scheduleId = String(payload.scheduleId || '').trim();
  const studentId = String(payload.studentId || session.studentId || '').trim();
  const parentId = String(session.parentId || '').trim();
  const parentNote = String(payload.parentNote || '').trim().slice(0, 500);
  const meetingType = String(payload.meetingType || payload.type || '').trim();
  const allowedTypes = { InPerson: 1, Phone: 1, Zoom: 1 };
  if (!scheduleId || !studentId || !parentId) {
    throw Object.assign(new Error('Schedule, student, and parent are required.'), { status: 400 });
  }
  if (String(session.studentId) !== studentId) {
    throw Object.assign(new Error('Switch to the correct child before booking.'), { status: 403 });
  }

  const schedules = await listSchedules({ skipCache: true });
  const schedule = schedules.find((s) => s.scheduleId === scheduleId);
  if (!schedule) throw Object.assign(new Error('Slot not found.'), { status: 404 });
  if (schedule.status !== 'Open') {
    throw Object.assign(new Error('This slot is no longer available.'), { status: 409 });
  }

  const bookings = await listBookings({ skipCache: true });
  if (bookings.some((b) => b.scheduleId === scheduleId && (b.status === 'Booked' || b.status === 'Completed'))) {
    throw Object.assign(new Error('This slot was just taken. Please pick another.'), { status: 409 });
  }

  const bookingId = newId('cfb');
  const bookingRow = [
    bookingId, scheduleId, studentId, parentId, parentNote, '', 'Booked', nowIso()
  ];
  await appendRows(CONFERENCE_BOOKINGS_SHEET, [bookingRow]);
  invalidateSheetRowsCache(CONFERENCE_BOOKINGS_SHEET);

  // Mark schedule booked
  const rows = await getSheetRows(CONFERENCE_SCHEDULES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== scheduleId) continue;
    const row = rows[i].slice();
    while (row.length < 9) row.push('');
    row[6] = 'Booked';
    if (allowedTypes[meetingType]) row[5] = meetingType;
    await updateRange(CONFERENCE_SCHEDULES_SHEET, `A${i + 1}:I${i + 1}`, [row]);
    invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);
    break;
  }

  const booking = parseBookingRow(bookingRow);
  try {
    const push = require('./pushService');
    if (push.isPushEnabled() && schedule.teacherId) {
      const student = await studentMeta(studentId);
      await push.sendToUser('teacher', schedule.teacherId, {
        title: 'Conference booked',
        body: ((student && student.name) || studentId) + ' · ' + schedule.date + ' ' + schedule.timeSlot,
        url: '/teacher#/conferences'
      }).catch(() => null);
    }
  } catch (_) { /* optional */ }

  return booking;
}

async function cancelBooking(session, bookingId) {
  await ensureConferenceSheets();
  bookingId = String(bookingId || '').trim();
  const parentId = String(session.parentId || '').trim();
  if (!bookingId || !parentId) {
    throw Object.assign(new Error('Booking and parent are required.'), { status: 400 });
  }

  const bookings = await listBookings({ skipCache: true });
  const booking = bookings.find((b) => b.bookingId === bookingId);
  if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });
  if (booking.parentId !== parentId) {
    throw Object.assign(new Error('Not your booking.'), { status: 403 });
  }
  if (booking.status === 'Cancelled') return booking;
  if (booking.status === 'Completed') {
    throw Object.assign(new Error('Completed conferences cannot be cancelled.'), { status: 400 });
  }

  const bookRows = await getSheetRows(CONFERENCE_BOOKINGS_SHEET, { skipCache: true });
  for (let i = 1; i < bookRows.length; i++) {
    if (String(bookRows[i][0]) !== bookingId) continue;
    const row = bookRows[i].slice();
    while (row.length < 8) row.push('');
    row[6] = 'Cancelled';
    await updateRange(CONFERENCE_BOOKINGS_SHEET, `A${i + 1}:H${i + 1}`, [row]);
    invalidateSheetRowsCache(CONFERENCE_BOOKINGS_SHEET);
    break;
  }

  // Re-open schedule if no other active booking
  const stillActive = (await listBookings({ skipCache: true }))
    .some((b) => b.scheduleId === booking.scheduleId &&
      b.bookingId !== bookingId &&
      (b.status === 'Booked' || b.status === 'Completed'));
  if (!stillActive) {
    const schedRows = await getSheetRows(CONFERENCE_SCHEDULES_SHEET, { skipCache: true });
    for (let i = 1; i < schedRows.length; i++) {
      if (String(schedRows[i][0]) !== booking.scheduleId) continue;
      const row = schedRows[i].slice();
      while (row.length < 9) row.push('');
      if (row[6] === 'Booked') {
        row[6] = 'Open';
        await updateRange(CONFERENCE_SCHEDULES_SHEET, `A${i + 1}:I${i + 1}`, [row]);
        invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);
      }
      break;
    }
  }

  try {
    const schedules = await listSchedules({ skipCache: true });
    const schedule = schedules.find((s) => s.scheduleId === booking.scheduleId);
    const push = require('./pushService');
    if (push.isPushEnabled() && schedule && schedule.teacherId) {
      await push.sendToUser('teacher', schedule.teacherId, {
        title: 'Conference cancelled',
        body: (schedule.date || '') + ' ' + (schedule.timeSlot || '') + ' — parent cancelled',
        url: '/teacher#/conferences'
      }).catch(() => null);
    }
  } catch (_) { /* optional */ }

  return Object.assign({}, booking, { status: 'Cancelled' });
}

async function saveTeacherNote(teacherId, payload) {
  await ensureConferenceSheets();
  const bookingId = String(payload.bookingId || '').trim();
  const note = String(payload.teacherNote || payload.note || '').trim().slice(0, 4000);
  if (!bookingId) throw Object.assign(new Error('Booking ID required.'), { status: 400 });

  const bookings = await listBookings({ skipCache: true });
  const booking = bookings.find((b) => b.bookingId === bookingId);
  if (!booking) throw Object.assign(new Error('Booking not found.'), { status: 404 });

  const schedules = await listSchedules({ teacherId: String(teacherId) });
  if (!schedules.some((s) => s.scheduleId === booking.scheduleId)) {
    throw Object.assign(new Error('Not your conference booking.'), { status: 403 });
  }

  const rows = await getSheetRows(CONFERENCE_BOOKINGS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== bookingId) continue;
    const row = rows[i].slice();
    while (row.length < 8) row.push('');
    row[5] = note;
    if (payload.markCompleted) row[6] = 'Completed';
    await updateRange(CONFERENCE_BOOKINGS_SHEET, `A${i + 1}:H${i + 1}`, [row]);
    invalidateSheetRowsCache(CONFERENCE_BOOKINGS_SHEET);
    const updated = parseBookingRow(row);
    try {
      const { notifyParentChannels } = require('./consentService');
      if (booking.parentId) {
        const title = payload.markCompleted ? 'Conference completed' : 'Conference note updated';
        const body = note
          ? (title + ': ' + note.slice(0, 200))
          : (title + '. Open Conferences in the parent portal.');
        await notifyParentChannels(booking.parentId, booking.studentId, body, {
          title,
          body: note ? note.slice(0, 120) : 'Your teacher left a conference note.',
          url: '/parent#/conferences'
        }).catch(() => null);
      }
    } catch (_) { /* optional */ }
    return updated;
  }
  throw Object.assign(new Error('Booking not found.'), { status: 404 });
}

async function closeSchedule(teacherId, scheduleId) {
  scheduleId = String(scheduleId || '').trim();
  const rows = await getSheetRows(CONFERENCE_SCHEDULES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== scheduleId) continue;
    if (String(rows[i][1]) !== String(teacherId)) {
      throw Object.assign(new Error('Not your schedule.'), { status: 403 });
    }
    const row = rows[i].slice();
    while (row.length < 9) row.push('');
    if (row[6] === 'Booked') {
      throw Object.assign(new Error('Cannot close a booked slot.'), { status: 400 });
    }
    row[6] = 'Closed';
    await updateRange(CONFERENCE_SCHEDULES_SHEET, `A${i + 1}:I${i + 1}`, [row]);
    invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);
    return parseScheduleRow(row);
  }
  throw Object.assign(new Error('Schedule not found.'), { status: 404 });
}

async function reopenSchedule(teacherId, scheduleId) {
  scheduleId = String(scheduleId || '').trim();
  const rows = await getSheetRows(CONFERENCE_SCHEDULES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== scheduleId) continue;
    if (String(rows[i][1]) !== String(teacherId)) {
      throw Object.assign(new Error('Not your schedule.'), { status: 403 });
    }
    const row = rows[i].slice();
    while (row.length < 9) row.push('');
    if (row[6] === 'Booked') {
      throw Object.assign(new Error('Cannot reopen a booked slot.'), { status: 400 });
    }
    row[5] = 'Any';
    row[6] = 'Open';
    await updateRange(CONFERENCE_SCHEDULES_SHEET, `A${i + 1}:I${i + 1}`, [row]);
    invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);
    return parseScheduleRow(row);
  }
  throw Object.assign(new Error('Schedule not found.'), { status: 404 });
}

/**
 * Toggle conference availability for one timetable cell (date + start/end).
 * Open slots in that window are closed; otherwise slots are created or reopened.
 */
async function togglePeriodSlots(teacherId, payload) {
  await ensureConferenceSheets();
  teacherId = String(teacherId || '').trim();
  if (!teacherId) throw Object.assign(new Error('Teacher required.'), { status: 400 });

  const date = String(payload.date || '').trim();
  const startTime = String(payload.startTime || '').trim();
  const endTime = String(payload.endTime || '').trim();
  const location = String(payload.location || '').trim();
  const slotMinutes = Number(payload.slotMinutes) || 15;
  const targetGrade = String(payload.targetGrade || payload.targetClassId || '*').trim() || '*';

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Valid date (YYYY-MM-DD) is required.'), { status: 400 });
  }

  let slots = buildSlots(startTime, endTime, slotMinutes);
  if (!slots.length) {
    const start = parseHm(startTime);
    const end = parseHm(endTime);
    if (start == null || end == null || end <= start) {
      throw Object.assign(new Error('Valid start/end times are required.'), { status: 400 });
    }
    slots = [formatHm(start) + '-' + formatHm(end)];
  }

  const desired = String(payload.desired || payload.action || '').trim().toLowerCase();

  const existing = await listSchedules({ teacherId, date, skipCache: true });
  const slotSet = new Set(slots);
  const inWindow = existing.filter((s) => slotSet.has(s.timeSlot));
  const openOnes = inWindow.filter((s) => s.status === 'Open');
  const wantClose = desired === 'close' || desired === 'closed' || (!desired && openOnes.length);
  if (wantClose) {
    if (!openOnes.length) return { action: 'closed', count: 0, already: true };
    const closed = [];
    for (const s of openOnes) {
      closed.push(await closeSchedule(teacherId, s.scheduleId));
    }
    return { action: 'closed', count: closed.length, schedules: closed };
  }

  if (desired === 'open' && openOnes.length && openOnes.length >= slots.length) {
    return { action: 'opened', count: 0, already: true, created: [], reopened: [] };
  }

  const created = [];
  const reopened = [];
  const rows = [];
  for (const slot of slots) {
    const hit = existing.find((s) => s.timeSlot === slot);
    if (hit && hit.status === 'Booked') continue;
    if (hit && hit.status === 'Closed') {
      reopened.push(await reopenSchedule(teacherId, hit.scheduleId));
      continue;
    }
    if (hit && hit.status === 'Open') continue;
    const scheduleId = newId('cfs');
    const row = [
      scheduleId, teacherId, targetGrade, date, slot, 'Any', 'Open', location, String(slotMinutes)
    ];
    rows.push(row);
    created.push(parseScheduleRow(row));
  }
  if (rows.length) {
    await appendRows(CONFERENCE_SCHEDULES_SHEET, rows);
    invalidateSheetRowsCache(CONFERENCE_SCHEDULES_SHEET);
  }
  if (!created.length && !reopened.length) {
    throw Object.assign(new Error('Could not open this slot (already booked).'), { status: 400 });
  }
  return { action: 'opened', count: created.length + reopened.length, created, reopened };
}

module.exports = {
  ensureConferenceSheets,
  createSchedules,
  togglePeriodSlots,
  listTeacherDashboard,
  listAvailableForParent,
  bookSlot,
  cancelBooking,
  saveTeacherNote,
  closeSchedule,
  listSchedules,
  listBookings
};
