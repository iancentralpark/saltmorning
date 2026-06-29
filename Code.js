// 1. 웹 앱 접속 시 HTML 화면을 렌더링하는 함수
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  if (params.page === 'timer') {
    const min = Math.max(0, parseInt(params.min, 10) || 0);
    const sec = Math.max(0, Math.min(59, parseInt(params.sec, 10) || 0));
    const totalSec = Math.max(1, min * 60 + sec);

    const t = HtmlService.createTemplateFromFile('Timer');
    t.totalSeconds = String(totalSec);
    t.label = min > 0 && sec > 0 ? (min + ' min ' + sec + ' sec') : (min > 0 ? (min + ' min') : (sec + ' sec'));
    return t.evaluate()
      .setTitle('Timer')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (params.page === 'roulette') {
    const classId = String(params.classId || '').trim();
    const className = String(params.className || 'Class').trim();
    const students = classId ? getRouletteClassStudents(classId) : [];

    const t = HtmlService.createTemplateFromFile('Roulette');
    t.classId = classId;
    t.className = className;
    t.classNameJson = JSON.stringify(className);
    t.studentsJson = JSON.stringify(students);
    return t.evaluate()
      .setTitle('Roulette — ' + className)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (params.page === 'dice') {
    return HtmlService.createTemplateFromFile('Dice').evaluate()
      .setTitle('Dice')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (params.page === 'luckydraw') {
    const classId = String(params.classId || '').trim();
    const className = String(params.className || 'Class').trim();
    const students = classId ? getRouletteClassStudents(classId) : [];
    const t = HtmlService.createTemplateFromFile('LuckyDraw');
    t.classId = classId;
    t.className = className;
    t.studentsJson = JSON.stringify(students);
    t.nodeApiUrl = PropertiesService.getScriptProperties().getProperty('NODE_API_URL') ||
      'https://mrpark-class-api-production.up.railway.app';
    return t.evaluate()
      .setTitle('Lucky Draw — ' + className)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (params.page === 'student') {
    return HtmlService.createTemplateFromFile('Student').evaluate()
      .setTitle('Mr.Park Student Portal')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.webAppUrl = ScriptApp.getService().getUrl();
  template.nodeApiUrl = PropertiesService.getScriptProperties().getProperty('NODE_API_URL') || 'https://mrpark-class-api-production.up.railway.app';
  return template.evaluate()
    .setTitle('Mr.Park\'s Class Attendance & Dollars')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 스프레드시트 ID 설정 (연결할 구글 시트 ID를 입력하세요)
const SPREADSHEET_ID = "1XNZYW16PWijfNZPe3knwLnTw5Be_x_BoCeL3G1WO7jg";

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ===== Performance: cache + batched sheet reads =====
const PERF_CACHE_SEC = {
  CLASSES: 600,
  SIDEBAR: 300
};

function perfCacheGetJson_(key) {
  const hit = CacheService.getScriptCache().get(key);
  if (!hit) return null;
  try { return JSON.parse(hit); } catch (e) { return null; }
}

function perfCachePutJson_(key, obj, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(obj), seconds);
  } catch (e) { /* payload too large or cache full */ }
}

function invalidateClassSidebarCache_(classId) {
  CacheService.getScriptCache().remove('sidebar_v1_' + String(classId));
}

function invalidateInitialClassesCache_() {
  CacheService.getScriptCache().remove('initial_classes_v1');
}

function buildRequestContext_(classId) {
  ensureDollarSheets_();
  ensureTextbookSheets_();
  ensureClassRulesSheet_();
  ensureLibraryBooksSheet_();
  ensureAnnounceSheets_();
  ensureClassVideoSheet_();
  ensureHomeworkSheets_();
  ensureChambitSheets_();

  const ss = getSS();
  const tz = Session.getScriptTimeZone();
  const idStr = String(classId);
  const rowCache = {};

  function sheetRows(name) {
    if (!rowCache[name]) {
      const sh = ss.getSheetByName(name);
      rowCache[name] = (sh && sh.getLastRow() > 0) ? sh.getDataRange().getValues() : [[]];
    }
    return rowCache[name];
  }

  return { ss: ss, tz: tz, classId: idStr, sheetRows: sheetRows };
}

function getEnrolledStudentsFromRows_(studentData, classId) {
  const idStr = String(classId);
  const out = [];
  for (let i = 1; i < studentData.length; i++) {
    if (String(studentData[i][2]) === idStr && studentData[i][3] === 'Enrolled') {
      out.push({ id: String(studentData[i][0]), name: String(studentData[i][1] || '') });
    }
  }
  out.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function buildClassSidebarFromCtx_(ctx) {
  const classId = ctx.classId;
  const tz = ctx.tz;

  let rulesResult = { rules: [], rulesText: '' };
  const rulesRows = ctx.sheetRows(RULES_SHEET);
  for (let i = 1; i < rulesRows.length; i++) {
    if (String(rulesRows[i][0]) !== classId) continue;
    let rulesText = rulesRows[i][1];
    if (rulesText == null || rulesText === '') rulesText = '';
    else if (Array.isArray(rulesText)) rulesText = rulesText.join('\n');
    else rulesText = String(rulesText);
    rulesResult = { rules: parseRulesText_(rulesText), rulesText: rulesText };
    break;
  }

  const dir = buildClassStudentDirectory_(classId);
  const nameMap = dir.nameMap;

  const byStudent = {};
  const libRows = ctx.sheetRows(LIBRARY_SHEET);
  for (let i = 1; i < libRows.length; i++) {
    if (String(libRows[i][1]) !== classId) continue;
    if (String(libRows[i][4]) === 'Returned') continue;
    const sid = String(libRows[i][2]);
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push({ bookId: String(libRows[i][0]), title: String(libRows[i][3] || '') });
  }
  const booksStudents = Object.keys(byStudent).map(function(sid) {
    return {
      studentId: sid,
      studentName: nameMap[sid] || sid,
      books: byStudent[sid]
    };
  }).sort(function(a, b) { return a.studentName.localeCompare(b.studentName); });

  let announcement = { text: '' };
  const annRows = ctx.sheetRows(ANNOUNCE_SHEET);
  for (let i = 1; i < annRows.length; i++) {
    if (String(annRows[i][0]) !== classId) continue;
    let text = annRows[i][1];
    if (text == null) text = '';
    else if (Array.isArray(text)) text = text.join('\n');
    else text = String(text);
    announcement = { text: text };
    break;
  }

  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const events = [];
  const evRows = ctx.sheetRows(EVENTS_SHEET);
  for (let i = 1; i < evRows.length; i++) {
    if (String(evRows[i][1]) !== classId) continue;
    const eventDate = formatSheetDate_(evRows[i][2], tz);
    if (eventDate < today) continue;
    events.push({
      eventId: String(evRows[i][0]),
      eventDate: eventDate,
      description: String(evRows[i][3] || '')
    });
  }
  events.sort(function(a, b) {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    return a.description.localeCompare(b.description);
  });

  let video = {
    videoUrl: 'https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID,
    videoId: DEFAULT_YOUTUBE_VIDEO_ID,
    embedUrl: youtubeEmbedUrl_(DEFAULT_YOUTUBE_VIDEO_ID)
  };
  const vidRows = ctx.sheetRows(VIDEO_SHEET);
  for (let i = 1; i < vidRows.length; i++) {
    if (String(vidRows[i][0]) !== classId) continue;
    const raw = String(vidRows[i][1] || '').trim();
    let videoId = DEFAULT_YOUTUBE_VIDEO_ID;
    try { videoId = parseYoutubeVideoId_(raw); } catch (e) { videoId = DEFAULT_YOUTUBE_VIDEO_ID; }
    video = {
      videoUrl: raw || ('https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID),
      videoId: videoId,
      embedUrl: youtubeEmbedUrl_(videoId)
    };
    break;
  }

  return {
    rules: rulesResult,
    books: { students: booksStudents },
    announcement: announcement,
    events: { events: events },
    video: video
  };
}

function getClassSidebarDataCached_(classId) {
  const idStr = String(classId);
  const cacheKey = 'sidebar_v1_' + idStr;
  const cached = perfCacheGetJson_(cacheKey);
  if (cached) return cached;
  const ctx = buildRequestContext_(idStr);
  const data = buildClassSidebarFromCtx_(ctx);
  perfCachePutJson_(cacheKey, data, PERF_CACHE_SEC.SIDEBAR);
  return data;
}

function buildPendingHomeworkCountsFromCtx_(ctx, classId) {
  const logRows = ctx.sheetRows(HOMEWORK_SHEETS.LOG);
  const hwIds = {};
  for (let i = 1; i < logRows.length; i++) {
    if (logRows[i][1] !== classId) continue;
    hwIds[String(logRows[i][0])] = true;
  }
  if (!Object.keys(hwIds).length) return {};

  const itemRows = ctx.sheetRows(HOMEWORK_SHEETS.ITEMS);
  const validKeys = {};
  for (let i = 1; i < itemRows.length; i++) {
    const hid = String(itemRows[i][1]);
    if (!hwIds[hid]) continue;
    if (isChambitHomeworkTitle_(itemRows[i][3])) continue;
    validKeys[String(itemRows[i][0])] = true;
  }

  const compRows = ctx.sheetRows(HOMEWORK_SHEETS.COMPLETION);
  const counts = {};
  for (let i = 1; i < compRows.length; i++) {
    const key = String(compRows[i][0]);
    if (!validKeys[key]) continue;
    if (isCompletedCell_(compRows[i][2])) continue;
    const sid = String(compRows[i][1]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

function buildChambitWeekReadMap_(dailyRows, classId, weekMonday, weekSunday, tz) {
  const map = {};
  for (let i = 1; i < dailyRows.length; i++) {
    if (String(dailyRows[i][1]) !== classId) continue;
    const ds = formatSheetDate_(dailyRows[i][0], tz);
    if (ds < weekMonday || ds > weekSunday) continue;
    const sid = String(dailyRows[i][2]);
    if (!map[sid]) map[sid] = {};
    map[sid][ds] = true;
  }
  return map;
}

function buildClassAttendanceFromCtx_(ctx, dateStr) {
  const classId = ctx.classId;
  const tz = ctx.tz;
  const students = getEnrolledStudentsFromRows_(ctx.sheetRows('Student_List'), classId);

  const balanceMap = {};
  const balancesData = ctx.sheetRows(DOLLAR_SHEETS.BALANCES);
  for (let i = 1; i < balancesData.length; i++) {
    const sid = balancesData[i][0];
    if (!sid) continue;
    balanceMap[sid] = Number(balancesData[i][1]) || 0;
  }

  const existingMap = {};
  const attendData = ctx.sheetRows('Attendance_Data');
  for (let i = 1; i < attendData.length; i++) {
    const rDate = Utilities.formatDate(new Date(attendData[i][0]), tz, 'yyyy-MM-dd');
    if (rDate !== dateStr || String(attendData[i][1]) !== classId) continue;
    existingMap[attendData[i][2]] = {
      attendance: attendData[i][3],
      vocabScore: attendData[i][4]
    };
  }

  const pendingMap = buildPendingHomeworkCountsFromCtx_(ctx, classId);

  let allowedDays = [1, 2, 3, 4, 5];
  const classData = ctx.sheetRows('Class_List');
  for (let i = 1; i < classData.length; i++) {
    if (String(classData[i][0]) === classId) {
      allowedDays = chambitNormalizeAllowedDays_(classData[i][3]);
      break;
    }
  }

  const studentIds = students.map(function(s) { return s.id; });
  const dailyRows = ctx.sheetRows(CHAMBIT_DAILY_SHEET);
  const comboRows = ctx.sheetRows(CHAMBIT_COMBO_SHEET);
  const ds = formatSheetDate_(dateStr, tz);
  const chambitTodayMap = {};
  studentIds.forEach(function(id) { chambitTodayMap[String(id)] = false; });
  for (let i = 1; i < dailyRows.length; i++) {
    const sid = String(dailyRows[i][2]);
    if (!chambitTodayMap.hasOwnProperty(sid) || String(dailyRows[i][1]) !== classId) continue;
    if (formatSheetDate_(dailyRows[i][0], tz) === ds) chambitTodayMap[sid] = true;
  }

  const chambitComboMap = {};
  studentIds.forEach(function(id) { chambitComboMap[String(id)] = 0; });
  for (let i = 1; i < comboRows.length; i++) {
    const sid = String(comboRows[i][0]);
    if (chambitComboMap.hasOwnProperty(sid)) chambitComboMap[sid] = Number(comboRows[i][1]) || 0;
  }

  const weekMonday = chambitWeekMonday_(dateStr);
  const weekRequired = chambitGetRequiredDatesInWeek_(weekMonday, allowedDays);
  const weekRequiredCount = weekRequired.length;
  const weekReadMap = buildChambitWeekReadMap_(dailyRows, classId, weekMonday, chambitWeekSunday_(weekMonday), tz);

  return students.map(function(student) {
    const sid = String(student.id);
    const readSet = weekReadMap[sid] || {};
    let weekRead = 0;
    for (let wi = 0; wi < weekRequired.length; wi++) {
      if (readSet[weekRequired[wi]]) weekRead++;
    }
    const base = {
      pendingHomework: pendingMap[sid] || 0,
      chambitRead: chambitTodayMap[sid] || false,
      chambitCombo: chambitComboMap[sid] || 0,
      chambitWeekRead: weekRead,
      chambitWeekRequired: weekRequiredCount
    };
    if (existingMap[student.id]) {
      return {
        id: student.id,
        name: student.name,
        attendance: existingMap[student.id].attendance,
        vocabScore: existingMap[student.id].vocabScore,
        dollars: balanceMap[student.id] ?? 0,
        pendingHomework: base.pendingHomework,
        chambitRead: base.chambitRead,
        chambitCombo: base.chambitCombo,
        chambitWeekRead: base.chambitWeekRead,
        chambitWeekRequired: base.chambitWeekRequired
      };
    }
    return {
      id: student.id,
      name: student.name,
      attendance: '출석',
      vocabScore: 0,
      dollars: balanceMap[student.id] ?? 0,
      pendingHomework: base.pendingHomework,
      chambitRead: base.chambitRead,
      chambitCombo: base.chambitCombo,
      chambitWeekRead: base.chambitWeekRead,
      chambitWeekRequired: base.chambitWeekRequired
    };
  });
}

function buildClassTextbookFromCtx_(ctx, dateStr) {
  const classId = ctx.classId;
  const tz = ctx.tz;
  const booksData = ctx.sheetRows(TEXTBOOK_SHEETS.BOOKS);
  const headers = booksData.length ? booksData[0] : [];
  const startCol = headers.indexOf('StartDate');
  const statusCol = headers.indexOf('Status');
  const textbooks = [];

  for (let i = 1; i < booksData.length; i++) {
    if (String(booksData[i][1]) !== classId) continue;
    const status = statusCol >= 0 ? String(booksData[i][statusCol] || '').trim() : '';
    if (status === 'Completed') continue;
    const total = Number(booksData[i][5]) || 0;
    textbooks.push({
      id: booksData[i][0],
      name: booksData[i][2],
      type: booksData[i][3],
      unitType: booksData[i][4],
      totalUnits: total,
      startDate: startCol >= 0 ? formatDateStr_(booksData[i][startCol], tz) : ''
    });
  }

  const progData = ctx.sheetRows(TEXTBOOK_SHEETS.PROGRESS);
  const maxPos = {};
  const todayPos = {};
  for (let i = 1; i < progData.length; i++) {
    if (String(progData[i][1]) !== classId) continue;
    const tbId = progData[i][2];
    const pos = Number(progData[i][3]) || 0;
    const rDate = Utilities.formatDate(new Date(progData[i][0]), tz, 'yyyy-MM-dd');
    if (!maxPos[tbId] || pos > maxPos[tbId]) maxPos[tbId] = pos;
    if (rDate === dateStr) todayPos[tbId] = pos;
  }

  const result = textbooks.map(function(tb) {
    const current = maxPos[tb.id] || 0;
    const total = tb.totalUnits > 0 ? tb.totalUnits : 1;
    const pct = Math.min(100, Math.round((current / total) * 100));
    const weekNum = tb.startDate ? calcWeekNumber_(tb.startDate, dateStr) : null;
    const expectedFinishDate = calcExpectedFinishDate_(tb.startDate, dateStr, current, total);
    return {
      id: tb.id,
      name: tb.name,
      type: tb.type,
      unitType: tb.unitType,
      totalUnits: tb.totalUnits,
      startDate: tb.startDate,
      currentPosition: current,
      todayPosition: todayPos[tb.id] != null ? todayPos[tb.id] : '',
      percentDone: pct,
      percentLeft: 100 - pct,
      unitLabel: tb.unitType === 'page' ? 'Page' : 'Ch.',
      weekNumber: weekNum,
      expectedFinishDate: expectedFinishDate || ''
    };
  });

  const queueRows = ctx.sheetRows(TEXTBOOK_SHEETS.QUEUE);
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
  queueItems.sort(function(a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.row - b.row;
  });
  const queue = queueItems.map(function(item) {
    const ready = isQueueItemReady_(item);
    return {
      queueId: item.queueId,
      name: item.name,
      type: item.type,
      unitType: item.unitType,
      totalUnits: item.totalUnits,
      unitLabel: item.unitType === 'page' ? 'pages' : 'chapters',
      isReady: ready
    };
  });

  return { textbooks: result, queue: queue };
}

function buildClassHomeworkFromCtx_(ctx, dateStr) {
  const classId = ctx.classId;
  const mapRows = ctx.sheetRows(HOMEWORK_SHEETS.MAP);
  let map = null;
  for (let i = 1; i < mapRows.length; i++) {
    if (mapRows[i][0] === classId) {
      map = { courseId: String(mapRows[i][1] || ''), courseName: String(mapRows[i][2] || '') };
      break;
    }
  }

  const logRows = ctx.sheetRows(HOMEWORK_SHEETS.LOG);
  const rows = [];
  for (let i = 1; i < logRows.length; i++) {
    if (logRows[i][1] !== classId) continue;
    rows.push({
      homeworkId: String(logRows[i][0]),
      classId: logRows[i][1],
      assignedDate: parseHomeworkDate_(logRows[i][2]),
      title: String(logRows[i][3] || ''),
      description: String(logRows[i][4] || ''),
      classroomWorkId: String(logRows[i][5] || ''),
      postedAt: logRows[i][6] ? String(logRows[i][6]) : ''
    });
  }
  rows.sort(function(a, b) {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.homeworkId < b.homeworkId ? 1 : -1;
  });

  const itemsByHw = parseItemsFromRows_(ctx.sheetRows(HOMEWORK_SHEETS.ITEMS), rows.reduce(function(acc, r) {
    acc[r.homeworkId] = true;
    return acc;
  }, {}));
  const todayHw = rows.find(function(r) { return r.assignedDate === dateStr; }) || null;
  const todayItems = todayHw ? (itemsByHw[todayHw.homeworkId] || []).map(function(it) {
    return {
      title: it.title,
      description: it.description,
      targetType: (it.targetStudentIds && it.targetStudentIds.length) ? 'individual' : 'all',
      studentIds: it.targetStudentIds || [],
      isChambit: isChambitHomeworkTitle_(it.title)
    };
  }) : [];

  const lastFromLog = getLastHomeworkFromLog_(rows, dateStr);
  if (lastFromLog && itemsByHw[lastFromLog.homeworkId]) {
    lastFromLog.items = itemsByHw[lastFromLog.homeworkId];
  }
  const lastFromClassroom = (map && map.courseId)
    ? getLatestClassroomHomework_(map.courseId, dateStr)
    : null;

  let last = null;
  if (lastFromLog && lastFromClassroom) {
    last = homeworkSortTime_(lastFromLog) >= homeworkSortTime_(lastFromClassroom)
      ? lastFromLog
      : lastFromClassroom;
  } else {
    last = lastFromLog || lastFromClassroom;
  }
  if (last && last.sortTime) delete last.sortTime;

  return {
    classroomLinked: !!(map && map.courseId),
    courseName: map ? map.courseName : '',
    courseId: map ? map.courseId : '',
    lastHomework: last,
    todayItems: todayItems,
    todayHomeworkId: todayHw ? todayHw.homeworkId : ''
  };
}

/** Sidebar panels — cached per class (~5 min). */
function getClassSidebarBundle(classId) {
  return getClassSidebarDataCached_(String(classId));
}

/** Attendance + textbook + homework + holiday in one round trip. */
function getClassWorkData(classId, dateStr) {
  classId = String(classId || '').trim();
  dateStr = String(dateStr || '').trim();
  if (!classId || !dateStr) throw new Error('Class and date are required.');

  const holidayName = getHolidayName(dateStr);
  const ctx = buildRequestContext_(classId);
  return {
    holidayName: holidayName,
    students: buildClassAttendanceFromCtx_(ctx, dateStr),
    textbook: buildClassTextbookFromCtx_(ctx, dateStr),
    homework: buildClassHomeworkFromCtx_(ctx, dateStr)
  };
}

/** Full class session: sidebar + work (when date provided). */
function getClassSessionData(classId, dateStr) {
  classId = String(classId || '').trim();
  dateStr = String(dateStr || '').trim();
  if (!classId) throw new Error('Class is required.');

  if (!dateStr) {
    return {
      sidebar: getClassSidebarDataCached_(classId),
      holidayName: '',
      work: null
    };
  }

  const holidayName = getHolidayName(dateStr);
  const ctx = buildRequestContext_(classId);
  const sidebar = buildClassSidebarFromCtx_(ctx);
  perfCachePutJson_('sidebar_v1_' + classId, sidebar, PERF_CACHE_SEC.SIDEBAR);

  return {
    sidebar: sidebar,
    holidayName: holidayName,
    work: {
      holidayName: holidayName,
      students: buildClassAttendanceFromCtx_(ctx, dateStr),
      textbook: buildClassTextbookFromCtx_(ctx, dateStr),
      homework: buildClassHomeworkFromCtx_(ctx, dateStr)
    }
  };
}

// 달러(포인트) 시트 이름
const DOLLAR_SHEETS = {
  BALANCES: 'Dollar_Balances',        // StudentID | Balance
  TRANSACTIONS: 'Dollar_Transactions' // Timestamp | ClassID | StudentID | Amount | NewBalance | Reason
};

function ensureDollarSheets_() {
  const ss = getSS();

  let balances = ss.getSheetByName(DOLLAR_SHEETS.BALANCES);
  if (!balances) {
    balances = ss.insertSheet(DOLLAR_SHEETS.BALANCES);
    balances.appendRow(['StudentID', 'Balance']);
    balances.getRange(1, 1, 1, 2).setFontWeight('bold');
  }

  let tx = ss.getSheetByName(DOLLAR_SHEETS.TRANSACTIONS);
  if (!tx) {
    tx = ss.insertSheet(DOLLAR_SHEETS.TRANSACTIONS);
    tx.appendRow(['Timestamp', 'ClassID', 'StudentID', 'Amount', 'NewBalance', 'Reason']);
    tx.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
}

// 한국 공휴일 공개 캘린더 (구글이 매년 자동 갱신)
const KR_HOLIDAY_CALENDAR_ID = 'ko.south_korea#holiday@group.v.calendar.google.com';

// 특정 날짜가 한국 공휴일이면 공휴일명을 반환, 아니면 빈 문자열 반환
// dateStr 형식: "yyyy-MM-dd"
function getHolidayName(dateStr) {
  try {
    if (!dateStr) return '';

    // 같은 날짜는 캐시에서 빠르게 반환 (6시간 보관)
    const cache = CacheService.getScriptCache();
    const cacheKey = 'kr_holiday_' + dateStr;
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      return cached === '__NONE__' ? '' : cached;
    }

    const cal = CalendarApp.getCalendarById(KR_HOLIDAY_CALENDAR_ID);
    if (!cal) return '';

    // 해당 날짜 하루 범위 (스크립트 타임존 기준)
    const parts = dateStr.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const d = Number(parts[2]);
    const start = new Date(y, m, d, 0, 0, 0);
    const end = new Date(y, m, d + 1, 0, 0, 0);

    const events = cal.getEvents(start, end);
    const name = events.length > 0 ? events[0].getTitle() : '';

    cache.put(cacheKey, name || '__NONE__', 21600);
    return name;
  } catch (e) {
    // 캘린더 권한/네트워크 문제 시 휴일 없음으로 간주 (정상 진행)
    return '';
  }
}

// 2. 초기 데이터 가져오기 (클래스 리스트 및 스케줄 설정)
function getInitialData() {
  const cached = perfCacheGetJson_('initial_classes_v1');
  if (cached) return cached;

  const ss = getSS();
  const classSheet = ss.getSheetByName('Class_List');
  const classData = classSheet.getDataRange().getValues();

  const classes = [];
  for (let i = 1; i < classData.length; i++) {
    classes.push({
      id: classData[i][0],
      name: classData[i][1],
      scheduleType: classData[i][2],
      allowedDays: classData[i][3].toString().split(',').map(Number)
    });
  }
  const result = { classes: classes };
  perfCachePutJson_('initial_classes_v1', result, PERF_CACHE_SEC.CLASSES);
  return result;
}

// 2-1. 월별 출석+Vocab 점수 리포트 데이터 (클래스별)
// classId: 특정 클래스 id 또는 'ALL'
// year: 숫자(예: 2026), month: 1~12
function getMonthlyReport(classId, year, month) {
  const ss = getSS();
  const y = Number(year);
  const m = Number(month); // 1~12
  const monthPrefix = y + '-' + ('0' + m).slice(-2); // "yyyy-MM"

  // 클래스 목록
  const classSheet = ss.getSheetByName('Class_List');
  const classData = classSheet.getDataRange().getValues();
  const classList = [];
  for (let i = 1; i < classData.length; i++) {
    const cid = classData[i][0];
    if (!cid) continue;
    if (classId !== 'ALL' && cid !== classId) continue;
    classList.push({
      id: cid,
      name: classData[i][1],
      allowedDays: chambitNormalizeAllowedDays_(classData[i][3])
    });
  }

  // 클래스별 재학생 명단
  const studentSheet = ss.getSheetByName('Student_List');
  const studentData = studentSheet.getDataRange().getValues();
  const studentsByClass = {}; // classId -> [{id, name}]
  for (let i = 1; i < studentData.length; i++) {
    const sid = studentData[i][0];
    const cid = studentData[i][2];
    const status = studentData[i][3];
    if (!sid || status !== 'Enrolled') continue;
    if (!studentsByClass[cid]) studentsByClass[cid] = [];
    studentsByClass[cid].push({ id: sid, name: studentData[i][1] });
  }

  // 해당 월의 출결 데이터 수집: classId -> dateStr -> studentId -> {attendance, vocabScore}
  const attendSheet = ss.getSheetByName('Attendance_Data');
  const attendData = attendSheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const recordMap = {};   // cid -> { dateStr -> { sid -> {attendance, vocabScore} } }
  const dateSet = {};     // cid -> Set(dateStr)

  for (let i = 1; i < attendData.length; i++) {
    const rDate = Utilities.formatDate(new Date(attendData[i][0]), tz, 'yyyy-MM-dd');
    if (rDate.slice(0, 7) !== monthPrefix) continue;
    const cid = attendData[i][1];
    const sid = attendData[i][2];

    if (!recordMap[cid]) recordMap[cid] = {};
    if (!recordMap[cid][rDate]) recordMap[cid][rDate] = {};
    recordMap[cid][rDate][sid] = {
      attendance: attendData[i][3],
      vocabScore: attendData[i][4]
    };
    if (!dateSet[cid]) dateSet[cid] = {};
    dateSet[cid][rDate] = true;
  }

  // 클래스별 리포트 구성
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const holidays = getHolidaysForMonth_(y, m);
  const report = [];
  classList.forEach(function(cls) {
    const allowed = cls.allowedDays && cls.allowedDays.length ? cls.allowedDays : [1, 2, 3, 4, 5];
    const numDays = new Date(y, m, 0).getDate();
    const dates = [];
    for (let d = 1; d <= numDays; d++) {
      const dateStr = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      const dow = new Date(dateStr + 'T12:00:00').getDay();
      if (allowed.indexOf(dow) === -1) continue;
      dates.push({
        dateStr: dateStr,
        dayLabel: dayLabels[dow],
        holiday: holidays[dateStr] || ''
      });
    }

    const students = (studentsByClass[cls.id] || []).map(function(std) {
      const cells = dates.map(function(d) {
        if (d.holiday) {
          return { attendance: null, vocabScore: null, holiday: d.holiday };
        }
        const rec = recordMap[cls.id] && recordMap[cls.id][d.dateStr] && recordMap[cls.id][d.dateStr][std.id];
        if (rec && rec.attendance) {
          return { attendance: rec.attendance, vocabScore: rec.vocabScore, holiday: '' };
        }
        return { attendance: null, vocabScore: null, holiday: '' };
      });
      return { id: std.id, name: std.name, cells: cells };
    });
    report.push({
      id: cls.id,
      name: cls.name,
      allowedDays: allowed,
      dates: dates,
      students: students
    });
  });

  return { year: y, month: m, monthLabel: monthPrefix, classes: report };
}

// 3. 선택된 클래스의 학생 명단 및 '기존 저장된 출결/점수' 로드하기
function getClassAttendanceData(classId, dateStr) {
  const ctx = buildRequestContext_(classId);
  return buildClassAttendanceFromCtx_(ctx, dateStr);
}

// 4. 오늘 출결 및 단어 점수 저장 (기존 데이터가 있으면 업데이트, 없으면 추가)
function saveAttendanceData(classId, dateStr, records) {
  const ss = getSS();
  const sheet = ss.getSheetByName('Attendance_Data');
  const data = sheet.getDataRange().getValues();
  
  // 효율적인 업데이트를 위해 행 위치 추적 변수 설정
  // 기존 행들의 위치를 기억하고 덮어쓰기 위함
  for(let k = 0; k < records.length; k++) {
    const rec = records[k];
    let foundRow = -1;
    
    for(let i = 1; i < data.length; i++) {
      const rDate = Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
      if(rDate === dateStr && data[i][1] === classId && data[i][2] === rec.studentId) {
        foundRow = i + 1; // 행 번호는 Index + 1
        break;
      }
    }
    
    if(foundRow !== -1) {
      // 수정 (Update)
      sheet.getRange(foundRow, 4).setValue(rec.attendance);
      sheet.getRange(foundRow, 5).setValue(rec.vocabScore);
    } else {
      // 신규 저장 (Append)
      sheet.appendRow([dateStr, classId, rec.studentId, rec.attendance, rec.vocabScore]);
    }
  }
  return "Saved successfully!";
}

// 5. 학생 1명의 출결/점수 히스토리 조회 (날짜 오름차순)
function getStudentHistory(classId, studentId) {
  const ss = getSS();
  const sheet = ss.getSheetByName('Attendance_Data');
  const data = sheet.getDataRange().getValues();

  const records = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== classId || data[i][2] !== studentId) continue;

    const dateStr = Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    records.push({
      dateStr: dateStr,
      attendance: data[i][3],
      vocabScore: data[i][4]
    });
  }

  records.sort((a, b) => (a.dateStr < b.dateStr ? -1 : a.dateStr > b.dateStr ? 1 : 0));
  return records;
}

// 6. 학생 1건(날짜 1개)의 출결/점수 정정 저장 (없으면 추가)
function updateStudentRecord(classId, studentId, dateStr, attendance, vocabScore) {
  const ss = getSS();
  const sheet = ss.getSheetByName('Attendance_Data');
  const data = sheet.getDataRange().getValues();

  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rDate = Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    if (rDate === dateStr && data[i][1] === classId && data[i][2] === studentId) {
      foundRow = i + 1;
      break;
    }
  }

  if (foundRow !== -1) {
    sheet.getRange(foundRow, 4).setValue(attendance);
    sheet.getRange(foundRow, 5).setValue(vocabScore);
    return "Saved changes.";
  }

  sheet.appendRow([dateStr, classId, studentId, attendance, vocabScore]);
  return "Saved new record.";
}

// 7. 달러 증감 적용 (+/- 허용, 0 미만도 허용)
function applyDollarAdjustment(classId, studentId, amount, reason) {
  ensureDollarSheets_();

  const ss = getSS();
  const balancesSheet = ss.getSheetByName(DOLLAR_SHEETS.BALANCES);
  const txSheet = ss.getSheetByName(DOLLAR_SHEETS.TRANSACTIONS);

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new Error('Enter a valid dollar adjustment (cannot be 0).');
  }

  const data = balancesSheet.getDataRange().getValues();
  let foundRow = -1;
  let current = 0;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === studentId) {
      foundRow = i + 1;
      current = Number(data[i][1]) || 0;
      break;
    }
  }

  const newBalance = current + amt;
  if (foundRow !== -1) {
    balancesSheet.getRange(foundRow, 2).setValue(newBalance);
  } else {
    balancesSheet.appendRow([studentId, newBalance]);
  }

  const r = (reason && String(reason).trim()) ? String(reason).trim() : 'manual-adjust';
  txSheet.appendRow([new Date(), classId, studentId, amt, newBalance, r]);

  return { studentId: studentId, newBalance: newBalance };
}

// ===== Chambit Combo (참빛 e-library Lucky Draw) =====
const CHAMBIT_DAILY_SHEET = 'Chambit_Daily';
const CHAMBIT_COMBO_SHEET = 'Chambit_Combo';
const CHAMBIT_WEEK_SHEET = 'Chambit_WeekAwards';

function ensureChambitSheets_() {
  const ss = getSS();
  let daily = ss.getSheetByName(CHAMBIT_DAILY_SHEET);
  if (!daily) {
    daily = ss.insertSheet(CHAMBIT_DAILY_SHEET);
    daily.appendRow(['Date', 'ClassID', 'StudentID']);
    daily.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  let combo = ss.getSheetByName(CHAMBIT_COMBO_SHEET);
  if (!combo) {
    combo = ss.insertSheet(CHAMBIT_COMBO_SHEET);
    combo.appendRow(['StudentID', 'ComboCount', 'UpdatedAt']);
    combo.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  let week = ss.getSheetByName(CHAMBIT_WEEK_SHEET);
  if (!week) {
    week = ss.insertSheet(CHAMBIT_WEEK_SHEET);
    week.appendRow(['StudentID', 'WeekKey', 'AwardedAt']);
    week.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
}

function chambitParseDate_(dateStr) {
  const p = String(dateStr).split('-');
  return { y: Number(p[0]), m: Number(p[1]) - 1, d: Number(p[2]) };
}

function chambitFormatDate_(dt) {
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function chambitAddDays_(dateStr, days) {
  const p = chambitParseDate_(dateStr);
  const dt = new Date(p.y, p.m, p.d);
  dt.setDate(dt.getDate() + days);
  return chambitFormatDate_(dt);
}

function chambitWeekMonday_(dateStr) {
  const p = chambitParseDate_(dateStr);
  const dt = new Date(p.y, p.m, p.d);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + diff);
  return chambitFormatDate_(dt);
}

function chambitWeekSunday_(weekMonday) {
  return chambitAddDays_(weekMonday, 6);
}

function chambitNormalizeAllowedDays_(allowedDays) {
  if (!allowedDays) return [];
  if (Array.isArray(allowedDays)) {
    return allowedDays.map(function(n) { return Number(n); }).filter(function(n) { return !isNaN(n); });
  }
  return String(allowedDays).split(',').map(function(s) { return Number(s.trim()); }).filter(function(n) { return !isNaN(n); });
}

function chambitGetRequiredDatesInWeek_(weekMonday, allowedDays) {
  const days = chambitNormalizeAllowedDays_(allowedDays);
  const required = [];
  for (let i = 0; i < 7; i++) {
    const ds = chambitAddDays_(weekMonday, i);
    const p = chambitParseDate_(ds);
    const dow = new Date(p.y, p.m, p.d).getDay();
    if (days.indexOf(dow) === -1) continue;
    if (getHolidayName(ds)) continue;
    required.push(ds);
  }
  return required;
}

function chambitReadDailySetForStudent_(studentId, classId, weekMonday, weekSunday) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_DAILY_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const sid = String(studentId);
  const cid = String(classId);
  const set = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== sid || String(data[i][1]) !== cid) continue;
    const ds = formatSheetDate_(data[i][0], tz);
    if (ds >= weekMonday && ds <= weekSunday) set[ds] = true;
  }
  return set;
}

function chambitIsWeekComplete_(studentId, classId, weekMonday, allowedDays) {
  const required = chambitGetRequiredDatesInWeek_(weekMonday, allowedDays);
  if (required.length === 0) return false;
  const readSet = chambitReadDailySetForStudent_(
    studentId, classId, weekMonday, chambitWeekSunday_(weekMonday)
  );
  for (let i = 0; i < required.length; i++) {
    if (!readSet[required[i]]) return false;
  }
  return true;
}

function chambitGetComboCount_(studentId) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_COMBO_SHEET);
  const data = sheet.getDataRange().getValues();
  const sid = String(studentId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) return Number(data[i][1]) || 0;
  }
  return 0;
}

