'use strict';

const crypto = require('crypto');
const {
  PARENT_ATTENDANCE_NOTICES_SHEET,
  ATTENDANCE_SHEET,
  STUDENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  TIMEZONE
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');
const { formatSheetDate, todayStr, formatDateTimeNow } = require('../dateUtils');
const { resolveDay } = require('./schoolCalendarService');
const { listSchoolSemesters } = require('./schoolSemesterService');
const {
  parentHasStudent,
  getParentRecord
} = require('./parentRegistryService');
const { upsertStudentRecord } = require('./attendanceService');
const {
  sendThreadMessage,
  parentAdminThreadId,
  parentTeacherThreadId,
  lookupStudentName
} = require('./messengerService');

const NOTICE_HEADERS = [
  'NoticeID', 'Date', 'StudentID', 'ParentID', 'NoticeType', 'Note', 'CreatedAt', 'UpdatedAt'
];

const ATTENDANCE_NOTICE_TYPES = new Set(['결석', '지각', '조퇴']);
const ALL_NOTICE_TYPES = new Set(['결석', '지각', '조퇴', 'pickup_only']);

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function parseNotice(row, rowIndex) {
  return {
    noticeId: String(row[0] || ''),
    dateStr: formatSheetDate(row[1]),
    studentId: String(row[2] || ''),
    parentId: String(row[3] || ''),
    noticeType: String(row[4] || '').trim(),
    note: String(row[5] || '').trim(),
    createdAt: String(row[6] || ''),
    updatedAt: String(row[7] || ''),
    _row: rowIndex
  };
}

async function ensureNoticeSheet() {
  await ensureSheet(PARENT_ATTENDANCE_NOTICES_SHEET, NOTICE_HEADERS);
}

async function listNotices({ dateStr, studentId, parentId, fromDate, toDate } = {}) {
  await ensureNoticeSheet();
  const rows = await getSheetRows(PARENT_ATTENDANCE_NOTICES_SHEET);
  const out = [];
  const wantDate = dateStr ? formatSheetDate(dateStr) : '';
  const from = fromDate ? formatSheetDate(fromDate) : '';
  const to = toDate ? formatSheetDate(toDate) : '';
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const n = parseNotice(rows[i], i + 1);
    if (wantDate && n.dateStr !== wantDate) continue;
    if (from && n.dateStr < from) continue;
    if (to && n.dateStr > to) continue;
    if (studentId && n.studentId !== String(studentId)) continue;
    if (parentId && n.parentId !== String(parentId)) continue;
    out.push(n);
  }
  out.sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.createdAt.localeCompare(b.createdAt));
  return out;
}

async function noticeDateBounds() {
  const today = todayStr();
  let maxDate = '';
  try {
    const semesters = await listSchoolSemesters();
    for (const s of semesters || []) {
      if (s.endDate && s.endDate > maxDate) maxDate = s.endDate;
    }
  } catch (_) { /* optional */ }
  if (!maxDate) {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() + 120);
    maxDate = formatSheetDate(d);
  }
  return { minDate: today, maxDate };
}

async function schoolDayInfo(classId, dateStr) {
  if (!classId) {
    return { isClassDay: false, title: '', dayType: 'unknown', message: 'Class not assigned.' };
  }
  const day = await resolveDay(classId, dateStr);
  const title = day.title || day.krHoliday || '';
  let message = '';
  if (!day.isClassDay) {
    if (day.dayType === 'break') message = (title || 'School break') + ' — no class.';
    else if (day.dayType === 'holiday' || day.dayType === 'kr_holiday') message = (title || 'Holiday') + ' — no class.';
    else if (day.dayType === 'event') message = (title || 'School event') + ' — no class.';
    else message = (title || 'Not a school day') + ' — choose another date.';
  }
  return {
    isClassDay: !!day.isClassDay,
    title,
    dayType: day.dayType,
    krHoliday: day.krHoliday || '',
    message
  };
}

/**
 * Today or future school days only (school calendar).
 */
async function validateNoticeDate(classId, dateStr) {
  dateStr = formatSheetDate(dateStr);
  const today = todayStr();
  if (dateStr < today) {
    const err = new Error('Notices cannot be submitted for past dates.');
    err.status = 400;
    throw err;
  }
  const { maxDate } = await noticeDateBounds();
  if (dateStr > maxDate) {
    const err = new Error('Date is too far in the future. Please choose a date within the school year.');
    err.status = 400;
    throw err;
  }
  const info = await schoolDayInfo(classId, dateStr);
  if (!info.isClassDay) {
    const err = new Error(info.message || 'Not a school day.');
    err.status = 400;
    throw err;
  }
  return info;
}

