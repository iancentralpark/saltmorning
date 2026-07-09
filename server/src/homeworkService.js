const { HOMEWORK_SHEETS, STUDENT_LIST_SHEET, TIMEZONE } = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRows, buildRequestContext, invalidateSheetRowsCache } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
const { parseHomeworkDate, formatDateTimeNow, formatDateInTz } = require('./dateUtils');
const { isClassroomConfigured, getClassroomApi } = require('./classroomAuth');
const {
  isManualPendingId,
  readManualPendingForClass,
  completeManualPending,
  setManualPendingFixNote,
  getManualPendingCountsByClass
} = require('./manualHomeworkService');

const classroomHomeworkCache = new Map();
const CLASSROOM_HW_CACHE_MS = 5 * 60 * 1000;

function invalidateClassroomHomeworkCache(courseId) {
  if (!courseId) {
    classroomHomeworkCache.clear();
    return;
  }
  const prefix = String(courseId) + '|';
  for (const key of classroomHomeworkCache.keys()) {
    if (key.startsWith(prefix)) classroomHomeworkCache.delete(key);
  }
}

function isCompletedCell(val) {
  return val === true || val === 'TRUE' || val === 'true' || val === 'Y' || val === 'Yes';
}

function homeworkSortTime(entry) {
  if (!entry) return 0;
  if (entry.postedAt) {
    const d = new Date(String(entry.postedAt).replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (entry.assignedDate) {
    return new Date(entry.assignedDate + 'T12:00:00').getTime();
  }
  return 0;
}

function getLastHomeworkFromLog(rows, excludeDateStr) {
  let last = null;
  for (const row of rows) {
    if (row.assignedDate === excludeDateStr) continue;
    if (!last || homeworkSortTime(row) > homeworkSortTime(last)) {
      last = row;
    }
  }
  if (last) last.source = 'app';
  return last;
}

const CHAMBIT_HOMEWORK_TITLE = '1 Chambit';

function homeworkStudentFirstName(fullName) {
  const n = String(fullName || '').trim();
  if (!n) return '';
  const parts = n.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (/^[A-Za-z][A-Za-z'-]*$/.test(parts[i])) return parts[i];
  }
  return parts[0];
}

function isChambitHomeworkTitle(title) {
  return String(title || '').trim() === CHAMBIT_HOMEWORK_TITLE;
}

function formatHomeworkItemDisplayTitle(item, nameById) {
  const base = String((item && item.title) || '').trim();
  const ids = (item && item.targetStudentIds) || [];
  if (!ids.length) return base;
  const names = ids
    .map(id => homeworkStudentFirstName(nameById[String(id)]))
    .filter(Boolean);
  if (!names.length) return base;
  return names.join(', ') + ': ' + base;
}

function normalizeHomeworkItems(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('Add at least one homework item.');
  }
  const items = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] || {};
    const title = String(item.title || item || '').trim();
    const description = String(item.description || '').trim();
    if (!title) continue;
    let targetStudentIds = [];
    const targetType = String(item.targetType || 'all').toLowerCase();
    if (targetType === 'individual') {
      targetStudentIds = (Array.isArray(item.studentIds) ? item.studentIds : [])
        .map(id => String(id).trim())
        .filter(Boolean);
      if (!targetStudentIds.length) {
        throw new Error('Pick at least one student for homework item ' + (items.length + 1) + '.');
      }
    }
    items.push({
      title,
      description,
      sortOrder: items.length + 1,
      targetStudentIds
    });
  }
  if (!items.length) throw new Error('Each homework item needs a title.');
  const hasChambit = items.some(it => isChambitHomeworkTitle(it.title));
  if (!hasChambit) {
    items.push({
      title: CHAMBIT_HOMEWORK_TITLE,
      description: '',
      sortOrder: items.length + 1,
      targetStudentIds: []
    });
  }
  return items;
}

function buildClassroomDescriptionFromItems(items, nameById) {
  nameById = nameById || {};
  return items.map((item, i) => {
    const n = i + 1;
    const title = formatHomeworkItemDisplayTitle(item, nameById);
    const desc = String(item.description || '').trim();
    if (!title) return '';
    return desc ? `${n}. ${title}\n   ${desc}` : `${n}. ${title}`;
  }).filter(Boolean).join('\n\n');
}

function formatHomeworkForClassLog(items, nameById) {
  nameById = nameById || {};
  return (items || []).map(item => {
    const title = formatHomeworkItemDisplayTitle(item, nameById);
    const desc = String(item.description || '').trim();
    if (!title) return '';
    if (desc && !title.includes(desc)) return title + ' ' + desc;
    return title;
  }).filter(Boolean).join('\n');
}

