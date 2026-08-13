'use strict';

const crypto = require('crypto');
const {
  CONSENT_TEMPLATES_SHEET,
  CONSENT_FORMS_SHEET,
  CONSENT_SUBMISSIONS_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET
} = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const TEMPLATE_HEADERS = [
  'TemplateID', 'Category', 'Title', 'ContentHTML', 'FieldsJSON', 'IsCustomSaved', 'CreatedAt'
];
const FORM_HEADERS = [
  'FormID', 'TemplateID', 'Category', 'Title', 'ContentHTML', 'FieldsJSON',
  'TargetGrades', 'DueDate', 'Status', 'PublishedAt', 'PublishedBy'
];
const SUB_HEADERS = [
  'SubID', 'FormID', 'StudentID', 'ParentID', 'Agreed', 'DisagreedReason',
  'ExtraDataJSON', 'SignatureBase64', 'SubmittedAt'
];

const CATEGORIES = {
  BusSurvey: 'BusSurvey',
  BusApp: 'BusApp',
  FieldTrip: 'FieldTrip',
  PhotoMedia: 'PhotoMedia',
  Health: 'Health',
  General: 'General'
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    if (!raw) return fallback;
    if (typeof raw === 'object') return raw;
    return JSON.parse(String(raw));
  } catch (_) {
    return fallback;
  }
}

function builtinTemplates() {
  return [
    {
      templateId: 'tpl_bus_survey',
      category: CATEGORIES.BusSurvey,
      title: '[공문] 셔틀버스 1단계 수요 조사서',
      contentHtml:
        '<p>학부모님께,</p>' +
        '<p><strong>{academic_year}</strong> 셔틀버스 운행을 위한 <strong>1단계 수요 조사</strong>입니다.</p>' +
        '<p>학생 <strong>{student_name}</strong>의 거주지와 이용 희망 여부를 알려 주세요. ' +
        '본 조사는 노선 설계용이며, 최종 이용 신청은 2단계에서 별도로 진행됩니다.</p>' +
        '<p>제출 마감: <strong>{due_date}</strong></p>',
      fieldsJson: {
        kind: 'bus_survey',
        requireSignature: true,
        choices: [
          { value: 'Apply', label: '이용 희망 (수요 조사 참여)' },
          { value: 'None', label: '이용 희망 없음' }
        ],
        extraFields: ['apartment', 'desire', 'pickupPlace']
      },
      isCustomSaved: false
    },
    {
      templateId: 'tpl_bus_app',
      category: CATEGORIES.BusApp,
      title: '[신청서] 셔틀버스 2단계 최종 이용 신청서',
      contentHtml:
        '<p>학부모님께,</p>' +
        '<p>확정된 셔틀 노선·시간표를 확인하신 후, 학생 <strong>{student_name}</strong>의 ' +
        '<strong>등교/하교 호차 및 정류장</strong>을 선택해 최종 신청해 주세요.</p>' +
        '<p>신청 완료 시 버스 Daily Board 탑승 명단에 반영됩니다.</p>' +
        '<p>제출 마감: <strong>{due_date}</strong></p>',
      fieldsJson: {
        kind: 'bus_app',
        requireSignature: true,
        choices: [
          { value: 'Apply', label: '최종 이용 신청' },
          { value: 'None', label: '신청하지 않음' }
        ],
        extraFields: ['pickupRunId', 'dismissalRunId', 'stopLabel', 'terms']
      },
      isCustomSaved: false
    },
    {
      templateId: 'tpl_field_trip',
      category: CATEGORIES.FieldTrip,
      title: '[동의서] 현장 체험학습 및 야외활동 동의서',
      contentHtml:
        '<p>학부모님께,</p>' +
        '<p>학생 <strong>{student_name}</strong>의 현장 체험학습/야외활동에 대한 동의서입니다.</p>' +
        '<ul><li>일시: <strong>{trip_date}</strong></li>' +
        '<li>장소: <strong>{location}</strong></li></ul>' +
        '<p>안전 수칙을 안내하였으며, 응급상황 시 학교의 합리적 조치에 동의합니다.</p>',
      fieldsJson: {
        kind: 'consent',
        requireSignature: true,
        choices: [
          { value: 'Y', label: '동의함' },
          { value: 'N', label: '동의하지 않음' }
        ]
      },
      isCustomSaved: false
    },
    {
      templateId: 'tpl_photo_media',
      category: CATEGORIES.PhotoMedia,
      title: '[동의서] 초상권 & 개인정보/학습 결과물 활용 동의서',
      contentHtml:
        '<p>학부모님께,</p>' +
        '<p>학생 <strong>{student_name}</strong>의 사진·영상·학습 결과물을 학교 소식, 포트폴리오, ' +
        '교육 홍보 목적(교내·공식 채널)으로 활용하는 것에 대한 동의서입니다.</p>' +
        '<p>동의하지 않으실 경우 해당 학생은 촬영·게시에서 제외됩니다.</p>',
      fieldsJson: {
        kind: 'consent',
        requireSignature: true,
        choices: [
          { value: 'Y', label: '동의함' },
          { value: 'N', label: '동의하지 않음' }
        ]
      },
      isCustomSaved: false
    },
    {
      templateId: 'tpl_health',
      category: CATEGORIES.Health,
      title: '[동의서] 학생 건강 상태 & 비상 응급처치 동의서',
      contentHtml:
        '<p>학부모님께,</p>' +
        '<p>학생 <strong>{student_name}</strong>의 건강 정보 확인 및 비상 시 응급처치·의료기관 이송에 대한 동의서입니다.</p>' +
        '<p>알레르기·복용약·특이사항은 학생 프로필/의료 정보에 최신으로 반영해 주세요.</p>',
      fieldsJson: {
        kind: 'consent',
        requireSignature: true,
        choices: [
          { value: 'Y', label: '동의함' },
          { value: 'N', label: '동의하지 않음' }
        ]
      },
      isCustomSaved: false
    }
  ];
}

