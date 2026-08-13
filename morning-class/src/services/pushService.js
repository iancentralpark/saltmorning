'use strict';

/**
 * Web Push for all Salt Morning roles (student / parent / teacher / admin).
 * Subscriptions live in Salt Morning ops DB only — never Mr.Park tables.
 */

const webpush = require('web-push');
const { isOpsDbEnabled, table, query } = require('../db/pool');
const { getSheetRows } = require('../sheets');
const {
  STUDENT_LIST_SHEET,
  TEACHER_LIST_SHEET,
  ADMIN_LIST_SHEET,
  PARENT_STUDENTS_SHEET
} = require('../config');

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

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'principal' || r === 'staff') return 'admin';
  if (r === 'student' || r === 'parent' || r === 'teacher' || r === 'admin') return r;
  return '';
}

function portalUrl(role) {
  if (role === 'student') return '/student';
  if (role === 'parent') return '/parent';
  if (role === 'teacher') return '/teacher';
  return '/admin';
}

function userIdFromSession(session) {
  if (!session) return '';
  const role = normalizeRole(session.role);
  if (role === 'parent') return String(session.parentId || '');
  if (role === 'student') return String(session.studentId || '');
  if (role === 'teacher') return String(session.teacherId || '');
  if (role === 'admin') {
    return String(session.adminId || session.principalId || session.teacherId || '');
  }
  return '';
}

async function saveSubscription(role, userId, subscription, userAgent) {
  if (!ensureWebPush()) throw new Error('Web push is not configured.');
  role = normalizeRole(role);
  userId = String(userId || '').trim();
  if (!role || !userId) throw new Error('Role and user id are required.');
  const endpoint = subscription && subscription.endpoint;
  const keys = subscription && subscription.keys;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new Error('Invalid push subscription.');
  }
  await query(
    'INSERT INTO ' + table('push_subscriptions') +
      ' (parent_id, role, user_id, endpoint, p256dh, auth, user_agent, updated_at)' +
      ' VALUES ($1, $2, $3, $4, $5, $6, $7, now())' +
      ' ON CONFLICT (endpoint) DO UPDATE SET' +
      ' parent_id = EXCLUDED.parent_id, role = EXCLUDED.role, user_id = EXCLUDED.user_id,' +
      ' p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,' +
      ' user_agent = EXCLUDED.user_agent, updated_at = now()',
    [
      role === 'parent' ? userId : '',
      role,
      userId,
      endpoint,
      keys.p256dh,
      keys.auth,
      String(userAgent || '').slice(0, 240)
    ]
  );
  return { ok: true };
}

async function removeSubscription(role, userId, endpoint) {
  if (!isOpsDbEnabled()) return { ok: true };
  role = normalizeRole(role);
  userId = String(userId || '').trim();
  endpoint = String(endpoint || '').trim();
  if (endpoint) {
    await query(
      'DELETE FROM ' + table('push_subscriptions') +
        ' WHERE endpoint = $1 AND role = $2 AND user_id = $3',
      [endpoint, role, userId]
    );
  } else {
    await query(
      'DELETE FROM ' + table('push_subscriptions') + ' WHERE role = $1 AND user_id = $2',
      [role, userId]
    );
  }
  return { ok: true };
}

async function listSubscriptionsForUser(role, userId) {
  if (!isOpsDbEnabled()) return [];
  role = normalizeRole(role);
  userId = String(userId || '').trim();
  if (!role || !userId) return [];
  const r = await query(
    'SELECT endpoint, p256dh, auth FROM ' + table('push_subscriptions') +
      ' WHERE role = $1 AND user_id = $2',
    [role, userId]
  );
  return r.rows;
}