/** Parse Classroom assignment description back into display items (keeps "Name: task" prefixes). */
function parseClassroomDescriptionToItems(description) {
  const text = String(description || '').trim();
  if (!text) return [];

  let blocks = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  if (blocks.length === 1 && /^\d+\.\s/m.test(text)) {
    blocks = text.split(/\n(?=\d+\.\s)/).map(b => b.trim()).filter(Boolean);
  }

  const items = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const headMatch = lines[0].match(/^\d+\.\s*(.+)$/);
    if (!headMatch) continue;
    const title = headMatch[1].trim();
    const descParts = [];
    for (let i = 1; i < lines.length; i++) {
      descParts.push(lines[i].replace(/^\s{2,}/, '').trim());
    }
    const hasNamePrefix = (() => {
      const colon = title.indexOf(':');
      if (colon <= 0) return false;
      const prefix = title.slice(0, colon).trim();
      return /^[A-Za-z][A-Za-z'-]*(?:\s*,\s*[A-Za-z][A-Za-z'-]*)*$/.test(prefix);
    })();
    items.push({
      title,
      description: descParts.join(' ').trim(),
      targetStudentIds: [],
      targetType: hasNamePrefix ? 'individual' : 'all',
      displayTitle: title
    });
  }
  return items;
}

function enrichHomeworkItemsForDisplay(items, nameById) {
  return (items || []).map(it => ({
    ...it,
    displayTitle: it.displayTitle || formatHomeworkItemDisplayTitle(it, nameById)
  }));
}

function newItemId(homeworkId, sortOrder) {
  return 'HWI_' + homeworkId + '_' + sortOrder;
}

let legacyHomeworkMigrated = false;

async function ensureHomeworkItemsSheet() {
  let data;
  try {
    data = await getSheetRows(HOMEWORK_SHEETS.ITEMS);
  } catch (e) {
    const { google } = require('googleapis');
    const { SPREADSHEET_ID } = require('./config');
    const { getServiceAccountAuthOptions } = require('./googleCredentials');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: HOMEWORK_SHEETS.ITEMS } } }]
      }
    });
    await appendRows(HOMEWORK_SHEETS.ITEMS, [[
      'ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'ItemID') {
    if (!data.length) {
      await appendRows(HOMEWORK_SHEETS.ITEMS, [[
        'ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description'
      ]]);
    }
  }
}

async function ensureCompletionFixNoteColumn() {
  let data;
  try {
    data = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);
  } catch (e) {
    return;
  }
  if (!data.length) {
    await appendRows(HOMEWORK_SHEETS.COMPLETION, [[
      'ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'
    ]]);
    return;
  }
  const header = (data[0] || []).map(c => String(c || '').trim());
  if (header.length >= 5 && header[4] === 'FixNote') return;
  if (header[0] !== 'ItemID') return;
  await updateRange(HOMEWORK_SHEETS.COMPLETION, 'E1', [['FixNote']]);
}

async function ensureHomeworkTargetStudentColumn() {
  let data;
  try {
    data = await getSheetRows(HOMEWORK_SHEETS.ITEMS);
  } catch (e) {
    return;
  }
  if (!data.length) return;
  const header = (data[0] || []).map(c => String(c || '').trim());
  if (header.length >= 6 && header[5] === 'TargetStudentIDs') return;
  if (header[0] !== 'ItemID') return;
  await updateRange(HOMEWORK_SHEETS.ITEMS, 'F1', [['TargetStudentIDs']]);
}

async function migrateLegacyHomeworkOnce() {
  if (legacyHomeworkMigrated) return;
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (!isSupabaseEnabled()) {
    await ensureHomeworkItemsSheet();
    await ensureCompletionFixNoteColumn();
    await ensureHomeworkTargetStudentColumn();
    await migrateLegacyHomework();
  }
  legacyHomeworkMigrated = true;
}

async function getEnrolledStudents(classId, ctx) {
  const idStr = String(classId);
  let data;
  if (ctx && typeof ctx.sheetRows === 'function') {
    data = await ctx.sheetRows(STUDENT_LIST_SHEET);
  } else {
    data = await getSheetRows(STUDENT_LIST_SHEET);
  }
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === idStr && data[i][3] === 'Enrolled') {
      out.push({ id: String(data[i][0]), name: String(data[i][1] || '') });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function getClassroomMap(classId) {
  const data = await getSheetRows(HOMEWORK_SHEETS.MAP);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId) {
      return {
        courseId: String(data[i][1] || ''),
        courseName: String(data[i][2] || '')
      };
    }
  }
  return null;
}

async function readHomeworkLogForClass(classId) {
  const data = await getSheetRows(HOMEWORK_SHEETS.LOG);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] !== classId) continue;
    rows.push({
      homeworkId: String(data[i][0]),
      classId: data[i][1],
      assignedDate: parseHomeworkDate(data[i][2]),
      title: String(data[i][3] || ''),
      description: String(data[i][4] || ''),
      classroomWorkId: String(data[i][5] || ''),
      postedAt: data[i][6] ? String(data[i][6]) : ''
    });
  }
  rows.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.homeworkId < b.homeworkId ? 1 : -1;
  });
  return rows;
}

