const {
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  CHAMBIT_WEEK_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRow, deleteRows } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { getHolidayName } = require('./holiday');
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
  const required = [];
  for (let i = 0; i < 7; i++) {
    const ds = chambitAddDays(weekMonday, i);
    const p = chambitParseDate(ds);
    const dow = new Date(p.y, p.m, p.d).getDay();
    if (!days.includes(dow)) continue;
    if (await getHolidayName(ds)) continue;
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

async function chambitGetComboCount(studentId) {
  const data = await getSheetRows(CHAMBIT_COMBO_SHEET);
  const sid = String(studentId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) return Number(data[i][1]) || 0;
  }
  return 0;
}

async function chambitSetComboCount(studentId, count) {
  const data = await getSheetRows(CHAMBIT_COMBO_SHEET);
  const now = formatDateTimeNow(TIMEZONE);
  const sid = String(studentId);
  const safe = Math.max(0, Math.min(5, Number(count) || 0));
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
  const data = await getSheetRows(CHAMBIT_WEEK_SHEET);
  const sid = String(studentId);
  const wk = String(weekKey);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid && String(data[i][1]) === wk) return true;
  }
  return false;
}

async function chambitMarkWeekAward(studentId, weekKey) {
  if (await chambitHasWeekAward(studentId, weekKey)) return;
  const now = formatDateTimeNow(TIMEZONE);
  await appendRows(CHAMBIT_WEEK_SHEET, [[studentId, weekKey, now]]);
}

async function chambitClearWeekAwards(studentId) {
  const data = await getSheetRows(CHAMBIT_WEEK_SHEET);
  const sid = String(studentId);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) rows.push(i + 1);
  }
  await deleteRows(CHAMBIT_WEEK_SHEET, rows);
}

async function chambitSetDailyRead(classId, studentId, dateStr, read) {
  const data = await getSheetRows(CHAMBIT_DAILY_SHEET);
  const ds = formatSheetDate(dateStr);
  const sid = String(studentId);
  const cid = String(classId);
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
  cacheDeletePrefix('sidebar_v1_');
  return { studentId, chambitCombo: safe };
}

async function chambitSyncClassLog(classId, studentId, dateStr, read) {
  try {
    const students = await getEnrolledStudents(classId);
    const student = students.find(s => String(s.id) === String(studentId));
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
    cacheDeletePrefix('sidebar_v1_');
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
    cacheDeletePrefix('sidebar_v1_');
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
