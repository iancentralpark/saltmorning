const {
  TEXTBOOK_SHEETS,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRow } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { formatSheetDate, formatDateStr, formatDateTimeNow } = require('./dateUtils');
const { buildRequestContext } = require('./sheets');
const { buildClassTextbookFromCtx } = require('./sessionService');

function isQueueItemReady(item) {
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!String(item.name || '').trim()) return false;
  if (!allowed.includes(String(item.type || '').trim())) return false;
  const total = Number(item.totalUnits);
  return Number.isFinite(total) && total > 0;
}

async function readTextbookQueueForClass(classId) {
  const data = await getSheetRows(TEXTBOOK_SHEETS.QUEUE);
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
  items.sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.row - b.row));
  return { items };
}

function normalizeQueueFields(type, unitType, totalUnits) {
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  const t = String(type || '').trim();
  if (t && !allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : (unitType === 'chapter' ? 'chapter' : '');
  const totalRaw = totalUnits === '' || totalUnits == null ? 0 : Number(totalUnits);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
  return { type: t, unitType: ut, totalUnits: total };
}

async function addClassTextbook(classId, name, type, unitType, totalUnits, startDateStr) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const t = String(type || '').trim();
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : 'chapter';
  const total = Number(totalUnits);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Enter total chapters or pages (greater than 0).');

  let startStr = formatDateStr(startDateStr);
  if (!startStr) startStr = formatDateStr(new Date());

  const id = 'TB_' + classId + '_' + Date.now();
  await appendRows(TEXTBOOK_SHEETS.BOOKS, [[id, classId, n, t, ut, total, startStr, 'Active', '']]);
  cacheDeletePrefix('sidebar_v1_');
  return { textbookId: id, message: 'Textbook added.' };
}

async function promoteNextQueuedTextbook(classId) {
  const q = await readTextbookQueueForClass(classId);
  if (!q.items.length) return null;
  const next = q.items[0];
  if (!isQueueItemReady(next)) {
    return { skipped: true, reason: 'incomplete', name: next.name };
  }
  const added = await addClassTextbook(classId, next.name, next.type, next.unitType, next.totalUnits, null);
  await deleteRow(TEXTBOOK_SHEETS.QUEUE, next.row);
  return {
    textbookId: added.textbookId,
    name: next.name,
    type: next.type,
    unitType: next.unitType,
    totalUnits: next.totalUnits
  };
}

async function addTextbookToQueue(classId, name, type, unitType, totalUnits) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const fields = normalizeQueueFields(type, unitType, totalUnits);
  const q = await readTextbookQueueForClass(classId);
  const maxSort = q.items.reduce((m, item) => Math.max(m, item.sortOrder), 0);
  const now = formatDateTimeNow(TIMEZONE);
  const queueId = 'TQ_' + classId + '_' + Date.now();
  await appendRows(TEXTBOOK_SHEETS.QUEUE, [[queueId, classId, maxSort + 1, n, fields.type, fields.unitType, fields.totalUnits, now]]);
  cacheDeletePrefix('sidebar_v1_');
  return { message: 'Added to queue.', queueId, name: n };
}

async function updateTextbookQueueItem(queueId, name, type, unitType, totalUnits) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const fields = normalizeQueueFields(type, unitType, totalUnits);
  const data = await getSheetRows(TEXTBOOK_SHEETS.QUEUE);
  const idStr = String(queueId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== idStr) continue;
    await updateRange(TEXTBOOK_SHEETS.QUEUE, `D${i + 1}:G${i + 1}`, [[n, fields.type, fields.unitType, fields.totalUnits]]);
    cacheDeletePrefix('sidebar_v1_');
    return { message: 'Queue item updated.', queueId: idStr, name: n };
  }
  throw new Error('Queue item not found.');
}

async function deleteTextbookQueueItem(queueId) {
  const data = await getSheetRows(TEXTBOOK_SHEETS.QUEUE);
  const idStr = String(queueId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === idStr) {
      await deleteRow(TEXTBOOK_SHEETS.QUEUE, i + 1);
      cacheDeletePrefix('sidebar_v1_');
      return { message: 'Removed from queue.' };
    }
  }
  throw new Error('Queue item not found.');
}

async function updateClassTextbook(textbookId, name, type, unitType, totalUnits, startDateStr) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Textbook name is required.');
  const t = String(type || '').trim();
  const allowed = ['Vocab', 'Novel', 'Non-fiction', 'Grammar'];
  if (!allowed.includes(t)) throw new Error('Invalid textbook type.');
  const ut = unitType === 'page' ? 'page' : 'chapter';
  const total = Number(totalUnits);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Enter total chapters or pages (greater than 0).');
  const startStr = formatDateStr(startDateStr);
  if (!startStr) throw new Error('Start date is required.');

  const data = await getSheetRows(TEXTBOOK_SHEETS.BOOKS);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== textbookId) continue;
    await updateRange(TEXTBOOK_SHEETS.BOOKS, `C${i + 1}:G${i + 1}`, [[n, t, ut, total, startStr]]);
    cacheDeletePrefix('sidebar_v1_');
    return { message: 'Textbook updated.' };
  }
  throw new Error('Textbook not found.');
}

async function completeClassTextbook(textbookId) {
  const data = await getSheetRows(TEXTBOOK_SHEETS.BOOKS);
  const now = formatDateTimeNow(TIMEZONE);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== textbookId) continue;
    const classId = data[i][1];
    await updateRange(TEXTBOOK_SHEETS.BOOKS, `H${i + 1}:I${i + 1}`, [['Completed', now]]);
    const next = await promoteNextQueuedTextbook(classId);
    cacheDeletePrefix('sidebar_v1_');
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

async function saveTextbookProgress(classId, dateStr, records) {
  if (!dateStr) throw new Error('Date is required.');
  const data = await getSheetRows(TEXTBOOK_SHEETS.PROGRESS);
  for (const rec of records || []) {
    const pos = Number(rec.position);
    if (!rec.textbookId || !Number.isFinite(pos) || pos < 0) continue;
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (formatSheetDate(data[i][0]) === dateStr &&
          data[i][1] === classId &&
          data[i][2] === rec.textbookId) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow !== -1) {
      await updateRange(TEXTBOOK_SHEETS.PROGRESS, `D${foundRow}`, [[pos]]);
      data[foundRow - 1][3] = pos;
    } else {
      await appendRows(TEXTBOOK_SHEETS.PROGRESS, [[dateStr, classId, rec.textbookId, pos]]);
      data.push([dateStr, classId, rec.textbookId, pos]);
    }
  }
  cacheDeletePrefix('sidebar_v1_');
  return 'Textbook progress saved.';
}

async function getClassTextbookData(classId, dateStr) {
  const ctx = await buildRequestContext(classId);
  return buildClassTextbookFromCtx(ctx, dateStr);
}

module.exports = {
  getClassTextbookData,
  addTextbookToQueue,
  updateTextbookQueueItem,
  deleteTextbookQueueItem,
  addClassTextbook,
  updateClassTextbook,
  completeClassTextbook,
  saveTextbookProgress
};
