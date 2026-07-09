const {
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  CHAMBIT_WEEK_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRow, deleteRows, invalidateSheetRowsCache } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
const { getHolidayName, getHolidaysForMonth } = require('./holiday');
const { syncChambitToClassLog } = require('./classLogService');
const { getEnrolledStudents } = require('./homeworkService');
const {
  formatSheetDate,
  formatDateTimeNow,
  chambitWeekMonday,
  chambitWeekSunday,
  chambitAddDays,
  chambitParseDate
} = require('./dateUtils');

function chambitNormalizeAllowedDays(allowedDays) {
  if (!allowedDays) return [];
  if (Array.isArray(allowedDays)) {
    return allowedDays.map(n => Number(n)).filter(n => !isNaN(n));
  }
  return String(allowedDays).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
}

async function chambitGetRequiredDatesInWeek(weekMonday, allowedDays) {
  const days = chambitNormalizeAllowedDays(allowedDays);
  const weekEnd = chambitAddDays(weekMonday, 6);
  const startParts = chambitParseDate(weekMonday);
  const endParts = chambitParseDate(weekEnd);

  let holidayMap = await getHolidaysForMonth(startParts.y, startParts.m + 1);
  if (endParts.y !== startParts.y || endParts.m !== startParts.m) {
    const endHolidays = await getHolidaysForMonth(endParts.y, endParts.m + 1);
    holidayMap = Object.assign({}, holidayMap, endHolidays);
  }

  const required = [];
  for (let i = 0; i < 7; i++) {
    const ds = chambitAddDays(weekMonday, i);
    const p = chambitParseDate(ds);
    const dow = new Date(p.y, p.m, p.d).getDay();
    if (!days.includes(dow)) continue;
    if (holidayMap[ds]) continue;
    required.push(ds);
  }
  return required;
}

async function chambitReadDailySetForStudent(studentId, classId, weekMonday, weekSunday) {
  const data = await getSheetRows(CHAMBIT_DAILY_SHEET);
  const sid = String(studentId);
  const cid = String(classId);
  const set = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== sid || String(data[i][1]) !== cid) continue;
    const ds = formatSheetDate(data[i][0]);
    if (ds >= weekMonday && ds <= weekSunday) set[ds] = true;
  }
  return set;
}

async function chambitIsWeekComplete(studentId, classId, weekMonday, allowedDays) {
  const required = await chambitGetRequiredDatesInWeek(weekMonday, allowedDays);
  if (!required.length) return false;
  const readSet = await chambitReadDailySetForStudent(
    studentId, classId, weekMonday, chambitWeekSunday(weekMonday)
  );
  return required.every(ds => readSet[ds]);
}

function afterChambitWrite(classId, dateStr) {
  cacheDeletePrefix('sidebar_v1_');
  if (classId) invalidateWorkCache(classId, dateStr || undefined);
  invalidateSheetRowsCache(CHAMBIT_DAILY_SHEET);
  invalidateSheetRowsCache(CHAMBIT_COMBO_SHEET);
  invalidateSheetRowsCache(CHAMBIT_WEEK_SHEET);
}

async function lookupStudentClassId(studentId) {
  if (!isSupabaseEnabled()) return null;
  const db = getSupabase();
  const { data, error } = await db.from('students').select('class_id').eq('id', String(studentId)).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.class_id || '') : null;
}

async function chambitGetComboCount(studentId) {
  const sid = String(studentId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('chambit_combo').select('combo_count').eq('student_id', sid).maybeSingle();
    if (error) throw new Error(error.message);
    return Number(data?.combo_count) || 0;
  }
  const data = await getSheetRows(CHAMBIT_COMBO_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) return Number(data[i][1]) || 0;
  }
  return 0;
}

async function chambitSetComboCount(studentId, count) {
  const now = formatDateTimeNow(TIMEZONE);
  const sid = String(studentId);
  const safe = Math.max(0, Math.min(5, Number(count) || 0));
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('chambit_combo').upsert({
      student_id: sid,
      combo_count: safe,
      updated_at: now
    }, { onConflict: 'student_id' });
    if (error) throw new Error(error.message);
    const classId = await lookupStudentClassId(sid);
    afterChambitWrite(classId);
    return safe;
  }
  const data = await getSheetRows(CHAMBIT_COMBO_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) {
      await updateRange(CHAMBIT_COMBO_SHEET, `B${i + 1}:C${i + 1}`, [[safe, now]]);
      return safe;
    }
  }
  await appendRows(CHAMBIT_COMBO_SHEET, [[studentId, safe, now]]);
  return safe;
}

async function chambitIncrementCombo(studentId) {
  const current = await chambitGetComboCount(studentId);
  const next = current >= 5 ? 1 : current + 1;
  return chambitSetComboCount(studentId, next);
}

async function chambitHasWeekAward(studentId, weekKey) {
  const sid = String(studentId);
  const wk = String(weekKey);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('chambit_week_awards')
      .select('student_id')
      .eq('student_id', sid)
      .eq('week_key', wk)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  }
  const data = await getSheetRows(CHAMBIT_WEEK_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid && String(data[i][1]) === wk) return true;
  }
  return false;
}

async function chambitMarkWeekAward(studentId, weekKey) {
  if (await chambitHasWeekAward(studentId, weekKey)) return;
  const now = formatDateTimeNow(TIMEZONE);
  const sid = String(studentId);
  const wk = String(weekKey);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('chambit_week_awards').upsert({
      student_id: sid,
      week_key: wk,
      awarded_at: now
    }, { onConflict: 'student_id,week_key' });
    if (error) throw new Error(error.message);
    return;
  }
  await appendRows(CHAMBIT_WEEK_SHEET, [[studentId, weekKey, now]]);
}

