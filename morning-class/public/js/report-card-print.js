/**
 * Shared printable report card HTML (teacher, head, principal, parent).
 */
(function (global) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sigBlock(label, path, at) {
    return (
      '<div class="rc-sig-box">' +
      '<div class="rc-sig-label">' + esc(label) + '</div>' +
      (path
        ? '<img class="rc-sig-img" src="' + esc(path) + '" alt="' + esc(label) + '">'
        : '<div class="rc-sig-blank"></div>') +
      '<div class="rc-sig-meta muted small">' +
      (at ? esc(String(at).slice(0, 10)) : '________________') +
      '</div></div>'
    );
  }

  function renderPrintableCard(card) {
    card = card || {};
    const student = card.student || {};
    const att = card.attendance || {};
    const summary = card.termSummary || {};
    const wf = card.workflow || {};

    let html = '<article class="rc-print-sheet" id="rcPrintSheet">' +
      '<header class="rc-print-header">' +
      '<div class="rc-print-school">' + esc(card.schoolName || 'Salt Academy Morning Class') + '</div>' +
      '<div class="rc-print-address muted small">' + esc(card.schoolAddress || '') + '</div>' +
      '<h2>Student Report Card</h2>' +
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
      '</div>';

    html += '<div class="rc-sig-row rc-sig-row-top">' +
      sigBlock('Homeroom Teacher Signature', wf.homeroomSigPath, wf.homeroomSignedAt) +
      sigBlock("Head Teacher's Signature", wf.headSigPath, wf.headSignedAt) +
      sigBlock("Principal's Signature", wf.principalSigPath, wf.principalSignedAt) +
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
        esc(subj.subjectComment || '—') + '</p></div></section>';
    });

    html += '<section class="rc-print-legend">' +
      '<h3>Grading Scale &amp; Achievement Criteria</h3>' +
      '<div class="rc-legend-grid">' +
      '<div><h4>Letter Grades</h4><ul>';
    (card.gradeLegend || []).forEach((g) => {
      html += '<li><strong>' + esc(g.letter) + '</strong> = ' + esc(g.range) + '</li>';
    });
    html += '</ul></div><div><h4>Work Habits / SEL</h4><ul>';
    (card.selLegend || []).forEach((g) => {
      html += '<li><strong>' + esc(g.symbol) + '</strong> — ' + esc(g.meaning) + '</li>';
    });
    html += '</ul></div></div></section>';

    html += '<section class="rc-sig-row rc-sig-row-bottom">' +
      sigBlock('Homeroom Teacher Signature', wf.homeroomSigPath, wf.homeroomSignedAt) +
      sigBlock('Director / Principal Signature', wf.principalSigPath, wf.principalSignedAt) +
      '<div class="rc-sig-box"><div class="rc-sig-label">Parent / Guardian Signature</div>' +
      '<div class="rc-sig-blank"></div>' +
      '<div class="rc-sig-meta muted small">Date ______________</div></div>' +
      '</section>';

    html += '<footer class="rc-print-footer muted small">Generated ' +
      esc(String(card.generatedAt || '').slice(0, 10)) +
      (card.sharedWithParents ? ' · Shared with parents' : '') +
      (wf.stateLabel ? ' · ' + esc(wf.stateLabel) : '') +
      '</footer></article>';
    return html;
  }

  global.SaltReportCardPrint = { renderPrintableCard: renderPrintableCard };
})(window);