function chambitSetComboCount_(studentId, count) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_COMBO_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const sid = String(studentId);
  const safe = Math.max(0, Math.min(5, Number(count) || 0));
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[safe, now]]);
      return safe;
    }
  }
  sheet.appendRow([studentId, safe, now]);
  return safe;
}

function chambitIncrementCombo_(studentId) {
  const current = chambitGetComboCount_(studentId);
  const next = current >= 5 ? 1 : current + 1;
  return chambitSetComboCount_(studentId, next);
}

function setChambitComboManual(studentId, comboCount) {
  ensureChambitSheets_();
  const count = Math.round(Number(comboCount));
  if (!Number.isFinite(count) || count < 0 || count > 5) {
    throw new Error('Combo must be between 0 and 5.');
  }
  const safe = chambitSetComboCount_(studentId, count);
  return { studentId: studentId, chambitCombo: safe };
}

function chambitHasWeekAward_(studentId, weekKey) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_WEEK_SHEET);
  const data = sheet.getDataRange().getValues();
  const sid = String(studentId);
  const wk = String(weekKey);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === sid && String(data[i][1]) === wk) return true;
  }
  return false;
}

function chambitMarkWeekAward_(studentId, weekKey) {
  ensureChambitSheets_();
  if (chambitHasWeekAward_(studentId, weekKey)) return;
  const sheet = getSS().getSheetByName(CHAMBIT_WEEK_SHEET);
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([studentId, weekKey, now]);
}