async function sendToUser(role, userId, payload) {
  if (!ensureWebPush()) return { sent: 0 };
  role = normalizeRole(role);
  const subs = await listSubscriptionsForUser(role, userId);
  let sent = 0;
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
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

async function sendToRecipients(recipients, payload) {
  const seen = new Set();
  let sent = 0;
  for (const r of recipients || []) {
    const role = normalizeRole(r.role);
    const userId = String(r.userId || '').trim();
    if (!role || !userId) continue;
    const key = role + ':' + userId;
    if (seen.has(key)) continue;
    seen.add(key);
    const out = await sendToUser(role, userId, Object.assign({}, payload || {}, {
      url: (payload && payload.url) || portalUrl(role)
    }));
    sent += out.sent || 0;
  }
  return { sent, users: seen.size };
}

/* ── Directory helpers (Sheets master data; Salt Morning only) ── */

async function listEnrolledStudents(classId) {
  const rows = await getSheetRows(STUDENT_LIST_SHEET).catch(() => []);
  const out = [];
  const want = classId ? String(classId) : '';
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][3] || '') !== 'Enrolled') continue;
    if (want && String(rows[i][2] || '') !== want) continue;
    out.push({ studentId: String(rows[i][0]), classId: String(rows[i][2] || '') });
  }
  return out;
}

async function listParentsForStudent(studentId) {
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET).catch(() => []);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === String(studentId)) out.push(String(rows[i][0]));
  }
  return out;
}

async function listParentsForClass(classId) {
  const students = await listEnrolledStudents(classId);
  const ids = new Set();
  for (const s of students) {
    const parents = await listParentsForStudent(s.studentId);
    parents.forEach((p) => ids.add(p));
  }
  return Array.from(ids);
}

async function listAllParents() {
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET).catch(() => []);
  const ids = new Set();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) ids.add(String(rows[i][0]));
  }
  return Array.from(ids);
}

async function listTeachersForClass(classId) {
  const rows = await getSheetRows(TEACHER_LIST_SHEET).catch(() => []);
  const out = [];
  const want = String(classId || '');
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const tid = String(rows[i][0]);
    const homeroom = String(rows[i][4] || '').trim();
    if (want && homeroom === want) {
      out.push(tid);
      continue;
    }
    // assigned classes may live in other sheets; include all teachers if no class filter
    if (!want) out.push(tid);
  }
  if (want) {
    try {
      const { listAdminClassAssignments } = require('./subjectAssignmentService');
      const assignments = await listAdminClassAssignments().catch(() => []);
      (assignments || []).forEach((a) => {
        if (String(a.classId) === want && a.teacherId) out.push(String(a.teacherId));
      });
    } catch (_) { /* optional */ }
  }
  return Array.from(new Set(out));
}

async function listAllTeachers() {
  const rows = await getSheetRows(TEACHER_LIST_SHEET).catch(() => []);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) out.push(String(rows[i][0]));
  }
  return out;
}

async function listAllAdmins() {
  const rows = await getSheetRows(ADMIN_LIST_SHEET).catch(() => []);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) out.push(String(rows[i][0]));
  }
  // Principals stored as teachers with staffRole
  const teachers = await getSheetRows(TEACHER_LIST_SHEET).catch(() => []);
  for (let i = 1; i < teachers.length; i++) {
    const staff = String(teachers[i][5] || teachers[i][6] || '').toLowerCase();
    if (/principal/.test(staff) && teachers[i][0]) out.push(String(teachers[i][0]));
  }
  return Array.from(new Set(out));
}

/* ── Event notifiers ─────────────────────────────────────────── */

