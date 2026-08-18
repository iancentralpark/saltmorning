'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  REPORT_CARD_WORKFLOW_SHEET,
  REPORT_CARD_SIGNATURES_SHEET,
  TEACHER_LIST_SHEET
} = require('../config');
const {
  getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache
} = require('../sheets');

const STATES = {
  draft: 'draft',
  signed_homeroom: 'signed_homeroom',
  submitted_head: 'submitted_head',
  signed_head: 'signed_head',
  submitted_principal: 'submitted_principal',
  signed_principal: 'signed_principal',
  shared_parent: 'shared_parent'
};

const WORKFLOW_HEADERS = [
  'WorkflowID', 'ClassID', 'StudentID', 'Term', 'State',
  'HomeroomTeacherID', 'HeadTeacherID',
  'HomeroomSignedAt', 'HeadSignedAt', 'PrincipalSignedAt',
  'HomeroomSigPath', 'HeadSigPath', 'PrincipalSigPath',
  'SubmittedToHeadAt', 'SubmittedToPrincipalAt', 'SharedAt',
  'ScheduledShareAt', 'UpdatedAt',
  'RejectedAt', 'RejectedByRole', 'RejectedFromState', 'RejectReason'
];

const SIG_HEADERS = ['PersonID', 'MimeType', 'Base64', 'UpdatedAt'];

/** Local cache only — Railway disk is ephemeral; durable copy lives in Sheets. */
const SIG_DIR = path.join(__dirname, '../../public/uploads/signatures');
const MAX_SIG_BASE64 = 48000;

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * ensureSheet() only writes headers when CREATING a brand-new sheet, so an
 * already-deployed spreadsheet's header row won't automatically grow when we
 * add columns to WORKFLOW_HEADERS. Backfill the header row (values only —
 * old data rows are untouched and just read back as blank for new columns).
 */
async function ensureWorkflowColumns() {
  const rows = await getSheetRows(REPORT_CARD_WORKFLOW_SHEET);
  if (!rows.length) return;
  const header = (rows[0] || []).map((c) => String(c || '').trim());
  if (header[0] !== 'WorkflowID') return;
  if (header[18] !== 'RejectedAt') {
    await updateRange(REPORT_CARD_WORKFLOW_SHEET, 'S1:V1', [WORKFLOW_HEADERS.slice(18)]);
    invalidateSheetRowsCache(REPORT_CARD_WORKFLOW_SHEET);
  }
}

async function ensureWorkflowSheet() {
  await ensureSheet(REPORT_CARD_WORKFLOW_SHEET, WORKFLOW_HEADERS);
  await ensureWorkflowColumns();
  await ensureSheet(REPORT_CARD_SIGNATURES_SHEET, SIG_HEADERS);
  if (!fs.existsSync(SIG_DIR)) fs.mkdirSync(SIG_DIR, { recursive: true });
}