function chambitClearWeekAwards_(studentId) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_WEEK_SHEET);
  const data = sheet.getDataRange().getValues();
  const sid = String(studentId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === sid) sheet.deleteRow(i + 1);
  }
}

function chambitSetDailyRead_(classId, studentId, dateStr, read) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_DAILY_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const ds = formatSheetDate_(dateStr, tz);
  const sid = String(studentId);
  const cid = String(classId);
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rowDate = formatSheetDate_(data[i][0], tz);
    if (rowDate === ds && String(data[i][1]) === cid && String(data[i][2]) === sid) {
      foundRow = i + 1;
      break;
    }
  }
  if (read) {
    if (foundRow === -1) sheet.appendRow([ds, classId, studentId]);
  } else if (foundRow !== -1) {
    sheet.deleteRow(foundRow);
  }
}

function chambitReadTodayMap_(classId, dateStr, studentIds) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_DAILY_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const ds = formatSheetDate_(dateStr, tz);
  const cid = String(classId);
  const idSet = {};
  studentIds.forEach(function(id) { idSet[String(id)] = true; });
  const map = {};
  studentIds.forEach(function(id) { map[String(id)] = false; });
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][2]);
    if (!idSet[sid] || String(data[i][1]) !== cid) continue;
    const rowDate = formatSheetDate_(data[i][0], tz);
    if (rowDate === ds) map[sid] = true;
  }
  return map;
}

