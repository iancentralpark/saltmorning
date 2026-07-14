const {
  RULES_SHEET,
  LIBRARY_SHEET,
  ANNOUNCE_SHEET,
  EVENTS_SHEET,
  VIDEO_SHEET,
  CLASS_LIST_SHEET,
  STUDENT_LIST_SHEET,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRow } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { formatSheetDate, formatDateTimeNow } = require('./dateUtils');
const { parseYoutubeVideoId, youtubeEmbedUrl, GLOBAL_VIDEO_CLASS_ID, resolveSharedClassVideoFromRows } = require('./youtube');
const { buildClassStudentDirectory } = require('./studentListService');
const { getUpcomingMakeupEvents } = require('./makeupService');

function parseRulesText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

async function getEnrolledStudents(classId) {
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  const idStr = String(classId);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === idStr && String(data[i][3] || '').trim() === 'Enrolled') {
      out.push({ id: String(data[i][0]), name: String(data[i][1] || '') });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function readPendingBooksForClass(classId) {
  const data = await getSheetRows(LIBRARY_SHEET);
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

async function readClassEvents(classId) {
  const data = await getSheetRows(EVENTS_SHEET);
  const idStr = String(classId);
  const events = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== idStr) continue;
    events.push({
      eventId: String(data[i][0]),
      eventDate: formatSheetDate(data[i][2]),
      description: String(data[i][3] || '')
    });
  }
  events.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    return a.description.localeCompare(b.description);
  });
  return events;
}

async function getClassRules(classId) {
  const data = await getSheetRows(RULES_SHEET);
  const idStr = String(classId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    let rulesText = data[i][1];
    if (rulesText == null || rulesText === '') rulesText = '';
    else rulesText = String(rulesText);
    const rules = parseRulesText(rulesText);
    return { rules, rulesText };
  }
  return { rules: [], rulesText: '' };
}

async function saveClassRules(classId, rulesText) {
  const data = await getSheetRows(RULES_SHEET);
  const now = formatDateTimeNow(TIMEZONE);
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
    await updateRange(RULES_SHEET, `B${found}:C${found}`, [[rulesText, now]]);
  } else {
    await appendRows(RULES_SHEET, [[classId, rulesText, now]]);
  }
  cacheDeletePrefix('sidebar_v1_');
  const rules = parseRulesText(rulesText);
  return { message: 'Class rules saved.', rules, rulesText };
}

async function getClassAnnouncement(classId) {
  const data = await getSheetRows(ANNOUNCE_SHEET);
  const idStr = String(classId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    let text = data[i][1];
    if (text == null) text = '';
    else text = String(text);
    return { text };
  }
  return { text: '' };
}

async function saveClassAnnouncement(classId, text) {
  const data = await getSheetRows(ANNOUNCE_SHEET);
  const now = formatDateTimeNow(TIMEZONE);
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
    await updateRange(ANNOUNCE_SHEET, `B${found}:C${found}`, [[text, now]]);
  } else {
    await appendRows(ANNOUNCE_SHEET, [[classId, text, now]]);
  }
  cacheDeletePrefix('sidebar_v1_');
  return { message: 'Announcement saved.', text };
}

async function getClassUpcomingEvents(classId) {
  const today = formatSheetDate(new Date());
  const regular = (await readClassEvents(classId))
    .filter(e => e.eventDate >= today)
    .map(e => Object.assign({ type: 'event' }, e));
  const makeup = await getUpcomingMakeupEvents(classId);
  const events = regular.concat(makeup);
  events.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    const aMakeup = a.type === 'makeup' ? 0 : 1;
    const bMakeup = b.type === 'makeup' ? 0 : 1;
    if (aMakeup !== bMakeup) return aMakeup - bMakeup;
    return String(a.description).localeCompare(String(b.description));
  });
  return { events };
}

async function getClassEventsEditData(classId) {
  const today = formatSheetDate(new Date());
  const regular = (await readClassEvents(classId))
    .filter(e => e.eventDate >= today)
    .map(e => Object.assign({ type: 'event' }, e));
  const makeup = await getUpcomingMakeupEvents(classId);
  const events = regular.concat(makeup);
  events.sort((a, b) => {
    if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? -1 : 1;
    return String(a.description).localeCompare(String(b.description));
  });
  return { events };
}

async function addClassEvent(classId, dateStr, description) {
  dateStr = formatSheetDate(dateStr);
  description = String(description || '').trim();
  if (!dateStr) throw new Error('Event date is required.');
  if (!description) throw new Error('Event description is required.');
  const now = formatDateTimeNow(TIMEZONE);
  const eventId = 'EV_' + classId + '_' + Date.now();
  await appendRows(EVENTS_SHEET, [[eventId, classId, dateStr, description, now]]);
  cacheDeletePrefix('sidebar_v1_');
  return {
    message: 'Event added.',
    event: { eventId, eventDate: dateStr, description }
  };
}

