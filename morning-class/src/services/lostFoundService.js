'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  LOST_AND_FOUND_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const HEADERS = [
  'ItemID', 'Title', 'Category', 'FoundLocation', 'ImageURL', 'Status',
  'ClaimedByStudentID', 'ClaimedByParentID', 'ClaimNote', 'CreatedByTeacherID', 'CreatedAt'
];

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'lost-and-found');

const IMAGE_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function ensureLostFoundSheet() {
  await ensureSheet(LOST_AND_FOUND_SHEET, HEADERS);
}

function parseRow(row) {
  if (!row || !row[0]) return null;
  return {
    itemId: String(row[0]),
    title: String(row[1] || ''),
    category: String(row[2] || 'Other'),
    foundLocation: String(row[3] || ''),
    imageUrl: String(row[4] || ''),
    status: String(row[5] || 'Unclaimed'),
    claimedByStudentId: String(row[6] || ''),
    claimedByParentId: String(row[7] || ''),
    claimNote: String(row[8] || ''),
    createdByTeacherId: String(row[9] || ''),
    createdAt: String(row[10] || '')
  };
}

function saveImageBuffer(file) {
  if (!file || !file.buffer) return '';
  const ext = IMAGE_MIME[file.mimetype];
  if (!ext) throw Object.assign(new Error('Image must be JPEG, PNG, WebP, or GIF.'), { status: 400 });
  ensureUploadDir();
  const name = 'laf_' + crypto.randomBytes(8).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return '/uploads/lost-and-found/' + name;
}

async function listItems(opts) {
  opts = opts || {};
  await ensureLostFoundSheet();
  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, opts.skipCache ? { skipCache: true } : undefined);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const item = parseRow(rows[i]);
    if (!item) continue;
    if (item.status === 'Removed' && !opts.includeRemoved) continue;
    if (opts.status) {
      const statuses = String(opts.status).split(',').map((s) => s.trim());
      if (!statuses.includes(item.status)) continue;
    }
    if (opts.excludeClaimed && item.status === 'Claimed') continue;
    out.push(item);
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

async function studentName(studentId) {
  if (!studentId) return '';
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(studentId)) return String(rows[i][1] || studentId);
  }
  return studentId;
}

async function createItem(teacherId, payload, file) {
  await ensureLostFoundSheet();
  const title = String(payload.title || '').trim();
  const foundLocation = String(payload.foundLocation || payload.location || '').trim();
  if (!title || !foundLocation) {
    throw Object.assign(new Error('Title and found location are required.'), { status: 400 });
  }
  const imageUrl = file ? saveImageBuffer(file) : String(payload.imageUrl || '').trim();
  const itemId = newId('laf');
  const row = [
    itemId,
    title,
    String(payload.category || 'Other').trim() || 'Other',
    foundLocation,
    imageUrl,
    'Unclaimed',
    '',
    '',
    '',
    String(teacherId || ''),
    nowIso()
  ];
  await appendRows(LOST_AND_FOUND_SHEET, [row]);
  invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);
  return parseRow(row);
}

async function claimItem(session, itemId, payload) {
  await ensureLostFoundSheet();
  itemId = String(itemId || '').trim();
  const studentId = String((payload && payload.studentId) || session.studentId || '').trim();
  const parentId = String(session.parentId || '').trim();
  const claimNote = String((payload && payload.claimNote) || '').trim().slice(0, 400);
  if (!itemId || !studentId || !parentId) {
    throw Object.assign(new Error('Item, student, and parent are required.'), { status: 400 });
  }
  if (String(session.studentId) !== studentId) {
    throw Object.assign(new Error('Switch to the correct child before claiming.'), { status: 403 });
  }

  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== itemId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    const status = String(row[5] || 'Unclaimed');
    if (status === 'Claimed') {
      throw Object.assign(new Error('Already marked as picked up.'), { status: 400 });
    }
    if (status === 'ClaimRequested' && String(row[6]) && String(row[6]) !== studentId) {
      throw Object.assign(new Error('Another family already requested this item.'), { status: 409 });
    }
    row[5] = 'ClaimRequested';
    row[6] = studentId;
    row[7] = parentId;
    row[8] = claimNote || 'This is my child’s item';
    await updateRange(LOST_AND_FOUND_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);

    notifyOffice({
      title: 'Lost & Found claim',
      body: String(row[1] || 'Item') + ' — claim request',
      url: '/admin#/lostFound'
    }).catch(() => {});

    return parseRow(row);
  }
  throw Object.assign(new Error('Item not found.'), { status: 404 });
}