function chambitComboMap_(studentIds) {
  ensureChambitSheets_();
  const sheet = getSS().getSheetByName(CHAMBIT_COMBO_SHEET);
  const data = sheet.getDataRange().getValues();
  const map = {};
  studentIds.forEach(function(id) { map[String(id)] = 0; });
  for (let i = 1; i < data.length; i++) {
    const sid = String(data[i][0]);
    if (map.hasOwnProperty(sid)) map[sid] = Number(data[i][1]) || 0;
  }
  return map;
}

function chambitWeekProgress_(studentId, classId, weekMonday, requiredDates) {
  if (!requiredDates || !requiredDates.length) return { read: 0, required: 0 };
  const readSet = chambitReadDailySetForStudent_(
    studentId, classId, weekMonday, chambitWeekSunday_(weekMonday)
  );
  let read = 0;
  for (let i = 0; i < requiredDates.length; i++) {
    if (readSet[requiredDates[i]]) read++;
  }
  return { read: read, required: requiredDates.length };
}

const CLASS_LOG_SPREADSHEET_ID_ = '1kUbo820pEzNThBmIQmwVi5MCd1O888y1rtuxz2IH4H4';
const CLASS_LOG_TAB_BY_CLASS_ID_ = {
  C002: { tab: '5Days', layout: 'combined' },
  C003: { tab: ' MWF 3:20 ', layout: 'combined' },
  C005: { tab: 'MW 5:30 ', layout: 'split' },
  C004: { tab: 'TTH 4:10', layout: 'split' }
};
const CLASS_LOG_MONTH_NAMES_ = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const CLASS_LOG_DAY_NAMES_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function classLogMonthHeader_(dateStr) {
  const p = dateStr.split('-');
  return CLASS_LOG_MONTH_NAMES_[Number(p[1]) - 1] + ', ' + p[0];
}

function classLogLongDate_(dateStr) {
  const p = chambitParseDate_(dateStr);
  const dow = new Date(p.y, p.m, p.d).getDay();
  return CLASS_LOG_DAY_NAMES_[dow] + ', ' + p.d;
}

function classLogShortDate_(dateStr) {
  const p = dateStr.split('-');
  return p[0].slice(-2) + '.' + p[1] + '.' + p[2];
}

function matchStudentNameClassLog_(backendName, logName) {
  const bn = String(backendName || '').trim().toLowerCase();
  const ln = String(logName || '').trim().toLowerCase();
  if (!bn || !ln) return false;
  if (ln === bn || ln.indexOf(bn) !== -1) return true;
  const parts = bn.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first && first.length > 1 && ln.indexOf(first) !== -1) return true;
  if (last && last !== first && last.length > 1 && ln.indexOf(last) !== -1) return true;
  return false;
}

function classLogRowOffset_(config, key) {
  const split = config.layout === 'split';
  const map = {
    date: 1, lesson: 2, homework: 3, writing: 4, chambit: 5,
    classLabel: 6, shortDate: split ? 7 : 6, students: split ? 8 : 7
  };
  return map[key];
}

function findClassLogMonthStart_(colA, monthHeader) {
  for (let i = 0; i < colA.length; i++) {
    if (colA[i] && String(colA[i][0]).trim() === monthHeader) return i;
  }
  return -1;
}

function findClassLogDateCol_(row, dateStr) {
  const longLabel = classLogLongDate_(dateStr);
  const shortLabel = classLogShortDate_(dateStr);
  for (let c = 1; c < row.length; c++) {
    const v = String(row[c] || '').trim();
    if (!v) continue;
    if (v === longLabel || v === shortLabel) return c;
  }
  return -1;
}

