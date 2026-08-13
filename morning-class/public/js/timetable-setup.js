(function (global) {
  const PERIOD_TYPES = [
    { value: 'lesson', label: 'Lesson' },
    { value: 'recess', label: 'Recess' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'break', label: 'Break' }
  ];

  let api = null;
  let escapeHtml = null;
  let classes = [];
  let teachers = [];
  let boardHandle = null;

  function renderBellEditor(mountEl, schedule) {
    const periods = (schedule && schedule.periods) || [];
    let rows = periods.map((p, i) =>
      '<tr data-idx="' + i + '">' +
      '<td><input class="tt-bell-label" value="' + escapeHtml(p.label) + '"></td>' +
      '<td><select class="tt-bell-type">' +
      PERIOD_TYPES.map((t) =>
        '<option value="' + t.value + '"' + (p.periodType === t.value ? ' selected' : '') + '>' + t.label + '</option>'
      ).join('') +
      '</select></td>' +
      '<td><input type="time" class="tt-bell-start" value="' + escapeHtml(p.startTime) + '"></td>' +
      '<td><input type="time" class="tt-bell-end" value="' + escapeHtml(p.endTime) + '"></td>' +
      '<td><button type="button" class="btn btn-ghost tt-bell-del">✕</button></td>' +
      '</tr>'
    ).join('');

    mountEl.innerHTML =
      '<div class="tt-bell-editor">' +
      '<p class="muted small">Set each period, recess, and lunch. Only <strong>Lesson</strong> rows are used for scheduling and Auto-Solve.</p>' +
      '<table class="grades-table tt-bell-table"><thead><tr><th>Label</th><th>Type</th><th>Start</th><th>End</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="muted">No periods</td></tr>') + '</tbody></table>' +
      '<div class="tt-bell-actions">' +
      '<button type="button" class="btn btn-ghost tt-bell-add">+ Add row</button>' +
      '<button type="button" class="btn btn-ghost tt-bell-cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary tt-bell-save">Save bell schedule</button>' +
      '</div>' +
      '<div class="tt-bell-error error"></div>' +
      '</div>';

    const cancelBtn = mountEl.querySelector('.tt-bell-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => closeBellModal());
    }

    mountEl.querySelector('.tt-bell-add').addEventListener('click', () => {
      const tbody = mountEl.querySelector('tbody');
      const empty = tbody.querySelector('td[colspan]');
      if (empty) tbody.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input class="tt-bell-label" value="New period"></td>' +
        '<td><select class="tt-bell-type">' +
        PERIOD_TYPES.map((t) => '<option value="' + t.value + '">' + t.label + '</option>').join('') +
        '</select></td>' +
        '<td><input type="time" class="tt-bell-start" value="09:00"></td>' +
        '<td><input type="time" class="tt-bell-end" value="09:50"></td>' +
        '<td><button type="button" class="btn btn-ghost tt-bell-del">✕</button></td>';
      tbody.appendChild(tr);
      bindBellRow(tr, mountEl);
    });

    mountEl.querySelector('.tt-bell-save').addEventListener('click', async () => {
      const errEl = mountEl.querySelector('.tt-bell-error');
      errEl.textContent = '';
      const payload = [];
      mountEl.querySelectorAll('tbody tr').forEach((tr, idx) => {
        if (!tr.querySelector('.tt-bell-label')) return;
        payload.push({
          label: tr.querySelector('.tt-bell-label').value.trim(),
          periodType: tr.querySelector('.tt-bell-type').value,
          startTime: tr.querySelector('.tt-bell-start').value,
          endTime: tr.querySelector('.tt-bell-end').value,
          sortOrder: idx
        });
      });
      try {
        await api('/api/admin/timetable/bell-schedule', { method: 'POST', body: { periods: payload } }, 'admin');
        errEl.style.color = '#16a34a';
        errEl.textContent = 'Bell schedule saved.';
        setTimeout(() => closeBellModal(), 450);
      } catch (e) {
        errEl.style.color = '#dc2626';
        errEl.textContent = e.message;
      }
    });

    mountEl.querySelectorAll('tbody tr').forEach((tr) => bindBellRow(tr, mountEl));
  }

  function ensureBellModal() {
    let modal = document.getElementById('ttBellModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'ttBellModal';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ttBellModalTitle');
    modal.innerHTML =
      '<div class="modal-card tt-bell-modal">' +
      '<div class="tt-bell-modal-head">' +
      '<div>' +
      '<h3 id="ttBellModalTitle" style="margin:0">Bell schedule</h3>' +
      '<p class="muted small" style="margin:0.35rem 0 0">School day structure · rarely needs changes</p>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost tt-bell-modal-close">Close</button>' +
      '</div>' +
      '<div id="ttBellModalBody"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeBellModal();
    });
    modal.querySelector('.tt-bell-modal-close').addEventListener('click', () => closeBellModal());
    return modal;
  }

  function closeBellModal() {
    const modal = document.getElementById('ttBellModal');
    if (modal) modal.classList.add('hidden');
  }

  async function openBellModal() {
    const modal = ensureBellModal();
    const body = modal.querySelector('#ttBellModalBody');
    body.innerHTML = '<p class="muted">Loading…</p>';
    modal.classList.remove('hidden');
    try {
      const bellData = await api('/api/admin/timetable/bell-schedule', {}, 'admin');
      renderBellEditor(body, bellData);
    } catch (e) {
      body.innerHTML = '<p class="error">' + escapeHtml(e.message || 'Could not load bell schedule.') + '</p>';
    }
  }

  function bindBellRow(tr, mountEl) {
    const del = tr.querySelector('.tt-bell-del');
    if (del) {
      del.addEventListener('click', () => {
        tr.remove();
        if (!mountEl.querySelector('tbody tr')) {
          mountEl.querySelector('tbody').innerHTML = '<tr><td colspan="5" class="muted">No periods</td></tr>';
        }
      });
    }
  }

  async function openClassBoard(boardMount, classId, requirements) {
    if (!boardMount || !classId || !global.SaltTimetable || !global.SaltTimetable.renderClassBoard) {
      if (boardMount) boardMount.innerHTML = '<p class="muted">Class board unavailable.</p>';
      return;
    }
    const cls = classes.find((c) => c.classId === classId);
    boardMount.innerHTML = '<p class="muted">Loading class board…</p>';
    try {
      const tt = await api('/api/admin/timetable/classes/' + encodeURIComponent(classId), {}, 'admin');
      boardHandle = global.SaltTimetable.renderClassBoard(boardMount, {
        classId,
        className: cls ? cls.name : classId,
        teachers,
        requirements: requirements || [],
        timetable: tt.timetable
      });
    } catch (e) {
      boardMount.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function linkedClassPickerHtml(currentClassId, selectedIds) {
    const selected = new Set((selectedIds || []).map(String));
    const others = (classes || []).filter((c) => String(c.classId) !== String(currentClassId));
    if (!others.length) {
      return '<span class="muted small">No other classes</span>';
    }
    return (
      '<div class="tt-req-linked">' +
      others.map((c) =>
        '<label class="tt-req-linked-item">' +
        '<input type="checkbox" class="tt-req-linked-cb" value="' + escapeHtml(c.classId) + '"' +
        (selected.has(String(c.classId)) ? ' checked' : '') + '>' +
        '<span>' + escapeHtml(c.name) + '</span></label>'
      ).join('') +
      '</div>'
    );
  }

  function readLinkedClassIds(tr) {
    return Array.from(tr.querySelectorAll('.tt-req-linked-cb:checked')).map((el) => el.value);
  }

  function renderRequirements(mountEl, classId, requirements) {
    const teacherOpts = teachers.map((t) =>
      '<option value="' + escapeHtml(t.teacherId) + '">' + escapeHtml(t.displayName || t.name) + '</option>'
    ).join('');

    let rows = (requirements || []).map((r, i) => {
      const tOpts = teachers.map((t) =>
        '<option value="' + escapeHtml(t.teacherId) + '"' +
        (t.teacherId === r.teacherId ? ' selected' : '') + '>' + escapeHtml(t.displayName || t.name) + '</option>'
      ).join('');
      const linked = (r.classIds || [r.classId].concat(r.linkedClassIds || []))
        .map(String)
        .filter((id) => id && id !== String(classId));
      return (
        '<tr data-idx="' + i + '" data-req-id="' + escapeHtml(r.reqId || '') + '">' +
        '<td><input class="tt-req-subject" value="' + escapeHtml(r.subject) + '" list="ttSubjectList"></td>' +
        '<td><select class="tt-req-teacher">' + tOpts + '</select></td>' +
        '<td><input type="number" class="tt-req-ppw" min="1" max="20" value="' + (r.periodsPerWeek || 5) + '" style="width:4rem"></td>' +
        '<td><input class="tt-req-room" value="' + escapeHtml(r.room || '') + '" placeholder="Room"></td>' +
        '<td>' + linkedClassPickerHtml(classId, linked) + '</td>' +
        '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>' +
        '</tr>'
      );
    }).join('');

    mountEl.innerHTML =
      '<div class="tt-setup-section">' +
      '<h4>Subject requirements</h4>' +
      '<p class="muted small">Hours per week drive the unassigned palette and Auto-Solve. Use <strong>Also teach with</strong> when one teacher covers multiple classes in the same period — those classes will share that subject timeslot.</p>' +
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">' +
      '<select class="tt-req-class">' +
      classes.map((c) =>
        '<option value="' + escapeHtml(c.classId) + '"' + (c.classId === classId ? ' selected' : '') + '>' +
        escapeHtml(c.name) + '</option>'
      ).join('') +
      '</select>' +
      '<button type="button" class="btn btn-ghost tt-req-import">Import from assignments</button>' +
      '<button type="button" class="btn btn-ghost tt-req-add">+ Add subject</button>' +
      '</div>' +
      '<table class="grades-table"><thead><tr><th>Subject</th><th>Teacher</th><th>Periods/wk</th><th>Room</th><th>Also teach with</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" class="muted">No requirements yet</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-primary tt-req-save">Save requirements</button>' +
      '<button type="button" class="btn btn-primary tt-req-generate">Auto-Solve (fill unlocked)</button>' +
      '</div>' +
      '<div class="tt-req-error error"></div>' +
      '<div class="tt-req-result muted small"></div>' +
      '</div>' +
      '<div class="tt-setup-section">' +
      '<h4>Class timetable board</h4>' +
      '<p class="muted small">Drag remaining subject chips into the Mon–Fri × period grid. Green = free for that teacher; red = conflict.</p>' +
      '<div class="tt-setup-board-mount"></div>' +
      '</div>';

    const classSelect = mountEl.querySelector('.tt-req-class');
    classSelect.addEventListener('change', () => loadRequirements(mountEl, classSelect.value));

    mountEl.querySelector('.tt-req-import').addEventListener('click', async () => {
      const errEl = mountEl.querySelector('.tt-req-error');
      errEl.textContent = '';
      try {
        const data = await api('/api/admin/timetable/requirements/import', {
          method: 'POST',
          body: { classId: classSelect.value }
        }, 'admin');
        renderRequirements(mountEl, classSelect.value, data.requirements || []);
        errEl.style.color = '#16a34a';
        errEl.textContent = 'Imported from class assignments.';
      } catch (e) {
        errEl.style.color = '#dc2626';
        errEl.textContent = e.message;
      }
    });

    mountEl.querySelector('.tt-req-add').addEventListener('click', () => {
      const tbody = mountEl.querySelector('tbody');
      if (tbody.querySelector('.muted')) tbody.innerHTML = '';
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input class="tt-req-subject" list="ttSubjectList"></td>' +
        '<td><select class="tt-req-teacher">' + teacherOpts + '</select></td>' +
        '<td><input type="number" class="tt-req-ppw" min="1" max="20" value="5" style="width:4rem"></td>' +
        '<td><input class="tt-req-room" placeholder="Room"></td>' +
        '<td>' + linkedClassPickerHtml(classSelect.value, []) + '</td>' +
        '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>';
      tbody.appendChild(tr);
      tr.querySelector('.tt-req-del').addEventListener('click', () => tr.remove());
    });

    mountEl.querySelectorAll('.tt-req-del').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('tr').remove());
    });

    mountEl.querySelector('.tt-req-save').addEventListener('click', () => saveRequirements(mountEl, classSelect.value));
    mountEl.querySelector('.tt-req-generate').addEventListener('click', () => generateTimetable(mountEl, classSelect.value));

    openClassBoard(mountEl.querySelector('.tt-setup-board-mount'), classId, requirements);
  }

  async function saveRequirements(mountEl, classId) {
    const errEl = mountEl.querySelector('.tt-req-error');
    errEl.textContent = '';
    const requirements = [];
    mountEl.querySelectorAll('tbody tr').forEach((tr) => {
      if (!tr.querySelector('.tt-req-subject')) return;
      const subject = tr.querySelector('.tt-req-subject').value.trim();
      if (!subject) return;
      requirements.push({
        reqId: tr.dataset.reqId || '',
        subject,
        teacherId: tr.querySelector('.tt-req-teacher').value,
        periodsPerWeek: Number(tr.querySelector('.tt-req-ppw').value) || 5,
        room: tr.querySelector('.tt-req-room').value.trim(),
        linkedClassIds: readLinkedClassIds(tr)
      });
    });
    try {
      const data = await api('/api/admin/timetable/requirements', {
        method: 'POST',
        body: { classId, requirements }
      }, 'admin');
      errEl.style.color = '#16a34a';
      const linkedCount = (data.requirements || []).filter((r) => (r.linkedClassIds || []).length).length;
      errEl.textContent = linkedCount
        ? 'Requirements saved. Combined-class subjects will share the same period when you Save or Auto-Solve.'
        : 'Requirements saved.';
      if (boardHandle && boardHandle.setRequirements) {
        boardHandle.setRequirements(data.requirements || requirements);
      } else {
        await openClassBoard(mountEl.querySelector('.tt-setup-board-mount'), classId, data.requirements || requirements);
      }
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function generateTimetable(mountEl, classId) {
    const errEl = mountEl.querySelector('.tt-req-error');
    const resEl = mountEl.querySelector('.tt-req-result');
    errEl.textContent = '';
    resEl.textContent = 'Generating… locked slots stay; OR-Tools fills the rest.';
    try {
      const data = await api('/api/admin/timetable/generate', {
        method: 'POST',
        body: { classId }
      }, 'admin');
      const r = data.result || {};
      resEl.textContent =
        (r.message || 'Done') + ' — kept ' + (r.lockedKept != null ? r.lockedKept : 0) +
        ' locked, added ' + (r.generated != null ? r.generated : r.assignmentCount) +
        ', synced ' + (r.studentsUpdated || 0) + ' students / ' + (r.teachersUpdated || 0) + ' teachers.';
      const reqData = await api('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId), {}, 'admin');
      await openClassBoard(
        mountEl.querySelector('.tt-setup-board-mount'),
        classId,
        reqData.requirements || []
      );
    } catch (e) {
      resEl.textContent = '';
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function loadRequirements(mountEl, classId) {
    const data = await api('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId), {}, 'admin');
    renderRequirements(mountEl, classId, data.requirements || []);
  }

  async function open(mountEl, opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    classes = opts.classes || [];
    teachers = opts.teachers || [];
    boardHandle = null;

    mountEl.innerHTML = '<p class="muted">Loading timetable setup…</p>';

    let solverOk = false;
    try {
      const h = await api('/api/admin/timetable/solver-health', {}, 'admin');
      solverOk = h.ok;
    } catch (e) { /* ignore */ }

    const classId = classes[0] ? classes[0].classId : '';

    mountEl.innerHTML =
      '<div class="tt-setup-toolbar">' +
      '<button type="button" class="btn btn-ghost tt-bell-open">Bell schedule</button>' +
      '</div>' +
      (solverOk
        ? '<p class="tt-solver-ok muted small">✓ Auto-Solve ready — locked cells are preserved</p>'
        : '<p class="tt-solver-warn muted small">Auto-Solve is offline (solver not connected). Drag-and-drop editing and <strong>Save &amp; sync</strong> still work.</p>') +
      '<div id="ttReqMount"></div>';

    mountEl.querySelector('.tt-bell-open').addEventListener('click', () => {
      openBellModal().catch((e) => alert(e.message || 'Could not open bell schedule.'));
    });

    if (classId) {
      await loadRequirements(mountEl.querySelector('#ttReqMount'), classId);
    } else {
      mountEl.querySelector('#ttReqMount').innerHTML = '<p class="muted">Create a class first.</p>';
    }
  }

  global.SaltTimetableSetup = { open };
})(window);