async function completeClaim(teacherId, itemId) {
  await ensureLostFoundSheet();
  itemId = String(itemId || '').trim();
  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== itemId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    if (String(row[5]) === 'Claimed') return parseRow(row);
    if (String(row[5]) !== 'ClaimRequested') {
      throw Object.assign(new Error('No claim request to complete.'), { status: 400 });
    }
    row[5] = 'Claimed';
    await updateRange(LOST_AND_FOUND_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);

    try {
      const push = require('./pushService');
      if (push.isPushEnabled() && row[7]) {
        await push.sendToParent(String(row[7]), {
          title: 'Lost & Found ready',
          body: (row[1] || 'Item') + ' — pickup confirmed',
          url: '/parent#/lostAndFound'
        }).catch(() => null);
      }
    } catch (_) { /* optional */ }

    return parseRow(row);
  }
  throw Object.assign(new Error('Item not found.'), { status: 404 });
}

async function rejectClaim(teacherId, itemId, payload) {
  await ensureLostFoundSheet();
  itemId = String(itemId || '').trim();
  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== itemId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    if (String(row[5]) !== 'ClaimRequested') {
      throw Object.assign(new Error('No claim request to reject.'), { status: 400 });
    }
    const parentId = String(row[7] || '');
    const title = String(row[1] || 'Item');
    row[5] = 'Unclaimed';
    row[6] = '';
    row[7] = '';
    row[8] = String((payload && payload.reason) || 'Claim rejected by staff').slice(0, 400);
    await updateRange(LOST_AND_FOUND_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);
    try {
      const push = require('./pushService');
      if (push.isPushEnabled() && parentId) {
        await push.sendToParent(parentId, {
          title: 'Lost & Found claim declined',
          body: title + ' — please contact the school if this is your item',
          url: '/parent#/lostAndFound'
        }).catch(() => null);
      }
    } catch (_) { /* optional */ }
    return parseRow(row);
  }
  throw Object.assign(new Error('Item not found.'), { status: 404 });
}

async function withdrawClaim(session, itemId) {
  await ensureLostFoundSheet();
  itemId = String(itemId || '').trim();
  const studentId = String(session.studentId || '').trim();
  const parentId = String(session.parentId || '').trim();
  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== itemId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    if (String(row[5]) !== 'ClaimRequested') {
      throw Object.assign(new Error('No active claim to withdraw.'), { status: 400 });
    }
    if (String(row[6]) !== studentId && String(row[7]) !== parentId) {
      throw Object.assign(new Error('Not your claim.'), { status: 403 });
    }
    row[5] = 'Unclaimed';
    row[6] = '';
    row[7] = '';
    row[8] = 'Claim withdrawn by parent';
    await updateRange(LOST_AND_FOUND_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);
    return parseRow(row);
  }
  throw Object.assign(new Error('Item not found.'), { status: 404 });
}

async function listForParent(session) {
  const items = await listItems({ excludeClaimed: true, skipCache: true });
  const studentId = String(session.studentId || '');
  return {
    items: items.map((it) => Object.assign({}, it, {
      isMine: it.claimedByStudentId === studentId,
      canClaim: it.status === 'Unclaimed',
      canWithdraw: it.status === 'ClaimRequested' && it.claimedByStudentId === studentId
    }))
  };
}

async function listForTeacher() {
  return listForBrowse();
}

async function listForBrowse() {
  const items = await listItems({ excludeClaimed: true, skipCache: true });
  return { items };
}

async function listForAdmin() {
  const items = await listItems({ skipCache: true });
  const enriched = [];
  for (const it of items) {
    enriched.push(Object.assign({}, it, {
      claimedByStudentName: it.claimedByStudentId
        ? await studentName(it.claimedByStudentId)
        : ''
    }));
  }
  return { items: enriched };
}

async function deleteItem(itemId) {
  await ensureLostFoundSheet();
  itemId = String(itemId || '').trim();
  const rows = await getSheetRows(LOST_AND_FOUND_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== itemId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    row[5] = 'Removed';
    await updateRange(LOST_AND_FOUND_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(LOST_AND_FOUND_SHEET);
    return parseRow(row);
  }
  throw Object.assign(new Error('Item not found.'), { status: 404 });
}

async function notifyOffice(payload) {
  try {
    const push = require('./pushService');
    if (!push.isPushEnabled()) return;
    const { getSheetRows } = require('../sheets');
    const { ADMIN_LIST_SHEET } = require('../config');
    const recipients = [];
    const adminRows = await getSheetRows(ADMIN_LIST_SHEET).catch(() => []);
    for (let i = 1; i < adminRows.length; i++) {
      if (adminRows[i][0]) recipients.push({ role: 'admin', userId: String(adminRows[i][0]) });
    }
    if (!recipients.length) return;
    await push.sendToRecipients(recipients, Object.assign({
      kind: 'lost_and_found',
      url: '/admin#/lostFound'
    }, payload || {}));
  } catch (_) { /* optional */ }
}

module.exports = {
  ensureLostFoundSheet,
  createItem,
  claimItem,
  completeClaim,
  rejectClaim,
  withdrawClaim,
  deleteItem,
  listForParent,
  listForTeacher,
  listForBrowse,
  listForAdmin,
  listItems
};