function syncChambitToClassLog_(classId, studentName, dateStr, read) {
  try {
    const config = CLASS_LOG_TAB_BY_CLASS_ID_[String(classId)];
    if (!config) return { synced: false, reason: 'no_tab_config' };
    if (!studentName) return { synced: false, reason: 'no_student_name' };

    const ss = SpreadsheetApp.openById(CLASS_LOG_SPREADSHEET_ID_);
    const sheet = ss.getSheetByName(config.tab);
    if (!sheet) return { synced: false, reason: 'tab_not_found' };

    const monthHeader = classLogMonthHeader_(dateStr);
    const colA = sheet.getRange(1, 1, 250, 1).getValues();
    const monthStart0 = findClassLogMonthStart_(colA, monthHeader);
    if (monthStart0 < 0) return { synced: false, reason: 'month_block_not_found' };

    let blockEnd0 = colA.length;
    for (let i = monthStart0 + 1; i < colA.length; i++) {
      const cell = colA[i] && colA[i][0];
      if (cell && /^[A-Za-z]+, 20\d{2}$/.test(String(cell).trim())) {
        blockEnd0 = i;
        break;
      }
    }

    const dateRow1 = monthStart0 + classLogRowOffset_(config, 'date') + 1;
    const shortRow1 = monthStart0 + classLogRowOffset_(config, 'shortDate') + 1;
    const dateRow = sheet.getRange(dateRow1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let col = findClassLogDateCol_(dateRow, dateStr);
    if (col < 0) {
      const shortRow = sheet.getRange(shortRow1, 1, 1, sheet.getLastColumn()).getValues()[0];
      col = findClassLogDateCol_(shortRow, dateStr);
    }
    if (col < 0) return { synced: false, reason: 'date_column_not_found' };

    const studentStart1 = monthStart0 + classLogRowOffset_(config, 'students') + 1;
    const nameCol = sheet.getRange(studentStart1, 1, blockEnd0, 1).getValues();
    let studentRow1 = -1;
    for (let i = 0; i < nameCol.length; i++) {
      const name = nameCol[i] && nameCol[i][0];
      if (!name) break;
      if (matchStudentNameClassLog_(studentName, name)) {
        studentRow1 = studentStart1 + i;
        break;
      }
    }
    if (studentRow1 < 0) return { synced: false, reason: 'student_row_not_found' };

    const mark = read ? 'O' : 'X';
    sheet.getRange(studentRow1, col + 1).setValue(mark);
    return { synced: true, mark: mark };
  } catch (e) {
    return { synced: false, error: String(e.message || e) };
  }
}

function chambitSyncClassLogForStudent_(classId, studentId, dateStr, read) {
  const students = getEnrolledStudents_(classId);
  let name = '';
  for (let i = 0; i < students.length; i++) {
    if (String(students[i].id) === String(studentId)) {
      name = students[i].name;
      break;
    }
  }
  return syncChambitToClassLog_(classId, name, dateStr, read);
}

function toggleChambitRead(classId, studentId, dateStr, action, allowedDays) {
  ensureChambitSheets_();
  const tz = Session.getScriptTimeZone();
  dateStr = formatSheetDate_(dateStr, tz);
  if (!dateStr) throw new Error('Date is required.');
  if (getHolidayName(dateStr)) throw new Error('No class on public holidays.');
  const days = chambitNormalizeAllowedDays_(allowedDays);
  const p = chambitParseDate_(dateStr);
  const dow = new Date(p.y, p.m, p.d).getDay();
  if (days.indexOf(dow) === -1) throw new Error('Not a scheduled class day.');

  const act = String(action || '').toLowerCase();
  if (act === 'plus' || act === '+') {
    chambitSetDailyRead_(classId, studentId, dateStr, true);
    const weekKey = chambitWeekMonday_(dateStr);
    let combo = chambitGetComboCount_(studentId);
    let weekCompleted = false;
    if (chambitIsWeekComplete_(studentId, classId, weekKey, allowedDays) &&
        !chambitHasWeekAward_(studentId, weekKey)) {
      combo = chambitIncrementCombo_(studentId);
      chambitMarkWeekAward_(studentId, weekKey);
      weekCompleted = true;
    }
    const weekMonday = chambitWeekMonday_(dateStr);
    const weekRequired = chambitGetRequiredDatesInWeek_(weekMonday, allowedDays);
    const weekProg = chambitWeekProgress_(studentId, classId, weekMonday, weekRequired);
    const classLog = chambitSyncClassLogForStudent_(classId, studentId, dateStr, true);
    return {
      studentId: studentId,
      chambitRead: true,
      chambitCombo: combo,
      chambitWeekRead: weekProg.read,
      chambitWeekRequired: weekProg.required,
      weekCompleted: weekCompleted,
      classLogSynced: !!(classLog && classLog.synced)
    };
  }
  if (act === 'minus' || act === '-') {
    chambitSetDailyRead_(classId, studentId, dateStr, false);
    chambitSetComboCount_(studentId, 0);
    chambitClearWeekAwards_(studentId);
    const weekMonday = chambitWeekMonday_(dateStr);
    const weekRequired = chambitGetRequiredDatesInWeek_(weekMonday, allowedDays);
    const weekProg = chambitWeekProgress_(studentId, classId, weekMonday, weekRequired);
    const classLog = chambitSyncClassLogForStudent_(classId, studentId, dateStr, false);
    return {
      studentId: studentId,
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

// 8. (선택) 달러뱅크 스프레드시트에서 잔액만 가져와 병합
// - 출결 Student_List에 있는 학생만 반영
// - DollarBank 쪽에만 있는 학생은 무시
function importDollarBalancesFromDollarBankSpreadsheet(dollarSpreadsheetId) {
  if (!dollarSpreadsheetId) throw new Error('dollarSpreadsheetId가 필요합니다.');
  ensureDollarSheets_();

  const ss = getSS();
  const studentSheet = ss.getSheetByName('Student_List');
  const studentData = studentSheet.getDataRange().getValues();
  const enrolledSet = new Set();
  for (let i = 1; i < studentData.length; i++) {
    const sid = studentData[i][0];
    const status = studentData[i][3];
    if (sid && status === 'Enrolled') enrolledSet.add(sid);
  }

  const dollarSS = SpreadsheetApp.openById(dollarSpreadsheetId);
  const dollarStudents = dollarSS.getSheetByName('Students');
  if (!dollarStudents) throw new Error('달러뱅크 스프레드시트에 Students 시트가 없습니다.');

  const rows = dollarStudents.getDataRange().getValues(); // StudentID, Name, ClassName, PinCode, Balance, ...
  const imported = [];
  for (let i = 1; i < rows.length; i++) {
    const sid = rows[i][0];
    const bal = Number(rows[i][4]) || 0;
    if (sid && enrolledSet.has(sid)) {
      imported.push([sid, bal]);
    }
  }

  const balancesSheet = ss.getSheetByName(DOLLAR_SHEETS.BALANCES);
  balancesSheet.clearContents();
  balancesSheet.appendRow(['StudentID', 'Balance']);
  balancesSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  if (imported.length > 0) {
    balancesSheet.getRange(2, 1, imported.length, 2).setValues(imported);
  }

  return `Imported dollar balances: ${imported.length} students.`;
}

// ===== Textbooks & progress =====
const TEXTBOOK_SHEETS = {
  BOOKS: 'Class_Textbooks',
  PROGRESS: 'Textbook_Progress',
  QUEUE: 'Textbook_Queue'
};

function ensureTextbookSheets_() {
  const ss = getSS();
  let books = ss.getSheetByName(TEXTBOOK_SHEETS.BOOKS);
  if (!books) {
    books = ss.insertSheet(TEXTBOOK_SHEETS.BOOKS);
    books.appendRow(['TextbookID', 'ClassID', 'Name', 'Type', 'UnitType', 'TotalUnits', 'StartDate', 'Status', 'CompletedAt']);
    books.getRange(1, 1, 1, 9).setFontWeight('bold');
  } else {
    const headers = books.getRange(1, 1, 1, books.getLastColumn()).getValues()[0];
    if (headers.indexOf('StartDate') < 0) {
      const col = books.getLastColumn() + 1;
      books.getRange(1, col).setValue('StartDate').setFontWeight('bold');
    }
    if (headers.indexOf('Status') < 0) {
      const col = books.getLastColumn() + 1;
      books.getRange(1, col).setValue('Status').setFontWeight('bold');
    }
    if (headers.indexOf('CompletedAt') < 0) {
      const col = books.getLastColumn() + 1;
      books.getRange(1, col).setValue('CompletedAt').setFontWeight('bold');
    }
  }
  let prog = ss.getSheetByName(TEXTBOOK_SHEETS.PROGRESS);
  if (!prog) {
    prog = ss.insertSheet(TEXTBOOK_SHEETS.PROGRESS);
    prog.appendRow(['Date', 'ClassID', 'TextbookID', 'Position']);
    prog.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  let queue = ss.getSheetByName(TEXTBOOK_SHEETS.QUEUE);
  if (!queue) {
    queue = ss.insertSheet(TEXTBOOK_SHEETS.QUEUE);
    queue.appendRow(['QueueID', 'ClassID', 'SortOrder', 'Name', 'Type', 'UnitType', 'TotalUnits', 'CreatedAt']);
    queue.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
}

function formatDateStr_(value, tz) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(value);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return '';
}

function calcWeekNumber_(startDateStr, refDateStr) {
  if (!startDateStr || !refDateStr) return null;
  const start = new Date(startDateStr + 'T12:00:00');
  const ref = new Date(refDateStr + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(ref.getTime())) return null;
  if (ref < start) return 0;
  const diffDays = Math.floor((ref.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(diffDays / 7) + 1;
}

function calcExpectedFinishDate_(startDateStr, refDateStr, currentPos, totalUnits) {
  if (!startDateStr || !refDateStr) return null;
  const total = Number(totalUnits) || 0;
  const current = Number(currentPos) || 0;
  if (total <= 0) return null;
  if (current >= total) return refDateStr;
  if (current <= 0) return null;
  const weekNum = calcWeekNumber_(startDateStr, refDateStr);
  if (!weekNum || weekNum <= 0) return null;
  const unitsPerWeek = current / weekNum;
  if (unitsPerWeek <= 0) return null;
  const weeksLeft = (total - current) / unitsPerWeek;
  const daysLeft = Math.ceil(weeksLeft * 7);
  const ref = new Date(refDateStr + 'T12:00:00');
  ref.setDate(ref.getDate() + daysLeft);
  return Utilities.formatDate(ref, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function readTextbookQueueForClass_(classId) {
  ensureTextbookSheets_();
  const sheet = getSS().getSheetByName(TEXTBOOK_SHEETS.QUEUE);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const idStr = String(classId);
  const items = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== idStr) continue;
    items.push({
      row: i + 1,
      queueId: String(data[i][0]),
      sortOrder: Number(data[i][2]) || 0,
      name: String(data[i][3] || ''),
      type: String(data[i][4] || ''),
      unitType: String(data[i][5] || 'chapter'),
      totalUnits: Number(data[i][6]) || 0,
      createdAt: data[i][7] ? String(data[i][7]) : ''
    });
  }
  items.sort(function(a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.row - b.row;
  });
  return { sheet: sheet, items: items };
}

function isQueueItemReady_(item) {
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!String(item.name || '').trim()) return false;
  if (!allowed.includes(String(item.type || '').trim())) return false;
  const total = Number(item.totalUnits);
  return Number.isFinite(total) && total > 0;
}

function promoteNextQueuedTextbook_(classId) {
  const q = readTextbookQueueForClass_(classId);
  if (!q.items.length) return null;
  const next = q.items[0];
  if (!isQueueItemReady_(next)) {
    return { skipped: true, reason: 'incomplete', name: next.name };
  }
  const added = addClassTextbook(classId, next.name, next.type, next.unitType, next.totalUnits, null);
  q.sheet.deleteRow(next.row);
  return {
    textbookId: added.textbookId,
    name: next.name,
    type: next.type,
    unitType: next.unitType,
    totalUnits: next.totalUnits
  };
}

function getClassTextbookData(classId, dateStr) {
  ensureTextbookSheets_();
  const ctx = buildRequestContext_(classId);
  return buildClassTextbookFromCtx_(ctx, dateStr);
}

function normalizeQueueFields_(type, unitType, totalUnits) {
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  const t = String(type || '').trim();
  if (t && !allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : (unitType === 'chapter' ? 'chapter' : '');
  const totalRaw = totalUnits === '' || totalUnits == null ? 0 : Number(totalUnits);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
  return { type: t, unitType: ut, totalUnits: total };
}

function addTextbookToQueue(classId, name, type, unitType, totalUnits) {
  ensureTextbookSheets_();
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const fields = normalizeQueueFields_(type, unitType, totalUnits);

  const q = readTextbookQueueForClass_(classId);
  const maxSort = q.items.reduce(function(m, item) { return Math.max(m, item.sortOrder); }, 0);
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const queueId = 'TQ_' + classId + '_' + Date.now();
  q.sheet.appendRow([queueId, classId, maxSort + 1, n, fields.type, fields.unitType, fields.totalUnits, now]);
  return {
    message: 'Added to queue.',
    queueId: queueId,
    name: n
  };
}

function updateTextbookQueueItem(queueId, name, type, unitType, totalUnits) {
  ensureTextbookSheets_();
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const fields = normalizeQueueFields_(type, unitType, totalUnits);
  const sheet = getSS().getSheetByName(TEXTBOOK_SHEETS.QUEUE);
  const data = sheet.getDataRange().getValues();
  const idStr = String(queueId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    sheet.getRange(i + 1, 4).setValue(n);
    sheet.getRange(i + 1, 5).setValue(fields.type);
    sheet.getRange(i + 1, 6).setValue(fields.unitType);
    sheet.getRange(i + 1, 7).setValue(fields.totalUnits);
    return { message: 'Queue item updated.', queueId: idStr, name: n };
  }
  throw new Error('Queue item not found.');
}

function deleteTextbookQueueItem(queueId) {
  ensureTextbookSheets_();
  const sheet = getSS().getSheetByName(TEXTBOOK_SHEETS.QUEUE);
  const data = sheet.getDataRange().getValues();
  const idStr = String(queueId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === idStr) {
      sheet.deleteRow(i + 1);
      return { message: 'Removed from queue.' };
    }
  }
  throw new Error('Queue item not found.');
}

function addClassTextbook(classId, name, type, unitType, totalUnits, startDateStr) {
  ensureTextbookSheets_();
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const t = String(type || '').trim();
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : 'chapter';
  const total = Number(totalUnits);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Enter total chapters or pages (greater than 0).');

  const tz = Session.getScriptTimeZone();
  let startStr = formatDateStr_(startDateStr, tz);
  if (!startStr) startStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const ss = getSS();
  const sheet = ss.getSheetByName(TEXTBOOK_SHEETS.BOOKS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('Status') + 1;

  const id = 'TB_' + classId + '_' + Date.now();
  sheet.appendRow([id, classId, n, t, ut, total, startStr]);
  const newRow = sheet.getLastRow();
  if (statusCol > 0) sheet.getRange(newRow, statusCol).setValue('Active');
  return { textbookId: id, message: 'Textbook added.' };
}

function updateClassTextbook(textbookId, name, type, unitType, totalUnits, startDateStr) {
  ensureTextbookSheets_();
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const t = String(type || '').trim();
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : 'chapter';
  const total = Number(totalUnits);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Enter total chapters or pages (greater than 0).');

  const tz = Session.getScriptTimeZone();
  const startStr = formatDateStr_(startDateStr, tz);
  if (!startStr) throw new Error('Start date is required.');

  const ss = getSS();
  const sheet = ss.getSheetByName(TEXTBOOK_SHEETS.BOOKS);
  const data = sheet.getDataRange().getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startCol = headers.indexOf('StartDate') + 1; // 1-based

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === textbookId) {
      sheet.getRange(i + 1, 3).setValue(n);
      sheet.getRange(i + 1, 4).setValue(t);
      sheet.getRange(i + 1, 5).setValue(ut);
      sheet.getRange(i + 1, 6).setValue(total);
      if (startCol > 0) sheet.getRange(i + 1, startCol).setValue(startStr);
      return { message: 'Textbook updated.' };
    }
  }
  throw new Error('Textbook not found.');
}

/** Mark textbook complete — promotes next queued book if any. */
function completeClassTextbook(textbookId) {
  ensureTextbookSheets_();
  const ss = getSS();
  const sheet = ss.getSheetByName(TEXTBOOK_SHEETS.BOOKS);
  const data = sheet.getDataRange().getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.indexOf('Status') + 1;
  const completedCol = headers.indexOf('CompletedAt') + 1;
  if (statusCol <= 0) throw new Error('Status column missing. Re-open the app to migrate the sheet.');

  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== textbookId) continue;
    const classId = data[i][1];
    sheet.getRange(i + 1, statusCol).setValue('Completed');
    if (completedCol > 0) sheet.getRange(i + 1, completedCol).setValue(now);
    const next = promoteNextQueuedTextbook_(classId);
    if (next && next.skipped) {
      return {
        message: 'Textbook marked complete. "' + next.name + '" is next in queue but still needs type & total — edit it in Up Next.',
        queueBlocked: true
      };
    }
    if (next) {
      return {
        message: 'Textbook marked complete. Now reading: "' + next.name + '".',
        nextTextbook: next
      };
    }
    return { message: 'Textbook marked complete. Progress history is kept in the sheet.' };
  }
  throw new Error('Textbook not found.');
}

function saveTextbookProgress(classId, dateStr, records) {
  ensureTextbookSheets_();
  if (!dateStr) throw new Error('Date is required.');

  const ss = getSS();
  const sheet = ss.getSheetByName(TEXTBOOK_SHEETS.PROGRESS);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();

  for (let k = 0; k < records.length; k++) {
    const rec = records[k];
    const pos = Number(rec.position);
    if (!rec.textbookId || !Number.isFinite(pos) || pos < 0) continue;

    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rDate = Utilities.formatDate(new Date(data[i][0]), tz, 'yyyy-MM-dd');
      if (rDate === dateStr && data[i][1] === classId && data[i][2] === rec.textbookId) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow !== -1) {
      sheet.getRange(foundRow, 4).setValue(pos);
    } else {
      sheet.appendRow([dateStr, classId, rec.textbookId, pos]);
    }
  }
  return 'Textbook progress saved.';
}

// ===== Class Rules (per class, floating sidebar) =====
const RULES_SHEET = 'Class_Rules';

function ensureClassRulesSheet_() {
  const ss = getSS();
  let sheet = ss.getSheetByName(RULES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(RULES_SHEET);
    sheet.appendRow(['ClassID', 'Rules', 'UpdatedAt']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
}

function parseRulesText_(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(function(line) { return line.trim(); })
    .filter(function(line) { return line.length > 0; });
}

function getClassRules(classId) {
  ensureClassRulesSheet_();
  const sheet = getSS().getSheetByName(RULES_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(classId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    let rulesText = data[i][1];
    if (rulesText == null || rulesText === '') {
      rulesText = '';
    } else if (Array.isArray(rulesText)) {
      rulesText = rulesText.join('\n');
    } else {
      rulesText = String(rulesText);
    }
    const rules = parseRulesText_(rulesText);
    if (!rulesText && rules.length) rulesText = rules.join('\n');
    return { rules: rules, rulesText: rulesText };
  }
  return { rules: [], rulesText: '' };
}

function saveClassRules(classId, rulesText) {
  ensureClassRulesSheet_();
  const sheet = getSS().getSheetByName(RULES_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  rulesText = String(rulesText || '').replace(/\r\n/g, '\n');
  const idStr = String(classId);

  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    sheet.getRange(found, 2, 1, 2).setValues([[rulesText, now]]);
  } else {
    sheet.appendRow([classId, rulesText, now]);
  }
  const rules = parseRulesText_(rulesText);
  invalidateClassSidebarCache_(classId);
  return { message: 'Class rules saved.', rules: rules, rulesText: rulesText };
}

// ===== Library books to return =====
const LIBRARY_SHEET = 'Library_Books';

function ensureLibraryBooksSheet_() {
  const ss = getSS();
  let sheet = ss.getSheetByName(LIBRARY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LIBRARY_SHEET);
    sheet.appendRow(['BookID', 'ClassID', 'StudentID', 'Title', 'Status', 'CreatedAt', 'ReturnedAt']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
}

function readPendingBooksForClass_(classId) {
  ensureLibraryBooksSheet_();
  const sheet = getSS().getSheetByName(LIBRARY_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(classId);
  const byStudent = {};

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== idStr) continue;
    if (String(data[i][4]) === 'Returned') continue;
    const sid = String(data[i][2]);
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push({
      bookId: String(data[i][0]),
      title: String(data[i][3] || '')
    });
  }
  return byStudent;
}

function readPendingBooksForClass_(classId) {
  ensureLibraryBooksSheet_();
  const sheet = getSS().getSheetByName(LIBRARY_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(classId);
  const byStudent = {};

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== idStr) continue;
    if (String(data[i][4]) === 'Returned') continue;
    const sid = String(data[i][2]);
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push({
      bookId: String(data[i][0]),
      title: String(data[i][3] || '')
    });
  }
  return byStudent;
}

function buildClassStudentDirectory_(classId) {
  classId = String(classId);
  const nameMap = {};
  const statusMap = {};
  const ss = getSS();
  const listSheet = ss.getSheetByName('Student_List');
  if (listSheet) {
    const data = listSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][2]) !== classId) continue;
      const sid = String(data[i][0]);
      nameMap[sid] = String(data[i][1] || sid);
      statusMap[sid] = String(data[i][3] || '').trim() || 'Enrolled';
    }
  }
  const withdrawnSheet = ss.getSheetByName('Student_Withdrawn');
  if (withdrawnSheet) {
    const w = withdrawnSheet.getDataRange().getValues();
    for (let i = 1; i < w.length; i++) {
      if (String(w[i][3]) !== classId) continue;
      const sid = String(w[i][1]);
      if (!nameMap[sid]) nameMap[sid] = String(w[i][2] || sid);
      if (!statusMap[sid] || statusMap[sid] === 'Withdrawn') statusMap[sid] = 'Withdrawn';
    }
  }
  return { nameMap: nameMap, statusMap: statusMap };
}