async function ensureConsentSheets() {
  await ensureSheet(CONSENT_TEMPLATES_SHEET, TEMPLATE_HEADERS);
  await ensureSheet(CONSENT_FORMS_SHEET, FORM_HEADERS);
  await ensureSheet(CONSENT_SUBMISSIONS_SHEET, SUB_HEADERS);

  const rows = await getSheetRows(CONSENT_TEMPLATES_SHEET, { skipCache: true });
  const existing = new Set();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) existing.add(String(rows[i][0]));
  }
  const seed = [];
  builtinTemplates().forEach((t) => {
    if (existing.has(t.templateId)) return;
    seed.push([
      t.templateId,
      t.category,
      t.title,
      t.contentHtml,
      JSON.stringify(t.fieldsJson || {}),
      t.isCustomSaved ? 'Y' : 'N',
      nowIso()
    ]);
  });
  if (seed.length) {
    await appendRows(CONSENT_TEMPLATES_SHEET, seed);
    invalidateSheetRowsCache(CONSENT_TEMPLATES_SHEET);
  }
}

function parseTemplateRow(row) {
  if (!row || !row[0]) return null;
  return {
    templateId: String(row[0]),
    category: String(row[1] || CATEGORIES.General),
    title: String(row[2] || ''),
    contentHtml: String(row[3] || ''),
    fieldsJson: parseJson(row[4], {}),
    isCustomSaved: String(row[5] || 'N').toUpperCase() === 'Y',
    createdAt: String(row[6] || '')
  };
}

function parseFormRow(row) {
  if (!row || !row[0]) return null;
  return {
    formId: String(row[0]),
    templateId: String(row[1] || ''),
    category: String(row[2] || CATEGORIES.General),
    title: String(row[3] || ''),
    contentHtml: String(row[4] || ''),
    fieldsJson: parseJson(row[5], {}),
    targetGrades: String(row[6] || '*'),
    dueDate: String(row[7] || ''),
    status: String(row[8] || 'Active'),
    publishedAt: String(row[9] || ''),
    publishedBy: String(row[10] || '')
  };
}

function parseSubRow(row) {
  if (!row || !row[0]) return null;
  return {
    subId: String(row[0]),
    formId: String(row[1] || ''),
    studentId: String(row[2] || ''),
    parentId: String(row[3] || ''),
    agreed: String(row[4] || ''),
    disagreedReason: String(row[5] || ''),
    extraData: parseJson(row[6], {}),
    signatureBase64: String(row[7] || ''),
    submittedAt: String(row[8] || '')
  };
}

