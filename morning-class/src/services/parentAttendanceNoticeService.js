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

async function listNotices({ dateStr, studentId, parentId } = {}) {
  await ensureNoticeSheet();
  const rows = await getSheetRows(PARENT_ATTENDANCE_NOTICES_SHEET);
  const out = [];
  const wantDate = dateStr ? formatSheetDate(dateStr) : '';
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const n = parseNotice(rows[i], i + 1);
    if (wantDate && n.dateStr !== wantDate) continue;
    if (studentId && n.studentId !== String(studentId)) continue;
    if (parentId && n.parentId !== String(parentId)) continue;
    out.push(n);
  }
  return out;
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
  const typeLabel =
    noticeType === 'pickup_only' ? 'Today: parent pickup (no bus)' : noticeType;
  const body = [
    '[Attendance notice] ' + typeLabel,
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
 * Parent submits today's notice. Applies immediately.
 * - 결석 / 지각 / 조퇴 → attendance + bus exclusion rules
 * - pickup_only → bus exclusion only (no attendance change)
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

  if (ATTENDANCE_NOTICE_TYPES.has(type) && student.classId) {
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
  buildBusExclusionsForDate,
  submitNotice,
  clearNotice
};
