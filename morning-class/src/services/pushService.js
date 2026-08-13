'use strict';

/**
 * Web Push for Salt Morning parents only.
 * Subscriptions stored in Salt Morning ops DB (never Mr.Park).
 */

const webpush = require('web-push');
const { isOpsDbEnabled, table, query } = require('../db/pool');

let configured = false;

function isPushEnabled() {
  return !!(
    isOpsDbEnabled() &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  );
}

function ensureWebPush() {
  if (configured || !isPushEnabled()) return isPushEnabled();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@saltmorning.study',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

async function saveSubscription(parentId, subscription, userAgent) {
  if (!ensureWebPush()) throw new Error('Web push is not configured.');
  parentId = String(parentId || '').trim();
  if (!parentId) throw new Error('Parent id required.');
  const endpoint = subscription && subscription.endpoint;
  const keys = subscription && subscription.keys;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new Error('Invalid push subscription.');
  }
  await query(
    'INSERT INTO ' + table('push_subscriptions') +
      ' (parent_id, endpoint, p256dh, auth, user_agent, updated_at)' +
      ' VALUES ($1, $2, $3, $4, $5, now())' +
      ' ON CONFLICT (endpoint) DO UPDATE SET' +
      ' parent_id = EXCLUDED.parent_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,' +
      ' user_agent = EXCLUDED.user_agent, updated_at = now()',
    [parentId, endpoint, keys.p256dh, keys.auth, String(userAgent || '').slice(0, 240)]
  );
  return { ok: true };
}

async function removeSubscription(parentId, endpoint) {
  if (!isOpsDbEnabled()) return { ok: true };
  parentId = String(parentId || '').trim();
  endpoint = String(endpoint || '').trim();
  if (endpoint) {
    await query(
      'DELETE FROM ' + table('push_subscriptions') + ' WHERE endpoint = $1 AND parent_id = $2',
      [endpoint, parentId]
    );
  } else {
    await query(
      'DELETE FROM ' + table('push_subscriptions') + ' WHERE parent_id = $1',
      [parentId]
    );
  }
  return { ok: true };
}

async function listSubscriptionsForParent(parentId) {
  if (!isOpsDbEnabled()) return [];
  const r = await query(
    'SELECT endpoint, p256dh, auth FROM ' + table('push_subscriptions') + ' WHERE parent_id = $1',
    [String(parentId)]
  );
  return r.rows;
}

async function sendToParent(parentId, payload) {
  if (!ensureWebPush()) return { sent: 0 };
  const subs = await listSubscriptionsForParent(parentId);
  let sent = 0;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        },
        body
      );
      sent += 1;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await query(
          'DELETE FROM ' + table('push_subscriptions') + ' WHERE endpoint = $1',
          [sub.endpoint]
        );
      } else {
        console.warn('[push] send failed:', e.message);
      }
    }
  }
  return { sent };
}

/**
 * Notify parents linked to a messenger message (family audience).
 */
async function notifyParentsNewMessage(msg) {
  if (!msg || msg.targetAudience !== 'family') return;
  if (!ensureWebPush()) return;

  const parentIds = new Set();
  // parent_admin thread: padm_{parentId}
  const padm = String(msg.threadId || '').match(/^padm_(.+)$/);
  if (padm) parentIds.add(padm[1]);

  // parent_teacher / student threads: resolve via Parent_Students sheet
  if (!parentIds.size && msg.studentId) {
    try {
      const { getSheetRows } = require('../sheets');
      const { PARENT_STUDENTS_SHEET } = require('../config');
      const rows = await getSheetRows(PARENT_STUDENTS_SHEET).catch(() => []);
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]) === String(msg.studentId)) {
          parentIds.add(String(rows[i][0]));
        }
      }
    } catch (_) { /* ignore */ }
  }

  const title = 'Salt Morning';
  const body = (msg.senderName ? msg.senderName + ': ' : '') + String(msg.body || '').slice(0, 120);
  for (const pid of parentIds) {
    await sendToParent(pid, {
      title,
      body,
      url: '/parent',
      threadId: msg.threadId
    });
  }
}

module.exports = {
  isPushEnabled,
  getPublicKey,
  saveSubscription,
  removeSubscription,
  sendToParent,
  notifyParentsNewMessage
};
