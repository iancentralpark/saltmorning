'use strict';

const fs = require('fs');
const path = require('path');
const { SCHOOL_NAME, SCHOOL_ADDRESS } = require('../config');
const { getStudent } = require('./studentRegistryService');
const { getStudentYearAttendance } = require('./attendanceService');
const { defaultAcademicYearRange } = require('./schoolCalendarService');
const { getStudentGradeSummary } = require('./gradeService');
const { listGradeTerms } = require('./gradeWeightService');
const { getStudentDollars } = require('./dollarService');
const { getStudentVocabSummary } = require('./vocabShared');
const { academicYearLabel, termDisplayLabel } = require('./reportCardPrint');
const {
  getFullStudentReportCard
} = require('./reportCardService');
const {
  getTeacherHeadId,
  loadSignatureAsset
} = require('./reportCardWorkflowService');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'official-transcript.html');

const LABELS = {
  en: {
    docTitle: 'Official Student Cumulative Record',
    lblStudentProfile: 'Student profile',
    lblAcademicStanding: 'Academic standing',
    lblName: 'Name',
    lblStudentId: 'Student ID',
    lblDateOfBirth: 'Date of birth',
    lblEnrolled: 'Enrollment date',
    lblEmergency: 'Emergency contact',
    lblGrade: 'Grade',
    lblClass: 'Class',
    lblAcademicYear: 'Academic year',
    lblIssueDate: 'Date of issue',
    lblStatus: 'Status',
    lblAttendance: 'Attendance & engagement summary',
    lblAttendanceRate: 'Attendance rate',
    lblPresent: 'Present',
    lblTardy: 'Tardy',
    lblAbsent: 'Absent',
    lblEarlyLeave: 'Early leave',
    lblSchoolDays: 'School days',
    lblAcademic: 'Academic performance (transcript)',
    lblVocab: 'Vocab Booster progress',
    lblPlacement: 'Placement',
    lblCurrentLevel: 'Current level',
    lblMastery: 'Mastery / studied',
    lblStreak: 'Streak',
    lblObservations: "Teacher's cumulative observations",
    lblHomeroom: 'Homeroom teacher',
    lblHeadTeacher: 'Head teacher',
    lblPrincipal: 'Principal',
    thTerm: 'Term',
    thSubject: 'Subject',
    thScore: 'Score',
    thGrade: 'Grade',
    thComment: 'Comment',
    noGrades: 'No graded subjects recorded for this academic year yet.',
    notPlaced: 'Placement not completed',
    certification:
      'This document is an official record of Salt Academy Morning Class. ' +
      'It summarizes attendance, academic performance, vocabulary progress, and teacher observations ' +
      'for the named student. Alteration or unauthorized reproduction is prohibited.',
    na: '—'
  },
  ko: {
    docTitle: '학생 종합 행정 이력서 (Official Cumulative Record)',
    lblStudentProfile: '학생 기본 정보',
    lblAcademicStanding: '학적 정보',
    lblName: '이름',
    lblStudentId: '학번',
    lblDateOfBirth: '생년월일',
    lblEnrolled: '입학일',
    lblEmergency: '비상연락처',
    lblGrade: '학년',
    lblClass: '학급',
    lblAcademicYear: '학년도',
    lblIssueDate: '발급일',
    lblStatus: '상태',
    lblAttendance: '출석·참여 요약',
    lblAttendanceRate: '출석률',
    lblPresent: '출석',
    lblTardy: '지각',
    lblAbsent: '결석',
    lblEarlyLeave: '조퇴',
    lblSchoolDays: '수업일수',
    lblAcademic: '학업 성적 (Transcript)',
    lblVocab: 'Vocab Booster 진행',
    lblPlacement: '배치테스트',
    lblCurrentLevel: '현재 레벨',
    lblMastery: '숙달 / 학습량',
    lblStreak: '연속 학습',
    lblObservations: '담임 종합 소견',
    lblHomeroom: '담임교사',
    lblHeadTeacher: '헤드티처',
    lblPrincipal: '원장',
    thTerm: '학기',
    thSubject: '과목',
    thScore: '점수',
    thGrade: '등급',
    thComment: '코멘트',
    noGrades: '해당 학년도 성적이 아직 없습니다.',
    notPlaced: '배치 미완료',
    certification:
      '본 서류는 Salt Academy Morning Class의 공식 학적·성적 기록입니다. ' +
      '출석, 학업 성적, 어휘 학습, 교사 소견을 요약하며 무단 변조·복제를 금합니다.',
    na: '—'
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function letterGrade(pct) {
  if (pct == null || pct === '' || Number.isNaN(Number(pct))) return '';
  const p = Number(pct);
  if (p >= 93) return 'A';
  if (p >= 90) return 'A-';
  if (p >= 87) return 'B+';
  if (p >= 83) return 'B';
  if (p >= 80) return 'B-';
  if (p >= 77) return 'C+';
  if (p >= 73) return 'C';
  if (p >= 70) return 'C-';
  if (p >= 67) return 'D+';
  if (p >= 60) return 'D';
  return 'F';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Math.round(Number(n) * 10) / 10 + '%';
}

function summarizeDollarReasons(transactions) {
  const counts = {};
  (transactions || []).forEach((tx) => {
    const reason = String(tx.reason || '').trim();
    if (!reason || reason === 'manual-adjust') return;
    const key = reason.length > 40 ? reason.slice(0, 40) + '…' : reason;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 6)
    .map((k) => ({ label: k, count: counts[k] }));
}

function sigToDataUri(asset) {
  if (!asset || !asset.buffer) return '';
  const mime = asset.mime || 'image/png';
  return 'data:' + mime + ';base64,' + asset.buffer.toString('base64');
}

async function loadSigDataUri(personId) {
  if (!personId) return '';
  try {
    const asset = await loadSignatureAsset(personId);
    return sigToDataUri(asset);
  } catch (_) {
    return '';
  }
}

/**
 * Aggregate all transcript source data for one student.
 */
async function getStudentCumulativeData(studentId, opts) {
  opts = opts || {};
  studentId = String(studentId || '').trim();
  if (!studentId) throw Object.assign(new Error('Student ID is required.'), { status: 400 });

  const student = await getStudent(studentId);
  const profile = student.profile || {};
  const classId = String(student.classId || '').trim();
  const range = defaultAcademicYearRange();
  const yearLabel = academicYearLabel();

  let attendance = {
    schoolDays: 0,
    present: 0,
    tardy: 0,
    absent: 0,
    earlyLeave: 0,
    rate: null,
    yearLabel
  };
  if (classId) {
    try {
      const yearAtt = await getStudentYearAttendance(classId, studentId, range.start, range.end);
      const s = (yearAtt && yearAtt.summary) || {};
      const present = Number(s.present || 0) + Number(s.earlyLeave || 0) + Number(s.earlyLeaveExcused || 0);
      const tardy = Number(s.tardy || 0) + Number(s.tardyExcused || 0);
      const absent = Number(s.absent || 0) + Number(s.absentExcused || 0);
      const earlyLeave = Number(s.earlyLeave || 0) + Number(s.earlyLeaveExcused || 0);
      const schoolDays = Number(yearAtt.schoolDays || s.schoolDays || 0);
      const rate = schoolDays > 0 ? (present / schoolDays) * 100 : null;
      attendance = {
        schoolDays,
        present: Number(s.present || 0),
        tardy,
        absent,
        earlyLeave,
        rate,
        yearLabel: yearAtt.yearLabel || yearLabel
      };
    } catch (_) { /* keep defaults */ }
  }

  let dollars = { balance: 0, transactions: [], reasonTags: [] };
  try {
    const d = await getStudentDollars(studentId);
    dollars = {
      balance: Number(d.balance || 0),
      transactions: d.transactions || [],
      reasonTags: summarizeDollarReasons(d.transactions)
    };
  } catch (_) { /* optional */ }

  let vocab = null;
  try {
    vocab = await getStudentVocabSummary(studentId, classId || '');
  } catch (_) {
    vocab = null;
  }

  const termRows = classId
    ? await listGradeTerms(classId).catch(() => [])
    : [];
  let termLabels = termRows.map((t) => t.label).filter(Boolean);
  if (!termLabels.length) termLabels = ['Term1', 'Term2'];

  const gradeRows = [];
  const comments = [];
  let homeroomTeacherId = '';
  let homeroomTeacherName = '';
  let headTeacherId = '';
  let workflowSigs = {
    homeroomSigPath: '',
    headSigPath: '',
    principalSigPath: '',
    homeroomSignedAt: '',
    headSignedAt: '',
    principalSignedAt: ''
  };

  for (const term of termLabels) {
    let usedReportCard = false;
    if (classId) {
      try {
        const card = await getFullStudentReportCard(
          opts.viewerId || 'admin',
          classId,
          studentId,
          term,
          { bypassAccess: true }
        );
        usedReportCard = true;
        if (!homeroomTeacherId && card.homeroomTeacherId) {
          homeroomTeacherId = card.homeroomTeacherId;
          homeroomTeacherName = card.homeroomTeacherName || '';
        }
        if (card.workflow) {
          // Prefer the most-signed workflow for seal block
          if (card.workflow.principalSigPath || card.workflow.headSigPath || card.workflow.homeroomSigPath) {
            workflowSigs = {
              homeroomSigPath: card.workflow.homeroomSigPath || workflowSigs.homeroomSigPath,
              headSigPath: card.workflow.headSigPath || workflowSigs.headSigPath,
              principalSigPath: card.workflow.principalSigPath || workflowSigs.principalSigPath,
              homeroomSignedAt: card.workflow.homeroomSignedAt || workflowSigs.homeroomSignedAt,
              headSignedAt: card.workflow.headSignedAt || workflowSigs.headSignedAt,
              principalSignedAt: card.workflow.principalSignedAt || workflowSigs.principalSignedAt
            };
          }
        }
        (card.subjects || []).forEach((subj) => {
          gradeRows.push({
            term,
            termLabel: termDisplayLabel(term),
            subject: subj.subject,
            score: subj.percentageGrade,
            letter: subj.letterGrade || letterGrade(subj.percentageGrade),
            comment: subj.subjectComment || ''
          });
          if (subj.subjectComment) {
            comments.push({
              term: termDisplayLabel(term),
              subject: subj.subject,
              text: String(subj.subjectComment).trim()
            });
          }
        });
      } catch (_) {
        usedReportCard = false;
      }
    }
    if (!usedReportCard) {
      try {
        const summary = await getStudentGradeSummary(studentId, { term });
        (summary.subjects || []).forEach((subj) => {
          gradeRows.push({
            term,
            termLabel: termDisplayLabel(term),
            subject: subj.subject,
            score: subj.finalGrade,
            letter: letterGrade(subj.finalGrade),
            comment: ''
          });
        });
      } catch (_) { /* optional */ }
    }
  }

  if (homeroomTeacherId) {
    headTeacherId = await getTeacherHeadId(homeroomTeacherId).catch(() => '');
  }

  const { teacherDisplayNameMap } = require('./teacherRegistryService');
  const names = await teacherDisplayNameMap().catch(() => ({}));
  const headName = headTeacherId ? (names[headTeacherId] || headTeacherId) : '';
  let principalName = 'Principal';
  try {
    const { listTeachersWithProfiles } = require('./teacherRegistryService');
    const faculty = await listTeachersWithProfiles();
    const principal = (faculty || []).find((t) =>
      /^principal$/i.test(String(t.staffTitle || t.staffRole || ''))
    );
    if (principal) principalName = principal.displayName || principal.name || principalName;
  } catch (_) { /* optional */ }

  const teacherComments = comments.length
    ? comments.map((c) => '[' + c.term + ' · ' + c.subject + ']\n' + c.text).join('\n\n')
    : '';

  return {
    schoolName: SCHOOL_NAME,
    schoolAddress: SCHOOL_ADDRESS,
    academicYear: attendance.yearLabel || yearLabel,
    issueDate: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    student: {
      studentId: student.studentId,
      name: student.name || '',
      classId,
      className: student.className || classId || '',
      status: student.status || '',
      gradeLevel: profile.gradeLevel || student.gradeLevel || '',
      dateOfBirth: profile.dateOfBirth || '',
      enrolledDate: profile.enrolledDate || '',
      emergencyContact: [profile.emergencyContact, profile.emergencyPhone].filter(Boolean).join(' · ')
        || [profile.parentName, profile.parentPhone].filter(Boolean).join(' · ')
        || '',
      photoPath: profile.photoPath || student.photoPath || ''
    },
    attendance,
    dollars,
    vocab,
    grades: gradeRows,
    teacherComments,
    signatures: {
      homeroomTeacherId,
      homeroomTeacherName: homeroomTeacherName || (homeroomTeacherId && names[homeroomTeacherId]) || '',
      headTeacherId,
      headTeacherName: headName,
      principalName,
      ...workflowSigs
    }
  };
}

function renderGradesTableHtml(grades, labels) {
  if (!grades || !grades.length) {
    return '<p class="muted">' + escapeHtml(labels.noGrades) + '</p>';
  }
  let html = '<table class="data-table"><thead><tr>' +
    '<th>' + escapeHtml(labels.thTerm) + '</th>' +
    '<th>' + escapeHtml(labels.thSubject) + '</th>' +
    '<th>' + escapeHtml(labels.thScore) + '</th>' +
    '<th>' + escapeHtml(labels.thGrade) + '</th>' +
    '<th>' + escapeHtml(labels.thComment) + '</th>' +
    '</tr></thead><tbody>';
  grades.forEach((g) => {
    const score = g.score == null || g.score === '' ? labels.na : (Math.round(Number(g.score) * 10) / 10);
    html += '<tr>' +
      '<td>' + escapeHtml(g.termLabel || g.term) + '</td>' +
      '<td>' + escapeHtml(g.subject) + '</td>' +
      '<td>' + escapeHtml(score) + '</td>' +
      '<td>' + escapeHtml(g.letter || labels.na) + '</td>' +
      '<td>' + escapeHtml(g.comment || labels.na) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderDollarTagsHtml(tags) {
  if (!tags || !tags.length) return '';
  return '<div class="tags">' + tags.map((t) =>
    '<span class="tag">' + escapeHtml(t.label) + (t.count > 1 ? ' ×' + t.count : '') + '</span>'
  ).join('') + '</div>';
}

function sigImgHtml(dataUri) {
  if (!dataUri) return '<div class="muted" style="height:42px"></div>';
  return '<img src="' + dataUri + '" alt="Signature">';
}

function fillTemplate(template, map) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    (map[key] != null ? String(map[key]) : '')
  );
}

async function renderTranscriptHtml(data, lang) {
  lang = String(lang || 'en').toLowerCase() === 'ko' ? 'ko' : 'en';
  const labels = LABELS[lang];
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const s = data.student || {};
  const a = data.attendance || {};
  const v = data.vocab || {};
  const sig = data.signatures || {};

  const [homeroomUri, headUri, principalUri] = await Promise.all([
    loadSigDataUri(sig.homeroomTeacherId),
    loadSigDataUri(sig.headTeacherId),
    // Principal signature is stored under principal / teacher id — try known paths
    (async () => {
      if (sig.principalSigPath && String(sig.principalSigPath).startsWith('/api/signatures/')) {
        const pid = String(sig.principalSigPath).split('/').pop();
        return loadSigDataUri(pid);
      }
      // fall back: leadership principal account
      return loadSigDataUri('T_PRINCIPAL');
    })()
  ]);

  const masteryBits = [];
  if (v && v.mastery && v.mastery.studiedCount != null) {
    masteryBits.push(String(v.mastery.studiedCount) + ' words');
  } else if (v && v.today && v.today.studiedCount != null) {
    masteryBits.push('today ' + v.today.studiedCount);
  }
  if (v && v.promotionPercent != null && v.placementDone) {
    masteryBits.push(Math.round(v.promotionPercent) + '% to promote');
  }

  const map = Object.assign({}, labels, {
    lang,
    schoolName: escapeHtml(data.schoolName || SCHOOL_NAME),
    schoolAddress: escapeHtml(data.schoolAddress || SCHOOL_ADDRESS),
    studentName: escapeHtml(s.name || ''),
    studentId: escapeHtml(s.studentId || ''),
    dateOfBirth: escapeHtml(s.dateOfBirth || labels.na),
    enrolledDate: escapeHtml(s.enrolledDate || labels.na),
    emergencyContact: escapeHtml(s.emergencyContact || labels.na),
    gradeLevel: escapeHtml(s.gradeLevel || labels.na),
    className: escapeHtml(s.className || labels.na),
    academicYear: escapeHtml(data.academicYear || ''),
    issueDate: escapeHtml(data.issueDate || ''),
    status: escapeHtml(s.status || labels.na),
    attendanceRate: escapeHtml(a.rate == null ? labels.na : fmtPct(a.rate)),
    present: escapeHtml(a.present != null ? a.present : labels.na),
    tardy: escapeHtml(a.tardy != null ? a.tardy : labels.na),
    absent: escapeHtml(a.absent != null ? a.absent : labels.na),
    earlyLeave: escapeHtml(a.earlyLeave != null ? a.earlyLeave : labels.na),
    schoolDays: escapeHtml(a.schoolDays != null ? a.schoolDays : labels.na),
    dollarsBalance: escapeHtml(String((data.dollars && data.dollars.balance) || 0)),
    dollarTagsHtml: renderDollarTagsHtml((data.dollars && data.dollars.reasonTags) || []),
    gradesTableHtml: renderGradesTableHtml(data.grades || [], labels),
    vocabPlacement: escapeHtml(
      v && v.placementDone
        ? ((v.placementAccuracy != null
          ? (Number(v.placementAccuracy) <= 1
            ? Math.round(Number(v.placementAccuracy) * 1000) / 10
            : Math.round(Number(v.placementAccuracy) * 10) / 10) + '% · '
          : '') +
          (v.placementAt ? fmtDate(v.placementAt) : 'Placed'))
        : labels.notPlaced
    ),
    vocabLevel: escapeHtml(
      (v && (v.tierLabel || v.tierName)) || labels.na
    ),
    vocabMastery: escapeHtml(masteryBits.join(' · ') || labels.na),
    vocabStreak: escapeHtml(
      v && v.streakDays != null
        ? (v.streakDays + ' days' + (v.longestStreak ? ' (best ' + v.longestStreak + ')' : ''))
        : labels.na
    ),
    teacherComments: escapeHtml(data.teacherComments || labels.na),
    homeroomSigHtml: sigImgHtml(homeroomUri),
    headSigHtml: sigImgHtml(headUri),
    principalSigHtml: sigImgHtml(principalUri),
    homeroomName: escapeHtml(sig.homeroomTeacherName || labels.na),
    headName: escapeHtml(sig.headTeacherName || labels.na),
    principalName: escapeHtml(sig.principalName || 'Principal'),
    homeroomSignedAt: escapeHtml(fmtDate(sig.homeroomSignedAt) || ''),
    headSignedAt: escapeHtml(fmtDate(sig.headSignedAt) || ''),
    principalSignedAt: escapeHtml(fmtDate(sig.principalSignedAt) || ''),
    generatedAt: escapeHtml('Generated ' + (data.generatedAt || new Date().toISOString()))
  });

  return fillTemplate(template, map);
}

async function renderTranscriptPdf(html) {
  let chromium;
  let puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    const err = new Error('PDF engine is not installed on this server.');
    err.status = 503;
    err.code = 'PDF_ENGINE_MISSING';
    throw err;
  }

  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

function transcriptFilename(data) {
  const id = String((data.student && data.student.studentId) || 'Student').replace(/[^\w.-]+/g, '_');
  const name = String((data.student && data.student.name) || 'Student').replace(/[^\w.-]+/g, '_');
  return 'Official_Transcript_' + id + '_' + name + '.pdf';
}

module.exports = {
  getStudentCumulativeData,
  renderTranscriptHtml,
  renderTranscriptPdf,
  transcriptFilename,
  LABELS
};
