const { STAMP_BOARD_SHEET, STAMPS_PER_DOLLAR } = require('./config');
const { getSheetRows, appendRows, deleteRow, invalidateSheetRowsCache } = require('./sheets');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
const { getEnrolledStudents } = require('./homeworkService');
const { applyDollarAdjustment } = require('./dollarService');
const { invalidateWorkCache } = require('./workCacheService');

const STAMPS_PER_COLUMN_MAX = 24;

function clampPct(n) {
  const margin = 3;
  return Math.max(margin, Math.min(100 - margin, Number(n) || 0));
}

function normalizeStampRow(row) {
  return {
    id: String(row.id),
    studentId: String(row.student_id || row.studentId),
    xPct: Number(row.x_pct != null ? row.x_pct : row.xPct),
    yPct: Number(row.y_pct != null ? row.y_pct : row.yPct),
    rotDeg: Number(row.rot_deg != null ? row.rot_deg : row.rotDeg) || 0
  };
}

async function readStampsFromSheet(classId) {
  const data = await getSheetRows(STAMP_BOARD_SHEET);
  const cid = String(classId);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== cid) continue;
    out.push(normalizeStampRow({
      id: data[i][5] || i,
      student_id: data[i][1],
      x_pct: data[i][2],
      y_pct: data[i][3],
      rot_deg: data[i][4]
    }));
  }
  return out;
}

async function getStampBoard(classId) {
  classId = String(classId);
  const students = await getEnrolledStudents(classId);
  let stamps = [];

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('stamp_board_stamps')
      .select('id, student_id, x_pct, y_pct, rot_deg')
      .eq('class_id', classId)
      .order('id');
    if (error) throw new Error(error.message);
    stamps = (data || []).map(normalizeStampRow);
  } else {
    stamps = await readStampsFromSheet(classId);
  }

  return { classId, students, stamps, stampsPerDollar: STAMPS_PER_DOLLAR };
}

async function insertStamp(classId, studentId, xPct, yPct, rotDeg) {
  classId = String(classId);
  studentId = String(studentId);
  xPct = clampPct(xPct);
  yPct = clampPct(yPct);
  rotDeg = Math.round(Number(rotDeg) || 0) % 360;

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('stamp_board_stamps').insert({
      class_id: classId,
      student_id: studentId,
      x_pct: xPct,
      y_pct: yPct,
      rot_deg: rotDeg
    }).select('id, student_id, x_pct, y_pct, rot_deg').single();
    if (error) throw new Error(error.message);
    afterStampWrite(classId);
    return normalizeStampRow(data);
  }

  const data = await getSheetRows(STAMP_BOARD_SHEET);
  const rowId = data.length;
  await appendRows(STAMP_BOARD_SHEET, [[classId, studentId, xPct, yPct, rotDeg, rowId]]);
  afterStampWrite(classId);
  return normalizeStampRow({ id: rowId, student_id: studentId, x_pct: xPct, y_pct: yPct, rot_deg: rotDeg });
}

function studentColumnFull(stamps, studentId) {
  return stamps.filter(function(s) { return s.studentId === studentId; }).length >= STAMPS_PER_COLUMN_MAX;
}

function boardNeedsAutoRedeem(stamps, studentIds) {
  for (let i = 0; i < studentIds.length; i++) {
    if (studentColumnFull(stamps, studentIds[i])) return true;
  }
  return false;
}

async function deleteStampsForStudents(classId, studentIds) {
  if (!studentIds.length) return;
  classId = String(classId);

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('stamp_board_stamps')
      .delete()
      .eq('class_id', classId)
      .in('student_id', studentIds);
    if (error) throw new Error(error.message);
    return;
  }

  const data = await getSheetRows(STAMP_BOARD_SHEET);
  const remove = new Set(studentIds.map(String));
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === classId && remove.has(String(data[i][1]))) {
      await deleteRow(STAMP_BOARD_SHEET, i + 1);
    }
  }
}

async function insertRemainderStamps(classId, studentId, count) {
  const positions = [
    { x: 15, y: 15 }, { x: 35, y: 15 }, { x: 55, y: 15 }, { x: 75, y: 15 }
  ];
  for (let i = 0; i < count && i < positions.length; i++) {
    await insertStamp(classId, studentId, positions[i].x, positions[i].y, -8 + i * 5);
  }
}

async function redeemStampBoard(classId, opts) {
  classId = String(classId);
  const options = opts || {};
  const board = await getStampBoard(classId);
  const awards = [];

  for (let i = 0; i < board.students.length; i++) {
    const student = board.students[i];
    const count = board.stamps.filter(s => s.studentId === student.id).length;
    if (!count) continue;

    const dollars = Math.floor(count / STAMPS_PER_DOLLAR);
    const remainder = count % STAMPS_PER_DOLLAR;

    await deleteStampsForStudents(classId, [student.id]);

    if (dollars > 0) {
      const result = await applyDollarAdjustment(
        classId,
        student.id,
        dollars,
        options.reason || 'stamp-board'
      );
      awards.push({
        studentId: student.id,
        name: student.name,
        stampCount: count,
        dollars,
        newBalance: result.newBalance
      });
    }

    if (remainder > 0) {
      await insertRemainderStamps(classId, student.id, remainder);
    }
  }

  afterStampWrite(classId);
  const refreshed = await getStampBoard(classId);
  return { redeemed: true, awards, board: refreshed };
}

async function addStamp(classId, studentId, xPct, yPct, rotDeg) {
  classId = String(classId);
  const stamp = await insertStamp(classId, studentId, xPct, yPct, rotDeg);
  const board = await getStampBoard(classId);
  const studentIds = board.students.map(s => s.id);
  const stampsAfter = board.stamps.concat([stamp]);

  if (boardNeedsAutoRedeem(stampsAfter, studentIds)) {
    const redemption = await redeemStampBoard(classId, { reason: 'stamp-board-auto' });
    return {
      stamp,
      boardFull: true,
      redemption
    };
  }

  afterStampWrite(classId);
  return { stamp, boardFull: false };
}

async function removeStamp(classId, stampId) {
  classId = String(classId);
  stampId = String(stampId);

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('stamp_board_stamps')
      .delete()
      .eq('class_id', classId)
      .eq('id', stampId);
    if (error) throw new Error(error.message);
  } else {
    const data = await getSheetRows(STAMP_BOARD_SHEET);
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === classId && String(data[i][5]) === stampId) {
        await deleteRow(STAMP_BOARD_SHEET, i + 1);
        break;
      }
    }
  }

  afterStampWrite(classId);
  return { ok: true };
}

function afterStampWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(STAMP_BOARD_SHEET);
}

module.exports = {
  getStampBoard,
  addStamp,
  removeStamp,
  redeemStampBoard,
  STAMPS_PER_DOLLAR
};
