const { STUDENT_LIST_SHEET, STUDENT_WITHDRAWN_SHEET } = require('./config');
const { getSheetRows, appendRows, updateRange } = require('./sheets');
const { cacheDelete, cacheDeletePrefix } = require('./cache');
const { invalidateWorkCache } = require('./workCacheService');

const LOGIN_ID_COL = 4;
const LOGIN_PW_COL = 5;

async function ensureStudentLoginColumns() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  if (!data.length) return;
  const header = data[0] || [];
  const needsId = String(header[LOGIN_ID_COL] || '').trim() !== 'LoginID';
  const needsPw = String(header[LOGIN_PW_COL] || '').trim() !== 'LoginPassword';
  if (!needsId && !needsPw) return;
  const next = header.slice();
  while (next.length <= LOGIN_PW_COL) next.push('');
  if (needsId) next[LOGIN_ID_COL] = 'LoginID';
  if (needsPw) next[LOGIN_PW_COL] = 'LoginPassword';
  await updateRange(STUDENT_LIST_SHEET, 'A1:F1', [next]);
}

async function buildClassStudentDirectory(classId, ctx) {
  classId = String(classId);
  const nameMap = {};
  const statusMap = {};

  async function loadStudents() {
    if (ctx && typeof ctx.sheetRows === 'function') {
      return ctx.sheetRows(STUDENT_LIST_SHEET);
    }
    return getSheetRows(STUDENT_LIST_SHEET);
  }

  async function loadWithdrawn() {
    if (ctx && typeof ctx.sheetRows === 'function') {
      return ctx.sheetRows(STUDENT_WITHDRAWN_SHEET);
    }
    return getSheetRows(STUDENT_WITHDRAWN_SHEET);
  }

  const data = await loadStudents();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    const sid = String(data[i][0]);
    nameMap[sid] = String(data[i][1] || sid);
    statusMap[sid] = String(data[i][3] || '').trim() || 'Enrolled';
  }

  try {
    const withdrawn = await loadWithdrawn();
    for (let i = 1; i < withdrawn.length; i++) {
      if (String(withdrawn[i][3]) !== classId) continue;
      const sid = String(withdrawn[i][1]);
      if (!nameMap[sid]) nameMap[sid] = String(withdrawn[i][2] || sid);
      if (!statusMap[sid] || statusMap[sid] === 'Withdrawn') statusMap[sid] = 'Withdrawn';
    }
  } catch (e) { /* sheet may not exist yet */ }

  return { nameMap, statusMap };
}

function parseStudentIdNumber_(studentId) {
  const m = String(studentId || '').match(/^S(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

async function collectUsedStudentIds_() {
  const used = new Set();
  let maxNum = 0;

  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][0] || '').trim();
    if (!sid) continue;
    used.add(sid);
    const num = parseStudentIdNumber_(sid);
    if (num != null) maxNum = Math.max(maxNum, num);
  }

  try {
    const withdrawn = await getSheetRows(STUDENT_WITHDRAWN_SHEET);
    for (let i = 1; i < withdrawn.length; i++) {
      const sid = String(withdrawn[i][1] || '').trim();
      if (!sid) continue;
      used.add(sid);
      const num = parseStudentIdNumber_(sid);
      if (num != null) maxNum = Math.max(maxNum, num);
    }
  } catch (e) { /* sheet may not exist yet */ }

  return { used, maxNum };
}

/** Next Student_ID across all classes — never reuse an existing S### id. */
async function generateNextStudentId() {
  const { used, maxNum } = await collectUsedStudentIds_();
  let nextNum = maxNum + 1;
  let candidate;
  do {
    candidate = 'S' + String(nextNum).padStart(3, '0');
    nextNum += 1;
  } while (used.has(candidate));
  return candidate;
}

async function addEnrolledStudent(classId, name, loginId, loginPassword) {
  classId = String(classId || '').trim();
  name = String(name || '').trim();
  loginId = String(loginId || '').trim();
  loginPassword = String(loginPassword || '').trim();
  if (!classId || !name) throw new Error('Class and student name are required.');

  await ensureStudentLoginColumns();
  const data = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    if (String(data[i][1] || '').trim().toLowerCase() === name.toLowerCase() &&
        String(data[i][3] || '').trim() === 'Enrolled') {
      throw new Error('A student with this name is already enrolled.');
    }
  }

  const studentId = await generateNextStudentId();
  let maxSort = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    if (String(data[i][3] || '').trim() !== 'Enrolled') continue;
    maxSort = Math.max(maxSort, Number(data[i][6]) || 0);
  }
  await appendRows(STUDENT_LIST_SHEET, [[studentId, name, classId, 'Enrolled', loginId, loginPassword, maxSort + 1]]);

  invalidateWorkCache(classId);
  cacheDeletePrefix('sidebar_v1_');
  cacheDelete('classes_v1');
  cacheDelete('portal_logins_v1_' + classId);

  return {
    studentId,
    name,
    classId,
    message: name + ' (' + studentId + ') added to the class.'
  };
}

async function reorderClassStudents(classId, studentIds) {
  classId = String(classId || '').trim();
  const orderedIds = (Array.isArray(studentIds) ? studentIds : [])
    .map(function(id) { return String(id || '').trim(); })
    .filter(Boolean);
  if (!classId) throw new Error('classId is required.');
  if (!orderedIds.length) throw new Error('studentIds are required.');

  const data = await getSheetRows(STUDENT_LIST_SHEET, { skipCache: true });
  const enrolledIds = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    if (String(data[i][3] || '').trim() !== 'Enrolled') continue;
    enrolledIds.push(String(data[i][0]));
  }
  const enrolledSet = new Set(enrolledIds);
  for (let i = 0; i < orderedIds.length; i++) {
    if (!enrolledSet.has(orderedIds[i])) {
      throw new Error('Student not enrolled in this class: ' + orderedIds[i]);
    }
  }
  const finalOrder = orderedIds.slice();
  enrolledIds.forEach(function(id) {
    if (finalOrder.indexOf(id) < 0) finalOrder.push(id);
  });

  const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    for (let i = 0; i < finalOrder.length; i++) {
      const { error } = await db
        .from('students')
        .update({ sort_order: i })
        .eq('id', finalOrder[i])
        .eq('class_id', classId);
      if (error) throw new Error(error.message);
    }
  } else {
    const { updateRange } = require('./sheets');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][2]) !== classId) continue;
      const sid = String(data[i][0]);
      const idx = finalOrder.indexOf(sid);
      if (idx < 0) continue;
      await updateRange(STUDENT_LIST_SHEET, 'G' + (i + 1), [[idx]]);
    }
  }

  const { invalidateSheetRowsCache } = require('./sheets');
  invalidateSheetRowsCache(STUDENT_LIST_SHEET);
  invalidateWorkCache(classId);
  cacheDeletePrefix('sidebar_v1_');
  cacheDelete('portal_logins_v1_' + classId);

  return {
    ok: true,
    classId: classId,
    studentIds: finalOrder,
    message: 'Student order saved.'
  };
}

module.exports = {
  buildClassStudentDirectory,
  addEnrolledStudent,
  reorderClassStudents,
  ensureStudentLoginColumns
};