function parseItemsFromRows(itemRows, validHomeworkIds) {
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
      targetStudentIds: String(itemRows[i][5] || '').split(',')
        .map(s => s.trim()).filter(Boolean)
    });
  }
  Object.keys(byHw).forEach(hid => {
    byHw[hid].sort((a, b) => a.sortOrder - b.sortOrder);
  });
  return byHw;
}

async function readItemsMapForClass(classId) {
  const logs = await readHomeworkLogForClass(classId);
  const hwIds = {};
  logs.forEach(r => { hwIds[r.homeworkId] = true; });
  const itemRows = await getSheetRows(HOMEWORK_SHEETS.ITEMS);
  return parseItemsFromRows(itemRows, hwIds);
}

async function readItemsMapFromCtx(ctx, classId) {
  const logRows = await ctx.sheetRows(HOMEWORK_SHEETS.LOG);
  const hwIds = {};
  for (let i = 1; i < logRows.length; i++) {
    if (logRows[i][1] !== classId) continue;
    hwIds[String(logRows[i][0])] = true;
  }
  const itemRows = await ctx.sheetRows(HOMEWORK_SHEETS.ITEMS);
  return parseItemsFromRows(itemRows, hwIds);
}

async function migrateLegacyHomework() {
  const logs = await getSheetRows(HOMEWORK_SHEETS.LOG);
  const items = await getSheetRows(HOMEWORK_SHEETS.ITEMS);
  const comp = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);

  const hwWithItems = {};
  for (let i = 1; i < items.length; i++) {
    hwWithItems[String(items[i][1])] = true;
  }

  const itemAppends = [];
  const compAppends = [];
  const compDeletes = [];

  for (let i = 1; i < logs.length; i++) {
    const homeworkId = String(logs[i][0]);
    if (hwWithItems[homeworkId]) continue;

    const itemId = newItemId(homeworkId, 1);
    itemAppends.push([
      itemId,
      homeworkId,
      1,
      String(logs[i][3] || ''),
      String(logs[i][4] || '')
    ]);

    for (let j = 1; j < comp.length; j++) {
      if (String(comp[j][0]) !== homeworkId) continue;
      compAppends.push([itemId, comp[j][1], comp[j][2], comp[j][3] || '', '']);
      compDeletes.push(j + 1);
    }
    hwWithItems[homeworkId] = true;
  }

  if (itemAppends.length) await appendRows(HOMEWORK_SHEETS.ITEMS, itemAppends);
  if (compAppends.length) await appendRows(HOMEWORK_SHEETS.COMPLETION, compAppends);
  if (compDeletes.length) await deleteRows(HOMEWORK_SHEETS.COMPLETION, compDeletes);
}

async function deleteItemsForHomework(homeworkId) {
  const items = await getSheetRows(HOMEWORK_SHEETS.ITEMS);
  const itemIds = [];
  const itemRowDeletes = [];
  for (let i = 1; i < items.length; i++) {
    if (String(items[i][1]) !== homeworkId) continue;
    itemIds.push(String(items[i][0]));
    itemRowDeletes.push(i + 1);
  }
  if (itemRowDeletes.length) await deleteRows(HOMEWORK_SHEETS.ITEMS, itemRowDeletes);

  const comp = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);
  const compDeletes = [];
  for (let i = 1; i < comp.length; i++) {
    const key = String(comp[i][0]);
    if (itemIds.includes(key) || key === homeworkId) compDeletes.push(i + 1);
  }
  if (compDeletes.length) await deleteRows(HOMEWORK_SHEETS.COMPLETION, compDeletes);
}

async function saveHomeworkItems(homeworkId, classId, items) {
  await deleteItemsForHomework(homeworkId);
  const rows = items.map(item => [
    newItemId(homeworkId, item.sortOrder),
    homeworkId,
    item.sortOrder,
    item.title,
    item.description || '',
    (item.targetStudentIds || []).join(',')
  ]);
  await appendRows(HOMEWORK_SHEETS.ITEMS, rows);

  const students = await getEnrolledStudents(classId);
  const enrolledIds = new Set(students.map(s => String(s.id)));
  const compAppends = [];
  for (const row of rows) {
    if (isChambitHomeworkTitle(row[3])) continue;
    const itemId = row[0];
    const targetRaw = String(row[5] || '').trim();
    const targetIds = targetRaw
      ? targetRaw.split(',').map(s => s.trim()).filter(id => enrolledIds.has(id))
      : students.map(s => s.id);
    for (const sid of targetIds) {
      compAppends.push([itemId, sid, false, '', '']);
    }
  }
  if (compAppends.length) await appendRows(HOMEWORK_SHEETS.COMPLETION, compAppends);
}