function getClassBooksToReturn(classId) {
  const dir = buildClassStudentDirectory_(classId);
  const byStudent = readPendingBooksForClass_(classId);
  const result = [];
  Object.keys(byStudent).forEach(function(sid) {
    result.push({
      studentId: sid,
      studentName: dir.nameMap[sid] || sid,
      withdrawn: dir.statusMap[sid] === 'Withdrawn',
      books: byStudent[sid]
    });
  });
  result.sort(function(a, b) { return a.studentName.localeCompare(b.studentName); });
  return { students: result };
}

function getLibraryEditData(classId) {
  const enrolled = getEnrolledStudents_(classId);
  const dir = buildClassStudentDirectory_(classId);
  const byStudent = readPendingBooksForClass_(classId);
  const map = {};
  enrolled.forEach(function(s) {
    map[s.id] = {
      id: s.id,
      name: s.name,
      withdrawn: false,
      books: byStudent[s.id] || []
    };
  });
  Object.keys(byStudent).forEach(function(sid) {
    if (map[sid]) {
      map[sid].books = byStudent[sid];
      return;
    }
    map[sid] = {
      id: sid,
      name: dir.nameMap[sid] || sid,
      withdrawn: dir.statusMap[sid] === 'Withdrawn',
      books: byStudent[sid]
    };
  });
  const students = Object.keys(map).map(function(k) { return map[k]; });
  students.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return { students: students };
}

function addLibraryBooks(classId, studentId, titles) {
  ensureLibraryBooksSheet_();
  if (!classId || !studentId) throw new Error('Class and student are required.');
  const sheet = getSS().getSheetByName(LIBRARY_SHEET);
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const added = [];

  (titles || []).forEach(function(title) {
    title = String(title || '').trim();
    if (!title) return;
    const bookId = 'BK_' + classId + '_' + studentId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    sheet.appendRow([bookId, classId, studentId, title, 'Pending', now, '']);
    added.push({ bookId: bookId, title: title });
  });

  if (!added.length) throw new Error('Enter at least one book title.');
  invalidateClassSidebarCache_(classId);
  return { message: 'Books added.', books: added };
}

function markLibraryBookReturned(bookId) {
  ensureLibraryBooksSheet_();
  const sheet = getSS().getSheetByName(LIBRARY_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const idStr = String(bookId);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    const classId = data[i][1];
    sheet.getRange(i + 1, 5, 1, 3).setValues([['Returned', data[i][5], now]]);
    invalidateClassSidebarCache_(classId);
    return { message: 'Book marked returned.', bookId: idStr };
  }
  throw new Error('Book not found.');
}

// ===== Announcement & Upcoming Events =====
const ANNOUNCE_SHEET = 'Class_Announcements';
const EVENTS_SHEET = 'Class_Events';

function ensureAnnounceSheets_() {
  const ss = getSS();
  let ann = ss.getSheetByName(ANNOUNCE_SHEET);
  if (!ann) {
    ann = ss.insertSheet(ANNOUNCE_SHEET);
    ann.appendRow(['ClassID', 'Text', 'UpdatedAt']);
    ann.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  let ev = ss.getSheetByName(EVENTS_SHEET);
  if (!ev) {
    ev = ss.insertSheet(EVENTS_SHEET);
    ev.appendRow(['EventID', 'ClassID', 'EventDate', 'Description', 'CreatedAt']);
    ev.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
}

function formatSheetDate_(val, tz) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return s.slice(0, 10);
}

function getClassAnnouncement(classId) {
  ensureAnnounceSheets_();
  const sheet = getSS().getSheetByName(ANNOUNCE_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(classId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    let text = data[i][1];
    if (text == null) text = '';
    else if (Array.isArray(text)) text = text.join('\n');
    else text = String(text);
    return { text: text };
  }
  return { text: '' };
}

function saveClassAnnouncement(classId, text) {
  ensureAnnounceSheets_();
  const sheet = getSS().getSheetByName(ANNOUNCE_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  text = String(text || '').replace(/\r\n/g, '\n');
  const idStr = String(classId);
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    sheet.getRange(found, 2, 1, 2).setValues([[text, now]]);
  } else {
    sheet.appendRow([classId, text, now]);
  }
  invalidateClassSidebarCache_(classId);
  return { message: 'Announcement saved.', text: text };
}

function readClassEvents_(classId) {
  ensureAnnounceSheets_();
  const sheet = getSS().getSheetByName(EVENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const idStr = String(classId);
  const events = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== idStr) continue;
    events.push({
      eventId: String(data[i][0]),
      eventDate: formatSheetDate_(data[i][2], tz),
      description: String(data[i][3] || '')
    });
  }
  events.sort(function(a, b) {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    return a.description.localeCompare(b.description);
  });
  return events;
}

function getClassUpcomingEvents(classId) {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const events = readClassEvents_(classId).filter(function(e) {
    return e.eventDate >= today;
  });
  return { events: events };
}

function getClassEventsEditData(classId) {
  return { events: readClassEvents_(classId) };
}

function addClassEvent(classId, dateStr, description) {
  ensureAnnounceSheets_();
  const tz = Session.getScriptTimeZone();
  dateStr = formatSheetDate_(dateStr, tz);
  description = String(description || '').trim();
  if (!dateStr) throw new Error('Event date is required.');
  if (!description) throw new Error('Event description is required.');
  const sheet = getSS().getSheetByName(EVENTS_SHEET);
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const eventId = 'EV_' + classId + '_' + Date.now();
  sheet.appendRow([eventId, classId, dateStr, description, now]);
  invalidateClassSidebarCache_(classId);
  return {
    message: 'Event added.',
    event: { eventId: eventId, eventDate: dateStr, description: description }
  };
}

function deleteClassEvent(eventId) {
  ensureAnnounceSheets_();
  const sheet = getSS().getSheetByName(EVENTS_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(eventId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === idStr) {
      invalidateClassSidebarCache_(data[i][1]);
      sheet.deleteRow(i + 1);
      return { message: 'Event removed.' };
    }
  }
  throw new Error('Event not found.');
}

function getHolidaysForMonth_(year, month) {
  const map = {};
  try {
    const cal = CalendarApp.getCalendarById(KR_HOLIDAY_CALENDAR_ID);
    if (!cal) return map;
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 1, 0, 0, 0);
    const tz = Session.getScriptTimeZone();
    cal.getEvents(start, end).forEach(function(ev) {
      const ds = Utilities.formatDate(ev.getStartTime(), tz, 'yyyy-MM-dd');
      if (!map[ds]) map[ds] = ev.getTitle();
    });
  } catch (e) { /* ignore */ }
  return map;
}

function getClassCalendarData(classId, year, month, allowedDays) {
  year = Number(year);
  month = Number(month);
  if (!classId) throw new Error('classId is required.');
  if (!year || !month || month < 1 || month > 12) {
    throw new Error('year and month (1–12) are required.');
  }

  const allowed = chambitNormalizeAllowedDays_(allowedDays);
  const holidays = getHolidaysForMonth_(year, month);
  const events = readClassEvents_(classId);
  const homework = readHomeworkLogForClass_(classId);
  const numDays = new Date(year, month, 0).getDate();
  const days = {};

  for (let d = 1; d <= numDays; d++) {
    const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dow = new Date(dateStr + 'T12:00:00').getDay();
    const holiday = holidays[dateStr] || '';
    let offReason = null;
    if (holiday) offReason = 'holiday';
    else if (allowed.length && allowed.indexOf(dow) === -1) offReason = 'schedule';

    days[dateStr] = {
      holiday: holiday,
      offDay: !!offReason,
      offReason: offReason,
      events: events.filter(function(e) { return e.eventDate === dateStr; }).map(function(e) {
        return { eventId: e.eventId, description: e.description };
      }),
      homework: homework.filter(function(h) { return h.assignedDate === dateStr; }).map(function(h) {
        return { homeworkId: h.homeworkId, title: h.title, description: h.description };
      })
    };
  }

  return { year: year, month: month, classId: classId, allowedDays: allowed, days: days };
}

// ===== Class Video (per class, YouTube embed) =====
const VIDEO_SHEET = 'Class_Video';
const DEFAULT_YOUTUBE_VIDEO_ID = 'gmqG2h84_Cs';

function parseYoutubeVideoId_(urlOrId) {
  const s = String(urlOrId || '').trim();
  if (!s) return DEFAULT_YOUTUBE_VIDEO_ID;
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  let m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = s.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  throw new Error('Enter a valid YouTube URL or 11-character video ID.');
}

function youtubeEmbedUrl_(videoId) {
  return 'https://www.youtube.com/embed/' + videoId + '?rel=0&modestbranding=1';
}

function ensureClassVideoSheet_() {
  const ss = getSS();
  let sheet = ss.getSheetByName(VIDEO_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VIDEO_SHEET);
    sheet.appendRow(['ClassID', 'VideoUrl', 'UpdatedAt']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
}

function getClassVideo(classId) {
  ensureClassVideoSheet_();
  const sheet = getSS().getSheetByName(VIDEO_SHEET);
  const data = sheet.getDataRange().getValues();
  const idStr = String(classId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    const raw = String(data[i][1] || '').trim();
    let videoId = DEFAULT_YOUTUBE_VIDEO_ID;
    try {
      videoId = parseYoutubeVideoId_(raw);
    } catch (e) {
      videoId = DEFAULT_YOUTUBE_VIDEO_ID;
    }
    return {
      videoUrl: raw || 'https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID,
      videoId: videoId,
      embedUrl: youtubeEmbedUrl_(videoId)
    };
  }
  return {
    videoUrl: 'https://www.youtube.com/watch?v=' + DEFAULT_YOUTUBE_VIDEO_ID,
    videoId: DEFAULT_YOUTUBE_VIDEO_ID,
    embedUrl: youtubeEmbedUrl_(DEFAULT_YOUTUBE_VIDEO_ID)
  };
}

function saveClassVideo(classId, videoUrl) {
  ensureClassVideoSheet_();
  const videoId = parseYoutubeVideoId_(videoUrl);
  const normalized = String(videoUrl || '').trim() ||
    ('https://www.youtube.com/watch?v=' + videoId);
  const sheet = getSS().getSheetByName(VIDEO_SHEET);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const idStr = String(classId);
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    sheet.getRange(found, 2, 1, 2).setValues([[normalized, now]]);
  } else {
    sheet.appendRow([classId, normalized, now]);
  }
  invalidateClassSidebarCache_(classId);
  return {
    message: 'Video saved.',
    videoUrl: normalized,
    videoId: videoId,
    embedUrl: youtubeEmbedUrl_(videoId)
  };
}

// ===== Homework + Google Classroom =====
const HOMEWORK_SHEETS = {
  MAP: 'Classroom_Map',
  LOG: 'Homework_Log',
  ITEMS: 'Homework_Items',
  COMPLETION: 'Homework_Completion'
};

function ensureHomeworkSheets_() {
  const ss = getSS();

  let map = ss.getSheetByName(HOMEWORK_SHEETS.MAP);
  if (!map) {
    map = ss.insertSheet(HOMEWORK_SHEETS.MAP);
    map.appendRow(['ClassID', 'CourseID', 'CourseName']);
    map.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  let log = ss.getSheetByName(HOMEWORK_SHEETS.LOG);
  if (!log) {
    log = ss.insertSheet(HOMEWORK_SHEETS.LOG);
    log.appendRow(['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt']);
    log.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  let items = ss.getSheetByName(HOMEWORK_SHEETS.ITEMS);
  if (!items) {
    items = ss.insertSheet(HOMEWORK_SHEETS.ITEMS);
    items.appendRow(['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description']);
    items.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  let comp = ss.getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  if (!comp) {
    comp = ss.insertSheet(HOMEWORK_SHEETS.COMPLETION);
    comp.appendRow(['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote']);
    comp.getRange(1, 1, 1, 5).setFontWeight('bold');
  } else {
    ensureCompletionFixNoteColumn_();
    ensureHomeworkTargetStudentColumn_();
  }

  migrateLegacyHomework_();
}

function ensureCompletionFixNoteColumn_() {
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  if (!sheet) return;
  const header = sheet.getRange(1, 1, 1, Math.max(5, sheet.getLastColumn())).getValues()[0];
  if (String(header[4] || '').trim() === 'FixNote') return;
  if (String(header[0] || '').trim() !== 'ItemID') return;
  sheet.getRange(1, 5).setValue('FixNote').setFontWeight('bold');
}

function getEnrolledStudents_(classId) {
  const ss = getSS();
  const data = ss.getSheetByName('Student_List').getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === classId && data[i][3] === 'Enrolled') {
      out.push({ id: String(data[i][0]), name: String(data[i][1] || '') });
    }
  }
  out.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return out;
}

function parseHomeworkDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val).slice(0, 10);
}

function getClassroomMap_(classId) {
  ensureHomeworkSheets_();
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.MAP);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId) {
      return { courseId: String(data[i][1] || ''), courseName: String(data[i][2] || '') };
    }
  }
  return null;
}

