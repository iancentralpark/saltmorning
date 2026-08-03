const crypto = require('crypto');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const LOG_SHEET = 'Homework_Log';
const ITEMS_SHEET = 'Homework_Items';
const COMPLETION_SHEET = 'Homework_Completion';

const LOG_HEADERS = [
  'HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description',
  'ClassroomWorkId', 'PostedAt', 'PostedByTeacherID', 'PostedByName'
];
const ITEM_HEADERS = ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs'];
const COMP_HEADERS = ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'];

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function ensureHomeworkSheets() {
  await ensureSheet(LOG_SHEET, LOG_HEADERS);
  await ensureSheet(ITEMS_SHEET, ITEM_HEADERS);
  await ensureSheet(COMPLETION_SHEET, COMP_HEADERS);
  await migrateHomeworkLogHeaders();
}

async function migrateHomeworkLogHeaders() {
  const rows = await getSheetRows(LOG_SHEET, { skipCache: true });
  if (!rows.length) {
    await appendRows(LOG_SHEET, [LOG_HEADERS]);
    invalidateSheetRowsCache(LOG_SHEET);
    return;
  }
  const header = (rows[0] || []).map((c) => String(c || ''));
  if (header[7] === 'PostedByTeacherID') return;
  await updateRange(LOG_SHEET, 'A1:I1', [LOG_HEADERS]);
  invalidateSheetRowsCache(LOG_SHEET);
}

function parseTargets(raw) {
  return String(raw || '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function postHomework(classId, payload, poster) {
  await ensureHomeworkSheets();
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const title = String(payload.title || '').trim() || 'Homework';
  const description = String(payload.description || '').trim();
  const assignedDate = String(payload.assignedDate || todaySeoul()).trim();
  const itemsIn = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ title, description }];

  const homeworkId = newId('hw');
  const postedAt = new Date().toISOString();
  const postedByTeacherId = String((poster && poster.teacherId) || '').trim();
  const postedByName = String((poster && poster.teacherName) || '').trim();
  await appendRows(LOG_SHEET, [[
    homeworkId, classId, assignedDate, title, description, '', postedAt,
    postedByTeacherId, postedByName
  ]]);

  const itemRows = itemsIn.map((it, idx) => {
    const itemTitle = String(it.title || title).trim() || ('Item ' + (idx + 1));
    const targets = Array.isArray(it.targetStudentIds)
      ? it.targetStudentIds.join(',')
      : String(it.targetStudentIds || '').trim();
    return [
      newId('hwi'),
      homeworkId,
      String(idx),
      itemTitle,
      String(it.description || description || '').trim(),
      targets
    ];
  });
  await appendRows(ITEMS_SHEET, itemRows);
  invalidateSheetRowsCache(LOG_SHEET);
  invalidateSheetRowsCache(ITEMS_SHEET);

  return getClassHomework(classId, {
    teacherId: postedByTeacherId,
    viewerIsHomeroom: !!(poster && poster.viewerIsHomeroom)
  });
}

async function loadHomeworkBundle() {
  await ensureHomeworkSheets();
  const [logs, items, comps] = await Promise.all([
    getSheetRows(LOG_SHEET),
    getSheetRows(ITEMS_SHEET),
    getSheetRows(COMPLETION_SHEET)
  ]);
  return { logs, items, comps };
}

function completionMap(comps) {
  const map = {};
  for (let i = 1; i < comps.length; i++) {
    const itemId = String(comps[i][0] || '');
    const studentId = String(comps[i][1] || '');
    if (!itemId || !studentId) continue;
    map[itemId + ':' + studentId] = {
      completed: String(comps[i][2] || '').toUpperCase() === 'TRUE' || comps[i][2] === true || comps[i][2] === 'Y',
      completedAt: String(comps[i][3] || ''),
      fixNote: String(comps[i][4] || ''),
      rowIndex: i + 1
    };
  }
  return map;
}

async function getClassHomework(classId, opts) {
  classId = String(classId || '');
  const viewerId = String((opts && opts.teacherId) || '');
  const viewerIsHomeroom = !!(opts && opts.viewerIsHomeroom);
  const { logs, items, comps } = await loadHomeworkBundle();
  const done = completionMap(comps);
  const roster = await getClassRoster(classId);

  const homeworks = [];
  for (let i = 1; i < logs.length; i++) {
    if (String(logs[i][1]) !== classId) continue;
    const homeworkId = String(logs[i][0]);
    const postedByTeacherId = String(logs[i][7] || '').trim();
    const postedByName = String(logs[i][8] || '').trim();

    if (!viewerIsHomeroom && viewerId) {
      if (postedByTeacherId && postedByTeacherId !== viewerId) continue;
    }

    const isMine = !postedByTeacherId || postedByTeacherId === viewerId;
    const canMarkDone = isMine;

    const hwItems = [];
    for (let j = 1; j < items.length; j++) {
      if (String(items[j][1]) !== homeworkId) continue;
      const itemId = String(items[j][0]);
      const targets = parseTargets(items[j][5]);
      const completions = roster
        .filter((s) => !targets.length || targets.includes(s.studentId))
        .map((s) => {
          const c = done[itemId + ':' + s.studentId] || { completed: false };
          return {
            studentId: s.studentId,
            name: s.name,
            completed: !!c.completed,
            completedAt: c.completedAt || '',
            fixNote: c.fixNote || ''
          };
        });
      hwItems.push({
        itemId,
        title: String(items[j][3] || ''),
        description: String(items[j][4] || ''),
        targetStudentIds: targets,
        sortOrder: Number(items[j][2]) || 0,
        completions,
        completedCount: completions.filter((c) => c.completed).length,
        totalCount: completions.length
      });
    }
    hwItems.sort((a, b) => a.sortOrder - b.sortOrder);
    homeworks.push({
      homeworkId,
      classId,
      assignedDate: String(logs[i][2] || ''),
      title: String(logs[i][3] || ''),
      description: String(logs[i][4] || ''),
      postedAt: String(logs[i][6] || ''),
      postedByTeacherId,
      postedByName,
      canMarkDone,
      isMine,
      items: hwItems
    });
  }

  homeworks.sort((a, b) => String(b.assignedDate).localeCompare(String(a.assignedDate)) ||
    String(b.postedAt).localeCompare(String(a.postedAt)));
  return { homeworks, students: roster, viewerIsHomeroom };
}

