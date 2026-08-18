(function (global) {
  const PERIOD_TYPES = [
    { value: 'lesson', label: 'Lesson' },
    { value: 'recess', label: 'Recess' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'break', label: 'Break' }
  ];

  let api = null;
  let escapeHtml = null;
  let role = 'admin';
  let classes = [];
  let teachers = [];
  let boardHandle = null;
  let boardClassId = '';
  let setupMountEl = null;
  let planContext = null;

  function t(key, fallback) {
    return (global.SaltI18n && typeof global.SaltI18n.t === 'function')
      ? global.SaltI18n.t(key, fallback)
      : (fallback || key);
  }

  function withPlan(url) {
    if (global.SaltTimetable && typeof global.SaltTimetable.withPlan === 'function') {
      return global.SaltTimetable.withPlan(url);
    }
    const key = (global.SaltTimetablePlan && global.SaltTimetablePlan.semesterKey) || '';
    if (!key) return url;
    return url + (String(url).indexOf('?') >= 0 ? '&' : '?') + 'semesterKey=' + encodeURIComponent(key);
  }

  function planBody(body) {
    if (global.SaltTimetable && typeof global.SaltTimetable.planBody === 'function') {
      return global.SaltTimetable.planBody(body);
    }
    const key = (global.SaltTimetablePlan && global.SaltTimetablePlan.semesterKey) || '';
    if (!key) return body || {};
    return Object.assign({}, body || {}, { semesterKey: key });
  }

  function setPlan(semester) {
    const activeKey = planContext && planContext.activeSemesterKey;
    const key = semester && semester.key ? semester.key : (activeKey || '');
    const live = !key || !activeKey || key === activeKey;
    global.SaltTimetablePlan = {
      semesterKey: key,
      live,
      label: (semester && semester.label) || '',
      yearLabel: (semester && semester.academicYearLabel) || '',
      isFuture: !!(semester && semester.isFuture) || (!live && semester && !semester.isPast)
    };
    try {
      if (key) sessionStorage.setItem('saltTtSemesterKey', key);
    } catch (_) { /* ignore */ }
  }

  function selectedSemester() {
    const key = global.SaltTimetablePlan && global.SaltTimetablePlan.semesterKey;
    const list = (planContext && planContext.semesters) || [];
    return list.find((s) => s.key === key) || list.find((s) => s.key === (planContext && planContext.activeSemesterKey)) || null;
  }

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
        await api('/api/admin/timetable/bell-schedule', { method: 'POST', body: { periods: payload } }, role);
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
      const bellData = await api('/api/admin/timetable/bell-schedule', {}, role);
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
      const tt = await api(withPlan('/api/admin/timetable/classes/' + encodeURIComponent(classId)), {}, role);
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
      '<div class="tt-req-editor">' +
      '<p class="muted small">Hours per week drive the unassigned palette and Auto-Solve. Use <strong>Also teach with</strong> when one teacher covers multiple classes in the same period.</p>' +
      '<div class="tt-req-toolbar">' +
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
      '<div class="tt-bell-actions">' +
      '<button type="button" class="btn btn-ghost tt-req-cancel">Close</button>' +
      '<button type="button" class="btn btn-primary tt-req-save">Save requirements</button>' +
      '<button type="button" class="btn btn-primary tt-req-generate">Auto-Solve (fill unlocked)</button>' +
      '</div>' +
      '<div class="tt-req-error error"></div>' +
      '<div class="tt-req-result muted small"></div>' +
      '</div>';

    const classSelect = mountEl.querySelector('.tt-req-class');
    classSelect.addEventListener('change', () => loadRequirements(mountEl, classSelect.value));

    mountEl.querySelector('.tt-req-import').addEventListener('click', async () => {
      const errEl = mountEl.querySelector('.tt-req-error');
      errEl.textContent = '';
      try {
        const data = await api(withPlan('/api/admin/timetable/requirements/import'), {
          method: 'POST',
          body: planBody({ classId: classSelect.value })
        }, role);
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

    const cancelBtn = mountEl.querySelector('.tt-req-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeReqModal);

    mountEl.querySelector('.tt-req-save').addEventListener('click', () => saveRequirements(mountEl, classSelect.value));
    mountEl.querySelector('.tt-req-generate').addEventListener('click', () => generateTimetable(mountEl, classSelect.value));
  }

  function ensureReqModal() {
    let modal = document.getElementById('ttReqModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'ttReqModal';
    modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'ttReqModalTitle');
    modal.innerHTML =
      '<div class="modal-card modal-wide tt-req-modal">' +
      '<div class="tt-bell-modal-head">' +
      '<div>' +
      '<h3 id="ttReqModalTitle" style="margin:0">Subject requirements</h3>' +
      '<p class="muted small" style="margin:0.35rem 0 0">Weekly hours and teachers for Auto-Solve, the class board, and teacher Grades / Reports</p>' +
      '</div>' +
      '<button type="button" class="btn btn-ghost tt-req-modal-close">Close</button>' +
      '</div>' +
      '<div id="ttReqModalBody"></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeReqModal();
    });
    modal.querySelector('.tt-req-modal-close').addEventListener('click', closeReqModal);
    return modal;
  }

  function closeReqModal() {
    const modal = document.getElementById('ttReqModal');
    if (modal) modal.classList.add('hidden');
  }

  async function openReqModal() {
    const modal = ensureReqModal();
    const body = modal.querySelector('#ttReqModalBody');
    body.innerHTML = '<p class="muted">Loading…</p>';
    modal.classList.remove('hidden');
    const classId = boardClassId || (classes[0] && classes[0].classId) || '';
    if (!classId) {
      body.innerHTML = '<p class="muted">Create a class first.</p>';
      return;
    }
    try {
      await loadRequirements(body, classId);
    } catch (e) {
      body.innerHTML = '<p class="error">' + escapeHtml(e.message || 'Could not load requirements.') + '</p>';
    }
  }

  function mainBoardMount() {
    return setupMountEl ? setupMountEl.querySelector('.tt-setup-board-mount') : null;
  }

  async function refreshMainBoard(classId, requirements) {
    const cid = classId || boardClassId;
    if (!cid) return;
    boardClassId = cid;
    const sel = setupMountEl && setupMountEl.querySelector('.tt-board-class');
    if (sel && sel.value !== cid) sel.value = cid;
    let reqs = requirements;
    if (!reqs) {
      try {
        const data = await api(withPlan('/api/admin/timetable/requirements?classId=' + encodeURIComponent(cid)), {}, role);
        reqs = data.requirements || [];
      } catch (_) {
        reqs = [];
      }
    }
    await openClassBoard(mainBoardMount(), cid, reqs);
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
      const data = await api(withPlan('/api/admin/timetable/requirements'), {
        method: 'POST',
        body: planBody({ classId, requirements })
      }, role);
      errEl.style.color = '#16a34a';
      const linkedCount = (data.requirements || []).filter((r) => (r.linkedClassIds || []).length).length;
      errEl.textContent = linkedCount
        ? 'Requirements saved. Combined-class subjects will share the same period when you Save or Auto-Solve.'
        : 'Requirements saved.';
      await refreshMainBoard(classId, data.requirements || requirements);
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
      const data = await api(withPlan('/api/admin/timetable/generate'), {
        method: 'POST',
        body: planBody({ classId })
      }, role);
      const r = data.result || {};
      resEl.textContent =
        (r.message || 'Done') + ' — kept ' + (r.lockedKept != null ? r.lockedKept : 0) +
        ' locked, added ' + (r.generated != null ? r.generated : r.assignmentCount) +
        ', synced ' + (r.studentsUpdated || 0) + ' students / ' + (r.teachersUpdated || 0) + ' teachers.';
      const reqData = await api(withPlan('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId)), {}, role);
      await refreshMainBoard(classId, reqData.requirements || []);
    } catch (e) {
      resEl.textContent = '';
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function loadRequirements(mountEl, classId) {
    const data = await api(withPlan('/api/admin/timetable/requirements?classId=' + encodeURIComponent(classId)), {}, role);
    renderRequirements(mountEl, classId, data.requirements || []);
  }

  function yearOptionsHtml() {
    const years = (planContext && planContext.years) || [];
    const selected = selectedSemester();
    const selectedYear = selected ? selected.academicYear : (years[0] && years[0].year);
    if (!years.length) {
      return '<option value="">' + escapeHtml(t('admin.timetables.noYears', 'No school years yet')) + '</option>';
    }
    return years.map((y) =>
      '<option value="' + y.year + '"' + (Number(y.year) === Number(selectedYear) ? ' selected' : '') + '>' +
      escapeHtml(y.label) + '</option>'
    ).join('');
  }

  function semesterOptionsHtml() {
    const selected = selectedSemester();
    const selectedYear = selected ? selected.academicYear : '';
    const group = ((planContext && planContext.years) || []).find((y) => Number(y.year) === Number(selectedYear));
    const list = (group && group.semesters) || (planContext && planContext.semesters) || [];
    if (!list.length) {
      return '<option value="">' + escapeHtml(t('admin.timetables.noSemesters', 'No semesters yet')) + '</option>';
    }
    return list.map((s) => {
      const bits = [];
      if (s.isActive) bits.push(t('admin.timetables.badgeCurrent', 'Current'));
      else if (s.isFuture) bits.push(t('admin.timetables.badgeFuture', 'Future'));
      else if (s.closed) bits.push(t('admin.timetables.badgeClosed', 'Closed'));
      const extra = bits.length ? ' (' + bits.join(', ') + ')' : '';
      return '<option value="' + escapeHtml(s.key) + '"' +
        (selected && s.key === selected.key ? ' selected' : '') + '>' +
        escapeHtml(s.label || s.key) + extra + '</option>';
    }).join('');
  }

  function planBannerHtml() {
    const plan = global.SaltTimetablePlan || {};
    const sem = selectedSemester();
    if (!plan.semesterKey) {
      return '<p class="tt-plan-banner muted small">' +
        escapeHtml(t('admin.timetables.needSemester', 'Add a school semester in Calendar first, then you can plan the next term here.')) +
        '</p>';
    }
    if (plan.live) {
      return '<p class="tt-plan-banner tt-plan-live muted small">' +
        escapeHtml(t('admin.timetables.editingCurrent', 'Editing the current timetable. Students and teachers see this one.')) +
        '</p>';
    }
    if (sem && sem.isPast) {
      return '<p class="tt-plan-banner muted small">' +
        escapeHtml(t('admin.timetables.editingPast', 'Viewing a past semester timetable. Students see the current semester.')) +
        '</p>';
    }
    return '<p class="tt-plan-banner tt-plan-future">' +
      escapeHtml(t('admin.timetables.editingFuture', 'Planning a future timetable. Students still see the current semester until this one starts.')) +
      '</p>';
  }

  function renderPlanBar() {
    const bar = setupMountEl && setupMountEl.querySelector('.tt-plan-bar');
    if (!bar) return;
    const plan = global.SaltTimetablePlan || {};
    bar.innerHTML =
      '<div class="tt-plan-head">' +
      '<strong>' + escapeHtml(t('admin.timetables.planTitle', 'Plan a future timetable')) + '</strong>' +
      '</div>' +
      '<div class="tt-plan-actions">' +
      '<button type="button" class="btn btn-primary tt-plan-next-sem">' +
      '+ ' + escapeHtml(t('admin.timetables.nextSemester', 'Create next semester')) + '</button>' +
      '<button type="button" class="btn btn-primary tt-plan-next-year">' +
      '+ ' + escapeHtml(t('admin.timetables.nextYear', 'Create next school year')) + '</button>' +
      (!plan.live && plan.semesterKey && !(selectedSemester() && selectedSemester().isPast)
        ? '<button type="button" class="btn btn-ghost tt-plan-copy">' +
          escapeHtml(t('admin.timetables.copyCurrent', 'Copy current timetable')) + '</button>'
        : '') +
      '</div>' +
      '<div class="tt-plan-fields">' +
      '<label class="tt-plan-label">' + escapeHtml(t('admin.timetables.schoolYear', 'School year')) +
      '<select class="tt-plan-year">' + yearOptionsHtml() + '</select></label>' +
      '<label class="tt-plan-label">' + escapeHtml(t('admin.timetables.semester', 'Semester')) +
      '<select class="tt-plan-semester">' + semesterOptionsHtml() + '</select></label>' +
      '</div>' +
      planBannerHtml();
    bindPlanBar(bar);
  }

  function bindPlanBar(bar) {
    const yearSel = bar.querySelector('.tt-plan-year');
    const semSel = bar.querySelector('.tt-plan-semester');
    if (yearSel) {
      yearSel.addEventListener('change', async () => {
        const year = Number(yearSel.value);
        const group = ((planContext && planContext.years) || []).find((y) => Number(y.year) === year);
        if (!group) return;
        const prefer = (group.semesters || []).find((s) => s.isActive) || group.semesters[0];
        if (prefer) {
          setPlan(prefer);
          renderPlanBar();
          await afterPlanChange();
        }
      });
    }
    if (semSel) {
      semSel.addEventListener('change', async () => {
        const sem = ((planContext && planContext.semesters) || []).find((s) => s.key === semSel.value);
        if (sem) {
          setPlan(sem);
          renderPlanBar();
          await afterPlanChange();
        }
      });
    }
    const nextSem = bar.querySelector('.tt-plan-next-sem');
    if (nextSem) nextSem.addEventListener('click', () => createNext('semester'));
    const nextYear = bar.querySelector('.tt-plan-next-year');
    if (nextYear) nextYear.addEventListener('click', () => createNext('schoolYear'));
    const copyBtn = bar.querySelector('.tt-plan-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => copyFromCurrent());
  }

  async function afterPlanChange() {
    if (boardClassId) await refreshMainBoard(boardClassId);
    if (global.SaltTimetable && typeof global.SaltTimetable.reloadAdminPlan === 'function') {
      global.SaltTimetable.reloadAdminPlan();
    }
  }

  async function createNext(kind) {
    try {
      const from = global.SaltTimetablePlan && global.SaltTimetablePlan.semesterKey;
      const data = await api('/api/admin/school-semesters/next', {
        method: 'POST',
        body: { kind, fromSemesterKey: from }
      }, role);
      planContext = data;
      const focusKey = data.focusSemesterKey;
      const sem = (data.semesters || []).find((s) => s.key === focusKey) || (data.created && data.created.focus);
      if (sem) setPlan(sem);
      else if (data.semester) setPlan(data.semester);
      renderPlanBar();
      await afterPlanChange();
      const label = (sem && sem.label) || (data.semester && data.semester.label) || '';
      alert(kind === 'schoolYear'
        ? t('admin.timetables.createdYear', 'Next school year is ready.') + (label ? ' — ' + label : '')
        : t('admin.timetables.createdSem', 'Next semester is ready.') + (label ? ' — ' + label : ''));
    } catch (e) {
      alert(e.message || 'Could not create the next term.');
    }
  }

  async function copyFromCurrent() {
    const toKey = global.SaltTimetablePlan && global.SaltTimetablePlan.semesterKey;
    const fromKey = planContext && planContext.activeSemesterKey;
    if (!toKey || !fromKey || toKey === fromKey) {
      alert(t('admin.timetables.copyNeedFuture', 'Select a future semester first.'));
      return;
    }
    if (!confirm(t('admin.timetables.copyConfirm', 'Copy the current timetable (subjects, teachers, and slots) into this semester? Existing future slots will be replaced if you confirm again.'))) {
      return;
    }
    try {
      let result = await api('/api/admin/timetable/copy-plan', {
        method: 'POST',
        body: { fromSemesterKey: fromKey, toSemesterKey: toKey }
      }, role);
      if (result.needsOverwrite) {
        if (!confirm(t('admin.timetables.copyOverwrite', 'This semester already has a timetable. Replace it with the current one?'))) {
          return;
        }
        result = await api('/api/admin/timetable/copy-plan', {
          method: 'POST',
          body: { fromSemesterKey: fromKey, toSemesterKey: toKey, overwrite: true }
        }, role);
      }
      await afterPlanChange();
      alert(t('admin.timetables.copyDone', 'Copied.') +
        ' ' + (result.classesCopied || 0) + ' classes, ' +
        (result.slotsCopied || 0) + ' slots, ' +
        (result.requirementsCopied || 0) + ' subject rows.');
    } catch (e) {
      alert(e.message || 'Could not copy timetable.');
    }
  }

  async function open(mountEl, opts) {
    api = opts.api;
    role = opts.role || 'admin';
    escapeHtml = opts.escapeHtml;
    classes = opts.classes || [];
    teachers = opts.teachers || [];
    boardHandle = null;
    setupMountEl = mountEl;
    boardClassId = classes[0] ? classes[0].classId : '';

    mountEl.innerHTML = '<p class="muted">Loading timetable setup…</p>';

    let solverOk = false;
    try {
      const h = await api('/api/admin/timetable/solver-health', {}, role);
      solverOk = h.ok;
    } catch (e) { /* ignore */ }

    try {
      planContext = await api('/api/admin/school-semesters', {}, role);
    } catch (e) {
      planContext = { semesters: [], years: [], activeSemesterKey: '' };
    }

    let stored = '';
    try { stored = sessionStorage.getItem('saltTtSemesterKey') || ''; } catch (_) { stored = ''; }
    const initial = (planContext.semesters || []).find((s) => s.key === stored)
      || (planContext.semesters || []).find((s) => s.key === planContext.activeSemesterKey)
      || (planContext.semesters || [])[0]
      || null;
    setPlan(initial);

    mountEl.innerHTML =
      '<div class="tt-plan-bar"></div>' +
      '<div class="tt-setup-toolbar">' +
      '<button type="button" class="btn btn-ghost tt-bell-open">Bell schedule</button>' +
      '<button type="button" class="btn btn-ghost tt-req-open">Subject requirements</button>' +
      '</div>' +
      (solverOk
        ? '<p class="tt-solver-ok muted small">✓ Auto-Solve ready — locked cells are preserved</p>'
        : '<p class="tt-solver-warn muted small">Auto-Solve is offline (solver not connected). Drag-and-drop editing and <strong>Save &amp; sync</strong> still work.</p>') +
      '<div class="tt-setup-section">' +
      '<div class="tt-board-toolbar">' +
      '<strong>Class timetable board</strong>' +
      '<select class="tt-board-class">' +
      classes.map((c) =>
        '<option value="' + escapeHtml(c.classId) + '"' +
        (c.classId === boardClassId ? ' selected' : '') + '>' +
        escapeHtml(c.name) + '</option>'
      ).join('') +
      '</select>' +
      '</div>' +
      '<p class="muted small">Drag subject chips into the Mon–Fri × period grid. Green = free for that teacher; red = conflict. Use <strong>Subject requirements</strong> to set who teaches each subject.</p>' +
      '<div class="tt-setup-board-mount"></div>' +
      '</div>';

    renderPlanBar();

    mountEl.querySelector('.tt-bell-open').addEventListener('click', () => {
      openBellModal().catch((e) => alert(e.message || 'Could not open bell schedule.'));
    });
    mountEl.querySelector('.tt-req-open').addEventListener('click', () => {
      openReqModal().catch((e) => alert(e.message || 'Could not open subject requirements.'));
    });
    const boardSel = mountEl.querySelector('.tt-board-class');
    if (boardSel) {
      boardSel.addEventListener('change', () => {
        boardClassId = boardSel.value;
        refreshMainBoard(boardClassId);
      });
    }

    if (boardClassId) {
      await refreshMainBoard(boardClassId);
    } else {
      const boardMount = mainBoardMount();
      if (boardMount) boardMount.innerHTML = '<p class="muted">Create a class first.</p>';
    }
  }

  global.SaltTimetableSetup = { open };
})(window);
