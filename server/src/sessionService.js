const {
  TIMEZONE,
  CACHE_SEC,
  DOLLAR_SHEETS,
  TEXTBOOK_SHEETS,
  HOMEWORK_SHEETS,
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CHAMBIT_DAILY_SHEET,
  CHAMBIT_COMBO_SHEET,
  LUCKY_DRAW_SHEET,
  STUDENT_LEAVE_SHEET,
  STUDENT_PLANNED_ATTENDANCE_SHEET,
  MAKEUP_SHEET,
  ATTENDANCE_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  STUDENT_WITHDRAWN_SHEET,
  MANUAL_PENDING_SHEET
} = require('./config');
const { cacheGet, cacheSet } = require('./cache');
const { buildRequestContext } = require('./sheets');
const { runBatched } = require('./supabaseBatch');
const { isSupabaseEnabled } = require('./supabaseClient');
const { getHolidayName, getHolidaysForMonth } = require('./holiday');
const { buildPendingHomeworkCountsFromCtx } = require('./homeworkService');
const {
  formatSheetDate,
  formatDateStr,
  parseHomeworkDate,
  chambitWeekMonday,
  chambitWeekSunday,
  chambitAddDays,
  calcWeekNumber,
  calcExpectedFinishDate,
  formatDateInTz
} = require('./dateUtils');
const { resolveSharedClassVideoFromRows } = require('./youtube');
const { buildClassHomeworkFromCtx } = require('./homeworkService');
const { buildClassStudentDirectory } = require('./studentListService');

const { getWorkCache, setWorkCache } = require('./workCacheService');

function sessionContextOptions(classId, dateStr) {
  if (!isSupabaseEnabled()) return undefined;
  const opts = { supabaseFilter: true };
  if (dateStr) opts.dateStr = String(dateStr);
  return opts;
}

async function prefetchCtxSheets(ctx, sheetNames) {
  const unique = [];
  const seen = {};
  (sheetNames || []).forEach(function(name) {
    if (!name || seen[name]) return;
    seen[name] = true;
    unique.push(name);
  });
  await runBatched(unique, function(name) { return ctx.sheetRows(name); }, 5);
}

const SIDEBAR_SHEETS = [
  RULES_SHEET, STUDENT_LIST_SHEET, STUDENT_WITHDRAWN_SHEET, LIBRARY_SHEET,
  ANNOUNCE_SHEET, EVENTS_SHEET, VIDEO_SHEET, MAKEUP_SHEET
];

const WORK_SHEETS = [
  STUDENT_LIST_SHEET, ATTENDANCE_SHEET, DOLLAR_SHEETS.BALANCES,
  CHAMBIT_DAILY_SHEET, CHAMBIT_COMBO_SHEET, LUCKY_DRAW_SHEET,
  STUDENT_LEAVE_SHEET, STUDENT_PLANNED_ATTENDANCE_SHEET, CLASS_LIST_SHEET,
  TEXTBOOK_SHEETS.BOOKS, TEXTBOOK_SHEETS.PROGRESS, TEXTBOOK_SHEETS.QUEUE,
  HOMEWORK_SHEETS.MAP, HOMEWORK_SHEETS.LOG, HOMEWORK_SHEETS.ITEMS,
  HOMEWORK_SHEETS.COMPLETION, MANUAL_PENDING_SHEET
];

const SESSION_SHEETS = (function() {
  const seen = {};
  const out = [];
  SIDEBAR_SHEETS.concat(WORK_SHEETS).forEach(function(name) {
    if (!seen[name]) {
      seen[name] = true;
      out.push(name);
    }
  });
  return out;
})();

function parseRulesText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

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
  const startParts = weekMonday.split('-');
  const endParts = weekEnd.split('-');
  const startYear = Number(startParts[0]);
  const startMonth = Number(startParts[1]);
  const endYear = Number(endParts[0]);
  const endMonth = Number(endParts[1]);

  let holidayMap = await getHolidaysForMonth(startYear, startMonth);
  if (endYear !== startYear || endMonth !== startMonth) {
    const endHolidays = await getHolidaysForMonth(endYear, endMonth);
    holidayMap = Object.assign({}, holidayMap, endHolidays);
  }

  const required = [];
  for (let i = 0; i < 7; i++) {
    const ds = chambitAddDays(weekMonday, i);
    const p = ds.split('-');
    const dow = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
    if (!days.includes(dow)) continue;
    if (holidayMap[ds]) continue;
    required.push(ds);
  }
  return required;
}

