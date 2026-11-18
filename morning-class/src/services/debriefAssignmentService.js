'use strict';

/**
 * Oral Novel Debrief — Class Assignments (Phase 2)
 *
 * Teachers assign a verified Book Debrief Profile to a class.
 * Students see pending oral-debrief work on their portal (session starts in Phase 3).
 */

const crypto = require('crypto');
const { isOpsDbEnabled, query, table } = require('../db/pool');
const { getBook, publicBook } = require('./debriefBookService');

/** @type {Map<string, object>} */
const assignments = new Map();

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function publicAssignment(row, extras) {
  extras = extras || {};
  return {
    id: row.id,
    classId: row.classId,
    bookId: row.bookId,
    title: row.title,
    customInstructions: row.customInstructions || '',
    dueDate: row.dueDate || null,
    createdBy: row.createdBy || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bookTitle: extras.bookTitle != null ? extras.bookTitle : row.bookTitle,
    bookAuthor: extras.bookAuthor != null ? extras.bookAuthor : row.bookAuthor,
    oneSentenceHook: extras.oneSentenceHook != null ? extras.oneSentenceHook : row.oneSentenceHook,
    isVerified: extras.isVerified != null ? extras.isVerified : row.isVerified,
    gradeBand: extras.gradeBand != null ? extras.gradeBand : row.gradeBand
  };
}

function rowToAssignment(row) {
  const profile = row.debrief_profile && typeof row.debrief_profile === 'object'
    ? row.debrief_profile
    : {};
  return {
    id: row.id,
    classId: row.class_id,
    bookId: row.book_id,
    title: row.title,
    customInstructions: row.custom_instructions || '',
    dueDate: row.due_date || null,
    createdBy: row.created_by || '',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    bookTitle: row.book_title || null,
    bookAuthor: row.book_author || null,
    oneSentenceHook: profile.oneSentenceHook || null,
    isVerified: row.is_verified != null ? !!row.is_verified : undefined,
    gradeBand: row.grade_band || null
  };
}

async function persistAssignment(a) {
  if (!isOpsDbEnabled()) return;
  await query(
    'INSERT INTO ' + table('debrief_assignments') + ' (' +
      'id, class_id, book_id, title, custom_instructions, due_date, created_by, created_at, updated_at' +
    ') VALUES (' +
      '$1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),to_timestamp($9/1000.0)' +
    ') ON CONFLICT (id) DO UPDATE SET ' +
      'class_id = EXCLUDED.class_id, book_id = EXCLUDED.book_id, title = EXCLUDED.title, ' +
      'custom_instructions = EXCLUDED.custom_instructions, due_date = EXCLUDED.due_date, ' +
      'updated_at = EXCLUDED.updated_at',
    [
      a.id,
      a.classId,
      a.bookId,
      a.title,
      a.customInstructions || '',
      a.dueDate || null,
      a.createdBy || '',
      a.createdAt || Date.now(),
      a.updatedAt || Date.now()
    ]
  );
}

async function loadFromDb(id) {
  if (!isOpsDbEnabled()) return null;
  const r = await query(
    'SELECT a.*, b.title AS book_title, b.author AS book_author, b.is_verified, b.grade_band, b.debrief_profile ' +
      'FROM ' + table('debrief_assignments') + ' a ' +
      'LEFT JOIN ' + table('debrief_books') + ' b ON b.id = a.book_id ' +
      'WHERE a.id = $1 LIMIT 1',
    [String(id)]
  );
  return r.rows[0] ? rowToAssignment(r.rows[0]) : null;
}

async function getAssignment(id) {
  let a = assignments.get(String(id || ''));
  if (!a) a = await loadFromDb(id);
  if (!a) return null;
  assignments.set(a.id, a);
  return a;
}

async function countByBook(bookId) {
  bookId = String(bookId || '');
  if (!bookId) return 0;
  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT COUNT(*)::int AS n FROM ' + table('debrief_assignments') + ' WHERE book_id = $1',
      [bookId]
    );
    return Number(r.rows[0] && r.rows[0].n) || 0;
  }
  let n = 0;
  for (const a of assignments.values()) {
    if (a.bookId === bookId) n += 1;
  }
  return n;
}

async function enrichFromBook(a) {
  if (a.bookTitle != null && a.oneSentenceHook != null) return publicAssignment(a);
  try {
    const book = await getBook(a.bookId, null);
    if (!book) return publicAssignment(a);
    const pub = publicBook(book, { includeProfile: true });
    const hook = pub.debriefProfile && pub.debriefProfile.oneSentenceHook;
    return publicAssignment(a, {
      bookTitle: pub.title,
      bookAuthor: pub.author,
      oneSentenceHook: hook || null,
      isVerified: pub.isVerified,
      gradeBand: pub.gradeBand
    });
  } catch (_) {
    return publicAssignment(a);
  }
}