function readHomeworkLogForClass_(classId) {
  ensureHomeworkSheets_();
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.LOG);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== classId) continue;
    rows.push({
      homeworkId: String(data[i][0]),
      classId: data[i][1],
      assignedDate: parseHomeworkDate_(data[i][2]),
      title: String(data[i][3] || ''),
      description: String(data[i][4] || ''),
      classroomWorkId: String(data[i][5] || ''),
      postedAt: data[i][6] ? String(data[i][6]) : ''
    });
  }
  rows.sort(function(a, b) {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.homeworkId < b.homeworkId ? 1 : -1;
  });
  return rows;
}

function findHomeworkRow_(homeworkId) {
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.LOG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === homeworkId) return i + 1;
  }
  return -1;
}

function findHomeworkByClassDate_(classId, dateStr) {
  const rows = readHomeworkLogForClass_(classId);
  return rows.find(function(r) { return r.assignedDate === dateStr; }) || null;
}

function newHomeworkId_(classId) {
  return 'HW_' + classId + '_' + Date.now();
}

function newHomeworkItemId_(homeworkId, sortOrder) {
  return 'HWI_' + homeworkId + '_' + sortOrder;
}

var CHAMBIT_HOMEWORK_TITLE_ = '1 Chambit';

function homeworkStudentFirstName_(fullName) {
  const n = String(fullName || '').trim();
  if (!n) return '';
  const parts = n.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Za-z][A-Za-z'-]*$/.test(parts[i])) return parts[i];
  }
  return parts[0];
}

function isChambitHomeworkTitle_(title) {
  return String(title || '').trim() === CHAMBIT_HOMEWORK_TITLE_;
}

function formatHomeworkItemDisplayTitle_(item, nameById) {
  nameById = nameById || {};
  const base = String((item && item.title) || '').trim();
  const ids = (item && item.targetStudentIds) || [];
  if (!ids.length) return base;
  const names = [];
  for (let i = 0; i < ids.length; i++) {
    const nm = homeworkStudentFirstName_(nameById[String(ids[i])]);
    if (nm) names.push(nm);
  }
  if (!names.length) return base;
  return names.join(', ') + ': ' + base;
}

function normalizeHomeworkItems_(raw) {
  if (!raw || !raw.length) throw new Error('Add at least one homework item.');
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const title = String((item && item.title) || item || '').trim();
    const description = String((item && item.description) || '').trim();
    if (!title) continue;
    let targetStudentIds = [];
    const targetType = String((item && item.targetType) || 'all').toLowerCase();
    if (targetType === 'individual') {
      const ids = (item && item.studentIds) ? item.studentIds : [];
      for (let j = 0; j < ids.length; j++) {
        const sid = String(ids[j] || '').trim();
        if (sid) targetStudentIds.push(sid);
      }
      if (!targetStudentIds.length) {
        throw new Error('Pick at least one student for homework item ' + (items.length + 1) + '.');
      }
    }
    items.push({
      title: title,
      description: description,
      sortOrder: items.length + 1,
      targetStudentIds: targetStudentIds
    });
  }
  if (!items.length) throw new Error('Each homework item needs a title.');
  let hasChambit = false;
  for (let i = 0; i < items.length; i++) {
    if (isChambitHomeworkTitle_(items[i].title)) hasChambit = true;
  }
  if (!hasChambit) {
    items.push({
      title: CHAMBIT_HOMEWORK_TITLE_,
      description: '',
      sortOrder: items.length + 1,
      targetStudentIds: []
    });
  }
  return items;
}

function buildClassroomDescriptionFromItems_(items, nameById) {
  nameById = nameById || {};
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const n = i + 1;
    const title = formatHomeworkItemDisplayTitle_(items[i], nameById);
    const desc = String(items[i].description || '').trim();
    if (!title) continue;
    lines.push(desc ? (n + '. ' + title + '\n   ' + desc) : (n + '. ' + title));
  }
  return lines.join('\n\n');
}

function formatHomeworkForClassLog_(items, nameById) {
  nameById = nameById || {};
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const title = formatHomeworkItemDisplayTitle_(items[i], nameById);
    const desc = String(items[i].description || '').trim();
    if (!title) continue;
    lines.push(desc && title.indexOf(desc) === -1 ? (title + ' ' + desc) : title);
  }
  return lines.join('\n');
}

function parseItemsFromRows_(itemRows, validHomeworkIds) {
  const byHw = {};
  for (let i = 1; i < itemRows.length; i++) {
    const hid = String(itemRows[i][1]);
    if (validHomeworkIds && !validHomeworkIds[hid]) continue;
    if (!byHw[hid]) byHw[hid] = [];
    byHw[hid].push({
      itemId: String(itemRows[i][0]),
      homeworkId: hid,
      sortOrder: Number(itemRows[i][2]) || 0,
      title: String(itemRows[i][3] || ''),
      description: String(itemRows[i][4] || ''),
      targetStudentIds: String(itemRows[i][5] || '').split(',').map(function(s) {
        return s.trim();
      }).filter(Boolean)
    });
  }
  Object.keys(byHw).forEach(function(hid) {
    byHw[hid].sort(function(a, b) { return a.sortOrder - b.sortOrder; });
  });
  return byHw;
}

function readItemsMapForClass_(classId) {
  const logs = readHomeworkLogForClass_(classId);
  const hwIds = {};
  logs.forEach(function(r) { hwIds[r.homeworkId] = true; });
  ensureHomeworkSheets_();
  const itemRows = getSS().getSheetByName(HOMEWORK_SHEETS.ITEMS).getDataRange().getValues();
  return parseItemsFromRows_(itemRows, hwIds);
}

function deleteItemsForHomework_(homeworkId) {
  ensureHomeworkSheets_();
  const ss = getSS();
  const itemSheet = ss.getSheetByName(HOMEWORK_SHEETS.ITEMS);
  const itemData = itemSheet.getDataRange().getValues();
  const itemIds = [];
  for (let i = itemData.length - 1; i >= 1; i--) {
    if (String(itemData[i][1]) !== homeworkId) continue;
    itemIds.push(String(itemData[i][0]));
    itemSheet.deleteRow(i + 1);
  }

  const compSheet = ss.getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const compData = compSheet.getDataRange().getValues();
  for (let i = compData.length - 1; i >= 1; i--) {
    const key = String(compData[i][0]);
    if (itemIds.indexOf(key) !== -1 || key === homeworkId) compSheet.deleteRow(i + 1);
  }
}

function ensureHomeworkTargetStudentColumn_() {
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.ITEMS);
  if (!sheet) return;
  const header = sheet.getRange(1, 1, 1, Math.max(6, sheet.getLastColumn())).getValues()[0];
  if (String(header[5] || '').trim() === 'TargetStudentIDs') return;
  if (String(header[0] || '').trim() !== 'ItemID') return;
  sheet.getRange(1, 6).setValue('TargetStudentIDs').setFontWeight('bold');
}

function saveHomeworkItems_(homeworkId, classId, items) {
  ensureHomeworkTargetStudentColumn_();
  deleteItemsForHomework_(homeworkId);
  const itemSheet = getSS().getSheetByName(HOMEWORK_SHEETS.ITEMS);
  const compSheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const students = getEnrolledStudents_(classId);
  const enrolledSet = {};
  students.forEach(function(s) { enrolledSet[String(s.id)] = true; });
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemId = newHomeworkItemId_(homeworkId, item.sortOrder);
    itemSheet.appendRow([
      itemId,
      homeworkId,
      item.sortOrder,
      item.title,
      item.description || '',
      (item.targetStudentIds || []).join(',')
    ]);
    if (isChambitHomeworkTitle_(item.title)) continue;
    const targetIds = (item.targetStudentIds && item.targetStudentIds.length)
      ? item.targetStudentIds.filter(function(id) { return enrolledSet[String(id)]; })
      : students.map(function(s) { return s.id; });
    targetIds.forEach(function(sid) {
      compSheet.appendRow([itemId, sid, false, '', '']);
    });
  }
}

function migrateLegacyHomework_() {
  const ss = getSS();
  if (!ss.getSheetByName(HOMEWORK_SHEETS.LOG) || !ss.getSheetByName(HOMEWORK_SHEETS.ITEMS)) return;
  const logs = ss.getSheetByName(HOMEWORK_SHEETS.LOG).getDataRange().getValues();
  const itemSheet = ss.getSheetByName(HOMEWORK_SHEETS.ITEMS);
  const items = itemSheet.getDataRange().getValues();
  const compSheet = ss.getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const comp = compSheet.getDataRange().getValues();

  const hwWithItems = {};
  for (let i = 1; i < items.length; i++) hwWithItems[String(items[i][1])] = true;

  for (let i = 1; i < logs.length; i++) {
    const homeworkId = String(logs[i][0]);
    if (hwWithItems[homeworkId]) continue;
    const itemId = newHomeworkItemId_(homeworkId, 1);
    itemSheet.appendRow([
      itemId,
      homeworkId,
      1,
      String(logs[i][3] || ''),
      String(logs[i][4] || '')
    ]);

    for (let j = comp.length - 1; j >= 1; j--) {
      if (String(comp[j][0]) !== homeworkId) continue;
      compSheet.appendRow([itemId, comp[j][1], comp[j][2], comp[j][3] || '', '']);
      compSheet.deleteRow(j + 1);
    }
    hwWithItems[homeworkId] = true;
  }
}

function isCompletedCell_(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 'Y' || val === 'Yes';
}

function getPendingHomeworkCounts_(classId) {
  return buildPendingHomeworkCountsFromCtx_(buildRequestContext_(classId), classId);
}