function applyVariables(html, vars) {
  let out = String(html || '');
  Object.keys(vars || {}).forEach((k) => {
    const re = new RegExp('\\{' + k + '\\}', 'gi');
    out = out.replace(re, String(vars[k] == null ? '' : vars[k]));
  });
  return out;
}

async function listTemplates() {
  await ensureConsentSheets();
  const rows = await getSheetRows(CONSENT_TEMPLATES_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const t = parseTemplateRow(rows[i]);
    if (t) out.push(t);
  }
  out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return out;
}

async function saveTemplate(payload) {
  await ensureConsentSheets();
  const title = String(payload.title || '').trim();
  const contentHtml = String(payload.contentHtml || '').trim();
  if (!title || !contentHtml) throw Object.assign(new Error('Title and content are required.'), { status: 400 });
  const templateId = String(payload.templateId || '').trim() || newId('tpl');
  const category = String(payload.category || CATEGORIES.General).trim() || CATEGORIES.General;
  const fieldsJson = payload.fieldsJson && typeof payload.fieldsJson === 'object'
    ? payload.fieldsJson
    : parseJson(payload.fieldsJson, {});
  const row = [
    templateId,
    category,
    title,
    contentHtml,
    JSON.stringify(fieldsJson || {}),
    payload.isCustomSaved === false ? 'N' : 'Y',
    nowIso()
  ];
  const rows = await getSheetRows(CONSENT_TEMPLATES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== templateId) continue;
    await updateRange(CONSENT_TEMPLATES_SHEET, `A${i + 1}:G${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_TEMPLATES_SHEET);
    return parseTemplateRow(row);
  }
  await appendRows(CONSENT_TEMPLATES_SHEET, [row]);
  invalidateSheetRowsCache(CONSENT_TEMPLATES_SHEET);
  return parseTemplateRow(row);
}

async function listForms({ status } = {}) {
  await ensureConsentSheets();
  const rows = await getSheetRows(CONSENT_FORMS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const f = parseFormRow(rows[i]);
    if (!f) continue;
    if (status && f.status !== String(status)) continue;
    out.push(f);
  }
  out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return out;
}

async function getForm(formId) {
  const forms = await listForms();
  const hit = forms.find((f) => f.formId === String(formId));
  if (!hit) throw Object.assign(new Error('Form not found.'), { status: 404 });
  return hit;
}

async function listSubmissions(formId) {
  await ensureConsentSheets();
  const rows = await getSheetRows(CONSENT_SUBMISSIONS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const s = parseSubRow(rows[i]);
    if (!s) continue;
    if (formId && s.formId !== String(formId)) continue;
    out.push(s);
  }
  return out;
}

async function studentClassMap() {
  const rows = await getSheetRows(STUDENT_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    map[String(rows[i][0])] = {
      studentId: String(rows[i][0]),
      name: String(rows[i][1] || ''),
      classId: String(rows[i][2] || ''),
      status: String(rows[i][3] || '')
    };
  }
  return map;
}

async function classNameMap() {
  const rows = await getSheetRows(CLASS_LIST_SHEET);
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) map[String(rows[i][0])] = String(rows[i][1] || rows[i][0]);
  }
  return map;
}

function formTargetsStudent(form, student) {
  if (!student || String(student.status || '') !== 'Enrolled') return false;
  const raw = String(form.targetGrades || '*').trim();
  if (!raw || raw === '*') return true;
  const targets = raw.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
  if (!targets.length) return true;
  return targets.includes(String(student.classId || '')) ||
    targets.includes(String(student.gradeLevel || ''));
}

async function publishForm(payload, actor) {
  await ensureConsentSheets();
  const title = String(payload.title || '').trim();
  const contentHtml = String(payload.contentHtml || '').trim();
  if (!title || !contentHtml) throw Object.assign(new Error('Title and content are required.'), { status: 400 });

  const formId = newId('cfm');
  const fieldsJson = payload.fieldsJson && typeof payload.fieldsJson === 'object'
    ? payload.fieldsJson
    : parseJson(payload.fieldsJson, {});
  const row = [
    formId,
    String(payload.templateId || ''),
    String(payload.category || CATEGORIES.General),
    title,
    contentHtml,
    JSON.stringify(fieldsJson || {}),
    String(payload.targetGrades || '*'),
    String(payload.dueDate || ''),
    'Active',
    nowIso(),
    String((actor && (actor.name || actor.adminId || actor.teacherId)) || 'admin')
  ];
  await appendRows(CONSENT_FORMS_SHEET, [row]);
  invalidateSheetRowsCache(CONSENT_FORMS_SHEET);
  const form = parseFormRow(row);

  // Notify parents (best-effort)
  try {
    const push = require('./pushService');
    if (push.isPushEnabled()) {
      const students = await studentClassMap();
      const parentIds = new Set();
      const { listParentsForStudent } = require('./parentRegistryService');
      for (const sid of Object.keys(students)) {
        if (!formTargetsStudent(form, students[sid])) continue;
        const parents = await listParentsForStudent(sid).catch(() => []);
        (parents || []).forEach((p) => {
          const id = typeof p === 'string' ? p : (p.parentId || p);
          if (id) parentIds.add(String(id));
        });
      }
      await Promise.all(Array.from(parentIds).map((pid) =>
        push.sendToParent(pid, {
          title: 'New school form',
          body: title,
          url: '/parent#/consents'
        }).catch(() => null)
      ));
    }
  } catch (_) { /* optional */ }

  return form;
}

async function closeForm(formId) {
  await ensureConsentSheets();
  formId = String(formId || '').trim();
  const rows = await getSheetRows(CONSENT_FORMS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== formId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    row[8] = 'Closed';
    await updateRange(CONSENT_FORMS_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_FORMS_SHEET);
    return parseFormRow(row);
  }
  throw Object.assign(new Error('Form not found.'), { status: 404 });
}

async function listPendingForParent(session) {
  const parentId = String(session.parentId || '').trim();
  const studentId = String(session.studentId || '').trim();
  if (!parentId || !studentId) return { pending: [], count: 0 };

  const [forms, subs, students, classNames] = await Promise.all([
    listForms({ status: 'Active' }),
    listSubmissions(),
    studentClassMap(),
    classNameMap()
  ]);
  const student = students[studentId] || {
    studentId,
    name: session.studentName || session.name || studentId,
    classId: session.classId || '',
    status: 'Enrolled'
  };
  const submitted = new Set(
    subs.filter((s) => s.studentId === studentId).map((s) => s.formId)
  );
  const pending = [];
  for (const form of forms) {
    if (submitted.has(form.formId)) continue;
    if (!formTargetsStudent(form, student)) continue;
    const vars = {
      student_name: student.name || studentId,
      class_name: classNames[student.classId] || student.classId || '',
      due_date: form.dueDate || '—',
      academic_year: new Date().getFullYear() + '–' + String(new Date().getFullYear() + 1).slice(2),
      trip_date: '',
      location: ''
    };
    // Allow publishing vars embedded already; still replace remaining tokens
    pending.push({
      formId: form.formId,
      category: form.category,
      title: form.title,
      dueDate: form.dueDate,
      fieldsJson: form.fieldsJson,
      contentHtml: applyVariables(form.contentHtml, vars),
      studentId,
      studentName: student.name
    });
  }
  return { pending, count: pending.length };
}

async function getParentFormDetail(session, formId) {
  const list = await listPendingForParent(session);
  const hit = list.pending.find((p) => p.formId === String(formId));
  if (hit) return hit;
  // Already submitted or closed — still allow view of form meta
  const form = await getForm(formId);
  const students = await studentClassMap();
  const student = students[session.studentId] || { name: session.studentName || '', studentId: session.studentId };
  const classNames = await classNameMap();
  const vars = {
    student_name: student.name || '',
    class_name: classNames[student.classId] || student.classId || '',
    due_date: form.dueDate || '—',
    academic_year: new Date().getFullYear() + '–' + String(new Date().getFullYear() + 1).slice(2),
    trip_date: '',
    location: ''
  };
  const subs = await listSubmissions(formId);
  const mine = subs.find((s) => s.studentId === String(session.studentId));
  return {
    formId: form.formId,
    category: form.category,
    title: form.title,
    dueDate: form.dueDate,
    fieldsJson: form.fieldsJson,
    contentHtml: applyVariables(form.contentHtml, vars),
    studentId: session.studentId,
    studentName: student.name,
    submitted: !!mine,
    submission: mine || null
  };
}

async function syncBusAssignmentFromSubmission(extra) {
  if (!extra || typeof extra !== 'object') return;
  const { saveAssignment } = require('./busService');
  const studentId = String(extra.studentId || '').trim();
  if (!studentId) return;
  const days = [1, 2, 3, 4, 5];
  for (const key of ['pickupRunId', 'dismissalRunId']) {
    const runId = String(extra[key] || '').trim();
    if (!runId) continue;
    await saveAssignment({
      studentId,
      runId,
      days,
      active: true
    });
  }
}

async function submitConsent(session, payload) {
  await ensureConsentSheets();
  const formId = String(payload.formId || '').trim();
  const studentId = String(payload.studentId || session.studentId || '').trim();
  const parentId = String(session.parentId || '').trim();
  const agreed = String(payload.agreed || '').trim();
  if (!formId || !studentId || !parentId) {
    throw Object.assign(new Error('Form, student, and parent are required.'), { status: 400 });
  }
  if (!agreed) throw Object.assign(new Error('Please select a response.'), { status: 400 });

  const form = await getForm(formId);
  if (form.status !== 'Active') {
    throw Object.assign(new Error('This form is closed.'), { status: 400 });
  }

  // Parent may only submit for active child
  if (String(session.studentId) !== studentId) {
    throw Object.assign(new Error('Switch to the correct child before submitting.'), { status: 403 });
  }

  const existing = await listSubmissions(formId);
  if (existing.some((s) => s.studentId === studentId)) {
    throw Object.assign(new Error('Already submitted for this student.'), { status: 400 });
  }

  const fields = form.fieldsJson || {};
  if (fields.requireSignature !== false) {
    const sig = String(payload.signatureBase64 || '');
    if (!sig || sig.length < 32) {
      throw Object.assign(new Error('Signature is required.'), { status: 400 });
    }
  }
  if ((agreed === 'N' || agreed === 'None') && !String(payload.disagreedReason || '').trim()) {
    throw Object.assign(new Error('Please enter a reason for not agreeing / not applying.'), { status: 400 });
  }

  const extra = Object.assign({}, payload.extraData || {}, { studentId });
  const kind = fields.kind || '';
  if (kind === 'bus_app' && agreed === 'Apply') {
    if (!extra.pickupRunId && !extra.dismissalRunId) {
      throw Object.assign(new Error('Select at least one bus run (pickup or dismissal).'), { status: 400 });
    }
  }

  const subId = newId('csub');
  const row = [
    subId,
    formId,
    studentId,
    parentId,
    agreed,
    String(payload.disagreedReason || '').trim(),
    JSON.stringify(extra),
    String(payload.signatureBase64 || ''),
    nowIso()
  ];
  await appendRows(CONSENT_SUBMISSIONS_SHEET, [row]);
  invalidateSheetRowsCache(CONSENT_SUBMISSIONS_SHEET);

  if (kind === 'bus_app' && agreed === 'Apply') {
    try {
      await syncBusAssignmentFromSubmission(extra);
    } catch (e) {
      console.warn('[consent] bus sync failed:', e.message || e);
    }
  }

  return parseSubRow(row);
}

async function getFormAnalytics(formId) {
  const form = await getForm(formId);
  const [subs, students, classNames] = await Promise.all([
    listSubmissions(formId),
    studentClassMap(),
    classNameMap()
  ]);

  const eligible = Object.keys(students)
    .map((id) => students[id])
    .filter((s) => formTargetsStudent(form, s));

  const byStudent = {};
  subs.forEach((s) => { byStudent[s.studentId] = s; });

  const submitted = [];
  const pending = [];
  eligible.forEach((s) => {
    const row = {
      studentId: s.studentId,
      name: s.name,
      classId: s.classId,
      className: classNames[s.classId] || s.classId || ''
    };
    if (byStudent[s.studentId]) {
      submitted.push(Object.assign({}, row, {
        agreed: byStudent[s.studentId].agreed,
        disagreedReason: byStudent[s.studentId].disagreedReason,
        submittedAt: byStudent[s.studentId].submittedAt,
        extraData: byStudent[s.studentId].extraData
      }));
    } else {
      pending.push(row);
    }
  });

  const total = eligible.length;
  const rate = total ? Math.round((submitted.length / total) * 1000) / 10 : 0;

  // Bus survey clustering
  const clusters = {};
  submitted.forEach((s) => {
    const apt = String((s.extraData && (s.extraData.apartment || s.extraData.pickupPlace)) || '').trim() || '(unspecified)';
    if (!clusters[apt]) clusters[apt] = { apartment: apt, count: 0, students: [] };
    clusters[apt].count += 1;
    clusters[apt].students.push({ studentId: s.studentId, name: s.name, desire: (s.extraData && s.extraData.desire) || '' });
  });

  return {
    form,
    total,
    submittedCount: submitted.length,
    pendingCount: pending.length,
    rate,
    submitted,
    pending,
    clusters: Object.keys(clusters).map((k) => clusters[k]).sort((a, b) => b.count - a.count)
  };
}

async function remindPending(formId) {
  const analytics = await getFormAnalytics(formId);
  const push = require('./pushService');
  if (!push.isPushEnabled()) {
    return { sent: 0, skipped: analytics.pendingCount, reason: 'Push not configured' };
  }
  const { listParentsForStudent } = require('./parentRegistryService');
  let sent = 0;
  for (const p of analytics.pending) {
    const parents = await listParentsForStudent(p.studentId).catch(() => []);
    for (const parent of parents || []) {
      const pid = typeof parent === 'string' ? parent : parent.parentId;
      if (!pid) continue;
      try {
        await push.sendToParent(pid, {
          title: 'Reminder: school form',
          body: analytics.form.title + ' — please submit for ' + (p.name || p.studentId),
          url: '/parent#/consents'
        });
        sent += 1;
      } catch (_) { /* continue */ }
    }
  }
  return { sent, pending: analytics.pendingCount };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderSubmissionsPrintHtml(formId) {
  const analytics = await getFormAnalytics(formId);
  const form = analytics.form;
  let rows = '';
  for (const s of analytics.submitted) {
    const full = (await listSubmissions(formId)).find((x) => x.studentId === s.studentId);
    const sig = full && full.signatureBase64
      ? '<img src="' + full.signatureBase64 + '" alt="sig" style="max-height:40px;max-width:120px">'
      : '—';
    rows += '<tr>' +
      '<td>' + escapeHtml(s.name) + '</td>' +
      '<td>' + escapeHtml(s.className) + '</td>' +
      '<td>' + escapeHtml(s.agreed) + '</td>' +
      '<td>' + escapeHtml(s.disagreedReason || '—') + '</td>' +
      '<td>' + escapeHtml(String(s.submittedAt || '').slice(0, 16)) + '</td>' +
      '<td>' + sig + '</td>' +
      '</tr>';
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml(form.title) +
    '</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px}th{background:#0f172a;color:#fff}' +
    '@media print{button{display:none}}</style></head><body>' +
    '<button onclick="window.print()">Print / Save PDF</button>' +
    '<h1>' + escapeHtml(form.title) + '</h1>' +
    '<p>Submitted ' + analytics.submittedCount + ' / ' + analytics.total +
    ' (' + analytics.rate + '%)</p>' +
    '<table><thead><tr><th>Student</th><th>Class</th><th>Response</th><th>Reason</th><th>Submitted</th><th>Signature</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="6">No submissions</td></tr>') +
    '</tbody></table></body></html>';
}

module.exports = {
  CATEGORIES,
  ensureConsentSheets,
  listTemplates,
  saveTemplate,
  listForms,
  getForm,
  publishForm,
  closeForm,
  listPendingForParent,
  getParentFormDetail,
  submitConsent,
  getFormAnalytics,
  remindPending,
  renderSubmissionsPrintHtml,
  applyVariables,
  builtinTemplates
};