async function findHomeworkRow(homeworkId) {
  const data = await getSheetRows(HOMEWORK_SHEETS.LOG);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === homeworkId) return i + 1;
  }
  return -1;
}

async function findHomeworkByClassDate(classId, dateStr) {
  const rows = await readHomeworkLogForClass(classId);
  return rows.find(r => r.assignedDate === dateStr) || null;
}

async function postHomeworkToClassroom(courseId, title, description) {
  if (!isClassroomConfigured()) {
    return { ok: false, error: 'Classroom OAuth not configured on Node server.' };
  }
  try {
    const classroom = await getClassroomApi();
    const res = await classroom.courses.courseWork.create({
      courseId,
      requestBody: {
        title,
        description: description || '',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED'
      }
    });
    return { ok: true, workId: res.data.id };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function patchHomeworkToClassroom(courseId, workId, title, description) {
  if (!isClassroomConfigured()) {
    return { ok: false, error: 'Classroom OAuth not configured on Node server.' };
  }
  try {
    const classroom = await getClassroomApi();
    await classroom.courses.courseWork.patch({
      courseId,
      id: workId,
      updateMask: 'title,description',
      requestBody: {
        title,
        description: description || ''
      }
    });
    return { ok: true, workId };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function syncHomeworkToClassroom(courseId, title, description, existingWorkId) {
  const priorId = String(existingWorkId || '').trim();
  if (priorId) {
    const patched = await patchHomeworkToClassroom(courseId, priorId, title, description);
    if (patched.ok) {
      return { ok: true, workId: priorId, updated: true };
    }
  }
  const created = await postHomeworkToClassroom(courseId, title, description);
  if (created.ok) {
    return { ok: true, workId: created.workId, updated: false };
  }
  return created;
}

async function getLatestClassroomHomework(courseId, excludeDateStr) {
  if (!courseId || !isClassroomConfigured()) return null;

  const cacheKey = String(courseId) + '|' + String(excludeDateStr || '');
  const cached = classroomHomeworkCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const classroom = await getClassroomApi();
    const resp = await classroom.courses.courseWork.list({
      courseId,
      orderBy: 'updateTime desc',
      pageSize: 40
    });
    let best = null;
    for (const cw of resp.data.courseWork || []) {
      if (cw.state !== 'PUBLISHED' || cw.workType !== 'ASSIGNMENT') continue;
      const created = cw.creationTime ? new Date(cw.creationTime) : null;
      if (!created || isNaN(created.getTime())) continue;
      const assignedDate = formatDateInTz(created, TIMEZONE);
      if (excludeDateStr && assignedDate === excludeDateStr) continue;
      const sortTime = created.getTime();
      if (!best || sortTime > best.sortTime) {
        const description = String(cw.description || '');
        best = {
          title: String(cw.title || ''),
          description,
          assignedDate,
          source: 'classroom',
          classroomWorkId: String(cw.id || ''),
          sortTime,
          items: parseClassroomDescriptionToItems(description)
        };
      }
    }
    classroomHomeworkCache.set(cacheKey, { data: best, expires: Date.now() + CLASSROOM_HW_CACHE_MS });
    return best;
  } catch (e) {
    return null;
  }
}

async function buildClassHomeworkFromCtx(ctx, dateStr) {
  await migrateLegacyHomeworkOnce();
  const classId = ctx.classId;
  const mapRows = await ctx.sheetRows(HOMEWORK_SHEETS.MAP);
  let map = null;
  for (let i = 1; i < mapRows.length; i++) {
    if (mapRows[i][0] === classId) {
      map = {
        courseId: String(mapRows[i][1] || ''),
        courseName: String(mapRows[i][2] || '')
      };
      break;
    }
  }

  const logRows = await ctx.sheetRows(HOMEWORK_SHEETS.LOG);
  const rows = [];
  for (let i = 1; i < logRows.length; i++) {
    if (logRows[i][1] !== classId) continue;
    rows.push({
      homeworkId: String(logRows[i][0]),
      classId: logRows[i][1],
      assignedDate: parseHomeworkDate(logRows[i][2]),
      title: String(logRows[i][3] || ''),
      description: String(logRows[i][4] || ''),
      classroomWorkId: String(logRows[i][5] || ''),
      postedAt: logRows[i][6] ? String(logRows[i][6]) : ''
    });
  }
  rows.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.homeworkId < b.homeworkId ? 1 : -1;
  });

  const itemsByHw = await readItemsMapFromCtx(ctx, classId);
  const todayHw = rows.find(r => r.assignedDate === dateStr) || null;
  const todayItems = todayHw ? (itemsByHw[todayHw.homeworkId] || []).map(it => ({
    title: it.title,
    description: it.description,
    targetType: (it.targetStudentIds && it.targetStudentIds.length) ? 'individual' : 'all',
    studentIds: it.targetStudentIds || [],
    isChambit: isChambitHomeworkTitle(it.title)
  })) : [];

  const lastFromLog = getLastHomeworkFromLog(rows, dateStr);
  if (lastFromLog && itemsByHw[lastFromLog.homeworkId]) {
    lastFromLog.items = itemsByHw[lastFromLog.homeworkId];
  }

  const lastFromClassroom = (map && map.courseId)
    ? await getLatestClassroomHomework(map.courseId, dateStr)
    : null;

  let last = null;
  if (lastFromLog && lastFromClassroom) {
    last = homeworkSortTime(lastFromLog) >= homeworkSortTime(lastFromClassroom)
      ? lastFromLog
      : lastFromClassroom;
  } else {
    last = lastFromLog || lastFromClassroom;
  }
  if (last && last.sortTime) delete last.sortTime;

  if (last) {
    const students = await getEnrolledStudents(classId, ctx);
    const nameById = {};
    students.forEach(s => { nameById[String(s.id)] = s.name; });
    if (last.items && last.items.length) {
      last.items = enrichHomeworkItemsForDisplay(last.items, nameById);
    } else if (last.description) {
      last.items = parseClassroomDescriptionToItems(last.description);
    }
  }

  return {
    classroomLinked: !!(map && map.courseId),
    courseName: map ? map.courseName : '',
    courseId: map ? map.courseId : '',
    lastHomework: last,
    todayItems,
    todayHomeworkId: todayHw ? todayHw.homeworkId : ''
  };
}

async function buildPendingHomeworkCountsFromCtx(ctx, classId) {
  await migrateLegacyHomeworkOnce();
  const logRows = await ctx.sheetRows(HOMEWORK_SHEETS.LOG);
  const hwIds = {};
  for (let i = 1; i < logRows.length; i++) {
    if (logRows[i][1] !== classId) continue;
    hwIds[String(logRows[i][0])] = true;
  }

  const counts = {};
  if (Object.keys(hwIds).length) {
    const itemRows = await ctx.sheetRows(HOMEWORK_SHEETS.ITEMS);
    const validKeys = {};
    for (let i = 1; i < itemRows.length; i++) {
      const hid = String(itemRows[i][1]);
      if (!hwIds[hid]) continue;
      if (isChambitHomeworkTitle(itemRows[i][3])) continue;
      validKeys[String(itemRows[i][0])] = true;
    }

    const compRows = await ctx.sheetRows(HOMEWORK_SHEETS.COMPLETION);
    for (let i = 1; i < compRows.length; i++) {
      const key = String(compRows[i][0]);
      if (!validKeys[key]) continue;
      if (isCompletedCell(compRows[i][2])) continue;
      const sid = String(compRows[i][1]);
      counts[sid] = (counts[sid] || 0) + 1;
    }
  }

  const manualCounts = await getManualPendingCountsByClass(classId, ctx);
  Object.keys(manualCounts).forEach(sid => {
    counts[sid] = (counts[sid] || 0) + manualCounts[sid];
  });
  return counts;
}

async function listMyClassroomCourses() {
  if (!isClassroomConfigured()) {
    throw new Error(
      'Classroom OAuth not configured. Run server/scripts/oauth-setup.js and set GOOGLE_OAUTH_* env vars.'
    );
  }
  const classroom = await getClassroomApi();
  const courses = [];
  let pageToken = null;
  do {
    const resp = await classroom.courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE'],
      pageSize: 100,
      pageToken: pageToken || undefined
    });
    for (const c of resp.data.courses || []) {
      courses.push({
        id: c.id,
        name: c.name,
        section: c.section || ''
      });
    }
    pageToken = resp.data.nextPageToken;
  } while (pageToken);
  courses.sort((a, b) => a.name.localeCompare(b.name));
  return courses;
}

