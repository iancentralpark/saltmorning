const { STAMP_BOARD_SHEET, STAMPS_PER_DOLLAR, STAMPS_PER_COLUMN_MAX } = require('./config');
const { getSheetRows, appendRows, deleteRow, invalidateSheetRowsCache } = require('./sheets');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
const { getEnrolledStudents } = require('./homeworkService');
const { applyDollarAdjustmentsBatch } = require('./dollarService');
const { invalidateWorkCache } = require('./workCacheService');

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

async function deleteAllClassStamps(classId) {
  classId = String(classId);

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('stamp_board_stamps')
      .delete()
      .eq('class_id', classId);
    if (error) throw new Error(error.message);
    return;
  }

  const data = await getSheetRows(STAMP_BOARD_SHEET);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === classId) {
      await deleteRow(STAMP_BOARD_SHEET, i + 1);
    }
  }
}

function buildRemainderInsertRows(classId, studentId, count) {
  const positions = [
    { x: 15, y: 15 }, { x: 35, y: 15 }, { x: 55, y: 15 }, { x: 75, y: 15 }
  ];
  const rows = [];
  for (let i = 0; i < count && i < positions.length; i++) {
    rows.push({
      class_id: String(classId),
      student_id: String(studentId),
      x_pct: positions[i].x,
      y_pct: positions[i].y,
      rot_deg: -8 + i * 5
    });
  }
  return rows;
}

async function batchInsertStamps(rows) {
  if (!rows.length) return [];

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('stamp_board_stamps')
      .insert(rows)
      .select('id, student_id, x_pct, y_pct, rot_deg');
    if (error) throw new Error(error.message);
    return (data || []).map(normalizeStampRow);
  }

  const sheetData = await getSheetRows(STAMP_BOARD_SHEET);
  let rowId = sheetData.length;
  const sheetRows = rows.map(function(r, idx) {
    return [r.class_id, r.student_id, r.x_pct, r.y_pct, r.rot_deg, rowId + idx];
  });
  await appendRows(STAMP_BOARD_SHEET, sheetRows);
  return sheetRows.map(function(row) {
    return normalizeStampRow({
      id: row[5],
      student_id: row[1],
      x_pct: row[2],
      y_pct: row[3],
      rot_deg: row[4]
    });
  });
}

async function redeemStampBoard(classId, opts) {
  classId = String(classId);
  const options = opts || {};
  const board = await getStampBoard(classId);
  const awards = [];
  const dollarAdjustments = [];
  const remainderRows = [];
  let hasStamps = false;

  for (let i = 0; i < board.students.length; i++) {
    const student = board.students[i];
    const count = board.stamps.filter(function(s) { return String(s.studentId) === String(student.id); }).length;
    if (!count) continue;
    hasStamps = true;

    const dollars = Math.floor(count / STAMPS_PER_DOLLAR);
    const remainder = count % STAMPS_PER_DOLLAR;

    if (dollars > 0) {
      dollarAdjustments.push({ studentId: student.id, amount: dollars });
      awards.push({
        studentId: student.id,
        name: student.name,
        stampCount: count,
        stampsUsed: dollars * STAMPS_PER_DOLLAR,
        remainder: remainder,
        dollars: dollars,
        newBalance: null
      });
    }

    if (remainder > 0) {
      remainderRows.push.apply(remainderRows, buildRemainderInsertRows(classId, student.id, remainder));
    }
  }

  if (!hasStamps) {
    return { redeemed: true, awards: [], board: board };
  }

  await deleteAllClassStamps(classId);

  const [balanceResults, remainderStamps] = await Promise.all([
    applyDollarAdjustmentsBatch(classId, dollarAdjustments, options.reason || 'stamp-board'),
    batchInsertStamps(remainderRows)
  ]);

  const balanceByStudent = {};
  (balanceResults || []).forEach(function(row) {
    balanceByStudent[String(row.studentId)] = row.newBalance;
  });
  awards.forEach(function(award) {
    if (balanceByStudent[String(award.studentId)] != null) {
      award.newBalance = balanceByStudent[String(award.studentId)];
    }
  });

  afterStampWrite(classId);
  return {
    redeemed: true,
    awards: awards,
    board: {
      classId: classId,
      students: board.students,
      stamps: remainderStamps,
      stampsPerDollar: STAMPS_PER_DOLLAR
    }
  };
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

async function syncStampBoard(classId, adds, removes) {
  classId = String(classId);
  const addList = Array.isArray(adds) ? adds : [];
  const removeList = (Array.isArray(removes) ? removes : [])
    .map(String)
    .filter(function(id) { return /^\d+$/.test(id); });

  const inserted = [];

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    if (removeList.length) {
      const { error } = await db.from('stamp_board_stamps')
        .delete()
        .eq('class_id', classId)
        .in('id', removeList);
      if (error) throw new Error(error.message);
    }
    if (addList.length) {
      const rows = addList.map(function(a) {
        return {
          class_id: classId,
          student_id: String(a.studentId),
          x_pct: clampPct(a.xPct),
          y_pct: clampPct(a.yPct),
          rot_deg: Math.round(Number(a.rotDeg) || 0) % 360
        };
      });
      const { data, error } = await db.from('stamp_board_stamps')
        .insert(rows)
        .select('id, student_id, x_pct, y_pct, rot_deg');
      if (error) throw new Error(error.message);
      (data || []).forEach(function(row, i) {
        inserted.push({
          clientId: addList[i] && addList[i].clientId,
          stamp: normalizeStampRow(row)
        });
      });
    }
  } else {
    for (let i = 0; i < removeList.length; i++) {
      await removeStamp(classId, removeList[i]);
    }
    for (let j = 0; j < addList.length; j++) {
      const a = addList[j];
      const stamp = await insertStamp(classId, a.studentId, a.xPct, a.yPct, a.rotDeg);
      inserted.push({ clientId: a.clientId, stamp: stamp });
    }
    return { added: inserted };
  }

  afterStampWrite(classId);
  return { added: inserted };
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
  syncStampBoard,
  STAMPS_PER_DOLLAR
};