async function deleteClassEvent(eventId) {
  const data = await getSheetRows(EVENTS_SHEET);
  const idStr = String(eventId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === idStr) {
      const classId = data[i][1];
      await deleteRow(EVENTS_SHEET, i + 1);
      cacheDeletePrefix('sidebar_v1_');
      return { message: 'Event removed.', classId };
    }
  }
  throw new Error('Event not found.');
}

async function getClassVideo(classId) {
  const data = await getSheetRows(VIDEO_SHEET);
  return resolveSharedClassVideoFromRows(data, classId);
}

async function saveClassVideo(classId, videoUrl) {
  const videoId = parseYoutubeVideoId(videoUrl);
  const normalized = String(videoUrl || '').trim() ||
    ('https://www.youtube.com/watch?v=' + videoId);
  const now = formatDateTimeNow(TIMEZONE);

  const classData = await getSheetRows(CLASS_LIST_SHEET);
  const classIds = new Set([GLOBAL_VIDEO_CLASS_ID]);
  for (let i = 1; i < classData.length; i++) {
    if (classData[i][0]) classIds.add(String(classData[i][0]));
  }

  const data = await getSheetRows(VIDEO_SHEET, { skipCache: true });
  const rowByClass = {};
  for (let i = 1; i < data.length; i++) {
    rowByClass[String(data[i][0])] = i + 1;
  }

  const appends = [];
  for (const cid of classIds) {
    const rowNum = rowByClass[cid];
    if (rowNum) {
      await updateRange(VIDEO_SHEET, `B${rowNum}:C${rowNum}`, [[normalized, now]]);
    } else {
      appends.push([cid, normalized, now]);
    }
  }
  for (let i = 1; i < data.length; i++) {
    const cid = String(data[i][0]);
    if (classIds.has(cid)) continue;
    await updateRange(VIDEO_SHEET, `B${i + 1}:C${i + 1}`, [[normalized, now]]);
  }
  if (appends.length) {
    await appendRows(VIDEO_SHEET, appends);
  }

  cacheDeletePrefix('sidebar_v1_');
  return {
    message: 'Video saved for all classes.',
    videoUrl: normalized,
    videoId,
    embedUrl: youtubeEmbedUrl(videoId)
  };
}

async function getClassBooksToReturn(classId) {
  const { nameMap, statusMap } = await buildClassStudentDirectory(classId);
  const byStudent = await readPendingBooksForClass(classId);
  const result = Object.keys(byStudent).map(sid => ({
    studentId: sid,
    studentName: nameMap[sid] || sid,
    withdrawn: statusMap[sid] === 'Withdrawn',
    books: byStudent[sid]
  }));
  result.sort((a, b) => a.studentName.localeCompare(b.studentName));
  return { students: result };
}

async function getLibraryEditData(classId) {
  const enrolled = await getEnrolledStudents(classId);
  const { nameMap, statusMap } = await buildClassStudentDirectory(classId);
  const byStudent = await readPendingBooksForClass(classId);
  const map = {};
  enrolled.forEach(s => {
    map[s.id] = {
      id: s.id,
      name: s.name,
      withdrawn: false,
      books: byStudent[s.id] || []
    };
  });
  Object.keys(byStudent).forEach(sid => {
    if (map[sid]) {
      map[sid].books = byStudent[sid];
      return;
    }
    map[sid] = {
      id: sid,
      name: nameMap[sid] || sid,
      withdrawn: statusMap[sid] === 'Withdrawn',
      books: byStudent[sid]
    };
  });
  const students = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  return { students };
}

async function addLibraryBooks(classId, studentId, titles) {
  if (!classId || !studentId) throw new Error('Class and student are required.');
  const now = formatDateTimeNow(TIMEZONE);
  const added = [];
  for (const title of titles || []) {
    const t = String(title || '').trim();
    if (!t) continue;
    const bookId = 'BK_' + classId + '_' + studentId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await appendRows(LIBRARY_SHEET, [[bookId, classId, studentId, t, 'Pending', now, '']]);
    added.push({ bookId, title: t });
  }
  if (!added.length) throw new Error('Enter at least one book title.');
  cacheDeletePrefix('sidebar_v1_');
  return { message: 'Books added.', books: added };
}

async function markLibraryBookReturned(bookId) {
  const data = await getSheetRows(LIBRARY_SHEET);
  const now = formatDateTimeNow(TIMEZONE);
  const idStr = String(bookId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    await updateRange(LIBRARY_SHEET, `E${i + 1}:G${i + 1}`, [['Returned', data[i][5], now]]);
    cacheDeletePrefix('sidebar_v1_');
    return { message: 'Book marked returned.', bookId: idStr };
  }
  throw new Error('Book not found.');
}

module.exports = {
  getClassRules,
  saveClassRules,
  getClassAnnouncement,
  saveClassAnnouncement,
  getClassUpcomingEvents,
  getClassEventsEditData,
  addClassEvent,
  deleteClassEvent,
  getClassVideo,
  saveClassVideo,
  getClassBooksToReturn,
  getLibraryEditData,
  addLibraryBooks,
  markLibraryBookReturned,
  readClassEvents
};
