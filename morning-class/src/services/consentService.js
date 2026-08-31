'use strict';

const crypto = require('crypto');
const {
  CONSENT_TEMPLATES_SHEET,
  CONSENT_FORMS_SHEET,
  CONSENT_SUBMISSIONS_SHEET,
  STUDENT_LIST_SHEET,
  CLASS_LIST_SHEET,
  SCHOOL_NAME,
  SCHOOL_ADDRESS,
  SCHOOL_PHONE,
  SCHOOL_WEBSITE
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

/** Bump to force-refresh non-custom builtin template bodies in Sheets. */
const BUILTIN_TEMPLATE_VERSION = 'v3-institutional-header';

const CATEGORIES = {
  BusSurvey: 'BusSurvey',
  BusApp: 'BusApp',
  FieldTrip: 'FieldTrip',
  Event: 'Event',
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

function todaySeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function academicYearLabel() {
  const y = new Date().getFullYear();
  return y + '–' + String(y + 1).slice(2);
}

const ODOC_EMBLEM_SVG =
  '<svg class="odoc-emblem-svg" viewBox="0 0 96 96" role="img" aria-label="Salt Academy emblem">' +
  '<circle cx="48" cy="48" r="44" fill="#ffffff" stroke="#0f172a" stroke-width="2.8"/>' +
  '<circle cx="48" cy="48" r="39" fill="none" stroke="#1e3a8a" stroke-width="1"/>' +
  '<path d="M48 72V34" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M48 40c-12-3-21-12-24-21 12 2 21 8 24 15 3-7 12-13 24-15-3 9-12 18-24 21z" fill="#1e3a8a"/>' +
  '<path d="M48 52c-10 2-18 9-21 18 10-3 17-7 21-13 4 6 11 10 21 13-3-9-11-16-21-18z" fill="#0f172a"/>' +
  '<circle cx="48" cy="28" r="3.2" fill="#0f172a"/>' +
  '</svg>';

const ODOC_WATERMARK_SVG =
  '<svg class="odoc-wm-seal" viewBox="0 0 96 96" aria-hidden="true">' +
  '<circle cx="48" cy="48" r="44" fill="none" stroke="#0f172a" stroke-width="2.5"/>' +
  '<circle cx="48" cy="48" r="38" fill="none" stroke="#0f172a" stroke-width="0.8"/>' +
  '<path d="M48 72V34" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>' +
  '<path d="M48 40c-12-3-21-12-24-21 12 2 21 8 24 15 3-7 12-13 24-15-3 9-12 18-24 21z" fill="#0f172a"/>' +
  '<path d="M48 52c-10 2-18 9-21 18 10-3 17-7 21-13 4 6 11 10 21 13-3-9-11-16-21-18z" fill="#0f172a"/>' +
  '<circle cx="48" cy="28" r="3" fill="#0f172a"/>' +
  '</svg>';

function odocShell(titleKo, bodyHtml, titleEn) {
  titleEn = titleEn || 'OFFICIAL SCHOOL NOTICE';
  return (
    '<article class="odoc" data-builtin-version="' + BUILTIN_TEMPLATE_VERSION + '">' +
    '<div class="odoc-watermark" aria-hidden="true">' +
    '<div class="odoc-watermark-inner">' + ODOC_WATERMARK_SVG +
    '<div class="odoc-watermark-text">Salt Academy</div></div></div>' +
    '<div class="odoc-content">' +
    '<header class="odoc-inst">' +
    '<div class="odoc-emblem">' + ODOC_EMBLEM_SVG + '</div>' +
    '<div class="odoc-identity">' +
    '<div class="odoc-school">{school_name}</div>' +
    '<div class="odoc-school-meta">' +
    '<span class="odoc-meta-line">{school_address}</span>' +
    '<span class="odoc-meta-line">{school_contact_line}</span>' +
    '</div></div></header>' +
    '<div class="odoc-banner">' +
    '<div class="odoc-title-en">' + titleEn + '</div>' +
    '<h1 class="odoc-title">' + titleKo + '</h1>' +
    '<div class="odoc-docmeta"><span>문서번호 {doc_no}</span><span>시행일 {issue_date}</span></div>' +
    '</div>' +
    '<p class="odoc-to">수신: 학부모님 귀하 &nbsp;|&nbsp; 학생: {student_name} ({class_name})</p>' +
    '<hr class="odoc-rule">' +
    '<div class="odoc-body">' + bodyHtml + '</div>' +
    '<footer class="odoc-foot">' +
    '<p>끝.</p>' +
    '<p class="odoc-sign">{school_name}<br>교무행정실</p>' +
    '</footer>' +
    '</div></article>'
  );
}

function builtinTemplates() {
  return [
    {
      templateId: 'tpl_bus_survey',
      category: CATEGORIES.BusSurvey,
      title: '셔틀버스 1단계 수요 조사 안내',
      contentHtml: odocShell(
        '셔틀버스 이용 수요 조사 안내(1단계)',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 본교 <strong>{academic_year}</strong> 학년도 셔틀버스 노선 설계를 위하여 아래와 같이 ' +
        '<strong>수요 조사</strong>를 실시하오니, 확인 후 기한 내 응답하여 주시기 바랍니다.</p>' +
        '<p>3. 본 조사는 노선 수립을 위한 <strong>1단계</strong>이며, 최종 이용 신청은 노선·시간표 확정 후 ' +
        '<strong>2단계 신청서</strong>로 별도 진행됩니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>조사 내용</th><td>거주지(아파트·동), 이용 희망(등하원/등교/하교/자가), 희망 승하차 장소</td></tr>' +
        '<tr><th>제출 기한</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>4. 아래 응답란에 기재·서명한 후 제출하여 주시기 바랍니다.</p>',
        'OFFICIAL NOTICE'
      ),
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
      title: '셔틀버스 2단계 최종 이용 신청 안내',
      contentHtml: odocShell(
        '셔틀버스 최종 이용 신청 안내(2단계)',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 수요 조사 결과를 반영하여 셔틀버스 노선·시간표가 확정되었사오니, 학생 ' +
        '<strong>{student_name}</strong>의 <strong>등교·하교 호차</strong>를 선택하여 최종 신청하여 주시기 바랍니다.</p>' +
        '<p>3. 신청이 완료되면 해당 학생은 버스 Daily Board 탑승 명단에 반영됩니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>신청 내용</th><td>등교 호차, 하교 호차, 정류장(필요 시)</td></tr>' +
        '<tr><th>제출 기한</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>4. 아래 항목을 선택한 뒤 약관에 동의하고 서명하여 제출하여 주시기 바랍니다.</p>',
        'OFFICIAL APPLICATION'
      ),
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
      title: '현장 체험학습·야외활동 동의서',
      contentHtml: odocShell(
        '현장 체험학습 및 야외활동 동의서',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 본교는 아래와 같이 현장 체험학습(야외활동)을 실시하고자 하오니, 학생 ' +
        '<strong>{student_name}</strong>의 참가에 대한 동의 여부를 알려 주시기 바랍니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>일 시</th><td><strong>{trip_date}</strong></td></tr>' +
        '<tr><th>장 소</th><td><strong>{location}</strong></td></tr>' +
        '<tr><th>제출 기한</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>3. 활동 중 안전 수칙을 준수하며, 응급상황 발생 시 학교의 합리적 조치(응급처치·의료기관 이송 등)에 동의합니다.</p>' +
        '<p>4. 동의하지 않으실 경우 사유를 기재하여 제출하여 주시기 바랍니다.</p>',
        'OFFICIAL CONSENT FORM'
      ),
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
      title: '초상권·개인정보·학습결과물 활용 동의서',
      contentHtml: odocShell(
        '초상권 및 개인정보·학습 결과물 활용 동의서',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 본교 교육·홍보 활동의 일환으로 학생 <strong>{student_name}</strong>의 사진·영상 및 학습 결과물을 ' +
        '학교 소식, 포트폴리오, 공식 채널 등에 활용하고자 하오니 동의 여부를 알려 주시기 바랍니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>활용 범위</th><td>교내 게시, 학교 공식 소식/채널, 학습 포트폴리오(비상업적 교육 목적)</td></tr>' +
        '<tr><th>제출 기한</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>3. 동의하지 않으실 경우 해당 학생은 촬영·게시 대상에서 제외됩니다. 부동의 시 사유를 기재해 주세요.</p>',
        'OFFICIAL CONSENT FORM'
      ),
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
      title: '학생 건강 상태 확인 및 비상 응급처치 동의서',
      contentHtml: odocShell(
        '학생 건강 상태 확인 및 비상 응급처치 동의서',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 학생 <strong>{student_name}</strong>의 안전한 학교생활을 위하여 건강 상태 확인 및 비상 시 ' +
        '응급처치·의료기관 이송에 대한 동의를 받고자 합니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>동의 내용</th><td>비상 응급처치, 필요 시 의료기관 이송, 보호자 연락</td></tr>' +
        '<tr><th>제출 기한</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>3. 알레르기·복용약·특이사항은 학부모 포털의 학생 프로필(의료 정보)에 최신으로 반영해 주시기 바랍니다.</p>' +
        '<p>4. 동의하지 않으실 경우 사유를 기재하여 제출하여 주시기 바랍니다.</p>',
        'OFFICIAL CONSENT FORM'
      ),
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
      templateId: 'tpl_event_camp',
      category: CATEGORIES.Event,
      title: '특별 캠프·일회성 행사 참가 신청',
      contentHtml: odocShell(
        '특별 캠프 및 행사 참가 신청 안내',
        '<p>1. 귀 가정의 평안을 기원합니다.</p>' +
        '<p>2. 본교는 아래와 같이 <strong>특별 캠프·일회성 행사</strong>를 진행하오니, 학생 ' +
        '<strong>{student_name}</strong>의 참가 신청을 받습니다.</p>' +
        '<table class="odoc-table"><tbody>' +
        '<tr><th>대상 학생</th><td>{student_name} ({class_name})</td></tr>' +
        '<tr><th>행 사 명</th><td><strong>{event_title}</strong></td></tr>' +
        '<tr><th>일 시</th><td><strong>{event_date}</strong></td></tr>' +
        '<tr><th>장 소</th><td><strong>{location}</strong></td></tr>' +
        '<tr><th>참가비·준비물</th><td>{fee_supplies}</td></tr>' +
        '<tr><th>모집 정원</th><td>{capacity}명 (선착순, 초과 시 대기)</td></tr>' +
        '<tr><th>신청 마감</th><td><strong>{due_date}</strong></td></tr>' +
        '</tbody></table>' +
        '<p>3. 정원이 마감되면 자동으로 <strong>대기순번</strong>이 부여됩니다.</p>' +
        '<p>4. 참가(신청)를 선택하신 뒤 특이사항·준비물 확인 후 서명하여 제출하여 주시기 바랍니다.</p>',
        'OFFICIAL APPLICATION'
      ),
      fieldsJson: {
        kind: 'event',
        requireSignature: true,
        capacity: 20,
        eventDate: '',
        location: '',
        fee: '',
        supplies: '',
        firstCome: true,
        choices: [
          { value: 'Apply', label: '참가 신청' },
          { value: 'None', label: '신청하지 않음' }
        ],
        extraFields: ['eventNotes', 'suppliesAck']
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
  const byId = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) byId[String(rows[i][0])] = i + 1; // 1-based sheet row
  }
  const toAppend = [];
  for (const t of builtinTemplates()) {
    const sheetRow = byId[t.templateId];
    const row = [
      t.templateId,
      t.category,
      t.title,
      t.contentHtml,
      JSON.stringify(t.fieldsJson || {}),
      'N',
      nowIso()
    ];
    if (!sheetRow) {
      toAppend.push(row);
      continue;
    }
    // Refresh non-custom builtins when version changes (or content missing version marker)
    const existingHtml = String(rows[sheetRow - 1][3] || '');
    const isCustom = String(rows[sheetRow - 1][5] || 'N').toUpperCase() === 'Y';
    if (!isCustom && existingHtml.indexOf(BUILTIN_TEMPLATE_VERSION) < 0) {
      await updateRange(CONSENT_TEMPLATES_SHEET, `A${sheetRow}:G${sheetRow}`, [row]);
    }
  }
  if (toAppend.length) {
    await appendRows(CONSENT_TEMPLATES_SHEET, toAppend);
  }
  invalidateSheetRowsCache(CONSENT_TEMPLATES_SHEET);
}

function buildFormVars(form, student, classNames) {
  const published = String((form && form.publishedAt) || '').slice(0, 10);
  const phone = String(SCHOOL_PHONE || '').trim();
  const website = String(SCHOOL_WEBSITE || 'saltmorning.study').trim();
  const contactParts = [];
  if (phone) contactParts.push(phone);
  if (website) contactParts.push(website);
  const fields = (form && form.fieldsJson) || {};
  const fee = String(fields.fee || '').trim();
  const supplies = String(fields.supplies || '').trim();
  const feeSupplies = [fee, supplies].filter(Boolean).join(' / ') || '—';
  return {
    student_name: (student && student.name) || '',
    class_name: (classNames && student && classNames[student.classId]) || (student && student.classId) || '',
    due_date: (form && form.dueDate) || '—',
    academic_year: academicYearLabel(),
    school_name: SCHOOL_NAME,
    school_address: SCHOOL_ADDRESS || '',
    school_phone: phone,
    school_website: website,
    school_contact_line: contactParts.join(' · ') || website,
    event_title: (form && form.title) || '',
    event_date: String(fields.eventDate || fields.trip_date || '').trim() || '—',
    trip_date: String(fields.trip_date || fields.eventDate || '').trim() || '—',
    location: String(fields.location || '').trim() || '—',
    fee_supplies: feeSupplies,
    capacity: fields.capacity != null && fields.capacity !== '' ? String(fields.capacity) : '—',
    doc_no: 'SM-' + published.replace(/-/g, ''),
    issue_date: published || todaySeoul()
  };
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
  const id = String(row[0]);
  return {
    subId: id,
    submissionId: id,
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

async function deleteTemplate(templateId) {
  await ensureConsentSheets();
  templateId = String(templateId || '').trim();
  if (!templateId) throw Object.assign(new Error('Template ID required.'), { status: 400 });
  const rows = await getSheetRows(CONSENT_TEMPLATES_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== templateId) continue;
    await updateRange(CONSENT_TEMPLATES_SHEET, `A${i + 1}:G${i + 1}`, [new Array(7).fill('')]);
    invalidateSheetRowsCache(CONSENT_TEMPLATES_SHEET);
    return { deleted: true, templateId };
  }
  throw Object.assign(new Error('Template not found.'), { status: 404 });
}

async function listForms({ status, withStats } = {}) {
  await ensureConsentSheets();
  const rows = await getSheetRows(CONSENT_FORMS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const f = parseFormRow(rows[i]);
    if (!f) continue;
    if (f.status === 'Deleted') continue;
    if (status && f.status !== String(status)) continue;
    out.push(f);
  }
  out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  if (!withStats || !out.length) return out;

  const [subs, students] = await Promise.all([listSubmissions(), studentClassMap()]);
  const byForm = {};
  subs.forEach((s) => {
    if (!byForm[s.formId]) byForm[s.formId] = new Set();
    byForm[s.formId].add(s.studentId);
  });
  return out.map((f) => {
    const eligible = Object.keys(students)
      .map((id) => students[id])
      .filter((s) => formTargetsStudent(f, s));
    const submittedCount = eligible.filter((s) => (byForm[f.formId] || new Set()).has(s.studentId)).length;
    const total = eligible.length;
    const rate = total ? Math.round((submittedCount / total) * 1000) / 10 : 0;
    return Object.assign({}, f, {
      total,
      submittedCount,
      pendingCount: Math.max(0, total - submittedCount),
      rate
    });
  });
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

  // Notify parents (best-effort push + messenger)
  try {
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
    const body = 'New school form: 「' + title + '」. Please open Consents in the parent portal.';
    await Promise.all(Array.from(parentIds).map((pid) =>
      notifyParentChannels(pid, '', body, {
        title: 'New school form',
        body: title,
        url: '/parent#/consents'
      }).catch(() => null)
    ));
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

async function updatePublishedForm(formId, payload) {
  await ensureConsentSheets();
  formId = String(formId || '').trim();
  if (!formId) throw Object.assign(new Error('Form ID required.'), { status: 400 });
  const rows = await getSheetRows(CONSENT_FORMS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== formId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    if (payload.title != null) row[3] = String(payload.title).trim() || row[3];
    if (payload.contentHtml != null) row[4] = String(payload.contentHtml);
    if (payload.category != null) row[2] = String(payload.category).trim() || row[2];
    if (payload.targetGrades != null) row[6] = String(payload.targetGrades || '*');
    if (payload.dueDate != null) row[7] = String(payload.dueDate || '');
    if (payload.fieldsJson != null) {
      const fields = typeof payload.fieldsJson === 'object'
        ? payload.fieldsJson
        : parseJson(payload.fieldsJson, {});
      row[5] = JSON.stringify(fields || {});
    }
    if (payload.status === 'Active' || payload.status === 'Closed') row[8] = payload.status;
    await updateRange(CONSENT_FORMS_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_FORMS_SHEET);
    return parseFormRow(row);
  }
  throw Object.assign(new Error('Form not found.'), { status: 404 });
}

async function deleteForm(formId) {
  await ensureConsentSheets();
  formId = String(formId || '').trim();
  const rows = await getSheetRows(CONSENT_FORMS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== formId) continue;
    const row = rows[i].slice();
    while (row.length < 11) row.push('');
    row[8] = 'Deleted';
    await updateRange(CONSENT_FORMS_SHEET, `A${i + 1}:K${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_FORMS_SHEET);
    return { deleted: true, formId };
  }
  throw Object.assign(new Error('Form not found.'), { status: 404 });
}

async function rewriteSubmissionExtra(submissionId, mutator) {
  const rows = await getSheetRows(CONSENT_SUBMISSIONS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(submissionId)) continue;
    const row = rows[i].slice();
    while (row.length < 9) row.push('');
    const extra = parseJson(row[6], {});
    const next = mutator(extra, parseSubRow(row)) || extra;
    row[6] = JSON.stringify(next);
    await updateRange(CONSENT_SUBMISSIONS_SHEET, `A${i + 1}:I${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_SUBMISSIONS_SHEET);
    return parseSubRow(row);
  }
  throw Object.assign(new Error('Submission not found.'), { status: 404 });
}

async function renumberWaitlist(formId) {
  const subs = await listSubmissions(formId);
  const waiting = subs
    .filter((s) => (s.extraData && s.extraData.registrationStatus) === 'Waiting')
    .sort((a, b) => Number(a.extraData.waitNumber || 9999) - Number(b.extraData.waitNumber || 9999) ||
      String(a.submittedAt).localeCompare(String(b.submittedAt)));
  let n = 1;
  for (const s of waiting) {
    if (Number(s.extraData.waitNumber) === n) {
      n += 1;
      continue;
    }
    await rewriteSubmissionExtra(s.submissionId, (extra) => {
      extra.registrationStatus = 'Waiting';
      extra.waitNumber = n;
      return extra;
    });
    n += 1;
  }
}

async function promoteWaitingSubmission(formId, submissionId) {
  formId = String(formId || '').trim();
  submissionId = String(submissionId || '').trim();
  const form = await getForm(formId);
  const fields = form.fieldsJson || {};
  const capacity = Number(fields.capacity) || 0;
  const subs = await listSubmissions(formId);
  const target = subs.find((s) => s.submissionId === submissionId);
  if (!target) throw Object.assign(new Error('Submission not found.'), { status: 404 });
  if ((target.extraData && target.extraData.registrationStatus) !== 'Waiting') {
    throw Object.assign(new Error('Only waiting registrations can be promoted.'), { status: 400 });
  }
  if (capacity > 0) {
    const confirmed = subs.filter((s) =>
      (s.agreed === 'Apply' || s.agreed === 'Y') &&
      ((s.extraData && s.extraData.registrationStatus) || 'Confirmed') === 'Confirmed'
    ).length;
    if (confirmed >= capacity) {
      throw Object.assign(new Error('No open capacity. Cancel a confirmed spot first.'), { status: 400 });
    }
  }
  const updated = await rewriteSubmissionExtra(submissionId, (extra) => {
    extra.registrationStatus = 'Confirmed';
    extra.waitNumber = '';
    extra.promotedAt = nowIso();
    return extra;
  });
  await renumberWaitlist(formId);
  try {
    if (updated.parentId) {
      await notifyParentChannels(
        updated.parentId,
        updated.studentId,
        'You have been confirmed for 「' + form.title + '」. Open Forms in the parent portal.',
        {
          title: 'Camp/event confirmed',
          body: form.title + ' — your waiting spot was promoted.',
          url: '/parent#/consents'
        }
      );
    }
  } catch (_) { /* optional */ }
  return updated;
}

async function cancelEventRegistration(formId, submissionId, opts) {
  opts = opts || {};
  formId = String(formId || '').trim();
  submissionId = String(submissionId || '').trim();
  const form = await getForm(formId);
  const subs = await listSubmissions(formId);
  const target = subs.find((s) => s.submissionId === submissionId);
  if (!target) throw Object.assign(new Error('Submission not found.'), { status: 404 });
  const wasConfirmed = ((target.extraData && target.extraData.registrationStatus) || 'Confirmed') === 'Confirmed';

  const rows = await getSheetRows(CONSENT_SUBMISSIONS_SHEET, { skipCache: true });
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== submissionId) continue;
    const row = rows[i].slice();
    while (row.length < 9) row.push('');
    const extra = parseJson(row[6], {});
    extra.registrationStatus = 'Cancelled';
    extra.waitNumber = '';
    extra.cancelledAt = nowIso();
    extra.cancelReason = String(opts.reason || 'Cancelled by school').slice(0, 200);
    row[4] = 'Cancelled';
    row[6] = JSON.stringify(extra);
    await updateRange(CONSENT_SUBMISSIONS_SHEET, `A${i + 1}:I${i + 1}`, [row]);
    invalidateSheetRowsCache(CONSENT_SUBMISSIONS_SHEET);

    if (wasConfirmed && opts.autoPromote !== false) {
      const waiting = (await listSubmissions(formId))
        .filter((s) => (s.extraData && s.extraData.registrationStatus) === 'Waiting')
        .sort((a, b) => Number(a.extraData.waitNumber || 9999) - Number(b.extraData.waitNumber || 9999));
      if (waiting[0]) {
        await promoteWaitingSubmission(formId, waiting[0].submissionId);
      }
    } else {
      await renumberWaitlist(formId);
    }

    try {
      if (target.parentId) {
        await notifyParentChannels(
          target.parentId,
          target.studentId,
          'Registration cancelled for 「' + form.title + '」.',
          {
            title: 'Registration cancelled',
            body: form.title,
            url: '/parent#/consents'
          }
        );
      }
    } catch (_) { /* optional */ }
    return parseSubRow(row);
  }
  throw Object.assign(new Error('Submission not found.'), { status: 404 });
}

async function clearSubmissionsForStudent(studentId) {
  studentId = String(studentId || '').trim();
  if (!studentId) return { cleared: 0 };
  const rows = await getSheetRows(CONSENT_SUBMISSIONS_SHEET, { skipCache: true });
  let cleared = 0;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) !== studentId) continue;
    await updateRange(CONSENT_SUBMISSIONS_SHEET, `A${i + 1}:I${i + 1}`, [new Array(9).fill('')]);
    cleared += 1;
  }
  if (cleared) invalidateSheetRowsCache(CONSENT_SUBMISSIONS_SHEET);
  return { cleared };
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
    const vars = buildFormVars(form, student, classNames);
    const fields = form.fieldsJson || {};
    let eventMeta = null;
    if (fields.kind === 'event' || form.category === CATEGORIES.Event) {
      const allSubs = subs.filter((s) => s.formId === form.formId && (s.agreed === 'Apply' || s.agreed === 'Y'));
      const confirmedCount = allSubs.filter((s) =>
        ((s.extraData && s.extraData.registrationStatus) || 'Confirmed') === 'Confirmed'
      ).length;
      const capacity = Number(fields.capacity) || 0;
      eventMeta = {
        capacity,
        confirmedCount,
        spotsLeft: capacity > 0 ? Math.max(0, capacity - confirmedCount) : null,
        isFull: capacity > 0 && confirmedCount >= capacity,
        eventDate: fields.eventDate || '',
        location: fields.location || '',
        fee: fields.fee || '',
        supplies: fields.supplies || ''
      };
    }
    pending.push({
      formId: form.formId,
      category: form.category,
      title: form.title,
      dueDate: form.dueDate,
      fieldsJson: form.fieldsJson,
      contentHtml: applyVariables(form.contentHtml, vars),
      studentId,
      studentName: student.name,
      eventMeta
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
  const vars = buildFormVars(form, student, classNames);
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

  // Event / camp first-come capacity → Confirmed or Waiting
  if (kind === 'event' && (agreed === 'Apply' || agreed === 'Y')) {
    const capacity = Number(fields.capacity);
    const existingRegs = existing.filter((s) =>
      (s.agreed === 'Apply' || s.agreed === 'Y')
    );
    const confirmed = existingRegs.filter((s) => {
      const st = (s.extraData && s.extraData.registrationStatus) || 'Confirmed';
      return st === 'Confirmed';
    });
    if (capacity > 0 && confirmed.length >= capacity) {
      const waitingAhead = existingRegs.filter((s) =>
        (s.extraData && s.extraData.registrationStatus) === 'Waiting'
      ).length;
      extra.registrationStatus = 'Waiting';
      extra.waitNumber = waitingAhead + 1;
    } else {
      extra.registrationStatus = 'Confirmed';
      extra.waitNumber = '';
    }
    extra.eventNotes = String(extra.eventNotes || '').trim().slice(0, 500);
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
      const sub = byStudent[s.studentId];
      submitted.push(Object.assign({}, row, {
        submissionId: sub.submissionId,
        agreed: sub.agreed,
        disagreedReason: sub.disagreedReason,
        submittedAt: sub.submittedAt,
        extraData: sub.extraData,
        hasSignature: !!(sub.signatureBase64 && String(sub.signatureBase64).length > 32)
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
    clusters: Object.keys(clusters).map((k) => clusters[k]).sort((a, b) => b.count - a.count),
    eventStats: (form.fieldsJson && form.fieldsJson.kind === 'event') || form.category === CATEGORIES.Event
      ? {
          capacity: Number(form.fieldsJson && form.fieldsJson.capacity) || 0,
          confirmed: submitted.filter((s) =>
            (s.agreed === 'Apply' || s.agreed === 'Y') &&
            ((s.extraData && s.extraData.registrationStatus) || 'Confirmed') === 'Confirmed'
          ).length,
          waiting: submitted.filter((s) =>
            (s.extraData && s.extraData.registrationStatus) === 'Waiting'
          ).length
        }
      : null
  };
}

async function notifyParentChannels(parentId, studentId, messageBody, pushPayload) {
  let pushSent = 0;
  let messengerSent = 0;
  try {
    const push = require('./pushService');
    if (push.isPushEnabled() && parentId) {
      await push.sendToParent(parentId, pushPayload);
      pushSent = 1;
    }
  } catch (_) { /* optional */ }

  try {
    const {
      parentAdminThreadId,
      sendThreadMessage
    } = require('./messengerService');
    const session = {
      role: 'admin',
      adminId: 'system',
      name: 'School Office'
    };
    // Use a synthetic admin session for office → parent thread
    const tid = parentAdminThreadId(parentId);
    // Parent-admin threads expect parent or admin; send as admin
    const msg = await sendThreadMessage(tid, Object.assign({}, session, {
      role: 'admin',
      adminId: 'office'
    }), messageBody);
    let realtime;
    try { realtime = require('../realtime'); } catch (_) { realtime = null; }
    if (realtime && realtime.notifyNewMessage) realtime.notifyNewMessage(tid, msg);
    messengerSent = 1;
  } catch (e) {
    console.warn('[consent] messenger notify failed:', e.message || e);
  }
  return { pushSent, messengerSent };
}

async function listSubmittedForParent(session) {
  const parentId = String(session.parentId || '').trim();
  const studentId = String(session.studentId || '').trim();
  if (!parentId || !studentId) return { submitted: [], count: 0 };

  const [forms, subs] = await Promise.all([
    listForms({}),
    listSubmissions()
  ]);
  const formMap = {};
  forms.forEach((f) => { formMap[f.formId] = f; });
  const mine = subs
    .filter((s) => s.studentId === studentId &&
      (!s.parentId || String(s.parentId) === parentId))
    .map((s) => {
      const form = formMap[s.formId] || {};
      return {
        formId: s.formId,
        title: form.title || s.formId,
        category: form.category || '',
        agreed: s.agreed,
        submittedAt: s.submittedAt,
        registrationStatus: (s.extraData && s.extraData.registrationStatus) || '',
        waitNumber: (s.extraData && s.extraData.waitNumber) || '',
        eventNotes: (s.extraData && s.extraData.eventNotes) || '',
        status: form.status || ''
      };
    })
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return { submitted: mine, count: mine.length };
}

async function remindPending(formId) {
  const analytics = await getFormAnalytics(formId);
  const { listParentsForStudent } = require('./parentRegistryService');
  let sent = 0;
  let messenger = 0;
  let skipped = 0;
  for (const p of analytics.pending) {
    const parents = await listParentsForStudent(p.studentId).catch(() => []);
    if (!parents || !parents.length) {
      skipped += 1;
      continue;
    }
    for (const parent of parents || []) {
      const pid = typeof parent === 'string' ? parent : parent.parentId;
      if (!pid) continue;
      const body = 'Reminder: please submit 「' + analytics.form.title + '」 for ' +
        (p.name || p.studentId) + '. Open Consents in the parent portal.';
      const result = await notifyParentChannels(pid, p.studentId, body, {
        title: 'Reminder: school form',
        body: analytics.form.title + ' — please submit for ' + (p.name || p.studentId),
        url: '/parent#/consents'
      });
      sent += result.pushSent;
      messenger += result.messengerSent;
    }
  }
  return {
    sent,
    messenger,
    pending: analytics.pendingCount,
    skipped,
    reason: (!sent && !messenger) ? 'No push/messenger delivery' : ''
  };
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
  deleteTemplate,
  listForms,
  getForm,
  publishForm,
  closeForm,
  updatePublishedForm,
  deleteForm,
  promoteWaitingSubmission,
  cancelEventRegistration,
  clearSubmissionsForStudent,
  listPendingForParent,
  listSubmittedForParent,
  getParentFormDetail,
  submitConsent,
  getFormAnalytics,
  remindPending,
  renderSubmissionsPrintHtml,
  applyVariables,
  builtinTemplates,
  notifyParentChannels
};