function personIdFromSigPath(pathOrId) {
  const raw = String(pathOrId || '').trim();
  if (!raw) return '';
  const m = raw.match(/\/(?:api\/)?signatures\/([^/?#]+)/i) ||
    raw.match(/\/uploads\/signatures\/([^/?#]+?)(?:\.[a-z0-9]+)?$/i);
  if (m) return decodeURIComponent(m[1]);
  if (!raw.includes('/')) return raw.replace(/\.(png|jpe?g|webp)$/i, '');
  return '';
}

function signaturePathFor(personId) {
  return '/api/signatures/' + encodeURIComponent(String(personId));
}

function normalizeSigPath(pathOrId) {
  const id = personIdFromSigPath(pathOrId) || String(pathOrId || '').trim();
  if (!id) return '';
  return signaturePathFor(id);
}

function absoluteSignaturePath(personId, ext) {
  return path.join(SIG_DIR, String(personId) + (ext || '.bin'));
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.png';
}

function mimeFromExt(filePath) {
  if (/\.jpe?g$/i.test(filePath)) return 'image/jpeg';
  if (/\.webp$/i.test(filePath)) return 'image/webp';
  return 'image/png';
}

async function upsertSignatureRow(personId, mime, base64) {
  await ensureWorkflowSheet();
  const rows = await getSheetRows(REPORT_CARD_SIGNATURES_SHEET, { skipCache: true });
  const row = [String(personId), mime || 'image/png', base64, isoNow()];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(personId)) continue;
    await updateRange(REPORT_CARD_SIGNATURES_SHEET, `A${i + 1}:D${i + 1}`, [row]);
    invalidateSheetRowsCache(REPORT_CARD_SIGNATURES_SHEET);
    return;
  }
  await appendRows(REPORT_CARD_SIGNATURES_SHEET, [row]);
  invalidateSheetRowsCache(REPORT_CARD_SIGNATURES_SHEET);
}

async function readSignatureRow(personId) {
  await ensureWorkflowSheet();
  const rows = await getSheetRows(REPORT_CARD_SIGNATURES_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(personId)) continue;
    const base64 = String(rows[i][2] || '').trim();
    if (!base64) return null;
    return {
      personId: String(personId),
      mime: String(rows[i][1] || 'image/png'),
      base64
    };
  }
  return null;
}

function writeLocalSignatureCache(personId, buffer, mime) {
  if (!fs.existsSync(SIG_DIR)) fs.mkdirSync(SIG_DIR, { recursive: true });
  const ext = extForMime(mime);
  ['.png', '.jpg', '.jpeg', '.webp', '.bin'].forEach((e) => {
    const p = absoluteSignaturePath(personId, e);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (err) { /* ignore */ }
    }
  });
  fs.writeFileSync(absoluteSignaturePath(personId, ext), buffer);
  return absoluteSignaturePath(personId, ext);
}

function readLocalSignatureCache(personId) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.bin']) {
    const p = absoluteSignaturePath(personId, ext);
    if (fs.existsSync(p)) {
      return { buffer: fs.readFileSync(p), mime: mimeFromExt(p), path: p };
    }
  }
  return null;
}

async function saveSignaturePng(personId, buffer, mimeType) {
  await ensureWorkflowSheet();
  personId = String(personId || '').trim();
  if (!personId) throw new Error('Signer id required.');
  if (!buffer || !buffer.length) throw new Error('Signature image required.');
  const mime = mimeType || 'image/png';
  const base64 = Buffer.from(buffer).toString('base64');
  if (base64.length > MAX_SIG_BASE64) {
    throw new Error(
      'Signature image is too large to store. Use a smaller signature PNG (about 700×250 px).'
    );
  }
  writeLocalSignatureCache(personId, buffer, mime);
  await upsertSignatureRow(personId, mime, base64);
  return signaturePathFor(personId);
}

/**
 * Load signature bytes from local cache or durable Sheets store.
 */
async function loadSignatureAsset(personId) {
  personId = String(personId || '').trim();
  if (!personId) return null;
  const local = readLocalSignatureCache(personId);
  if (local) return { buffer: local.buffer, mime: local.mime, personId };
  const row = await readSignatureRow(personId);
  if (!row) return null;
  const buffer = Buffer.from(row.base64, 'base64');
  try { writeLocalSignatureCache(personId, buffer, row.mime); } catch (e) { /* ignore */ }
  return { buffer, mime: row.mime, personId };
}

async function hasSignature(personId) {
  const asset = await loadSignatureAsset(personId);
  return !!asset;
}

/** Sync helper — local cache only. Use resolveSignaturePath for durable checks. */
function readSignaturePath(personId) {
  if (readLocalSignatureCache(personId)) return signaturePathFor(personId);
  return '';
}

async function resolveSignaturePath(personId) {
  if (await hasSignature(personId)) return signaturePathFor(personId);
  return '';
}