async function createAssignment(opts, createdBy) {
  const classId = String((opts && opts.classId) || '').trim();
  const bookId = String((opts && opts.bookId) || '').trim();
  let title = String((opts && opts.title) || '').trim();
  const customInstructions = String((opts && opts.customInstructions) || '').trim().slice(0, 2000);
  const dueDate = String((opts && opts.dueDate) || '').trim() || null;

  if (!classId) {
    const err = new Error('반(classId)을 선택하세요.');
    err.statusCode = 400;
    throw err;
  }
  if (!bookId) {
    const err = new Error('책을 선택하세요.');
    err.statusCode = 400;
    throw err;
  }

  const book = await getBook(bookId, null);
  if (!book) {
    const err = new Error('책을 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  if (book.status !== 'ready' || !book.debriefProfile) {
    const err = new Error('생성이 끝난 책만 과제로 부여할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }
  if (!book.isVerified) {
    const err = new Error('Verified 처리된 책만 반에 부여할 수 있습니다.');
    err.statusCode = 400;
    throw err;
  }

  if (!title) title = 'Oral Debrief: ' + (book.title || 'Book');

  // Prevent duplicate active assignment of same book to same class
  const existing = await listByClass(classId, { bookId });
  if (existing.some((a) => a.bookId === bookId)) {
    const err = new Error('이 반은 이미 같은 책 디브리프 과제가 있습니다.');
    err.statusCode = 409;
    throw err;
  }

  const now = Date.now();
  const a = {
    id: newId('das'),
    classId,
    bookId,
    title: title.slice(0, 160),
    customInstructions,
    dueDate,
    createdBy: String(createdBy || ''),
    createdAt: now,
    updatedAt: now,
    bookTitle: book.title,
    bookAuthor: book.author,
    oneSentenceHook: (book.debriefProfile && book.debriefProfile.oneSentenceHook) || null,
    isVerified: true,
    gradeBand: book.gradeBand
  };
  assignments.set(a.id, a);
  await persistAssignment(a);
  return publicAssignment(a);
}

async function updateAssignment(id, patch, actor) {
  const a = await getAssignment(id);
  if (!a) {
    const err = new Error('과제를 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  patch = patch || {};
  if (patch.title != null) {
    const t = String(patch.title).trim();
    if (!t) {
      const err = new Error('제목을 입력하세요.');
      err.statusCode = 400;
      throw err;
    }
    a.title = t.slice(0, 160);
  }
  if (patch.customInstructions != null) {
    a.customInstructions = String(patch.customInstructions).trim().slice(0, 2000);
  }
  if (patch.dueDate !== undefined) {
    a.dueDate = String(patch.dueDate || '').trim() || null;
  }
  a.updatedAt = Date.now();
  assignments.set(a.id, a);
  await persistAssignment(a);
  return enrichFromBook(a);
}

async function deleteAssignment(id) {
  const a = await getAssignment(id);
  if (!a) {
    const err = new Error('과제를 찾을 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  assignments.delete(String(id));
  if (isOpsDbEnabled()) {
    await query('DELETE FROM ' + table('debrief_assignments') + ' WHERE id = $1', [String(id)]);
  }
  return { ok: true, id: String(id) };
}

async function listByClass(classId, opts) {
  opts = opts || {};
  classId = String(classId || '').trim();
  if (!classId) return [];
  const bookIdFilter = opts.bookId ? String(opts.bookId) : null;

  if (isOpsDbEnabled()) {
    const params = [classId];
    let sql =
      'SELECT a.*, b.title AS book_title, b.author AS book_author, b.is_verified, b.grade_band, b.debrief_profile ' +
      'FROM ' + table('debrief_assignments') + ' a ' +
      'LEFT JOIN ' + table('debrief_books') + ' b ON b.id = a.book_id ' +
      'WHERE a.class_id = $1';
    if (bookIdFilter) {
      params.push(bookIdFilter);
      sql += ' AND a.book_id = $' + params.length;
    }
    sql += ' ORDER BY a.updated_at DESC';
    const r = await query(sql, params);
    return r.rows.map((row) => {
      const a = rowToAssignment(row);
      assignments.set(a.id, a);
      return publicAssignment(a);
    });
  }

  return Array.from(assignments.values())
    .filter((a) => a.classId === classId && (!bookIdFilter || a.bookId === bookIdFilter))
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))
    .map((a) => publicAssignment(a));
}

async function listByBook(bookId) {
  bookId = String(bookId || '').trim();
  if (!bookId) return [];

  if (isOpsDbEnabled()) {
    const r = await query(
      'SELECT a.*, b.title AS book_title, b.author AS book_author, b.is_verified, b.grade_band, b.debrief_profile ' +
        'FROM ' + table('debrief_assignments') + ' a ' +
        'LEFT JOIN ' + table('debrief_books') + ' b ON b.id = a.book_id ' +
        'WHERE a.book_id = $1 ORDER BY a.updated_at DESC',
      [bookId]
    );
    return r.rows.map((row) => {
      const a = rowToAssignment(row);
      assignments.set(a.id, a);
      return publicAssignment(a);
    });
  }

  return Array.from(assignments.values())
    .filter((a) => a.bookId === bookId)
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))
    .map((a) => publicAssignment(a));
}

/**
 * Student view: assignments for their class, with book summary fields and the
 * student's own oral-session status (assigned | in_progress | completed).
 */
async function listForStudent(classId, studentId) {
  const list = await listByClass(classId);
  const enriched = [];
  for (const a of list) {
    enriched.push(await enrichFromBook(a));
  }
  let statusByAssignment = {};
  try {
    const { statusMapForStudent } = require('./debriefSessionService');
    statusByAssignment = await statusMapForStudent(studentId, enriched.map((a) => a.id));
  } catch (_) { /* sessions optional for listing */ }
  return {
    available: true,
    assignments: enriched
      .filter((a) => a.isVerified !== false)
      .map((a) => {
        const sess = statusByAssignment[a.id];
        const status = sess === 'completed' ? 'completed' : (sess === 'active' ? 'in_progress' : 'assigned');
        return { ...a, status, canStartOral: true };
      })
  };
}

module.exports = {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignment,
  listByClass,
  listByBook,
  listForStudent,
  countByBook,
  publicAssignment
};
