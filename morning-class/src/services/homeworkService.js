const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { getClassRoster } = require('./teacherPortalService');

const LOG_SHEET = 'Homework_Log';
const ITEMS_SHEET = 'Homework_Items';
const COMPLETION_SHEET = 'Homework_Completion';

const LOG_HEADERS = [
  'HomeworkID', 'ClassID', 'AssignedDate', 'Title', 'Description', 'ClassroomWorkId', 'PostedAt', 'DueDate',
  'LinkUrl', 'Points', 'AttachmentPath', 'AttachmentName', 'GoogleFormId', 'GoogleDriveFileId', 'AssignmentType'
];
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'homework');
const ATTACH_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip'
};
const ITEM_HEADERS = ['ItemID', 'HomeworkID', 'SortOrder', 'Title', 'Description', 'TargetStudentIDs', 'DueDate'];
const COMP_HEADERS = ['ItemID', 'StudentID', 'Completed', 'CompletedAt', 'FixNote'];

/** One-time header migration; skipCache thrash was slowing every homework read. */
let homeworkHeaderMigrationDone = false;
let homeworkHeaderMigrationInFlight = null;

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function saveHomeworkFile(homeworkId, file) {
  if (!file || !file.buffer) return null;
  const ext = ATTACH_MIME[file.mimetype];
  if (!ext) throw new Error('File type not allowed. Use PDF, Word, Excel, image, text, or ZIP.');
  ensureUploadDir();
  const safeId = String(homeworkId).replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = safeId + '_' + Date.now() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return {
    path: '/uploads/homework/' + filename,
    name: String(file.originalname || filename).slice(0, 180)
  };
}

