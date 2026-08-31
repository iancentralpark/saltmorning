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
const { academicYearLabel, termDisplayLabel } = require('./reportCardPrint');
const { getFullStudentReportCard } = require('./reportCardService');
const { loadSignatureAsset } = require('./reportCardWorkflowService');

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
    lblPrincipal: 'Principal',
    thTerm: 'Term',
    thSubject: 'Subject',
    thScore: 'Score',
    thGrade: 'Grade',
    noGrades: 'No graded subjects recorded for this academic year yet.',
    certification:
      'This document is an official record of Salt Academy Morning Class. ' +
      'It summarizes enrollment, attendance, and academic performance for the named student. ' +
      'Alteration or unauthorized reproduction is prohibited.',
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
    lblPrincipal: '원장',
    thTerm: '학기',
    thSubject: '과목',
    thScore: '점수',
    thGrade: '등급',
    noGrades: '해당 학년도 성적이 아직 없습니다.',
    certification:
      '본 서류는 Salt Academy Morning Class의 공식 학적·성적 기록입니다. ' +
      '학적, 출석, 학업 성적을 요약하며 무단 변조·복제를 금합니다.',
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

async function resolvePrincipal(faculty) {
  const principal = (faculty || []).find((t) =>
    /^principal$/i.test(String(t.staffTitle || t.staffRole || ''))
  );
  return {
    principalId: principal ? principal.teacherId : 'T_PRINCIPAL',
    principalName: principal
      ? (principal.displayName || principal.name || 'Principal')
      : 'Principal'
  };
}

/**
 * Aggregate official transcript data (objective records only).
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

  const termRows = classId
    ? await listGradeTerms(classId).catch(() => [])
    : [];
  let termLabels = termRows.map((t) => t.label).filter(Boolean);
  if (!termLabels.length) termLabels = ['Term1', 'Term2'];

  const gradeRows = [];
  let principalSignedAt = '';
  let principalSigPersonId = '';

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
        if (card.workflow && card.workflow.principalSignedAt) {
          principalSignedAt = card.workflow.principalSignedAt;
        }
        if (card.workflow && card.workflow.principalSigPath) {
          const parts = String(card.workflow.principalSigPath).split('/');
          principalSigPersonId = parts[parts.length - 1] || principalSigPersonId;
        }
        (card.subjects || []).forEach((subj) => {
          gradeRows.push({
            term,
            termLabel: termDisplayLabel(term),
            subject: subj.subject,
            score: subj.percentageGrade,
            letter: subj.letterGrade || letterGrade(subj.percentageGrade)
          });
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
            letter: letterGrade(subj.finalGrade)
          });
        });
      } catch (_) { /* optional */ }
    }
  }

  let faculty = [];
  try {
    const { listTeachersWithProfiles } = require('./teacherRegistryService');
    faculty = await listTeachersWithProfiles();
  } catch (_) {
    faculty = [];
  }
  const principal = await resolvePrincipal(faculty);
  if (!principalSigPersonId) principalSigPersonId = principal.principalId;

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
    grades: gradeRows,
    signatures: {
      principalId: principalSigPersonId || principal.principalId,
      principalName: principal.principalName,
      principalSignedAt: principalSignedAt || new Date().toISOString()
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
    '</tr></thead><tbody>';
  grades.forEach((g) => {
    const score = g.score == null || g.score === '' ? labels.na : (Math.round(Number(g.score) * 10) / 10);
    html += '<tr>' +
      '<td>' + escapeHtml(g.termLabel || g.term) + '</td>' +
      '<td>' + escapeHtml(g.subject) + '</td>' +
      '<td>' + escapeHtml(score) + '</td>' +
      '<td>' + escapeHtml(g.letter || labels.na) + '</td>' +
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
  const sig = data.signatures || {};
  const principalUri = await loadSigDataUri(sig.principalId);

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
    principalSigHtml: sigImgHtml(principalUri),
    principalName: escapeHtml(sig.principalName || 'Principal'),
    principalSignedAt: escapeHtml(fmtDate(sig.principalSignedAt) || fmtDate(data.issueDate) || ''),
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