function getEnrolledStudentsFromRows(studentData, classId) {
  const idStr = String(classId);
  const out = [];
  for (let i = 1; i < studentData.length; i++) {
    if (String(studentData[i][2]) === idStr && String(studentData[i][3] || '').trim() === 'Enrolled') {
      out.push({ id: String(studentData[i][0]), name: String(studentData[i][1] || '') });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function isDateInLeaveRange(dateStr, startDate, endDate) {
  return dateStr >= startDate && dateStr <= endDate;
}

function buildLuckyMapFromRows(data, classId) {
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const sid = String(data[i][2]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

function buildAllActiveLeavesFromRows(data, classId) {
  const today = formatSheetDate(new Date());
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== 'Active') continue;
    const leave = {
      leaveId: String(data[i][0]),
      studentId: String(data[i][1]),
      startDate: formatSheetDate(data[i][4]),
      endDate: formatSheetDate(data[i][5]),
      reason: String(data[i][6] || '')
    };
    if (leave.endDate < today) continue;
    map[leave.studentId] = leave;
  }
  return map;
}

function filterLeavesByDate(allLeaves, dateStr) {
  dateStr = formatSheetDate(dateStr);
  const map = {};
  Object.keys(allLeaves).forEach(function(studentId) {
    const leave = allLeaves[studentId];
    if (isDateInLeaveRange(dateStr, leave.startDate, leave.endDate)) {
      map[studentId] = leave;
    }
  });
  return map;
}

function buildPlannedMapFromRows(data, classId, dateStr) {
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][3]) !== classId) continue;
    if (String(data[i][7]) !== 'Active') continue;
    const rowDate = formatSheetDate(data[i][4]);
    if (dateStr && rowDate !== formatSheetDate(dateStr)) continue;
    map[String(data[i][1])] = {
      noticeId: String(data[i][0]),
      type: String(data[i][5] || ''),
      note: String(data[i][6] || '')
    };
  }
  return map;
}

function buildUpcomingMakeupEventsFromRows(data, classId) {
  const today = formatDateInTz(new Date(), TIMEZONE);
  const events = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const status = String(data[i][9] || '');
    const date = formatSheetDate(data[i][4]);
    if (status !== 'Scheduled' || date < today) continue;
    const studentName = String(data[i][3] || '');
    const startTime = String(data[i][5] || '');
    const endTime = String(data[i][6] || '');
    const notes = String(data[i][8] || '').trim();
    events.push({
      eventId: String(data[i][0]),
      eventDate: date,
      description: 'Makeup: ' + studentName + ' · ' + startTime + '–' + endTime +
        (notes ? ' — ' + notes : ''),
      type: 'makeup',
      makeupId: String(data[i][0]),
      studentId: String(data[i][2]),
      studentName,
      startTime,
      endTime,
      status
    });
  }
  return events;
}

function isQueueItemReady(item) {
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!String(item.name || '').trim()) return false;
  if (!allowed.includes(String(item.type || '').trim())) return false;
  const total = Number(item.totalUnits);
  return Number.isFinite(total) && total > 0;
}

async function buildClassSidebarFromCtx(ctx) {
  const classId = ctx.classId;
  const today = formatDateInTz(new Date(), TIMEZONE);

  let rulesResult = { rules: [], rulesText: '' };
  const rulesRows = await ctx.sheetRows(RULES_SHEET);
  for (let i = 1; i < rulesRows.length; i++) {
    if (String(rulesRows[i][0]) !== classId) continue;
    let rulesText = rulesRows[i][1] == null ? '' : String(rulesRows[i][1]);
    rulesResult = { rules: parseRulesText(rulesText), rulesText };
    break;
  }

  const { nameMap } = await buildClassStudentDirectory(classId, ctx);

  const byStudent = {};
  const libRows = await ctx.sheetRows(LIBRARY_SHEET);
  for (let i = 1; i < libRows.length; i++) {
    if (String(libRows[i][1]) !== classId) continue;
    if (String(libRows[i][4]) === 'Returned') continue;
    const sid = String(libRows[i][2]);
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push({ bookId: String(libRows[i][0]), title: String(libRows[i][3] || '') });
  }
  const booksStudents = Object.keys(byStudent).map(sid => ({
    studentId: sid,
    studentName: nameMap[sid] || sid,
    books: byStudent[sid]
  })).sort((a, b) => a.studentName.localeCompare(b.studentName));

  let announcement = { text: '' };
  const annRows = await ctx.sheetRows(ANNOUNCE_SHEET);
  for (let i = 1; i < annRows.length; i++) {
    if (String(annRows[i][0]) !== classId) continue;
    announcement = { text: annRows[i][1] == null ? '' : String(annRows[i][1]) };
    break;
  }

  const events = [];
  const evRows = await ctx.sheetRows(EVENTS_SHEET);
  for (let i = 1; i < evRows.length; i++) {
    if (String(evRows[i][1]) !== classId) continue;
    const eventDate = formatSheetDate(evRows[i][2]);
    if (eventDate < today) continue;
    events.push({
      eventId: String(evRows[i][0]),
      eventDate,
      description: String(evRows[i][3] || ''),
      type: 'event'
    });
  }
  const makeupEvents = buildUpcomingMakeupEventsFromRows(await ctx.sheetRows(MAKEUP_SHEET), classId);
  const allEvents = events.concat(makeupEvents);
  allEvents.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    const aMakeup = a.type === 'makeup' ? 0 : 1;
    const bMakeup = b.type === 'makeup' ? 0 : 1;
    if (aMakeup !== bMakeup) return aMakeup - bMakeup;
    return String(a.description).localeCompare(String(b.description));
  });

  const vidRows = await ctx.sheetRows(VIDEO_SHEET);
  const video = resolveSharedClassVideoFromRows(vidRows, classId);

  return {
    rules: rulesResult,
    books: { students: booksStudents },
    announcement,
    events: { events: allEvents },
    video
  };
}

