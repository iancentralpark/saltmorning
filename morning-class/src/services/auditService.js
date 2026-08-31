'use strict';

const crypto = require('crypto');
const {
  getSheetRows,
  appendRows,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');
const { isOpsDbEnabled, table, query } = require('../db/pool');

const AUDIT_SHEET = 'Audit_Log';
const HEADERS = [
  'LogID', 'CreatedAt', 'ActorRole', 'ActorId', 'ActorName',
  'Action', 'EntityType', 'EntityId', 'Detail'
];

function newId() {
  return 'aud_' + crypto.randomBytes(5).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureAuditSheet() {
  await ensureSheet(AUDIT_SHEET, HEADERS);
}

async function writeAudit({
  actorRole,
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  detail
} = {}) {
  const row = {
    logId: newId(),
    createdAt: nowIso(),
    actorRole: String(actorRole || ''),
    actorId: String(actorId || ''),
    actorName: String(actorName || ''),
    action: String(action || ''),
    entityType: String(entityType || ''),
    entityId: String(entityId || ''),
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {})
  };

  try {
    if (isOpsDbEnabled()) {
      await query(
        'INSERT INTO ' + table('audit_log') +
          ' (log_id, created_at, actor_role, actor_id, actor_name, action, entity_type, entity_id, detail)' +
          ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          row.logId, row.createdAt, row.actorRole, row.actorId, row.actorName,
          row.action, row.entityType, row.entityId, row.detail
        ]
      );
      return row;
    }
  } catch (e) {
    console.warn('[audit] db write failed, falling back to sheet:', e.message || e);
  }

  try {
    await ensureAuditSheet();
    await appendRows(AUDIT_SHEET, [[
      row.logId, row.createdAt, row.actorRole, row.actorId, row.actorName,
      row.action, row.entityType, row.entityId, row.detail
    ]]);
    invalidateSheetRowsCache(AUDIT_SHEET);
  } catch (e) {
    console.warn('[audit] sheet write failed:', e.message || e);
  }
  return row;
}

function writeAuditFromSession(session, action, entityType, entityId, detail) {
  if (!session) return Promise.resolve(null);
  const role = String(session.role || '');
  const id = session.adminId || session.teacherId || session.parentId ||
    session.studentId || session.principalId || '';
  return writeAudit({
    actorRole: role,
    actorId: id,
    actorName: session.name || '',
    action,
    entityType,
    entityId,
    detail
  }).catch(() => null);
}

async function listAudit({ limit, action, entityType, actorId } = {}) {
  const lim = Math.min(Number(limit) || 200, 500);
  try {
    if (isOpsDbEnabled()) {
      const clauses = [];
      const params = [];
      if (action) {
        params.push(String(action));
        clauses.push('action = $' + params.length);
      }
      if (entityType) {
        params.push(String(entityType));
        clauses.push('entity_type = $' + params.length);
      }
      if (actorId) {
        params.push(String(actorId));
        clauses.push('actor_id = $' + params.length);
      }
      params.push(lim);
      const where = clauses.length ? (' WHERE ' + clauses.join(' AND ')) : '';
      const { rows } = await query(
        'SELECT log_id, created_at, actor_role, actor_id, actor_name, action, entity_type, entity_id, detail' +
          ' FROM ' + table('audit_log') + where +
          ' ORDER BY created_at DESC LIMIT $' + params.length,
        params
      );
      return {
        entries: (rows || []).map((r) => ({
          logId: r.log_id,
          createdAt: r.created_at,
          actorRole: r.actor_role,
          actorId: r.actor_id,
          actorName: r.actor_name,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          detail: r.detail
        }))
      };
    }
  } catch (e) {
    console.warn('[audit] db list failed:', e.message || e);
  }

  await ensureAuditSheet();
  const rows = await getSheetRows(AUDIT_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const entry = {
      logId: String(rows[i][0]),
      createdAt: String(rows[i][1] || ''),
      actorRole: String(rows[i][2] || ''),
      actorId: String(rows[i][3] || ''),
      actorName: String(rows[i][4] || ''),
      action: String(rows[i][5] || ''),
      entityType: String(rows[i][6] || ''),
      entityId: String(rows[i][7] || ''),
      detail: String(rows[i][8] || '')
    };
    if (action && entry.action !== String(action)) continue;
    if (entityType && entry.entityType !== String(entityType)) continue;
    if (actorId && entry.actorId !== String(actorId)) continue;
    out.push(entry);
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { entries: out.slice(0, lim) };
}

module.exports = {
  AUDIT_SHEET,
  ensureAuditSheet,
  writeAudit,
  writeAuditFromSession,
  listAudit
};