async function linkClassToClassroom(classId, courseId, courseName) {
  const data = await getSheetRows(HOMEWORK_SHEETS.MAP);
  let found = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === classId) {
      found = i + 1;
      break;
    }
  }
  const row = [classId, courseId, courseName || ''];
  if (found > 0) {
    await updateRange(HOMEWORK_SHEETS.MAP, `A${found}:C${found}`, [row]);
  } else {
    await appendRows(HOMEWORK_SHEETS.MAP, [row]);
  }
  cacheDeletePrefix('sidebar_v1_');
  return { message: 'Linked to Google Classroom: ' + (courseName || courseId) };
}

async function saveAndPostHomework(classId, dateStr, title, items, options) {
  options = options || {};
  await migrateLegacyHomeworkOnce();
  const students = await getEnrolledStudents(classId);
  const nameById = {};
  students.forEach(s => { nameById[String(s.id)] = s.name; });
  const normalized = normalizeHomeworkItems(items);
  title = String(title || '').trim();
  if (!title) throw new Error('Homework title is required.');

  const description = buildClassroomDescriptionFromItems(normalized, nameById);
  const existing = await findHomeworkByClassDate(classId, dateStr);
  const now = formatDateTimeNow(TIMEZONE);
  let homeworkId;
  let classroomWorkId = '';
  let classroomMsg = '';

  const classroomOnNode = process.env.CLASSROOM_ON_NODE === 'true' && options.skipClassroom !== true;
  const map = await getClassroomMap(classId);
  if (classroomOnNode && map && map.courseId) {
    const synced = await syncHomeworkToClassroom(
      map.courseId,
      title,
      description,
      existing ? existing.classroomWorkId : ''
    );
    if (synced.ok) {
      classroomWorkId = synced.workId;
      invalidateClassroomHomeworkCache(map.courseId);
      classroomMsg = synced.updated
        ? ' Updated on Google Classroom.'
        : ' Posted to Google Classroom.';
    } else {
      const err = String(synced.error || '');
      if (/invalid_grant/i.test(err)) {
        classroomMsg = ' (Classroom: Google login expired — re-run server npm run oauth-setup, then update Railway GOOGLE_OAUTH_REFRESH_TOKEN.)';
      } else {
        classroomMsg = ' (Classroom: ' + err + ')';
      }
    }
  } else if (!map || !map.courseId) {
    classroomMsg = ' (No Classroom link — saved in sheet only.)';
  }

  if (existing) {
    homeworkId = existing.homeworkId;
    const row = await findHomeworkRow(homeworkId);
    if (row > 0) {
      await updateRange(HOMEWORK_SHEETS.LOG, `D${row}:G${row}`, [[
        title,
        description,
        classroomWorkId || existing.classroomWorkId,
        now
      ]]);
    }
  } else {
    homeworkId = 'HW_' + classId + '_' + Date.now();
    await appendRows(HOMEWORK_SHEETS.LOG, [[homeworkId, classId, dateStr, title, description, classroomWorkId, now]]);
  }

  await saveHomeworkItems(homeworkId, classId, normalized);
  cacheDeletePrefix('sidebar_v1_');

  let classLogMsg = '';
  const { saveClassLogEntry, getTabConfig } = require('./classLogService');
  if (getTabConfig(classId)) {
    try {
      const hwLogText = formatHomeworkForClassLog(normalized, nameById);
      if (hwLogText) {
        await saveClassLogEntry(classId, dateStr, '', hwLogText, '');
        classLogMsg = ' Class log homework updated.';
      }
    } catch (e) {
      classLogMsg = ' (Class log: ' + (e.message || e) + ')';
    }
  }

  return {
    message: 'Homework saved (' + normalized.length + ' items).' + classroomMsg + classLogMsg,
    classLogHomework: formatHomeworkForClassLog(normalized, nameById)
  };
}