function parseWorkflowRow(row) {
  if (!row || !row[0]) return null;
  return {
    workflowId: String(row[0]),
    classId: String(row[1] || ''),
    studentId: String(row[2] || ''),
    term: String(row[3] || ''),
    state: String(row[4] || STATES.draft),
    homeroomTeacherId: String(row[5] || ''),
    headTeacherId: String(row[6] || ''),
    homeroomSignedAt: String(row[7] || ''),
    headSignedAt: String(row[8] || ''),
    principalSignedAt: String(row[9] || ''),
    homeroomSigPath: normalizeSigPath(row[10] || ''),
    headSigPath: normalizeSigPath(row[11] || ''),
    principalSigPath: normalizeSigPath(row[12] || ''),
    submittedToHeadAt: String(row[13] || ''),
    submittedToPrincipalAt: String(row[14] || ''),
    sharedAt: String(row[15] || ''),
    scheduledShareAt: String(row[16] || ''),
    updatedAt: String(row[17] || ''),
    rejectedAt: String(row[18] || ''),
    rejectedByRole: String(row[19] || ''),
    rejectedFromState: String(row[20] || ''),
    rejectReason: String(row[21] || '')
  };
}

function workflowToRow(w) {
  return [
    w.workflowId, w.classId, w.studentId, w.term, w.state,
    w.homeroomTeacherId, w.headTeacherId,
    w.homeroomSignedAt, w.headSignedAt, w.principalSignedAt,
    w.homeroomSigPath, w.headSigPath, w.principalSigPath,
    w.submittedToHeadAt, w.submittedToPrincipalAt, w.sharedAt,
    w.scheduledShareAt, w.updatedAt,
    w.rejectedAt || '', w.rejectedByRole || '', w.rejectedFromState || '', w.rejectReason || ''
  ];
}

async function findWorkflow(classId, studentId, term) {
  await ensureWorkflowSheet();
  const rows = await getSheetRows(REPORT_CARD_WORKFLOW_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== String(classId)) continue;
    if (String(rows[i][2]) !== String(studentId)) continue;
    if (String(rows[i][3]) !== String(term)) continue;
    return { rowIndex: i + 1, workflow: parseWorkflowRow(rows[i]) };
  }
  return null;
}

async function getOrCreateWorkflow(classId, studentId, term, extras) {
  extras = extras || {};
  const existing = await findWorkflow(classId, studentId, term);
  if (existing) return existing.workflow;
  const now = isoNow();
  const workflow = {
    workflowId: newId('rcw'),
    classId: String(classId),
    studentId: String(studentId),
    term: String(term),
    state: STATES.draft,
    homeroomTeacherId: String(extras.homeroomTeacherId || ''),
    headTeacherId: String(extras.headTeacherId || ''),
    homeroomSignedAt: '',
    headSignedAt: '',
    principalSignedAt: '',
    homeroomSigPath: '',
    headSigPath: '',
    principalSigPath: '',
    submittedToHeadAt: '',
    submittedToPrincipalAt: '',
    sharedAt: '',
    scheduledShareAt: '',
    updatedAt: now,
    rejectedAt: '',
    rejectedByRole: '',
    rejectedFromState: '',
    rejectReason: ''
  };
  await appendRows(REPORT_CARD_WORKFLOW_SHEET, [workflowToRow(workflow)]);
  invalidateSheetRowsCache(REPORT_CARD_WORKFLOW_SHEET);
  return workflow;
}

async function saveWorkflow(workflow) {
  await ensureWorkflowSheet();
  workflow.updatedAt = isoNow();
  const hit = await findWorkflow(workflow.classId, workflow.studentId, workflow.term);
  const row = workflowToRow(workflow);
  if (hit) {
    await updateRange(REPORT_CARD_WORKFLOW_SHEET, `A${hit.rowIndex}:V${hit.rowIndex}`, [row]);
  } else {
    await appendRows(REPORT_CARD_WORKFLOW_SHEET, [row]);
  }
  invalidateSheetRowsCache(REPORT_CARD_WORKFLOW_SHEET);
  return workflow;
}

async function listWorkflows(filter) {
  filter = filter || {};
  await ensureWorkflowSheet();
  const rows = await getSheetRows(REPORT_CARD_WORKFLOW_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const w = parseWorkflowRow(rows[i]);
    if (!w) continue;
    if (filter.state && w.state !== filter.state) continue;
    if (filter.states && !filter.states.includes(w.state)) continue;
    if (filter.classId && w.classId !== String(filter.classId)) continue;
    if (filter.homeroomTeacherId && w.homeroomTeacherId !== String(filter.homeroomTeacherId)) continue;
    if (filter.headTeacherId && w.headTeacherId !== String(filter.headTeacherId)) continue;
    out.push(w);
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

/** Teacher_List col G = HeadTeacherID (optional). */
async function getTeacherHeadId(teacherId) {
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(teacherId)) continue;
    return String(rows[i][6] || '').trim();
  }
  return '';
}

