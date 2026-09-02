const crypto = require('crypto');
const { ANALYTICS_TEACHER_NOTES_SHEET } = require('../../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache, deleteRows
} = require('../../sheets');
const { getTeacherGradeAccess } = require('../subjectAssignmentService');

const NOTE_HEADERS = [
  'NoteID', 'StudentID', 'ClassID', 'TeacherID', 'TeacherName', 'Subject',
  'NoteType', 'Body', 'IncludedInAnalytics', 'CreatedAt', 'UpdatedAt'
];

const NOTE_TYPES = new Set(['diagnostic', 'comment']);

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

function parseNoteRow(row) {
  if (!row || !row[0]) return null;
  const included = String(row[8] || '').toLowerCase();
  return {
    noteId: String(row[0]),
    studentId: String(row[1] || ''),
    classId: String(row[2] || ''),
    teacherId: String(row[3] || ''),
    teacherName: String(row[4] || ''),
    subject: String(row[5] || ''),
    noteType: String(row[6] || 'comment'),
    body: String(row[7] || ''),
    includedInAnalytics: !(included === 'false' || included === '0' || included === 'no'),
    createdAt: String(row[9] || ''),
    updatedAt: String(row[10] || '')
  };
}

function noteTypeLabel(noteType) {
  return noteType === 'diagnostic' ? 'Diagnostic result' : 'Teacher comment';
}

async function ensureTeacherNotesSheet() {
  await ensureSheet(ANALYTICS_TEACHER_NOTES_SHEET, NOTE_HEADERS);
}

function activeTeacherNotes(notes) {
  return (notes || []).filter((n) => n.includedInAnalytics !== false);
}

async function listTeacherNotes(classId, studentId) {
  await ensureTeacherNotesSheet();
  const rows = await getSheetRows(ANALYTICS_TEACHER_NOTES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const n = parseNoteRow(rows[i]);
    if (!n) continue;
    if (classId && n.classId !== String(classId)) continue;
    if (studentId && n.studentId !== String(studentId)) continue;
    out.push(Object.assign({}, n, { noteTypeLabel: noteTypeLabel(n.noteType) }));
  }
  return out.sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
  );
}

async function findTeacherNoteRow(noteId) {
  noteId = String(noteId || '').trim();
  const rows = await getSheetRows(ANALYTICS_TEACHER_NOTES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === noteId) return { rowIndex: i + 1, row: rows[i].slice() };
  }
  return null;
}

async function assertTeacherNoteWriteAccess(teacherId, classId, subject, opts) {
  opts = opts || {};
  if (opts.skipAccessCheck) return { canView: true, canEdit: true, isHomeroom: true };
  const access = await getTeacherGradeAccess(teacherId, classId, subject || '');
  if (!access.canView) throw new Error('You are not assigned to this class.');
  const subj = String(subject || '').trim();
  if (subj && !access.canEdit && !access.isHomeroom) {
    throw new Error('You can only add notes for subjects you teach.');
  }
  return access;
}

async function assertTeacherNoteManageAccess(teacherId, classId, note, opts) {
  opts = opts || {};
  if (opts.skipAccessCheck) return { canView: true, canEdit: true, isHomeroom: true };
  await assertTeacherNoteWriteAccess(teacherId, classId, note.subject, opts);
  const access = await getTeacherGradeAccess(teacherId, classId, note.subject || '');
  if (String(note.teacherId) === String(teacherId)) return access;
  if (access.isHomeroom) return access;
  throw new Error('You can only edit or delete your own notes.');
}

async function createTeacherNote(payload) {
  const classId = String(payload.classId || '').trim();
  const studentId = String(payload.studentId || '').trim();
  const teacherId = String(payload.teacherId || '').trim();
  const subject = String(payload.subject || '').trim();
  const noteType = NOTE_TYPES.has(String(payload.noteType || ''))
    ? String(payload.noteType)
    : 'comment';
  const body = String(payload.body || '').trim();
  if (!classId || !studentId || !teacherId) throw new Error('Class and student are required.');
  if (!body) throw new Error('Enter the diagnostic result or comment.');
  if (body.length > 4000) throw new Error('Note is too long (max 4000 characters).');

  await assertTeacherNoteWriteAccess(teacherId, classId, subject, {
    skipAccessCheck: !!payload.skipAccessCheck
  });
  await ensureTeacherNotesSheet();

  const now = isoNow();
  const noteId = newId('atn');
  const row = [
    noteId,
    studentId,
    classId,
    teacherId,
    String(payload.teacherName || ''),
    subject,
    noteType,
    body,
    payload.includedInAnalytics === false ? 'false' : 'true',
    now,
    now
  ];
  await appendRows(ANALYTICS_TEACHER_NOTES_SHEET, [row]);
  invalidateSheetRowsCache(ANALYTICS_TEACHER_NOTES_SHEET);
  return parseNoteRow(row);
}

async function updateTeacherNote(noteId, classId, teacherId, patch, opts) {
  opts = opts || {};
  classId = String(classId || '').trim();
  teacherId = String(teacherId || '').trim();
  const hit = await findTeacherNoteRow(noteId);
  if (!hit) throw new Error('Note not found.');
  const existing = parseNoteRow(hit.row);
  if (existing.classId !== classId) throw new Error('Note not found.');
  await assertTeacherNoteManageAccess(teacherId, classId, existing, opts);

  const row = hit.row.slice();
  while (row.length < 11) row.push('');
  if (patch && patch.subject != null) {
    const subject = String(patch.subject || '').trim();
    await assertTeacherNoteWriteAccess(teacherId, classId, subject, opts);
    row[5] = subject;
  }
  if (patch && patch.noteType != null && NOTE_TYPES.has(String(patch.noteType))) {
    row[6] = String(patch.noteType);
  }
  if (patch && patch.body != null) {
    const body = String(patch.body || '').trim();
    if (!body) throw new Error('Note cannot be empty.');
    if (body.length > 4000) throw new Error('Note is too long (max 4000 characters).');
    row[7] = body;
  }
  if (patch && patch.includedInAnalytics != null) {
    row[8] = patch.includedInAnalytics ? 'true' : 'false';
  }
  row[10] = isoNow();
  await updateRange(ANALYTICS_TEACHER_NOTES_SHEET, `A${hit.rowIndex}:K${hit.rowIndex}`, [row]);
  return parseNoteRow(row);
}

async function deleteTeacherNote(noteId, classId, teacherId, opts) {
  opts = opts || {};
  classId = String(classId || '').trim();
  teacherId = String(teacherId || '').trim();
  const hit = await findTeacherNoteRow(noteId);
  if (!hit) throw new Error('Note not found.');
  const existing = parseNoteRow(hit.row);
  if (existing.classId !== classId) throw new Error('Note not found.');
  await assertTeacherNoteManageAccess(teacherId, classId, existing, opts);
  await deleteRows(ANALYTICS_TEACHER_NOTES_SHEET, [hit.rowIndex]);
  return { deleted: true, noteId };
}

module.exports = {
  NOTE_TYPES,
  ensureTeacherNotesSheet,
  listTeacherNotes,
  activeTeacherNotes,
  createTeacherNote,
  updateTeacherNote,
  deleteTeacherNote,
  noteTypeLabel
};
