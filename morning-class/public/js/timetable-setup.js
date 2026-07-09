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
      '<div class="tt-setup-section">' +
      '<h4>Bell schedule (school day structure)</h4>' +
      '<p class="muted small">Set each period, recess, and lunch. Only <strong>Lesson</strong> rows are used for auto-scheduling.</p>' +
      '<table class="grades-table tt-bell-table"><thead><tr><th>Label</th><th>Type</th><th>Start</th><th>End</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="muted">No periods</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-ghost tt-bell-add">+ Add row</button>' +
      '<button type="button" class="btn btn-primary tt-bell-save">Save bell schedule</button>' +
      '</div>' +
      '<div class="tt-bell-error error"></div>' +
      '</div>';

    mountEl.querySelector('.tt-bell-add').addEventListener('click', () => {
      const tbody = mountEl.querySelector('tbody');
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
      } catch (e) {
        errEl.style.color = '#dc2626';
        errEl.textContent = e.message;
      }
    });

    mountEl.querySelectorAll('tbody tr').forEach((tr) => bindBellRow(tr, mountEl));
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

  function renderRequirements(mountEl, classId, requirements) {
    const teacherOpts = teachers.map((t) =>
      '<option value="' + escapeHtml(t.teacherId) + '">' + escapeHtml(t.name) + '</option>'
    ).join('');

    let rows = (requirements || []).map((r, i) => {
      const tOpts = teachers.map((t) =>
        '<option value="' + escapeHtml(t.teacherId) + '"' +
        (t.teacherId === r.teacherId ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>'
      ).join('');
      return (
      '<tr data-idx="' + i + '">' +
      '<td><input class="tt-req-subject" value="' + escapeHtml(r.subject) + '" list="ttSubjectList"></td>' +
      '<td><select class="tt-req-teacher">' + tOpts + '</select></td>' +
      '<td><input type="number" class="tt-req-ppw" min="1" max="20" value="' + (r.periodsPerWeek || 5) + '" style="width:4rem"></td>' +
      '<td><input class="tt-req-room" value="' + escapeHtml(r.room || '') + '" placeholder="Room"></td>' +
      '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>' +
      '</tr>'
      );
    }).join('');

    mountEl.innerHTML =
      '<div class="tt-setup-section">' +
      '<h4>Subject requirements</h4>' +
      '<p class="muted small">Periods per week per subject. Import from teacher assignments or edit manually.</p>' +
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
      '<table class="grades-table"><thead><tr><th>Subject</th><th>Teacher</th><th>Periods/wk</th><th>Room</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="muted">No requirements yet</td></tr>') + '</tbody></table>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-primary tt-req-save">Save requirements</button>' +
      '<button type="button" class="btn btn-primary tt-req-generate">Auto-generate timetable</button>' +
      '</div>' +
      '<div class="tt-req-error error"></div>' +
      '<div class="tt-req-result muted small"></div>' +
      '<div class="tt-preview-mount" style="margin-top:1rem"></div>' +
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
        '<td><button type="button" class="btn btn-ghost tt-req-del">✕</button></td>';
      tbody.appendChild(tr);
      tr.querySelector('.tt-req-del').addEventListener('click', () => tr.remove());
    });

    mountEl.querySelectorAll('.tt-req-del').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('tr').remove());
    });

    mountEl.querySelector('.tt-req-save').addEventListener('click', () => saveRequirements(mountEl, classSelect.value));
    mountEl.querySelector('.tt-req-generate').addEventListener('click', () => generateTimetable(mountEl, classSelect.value));
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
        subject,
        teacherId: tr.querySelector('.tt-req-teacher').value,
        periodsPerWeek: Number(tr.querySelector('.tt-req-ppw').value) || 5,
        room: tr.querySelector('.tt-req-room').value.trim()
      });
    });
    try {
      await api('/api/admin/timetable/requirements', {
        method: 'POST',
        body: { classId, requirements }
      }, 'admin');
      errEl.style.color = '#16a34a';
      errEl.textContent = 'Requirements saved.';
    } catch (e) {
      errEl.style.color = '#dc2626';
      errEl.textContent = e.message;
    }
  }

  async function generateTimetable(mountEl, classId) {
    const errEl = mountEl.querySelector('.tt-req-error');
    const resEl = mountEl.querySelector('.tt-req-result');
    errEl.textContent = '';
    resEl.textContent = 'Generating… (OR-Tools solver)';
    try {
      const data = await api('/api/admin/timetable/generate', {
        method: 'POST',
        body: { classId }
      }, 'admin');
      resEl.textContent = data.result.message + ' — ' +
        data.result.assignmentCount + ' slots, ' +
        data.result.studentsUpdated + ' students, ' +
        data.result.teachersUpdated + ' teachers updated.';
      const preview = mountEl.querySelector('.tt-preview-mount');
      if (preview && global.SaltTimetable) {
        preview.innerHTML = global.SaltTimetable.renderWeekGrid(data.timetable.byDay);
      }
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

    mountEl.innerHTML = '<p class="muted">Loading timetable setup…</p>';

    let solverOk = false;
    try {
      const h = await api('/api/admin/timetable/solver-health', {}, 'admin');
      solverOk = h.ok;
    } catch (e) { /* ignore */ }

    const bellData = await api('/api/admin/timetable/bell-schedule', {}, 'admin');
    const classId = classes[0] ? classes[0].classId : '';

    mountEl.innerHTML =
      (solverOk
        ? '<p class="tt-solver-ok muted small">✓ OR-Tools solver connected</p>'
        : '<p class="tt-solver-warn error">Solver offline — run: <code>cd morning-class/solver && pip install -r requirements.txt && python main.py</code></p>') +
      '<div id="ttBellMount"></div><div id="ttReqMount"></div>';

    renderBellEditor(mountEl.querySelector('#ttBellMount'), bellData);
    if (classId) {
      await loadRequirements(mountEl.querySelector('#ttReqMount'), classId);
    } else {
      mountEl.querySelector('#ttReqMount').innerHTML = '<p class="muted">Create a class first.</p>';
    }
  }

  global.SaltTimetableSetup = { open };
})(window);
