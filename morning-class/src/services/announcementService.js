const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ANNOUNCEMENTS_SHEET,
  PARENT_ANNOUNCEMENTS_SHEET,
  CLASS_LIST_SHEET
} = require('../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache
} = require('../sheets');

const HEADERS = [
  'AnnouncementID', 'Scope', 'Audience', 'ClassID', 'Title', 'Body',
  'LinkUrl', 'LinkLabel', 'ImagePath', 'AttachmentPath', 'AttachmentName',
  'PostedAt', 'PostedBy', 'PostedByRole', 'Active'
];

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'announcements');

const IMAGE_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};
const ATTACH_MIME = Object.assign({}, IMAGE_MIME, {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
  'application/zip': '.zip'
});

function newId() {
  return 'ann_' + crypto.randomBytes(5).toString('hex');
}

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function normalizeAudience(raw) {
  const v = String(raw || 'both').toLowerCase().trim();
  if (v === 'parent' || v === 'parents') return 'parent';
  if (v === 'student' || v === 'students') return 'student';
  return 'both';
}

function normalizeScope(raw) {
  return String(raw || 'school').toLowerCase() === 'class' ? 'class' : 'school';
}

function audienceIncludes(audience, role) {
  const a = normalizeAudience(audience);
  if (a === 'both') return true;
  if (role === 'parent') return a === 'parent';
  if (role === 'student') return a === 'student';
  return true;
}

async function ensureAnnouncementsSheet() {
  await ensureSheet(ANNOUNCEMENTS_SHEET, HEADERS);
}

function parseRow(row) {
  if (!row || !row[0]) return null;
  if (String(row[14] || 'true').trim().toLowerCase() === 'false') return null;
  return {
    announcementId: String(row[0]),
    scope: normalizeScope(row[1] || 'school'),
    audience: normalizeAudience(row[2] || 'both'),
    classId: String(row[3] || '').trim(),
    title: String(row[4] || ''),
    body: String(row[5] || ''),
    linkUrl: String(row[6] || '').trim(),
    linkLabel: String(row[7] || '').trim(),
    imagePath: String(row[8] || '').trim(),
    attachmentPath: String(row[9] || '').trim(),
    attachmentName: String(row[10] || '').trim(),
    postedAt: String(row[11] || ''),
    postedBy: String(row[12] || ''),
    postedByRole: String(row[13] || '')
  };
}

function toRow(rec) {
  return [
    rec.announcementId,
    rec.scope,
    rec.audience,
    rec.classId || '',
    rec.title,
    rec.body,
    rec.linkUrl || '',
    rec.linkLabel || '',
    rec.imagePath || '',
    rec.attachmentPath || '',
    rec.attachmentName || '',
    rec.postedAt,
    rec.postedBy,
    rec.postedByRole,
    rec.active === false ? 'false' : 'true'
  ];
}

async function listClassNameMap() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '').trim();
    if (id) map[id] = String(rows[i][1] || id);
  }
  return map;
}

