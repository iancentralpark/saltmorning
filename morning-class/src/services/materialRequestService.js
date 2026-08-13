'use strict';

/**
 * Teaching material purchase requests — Salt Morning ops DB only.
 */

const { isOpsDbEnabled, table, query } = require('../db/pool');

const STATUSES = new Set(['requested', 'purchased', 'cancelled']);

function assertOps() {
  if (!isOpsDbEnabled()) {
    throw new Error('Ops database is not configured. Material requests need DATABASE_URL.');
  }
}

function newRequestId() {
  return 'MR' + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapRow(row) {
  if (!row) return null;
  return {
    requestId: row.request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name || '',
    classId: row.class_id || '',
    className: row.class_name || '',
    subject: row.subject || '',
    content: row.content || '',
    itemName: row.item_name || '',
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    totalPrice: Number(row.total_price) || 0,
    purchaseLink: row.purchase_link || '',
    status: row.status || 'requested',
    adminNote: row.admin_note || '',
    purchasedBy: row.purchased_by || '',
    purchasedAt: row.purchased_at || null
  };
}

async function createRequest(teacher, payload) {
  assertOps();
  const teacherId = String((teacher && teacher.teacherId) || '').trim();
  if (!teacherId) throw new Error('Teacher id is required.');

  const subject = String(payload.subject || '').trim();
  const content = String(payload.content || '').trim();
  const itemName = String(payload.itemName || '').trim();
  if (!subject) throw new Error('Subject is required.');
  if (!itemName) throw new Error('Item name is required.');
  if (!content) throw new Error('Content / reason is required.');

  const quantity = Math.max(0.01, toNum(payload.quantity, 1));
  const unitPrice = Math.max(0, toNum(payload.unitPrice, 0));
  let totalPrice = toNum(payload.totalPrice, NaN);
  if (!Number.isFinite(totalPrice)) totalPrice = Math.round(quantity * unitPrice * 100) / 100;
  totalPrice = Math.max(0, totalPrice);

  const requestId = newRequestId();
  const r = await query(
    'INSERT INTO ' + table('material_requests') +
      ' (request_id, teacher_id, teacher_name, class_id, class_name, subject, content,' +
      ' item_name, quantity, unit_price, total_price, purchase_link, status)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)' +
      ' RETURNING *',
    [
      requestId,
      teacherId,
      String((teacher && teacher.name) || teacherId),
      String(payload.classId || '').trim(),
      String(payload.className || '').trim(),
      subject,
      content,
      itemName,
      quantity,
      unitPrice,
      totalPrice,
      String(payload.purchaseLink || '').trim(),
      'requested'
    ]
  );
  const req = mapRow(r.rows[0]);
  notifyAdminsNewRequest(req).catch(() => {});
  return req;
}

async function listForTeacher(teacherId) {
  assertOps();
  const r = await query(
    'SELECT * FROM ' + table('material_requests') +
      ' WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT 200',
    [String(teacherId)]
  );
  return r.rows.map(mapRow);
}

async function listForAdmin(opts) {
  assertOps();
  opts = opts || {};
  const status = String(opts.status || '').trim();
  let sql = 'SELECT * FROM ' + table('material_requests');
  const params = [];
  if (status && STATUSES.has(status)) {
    params.push(status);
    sql += ' WHERE status = $1';
  }
  sql += ' ORDER BY' +
    " CASE status WHEN 'requested' THEN 0 WHEN 'purchased' THEN 1 ELSE 2 END," +
    ' created_at DESC LIMIT 300';
  const r = await query(sql, params);
  return r.rows.map(mapRow);
}

async function getRequest(requestId) {
  assertOps();
  const r = await query(
    'SELECT * FROM ' + table('material_requests') + ' WHERE request_id = $1',
    [String(requestId)]
  );
  return mapRow(r.rows[0]);
}

async function markPurchased(requestId, admin, note) {
  assertOps();
  const existing = await getRequest(requestId);
  if (!existing) throw new Error('Request not found.');
  if (existing.status === 'purchased') return existing;
  if (existing.status === 'cancelled') throw new Error('Cancelled requests cannot be marked purchased.');

  const r = await query(
    'UPDATE ' + table('material_requests') +
      ' SET status = $2, admin_note = $3, purchased_by = $4, purchased_at = now(), updated_at = now()' +
      ' WHERE request_id = $1 RETURNING *',
    [
      String(requestId),
      'purchased',
      String(note || existing.adminNote || '').trim(),
      String((admin && (admin.adminId || admin.principalId || admin.teacherId || admin.name)) || 'admin')
    ]
  );
  const req = mapRow(r.rows[0]);
  notifyTeacherStatus(req).catch(() => {});
  return req;
}

async function updateRequest(requestId, teacher, payload) {
  assertOps();
  const existing = await getRequest(requestId);
  if (!existing) throw new Error('Request not found.');
  if (existing.status !== 'requested') throw new Error('Only open requests can be edited.');
  if (String(existing.teacherId) !== String((teacher && teacher.teacherId) || '')) {
    throw new Error('You can only edit your own requests.');
  }

  const subject = String(payload.subject != null ? payload.subject : existing.subject).trim();
  const content = String(payload.content != null ? payload.content : existing.content).trim();
  const itemName = String(payload.itemName != null ? payload.itemName : existing.itemName).trim();
  if (!subject) throw new Error('Subject is required.');
  if (!itemName) throw new Error('Item name is required.');
  if (!content) throw new Error('Content / reason is required.');

  const quantity = Math.max(0.01, toNum(payload.quantity, existing.quantity || 1));
  const unitPrice = Math.max(0, toNum(payload.unitPrice, existing.unitPrice || 0));
  let totalPrice = toNum(payload.totalPrice, NaN);
  if (!Number.isFinite(totalPrice)) totalPrice = Math.round(quantity * unitPrice * 100) / 100;
  totalPrice = Math.max(0, totalPrice);

  const r = await query(
    'UPDATE ' + table('material_requests') +
      ' SET class_id = $2, class_name = $3, subject = $4, content = $5, item_name = $6,' +
      ' quantity = $7, unit_price = $8, total_price = $9, purchase_link = $10, updated_at = now()' +
      ' WHERE request_id = $1 RETURNING *',
    [
      String(requestId),
      String(payload.classId != null ? payload.classId : existing.classId || '').trim(),
      String(payload.className != null ? payload.className : existing.className || '').trim(),
      subject,
      content,
      itemName,
      quantity,
      unitPrice,
      totalPrice,
      String(payload.purchaseLink != null ? payload.purchaseLink : existing.purchaseLink || '').trim()
    ]
  );
  return mapRow(r.rows[0]);
}

async function unmarkPurchased(requestId) {
  assertOps();
  const existing = await getRequest(requestId);
  if (!existing) throw new Error('Request not found.');
  if (existing.status !== 'purchased') throw new Error('Only purchased requests can be reopened.');

  const r = await query(
    'UPDATE ' + table('material_requests') +
      ' SET status = $2, purchased_by = $3, purchased_at = NULL, updated_at = now()' +
      ' WHERE request_id = $1 RETURNING *',
    [String(requestId), 'requested', '']
  );
  return mapRow(r.rows[0]);
}

async function deleteRequest(requestId) {
  assertOps();
  const existing = await getRequest(requestId);
  if (!existing) throw new Error('Request not found.');
  await query(
    'DELETE FROM ' + table('material_requests') + ' WHERE request_id = $1',
    [String(requestId)]
  );
  return { requestId: existing.requestId, deleted: true };
}

async function cancelRequest(requestId, actor) {
  assertOps();
  const existing = await getRequest(requestId);
  if (!existing) throw new Error('Request not found.');
  if (existing.status === 'purchased') throw new Error('Purchased requests cannot be cancelled. Reopen or delete instead.');
  if (existing.status === 'cancelled') return existing;

  const isTeacher = actor && actor.role === 'teacher';
  if (isTeacher && String(existing.teacherId) !== String(actor.teacherId)) {
    throw new Error('You can only cancel your own requests.');
  }

  const r = await query(
    'UPDATE ' + table('material_requests') +
      ' SET status = $2, updated_at = now() WHERE request_id = $1 RETURNING *',
    [String(requestId), 'cancelled']
  );
  return mapRow(r.rows[0]);
}

async function notifyAdminsNewRequest(req) {
  try {
    const push = require('./pushService');
    if (!push.isPushEnabled()) return;
    const { getSheetRows } = require('../sheets');
    const { ADMIN_LIST_SHEET, TEACHER_LIST_SHEET } = require('../config');
    const recipients = [];
    const adminRows = await getSheetRows(ADMIN_LIST_SHEET).catch(() => []);
    for (let i = 1; i < adminRows.length; i++) {
      if (adminRows[i][0]) recipients.push({ role: 'admin', userId: String(adminRows[i][0]) });
    }
    const teachers = await getSheetRows(TEACHER_LIST_SHEET).catch(() => []);
    for (let i = 1; i < teachers.length; i++) {
      const staff = String(teachers[i][5] || teachers[i][6] || '').toLowerCase();
      if (/principal/.test(staff) && teachers[i][0]) {
        recipients.push({ role: 'admin', userId: String(teachers[i][0]) });
      }
    }
    await push.sendToRecipients(recipients, {
      title: 'Salt Morning · Material request',
      body: (req.teacherName || 'Teacher') + ': ' + (req.itemName || 'New request'),
      kind: 'material_request',
      url: '/admin#/materials'
    });
  } catch (e) {
    console.warn('[materials] admin push failed:', e.message);
  }
}

async function notifyTeacherStatus(req) {
  try {
    const push = require('./pushService');
    if (!push.isPushEnabled() || !req.teacherId) return;
    await push.sendToUser('teacher', req.teacherId, {
      title: 'Salt Morning · Material purchased',
      body: (req.itemName || 'Your request') + ' is marked purchased.',
      kind: 'material_request',
      url: '/teacher#/materials'
    });
  } catch (e) {
    console.warn('[materials] teacher push failed:', e.message);
  }
}

module.exports = {
  createRequest,
  listForTeacher,
  listForAdmin,
  getRequest,
  markPurchased,
  unmarkPurchased,
  updateRequest,
  deleteRequest,
  cancelRequest
};