async function getClassSidebarCached(classId, ctx) {
  const idStr = String(classId);
  const cacheKey = 'sidebar_v1_' + idStr;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const localCtx = ctx || await buildRequestContext(idStr, sessionContextOptions(idStr));
  if (!ctx) await prefetchCtxSheets(localCtx, SIDEBAR_SHEETS);
  const data = await buildClassSidebarFromCtx(localCtx);
  cacheSet(cacheKey, data, CACHE_SEC.SIDEBAR);
  return data;
}

function buildChambitWeekReadMap(dailyRows, classId, weekMonday, weekSunday) {
  const map = {};
  for (let i = 1; i < dailyRows.length; i++) {
    if (String(dailyRows[i][1]) !== classId) continue;
    const ds = formatSheetDate(dailyRows[i][0]);
    if (ds < weekMonday || ds > weekSunday) continue;
    const sid = String(dailyRows[i][2]);
    if (!map[sid]) map[sid] = {};
    map[sid][ds] = true;
  }
  return map;
}

async function buildClassAttendanceFromCtx(ctx, dateStr) {
  const classId = ctx.classId;
  const students = getEnrolledStudentsFromRows(await ctx.sheetRows(STUDENT_LIST_SHEET), classId);

  const balanceMap = {};
  const balancesData = await ctx.sheetRows(DOLLAR_SHEETS.BALANCES);
  for (let i = 1; i < balancesData.length; i++) {
    const sid = balancesData[i][0];
    if (!sid) continue;
    balanceMap[sid] = Number(balancesData[i][1]) || 0;
  }

  const existingMap = {};
  const attendData = await ctx.sheetRows(ATTENDANCE_SHEET);
  for (let i = 1; i < attendData.length; i++) {
    const rDate = formatSheetDate(attendData[i][0]);
    if (rDate !== dateStr || String(attendData[i][1]) !== classId) continue;
    const vocabRaw = attendData[i][4];
    const vocabNum = vocabRaw === '' || vocabRaw == null ? 0 : Number(vocabRaw);
    existingMap[String(attendData[i][2])] = {
      attendance: attendData[i][3],
      vocabScore: Number.isFinite(vocabNum) ? vocabNum : 0
    };
  }

  const pendingMap = await buildPendingHomeworkCountsFromCtx(ctx, classId);
  const luckyRows = await ctx.sheetRows(LUCKY_DRAW_SHEET);
  const leaveRows = await ctx.sheetRows(STUDENT_LEAVE_SHEET);
  const plannedRows = await ctx.sheetRows(STUDENT_PLANNED_ATTENDANCE_SHEET);
  const luckyMap = buildLuckyMapFromRows(luckyRows, classId);
  const allActiveLeaves = buildAllActiveLeavesFromRows(leaveRows, classId);
  const leaveMap = filterLeavesByDate(allActiveLeaves, dateStr);
  const plannedMap = buildPlannedMapFromRows(plannedRows, classId, dateStr);

  let allowedDays = [1, 2, 3, 4, 5];
  const classData = await ctx.sheetRows(CLASS_LIST_SHEET);
  for (let i = 1; i < classData.length; i++) {
    if (String(classData[i][0]) === classId) {
      allowedDays = chambitNormalizeAllowedDays(classData[i][3]);
      break;
    }
  }

  const studentIds = students.map(s => s.id);
  const dailyRows = await ctx.sheetRows(CHAMBIT_DAILY_SHEET);
  const comboRows = await ctx.sheetRows(CHAMBIT_COMBO_SHEET);
  const ds = formatSheetDate(dateStr);
  const chambitTodayMap = {};
  studentIds.forEach(id => { chambitTodayMap[String(id)] = false; });
  for (let i = 1; i < dailyRows.length; i++) {
    const sid = String(dailyRows[i][2]);
    if (!chambitTodayMap.hasOwnProperty(sid) || String(dailyRows[i][1]) !== classId) continue;
    if (formatSheetDate(dailyRows[i][0]) === ds) chambitTodayMap[sid] = true;
  }

  const chambitComboMap = {};
  studentIds.forEach(id => { chambitComboMap[String(id)] = 0; });
  for (let i = 1; i < comboRows.length; i++) {
    const sid = String(comboRows[i][0]);
    if (chambitComboMap.hasOwnProperty(sid)) chambitComboMap[sid] = Number(comboRows[i][1]) || 0;
  }

  const weekMonday = chambitWeekMonday(dateStr);
  const weekRequired = await chambitGetRequiredDatesInWeek(weekMonday, allowedDays);
  const weekRequiredCount = weekRequired.length;
  const weekReadMap = buildChambitWeekReadMap(dailyRows, classId, weekMonday, chambitWeekSunday(weekMonday));

  return students.map(student => {
    const sid = String(student.id);
    const readSet = weekReadMap[sid] || {};
    let weekRead = 0;
    for (let wi = 0; wi < weekRequired.length; wi++) {
      if (readSet[weekRequired[wi]]) weekRead++;
    }
    const base = {
      pendingHomework: pendingMap[sid] || 0,
      luckyTickets: luckyMap[sid] || 0,
      chambitRead: chambitTodayMap[sid] || false,
      chambitCombo: chambitComboMap[sid] || 0,
      chambitWeekRead: weekRead,
      chambitWeekRequired: weekRequiredCount
    };
    const leaveOnDate = leaveMap[sid] || null;
    const activeLeave = allActiveLeaves[sid] || null;
    const onLeave = !!leaveOnDate;
    const leaveInfo = leaveOnDate || activeLeave;
    const planned = plannedMap[sid] || null;
    let attendance;
    if (onLeave) {
      attendance = '휴원';
    } else if (existingMap[sid]) {
      attendance = existingMap[sid].attendance;
    } else {
      attendance = '';
    }
    const baseStudent = {
      onLeave,
      leaveInfo,
      plannedNotice: planned,
      attendance,
      vocabScore: existingMap[sid] ? existingMap[sid].vocabScore : 0,
      dollars: balanceMap[student.id] ?? 0,
      ...base
    };
    if (existingMap[sid]) {
      return {
        id: student.id,
        name: student.name,
        ...baseStudent,
        vocabScore: existingMap[sid].vocabScore
      };
    }
    return {
      id: student.id,
      name: student.name,
      ...baseStudent
    };
  });
}

