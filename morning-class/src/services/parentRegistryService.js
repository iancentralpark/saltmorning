const crypto = require('crypto');
const {
  PARENT_LIST_SHEET,
  PARENT_STUDENTS_SHEET,
  STUDENT_LIST_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const LINK_HEADERS = [
  'LinkID', 'ParentID', 'StudentID', 'Relationship', 'IsPrimary', 'LinkedAt'
];

const PARENT_HEADERS = [
  'ParentID', 'StudentID', 'Name', 'LoginID', 'LoginPassword', 'Phone', 'Email'
];

function isoNow() {
  return new Date().toISOString();
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

let linksReady = false;
let linksReadyInFlight = null;

async function ensureParentStudentsSheet() {
  if (linksReady) return;
  if (linksReadyInFlight) return linksReadyInFlight;
  linksReadyInFlight = (async () => {
    await ensureSheet(PARENT_STUDENTS_SHEET, LINK_HEADERS);
    try {
      const rows = await getSheetRows(PARENT_STUDENTS_SHEET);
      const header = rows[0] || [];
      if (String(header[0] || '') !== 'LinkID') {
        await updateRange(PARENT_STUDENTS_SHEET, 'A1:F1', [LINK_HEADERS]);
      }
    } catch (_) { /* best effort */ }
    await migrateLegacyParentLinks();
    linksReady = true;
    linksReadyInFlight = null;
  })();
  return linksReadyInFlight;
}

/**
 * Copy Parent_List.StudentID (col B) into Parent_Students when missing.
 */
async function migrateLegacyParentLinks() {
  const [parentRows, linkRows] = await Promise.all([
    getSheetRows(PARENT_LIST_SHEET).catch(() => []),
    getSheetRows(PARENT_STUDENTS_SHEET).catch(() => [])
  ]);
  const existing = new Set();
  for (let i = 1; i < (linkRows || []).length; i++) {
    const pid = String(linkRows[i][1] || '').trim();
    const sid = String(linkRows[i][2] || '').trim();
    if (pid && sid) existing.add(pid + '||' + sid);
  }
  const toAdd = [];
  for (let i = 1; i < (parentRows || []).length; i++) {
    const parentId = String(parentRows[i][0] || '').trim();
    const studentId = String(parentRows[i][1] || '').trim();
    if (!parentId || !studentId) continue;
    const key = parentId + '||' + studentId;
    if (existing.has(key)) continue;
    toAdd.push([
      newId('PL'),
      parentId,
      studentId,
      'Guardian',
      'true',
      isoNow()
    ]);
    existing.add(key);
  }
  if (toAdd.length) {
    await appendRows(PARENT_STUDENTS_SHEET, toAdd);
    invalidateSheetRowsCache(PARENT_STUDENTS_SHEET);
  }
}

async function getStudentMetaMap() {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][0] || '');
    if (!id) continue;
    map[id] = {
      studentId: id,
      name: String(rows[i][1] || ''),
      classId: String(rows[i][2] || ''),
      status: String(rows[i][3] || '')
    };
  }
  return map;
}

async function listLinksForParent(parentId) {
  parentId = String(parentId || '').trim();
  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim() !== parentId) continue;
    const studentId = String(rows[i][2] || '').trim();
    if (!studentId) continue;
    out.push({
      linkId: String(rows[i][0] || ''),
      parentId,
      studentId,
      relationship: String(rows[i][3] || 'Guardian'),
      isPrimary: String(rows[i][4] || '').toLowerCase() === 'true',
      linkedAt: String(rows[i][5] || '')
    });
  }
  return out;
}

async function listLinksForStudent(studentId) {
  studentId = String(studentId || '').trim();
  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2] || '').trim() !== studentId) continue;
    const parentId = String(rows[i][1] || '').trim();
    if (!parentId) continue;
    out.push({
      linkId: String(rows[i][0] || ''),
      parentId,
      studentId,
      relationship: String(rows[i][3] || 'Guardian'),
      isPrimary: String(rows[i][4] || '').toLowerCase() === 'true',
      linkedAt: String(rows[i][5] || '')
    });
  }
  return out;
}

