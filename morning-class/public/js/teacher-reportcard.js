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
    const panel = $('panelReport');
    if (panel) panel.classList.remove('rc-viewing-card');
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
    const panel = $('panelReport');
    if (panel) panel.classList.remove('rc-viewing-card');
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

    html += renderAcademicSection(data);

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
    bindAcademicControls(data);
  }

  function letterFromPercent(pct) {
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

  function formatPercent(value) {
    return value != null && value !== '' ? String(value) + '%' : '—';
  }

  function renderAcademicSection(data) {
    const academic = data.academic || {};
    const gb = academic.gradebook || academic;
    const isManual = academic.source === 'manual';
    const letters = data.letterGrades || ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'];
    const letterVal = isManual ? (academic.letterGrade || '') : '';
    const pctVal = isManual && academic.percentageGrade != null ? academic.percentageGrade : '';
    const gbLetter = gb.letterGrade || '—';
    const gbPct = formatPercent(gb.percentageGrade);

    let html = '<section class="rc-section">' +
      '<h4>Academic grade</h4>';

    if (data.canEdit) {
      html += '<div class="rc-grade-source" role="radiogroup" aria-label="Academic grade source">' +
        '<label><input type="radio" name="rcGradeSource" value="gradebook"' +
        (isManual ? '' : ' checked') + '> Use Gradebook</label>' +
        '<label><input type="radio" name="rcGradeSource" value="manual"' +
        (isManual ? ' checked' : '') + '> Enter manually</label>' +
        '</div>';
    } else {
      html += '<p class="muted small">' +
        (isManual ? 'Manually entered for this report.' : 'From the Grades tab.') +
        '</p>';
    }

    html += '<div id="rcGradeGradebook"' + (data.canEdit && isManual ? ' hidden' : '') + '>' +
      '<div class="rc-grade-line">' +
      '<div><span class="muted small">Letter Grade</span><div class="rc-grade-value">' +
      escapeHtml(isManual ? (academic.letterGrade || '—') : gbLetter) + '</div></div>' +
      '<div><span class="muted small">Percentage Grade</span><div class="rc-grade-value">' +
      escapeHtml(isManual ? formatPercent(academic.percentageGrade) : gbPct) +
      '</div></div></div>' +
      (data.canEdit
        ? '<p class="muted small">These values come from the Grades tab. Switch to Enter manually to override them on this report.</p>'
        : '') +
      '</div>';

    if (data.canEdit) {
      html += '<div id="rcGradeManual"' + (isManual ? '' : ' hidden') + '>' +
        '<div class="rc-grade-inputs">' +
        '<label><span class="muted small">Letter Grade</span>' +
        '<select id="rcLetterGrade">' +
        '<option value="">Select…</option>' +
        letters.map((opt) =>
          '<option value="' + escapeHtml(opt) + '"' + (letterVal === opt ? ' selected' : '') + '>' +
          escapeHtml(opt) + '</option>'
        ).join('') +
        '</select></label>' +
        '<label><span class="muted small">Percentage Grade</span>' +
        '<input id="rcPercentGrade" type="number" min="0" max="100" step="0.1" inputmode="decimal" placeholder="e.g. 92"' +
        (pctVal === '' ? '' : ' value="' + escapeHtml(String(pctVal)) + '"') + '>' +
        '</label></div>' +
        '<p class="muted small">Gradebook reference: <strong>' +
        escapeHtml(gbLetter) + '</strong> · <strong>' + escapeHtml(gbPct) +
        '</strong>. Changing the percentage fills the matching letter. Save to apply this report only — Grades stay unchanged.</p>' +
        '</div>';
    }

    html += '</section>';
    return html;
  }

  function bindAcademicControls(data) {
    const radios = mount().querySelectorAll('input[name="rcGradeSource"]');
    if (!radios.length) return;
    const gb = (data.academic && data.academic.gradebook) || data.academic || {};
    const letterSel = $('rcLetterGrade');
    const pctInp = $('rcPercentGrade');
    const manualBox = $('rcGradeManual');
    const gbBox = $('rcGradeGradebook');

    function isManual() {
      const hit = mount().querySelector('input[name="rcGradeSource"]:checked');
      return !!(hit && hit.value === 'manual');
    }

    function syncMode() {
      const manual = isManual();
      if (manualBox) manualBox.hidden = !manual;
      if (gbBox) gbBox.hidden = manual;
      if (manual && letterSel && pctInp && !letterSel.value && pctInp.value === '') {
        if (gb.letterGrade) letterSel.value = gb.letterGrade;
        if (gb.percentageGrade != null) pctInp.value = gb.percentageGrade;
      }
    }

    radios.forEach((r) => r.addEventListener('change', syncMode));
    if (pctInp && letterSel) {
      pctInp.addEventListener('input', () => {
        if (pctInp.value === '') return;
        const n = Number(pctInp.value);
        if (Number.isFinite(n)) letterSel.value = letterFromPercent(n);
      });
    }
    syncMode();
  }

  function collectAcademicPayload() {
    const sourceEl = mount().querySelector('input[name="rcGradeSource"]:checked');
    if (!sourceEl) return null;
    const source = sourceEl.value === 'manual' ? 'manual' : 'gradebook';
    if (source !== 'manual') return { source: 'gradebook' };
    const letterSel = $('rcLetterGrade');
    const pctInp = $('rcPercentGrade');
    const rawPct = pctInp ? pctInp.value.trim() : '';
    return {
      source: 'manual',
      letterGrade: letterSel ? letterSel.value : '',
      percentageGrade: rawPct === '' ? null : Number(rawPct)
    };
  }

  async function saveEditor(markComplete) {
    const cls = getClass();
    const err = $('rcEditorError') || errBox();
    err.textContent = '';
    const workHabits = {};
    mount().querySelectorAll('.rc-habit-select').forEach((sel) => {
      workHabits[sel.dataset.key] = sel.value;
    });
    const saveBtn = $('rcSaveDraft');
    const completeBtn = $('rcMarkComplete');
    if (saveBtn) saveBtn.disabled = true;
    if (completeBtn) completeBtn.disabled = true;
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/report-card', {
        method: 'POST',
        body: {
          term: state.term,
          subject: state.selectedSubject,
          studentId: state.selectedStudentId,
          workHabits,
          subjectComment: $('rcSubjectComment').value,
          academic: collectAcademicPayload(),
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
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (completeBtn) completeBtn.disabled = false;
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
    const wfLabel = (card.workflow && card.workflow.stateLabel) || 'Draft';
    const panel = $('panelReport');
    if (panel) panel.classList.add('rc-viewing-card');

    let html = '<div class="rc-full">' +
      '<div class="rc-full-toolbar no-print">' +
      '<div class="rc-full-toolbar-left">' +
      '<button type="button" class="btn btn-ghost" id="rcCardBack">← Back</button>' +
      '<div class="rc-full-status">' +
      (card.reportReady
        ? '<span class="rc-ready-badge">Report Ready</span>'
        : '<span class="muted small">Not ready — missing subject sections</span>') +
      '<span class="muted small">Status: ' + escapeHtml(wfLabel) + '</span>' +
      '</div></div>' +
      '<div class="rc-full-toolbar-right">' +
      '<label class="btn btn-ghost rc-sig-upload-btn">' +
      'Upload signature <input type="file" id="rcSigFile" accept="image/png,image/jpeg,image/webp" hidden>' +
      '</label>' +
      '<button type="button" class="btn btn-ghost" id="rcPrintBtn"' +
      (card.canGenerate ? '' : ' disabled') + '>Print</button>' +
      (card.canHomeroomSign
        ? '<button type="button" class="btn btn-primary" id="rcSignBtn">Sign</button>'
        : '') +
      (card.canSubmitHead
        ? '<button type="button" class="btn btn-primary" id="rcSubmitHeadBtn">Submit</button>'
        : '') +
      '</div></div>' +
      renderPrintableCard(card) +
      '<div class="error no-print" id="rcCardError"></div>' +
      '</div>';
    box.innerHTML = html;

    $('rcCardBack').addEventListener('click', () => {
      state.card = null;
      if (panel) panel.classList.remove('rc-viewing-card');
      if (state.selectedStudentId) loadEditor();
      else renderOverview();
    });
    if ($('rcPrintBtn')) {
      $('rcPrintBtn').addEventListener('click', () => window.print());
    }
    if ($('rcSignBtn')) $('rcSignBtn').addEventListener('click', () => workflowAction('sign'));
    if ($('rcSubmitHeadBtn')) {
      $('rcSubmitHeadBtn').addEventListener('click', () => workflowAction('submit'));
    }
    if ($('rcSigFile')) {
      $('rcSigFile').addEventListener('change', uploadSignature);
    }
  }

  function renderPrintableCard(card) {
    if (global.SaltReportCardPrint && SaltReportCardPrint.renderPrintableCard) {
      return SaltReportCardPrint.renderPrintableCard(card);
    }
    return '<p class="error">Print renderer missing.</p>';
  }

  async function uploadSignature() {
    const input = $('rcSigFile');
    const err = $('rcCardError') || errBox();
    if (!input || !input.files || !input.files[0]) return;
    err.textContent = '';
    try {
      const prepared = (SaltApp.prepareSignatureFile
        ? await SaltApp.prepareSignatureFile(input.files[0])
        : input.files[0]);
      const fd = new FormData();
      fd.append('signature', prepared);
      await api('/api/teacher/signature', { method: 'POST', body: fd }, role);
      err.style.color = '#16a34a';
      err.textContent = 'Signature saved permanently. You can Sign the report card now.';
    } catch (e) {
      err.style.color = '#dc2626';
      err.textContent = e.message;
    }
  }

  async function workflowAction(action) {
    const cls = getClass();
    const card = state.card;
    const err = $('rcCardError') || errBox();
    if (!card) return;
    if (action === 'submit' &&
      !confirm('Submit this signed report card to your Head Teacher? Parents will not see it yet.')) {
      return;
    }
    err.textContent = '';
    try {
      const res = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/report-card/workflow',
        {
          method: 'POST',
          body: { studentId: card.student.studentId, term: card.term, action }
        },
        role
      );
      err.style.color = '#16a34a';
      err.textContent = action === 'sign'
        ? 'Signed.'
        : ('Submitted to Head Teacher (' + (res.stateLabel || '') + ').');
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