/** Sync sheet homework for a class/date to Google Classroom (Node OAuth, else client falls back to GAS). */
async function syncHomeworkClassroomForClassDate(classId, dateStr) {
  await migrateLegacyHomeworkOnce();
  const existing = await findHomeworkByClassDate(classId, dateStr);
  if (!existing) {
    return { ok: false, error: 'No homework saved for this date.' };
  }
  const map = await getClassroomMap(classId);
  if (!map || !map.courseId) {
    return { ok: true, skipped: true, message: 'No Classroom link.' };
  }
  if (!isClassroomConfigured()) {
    return { ok: false, fallbackGas: true, error: 'Node Classroom OAuth not configured.' };
  }
  const synced = await syncHomeworkToClassroom(
    map.courseId,
    existing.title,
    existing.description,
    existing.classroomWorkId
  );
  if (!synced.ok) {
    const err = String(synced.error || '');
    if (/invalid_grant/i.test(err)) {
      return {
        ok: false,
        fallbackGas: true,
        error: 'invalid_grant — Google OAuth refresh token expired. Re-run npm run oauth-setup and update Railway GOOGLE_OAUTH_REFRESH_TOKEN.'
      };
    }
    if (/oauth|not configured/i.test(err)) {
      return { ok: false, fallbackGas: true, error: err };
    }
    return { ok: false, error: err };
  }
  invalidateClassroomHomeworkCache(map.courseId);
  if (synced.workId && synced.workId !== existing.classroomWorkId) {
    const row = await findHomeworkRow(existing.homeworkId);
    if (row > 0) {
      await updateRange(HOMEWORK_SHEETS.LOG, `F${row}`, [[synced.workId]]);
    }
  }
  cacheDeletePrefix('sidebar_v1_');
  return {
    ok: true,
    workId: synced.workId,
    updated: !!synced.updated,
    message: synced.updated ? 'Updated on Google Classroom.' : 'Posted to Google Classroom.'
  };
}