function removeHomeworkFile(filePath) {
  const rel = String(filePath || '').replace(/^\/uploads\/homework\//, '');
  if (!rel || rel.includes('..')) return;
  const full = path.join(UPLOAD_DIR, rel);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (_) { /* ignore */ }
}

function logRowToMeta(row) {
  return {
    linkUrl: String(row[8] || '').trim(),
    points: String(row[9] || '').trim(),
    attachmentPath: String(row[10] || '').trim(),
    attachmentName: String(row[11] || '').trim(),
    googleFormId: String(row[12] || '').trim(),
    googleDriveFileId: String(row[13] || '').trim(),
    assignmentType: String(row[14] || '').trim()
  };
}

function isGoogleFormUrl(url) {
  return /docs\.google\.com\/forms\//i.test(String(url || ''));
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)/i.test(String(url || ''));
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function migrateHomeworkLogHeaders() {
  if (homeworkHeaderMigrationDone) return;
  if (homeworkHeaderMigrationInFlight) return homeworkHeaderMigrationInFlight;
  homeworkHeaderMigrationInFlight = (async () => {
    try {
      const logs = await getSheetRows(LOG_SHEET, { skipCache: true });
      const header = logs[0] || [];
      let needsUpdate = false;
      const next = header.slice();
      while (next.length < LOG_HEADERS.length) next.push('');
      for (let i = 0; i < LOG_HEADERS.length; i++) {
        if (!String(next[i] || '').trim() || next[i] !== LOG_HEADERS[i]) {
          if (!String(next[i] || '').trim()) next[i] = LOG_HEADERS[i];
          needsUpdate = true;
        }
      }
      for (let i = 0; i < LOG_HEADERS.length; i++) {
        if (next[i] !== LOG_HEADERS[i]) {
          next[i] = LOG_HEADERS[i];
          needsUpdate = true;
        }
      }
      if (needsUpdate) {
        await updateRange(LOG_SHEET, 'A1:O1', [next.slice(0, LOG_HEADERS.length)]);
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
    homeworkHeaderMigrationDone = true;
    homeworkHeaderMigrationInFlight = null;
  })();
  return homeworkHeaderMigrationInFlight;
}

async function ensureHomeworkSheets() {
  await ensureSheet(LOG_SHEET, LOG_HEADERS);
  await ensureSheet(ITEMS_SHEET, ITEM_HEADERS);
  await ensureSheet(COMPLETION_SHEET, COMP_HEADERS);
  await migrateHomeworkLogHeaders();
}

function parseTargets(raw) {
  return String(raw || '')
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function postHomework(classId, payload, file) {
  await ensureHomeworkSheets();
  classId = String(classId || '').trim();
  if (!classId) throw new Error('Class ID is required.');

  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Homework title is required.');
  const description = String(payload.description || '').trim();
  const assignedDate = String(payload.assignedDate || todaySeoul()).trim();
  const dueDate = String(payload.dueDate || '').trim();
  const linkUrl = String(payload.linkUrl || '').trim();
  const points = String(payload.points || '').trim();
  const googleFormId = String(payload.googleFormId || '').trim();
  const googleDriveFileId = String(payload.googleDriveFileId || '').trim();
  const assignmentType = String(payload.assignmentType || '').trim();
  const itemsIn = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : [{ title, description, dueDate }];

  const homeworkId = newId('hw');
  const postedAt = new Date().toISOString();
  let attachmentPath = '';
  let attachmentName = '';
  if (file) {
    const saved = saveHomeworkFile(homeworkId, file);
    if (saved) {
      attachmentPath = saved.path;
      attachmentName = saved.name;
    }
  } else {
    const driveWebLink = String(payload.driveWebLink || '').trim();
    if (driveWebLink) {
      attachmentPath = driveWebLink;
      attachmentName = String(payload.driveAttachmentName || '').trim() || 'Google Drive file';
    }
  }
  await appendRows(LOG_SHEET, [[
    homeworkId, classId, assignedDate, title, description, '', postedAt, dueDate,
    linkUrl, points, attachmentPath, attachmentName, googleFormId, googleDriveFileId, assignmentType
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

  try {
    const { notifyHomeworkPosted } = require('./pushService');
    notifyHomeworkPosted(classId, title).catch((e) =>
      console.warn('[homework] push failed:', e.message)
    );
  } catch (_) { /* ignore */ }

  return getClassHomework(classId);
}

async function updateHomework(classId, homeworkId, payload) {
  await ensureHomeworkSheets();
  classId = String(classId || '').trim();
  homeworkId = String(homeworkId || '').trim();
  if (!classId || !homeworkId) throw new Error('Class and homework ID are required.');

  const logs = await getSheetRows(LOG_SHEET, { skipCache: true });
  let logRow = -1;
  for (let i = 1; i < logs.length; i++) {
    if (String(logs[i][0]) !== homeworkId) continue;
    if (String(logs[i][1]) !== classId) throw new Error('Homework not found for this class.');
    logRow = i + 1;
    break;
  }
  if (logRow < 0) throw new Error('Homework not found.');

  const title = payload.title != null ? String(payload.title || '').trim() || 'Homework' : String(logs[logRow - 1][3] || 'Homework');
  const description = payload.description != null
    ? String(payload.description || '').trim()
    : String(logs[logRow - 1][4] || '');
  const assignedDate = payload.assignedDate != null
    ? String(payload.assignedDate || '').trim()
    : String(logs[logRow - 1][2] || '');
  const dueDate = payload.dueDate != null
    ? String(payload.dueDate || '').trim()
    : String(logs[logRow - 1][7] || '');

  const row = logs[logRow - 1].slice();
  while (row.length < LOG_HEADERS.length) row.push('');
  row[2] = assignedDate;
  row[3] = title;
  row[4] = description;
  row[7] = dueDate;
  if (payload.linkUrl != null) row[8] = String(payload.linkUrl || '').trim();
  if (payload.points != null) row[9] = String(payload.points || '').trim();
  await updateRange(LOG_SHEET, `A${logRow}:O${logRow}`, [row.slice(0, LOG_HEADERS.length)]);

  if (Array.isArray(payload.items) && payload.items.length) {
    const items = await getSheetRows(ITEMS_SHEET, { skipCache: true });
    for (let j = 1; j < items.length; j++) {
      if (String(items[j][1]) !== homeworkId) continue;
      await updateRange(ITEMS_SHEET, `A${j + 1}:G${j + 1}`, [new Array(7).fill('')]);
    }
    const itemRows = payload.items.map((it, idx) => {
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
    invalidateSheetRowsCache(ITEMS_SHEET);
  }
  invalidateSheetRowsCache(LOG_SHEET);
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
    const homeworkId = String(logs[i][0] || '').trim();
    if (!homeworkId) continue;
    const hwDue = String(logs[i][7] || '');
    const extras = logRowToMeta(logs[i]);
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
      linkUrl: extras.linkUrl,
      points: extras.points,
      attachmentPath: extras.attachmentPath,
      attachmentName: extras.attachmentName,
      googleFormId: extras.googleFormId,
      googleDriveFileId: extras.googleDriveFileId,
      assignmentType: extras.assignmentType,
      isYouTube: isYouTubeUrl(extras.linkUrl),
      isGoogleForm: !!(extras.googleFormId || isGoogleFormUrl(extras.linkUrl)),
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
    const homeworkId = String(logs[i][0] || '').trim();
    if (!homeworkId) continue;
    const assignedDate = String(logs[i][2] || '');
    const hwDue = String(logs[i][7] || '');
    const hwTitle = String(logs[i][3] || 'Homework');
    const extras = logRowToMeta(logs[i]);

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
        homeworkTitle: hwTitle,
        linkUrl: extras.linkUrl,
        points: extras.points,
        attachmentPath: extras.attachmentPath,
        attachmentName: extras.attachmentName,
        googleFormId: extras.googleFormId,
        googleDriveFileId: extras.googleDriveFileId,
        assignmentType: extras.assignmentType,
        isYouTube: isYouTubeUrl(extras.linkUrl),
        isGoogleForm: !!(extras.googleFormId || isGoogleFormUrl(extras.linkUrl))
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

/** One sheet read for the whole class — avoids N× homework bundle loads in analytics. */
async function getPendingHomeworkCounts(classId, opts) {
  classId = String(classId || '');
  opts = opts || {};
  const bundlePromise = loadHomeworkBundle();
  const roster = Array.isArray(opts.roster) ? opts.roster : await getClassRoster(classId);
  const { logs, items, comps } = await bundlePromise;
  const done = completionMap(comps);
  const counts = Object.create(null);
  roster.forEach((s) => { counts[s.studentId] = 0; });

  const classHomeworkIds = new Set();
  for (let i = 1; i < logs.length; i++) {
    if (classId && String(logs[i][1]) !== classId) continue;
    if (!String(logs[i][0] || '').trim()) continue;
    classHomeworkIds.add(String(logs[i][0]));
  }

  for (let j = 1; j < items.length; j++) {
    const homeworkId = String(items[j][1] || '');
    if (!classHomeworkIds.has(homeworkId)) continue;
    const itemId = String(items[j][0] || '');
    if (!itemId) continue;
    const targets = parseTargets(items[j][5]);
    const students = targets.length
      ? targets
      : roster.map((s) => s.studentId);
    students.forEach((studentId) => {
      if (!(studentId in counts)) counts[studentId] = 0;
      const c = done[itemId + ':' + studentId];
      if (c && c.completed) return;
      counts[studentId] += 1;
    });
  }

  return counts;
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

async function deleteHomework(classId, homeworkId) {
  await ensureHomeworkSheets();
  classId = String(classId || '').trim();
  homeworkId = String(homeworkId || '').trim();
  if (!classId || !homeworkId) throw new Error('Class and homework ID are required.');

  const logs = await getSheetRows(LOG_SHEET, { skipCache: true });
  let logRow = -1;
  let attachmentPath = '';
  for (let i = 1; i < logs.length; i++) {
    if (String(logs[i][0]) !== homeworkId) continue;
    if (String(logs[i][1]) !== classId) throw new Error('Homework not found for this class.');
    logRow = i + 1;
    attachmentPath = String(logs[i][10] || '');
    break;
  }
  if (logRow < 0) throw new Error('Homework not found.');

  const items = await getSheetRows(ITEMS_SHEET, { skipCache: true });
  const itemIds = [];
  for (let j = 1; j < items.length; j++) {
    if (String(items[j][1]) !== homeworkId) continue;
    const itemId = String(items[j][0] || '');
    if (itemId) itemIds.push(itemId);
    await updateRange(ITEMS_SHEET, `A${j + 1}:G${j + 1}`, [new Array(7).fill('')]);
  }

  if (itemIds.length) {
    const comps = await getSheetRows(COMPLETION_SHEET, { skipCache: true });
    for (let k = 1; k < comps.length; k++) {
      if (!itemIds.includes(String(comps[k][0] || ''))) continue;
      await updateRange(COMPLETION_SHEET, `A${k + 1}:E${k + 1}`, [new Array(5).fill('')]);
    }
    invalidateSheetRowsCache(COMPLETION_SHEET);
  }

  await updateRange(LOG_SHEET, `A${logRow}:O${logRow}`, [new Array(LOG_HEADERS.length).fill('')]);
  invalidateSheetRowsCache(LOG_SHEET);
  invalidateSheetRowsCache(ITEMS_SHEET);
  if (attachmentPath) removeHomeworkFile(attachmentPath);

  return getClassHomework(classId);
}

module.exports = {
  ensureHomeworkSheets,
  postHomework,
  updateHomework,
  deleteHomework,
  getClassHomework,
  getStudentHomeworkStatus,
  getPendingHomeworkCounts,
  setHomeworkCompletion,
  todaySeoul
};