async function listTeachersForHead(headTeacherId) {
  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  const [rows, names] = await Promise.all([
    getSheetRows(TEACHER_LIST_SHEET),
    teacherDisplayNameMap().catch(() => ({}))
  ]);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][6] || '').trim() !== String(headTeacherId)) continue;
    const teacherId = String(rows[i][0]);
    out.push({
      teacherId,
      name: names[teacherId] || String(rows[i][1] || ''),
      staffRole: String(rows[i][5] || 'Teacher'),
      homeroomClassId: String(rows[i][4] || '')
    });
  }
  return out;
}

async function signAsHomeroom(workflow, teacherId) {
  if (workflow.state !== STATES.draft && workflow.state !== STATES.signed_homeroom) {
    throw new Error('Homeroom can only sign before submitting to the Head Teacher.');
  }
  const sig = await resolveSignaturePath(teacherId);
  if (!sig) throw new Error('Upload your signature PNG first (Report card → Upload signature).');
  workflow.state = STATES.signed_homeroom;
  workflow.homeroomTeacherId = String(teacherId);
  workflow.homeroomSignedAt = isoNow();
  workflow.homeroomSigPath = sig;
  if (!workflow.headTeacherId) {
    workflow.headTeacherId = await getTeacherHeadId(teacherId);
  }
  return saveWorkflow(workflow);
}

async function submitToHead(workflow, teacherId) {
  if (workflow.state !== STATES.signed_homeroom) {
    throw new Error('Sign the report card before submitting to the Head Teacher.');
  }
  if (String(workflow.homeroomTeacherId) !== String(teacherId)) {
    throw new Error('Only the signing Homeroom teacher can submit.');
  }
  if (!workflow.headTeacherId) {
    workflow.headTeacherId = await getTeacherHeadId(teacherId);
  }
  if (!workflow.headTeacherId) {
    throw new Error('No Head Teacher is assigned to you. Ask Admin to set Head Teacher.');
  }
  workflow.state = STATES.submitted_head;
  workflow.submittedToHeadAt = isoNow();
  return saveWorkflow(workflow);
}

async function signAsHead(workflow, headTeacherId) {
  if (workflow.state !== STATES.submitted_head && workflow.state !== STATES.signed_head) {
    throw new Error('Waiting for Homeroom submission before Head Teacher can sign.');
  }
  if (workflow.headTeacherId && String(workflow.headTeacherId) !== String(headTeacherId)) {
    throw new Error('This report card is assigned to another Head Teacher.');
  }
  const sig = await resolveSignaturePath(headTeacherId);
  if (!sig) throw new Error('Upload your signature PNG first.');
  workflow.state = STATES.signed_head;
  workflow.headTeacherId = String(headTeacherId);
  workflow.headSignedAt = isoNow();
  workflow.headSigPath = sig;
  return saveWorkflow(workflow);
}

async function submitToPrincipal(workflow, headTeacherId) {
  if (workflow.state !== STATES.signed_head) {
    throw new Error('Sign before submitting to the Principal.');
  }
  if (String(workflow.headTeacherId) !== String(headTeacherId)) {
    throw new Error('Only the assigned Head Teacher can submit to the Principal.');
  }
  workflow.state = STATES.submitted_principal;
  workflow.submittedToPrincipalAt = isoNow();
  return saveWorkflow(workflow);
}

async function signAsPrincipal(workflow, principalId) {
  if (workflow.state !== STATES.submitted_principal && workflow.state !== STATES.signed_principal) {
    throw new Error('Waiting for Head Teacher submission before Principal can sign.');
  }
  const sig = await resolveSignaturePath(principalId);
  if (!sig) throw new Error('Upload your signature PNG first.');
  workflow.state = STATES.signed_principal;
  workflow.principalSignedAt = isoNow();
  workflow.principalSigPath = sig;
  return saveWorkflow(workflow);
}

