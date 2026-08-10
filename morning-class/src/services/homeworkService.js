const crypto = require('crypto');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const LOG_SHEET = 'Homework_Log';
const ITEMS_SHEET = 'Homework_Items';
const COMPLETION_SHEET = 'Homework_Completion';

const LOG_HEADERS = ['HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt', 'DueDate'];
const ITEM_HEADERS = ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs', 'DueDate'];
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
  try {
    const logs = await getSheetRows(LOG_SHEET, { skipCache: true });
    const header = logs[0] || [];
    if (String(header[7] || '') !== 'DueDate') {
      const next = header.slice();
      while (next.length < LOG_HEADERS.length) next.push('');
      for (let i = 0; i < LOG_HEADERS.length; i++) {
        if (!String(next[i] || '').trim()) next[i] = LOG_HEADERS[i];
      }
      next[7] = 'DueDate';
      await updateRange(LOG_SHEET, 'A1:H1', [next.slice(0, LOG_HEADERS.length)]);
      invalidateSheetRowsCache(LOG_SHEET);
    }
  } catch (e) { /* non-fatal */ }
  try {
    const items = await getSheetRows(ITEMS_SHEET, { skipCache: true });
    const header = items[0] || [];
    if (String(header[6] || '') !== 'DueDate') {
      const next = header.slice();
      while (next.length < ITEM_HEADERS.length) next.push('');
      for (let i = 0; i < ITEM_HEADERS.length; i++) {
        if (!String(next[i] || '').trim()) next[i] = ITEM_HEADERS[i];
      }
      next[6] = 'DueDate';
      await updateRange(ITEMS_SHEET, 'A1:G1', [next.slice(0, ITEM_HEADERS.length)]);
      invalidateSheetRowsCache(ITEMS_SHEET);
    }
  } catch (e) { /* non-fatal */ }
}

function parseTargets(raw) {
  return String(raw || '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function postHomework(classId, payload) {
  await ensureHomeworkSheets();
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const title = String(payload.title || '').trim() || 'Homework';
  const description = String(payload.description || '').trim();
  const assignedDate = String(payload.assignedDate || todaySeoul()).trim();
  const dueDate = String(payload.dueDate || '').trim();
  const itemsIn = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ title, description, dueDate }];

  const homeworkId = newId('hw');
  const postedAt = new Date().toISOString();
  await appendRows(LOG_SHEET, [[
    homeworkId, classId, assignedDate, title, description, '', postedAt, dueDate
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
      targets,
      String(it.dueDate || dueDate || '').trim()
    ];
  });
  await appendRows(ITEMS_SHEET, itemRows);
  invalidateSheetRowsCache(LOG_SHEET);
  invalidateSheetRowsCache(ITEMS_SHEET);

  return getClassHomework(classId);
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

async function getClassHomework(classId) {
  classId = String(classId || '');
  const { logs, items, comps } = await loadHomeworkBundle();
  const done = completionMap(comps);
  const roster = await getClassRoster(classId);
  const nameById = {};
  roster.forEach((s) => { nameById[s.studentId] = s.name; });

  const homeworks = [];
  for (let i = 1; i < logs.length; i++) {
    if (String(logs[i][1]) !== classId) continue;
    const homeworkId = String(logs[i][0]);
    const hwDue = String(logs[i][7] || '');
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
        dueDate: String(items[j][6] || hwDue || ''),
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
      dueDate: hwDue,
      title: String(logs[i][3] || ''),
      description: String(logs[i][4] || ''),
      postedAt: String(logs[i][6] || ''),
      items: hwItems
    });
  }

  homeworks.sort((a, b) => String(b.assignedDate).localeCompare(String(a.assignedDate)) ||
    String(b.postedAt).localeCompare(String(a.postedAt)));

  const byDate = {};
  homeworks.forEach((hw) => {
    const d = hw.assignedDate || 'undated';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(hw);
  });
  const dates = Object.keys(byDate).sort((a, b) => String(b).localeCompare(String(a)));

  return { homeworks, byDate, dates, students: roster };
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
    const hwDue = String(logs[i][7] || '');
    const hwTitle = String(logs[i][3] || 'Homework');

    for (let j = 1; j < items.length; j++) {
      if (String(items[j][1]) !== homeworkId) continue;
      const targets = parseTargets(items[j][5]);
      if (targets.length && !targets.includes(studentId)) continue;

      const itemId = String(items[j][0]);
      const dueDate = String(items[j][6] || hwDue || '');
      const entry = {
        homeworkId,
        itemId,
        assignedDate,
        dueDate,
        title: String(items[j][3] || hwTitle),
        description: String(items[j][4] || logs[i][4] || ''),
        homeworkTitle: hwTitle
      };
      const c = done[itemId + ':' + studentId];
      if (c && c.completed) {
        completed.push({ ...entry, completedAt: c.completedAt, fixNote: c.fixNote });
      } else {
        pending.push(entry);
        if (assignedDate === today || dueDate === today) todayList.push(entry);
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

async function setHomeworkCompletion(itemId, studentId, completed, fixNote) {
  await ensureHomeworkSheets();
  itemId = String(itemId || '').trim();
  studentId = String(studentId || '').trim();
  if (!itemId || !studentId) throw new Error('Item and student are required.');

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
  todaySeoul
};
