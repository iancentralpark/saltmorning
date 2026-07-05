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
  CHAMBIT_COMBO_SHEET
} = require('./config');
const { cacheGet, cacheSet } = require('./cache');
const { buildRequestContext } = require('./sheets');
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
const { getLuckyDrawCountsByClass } = require('./luckyDrawService');
const { getActiveLeavesByClass, getAllActiveLeavesByClass } = require('./leaveService');
const { getPlannedByClassAndDate } = require('./plannedAttendanceService');
const { buildClassStudentDirectory } = require('./studentListService');
const { getUpcomingMakeupEvents } = require('./makeupService');

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
    if (String(studentData[i][2]) === idStr && studentData[i][3] === 'Enrolled') {
      out.push({ id: String(studentData[i][0]), name: String(studentData[i][1] || '') });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
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

  const { nameMap } = await buildClassStudentDirectory(classId);

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
  const makeupEvents = await getUpcomingMakeupEvents(classId);
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

async function getClassSidebarCached(classId) {
  const idStr = String(classId);
  const cacheKey = 'sidebar_v1_' + idStr;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const ctx = await buildRequestContext(idStr);
  const data = await buildClassSidebarFromCtx(ctx);
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
  const students = getEnrolledStudentsFromRows(await ctx.sheetRows('Student_List'), classId);

  const balanceMap = {};
  const balancesData = await ctx.sheetRows(DOLLAR_SHEETS.BALANCES);
  for (let i = 1; i < balancesData.length; i++) {
    const sid = balancesData[i][0];
    if (!sid) continue;
    balanceMap[sid] = Number(balancesData[i][1]) || 0;
  }

  const existingMap = {};
  const attendData = await ctx.sheetRows('Attendance_Data');
  for (let i = 1; i < attendData.length; i++) {
    const rDate = formatSheetDate(attendData[i][0]);
    if (rDate !== dateStr || String(attendData[i][1]) !== classId) continue;
    existingMap[attendData[i][2]] = {
      attendance: attendData[i][3],
      vocabScore: attendData[i][4]
    };
  }

  const pendingMap = await buildPendingHomeworkCountsFromCtx(ctx, classId);
  const luckyMap = await getLuckyDrawCountsByClass(classId);
  const leaveMap = await getActiveLeavesByClass(classId, dateStr);
  const allActiveLeaves = await getAllActiveLeavesByClass(classId);
  const plannedMap = await getPlannedByClassAndDate(classId, dateStr);

  let allowedDays = [1, 2, 3, 4, 5];
  const classData = await ctx.sheetRows('Class_List');
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
    } else if (existingMap[student.id]) {
      attendance = existingMap[student.id].attendance;
    } else if (planned) {
      attendance = planned.type;
    } else {
      attendance = '출석';
    }
    const baseStudent = {
      onLeave,
      leaveInfo,
      plannedNotice: planned,
      attendance,
      vocabScore: existingMap[student.id] ? existingMap[student.id].vocabScore : 0,
      dollars: balanceMap[student.id] ?? 0,
      ...base
    };
    if (existingMap[student.id]) {
      return {
        id: student.id,
        name: student.name,
        ...baseStudent,
        vocabScore: existingMap[student.id].vocabScore
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

  const holidayName = await getHolidayName(dateStr);
  const ctx = await buildRequestContext(classId);
  return {
    holidayName,
    students: await buildClassAttendanceFromCtx(ctx, dateStr),
    textbook: await buildClassTextbookFromCtx(ctx, dateStr),
    homework: await buildClassHomeworkFromCtx(ctx, dateStr)
  };
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

  const holidayName = await getHolidayName(dateStr);
  const [sidebar, ctx] = await Promise.all([
    getClassSidebarCached(classId),
    buildRequestContext(classId)
  ]);

  return {
    sidebar,
    holidayName,
    work: {
      holidayName,
      students: await buildClassAttendanceFromCtx(ctx, dateStr),
      textbook: await buildClassTextbookFromCtx(ctx, dateStr),
      homework: await buildClassHomeworkFromCtx(ctx, dateStr)
    }
  };
}

module.exports = {
  getClassSessionData,
  getClassWorkData,
  getClassSidebarCached,
  buildClassAttendanceFromCtx,
  buildClassTextbookFromCtx
};
