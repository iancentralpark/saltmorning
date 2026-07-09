const {
  TEXTBOOK_SHEETS,
  TIMEZONE
} = require('./config');
const { getSheetRows, updateRange, appendRows, deleteRow, invalidateSheetRowsCache } = require('./sheets');
const { cacheDeletePrefix } = require('./cache');
const { formatSheetDate, formatDateStr, formatDateTimeNow } = require('./dateUtils');
const { buildRequestContext } = require('./sheets');
const { buildClassTextbookFromCtx, invalidateWorkCache } = require('./sessionService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

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

function findNextQueuedTextbookForType(items, completedType) {
  const want = String(completedType || '').trim();
  if (!want) return null;
  for (let i = 0; i < items.length; i++) {
    if (String(items[i].type || '').trim() === want) return items[i];
  }
  return null;
}

async function promoteNextQueuedTextbook(classId, completedType) {
  const q = await readTextbookQueueForClass(classId);
  const next = findNextQueuedTextbookForType(q.items, completedType);
  if (!next) return null;
  if (!isQueueItemReady(next)) {
    return { skipped: true, reason: 'incomplete', name: next.name, type: next.type };
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
    const completedType = String(data[i][3] || '').trim();
    await updateRange(TEXTBOOK_SHEETS.BOOKS, `H${i + 1}:I${i + 1}`, [['Completed', now]]);
    const next = await promoteNextQueuedTextbook(classId, completedType);
    cacheDeletePrefix('sidebar_v1_');
    if (next && next.skipped) {
      return {
        message: 'Textbook marked complete. Next ' + (next.type || completedType) + ' in queue ("' + next.name + '") still needs type & total — edit it in Up Next.',
        queueBlocked: true
      };
    }
    if (next) {
      return {
        message: 'Textbook marked complete. Now reading: "' + next.name + '" (' + next.type + ').',
        nextTextbook: next
      };
    }
    if (completedType) {
      return {
        message: 'Textbook marked complete. No ' + completedType + ' book is queued in Up Next.',
        queueBlocked: false
      };
    }
    return { message: 'Textbook marked complete. Progress history is kept in the sheet.' };
  }
  throw new Error('Textbook not found.');
}

async function saveTextbookProgress(classId, dateStr, records) {
  if (!dateStr) throw new Error('Date is required.');
  classId = String(classId);
  dateStr = formatSheetDate(dateStr);

  const payload = [];
  for (const rec of records || []) {
    const pos = Number(rec.position);
    if (!rec.textbookId || !Number.isFinite(pos) || pos < 0) continue;
    payload.push({
      textbookId: String(rec.textbookId),
      position: pos
    });
  }
  if (!payload.length) throw new Error('No valid progress records to save.');

  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const rows = payload.map(function(rec) {
      return {
        record_date: dateStr,
        class_id: classId,
        textbook_id: rec.textbookId,
        position: rec.position
      };
    });
    const { error } = await db.from('textbook_progress').upsert(rows, {
      onConflict: 'record_date,class_id,textbook_id'
    });
    if (error) throw new Error(error.message);
    afterTextbookProgressWrite(classId, dateStr);
    return 'Textbook progress saved.';
  }

  const data = await getSheetRows(TEXTBOOK_SHEETS.PROGRESS, { skipCache: true });
  for (const rec of payload) {
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (formatSheetDate(data[i][0]) === dateStr &&
          String(data[i][1]) === classId &&
          String(data[i][2]) === rec.textbookId) {
        foundRow = i + 1;
        break;
      }
    }
    if (foundRow !== -1) {
      await updateRange(TEXTBOOK_SHEETS.PROGRESS, `D${foundRow}`, [[rec.position]]);
      data[foundRow - 1][3] = rec.position;
    } else {
      await appendRows(TEXTBOOK_SHEETS.PROGRESS, [[dateStr, classId, rec.textbookId, rec.position]]);
      data.push([dateStr, classId, rec.textbookId, rec.position]);
    }
  }
  afterTextbookProgressWrite(classId, dateStr);
  return 'Textbook progress saved.';
}

function afterTextbookProgressWrite(classId, dateStr) {
  cacheDeletePrefix('sidebar_v1_');
  invalidateWorkCache(classId, dateStr);
  invalidateSheetRowsCache(TEXTBOOK_SHEETS.PROGRESS);
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