function postHomeworkToClassroom_(courseId, title, description) {
  if (typeof Classroom === 'undefined') {
    return { ok: false, error: 'Enable Google Classroom API: Apps Script Editor → Services → Google Classroom API' };
  }
  try {
    const body = {
      title: title,
      description: description || '',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED'
    };
    const res = Classroom.Courses.CourseWork.create(body, courseId);
    return { ok: true, workId: res.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function patchHomeworkToClassroom_(courseId, workId, title, description) {
  if (typeof Classroom === 'undefined') {
    return { ok: false, error: 'Enable Google Classroom API: Apps Script Editor → Services → Google Classroom API' };
  }
  try {
    Classroom.Courses.CourseWork.patch(
      { title: title, description: description || '' },
      courseId,
      workId,
      { updateMask: 'title,description' }
    );
    return { ok: true, workId: workId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function syncHomeworkToClassroom_(courseId, title, description, existingWorkId) {
  const priorId = String(existingWorkId || '').trim();
  if (priorId) {
    const patched = patchHomeworkToClassroom_(courseId, priorId, title, description);
    if (patched.ok) {
      return { ok: true, workId: priorId, updated: true };
    }
  }
  const created = postHomeworkToClassroom_(courseId, title, description);
  if (created.ok) {
    return { ok: true, workId: created.workId, updated: false };
  }
  return created;
}

/** List teacher's active Classroom courses (for linking). */
function listMyClassroomCourses() {
  if (typeof Classroom === 'undefined') {
    throw new Error('Enable Google Classroom API in Apps Script: Services → Google Classroom API, then redeploy.');
  }
  const courses = [];
  let pageToken = null;
  do {
    const resp = Classroom.Courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE'],
      pageSize: 100,
      pageToken: pageToken
    });
    (resp.courses || []).forEach(function(c) {
      courses.push({
        id: c.id,
        name: c.name,
        section: c.section || ''
      });
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);
  courses.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return courses;
}

function homeworkSortTime_(entry) {
  if (!entry) return 0;
  if (entry.sortTime) return entry.sortTime;
  if (entry.postedAt) {
    const d = new Date(String(entry.postedAt).replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (entry.assignedDate) {
    return new Date(entry.assignedDate + 'T12:00:00').getTime();
  }
  return 0;
}

/** Most recent published Classroom assignment (excludes selected class date). */
function getLatestClassroomHomework_(courseId, excludeDateStr) {
  if (typeof Classroom === 'undefined' || !courseId) return null;
  try {
    const tz = Session.getScriptTimeZone();
    const resp = Classroom.Courses.CourseWork.list(courseId, {
      orderBy: 'updateTime desc',
      pageSize: 40
    });
    let best = null;
    (resp.courseWork || []).forEach(function(cw) {
      if (cw.state !== 'PUBLISHED') return;
      if (cw.workType !== 'ASSIGNMENT') return;
      const created = cw.creationTime ? new Date(cw.creationTime) : null;
      if (!created || isNaN(created.getTime())) return;
      const assignedDate = Utilities.formatDate(created, tz, 'yyyy-MM-dd');
      if (excludeDateStr && assignedDate === excludeDateStr) return;
      const sortTime = created.getTime();
      if (!best || sortTime > best.sortTime) {
        best = {
          title: String(cw.title || ''),
          description: String(cw.description || ''),
          assignedDate: assignedDate,
          source: 'classroom',
          classroomWorkId: String(cw.id || ''),
          sortTime: sortTime
        };
      }
    });
    return best;
  } catch (e) {
    return null;
  }
}

function getLastHomeworkFromLog_(rows, excludeDateStr) {
  let last = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].assignedDate === excludeDateStr) continue;
    if (!last || homeworkSortTime_(rows[i]) > homeworkSortTime_(last)) {
      last = rows[i];
    }
  }
  if (last) last.source = 'app';
  return last;
}

function getClassHomeworkData(classId, dateStr) {
  ensureHomeworkSheets_();
  const ctx = buildRequestContext_(classId);
  return buildClassHomeworkFromCtx_(ctx, dateStr);
}

function linkClassToClassroom(classId, courseId, courseName) {
  ensureHomeworkSheets_();
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.MAP);
  const data = sheet.getDataRange().getValues();
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId) {
      found = i + 1;
      break;
    }
  }
  const row = [classId, courseId, courseName || ''];
  if (found > 0) {
    sheet.getRange(found, 1, 1, 3).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return 'Linked to Google Classroom: ' + (courseName || courseId);
}

/** Post/update today's homework on Classroom after Node saved the sheet (no 7-day OAuth expiry). */
function syncHomeworkClassroomForClassDate(classId, dateStr) {
  ensureHomeworkSheets_();
  const existing = findHomeworkByClassDate_(classId, dateStr);
  if (!existing) {
    return { ok: false, error: 'No homework saved for this date.' };
  }
  const map = getClassroomMap_(classId);
  if (!map || !map.courseId) {
    return { ok: true, skipped: true, message: 'No Classroom link.' };
  }
  const synced = syncHomeworkToClassroom_(
    map.courseId,
    existing.title,
    existing.description,
    existing.classroomWorkId
  );
  if (!synced.ok) {
    return { ok: false, error: synced.error };
  }
  if (synced.workId && synced.workId !== existing.classroomWorkId) {
    const row = findHomeworkRow_(existing.homeworkId);
    if (row > 0) {
      getSS().getSheetByName(HOMEWORK_SHEETS.LOG).getRange(row, 6).setValue(synced.workId);
    }
  }
  return {
    ok: true,
    workId: synced.workId,
    updated: !!synced.updated,
    message: synced.updated ? 'Updated on Google Classroom.' : 'Posted to Google Classroom.'
  };
}

function saveAndPostHomework(classId, dateStr, title, items) {
  ensureHomeworkSheets_();
  const students = getEnrolledStudents_(classId);
  const nameById = {};
  students.forEach(function(s) { nameById[String(s.id)] = s.name; });
  const normalized = normalizeHomeworkItems_(items);
  title = String(title || '').trim();
  if (!title) throw new Error('Homework title is required.');

  const description = buildClassroomDescriptionFromItems_(normalized, nameById);
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.LOG);
  const existing = findHomeworkByClassDate_(classId, dateStr);
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  let homeworkId;
  let classroomWorkId = '';
  let classroomMsg = '';

  const map = getClassroomMap_(classId);
  if (map && map.courseId) {
    const synced = syncHomeworkToClassroom_(
      map.courseId,
      title,
      description,
      existing ? existing.classroomWorkId : ''
    );
    if (synced.ok) {
      classroomWorkId = synced.workId;
      classroomMsg = synced.updated
        ? ' Updated on Google Classroom.'
        : ' Posted to Google Classroom.';
    } else {
      classroomMsg = ' (Classroom: ' + synced.error + ')';
    }
  } else {
    classroomMsg = ' (No Classroom link — saved in sheet only.)';
  }

  if (existing) {
    homeworkId = existing.homeworkId;
    const row = findHomeworkRow_(homeworkId);
    if (row > 0) {
      sheet.getRange(row, 4, 1, 4).setValues([[title, description, classroomWorkId || existing.classroomWorkId, now]]);
    }
  } else {
    homeworkId = newHomeworkId_(classId);
    sheet.appendRow([homeworkId, classId, dateStr, title, description, classroomWorkId, now]);
  }

  saveHomeworkItems_(homeworkId, classId, normalized);
  return 'Homework saved (' + normalized.length + ' items).' + classroomMsg;
}

function getStudentHomeworkStatus(classId, studentId) {
  ensureHomeworkSheets_();
  const students = getEnrolledStudents_(classId);
  const nameById = {};
  students.forEach(function(s) { nameById[String(s.id)] = s.name; });
  const logs = readHomeworkLogForClass_(classId);
  const hwById = {};
  logs.forEach(function(r) { hwById[r.homeworkId] = r; });
  const itemsByHw = readItemsMapForClass_(classId);

  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const data = sheet.getDataRange().getValues();
  const pending = [];
  const completed = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(studentId)) continue;
    const itemId = String(data[i][0]);
    let itemMeta = null;
    let hw = null;
    const hwKeys = Object.keys(itemsByHw);
    for (let k = 0; k < hwKeys.length; k++) {
      const hid = hwKeys[k];
      const list = itemsByHw[hid];
      for (let j = 0; j < list.length; j++) {
        if (list[j].itemId === itemId) {
          itemMeta = list[j];
          hw = hwById[hid];
          break;
        }
      }
      if (itemMeta) break;
    }
    if (!itemMeta || !hw) continue;
    if (isChambitHomeworkTitle_(itemMeta.title)) continue;

    const entry = {
      itemId: itemId,
      homeworkId: itemMeta.homeworkId,
      sortOrder: itemMeta.sortOrder,
      title: formatHomeworkItemDisplayTitle_(itemMeta, nameById),
      description: itemMeta.description,
      bundleTitle: hw.title,
      assignedDate: hw.assignedDate,
      completed: isCompletedCell_(data[i][2]),
      completedAt: data[i][3] ? String(data[i][3]) : '',
      fixNote: data[i][4] ? String(data[i][4]) : ''
    };
    if (entry.completed) completed.push(entry);
    else pending.push(entry);
  }

  pending.sort(function(a, b) {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });
  completed.sort(function(a, b) {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });

  return { pending: pending, completed: completed };
}

function getClassPendingHomework(classId) {
  ensureHomeworkSheets_();
  const students = getEnrolledStudents_(classId);
  const nameById = {};
  students.forEach(function(s) { nameById[String(s.id)] = s.name; });
  const logs = readHomeworkLogForClass_(classId);
  const hwById = {};
  logs.forEach(function(r) { hwById[r.homeworkId] = r; });
  const itemsByHw = readItemsMapForClass_(classId);
  const itemMetaById = {};
  Object.keys(itemsByHw).forEach(function(hid) {
    const hw = hwById[hid];
    if (!hw) return;
    itemsByHw[hid].forEach(function(it) {
      itemMetaById[it.itemId] = { itemMeta: it, hw: hw };
    });
  });

  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const data = sheet.getDataRange().getValues();
  const pendingByStudent = {};
  students.forEach(function(s) { pendingByStudent[s.id] = []; });

  for (let i = 1; i < data.length; i++) {
    if (isCompletedCell_(data[i][2])) continue;
    const studentId = String(data[i][1]);
    if (!Object.prototype.hasOwnProperty.call(pendingByStudent, studentId)) continue;
    const itemId = String(data[i][0]);
    const lookup = itemMetaById[itemId];
    if (!lookup) continue;
    if (isChambitHomeworkTitle_(lookup.itemMeta.title)) continue;
    pendingByStudent[studentId].push({
      itemId: itemId,
      homeworkId: lookup.itemMeta.homeworkId,
      sortOrder: lookup.itemMeta.sortOrder,
      title: formatHomeworkItemDisplayTitle_(lookup.itemMeta, nameById),
      description: lookup.itemMeta.description,
      bundleTitle: lookup.hw.title,
      assignedDate: lookup.hw.assignedDate,
      fixNote: data[i][4] ? String(data[i][4]) : ''
    });
  }

  return {
    students: students.map(function(s) {
      const pending = (pendingByStudent[s.id] || []).sort(function(a, b) {
        if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
        return a.sortOrder - b.sortOrder;
      });
      return {
        studentId: s.id,
        name: s.name,
        pendingCount: pending.length,
        pending: pending
      };
    })
  };
}

function setHomeworkCompletion(itemId, studentId, completed) {
  ensureHomeworkSheets_();
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(itemId) && String(data[i][1]) === String(studentId)) {
      found = i + 1;
      break;
    }
  }
  const done = !!completed;
  const at = done ? Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss') : '';
  if (found > 0) {
    if (done) {
      sheet.getRange(found, 3, 1, 3).setValues([[done, at, '']]);
    } else {
      sheet.getRange(found, 3, 1, 2).setValues([[done, at]]);
    }
  } else {
    sheet.appendRow([itemId, studentId, done, at, '']);
  }
  return done ? 'Marked complete.' : 'Marked pending.';
}

function setHomeworkFixNote(itemId, studentId, fixNote) {
  ensureHomeworkSheets_();
  fixNote = String(fixNote || '').trim();
  const sheet = getSS().getSheetByName(HOMEWORK_SHEETS.COMPLETION);
  const data = sheet.getDataRange().getValues();
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(itemId) && String(data[i][1]) === String(studentId)) {
      found = i + 1;
      break;
    }
  }
  if (found > 0) {
    sheet.getRange(found, 5).setValue(fixNote);
  } else {
    sheet.appendRow([itemId, studentId, false, '', fixNote]);
  }
  return fixNote ? 'Fix note saved.' : 'Fix note cleared.';
}

/** Roulette popup: enrolled students for a class (id + display name). */
function getRouletteClassStudents(classId) {
  const ss = getSS();
  const sheet = ss.getSheetByName('Student_List');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const students = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === classId && data[i][3] === 'Enrolled') {
      students.push({
        id: String(data[i][0]),
        name: String(data[i][1] || '').trim()
      });
    }
  }
  students.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return students;
}

/** Withdraw a student: hide from class UI, archive row, keep all other data. */
function withdrawStudent(classId, studentId) {
  classId = String(classId || '').trim();
  studentId = String(studentId || '').trim();
  if (!classId || !studentId) throw new Error('classId and studentId are required.');

  const ss = getSS();
  const listSheet = ss.getSheetByName('Student_List');
  if (!listSheet) throw new Error('Student_List sheet not found.');

  const data = listSheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== studentId) continue;
    if (String(data[i][2]) !== classId) continue;
    rowIndex = i;
    break;
  }
  if (rowIndex < 0) throw new Error('Student not found in this class.');

  const row = data[rowIndex];
  const status = String(row[3] || '').trim();
  if (status === 'Withdrawn') throw new Error('Student is already withdrawn.');
  if (status !== 'Enrolled') throw new Error('Only enrolled students can be withdrawn.');

  const name = String(row[1] || '').trim();
  const loginId = String(row[4] || '').trim();
  const loginPassword = String(row[5] || '').trim();
  const withdrawnAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  const withdrawalId = 'WDR_' + classId + '_' + studentId + '_' + Date.now();

  listSheet.getRange(rowIndex + 1, 4).setValue('Withdrawn');

  let archiveSheet = ss.getSheetByName('Student_Withdrawn');
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('Student_Withdrawn');
    archiveSheet.appendRow([
      'WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'
    ]);
  } else if (archiveSheet.getLastRow() === 0) {
    archiveSheet.appendRow([
      'WithdrawalID', 'StudentID', 'Name', 'ClassID', 'LoginID', 'LoginPassword', 'PreviousStatus', 'WithdrawnAt'
    ]);
  }
  archiveSheet.appendRow([
    withdrawalId, studentId, name, classId, loginId, loginPassword, status, withdrawnAt
  ]);

  return {
    withdrawalId: withdrawalId,
    studentId: studentId,
    name: name,
    classId: classId,
    withdrawnAt: withdrawnAt,
    message: name + ' has been withdrawn from the class.'
  };
}

function generateNextStudentId_(classId) {
  classId = String(classId);
  let maxNum = 0;
  const sheet = getSS().getSheetByName('Student_List');
  if (!sheet) throw new Error('Student_List sheet not found.');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    const m = String(data[i][0]).match(/^S(\d+)$/i);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return 'S' + String(maxNum + 1).padStart(3, '0');
}

function addEnrolledStudent(classId, name, loginId, loginPassword) {
  classId = String(classId || '').trim();
  name = String(name || '').trim();
  loginId = String(loginId || '').trim();
  loginPassword = String(loginPassword || '').trim();
  if (!classId || !name) throw new Error('Class and student name are required.');

  const sheet = getSS().getSheetByName('Student_List');
  if (!sheet) throw new Error('Student_List sheet not found.');
  const data = sheet.getDataRange().getValues();
  const header = data[0] || [];
  if (String(header[4] || '').trim() !== 'LoginID') {
    sheet.getRange(1, 5).setValue('LoginID');
  }
  if (String(header[5] || '').trim() !== 'LoginPassword') {
    sheet.getRange(1, 6).setValue('LoginPassword');
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    if (String(data[i][1] || '').trim().toLowerCase() === name.toLowerCase() &&
        String(data[i][3] || '').trim() === 'Enrolled') {
      throw new Error('A student with this name is already enrolled.');
    }
  }

  const studentId = generateNextStudentId_(classId);
  sheet.appendRow([studentId, name, classId, 'Enrolled', loginId, loginPassword]);
  return {
    studentId: studentId,
    name: name,
    classId: classId,
    message: name + ' (' + studentId + ') added to the class.'
  };
}