async function getParentNoticeView(studentId, date) {
  const today = todayStr();
  const dateStr = formatSheetDate(date || today);
  const student = await findStudentMeta(studentId);
  const [notice, upcoming, bounds, schoolDay] = await Promise.all([
    getNoticeForStudentDate(studentId, dateStr),
    listNotices({ studentId, fromDate: today }),
    noticeDateBounds(),
    student && student.classId ? schoolDayInfo(student.classId, dateStr) : Promise.resolve(null)
  ]);
  return {
    dateStr,
    today,
    studentId,
    notice,
    upcoming: upcoming.slice(0, 30),
    bounds,
    schoolDay
  };
}

async function getNoticeForStudentDate(studentId, dateStr) {
  const list = await listNotices({ studentId, dateStr });
  return list[0] || null;
}

async function findStudentMeta(studentId) {
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

async function findHomeroomTeacherId(classId) {
  if (!classId) return null;
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][4] || '').trim() !== String(classId)) continue;
    return String(rows[i][0] || '') || null;
  }
  return null;
}

function applyNoticeToExclusion(map, studentId, noticeType, reason) {
  const sid = String(studentId);
  const cur = map[sid] || { skipPickup: false, skipDismissal: false, reason: '' };
  if (noticeType === '결석' || noticeType === 'pickup_only') {
    cur.skipPickup = true;
    cur.skipDismissal = true;
  } else if (noticeType === '지각') {
    cur.skipPickup = true;
  } else if (noticeType === '조퇴') {
    // Early leave: cannot take any dismissal bus that day
    cur.skipDismissal = true;
  }
  cur.reason = reason || noticeType || cur.reason;
  map[sid] = cur;
}

/**
 * Build exclusion map for daily bus manifests.
 * Attendance + parent notices (OR of skip flags). 조퇴 → all dismissal runs.
 */
async function buildBusExclusionsForDate(dateStr) {
  dateStr = formatSheetDate(dateStr || todayStr());
  const map = {};

  const [attRows, notices] = await Promise.all([
    getSheetRows(ATTENDANCE_SHEET).catch(() => []),
    listNotices({ dateStr })
  ]);

  for (let i = 1; i < attRows.length; i++) {
    if (formatSheetDate(attRows[i][0]) !== dateStr) continue;
    const studentId = String(attRows[i][2] || '');
    const status = String(attRows[i][3] || '').trim();
    if (!studentId || !status) continue;
    applyNoticeToExclusion(map, studentId, status, status);
  }

  for (const n of notices) {
    applyNoticeToExclusion(map, n.studentId, n.noticeType, n.noticeType + (n.note ? ': ' + n.note : ''));
  }

  return map;
}

async function notifyStaff({ parent, student, noticeType, dateStr, note }) {
  const today = todayStr();
  const isAdvance = dateStr > today;
  const typeLabel =
    noticeType === 'pickup_only'
      ? (isAdvance ? 'Parent pickup (no bus)' : 'Today: parent pickup (no bus)')
      : noticeType;
  const body = [
    (isAdvance ? '[Advance attendance notice]' : '[Attendance notice]') + ' ' + typeLabel,
    'Student: ' + (student.name || student.studentId),
    'Date: ' + dateStr,
    note ? 'Note: ' + note : null,
    'From: ' + (parent.name || parent.parentId || 'Parent')
  ].filter(Boolean).join('\n');

  const session = {
    role: 'parent',
    parentId: parent.parentId,
    studentId: student.studentId,
    classId: student.classId || '',
    name: parent.name || 'Parent'
  };

  try {
    await sendThreadMessage(parentAdminThreadId(parent.parentId), session, body);
  } catch (e) {
    console.warn('[parentAttendanceNotice] admin notify failed:', e.message);
  }

  try {
    const teacherId = await findHomeroomTeacherId(student.classId);
    if (teacherId) {
      await sendThreadMessage(
        parentTeacherThreadId(student.studentId, teacherId),
        session,
        body
      );
    }
  } catch (e) {
    console.warn('[parentAttendanceNotice] teacher notify failed:', e.message);
  }
}