async function buildClassTextbookFromCtx(ctx, dateStr) {
  const classId = ctx.classId;
  const booksData = await ctx.sheetRows(TEXTBOOK_SHEETS.BOOKS);
  const headers = booksData.length ? booksData[0] : [];
  const startCol = headers.indexOf('StartDate');
  const statusCol = headers.indexOf('Status');
  const textbooks = [];

  for (let i = 1; i < booksData.length; i++) {
    if (String(booksData[i][1]) !== classId) continue;
    const status = statusCol >= 0 ? String(booksData[i][statusCol] || '').trim() : '';
    if (status === 'Completed') continue;
    textbooks.push({
      id: booksData[i][0],
      name: booksData[i][2],
      type: booksData[i][3],
      unitType: booksData[i][4],
      totalUnits: Number(booksData[i][5]) || 0,
      startDate: startCol >= 0 ? formatDateStr(booksData[i][startCol]) : ''
    });
  }

  const progData = await ctx.sheetRows(TEXTBOOK_SHEETS.PROGRESS);
  const maxPos = {};
  const todayPos = {};
  for (let i = 1; i < progData.length; i++) {
    if (String(progData[i][1]) !== classId) continue;
    const tbId = progData[i][2];
    const pos = Number(progData[i][3]) || 0;
    const rDate = formatSheetDate(progData[i][0]);
    if (!maxPos[tbId] || pos > maxPos[tbId]) maxPos[tbId] = pos;
    if (rDate === dateStr) todayPos[tbId] = pos;
  }

  const result = textbooks.map(tb => {
    const current = maxPos[tb.id] || 0;
    const total = tb.totalUnits > 0 ? tb.totalUnits : 1;
    const pct = Math.min(100, Math.round((current / total) * 100));
    return {
      ...tb,
      currentPosition: current,
      todayPosition: todayPos[tb.id] != null ? todayPos[tb.id] : '',
      percentDone: pct,
      percentLeft: 100 - pct,
      unitLabel: tb.unitType === 'page' ? 'Page' : 'Ch.',
      weekNumber: tb.startDate ? calcWeekNumber(tb.startDate, dateStr) : null,
      expectedFinishDate: calcExpectedFinishDate(tb.startDate, dateStr, current, total) || ''
    };
  });

  const queueRows = await ctx.sheetRows(TEXTBOOK_SHEETS.QUEUE);
  const queueItems = [];
  for (let i = 1; i < queueRows.length; i++) {
    if (String(queueRows[i][1]) !== classId) continue;
    queueItems.push({
      queueId: String(queueRows[i][0]),
      sortOrder: Number(queueRows[i][2]) || 0,
      name: String(queueRows[i][3] || ''),
      type: String(queueRows[i][4] || ''),
      unitType: String(queueRows[i][5] || 'chapter'),
      totalUnits: Number(queueRows[i][6]) || 0,
      row: i + 1
    });
  }
  queueItems.sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.row - b.row));
  const queue = queueItems.map(item => ({
    queueId: item.queueId,
    name: item.name,
    type: item.type,
    unitType: item.unitType,
    totalUnits: item.totalUnits,
    unitLabel: item.unitType === 'page' ? 'pages' : 'chapters',
    isReady: isQueueItemReady(item)
  }));

  return { textbooks: result, queue };
}