async function listLegacyParentAnnouncements() {
  try {
    const rows = await getSheetRows(PARENT_ANNOUNCEMENTS_SHEET);
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][5] || '').trim().toLowerCase() === 'false') continue;
      if (!rows[i][0]) continue;
      out.push({
        announcementId: String(rows[i][0]),
        scope: 'school',
        audience: 'parent',
        classId: '',
        title: String(rows[i][1] || ''),
        body: String(rows[i][2] || ''),
        linkUrl: '',
        linkLabel: '',
        imagePath: '',
        attachmentPath: '',
        attachmentName: '',
        postedAt: String(rows[i][3] || ''),
        postedBy: String(rows[i][4] || ''),
        postedByRole: 'admin',
        legacy: true
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function listAllAnnouncements({ includeInactive } = {}) {
  await ensureAnnouncementsSheet();
  const rows = await getSheetRows(ANNOUNCEMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!includeInactive && String(rows[i][14] || 'true').trim().toLowerCase() === 'false') continue;
    const parsed = includeInactive
      ? {
          announcementId: String(rows[i][0] || ''),
          scope: normalizeScope(rows[i][1] || 'school'),
          audience: normalizeAudience(rows[i][2] || 'both'),
          classId: String(rows[i][3] || '').trim(),
          title: String(rows[i][4] || ''),
          body: String(rows[i][5] || ''),
          linkUrl: String(rows[i][6] || '').trim(),
          linkLabel: String(rows[i][7] || '').trim(),
          imagePath: String(rows[i][8] || '').trim(),
          attachmentPath: String(rows[i][9] || '').trim(),
          attachmentName: String(rows[i][10] || '').trim(),
          postedAt: String(rows[i][11] || ''),
          postedBy: String(rows[i][12] || ''),
          postedByRole: String(rows[i][13] || ''),
          active: String(rows[i][14] || 'true').trim().toLowerCase() !== 'false',
          _row: i + 1
        }
      : parseRow(rows[i]);
    if (parsed && parsed.announcementId) out.push(parsed);
  }
  return out;
}

/**
 * Viewer lists: school and/or class scoped announcements for a role.
 */
async function listAnnouncementsForViewer({ role, classId, scope }) {
  const names = await listClassNameMap();
  const modern = await listAllAnnouncements();
  let legacy = [];
  if (role === 'parent') legacy = await listLegacyParentAnnouncements();

  const merged = modern.concat(legacy).filter((a) => audienceIncludes(a.audience, role));
  const wantScope = scope ? normalizeScope(scope) : '';
  const cid = String(classId || '').trim();

  const filtered = merged.filter((a) => {
    if (wantScope && a.scope !== wantScope) return false;
    if (a.scope === 'school') return !wantScope || wantScope === 'school';
    // class-scoped: a viewer with no classId (not yet assigned to a class,
    // mid-transfer, or withdrawn) must never see every other class's
    // announcements — show none rather than everything.
    if (!cid) return false;
    return !a.classId || a.classId === '*' || a.classId === cid;
  });

  filtered.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  return filtered.map((a) => Object.assign({}, a, {
    className: a.classId ? (names[a.classId] || a.classId) : '',
    sourceLabel: a.scope === 'class' ? 'Class' : 'School'
  }));
}

async function listManagedAnnouncements({ role, teacherId, classId }) {
  const names = await listClassNameMap();
  const all = await listAllAnnouncements({ includeInactive: false });
  let list = all;
  if (role === 'teacher') {
    const allowed = Array.isArray(classId) ? classId.map(String) : null;
    list = all.filter((a) => {
      if (a.scope !== 'class') return false;
      if (allowed) return allowed.includes(a.classId);
      return true;
    });
  } else if (classId) {
    list = all.filter((a) => a.scope === 'school' || a.classId === String(classId) || !a.classId);
  }
  list.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  return list.map((a) => Object.assign({}, a, {
    className: a.classId ? (names[a.classId] || a.classId) : 'All classes',
    sourceLabel: a.scope === 'class' ? 'Class' : 'School'
  }));
}

function saveUploadFile(announcementId, file, kind) {
  if (!file || !file.buffer) return null;
  const map = kind === 'image' ? IMAGE_MIME : ATTACH_MIME;
  const ext = map[file.mimetype];
  if (!ext) {
    throw new Error(kind === 'image'
      ? 'Image must be JPEG, PNG, WebP, or GIF.'
      : 'Attachment type not allowed.');
  }
  ensureUploadDir();
  const safeId = String(announcementId).replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = safeId + '_' + kind + '_' + Date.now() + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return {
    path: '/uploads/announcements/' + filename,
    name: String(file.originalname || filename).slice(0, 180)
  };
}

async function createAnnouncement(payload, files, actor) {
  await ensureAnnouncementsSheet();
  const scope = normalizeScope(payload.scope);
  const audience = normalizeAudience(payload.audience);
  const classId = scope === 'class' ? String(payload.classId || '').trim() : '';
  if (scope === 'class' && !classId) throw new Error('Class is required for class announcements.');
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  if (!title) throw new Error('Title is required.');
  if (!body && !(files && (files.image || files.attachment))) {
    throw new Error('Body or an attachment is required.');
  }

  const id = newId();
  let imagePath = '';
  let attachmentPath = '';
  let attachmentName = '';
  if (files && files.image) {
    const saved = saveUploadFile(id, files.image, 'image');
    if (saved) imagePath = saved.path;
  }
  if (files && files.attachment) {
    const saved = saveUploadFile(id, files.attachment, 'attachment');
    if (saved) {
      attachmentPath = saved.path;
      attachmentName = saved.name;
    }
  }

  const rec = {
    announcementId: id,
    scope,
    audience,
    classId,
    title,
    body,
    linkUrl: String(payload.linkUrl || '').trim(),
    linkLabel: String(payload.linkLabel || '').trim(),
    imagePath,
    attachmentPath,
    attachmentName,
    postedAt: new Date().toISOString(),
    postedBy: String((actor && (actor.name || actor.id)) || 'Staff'),
    postedByRole: String((actor && actor.role) || 'admin'),
    active: true
  };
  await appendRows(ANNOUNCEMENTS_SHEET, [toRow(rec)]);
  invalidateSheetRowsCache(ANNOUNCEMENTS_SHEET);
  try {
    const { notifyAnnouncement } = require('./pushService');
    notifyAnnouncement(rec).catch((e) =>
      console.warn('[announcement] push failed:', e.message)
    );
  } catch (_) { /* ignore */ }
  return rec;
}

async function updateAnnouncement(announcementId, payload, files, actor) {
  await ensureAnnouncementsSheet();
  announcementId = String(announcementId || '').trim();
  if (!announcementId) throw new Error('Announcement ID required.');
  const rows = await getSheetRows(ANNOUNCEMENTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === announcementId) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error('Announcement not found.');
  if (actor && actor.role === 'teacher') {
    const role = String(rows[found - 1][13] || '');
    if (role !== 'teacher') throw new Error('Teachers can only edit their own class posts.');
  }
  const existing = rows[found - 1].slice();
  while (existing.length < HEADERS.length) existing.push('');
  const scope = payload.scope != null ? normalizeScope(payload.scope) : String(existing[1] || 'school');
  const audience = payload.audience != null ? normalizeAudience(payload.audience) : String(existing[2] || 'all');
  const classId = scope === 'class'
    ? String(payload.classId != null ? payload.classId : existing[3] || '').trim()
    : '';
  if (scope === 'class' && !classId) throw new Error('Class is required for class announcements.');
  const title = payload.title != null ? String(payload.title || '').trim() : String(existing[4] || '');
  const body = payload.body != null ? String(payload.body || '').trim() : String(existing[5] || '');
  if (!title) throw new Error('Title is required.');

  let imagePath = String(existing[8] || '');
  let attachmentPath = String(existing[9] || '');
  let attachmentName = String(existing[10] || '');
  if (files && files.image) {
    const saved = saveUploadFile(announcementId, files.image, 'image');
    if (saved) imagePath = saved.path;
  }
  if (files && files.attachment) {
    const saved = saveUploadFile(announcementId, files.attachment, 'attachment');
    if (saved) {
      attachmentPath = saved.path;
      attachmentName = saved.name;
    }
  }

  const rec = {
    announcementId,
    scope,
    audience,
    classId,
    title,
    body,
    linkUrl: payload.linkUrl != null ? String(payload.linkUrl || '').trim() : String(existing[6] || ''),
    linkLabel: payload.linkLabel != null ? String(payload.linkLabel || '').trim() : String(existing[7] || ''),
    imagePath,
    attachmentPath,
    attachmentName,
    postedAt: String(existing[11] || new Date().toISOString()),
    postedBy: String(existing[12] || ((actor && (actor.name || actor.id)) || 'Staff')),
    postedByRole: String(existing[13] || ((actor && actor.role) || 'admin')),
    active: String(existing[14] || 'true') !== 'false'
  };
  await updateRange(ANNOUNCEMENTS_SHEET, `A${found}:O${found}`, [toRow(rec)]);
  invalidateSheetRowsCache(ANNOUNCEMENTS_SHEET);
  return rec;
}

async function deactivateAnnouncement(announcementId, opts) {
  await ensureAnnouncementsSheet();
  announcementId = String(announcementId || '').trim();
  if (!announcementId) throw new Error('Announcement ID required.');
  const rows = await getSheetRows(ANNOUNCEMENTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === announcementId) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error('Announcement not found.');
  if (opts && opts.teacherId) {
    const role = String(rows[found - 1][13] || '');
    if (role !== 'teacher') throw new Error('Teachers can only remove their own class posts.');
  }
  const row = rows[found - 1].slice();
  while (row.length < HEADERS.length) row.push('');
  row[14] = 'false';
  await updateRange(ANNOUNCEMENTS_SHEET, `A${found}:O${found}`, [row.slice(0, HEADERS.length)]);
  invalidateSheetRowsCache(ANNOUNCEMENTS_SHEET);
  return { deactivated: true, announcementId };
}

/** Backward-compatible parent list used by overview/newsfeed. */
async function listParentAnnouncements(classId) {
  return listAnnouncementsForViewer({
    role: 'parent',
    classId: classId || '',
    scope: ''
  });
}

module.exports = {
  HEADERS,
  ensureAnnouncementsSheet,
  listAnnouncementsForViewer,
  listManagedAnnouncements,
  listParentAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deactivateAnnouncement,
  normalizeAudience,
  normalizeScope,
  IMAGE_MIME,
  ATTACH_MIME
};