async function getStudentHomeworkStatus(classId, studentId) {
  await migrateLegacyHomeworkOnce();
  const students = await getEnrolledStudents(classId);
  const nameById = {};
  students.forEach(s => { nameById[String(s.id)] = s.name; });
  const logs = await readHomeworkLogForClass(classId);
  const hwById = {};
  logs.forEach(r => { hwById[r.homeworkId] = r; });

  const itemsByHw = await readItemsMapForClass(classId);
  const data = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);
  const pending = [];
  const completed = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== String(studentId)) continue;
    const itemId = String(data[i][0]);
    let itemMeta = null;
    let hw = null;
    for (const hid of Object.keys(itemsByHw)) {
      const found = itemsByHw[hid].find(it => it.itemId === itemId);
      if (found) {
        itemMeta = found;
        hw = hwById[hid];
        break;
      }
    }
    if (!itemMeta || !hw) continue;
    if (isChambitHomeworkTitle(itemMeta.title)) continue;

    const entry = {
      itemId,
      homeworkId: itemMeta.homeworkId,
      sortOrder: itemMeta.sortOrder,
      title: formatHomeworkItemDisplayTitle(itemMeta, nameById),
      description: itemMeta.description,
      bundleTitle: hw.title,
      assignedDate: hw.assignedDate,
      completed: isCompletedCell(data[i][2]),
      completedAt: data[i][3] ? String(data[i][3]) : '',
      fixNote: data[i][4] ? String(data[i][4]) : ''
    };
    if (entry.completed) completed.push(entry);
    else pending.push(entry);
  }

  pending.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });
  completed.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });

  const manualByStudent = await readManualPendingForClass(classId);
  const manualItems = manualByStudent[studentId] || [];
  manualItems.forEach(entry => pending.push(entry));
  pending.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  return { pending, completed };
}

function sortPendingEntries(list) {
  list.sort((a, b) => {
    if (a.assignedDate !== b.assignedDate) return a.assignedDate < b.assignedDate ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });
  return list;
}

function buildItemMetaLookup(itemsByHw, hwById) {
  const itemMetaById = {};
  for (const hid of Object.keys(itemsByHw)) {
    const hw = hwById[hid];
    if (!hw) continue;
    for (const it of itemsByHw[hid]) {
      itemMetaById[it.itemId] = { itemMeta: it, hw };
    }
  }
  return itemMetaById;
}

async function getClassPendingHomework(classId) {
  await migrateLegacyHomeworkOnce();
  const students = await getEnrolledStudents(classId);
  const nameById = {};
  students.forEach(s => { nameById[String(s.id)] = s.name; });
  const logs = await readHomeworkLogForClass(classId);
  const hwById = {};
  logs.forEach(r => { hwById[r.homeworkId] = r; });
  const itemsByHw = await readItemsMapForClass(classId);
  const itemMetaById = buildItemMetaLookup(itemsByHw, hwById);
  const data = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);
  const pendingByStudent = {};
  students.forEach(s => { pendingByStudent[s.id] = []; });

  for (let i = 1; i < data.length; i++) {
    if (isCompletedCell(data[i][2])) continue;
    const studentId = String(data[i][1]);
    if (!Object.prototype.hasOwnProperty.call(pendingByStudent, studentId)) continue;
    const itemId = String(data[i][0]);
    const lookup = itemMetaById[itemId];
    if (!lookup) continue;
    const { itemMeta, hw } = lookup;
    if (isChambitHomeworkTitle(itemMeta.title)) continue;
    pendingByStudent[studentId].push({
      itemId,
      homeworkId: itemMeta.homeworkId,
      sortOrder: itemMeta.sortOrder,
      title: formatHomeworkItemDisplayTitle(itemMeta, nameById),
      description: itemMeta.description,
      bundleTitle: hw.title,
      assignedDate: hw.assignedDate,
      fixNote: data[i][4] ? String(data[i][4]) : ''
    });
  }

  const manualByStudent = await readManualPendingForClass(classId);
  Object.keys(manualByStudent).forEach(sid => {
    if (!Object.prototype.hasOwnProperty.call(pendingByStudent, sid)) return;
    manualByStudent[sid].forEach(entry => pendingByStudent[sid].push(entry));
  });

  const result = students.map(s => {
    const pending = sortPendingEntries(pendingByStudent[s.id] || []);
    return {
      studentId: s.id,
      name: s.name,
      pendingCount: pending.length,
      pending
    };
  });
  return { students: result };
}

async function findCompletionRow(itemId, studentId) {
  const data = await getSheetRows(HOMEWORK_SHEETS.COMPLETION);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(itemId) && String(data[i][1]) === String(studentId)) {
      return i + 1;
    }
  }
  return -1;
}

async function afterHomeworkWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(HOMEWORK_SHEETS.COMPLETION);
}

