/**
 * Shared printable report card HTML (teacher, head, principal, parent).
 * Layout v2: cover signatures + grading scale on page 1; subjects from page 2.
 */
(function (global) {
  var REPORT_CARD_PRINT_VERSION = '20260831rc2';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sigBlock(label, path, at, nameLine) {
    const dateText = at ? String(at).slice(0, 10) : '';
    return (
      '<div class="rc-sig-box">' +
      '<div class="rc-sig-area">' +
      (path
        ? '<img class="rc-sig-img" src="' + esc(path) + '" alt="' + esc(label) + '">'
        : '') +
      '<div class="rc-sig-line" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="rc-sig-caption">' +
      '<div class="rc-sig-label">' + esc(label) + '</div>' +
      (nameLine
        ? '<div class="rc-sig-name">' + esc(nameLine) + '</div>'
        : '') +
      '<div class="rc-sig-meta muted small">' +
      (dateText ? ('Date: ' + esc(dateText)) : 'Date ______________') +
      '</div></div></div>'
    );
  }

  function subjectTeacherSigs(subj) {
    const sigs = (subj.teacherSignatures && subj.teacherSignatures.length)
      ? subj.teacherSignatures
      : [{
        teacherName: (subj.teacherNames || []).filter(Boolean).join(', '),
        sigPath: '',
        signedAt: ''
      }];
    return (
      '<div class="rc-sig-row rc-sig-row-subject">' +
      sigs.map((t) => sigBlock(
        "Subject Teacher's Signature",
        t.sigPath,
        t.signedAt,
        t.teacherName || ''
      )).join('') +
      '</div>'
    );
  }

  function renderPrintableCard(card) {
    card = card || {};
    const student = card.student || {};
    const att = card.attendance || {};
    const summary = card.termSummary || {};
    const wf = card.workflow || {};

    let html = '<article class="rc-print-sheet" id="rcPrintSheet" data-rc-layout="' +
      esc(REPORT_CARD_PRINT_VERSION) + '">' +
      '<div class="rc-print-page rc-print-page-cover">' +
      '<header class="rc-print-header">' +
      '<div class="rc-print-school">' + esc(card.schoolName || 'Salt Academy Morning Class') + '</div>' +
      '<div class="rc-print-address muted small">' + esc(card.schoolAddress || '') + '</div>' +
      '<h2>Student Report Card</h2>' +
      '<div class="rc-sig-row rc-sig-row-top">' +
      sigBlock(
        "Homeroom Teacher's Signature",
        wf.homeroomSigPath,
        wf.homeroomSignedAt,
        card.homeroomTeacherName || ''
      ) +
      sigBlock(
        "Principal's Signature",
        wf.principalSigPath,
        wf.principalSignedAt
      ) +
      '</div>' +
      '<div class="rc-print-meta">' +
      '<div><span>Student Name</span><strong>' + esc(student.name) + '</strong></div>' +
      '<div><span>Grade Level</span><strong>' + esc(student.gradeLevel || '—') + '</strong></div>' +
      '<div><span>Student ID</span><strong>' + esc(student.studentId || '—') + '</strong></div>' +
      '<div><span>Homeroom / Advisory Teacher</span><strong>' +
      esc(card.homeroomTeacherName || '—') + '</strong></div>' +
      '<div><span>Class</span><strong>' + esc(card.className || '') + '</strong></div>' +
      '<div><span>Academic Year</span><strong>' + esc(card.academicYear || '—') + '</strong></div>' +
      '<div><span>Term</span><strong>' +
      esc(card.termLabel || card.term || '—') + '</strong></div>' +
      '</div></header>';

    html += '<section class="rc-print-attendance">' +
      '<h3>Attendance Record</h3>' +
      '<div class="rc-print-meta rc-att-grid">' +
      '<div><span>Days Present</span><strong>' + esc(att.daysPresent != null ? att.daysPresent : '—') +
      '</strong></div>' +
      '<div><span>Days Absent (Excused)</span><strong>' +
      esc(att.daysAbsentExcused != null ? att.daysAbsentExcused : '—') + '</strong></div>' +
      '<div><span>Days Absent (Unexcused)</span><strong>' +
      esc(att.daysAbsentUnexcused != null ? att.daysAbsentUnexcused : '—') + '</strong></div>' +
      '<div><span>Days Tardy</span><strong>' + esc(att.daysTardy != null ? att.daysTardy : '—') +
      '</strong></div>' +
      '</div></section>';

    html += '<section class="rc-print-summary">' +
      '<h3>Term Summary</h3>' +
      '<div class="rc-print-meta">' +
      '<div><span>Term GPA (Letter Grade Scale)</span><strong>' +
      (summary.termGpa != null ? esc(String(summary.termGpa)) : '—') + '</strong></div>' +
      '<div><span>Overall Average Percentage</span><strong>' +
      (summary.overallAveragePercentage != null
        ? esc(String(summary.overallAveragePercentage)) + '%'
        : '—') +
      '</strong></div></div></section>';

    html += '<section class="rc-print-legend">' +
      '<h3>Grading Scale &amp; Achievement Criteria</h3>' +
      '<div class="rc-legend-grid">' +
      '<div><h4>Letter Grades</h4><ul class="rc-legend-letters">';
    (card.gradeLegend || []).forEach((g) => {
      html += '<li><strong>' + esc(g.letter) + '</strong> = ' + esc(g.range) + '</li>';
    });
    html += '</ul></div><div><h4>Work Habits / SEL</h4><ul>';
    (card.selLegend || []).forEach((g) => {
      html += '<li><strong>' + esc(g.symbol) + '</strong> — ' + esc(g.meaning) + '</li>';
    });
    html += '</ul></div></div></section></div>';

    html += '<div class="rc-print-page rc-print-page-subjects">' +
      '<div class="rc-print-page-break" aria-hidden="true">Page 2 — Subject Grades</div>';

    (card.subjects || []).forEach((subj) => {
      html += '<section class="rc-print-subject">' +
        '<div class="rc-print-subject-head">' +
        '<h3>' + esc(subj.subject) + '</h3>' +
        '<div class="muted small">Teacher: ' +
        esc((subj.teacherNames || []).join(', ') || '—') + '</div></div>' +
        '<div class="rc-print-grades">' +
        '<div><span>Letter Grade</span><strong>' + esc(subj.letterGrade || '—') + '</strong></div>' +
        '<div><span>Percentage</span><strong>' +
        (subj.percentageGrade != null ? esc(String(subj.percentageGrade)) + '%' : '—') +
        '</strong></div></div>' +
        '<table class="rc-print-habits"><thead><tr><th>Work Habits / SEL</th><th>Rating</th></tr></thead><tbody>';
      (subj.workHabits || []).forEach((h) => {
        html += '<tr><td>' + esc(h.label) + '</td><td>' + esc(h.rating || '—') + '</td></tr>';
      });
      html += '</tbody></table>' +
        '<div class="rc-print-comment"><span>Teacher Comment</span><p>' +
        esc(subj.subjectComment || '—') + '</p></div>' +
        subjectTeacherSigs(subj) +
        '</section>';
    });

    html += '<footer class="rc-print-footer muted small">Generated ' +
      esc(String(card.generatedAt || '').slice(0, 10)) +
      (card.sharedWithParents ? ' · Shared with parents' : '') +
      (wf.stateLabel ? ' · ' + esc(wf.stateLabel) : '') +
      '</footer></div></article>';
    return html;
  }

  function ensurePrintMount() {
    if (document.getElementById('rcPrintMount')) return;
    const sheet = document.getElementById('rcPrintSheet');
    if (!sheet) return;
    const holder = document.createElement('div');
    holder.id = 'rcPrintMount';
    holder.appendChild(sheet.cloneNode(true));
    document.body.appendChild(holder);
    document.documentElement.classList.add('rc-printing');
  }

  function clearPrintMount() {
    document.documentElement.classList.remove('rc-printing');
    const holder = document.getElementById('rcPrintMount');
    if (holder) holder.remove();
  }

  function printCard() {
    ensurePrintMount();
    window.print();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', ensurePrintMount);
    window.addEventListener('afterprint', clearPrintMount);
  }

  global.SaltReportCardPrint = {
    REPORT_CARD_PRINT_VERSION: REPORT_CARD_PRINT_VERSION,
    renderPrintableCard: renderPrintableCard,
    printCard: printCard
  };
})(window);