/**
 * Parent submits a notice for today or a future school day.
 * - 결석 / 지각 / 조퇴 → attendance sheet only when date is today; bus rules via notice sheet
 * - pickup_only → bus exclusion for that date (no attendance change)
 * - 조퇴 → excluded from ALL dismissal buses (no switching to another run)
 */
async function submitNotice({ parentId, studentId, noticeType, date, note }) {
  const type = String(noticeType || '').trim();
  if (!ALL_NOTICE_TYPES.has(type)) {
    const err = new Error('Invalid notice type. Use 결석, 지각, 조퇴, or pickup_only.');
    err.status = 400;
    throw err;
  }
  const dateStr = formatSheetDate(date || todayStr());
  const today = todayStr();
  parentId = String(parentId || '').trim();
  studentId = String(studentId || '').trim();

  const owns = await parentHasStudent(parentId, studentId);
  if (!owns) {
    const err = new Error('Not your child.');
    err.status = 403;
    throw err;
  }

  const [student, parent] = await Promise.all([
    findStudentMeta(studentId),
    getParentRecord(parentId)
  ]);
  if (!student) {
    const err = new Error('Student not found.');
    err.status = 404;
    throw err;
  }
  if (!parent) {
    const err = new Error('Parent not found.');
    err.status = 404;
    throw err;
  }

  await validateNoticeDate(student.classId, dateStr);

  await ensureNoticeSheet();
  const now = formatDateTimeNow(TIMEZONE);
  const existing = await getNoticeForStudentDate(studentId, dateStr);
  let notice;

  if (existing) {
    const row = [
      existing.noticeId,
      dateStr,
      studentId,
      parentId,
      type,
      String(note || '').trim(),
      existing.createdAt || now,
      now
    ];
    await updateRange(
      PARENT_ATTENDANCE_NOTICES_SHEET,
      'A' + existing._row + ':H' + existing._row,
      [row]
    );
    invalidateSheetRowsCache(PARENT_ATTENDANCE_NOTICES_SHEET);
    notice = parseNotice(row, existing._row);
  } else {
    const row = [
      newId('pan'),
      dateStr,
      studentId,
      parentId,
      type,
      String(note || '').trim(),
      now,
      now
    ];
    await appendRows(PARENT_ATTENDANCE_NOTICES_SHEET, [row]);
    invalidateSheetRowsCache(PARENT_ATTENDANCE_NOTICES_SHEET);
    notice = parseNotice(row, null);
  }

  // Same-day only: write attendance immediately. Future dates stay on notice sheet until that day.
  if (ATTENDANCE_NOTICE_TYPES.has(type) && student.classId && dateStr === today) {
    try {
      await upsertStudentRecord(
        student.classId,
        studentId,
        dateStr,
        type,
        String(note || '').trim(),
        ''
      );
    } catch (e) {
      console.warn('[parentAttendanceNotice] attendance upsert failed:', e.message);
    }
  }

  await notifyStaff({
    parent,
    student: Object.assign({}, student, {
      name: student.name || (await lookupStudentName(studentId))
    }),
    noticeType: type,
    dateStr,
    note: String(note || '').trim()
  });

  return notice;
}

async function clearNotice({ parentId, studentId, date }) {
  const dateStr = formatSheetDate(date || todayStr());
  if (dateStr < todayStr()) {
    const err = new Error('Cannot clear a notice for a past date.');
    err.status = 400;
    throw err;
  }
  parentId = String(parentId || '').trim();
  studentId = String(studentId || '').trim();
  const owns = await parentHasStudent(parentId, studentId);
  if (!owns) {
    const err = new Error('Not your child.');
    err.status = 403;
    throw err;
  }
  const existing = await getNoticeForStudentDate(studentId, dateStr);
  if (!existing) return { ok: true, cleared: false };

  await updateRange(
    PARENT_ATTENDANCE_NOTICES_SHEET,
    'A' + existing._row + ':H' + existing._row,
    [new Array(8).fill('')]
  );
  invalidateSheetRowsCache(PARENT_ATTENDANCE_NOTICES_SHEET);
  return { ok: true, cleared: true };
}

module.exports = {
  ALL_NOTICE_TYPES,
  ATTENDANCE_NOTICE_TYPES,
  ensureNoticeSheet,
  listNotices,
  getNoticeForStudentDate,
  getParentNoticeView,
  validateNoticeDate,
  noticeDateBounds,
  schoolDayInfo,
  buildBusExclusionsForDate,
  submitNotice,
  clearNotice
};