async function listChildrenForParent(parentId) {
  const [links, meta] = await Promise.all([
    listLinksForParent(parentId),
    getStudentMetaMap()
  ]);
  const children = links.map((link) => {
    const st = meta[link.studentId] || {};
    return {
      studentId: link.studentId,
      name: st.name || link.studentId,
      classId: st.classId || '',
      status: st.status || '',
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      linkId: link.linkId
    };
  }).filter((c) => c.studentId);
  children.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return children;
}

async function parentHasStudent(parentId, studentId) {
  const links = await listLinksForParent(parentId);
  return links.some((l) => l.studentId === String(studentId));
}

function pickActiveChild(children, preferredStudentId) {
  if (!children || !children.length) return null;
  const pref = String(preferredStudentId || '').trim();
  if (pref) {
    const hit = children.find((c) => c.studentId === pref);
    if (hit) return hit;
  }
  return children.find((c) => c.isPrimary) || children[0];
}

async function findParentByLogin(loginId) {
  loginId = String(loginId || '').trim();
  const rows = await getSheetRows(PARENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][3] || '').trim() !== loginId) continue;
    return {
      parentId: String(rows[i][0] || ''),
      legacyStudentId: String(rows[i][1] || '').trim(),
      name: String(rows[i][2] || ''),
      loginId: String(rows[i][3] || ''),
      password: String(rows[i][4] || ''),
      phone: String(rows[i][5] || ''),
      email: String(rows[i][6] || ''),
      rowIndex: i + 1
    };
  }
  return null;
}

async function getParentRecord(parentId) {
  parentId = String(parentId || '').trim();
  const rows = await getSheetRows(PARENT_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') !== parentId) continue;
    return {
      parentId,
      legacyStudentId: String(rows[i][1] || '').trim(),
      name: String(rows[i][2] || ''),
      loginId: String(rows[i][3] || ''),
      phone: String(rows[i][5] || ''),
      email: String(rows[i][6] || ''),
      hasPassword: Boolean(String(rows[i][4] || '').trim()),
      rowIndex: i + 1
    };
  }
  return null;
}

async function listParents(options) {
  options = options || {};
  const q = String(options.q || '').trim().toLowerCase();
  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_LIST_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const parentId = String(rows[i][0] || '').trim();
    if (!parentId) continue;
    const rec = {
      parentId,
      name: String(rows[i][2] || ''),
      loginId: String(rows[i][3] || ''),
      phone: String(rows[i][5] || ''),
      email: String(rows[i][6] || '')
    };
    if (q) {
      const hay = [rec.parentId, rec.name, rec.loginId, rec.phone, rec.email].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(rec);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function saveParentAccount(payload) {
  const parentId = String(payload.parentId || '').trim() || newId('P');
  const name = String(payload.name || '').trim();
  const loginId = String(payload.loginId || '').trim();
  const password = String(payload.password || '').trim();
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  if (!name || !loginId) throw new Error('Parent name and login ID are required.');

  const rows = await getSheetRows(PARENT_LIST_SHEET, { skipCache: true });
  if (!rows.length) {
    await appendRows(PARENT_LIST_SHEET, [PARENT_HEADERS]);
  }
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === parentId) { found = i + 1; break; }
    if (String(rows[i][3] || '').trim() === loginId && String(rows[i][0]) !== parentId) {
      throw new Error('Login ID already in use.');
    }
  }
  const existingPwd = found > 0 ? String(rows[found - 1][4] || '') : '';
  const legacyStudentId = found > 0 ? String(rows[found - 1][1] || '') : '';
  if (!found && !password) throw new Error('Password required for new parent account.');

  const row = [
    parentId,
    legacyStudentId,
    name,
    loginId,
    password || existingPwd || 'changeme123',
    phone,
    email
  ];
  if (found > 0) {
    await updateRange(PARENT_LIST_SHEET, `A${found}:G${found}`, [row]);
  } else {
    await appendRows(PARENT_LIST_SHEET, [row]);
  }
  invalidateSheetRowsCache(PARENT_LIST_SHEET);
  return getParentRecord(parentId);
}

