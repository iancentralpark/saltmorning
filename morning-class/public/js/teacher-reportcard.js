(function (global) {
  let api = null;
  let escapeHtml = null;
  let $ = null;
  let show = null;
  let hide = null;
  let getClass = null;
  let role = 'teacher';

  let state = {
    overview: null,
    term: 'Term1',
    selectedStudentId: '',
    selectedSubject: '',
    editor: null,
    card: null
  };

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    $ = opts.$;
    show = opts.show;
    hide = opts.hide;
    getClass = opts.getClass;
    role = opts.role || 'teacher';
  }

  function mount() { return $('reportBody'); }
  function errBox() { return $('reportError'); }

  async function onClassOpen() {
    const cls = getClass();
    if (!cls) return;
    state.selectedStudentId = '';
    state.selectedSubject = '';
    state.editor = null;
    state.card = null;
    const termInput = $('reportTerm');
    if (termInput && !termInput.value) termInput.value = 'Term1';
    state.term = (termInput && termInput.value.trim()) || 'Term1';
    await loadOverview();
  }

  async function loadOverview() {
    const cls = getClass();
    const box = mount();
    const err = errBox();
    err.textContent = '';
    box.innerHTML = '<p class="muted">Loading students…</p>';
    try {
      state.term = ($('reportTerm') && $('reportTerm').value.trim()) || state.term || 'Term1';
      const data = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/report-card?term=' + encodeURIComponent(state.term),
        {},
        role
      );
      state.overview = data;
      if ($('reportTerm') && data.term) $('reportTerm').value = data.term;
      renderOverview();
    } catch (e) {
      box.innerHTML = '';
      err.textContent = e.message;
    }
  }

  function renderOverview() {
    const data = state.overview;
    const box = mount();
    if (!data) return;

    let html = '<div class="rc-overview">';
    html += '<div class="rc-overview-head">' +
      '<div><strong>' + escapeHtml(data.className || '') + '</strong>' +
      '<span class="muted small"> · ' + escapeHtml(data.term) + '</span></div>' +
      (data.classReady
        ? '<span class="rc-ready-badge">Report Ready</span>'
        : '<span class="muted small">Waiting for subject teachers to finish</span>') +
      '</div>';
    html += '<p class="muted small">Select a student to enter Work Habits &amp; Social-Emotional Learning, review gradebook grades, and write your subject comment. Homeroom can generate and share when every subject is complete.</p>';

    if (!(data.students || []).length) {
      html += '<p class="muted">No enrolled students in this class.</p></div>';
      box.innerHTML = html;
      return;
    }

    html += '<div class="table-wrap"><table class="grades-table rc-student-table"><thead><tr>' +
      '<th>Student</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>';
    data.students.forEach((st) => {
      const prog = st.completeCount + '/' + st.requiredCount + ' subjects';
      const status = st.reportReady
        ? (st.sharedWithParents ? 'Shared with parents' : 'Report Ready')
        : 'In progress';
      html += '<tr>' +
        '<td><button type="button" class="btn btn-ghost rc-open-student" data-sid="' +
        escapeHtml(st.studentId) + '">' + escapeHtml(st.name) + '</button></td>' +
        '<td class="muted small">' + escapeHtml(prog) + '</td>' +
        '<td>' + (st.reportReady
          ? '<span class="rc-ready-badge rc-ready-badge-sm">' + escapeHtml(status) + '</span>'
          : '<span class="muted small">' + escapeHtml(status) + '</span>') + '</td>' +
        '<td>' + (st.reportReady
          ? '<button type="button" class="btn btn-primary rc-open-card" data-sid="' +
            escapeHtml(st.studentId) + '">Open report card</button>'
          : '') + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    box.innerHTML = html;

    box.querySelectorAll('.rc-open-student').forEach((btn) => {
      btn.addEventListener('click', () => openStudent(btn.dataset.sid));
    });
    box.querySelectorAll('.rc-open-card').forEach((btn) => {
      btn.addEventListener('click', () => openFullCard(btn.dataset.sid));
    });
  }

  async function openStudent(studentId) {
    const data = state.overview;
    const st = (data.students || []).find((s) => s.studentId === studentId);
    if (!st) return;
    state.selectedStudentId = studentId;
    const editable = (st.subjects || []).filter((s) => s.canEdit);
    const first = editable[0] || (st.subjects || [])[0];
    state.selectedSubject = first ? first.subject : '';
    if (!state.selectedSubject) {
      errBox().textContent = 'No subjects available for report entry.';
      return;
    }
    await loadEditor();
  }

  async function loadEditor() {
    const cls = getClass();
    const box = mount();
    const err = errBox();
    err.textContent = '';
    box.innerHTML = '<p class="muted">Loading student report…</p>';
    try {
      const data = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/report-card?term=' + encodeURIComponent(state.term) +
        '&studentId=' + encodeURIComponent(state.selectedStudentId) +
        '&subject=' + encodeURIComponent(state.selectedSubject),
        {},
        role
      );
      state.editor = data;
      renderEditor();
    } catch (e) {
      box.innerHTML = '';
      err.textContent = e.message;
    }
  }

  function renderEditor() {
    const data = state.editor;
    const overview = state.overview;
    const box = mount();
    if (!data) return;
    const stRow = (overview.students || []).find((s) => s.studentId === data.student.studentId);
    const subjectOpts = (stRow ? stRow.subjects : data.canEdit ? [{ subject: data.subject, canEdit: true }] : [])
      .map((s) =>
        '<option value="' + escapeHtml(s.subject) + '"' +
        (s.subject === data.subject ? ' selected' : '') +
        (s.canEdit ? '' : ' disabled') + '>' +
        escapeHtml(s.subject) + (s.complete ? ' ✓' : '') + '</option>'
      ).join('');

    let html = '<div class="rc-editor">';
    html += '<div class="rc-editor-toolbar">' +
      '<button type="button" class="btn btn-ghost" id="rcBackStudents">← Students</button>' +
      '<strong>' + escapeHtml(data.student.name) + '</strong>' +
      (data.student.gradeLevel ? '<span class="muted small">Grade ' + escapeHtml(data.student.gradeLevel) + '</span>' : '') +
      '</div>';

    html += '<div class="rc-editor-meta">' +
      '<label>Subject <select id="rcSubjectSelect">' + subjectOpts + '</select></label>' +
      '<span class="muted small">Status: <strong>' + escapeHtml(data.status) + '</strong></span>' +
      '</div>';

    html += '<section class="rc-section">' +
      '<h4>Academic grade (from Gradebook)</h4>' +
      '<div class="rc-grade-line">' +
      '<div><span class="muted small">Letter Grade</span><div class="rc-grade-value">' +
      escapeHtml(data.academic.letterGrade || '—') + '</div></div>' +
      '<div><span class="muted small">Percentage Grade</span><div class="rc-grade-value">' +
      (data.academic.percentageGrade != null ? escapeHtml(String(data.academic.percentageGrade)) + '%' : '—') +
      '</div></div></div>' +
      '<p class="muted small">These values come from the Grades tab and cannot be edited here.</p>' +
      '</section>';

    html += '<section class="rc-section">' +
      '<h4>Work Habits &amp; Social-Emotional Learning</h4>' +
      '<div class="rc-habits">';
    (data.workHabits || []).forEach((h) => {
      html += '<label class="rc-habit-row"><span>' + escapeHtml(h.label) + '</span>' +
        '<select class="rc-habit-select" data-key="' + escapeHtml(h.fieldKey) + '"' +
        (data.canEdit ? '' : ' disabled') + '>' +
        '<option value="">Select…</option>' +
        (data.ratingOptions || []).map((opt) =>
          '<option value="' + escapeHtml(opt) + '"' + (h.rating === opt ? ' selected' : '') + '>' +
          escapeHtml(opt) + '</option>'
        ).join('') +
        '</select></label>';
    });
    html += '</div></section>';

    html += '<section class="rc-section">' +
      '<h4>Teacher comment (' + escapeHtml(data.subject) + ')</h4>' +
      '<textarea id="rcSubjectComment" rows="4" maxlength="1200" placeholder="Overall comments for this student in this subject…"' +
      (data.canEdit ? '' : ' disabled') + '>' + escapeHtml(data.subjectComment || '') + '</textarea>' +
      '</section>';

    html += '<div class="rc-editor-actions">';
    if (data.canEdit) {
      html += '<button type="button" class="btn btn-primary" id="rcSaveDraft">Save</button>' +
        '<button type="button" class="btn btn-primary" id="rcMarkComplete">Save &amp; mark complete</button>';
    }
    if (stRow && stRow.reportReady) {
      html += '<button type="button" class="btn btn-ghost" id="rcOpenFull">View full report card</button>';
    }
    html += '<div class="error" id="rcEditorError"></div></div></div>';

    box.innerHTML = html;

    $('rcBackStudents').addEventListener('click', () => {
      state.selectedStudentId = '';
      state.editor = null;
      renderOverview();
    });
    $('rcSubjectSelect').addEventListener('change', async () => {
      state.selectedSubject = $('rcSubjectSelect').value;
      await loadEditor();
    });
    if ($('rcSaveDraft')) $('rcSaveDraft').addEventListener('click', () => saveEditor(false));
    if ($('rcMarkComplete')) $('rcMarkComplete').addEventListener('click', () => saveEditor(true));
    if ($('rcOpenFull')) $('rcOpenFull').addEventListener('click', () => openFullCard(data.student.studentId));
  }

  async function saveEditor(markComplete) {
    const cls = getClass();
    const err = $('rcEditorError') || errBox();
    err.textContent = '';
    const workHabits = {};
    mount().querySelectorAll('.rc-habit-select').forEach((sel) => {
      workHabits[sel.dataset.key] = sel.value;
    });
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/report-card', {
        method: 'POST',
        body: {
          term: state.term,
          subject: state.selectedSubject,
          studentId: state.selectedStudentId,
          workHabits,
          subjectComment: $('rcSubjectComment').value,
          markComplete: !!markComplete
        }
      }, role);
      await loadOverview();
      state.selectedStudentId = state.selectedStudentId;
      await loadEditor();
      if (res.status === 'Complete') {
        err.style.color = '#16a34a';
        err.textContent = 'Saved and marked complete.';
      } else {
        err.style.color = '#16a34a';
        err.textContent = 'Saved.';
      }
    } catch (e) {
      err.style.color = '#dc2626';
      err.textContent = e.message;
    }
  }

  async function openFullCard(studentId) {
    const cls = getClass();
    const box = mount();
    const err = errBox();
    err.textContent = '';
    box.innerHTML = '<p class="muted">Building report card…</p>';
    try {
      const data = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/report-card?term=' + encodeURIComponent(state.term) +
        '&studentId=' + encodeURIComponent(studentId) +
        '&full=1',
        {},
        role
      );
      state.card = data.card;
      renderFullCard();
    } catch (e) {
      box.innerHTML = '';
      err.textContent = e.message;
    }
  }

  function renderFullCard() {
    const card = state.card;
    const box = mount();
    if (!card) return;

    let html = '<div class="rc-full">' +
      '<div class="rc-full-toolbar no-print">' +
      '<button type="button" class="btn btn-ghost" id="rcCardBack">← Back</button>' +
      (card.reportReady
        ? '<span class="rc-ready-badge">Report Ready</span>'
        : '<span class="muted small">Not ready — missing subject sections</span>') +
      '<button type="button" class="btn btn-primary" id="rcPrintBtn"' +
      (card.canGenerate ? '' : ' disabled') + '>Print report card</button>' +
      (card.canShare
        ? '<button type="button" class="btn btn-primary" id="rcShareBtn">' +
          (card.sharedWithParents ? 'Shared ✓ / Share again' : 'Share with parents') + '</button>'
        : '') +
      '</div>' +
      renderPrintableCard(card) +
      '<div class="error no-print" id="rcCardError"></div>' +
      '</div>';
    box.innerHTML = html;

    $('rcCardBack').addEventListener('click', () => {
      state.card = null;
      if (state.selectedStudentId) loadEditor();
      else renderOverview();
    });
    if ($('rcPrintBtn')) {
      $('rcPrintBtn').addEventListener('click', () => window.print());
    }
    if ($('rcShareBtn')) {
      $('rcShareBtn').addEventListener('click', shareCard);
    }
  }

  function renderPrintableCard(card) {
    let html = '<article class="rc-print-sheet" id="rcPrintSheet">' +
      '<header class="rc-print-header">' +
      '<div class="rc-print-school">' + escapeHtml(card.schoolName || 'Salt Academy Morning Class') + '</div>' +
      '<h2>Student Report Card</h2>' +
      '<div class="rc-print-meta">' +
      '<div><span>Student</span><strong>' + escapeHtml(card.student.name) + '</strong></div>' +
      '<div><span>Grade Level</span><strong>' + escapeHtml(card.student.gradeLevel || '—') + '</strong></div>' +
      '<div><span>Class</span><strong>' + escapeHtml(card.className || '') + '</strong></div>' +
      '<div><span>Term</span><strong>' + escapeHtml(card.term) + '</strong></div>' +
      '<div><span>Homeroom Teacher</span><strong>' + escapeHtml(card.homeroomTeacherName || '—') + '</strong></div>' +
      '</div></header>';

    (card.subjects || []).forEach((subj) => {
      html += '<section class="rc-print-subject">' +
        '<div class="rc-print-subject-head">' +
        '<h3>' + escapeHtml(subj.subject) + '</h3>' +
        '<div class="muted small">Teacher: ' +
        escapeHtml((subj.teacherNames || []).join(', ') || '—') + '</div></div>' +
        '<div class="rc-print-grades">' +
        '<div><span>Letter Grade</span><strong>' + escapeHtml(subj.letterGrade || '—') + '</strong></div>' +
        '<div><span>Percentage</span><strong>' +
        (subj.percentageGrade != null ? escapeHtml(String(subj.percentageGrade)) + '%' : '—') +
        '</strong></div></div>' +
        '<table class="rc-print-habits"><thead><tr><th>Work Habits / SEL</th><th>Rating</th></tr></thead><tbody>';
      (subj.workHabits || []).forEach((h) => {
        html += '<tr><td>' + escapeHtml(h.label) + '</td><td>' +
          escapeHtml(h.rating || '—') + '</td></tr>';
      });
      html += '</tbody></table>' +
        '<div class="rc-print-comment"><span>Teacher Comment</span><p>' +
        escapeHtml(subj.subjectComment || '—') + '</p></div>' +
        '</section>';
    });

    html += '<footer class="rc-print-footer muted small">Generated ' +
      escapeHtml((card.generatedAt || '').slice(0, 10)) +
      (card.sharedWithParents ? ' · Shared with parents' : '') +
      '</footer></article>';
    return html;
  }

  async function shareCard() {
    const cls = getClass();
    const card = state.card;
    const err = $('rcCardError') || errBox();
    if (!card) return;
    if (!confirm('Share this report card with the student\'s parents? They will see it in the Parent portal.')) return;
    err.textContent = '';
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/report-card/share', {
        method: 'POST',
        body: { studentId: card.student.studentId, term: card.term }
      }, role);
      err.style.color = '#16a34a';
      err.textContent = 'Shared with parents.';
      await openFullCard(card.student.studentId);
      await loadOverview();
    } catch (e) {
      err.style.color = '#dc2626';
      err.textContent = e.message;
    }
  }

  // Expose printable renderer for parent page reuse
  function renderCardHtml(card) {
    return renderPrintableCard(card);
  }

  global.SaltReportCard = {
    init,
    onClassOpen,
    loadOverview,
    renderCardHtml
  };
})(window);