async function upsertHomeworkCompletionSupabase(itemId, studentId, done, completedAt, fixNote) {
  const db = getSupabase();
  const payload = {
    item_id: String(itemId),
    student_id: String(studentId),
    completed: !!done,
    completed_at: done && completedAt ? new Date(completedAt).toISOString() : null
  };
  if (fixNote !== undefined) payload.fix_note = String(fixNote);
  else if (done) payload.fix_note = '';
  const { error } = await db.from('homework_completion').upsert(payload, {
    onConflict: 'item_id,student_id'
  });
  if (error) throw new Error(error.message);
}

async function setHomeworkCompletion(itemId, studentId, completed, classId) {
  if (isManualPendingId(itemId)) {
    if (!completed) {
      return {
        message: 'Manual pending item is already open.',
        studentId: String(studentId),
        pendingCount: classId ? await countPendingItemsForStudent(classId, studentId) : null
      };
    }
    const result = await completeManualPending(itemId, classId);
    return {
      message: result.message,
      studentId: result.studentId,
      pendingCount: classId ? await countPendingItemsForStudent(classId, studentId) : null
    };
  }
  await migrateLegacyHomeworkOnce();
  const done = !!completed;
  const at = done ? formatDateTimeNow(TIMEZONE) : '';
  if (isSupabaseEnabled()) {
    await upsertHomeworkCompletionSupabase(itemId, studentId, done, at);
    await afterHomeworkWrite(classId);
    const pendingCount = classId
      ? await countPendingItemsForStudent(classId, studentId)
      : null;
    return {
      message: done ? 'Marked complete.' : 'Marked pending.',
      studentId: String(studentId),
      pendingCount
    };
  }
  const found = await findCompletionRow(itemId, studentId);
  if (found > 0) {
    if (done) {
      await updateRange(HOMEWORK_SHEETS.COMPLETION, `C${found}:E${found}`, [[done, at, '']]);
    } else {
      await updateRange(HOMEWORK_SHEETS.COMPLETION, `C${found}:D${found}`, [[done, at]]);
    }
  } else {
    await appendRows(HOMEWORK_SHEETS.COMPLETION, [[itemId, studentId, done, at, '']]);
  }
  await afterHomeworkWrite(classId);
  const pendingCount = classId
    ? await countPendingItemsForStudent(classId, studentId)
    : null;
  return {
    message: done ? 'Marked complete.' : 'Marked pending.',
    studentId: String(studentId),
    pendingCount
  };
}

async function setHomeworkFixNote(itemId, studentId, fixNote, classId) {
  if (isManualPendingId(itemId)) {
    const result = await setManualPendingFixNote(itemId, fixNote, classId);
    return {
      ...result,
      pendingCount: classId ? await countPendingItemsForStudent(classId, studentId) : null
    };
  }
  await migrateLegacyHomeworkOnce();
  fixNote = String(fixNote || '').trim();
  if (isSupabaseEnabled()) {
    await upsertHomeworkCompletionSupabase(itemId, studentId, false, null, fixNote);
    await afterHomeworkWrite(classId);
    return {
      message: fixNote ? 'Fix note saved.' : 'Fix note cleared.',
      studentId: String(studentId),
      itemId: String(itemId),
      fixNote,
      pendingCount: classId ? await countPendingItemsForStudent(classId, studentId) : null
    };
  }
  const found = await findCompletionRow(itemId, studentId);
  if (found > 0) {
    await updateRange(HOMEWORK_SHEETS.COMPLETION, `E${found}`, [[fixNote]]);
  } else {
    await appendRows(HOMEWORK_SHEETS.COMPLETION, [[itemId, studentId, false, '', fixNote]]);
  }
  await afterHomeworkWrite(classId);
  return {
    message: fixNote ? 'Fix note saved.' : 'Fix note cleared.',
    studentId: String(studentId),
    itemId: String(itemId),
    fixNote,
    pendingCount: classId ? await countPendingItemsForStudent(classId, studentId) : null
  };
}

async function countPendingItemsForStudent(classId, studentId) {
  const ctx = await buildRequestContext(classId);
  const pendingMap = await buildPendingHomeworkCountsFromCtx(ctx, classId);
  return pendingMap[String(studentId)] || 0;
}

module.exports = {
  buildClassHomeworkFromCtx,
  buildPendingHomeworkCountsFromCtx,
  listMyClassroomCourses,
  linkClassToClassroom,
  saveAndPostHomework,
  syncHomeworkClassroomForClassDate,
  getStudentHomeworkStatus,
  getClassPendingHomework,
  setHomeworkCompletion,
  setHomeworkFixNote,
  isClassroomConfigured,
  migrateLegacyHomework,
  readHomeworkLogForClass,
  getEnrolledStudents,
  formatHomeworkForClassLog,
  parseClassroomDescriptionToItems,
  formatHomeworkItemDisplayTitle
};