async function linkParentToStudent(parentId, studentId, opts) {
  opts = opts || {};
  parentId = String(parentId || '').trim();
  studentId = String(studentId || '').trim();
  if (!parentId || !studentId) throw new Error('Parent ID and Student ID are required.');

  const parent = await getParentRecord(parentId);
  if (!parent) throw new Error('Parent account not found.');
  const meta = await getStudentMetaMap();
  if (!meta[studentId]) throw new Error('Student not found.');

  await ensureParentStudentsSheet();
  const links = await listLinksForParent(parentId);
  const existing = links.find((l) => l.studentId === studentId);
  if (existing) {
    if (opts.relationship || opts.isPrimary === true || opts.isPrimary === false) {
      return updateParentStudentLink(parentId, studentId, {
        relationship: opts.relationship || existing.relationship,
        isPrimary: opts.isPrimary
      });
    }
    return { linked: true, already: true, parentId, studentId, relationship: existing.relationship };
  }

  const isPrimary = opts.isPrimary === true || links.length === 0;
  if (isPrimary) {
    // Clear other primary flags for this parent
    const rows = await getSheetRows(PARENT_STUDENTS_SHEET, { skipCache: true });
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) !== parentId) continue;
      if (String(rows[i][4] || '').toLowerCase() !== 'true') continue;
      const next = rows[i].slice();
      while (next.length < 6) next.push('');
      next[4] = 'false';
      await updateRange(PARENT_STUDENTS_SHEET, `A${i + 1}:F${i + 1}`, [next.slice(0, 6)]);
    }
  }

  await appendRows(PARENT_STUDENTS_SHEET, [[
    newId('PL'),
    parentId,
    studentId,
    String(opts.relationship || 'Guardian').trim() || 'Guardian',
    isPrimary ? 'true' : 'false',
    isoNow()
  ]]);
  invalidateSheetRowsCache(PARENT_STUDENTS_SHEET);

  // Keep legacy Parent_List.StudentID as primary for older readers
  if (isPrimary && parent.rowIndex) {
    const prows = await getSheetRows(PARENT_LIST_SHEET, { skipCache: true });
    const r = (prows[parent.rowIndex - 1] || []).slice();
    while (r.length < 7) r.push('');
    r[1] = studentId;
    await updateRange(PARENT_LIST_SHEET, `A${parent.rowIndex}:G${parent.rowIndex}`, [r.slice(0, 7)]);
    invalidateSheetRowsCache(PARENT_LIST_SHEET);
  }

  return { linked: true, parentId, studentId, isPrimary };
}

async function unlinkParentFromStudent(parentId, studentId) {
  parentId = String(parentId || '').trim();
  studentId = String(studentId || '').trim();
  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === parentId && String(rows[i][2]) === studentId) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error('Link not found.');
  await updateRange(PARENT_STUDENTS_SHEET, `A${found}:F${found}`, [new Array(6).fill('')]);
  invalidateSheetRowsCache(PARENT_STUDENTS_SHEET);
  return { unlinked: true, parentId, studentId };
}

async function unlinkAllParentsForStudent(studentId) {
  studentId = String(studentId || '').trim();
  if (!studentId) return { unlinked: 0 };
  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET, { skipCache: true });
  let unlinked = 0;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) !== studentId) continue;
    await updateRange(PARENT_STUDENTS_SHEET, `A${i + 1}:F${i + 1}`, [new Array(6).fill('')]);
    unlinked += 1;
  }
  if (unlinked) invalidateSheetRowsCache(PARENT_STUDENTS_SHEET);
  return { unlinked, studentId };
}

async function setParentAccountActive(parentId, active) {
  parentId = String(parentId || '').trim();
  if (!parentId) throw new Error('Parent ID required.');
  const parent = await getParentRecord(parentId);
  if (!parent) throw new Error('Parent not found.');
  const { setAccountActive } = require('./accountFlagsService');
  await setAccountActive('parent', parentId, active !== false);
  try {
    const { writeAudit } = require('./auditService');
    await writeAudit({
      action: active === false ? 'parent_deactivate' : 'parent_reactivate',
      entityType: 'parent',
      entityId: parentId,
      detail: { loginId: parent.loginId || '' }
    });
  } catch (_) { /* optional */ }
  return { ok: true, parentId, active: active !== false, loginId: parent.loginId || '' };
}