async function notifyMessageRecipients(msg) {
  if (!msg || !ensureWebPush()) return;
  const recipients = [];
  const aud = String(msg.targetAudience || '');
  const threadId = String(msg.threadId || '');
  const studentId = String(msg.studentId || '');

  if (aud === 'family') {
    if (studentId) {
      recipients.push({ role: 'student', userId: studentId });
      (await listParentsForStudent(studentId)).forEach((pid) => {
        recipients.push({ role: 'parent', userId: pid });
      });
    }
    const padm = threadId.match(/^padm_(.+)$/);
    if (padm) recipients.push({ role: 'parent', userId: padm[1] });
  } else if (aud === 'teacher') {
    const pt = threadId.match(/^pt_(.+)__(.+)$/);
    if (pt) {
      recipients.push({ role: 'teacher', userId: pt[2] });
    } else if (studentId) {
      const stRows = await getSheetRows(STUDENT_LIST_SHEET).catch(() => []);
      let classId = '';
      for (let i = 1; i < stRows.length; i++) {
        if (String(stRows[i][0]) === studentId) {
          classId = String(stRows[i][2] || '');
          break;
        }
      }
      const teachers = classId
        ? await listTeachersForClass(classId)
        : await listAllTeachers();
      teachers.forEach((tid) => recipients.push({ role: 'teacher', userId: tid }));
    } else {
      (await listAllTeachers()).forEach((tid) => recipients.push({ role: 'teacher', userId: tid }));
    }
  } else if (aud === 'admin') {
    (await listAllAdmins()).forEach((aid) => recipients.push({ role: 'admin', userId: aid }));
  }

  // Don't notify the sender
  const senderRole = normalizeRole(msg.senderRole);
  const senderId = String(msg.senderId || '');
  const filtered = recipients.filter((r) => !(r.role === senderRole && r.userId === senderId));

  await sendToRecipients(filtered, {
    title: 'Salt Morning · Message',
    body: (msg.senderName ? msg.senderName + ': ' : '') + String(msg.body || '').slice(0, 120),
    url: null, // filled per-role in sendToRecipients default; override below
    threadId: msg.threadId,
    kind: 'messenger'
  });
}

async function notifyAnnouncement(ann) {
  if (!ann || !ensureWebPush()) return;
  const audience = String(ann.audience || 'both');
  const scope = String(ann.scope || 'school');
  const classId = String(ann.classId || '');
  const recipients = [];

  const wantParent = audience === 'parent' || audience === 'both';
  const wantStudent = audience === 'student' || audience === 'both';

  if (wantParent) {
    const parents = scope === 'class' && classId
      ? await listParentsForClass(classId)
      : await listAllParents();
    parents.forEach((pid) => recipients.push({ role: 'parent', userId: pid }));
  }
  if (wantStudent) {
    const students = await listEnrolledStudents(scope === 'class' ? classId : '');
    students.forEach((s) => recipients.push({ role: 'student', userId: s.studentId }));
  }
  // Teachers also get class/school announcements as FYI
  if (scope === 'class' && classId) {
    (await listTeachersForClass(classId)).forEach((tid) => {
      recipients.push({ role: 'teacher', userId: tid });
    });
  } else {
    (await listAllTeachers()).forEach((tid) => recipients.push({ role: 'teacher', userId: tid }));
  }

  await sendToRecipients(recipients, {
    title: 'Salt Morning · Announcement',
    body: String(ann.title || 'New announcement').slice(0, 140),
    kind: 'announcement'
  });
}

async function notifyHomeworkPosted(classId, title) {
  if (!ensureWebPush()) return;
  const recipients = [];
  const students = await listEnrolledStudents(classId);
  students.forEach((s) => recipients.push({ role: 'student', userId: s.studentId }));
  (await listParentsForClass(classId)).forEach((pid) => {
    recipients.push({ role: 'parent', userId: pid });
  });
  await sendToRecipients(recipients, {
    title: 'Salt Morning · Homework',
    body: String(title || 'New homework').slice(0, 140),
    kind: 'homework'
  });
}

async function notifyReportCardShared(studentId, term) {
  if (!ensureWebPush()) return;
  const recipients = (await listParentsForStudent(studentId)).map((pid) => ({
    role: 'parent',
    userId: pid
  }));
  await sendToRecipients(recipients, {
    title: 'Salt Morning · Report card',
    body: 'Report card shared' + (term ? ' (' + term + ')' : ''),
    kind: 'reportcard'
  });
}

/** @deprecated alias */
async function notifyParentsNewMessage(msg) {
  return notifyMessageRecipients(msg);
}

async function sendToParent(parentId, payload) {
  return sendToUser('parent', parentId, payload);
}

module.exports = {
  isPushEnabled,
  getPublicKey,
  normalizeRole,
  userIdFromSession,
  saveSubscription,
  removeSubscription,
  sendToUser,
  sendToParent,
  sendToRecipients,
  notifyMessageRecipients,
  notifyParentsNewMessage,
  notifyAnnouncement,
  notifyHomeworkPosted,
  notifyReportCardShared
};