async function markShared(workflow, scheduledShareAt) {
  if (workflow.state !== STATES.signed_principal && workflow.state !== STATES.shared_parent) {
    throw new Error('Principal must sign before sharing with parents.');
  }
  const now = isoNow();
  if (scheduledShareAt && new Date(scheduledShareAt).getTime() > Date.now()) {
    workflow.scheduledShareAt = new Date(scheduledShareAt).toISOString();
    // stay signed_principal until due; caller may still share immediately if desired
    return saveWorkflow(workflow);
  }
  workflow.state = STATES.shared_parent;
  workflow.sharedAt = now;
  workflow.scheduledShareAt = '';
  return saveWorkflow(workflow);
}

/**
 * Send a submitted report card back to the Homeroom teacher for correction.
 * Always resets all the way to draft (clearing every signature) rather than
 * a partial rollback — if a reviewer found a problem, the safest rule is to
 * make the whole chain re-confirm the corrected data rather than trust a
 * signature made before the fix.
 */
async function rejectWorkflow(workflow, actorRole, actorId, reason) {
  reason = String(reason || '').trim();
  if (!reason) throw new Error('A reason is required when sending a report card back.');

  const fromState = workflow.state;
  if (fromState === STATES.draft) {
    throw new Error('Nothing to send back — this report card has not been submitted yet.');
  }
  if (fromState === STATES.shared_parent) {
    throw new Error('This report card was already shared with parents and cannot be sent back here.');
  }

  if (actorRole === 'head') {
    if (fromState !== STATES.submitted_head && fromState !== STATES.signed_head) {
      throw new Error('The Head Teacher can only send back a report card that is waiting on their review.');
    }
    if (workflow.headTeacherId && String(workflow.headTeacherId) !== String(actorId)) {
      throw new Error('This report card is assigned to another Head Teacher.');
    }
  } else if (actorRole !== 'principal' && actorRole !== 'admin') {
    throw new Error('Only the Head Teacher, Principal, or Admin can send a report card back.');
  }

  workflow.state = STATES.draft;
  workflow.homeroomSignedAt = '';
  workflow.homeroomSigPath = '';
  workflow.headSignedAt = '';
  workflow.headSigPath = '';
  workflow.principalSignedAt = '';
  workflow.principalSigPath = '';
  workflow.submittedToHeadAt = '';
  workflow.submittedToPrincipalAt = '';
  workflow.scheduledShareAt = '';
  workflow.rejectedAt = isoNow();
  workflow.rejectedByRole = actorRole;
  workflow.rejectedFromState = fromState;
  workflow.rejectReason = reason;
  const saved = await saveWorkflow(workflow);

  try {
    const { writeAudit } = require('./auditService');
    await writeAudit({
      actorRole,
      actorId: String(actorId || ''),
      action: 'report_card_rejected',
      entityType: 'report_card_workflow',
      entityId: workflow.workflowId,
      detail: { classId: workflow.classId, studentId: workflow.studentId, term: workflow.term, fromState, reason }
    });
  } catch (e) { /* optional */ }

  return saved;
}

/**
 * Reset an in-flight (non-draft, non-shared) workflow back to draft because
 * the underlying grade/report content changed after a signature was made.
 * A Principal's (or Head's) signature should never be trusted against data
 * that was edited after they signed it — silently letting the signature
 * stand while the numbers drift underneath it defeats the point of signing.
 */