async function chambitClearWeekAwards(studentId) {
  const sid = String(studentId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('chambit_week_awards').delete().eq('student_id', sid);
    if (error) throw new Error(error.message);
    return;
  }
  const data = await getSheetRows(CHAMBIT_WEEK_SHEET);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) rows.push(i + 1);
  }
  await deleteRows(CHAMBIT_WEEK_SHEET, rows);
}

async function chambitSetDailyRead(classId, studentId, dateStr, read) {
  const ds = formatSheetDate(dateStr);
  const sid = String(studentId);
  const cid = String(classId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    if (read) {
      const { error } = await db.from('chambit_daily').upsert({
        record_date: ds,
        class_id: cid,
        student_id: sid
      }, { onConflict: 'record_date,class_id,student_id' });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from('chambit_daily').delete().match({
        record_date: ds,
        class_id: cid,
        student_id: sid
      });
      if (error) throw new Error(error.message);
    }
    afterChambitWrite(cid, ds);
    return;
  }
  const data = await getSheetRows(CHAMBIT_DAILY_SHEET);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (formatSheetDate(data[i][0]) === ds &&
        String(data[i][1]) === cid &&
        String(data[i][2]) === sid) {
      foundRow = i + 1;
      break;
    }
  }
  if (read) {
    if (foundRow === -1) await appendRows(CHAMBIT_DAILY_SHEET, [[ds, classId, studentId]]);
  } else if (foundRow !== -1) {
    await deleteRow(CHAMBIT_DAILY_SHEET, foundRow);
  }
}

async function chambitWeekProgress(studentId, classId, weekMonday, requiredDates) {
  if (!requiredDates || !requiredDates.length) return { read: 0, required: 0 };
  const readSet = await chambitReadDailySetForStudent(
    studentId, classId, weekMonday, chambitWeekSunday(weekMonday)
  );
  let read = 0;
  for (const ds of requiredDates) {
    if (readSet[ds]) read++;
  }
  return { read, required: requiredDates.length };
}

async function setChambitComboManual(studentId, comboCount) {
  const count = Math.round(Number(comboCount));
  if (!Number.isFinite(count) || count < 0 || count > 5) {
    throw new Error('Combo must be between 0 and 5.');
  }
  const safe = await chambitSetComboCount(studentId, count);
  return { studentId, chambitCombo: safe };
}

async function chambitSyncClassLog(classId, studentId, dateStr, read) {
  try {
    dateStr = formatSheetDate(dateStr);
    const enrolled = await getEnrolledStudents(classId);
    const student = enrolled.find(s => String(s.id) === String(studentId));
    if (!student) return { synced: false };
    return await syncChambitToClassLog(classId, student.name, dateStr, read);
  } catch (e) {
    console.warn('Class log Chambit sync:', e.message);
    return { synced: false, error: e.message };
  }
}

async function toggleChambitRead(classId, studentId, dateStr, action, allowedDays) {
  dateStr = formatSheetDate(dateStr);
  if (!dateStr) throw new Error('Date is required.');
  if (await getHolidayName(dateStr)) throw new Error('No class on public holidays.');

  const days = chambitNormalizeAllowedDays(allowedDays);
  const p = chambitParseDate(dateStr);
  const dow = new Date(p.y, p.m, p.d).getDay();
  if (!days.includes(dow)) throw new Error('Not a scheduled class day.');

  const act = String(action || '').toLowerCase();
  if (act === 'plus' || act === '+') {
    await chambitSetDailyRead(classId, studentId, dateStr, true);
    const weekKey = chambitWeekMonday(dateStr);
    let combo = await chambitGetComboCount(studentId);
    let weekCompleted = false;
    if (await chambitIsWeekComplete(studentId, classId, weekKey, allowedDays) &&
        !(await chambitHasWeekAward(studentId, weekKey))) {
      combo = await chambitIncrementCombo(studentId);
      await chambitMarkWeekAward(studentId, weekKey);
      weekCompleted = true;
    }
    const weekMonday = chambitWeekMonday(dateStr);
    const weekRequired = await chambitGetRequiredDatesInWeek(weekMonday, allowedDays);
    const weekProg = await chambitWeekProgress(studentId, classId, weekMonday, weekRequired);
    afterChambitWrite(classId, dateStr);
    const classLog = await chambitSyncClassLog(classId, studentId, dateStr, true);
    return {
      studentId,
      chambitRead: true,
      chambitCombo: combo,
      chambitWeekRead: weekProg.read,
      chambitWeekRequired: weekProg.required,
      weekCompleted,
      classLogSynced: !!(classLog && classLog.synced)
    };
  }

  if (act === 'minus' || act === '-') {
    await chambitSetDailyRead(classId, studentId, dateStr, false);
    await chambitSetComboCount(studentId, 0);
    await chambitClearWeekAwards(studentId);
    const weekMonday = chambitWeekMonday(dateStr);
    const weekRequired = await chambitGetRequiredDatesInWeek(weekMonday, allowedDays);
    const weekProg = await chambitWeekProgress(studentId, classId, weekMonday, weekRequired);
    afterChambitWrite(classId, dateStr);
    const classLog = await chambitSyncClassLog(classId, studentId, dateStr, false);
    return {
      studentId,
      chambitRead: false,
      chambitCombo: 0,
      chambitWeekRead: weekProg.read,
      chambitWeekRequired: weekProg.required,
      weekCompleted: false,
      classLogSynced: !!(classLog && classLog.synced)
    };
  }

  throw new Error('Use + or - for Chambit.');
}

module.exports = { toggleChambitRead, setChambitComboManual };