async function findHomeworkPosterByItemId(itemId) {
  itemId = String(itemId || '');
  const { logs, items } = await loadHomeworkBundle();
  let homeworkId = '';
  for (let j = 1; j < items.length; j++) {
    if (String(items[j][0]) === itemId) {
      homeworkId = String(items[j][1] || '');
      break;
    }
  }
  if (!homeworkId) return null;
  for (let i = 1; i < logs.length; i++) {
    if (String(logs[i][0]) !== homeworkId) continue;
    return {
      homeworkId,
      classId: String(logs[i][1] || ''),
      postedByTeacherId: String(logs[i][7] || '').trim()
    };
  }
  return null;
}

async function getStudentHomeworkStatus(studentId, classId) {
  studentId = String(studentId);
  classId = String(classId || '');
  const { logs, items, comps } = await loadHomeworkBundle();
  const done = completionMap(comps);
  const today = todaySeoul();

  const todayList = [];
  const pending = [];
  const completed = [];

  for (let i = 1; i < logs.length; i++) {
    if (classId && String(logs[i][1]) !== classId) continue;
    const homeworkId = String(logs[i][0]);
    const assignedDate = String(logs[i][2] || '');
    const hwTitle = String(logs[i][3] || 'Homework');

    for (let j = 1; j < items.length; j++) {
      if (String(items[j][1]) !== homeworkId) continue;
      const targets = parseTargets(items[j][5]);
      if (targets.length && !targets.includes(studentId)) continue;

      const itemId = String(items[j][0]);
      const entry = {
        homeworkId,
        itemId,
        assignedDate,
        title: String(items[j][3] || hwTitle),
        description: String(items[j][4] || logs[i][4] || ''),
        homeworkTitle: hwTitle
      };
      const c = done[itemId + ':' + studentId];
      if (c && c.completed) {
        completed.push({ ...entry, completedAt: c.completedAt, fixNote: c.fixNote });
      } else {
        pending.push(entry);
        if (assignedDate === today) todayList.push(entry);
      }
    }
  }

  pending.sort((a, b) => String(b.assignedDate).localeCompare(String(a.assignedDate)));
  return {
    available: true,
    today: todayList,
    pending,
    completed: completed.slice(0, 30)
  };
}

async function setHomeworkCompletion(itemId, studentId, completed, fixNote, actor) {
  await ensureHomeworkSheets();
  itemId = String(itemId || '').trim();
  studentId = String(studentId || '').trim();
  if (!itemId || !studentId) throw new Error('Item and student are required.');

  if (actor && actor.teacherId) {
    const meta = await findHomeworkPosterByItemId(itemId);
    if (meta && meta.postedByTeacherId && meta.postedByTeacherId !== String(actor.teacherId)) {
      throw new Error('Only the teacher who posted this homework can mark it done.');
    }
  }

  const comps = await getSheetRows(COMPLETION_SHEET, { skipCache: true });
  let rowIndex = -1;
  for (let i = 1; i < comps.length; i++) {
    if (String(comps[i][0]) === itemId && String(comps[i][1]) === studentId) {
      rowIndex = i + 1;
      break;
    }
  }

  const isDone = completed === true || completed === 'TRUE' || completed === 'true';
  const row = [
    itemId,
    studentId,
    isDone ? 'TRUE' : 'FALSE',
    isDone ? new Date().toISOString() : '',
    String(fixNote || '').trim()
  ];

  if (rowIndex > 0) {
    await updateRange(COMPLETION_SHEET, `A${rowIndex}:E${rowIndex}`, [row]);
  } else {
    await appendRows(COMPLETION_SHEET, [row]);
  }
  invalidateSheetRowsCache(COMPLETION_SHEET);
  return { itemId, studentId, completed: isDone };
}

module.exports = {
  ensureHomeworkSheets,
  postHomework,
  getClassHomework,
  getStudentHomeworkStatus,
  setHomeworkCompletion,
  findHomeworkPosterByItemId,
  todaySeoul
};