async function invalidateWorkflowForDataChange(classId, studentId, term, reason) {
  try {
    const hit = await findWorkflow(classId, studentId, term);
    if (!hit || !hit.workflow) return null;
    const w = hit.workflow;
    if (w.state === STATES.draft || w.state === STATES.shared_parent) return null;
    const fromState = w.state;
    w.state = STATES.draft;
    w.homeroomSignedAt = '';
    w.homeroomSigPath = '';
    w.headSignedAt = '';
    w.headSigPath = '';
    w.principalSignedAt = '';
    w.principalSigPath = '';
    w.submittedToHeadAt = '';
    w.submittedToPrincipalAt = '';
    w.scheduledShareAt = '';
    w.rejectedAt = isoNow();
    w.rejectedByRole = 'system';
    w.rejectedFromState = fromState;
    w.rejectReason = reason || 'Report data changed after signing — re-sign required.';
    const saved = await saveWorkflow(w);
    try {
      const { writeAudit } = require('./auditService');
      await writeAudit({
        actorRole: 'system',
        action: 'report_card_auto_invalidated',
        entityType: 'report_card_workflow',
        entityId: w.workflowId,
        detail: { classId, studentId, term, fromState, reason }
      });
    } catch (e) { /* optional */ }
    return saved;
  } catch (e) {
    console.warn('[reportCardWorkflow] auto-invalidate failed:', e.message);
    return null;
  }
}

/** Same as invalidateWorkflowForDataChange, but for every student in a class+term (e.g. a shared grade column was deleted and we don't know which students it affected). */
async function invalidateWorkflowsForClassTerm(classId, term, reason) {
  try {
    const rows = await listWorkflows({ classId: String(classId) });
    for (const w of rows) {
      if (String(w.term) !== String(term)) continue;
      await invalidateWorkflowForDataChange(classId, w.studentId, term, reason);
    }
  } catch (e) {
    console.warn('[reportCardWorkflow] bulk auto-invalidate failed:', e.message);
  }
}

function stateLabel(state) {
  const map = {
    draft: 'Draft',
    signed_homeroom: 'Signed by Homeroom',
    submitted_head: 'Submitted to Head Teacher',
    signed_head: 'Signed by Head Teacher',
    submitted_principal: 'Submitted to Principal',
    signed_principal: 'Signed by Principal',
    shared_parent: 'Shared with Parents'
  };
  return map[state] || state;
}

/**
 * Share any report cards whose ScheduledShareAt is due.
 * Returns number of cards shared.
 */
async function processDueScheduledShares(shareFn) {
  await ensureWorkflowSheet();
  const due = await listWorkflows({ state: STATES.signed_principal });
  const now = Date.now();
  let shared = 0;
  for (const w of due) {
    if (!w.scheduledShareAt) continue;
    const at = new Date(w.scheduledShareAt).getTime();
    if (!at || at > now) continue;
    try {
      if (typeof shareFn === 'function') {
        await shareFn(w);
      } else {
        await markShared(w, '');
      }
      shared += 1;
    } catch (e) {
      console.warn('Scheduled report-card share failed:', w.workflowId, e.message);
      try {
        const { writeAudit } = require('./auditService');
        await writeAudit({
          actorRole: 'system',
          action: 'scheduled_share_failed',
          entityType: 'report_card_workflow',
          entityId: w.workflowId,
          detail: { classId: w.classId, studentId: w.studentId, term: w.term, error: e.message }
        });
      } catch (e2) { /* optional */ }
      // Don't silently retry every 5 minutes forever — clear the schedule so
      // the card just sits in signed_principal (still visible in the Admin
      // queue, ready for a manual "Share now"/"Schedule" retry) instead of
      // spamming logs indefinitely with no admin-visible signal.
      try {
        w.scheduledShareAt = '';
        await saveWorkflow(w);
      } catch (e3) { /* optional */ }
    }
  }
  return shared;
}

module.exports = {
  STATES,
  stateLabel,
  ensureWorkflowSheet,
  getOrCreateWorkflow,
  findWorkflow,
  saveWorkflow,
  listWorkflows,
  getTeacherHeadId,
  listTeachersForHead,
  saveSignaturePng,
  readSignaturePath,
  resolveSignaturePath,
  loadSignatureAsset,
  hasSignature,
  normalizeSigPath,
  signAsHomeroom,
  submitToHead,
  signAsHead,
  submitToPrincipal,
  signAsPrincipal,
  markShared,
  rejectWorkflow,
  invalidateWorkflowForDataChange,
  invalidateWorkflowsForClassTerm,
  processDueScheduledShares,
  signaturePathFor
};