async function getClassWorkData(classId, dateStr) {
  classId = String(classId || '').trim();
  dateStr = String(dateStr || '').trim();
  if (!classId || !dateStr) throw new Error('Class and date are required.');

  const cached = getWorkCache(classId, dateStr);
  if (cached) return cached;

  const holidayName = await getHolidayName(dateStr);
  const ctx = await buildRequestContext(classId, sessionContextOptions(classId, dateStr));
  await prefetchCtxSheets(ctx, WORK_SHEETS);
  const [students, textbook, homework] = await Promise.all([
    buildClassAttendanceFromCtx(ctx, dateStr),
    buildClassTextbookFromCtx(ctx, dateStr),
    buildClassHomeworkFromCtx(ctx, dateStr)
  ]);
  const result = { holidayName, students, textbook, homework };
  setWorkCache(classId, dateStr, result);
  return result;
}

async function getClassSessionData(classId, dateStr) {
  classId = String(classId || '').trim();
  dateStr = String(dateStr || '').trim();
  if (!classId) throw new Error('Class is required.');

  if (!dateStr) {
    return {
      sidebar: await getClassSidebarCached(classId),
      holidayName: '',
      work: null
    };
  }

  const sidebarCacheKey = 'sidebar_v1_' + classId;
  const cachedSidebar = cacheGet(sidebarCacheKey);
  const cachedWork = getWorkCache(classId, dateStr);

  if (cachedSidebar && cachedWork) {
    return {
      sidebar: cachedSidebar,
      holidayName: cachedWork.holidayName || '',
      work: cachedWork
    };
  }

  const holidayName = await getHolidayName(dateStr);
  const ctx = await buildRequestContext(classId, sessionContextOptions(classId, dateStr));
  await prefetchCtxSheets(ctx, SESSION_SHEETS);

  const sidebar = cachedSidebar || await (async function() {
    const data = await buildClassSidebarFromCtx(ctx);
    cacheSet(sidebarCacheKey, data, CACHE_SEC.SIDEBAR);
    return data;
  })();

  let work = cachedWork;
  if (!work) {
    const [students, textbook, homework] = await Promise.all([
      buildClassAttendanceFromCtx(ctx, dateStr),
      buildClassTextbookFromCtx(ctx, dateStr),
      buildClassHomeworkFromCtx(ctx, dateStr)
    ]);
    work = { holidayName, students, textbook, homework };
    setWorkCache(classId, dateStr, work);
  }

  return {
    sidebar,
    holidayName: work.holidayName || holidayName,
    work
  };
}

module.exports = {
  getClassSessionData,
  getClassWorkData,
  getClassSidebarCached,
  buildClassAttendanceFromCtx,
  buildClassTextbookFromCtx
};