async function updateParentStudentLink(parentId, studentId, opts) {
  opts = opts || {};
  parentId = String(parentId || '').trim();
  studentId = String(studentId || '').trim();
  if (!parentId || !studentId) throw new Error('Parent ID and Student ID are required.');

  await ensureParentStudentsSheet();
  const rows = await getSheetRows(PARENT_STUDENTS_SHEET, { skipCache: true });
  let found = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === parentId && String(rows[i][2]) === studentId) {
      found = i + 1;
      break;
    }
  }
  if (found < 0) throw new Error('Link not found.');

  const next = (rows[found - 1] || []).slice();
  while (next.length < 6) next.push('');
  if (opts.relationship != null && String(opts.relationship).trim()) {
    next[3] = String(opts.relationship).trim();
  }
  if (opts.isPrimary === true) {
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) !== parentId) continue;
      if (i + 1 === found) continue;
      if (String(rows[i][4] || '').toLowerCase() !== 'true') continue;
      const other = rows[i].slice();
      while (other.length < 6) other.push('');
      other[4] = 'false';
      await updateRange(PARENT_STUDENTS_SHEET, `A${i + 1}:F${i + 1}`, [other.slice(0, 6)]);
    }
    next[4] = 'true';
    const parent = await getParentRecord(parentId);
    if (parent && parent.rowIndex) {
      const prows = await getSheetRows(PARENT_LIST_SHEET, { skipCache: true });
      const r = (prows[parent.rowIndex - 1] || []).slice();
      while (r.length < 7) r.push('');
      r[1] = studentId;
      await updateRange(PARENT_LIST_SHEET, `A${parent.rowIndex}:G${parent.rowIndex}`, [r.slice(0, 7)]);
      invalidateSheetRowsCache(PARENT_LIST_SHEET);
    }
  } else if (opts.isPrimary === false) {
    next[4] = 'false';
  }

  await updateRange(PARENT_STUDENTS_SHEET, `A${found}:F${found}`, [next.slice(0, 6)]);
  invalidateSheetRowsCache(PARENT_STUDENTS_SHEET);
  return {
    updated: true,
    parentId,
    studentId,
    relationship: String(next[3] || 'Guardian'),
    isPrimary: String(next[4] || '').toLowerCase() === 'true'
  };
}

/**
 * Create or find parent + link to student (Admin student screen).
 */
async function linkOrCreateParentForStudent(studentId, payload) {
  studentId = String(studentId || '').trim();
  if (!studentId) throw new Error('Student ID is required.');
  payload = payload || {};

  let parentId = String(payload.parentId || '').trim();
  if (!parentId) {
    const loginId = String(payload.loginId || '').trim();
    if (loginId) {
      const existing = await findParentByLogin(loginId);
      if (existing) parentId = existing.parentId;
    }
  }
  if (!parentId) {
    const created = await saveParentAccount({
      name: payload.name,
      loginId: payload.loginId,
      password: payload.password,
      phone: payload.phone,
      email: payload.email
    });
    parentId = created.parentId;
  } else if (payload.name || payload.phone || payload.email || payload.password) {
    const cur = await getParentRecord(parentId);
    await saveParentAccount({
      parentId,
      name: payload.name || (cur && cur.name),
      loginId: payload.loginId || (cur && cur.loginId),
      password: payload.password || '',
      phone: payload.phone != null ? payload.phone : (cur && cur.phone),
      email: payload.email != null ? payload.email : (cur && cur.email)
    });
  }

  await linkParentToStudent(parentId, studentId, {
    relationship: payload.relationship,
    isPrimary: payload.isPrimary
  });

  const [parent, children] = await Promise.all([
    getParentRecord(parentId),
    listChildrenForParent(parentId)
  ]);
  return { parent, children, studentId };
}

async function listParentsForStudent(studentId) {
  const links = await listLinksForStudent(studentId);
  const out = [];
  for (const link of links) {
    const parent = await getParentRecord(link.parentId);
    if (!parent) continue;
    out.push({
      ...parent,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      linkId: link.linkId
    });
  }
  return out;
}

module.exports = {
  ensureParentStudentsSheet,
  migrateLegacyParentLinks,
  listChildrenForParent,
  listParentsForStudent,
  parentHasStudent,
  pickActiveChild,
  findParentByLogin,
  getParentRecord,
  listParents,
  saveParentAccount,
  linkParentToStudent,
  unlinkParentFromStudent,
  unlinkAllParentsForStudent,
  setParentAccountActive,
  updateParentStudentLink,
  linkOrCreateParentForStudent
};
