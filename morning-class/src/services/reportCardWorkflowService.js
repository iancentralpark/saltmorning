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
  'ScheduledShareAt', 'UpdatedAt'
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

async function ensureWorkflowSheet() {
  await ensureSheet(REPORT_CARD_WORKFLOW_SHEET, WORKFLOW_HEADERS);
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
    updatedAt: String(row[17] || '')
  };
}

function workflowToRow(w) {
  return [
    w.workflowId, w.classId, w.studentId, w.term, w.state,
    w.homeroomTeacherId, w.headTeacherId,
    w.homeroomSignedAt, w.headSignedAt, w.principalSignedAt,
    w.homeroomSigPath, w.headSigPath, w.principalSigPath,
    w.submittedToHeadAt, w.submittedToPrincipalAt, w.sharedAt,
    w.scheduledShareAt, w.updatedAt
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
    updatedAt: now
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
    await updateRange(REPORT_CARD_WORKFLOW_SHEET, `A${hit.rowIndex}:R${hit.rowIndex}`, [row]);
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
  const rows = await getSheetRows(TEACHER_LIST_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][6] || '').trim() !== String(headTeacherId)) continue;
    out.push({
      teacherId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
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
  processDueScheduledShares,
  signaturePathFor
};
