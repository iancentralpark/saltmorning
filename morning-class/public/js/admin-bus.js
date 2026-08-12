/* Salt Morning Class — Admin Bus (simplified) */
window.SaltAdminBus = (function () {
  const DAY_LABELS = [
    { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }
  ];
  const PICKUP_TIMES = ['07:30', '08:00', '08:30', '09:00'];
  const DISMISSAL_TIMES = ['15:10', '15:30', '16:00', '16:30', '17:00'];

  let deps = {};
  let setup = null;
  let board = null;
  let sub = 'setup';
  let editRunId = null;
  let runType = 'pickup';
  let selectedStudents = new Map();

  function $(id) { return deps.$(id); }
  function api(path, opts) { return deps.api(path, opts || {}, deps.role || 'admin'); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function t(key, fallback) {
    return window.SaltI18n ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function daysCheckboxesHtml(name, selected) {
    const set = new Set((selected || [1, 2, 3, 4, 5]).map(Number));
    return DAY_LABELS.map((d) =>
      '<label class="bus-day"><input type="checkbox" data-days="' + name + '" value="' + d.n + '"' +
      (set.has(d.n) ? ' checked' : '') + '> ' + d.label + '</label>'
    ).join(' ');
  }

  function readDays(name) {
    const el = $('busRouteDays');
    if (!el) return [1, 2, 3, 4, 5];
    const boxes = el.querySelectorAll('input[data-days="' + name + '"]:checked');
    const days = Array.from(boxes).map((b) => Number(b.value)).filter((n) => n >= 1 && n <= 5);
    return days.length ? days : [1, 2, 3, 4, 5];
  }

  function init(options) {
    deps = options || {};
    const dateEl = $('busBoardDate');
    if (dateEl && !dateEl.value) dateEl.value = todayISO();

    if ($('busSubBoard')) $('busSubBoard').addEventListener('click', () => setSub('board'));
    if ($('busSubSetup')) $('busSubSetup').addEventListener('click', () => setSub('setup'));
    if ($('busBoardRefresh')) $('busBoardRefresh').addEventListener('click', loadBoard);
    if (dateEl) dateEl.addEventListener('change', loadBoard);

    if ($('busAddFleetBtn')) $('busAddFleetBtn').addEventListener('click', () => openFleetModal());
    if ($('busFleetCancel')) $('busFleetCancel').addEventListener('click', closeFleetModal);
    if ($('busFleetForm')) $('busFleetForm').addEventListener('submit', onSaveFleetBus);
    if ($('busFleetModal')) {
      $('busFleetModal').addEventListener('click', (e) => {
        if (e.target === $('busFleetModal')) closeFleetModal();
      });
    }

    document.querySelectorAll('#busRouteTypeToggle button').forEach((btn) => {
      btn.addEventListener('click', () => setRunType(btn.dataset.type || 'pickup'));
    });
    if ($('busRouteTime')) $('busRouteTime').addEventListener('change', syncTimePresets);
    if ($('busRouteSaveBtn')) $('busRouteSaveBtn').addEventListener('click', saveRoute);
    if ($('busRouteNewBtn')) $('busRouteNewBtn').addEventListener('click', resetRouteForm);

    const search = $('busStudentSearch');
    if (search) {
      search.addEventListener('input', onStudentSearch);
      search.addEventListener('blur', () => {
        setTimeout(() => hideSearchResults(), 150);
      });
    }
  }

  function setSub(name) {
    sub = name;
    const isSetup = name === 'setup';
    if ($('busSubSetup')) $('busSubSetup').classList.toggle('active', isSetup);
    if ($('busSubBoard')) $('busSubBoard').classList.toggle('active', !isSetup);
    if ($('busSetupPanel')) deps[isSetup ? 'show' : 'hide']($('busSetupPanel'));
    if ($('busBoardPanel')) deps[isSetup ? 'hide' : 'show']($('busBoardPanel'));
    if ($('busBoardTools')) $('busBoardTools').classList.toggle('hidden', isSetup);
    if (isSetup) loadSetup();
    else loadBoard();
  }

  async function open() {
    setSub(sub || 'setup');
  }

  function setRunType(type) {
    runType = type === 'dismissal' ? 'dismissal' : 'pickup';
    document.querySelectorAll('#busRouteTypeToggle button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.type === runType);
    });
    renderTimePresets();
  }

  function renderTimePresets() {
    const mount = $('busTimePresets');
    if (!mount) return;
    const times = runType === 'dismissal' ? DISMISSAL_TIMES : PICKUP_TIMES;
    const cur = ($('busRouteTime') && $('busRouteTime').value) || '';
    mount.innerHTML = times.map((time) =>
      '<button type="button" class="btn btn-ghost bus-time-chip' +
      (cur === time ? ' active' : '') + '" data-time="' + time + '">' + time + '</button>'
    ).join('');
    mount.querySelectorAll('.bus-time-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if ($('busRouteTime')) $('busRouteTime').value = btn.dataset.time;
        renderTimePresets();
      });
    });
    if ($('busRouteTime') && !$('busRouteTime').value && times[0]) {
      $('busRouteTime').value = times[0];
      renderTimePresets();
    }
  }

  function syncTimePresets() {
    renderTimePresets();
  }

  function openFleetModal(bus) {
    const modal = $('busFleetModal');
    if (!modal) return;
    if ($('busFleetModalTitle')) {
      $('busFleetModalTitle').textContent = bus
        ? t('admin.bus.editBus', 'Edit bus')
        : t('admin.bus.addBus', 'Add bus');
    }
    if ($('busEditId')) $('busEditId').value = bus ? bus.busId : '';
    if ($('busName')) $('busName').value = bus ? bus.name : '';
    if ($('busDriverName')) $('busDriverName').value = bus ? bus.driverName : '';
    if ($('busDriverPhone')) $('busDriverPhone').value = bus ? bus.driverPhone : '';
    if ($('busPlate')) $('busPlate').value = bus ? bus.vehiclePlate : '';
    if ($('busVehicleInfo')) $('busVehicleInfo').value = bus ? bus.vehicleInfo : '';
    deps.show(modal);
  }

  function closeFleetModal() {
    if ($('busFleetModal')) deps.hide($('busFleetModal'));
    if ($('busFleetForm')) $('busFleetForm').reset();
    if ($('busEditId')) $('busEditId').value = '';
  }

  async function onSaveFleetBus(ev) {
    ev.preventDefault();
    try {
      await api('/api/admin/bus', {
        method: 'POST',
        body: {
          busId: ($('busEditId') && $('busEditId').value) || undefined,
          name: $('busName').value,
          driverName: $('busDriverName').value,
          driverPhone: $('busDriverPhone').value,
          vehiclePlate: $('busPlate').value,
          vehicleInfo: $('busVehicleInfo').value,
          active: true
        }
      });
      closeFleetModal();
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  function renderFleetList() {
    const mount = $('busFleetList');
    if (!mount || !setup) return;
    const buses = (setup.buses || []).filter((b) => b.active !== false);
    if (!buses.length) {
      mount.innerHTML = '<span class="muted small">' + escapeHtml(t('admin.bus.noBuses', 'No buses yet.')) + '</span>';
      return;
    }
    mount.innerHTML = buses.map((b) =>
      '<button type="button" class="bus-fleet-chip" data-bus="' + escapeHtml(b.busId) + '">' +
        '<strong>' + escapeHtml(b.name) + '</strong>' +
        '<span class="muted small">' + escapeHtml([b.driverName, b.vehiclePlate].filter(Boolean).join(' · ')) + '</span>' +
      '</button>'
    ).join('');
    mount.querySelectorAll('.bus-fleet-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bus = buses.find((b) => b.busId === btn.dataset.bus);
        if (bus) openFleetModal(bus);
      });
    });
  }

  function fillRouteSelects() {
    if (!setup) return;
    const busOpts = '<option value="">—</option>' + (setup.buses || [])
      .filter((b) => b.active !== false)
      .map((b) => '<option value="' + escapeHtml(b.busId) + '">' + escapeHtml(b.name) + '</option>')
      .join('');
    const teacherOpts = '<option value="">—</option>' + (setup.teachers || [])
      .map((te) => '<option value="' + escapeHtml(te.teacherId) + '">' + escapeHtml(te.name) + '</option>')
      .join('');
    if ($('busRouteBusId')) $('busRouteBusId').innerHTML = busOpts;
    if ($('busRouteTeacherId')) $('busRouteTeacherId').innerHTML = teacherOpts;
    if ($('busRouteDays')) $('busRouteDays').innerHTML = daysCheckboxesHtml('route', [1, 2, 3, 4, 5]);
    renderTimePresets();
  }

  function renderStudentChips() {
    const mount = $('busStudentChips');
    if (!mount) return;
    const list = Array.from(selectedStudents.values());
    if (!list.length) {
      mount.innerHTML = '<span class="muted small">' + escapeHtml(t('admin.bus.noStudents', 'No students added.')) + '</span>';
      return;
    }
    mount.innerHTML = list.map((s) =>
      '<span class="bus-student-chip">' + escapeHtml(s.name) +
      (s.classId ? ' <span class="muted">(' + escapeHtml(s.classId) + ')</span>' : '') +
      ' <button type="button" class="bus-chip-remove" data-id="' + escapeHtml(s.studentId) + '" aria-label="Remove">×</button></span>'
    ).join('');
    mount.querySelectorAll('.bus-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStudents.delete(btn.dataset.id);
        renderStudentChips();
      });
    });
  }

  function onStudentSearch() {
    const q = String(($('busStudentSearch') && $('busStudentSearch').value) || '').trim().toLowerCase();
    const results = $('busStudentSearchResults');
    if (!results || !setup) return;
    if (q.length < 1) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }
    const hits = (setup.students || []).filter((s) => {
      const hay = (s.name + ' ' + s.classId + ' ' + s.studentId).toLowerCase();
      return hay.includes(q) && !selectedStudents.has(s.studentId);
    }).slice(0, 12);
    if (!hits.length) {
      results.innerHTML = '<div class="bus-search-empty muted small">No matches</div>';
      results.classList.remove('hidden');
      return;
    }
    results.innerHTML = hits.map((s) =>
      '<button type="button" class="bus-search-hit" data-id="' + escapeHtml(s.studentId) + '">' +
        escapeHtml(s.name) + (s.classId ? ' <span class="muted">(' + escapeHtml(s.classId) + ')</span>' : '') +
      '</button>'
    ).join('');
    results.classList.remove('hidden');
    results.querySelectorAll('.bus-search-hit').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const st = (setup.students || []).find((x) => x.studentId === btn.dataset.id);
        if (st) {
          selectedStudents.set(st.studentId, st);
          renderStudentChips();
        }
        if ($('busStudentSearch')) $('busStudentSearch').value = '';
        hideSearchResults();
      });
    });
  }

  function hideSearchResults() {
    const results = $('busStudentSearchResults');
    if (results) {
      results.classList.add('hidden');
      results.innerHTML = '';
    }
  }

  function resetRouteForm() {
    editRunId = null;
    selectedStudents = new Map();
    if ($('busRouteBusId')) $('busRouteBusId').value = '';
    if ($('busRouteTeacherId')) $('busRouteTeacherId').value = '';
    if ($('busRouteError')) $('busRouteError').textContent = '';
    if ($('busRouteOk')) $('busRouteOk').textContent = '';
    setRunType('pickup');
    if ($('busRouteDays')) $('busRouteDays').innerHTML = daysCheckboxesHtml('route', [1, 2, 3, 4, 5]);
    renderStudentChips();
  }

  function loadRouteIntoForm(group) {
    if (!group) return;
    editRunId = group.run.runId;
    if ($('busRouteBusId')) $('busRouteBusId').value = group.run.busId || '';
    setRunType(group.run.runType || 'pickup');
    if ($('busRouteTime')) $('busRouteTime').value = group.run.startTime || '';
    renderTimePresets();
    if ($('busRouteTeacherId')) {
      $('busRouteTeacherId').value = group.duty ? group.duty.teacherId : '';
    }
    const days = group.duty && group.duty.days ? group.duty.days
      : (group.riders[0] && group.riders[0].days) || [1, 2, 3, 4, 5];
    if ($('busRouteDays')) $('busRouteDays').innerHTML = daysCheckboxesHtml('route', days);
    selectedStudents = new Map();
    group.riders.forEach((r) => {
      const st = (setup.students || []).find((s) => s.studentId === r.studentId);
      selectedStudents.set(r.studentId, st || { studentId: r.studentId, name: r.studentId, classId: '' });
    });
    renderStudentChips();
    if ($('busRouteOk')) $('busRouteOk').textContent = '';
    if ($('busRouteError')) $('busRouteError').textContent = '';
  }

  function groupRoutes() {
    const runs = (setup && setup.runs || []).filter((r) => r.active !== false);
    const assigns = setup.assignments || [];
    const duties = setup.duties || [];
    const buses = setup.buses || [];
    const teachers = setup.teachers || [];
    return runs.map((run) => {
      const bus = buses.find((b) => b.busId === run.busId);
      const duty = duties.find((d) => d.runId === run.runId && d.active !== false);
      const riders = assigns.filter((a) => a.runId === run.runId && a.active !== false);
      const teacher = duty ? teachers.find((t) => t.teacherId === duty.teacherId) : null;
      return { run, bus, duty, teacher, riders };
    }).sort((a, b) =>
      (a.run.startTime || '').localeCompare(b.run.startTime || '') ||
      String(a.bus && a.bus.name).localeCompare(String(b.bus && b.bus.name))
    );
  }

  function renderSavedRoutes() {
    const mount = $('busSavedRoutes');
    if (!mount || !setup) return;
    const groups = groupRoutes();
    if (!groups.length) {
      mount.innerHTML = '<p class="muted small">' + escapeHtml(t('admin.bus.noRoutes', 'No routes saved yet.')) + '</p>';
      return;
    }
    mount.innerHTML = groups.map((g) => {
      const typeLabel = g.run.runType === 'dismissal'
        ? t('admin.bus.dismissal', 'Dismissal')
        : t('admin.bus.pickup', 'Pickup');
      return '<button type="button" class="bus-saved-card" data-run="' + escapeHtml(g.run.runId) + '">' +
        '<div class="bus-saved-title"><strong>' + escapeHtml((g.bus && g.bus.name) || '?') + '</strong> · ' +
        escapeHtml(typeLabel) + ' ' + escapeHtml(g.run.startTime || '') + '</div>' +
        '<div class="muted small">' +
          escapeHtml((g.teacher && g.teacher.name) || 'No duty teacher') +
          ' · ' + escapeHtml(String(g.riders.length)) + ' students' +
        '</div></button>';
    }).join('');
    mount.querySelectorAll('.bus-saved-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const g = groups.find((x) => x.run.runId === btn.dataset.run);
        loadRouteIntoForm(g);
      });
    });
  }

  async function saveRoute() {
    const errEl = $('busRouteError');
    const okEl = $('busRouteOk');
    if (errEl) errEl.textContent = '';
    if (okEl) okEl.textContent = '';

    const busId = $('busRouteBusId') && $('busRouteBusId').value;
    const time = $('busRouteTime') && $('busRouteTime').value;
    const teacherId = $('busRouteTeacherId') && $('busRouteTeacherId').value;
    const days = readDays('route');

    if (!busId) {
      if (errEl) errEl.textContent = t('admin.bus.needBus', 'Select a bus.');
      return;
    }
    if (!time) {
      if (errEl) errEl.textContent = t('admin.bus.needTime', 'Select a time.');
      return;
    }
    if (!teacherId) {
      if (errEl) errEl.textContent = t('admin.bus.needTeacher', 'Select a duty teacher.');
      return;
    }
    if (!selectedStudents.size) {
      if (errEl) errEl.textContent = t('admin.bus.needStudent', 'Add at least one student.');
      return;
    }

    const label = (runType === 'pickup' ? 'Morning pickup ' : 'Dismissal ') + time.slice(0, 5);
    try {
      const runRes = await api('/api/admin/bus/run', {
        method: 'POST',
        body: {
          runId: editRunId || undefined,
          busId,
          runType,
          label,
          startTime: time,
          active: true
        }
      });
      const runId = runRes.run.runId;

      await api('/api/admin/bus/duty', {
        method: 'POST',
        body: { runId, teacherId, days, active: true }
      });

      const existing = (setup.assignments || []).filter((a) => a.runId === runId && a.active !== false);
      const wantIds = new Set(Array.from(selectedStudents.keys()));

      for (const a of existing) {
        if (!wantIds.has(a.studentId)) {
          await api('/api/admin/bus/assignment/' + encodeURIComponent(a.assignmentId), { method: 'DELETE' });
        }
      }
      for (const sid of wantIds) {
        const prev = existing.find((a) => a.studentId === sid);
        await api('/api/admin/bus/assignment', {
          method: 'POST',
          body: {
            assignmentId: prev ? prev.assignmentId : undefined,
            studentId: sid,
            runId,
            days,
            active: true
          }
        });
      }

      editRunId = runId;
      if (okEl) okEl.textContent = t('admin.bus.routeSaved', 'Route saved.');
      await loadSetup();
      loadRouteIntoForm(groupRoutes().find((g) => g.run.runId === runId));
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed';
    }
  }

  async function loadSetup() {
    try {
      setup = await api('/api/admin/bus/setup');
      renderFleetList();
      fillRouteSelects();
      if (!editRunId) resetRouteForm();
      renderSavedRoutes();
    } catch (e) {
      if ($('busSavedRoutes')) $('busSavedRoutes').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function loadBoard() {
    const mount = $('busBoardBody');
    if (!mount) return;
    const dateStr = ($('busBoardDate') && $('busBoardDate').value) || todayISO();
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      board = await api('/api/admin/bus/board?date=' + encodeURIComponent(dateStr));
      renderBoard();
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderBoard() {
    const mount = $('busBoardBody');
    if (!mount || !board) return;
    if (board.note && !(board.runs || []).length) {
      mount.innerHTML = '<p class="muted">' + escapeHtml(board.note) + '</p>';
      return;
    }
    const runs = board.runs || [];
    mount.innerHTML =
      '<div class="bus-board-runs">' +
        runs.map((run) => {
          const isPickup = run.runType === 'pickup';
          const duty = (run.dutyTeachers || []).map((te) => te.teacherName).join(', ') || '—';
          return '<section class="bus-duty-card">' +
            '<header class="bus-duty-head">' +
              '<div><strong>' + escapeHtml(run.busName) + '</strong> · ' +
              escapeHtml(run.label || run.runType) + ' <span class="muted">' + escapeHtml(run.startTime || '') + '</span></div>' +
              '<div class="muted small">' + escapeHtml(run.riderCount + ' riders') + ' · Duty: ' + escapeHtml(duty) + '</div>' +
              '<div class="muted small">' + escapeHtml([run.driverName, run.driverPhone, run.vehiclePlate].filter(Boolean).join(' · ')) + '</div>' +
            '</header>' +
            '<table class="bus-duty-table"><thead><tr>' +
              '<th>Student</th><th>Contact</th>' +
              (isPickup ? '<th></th>' : '') +
            '</tr></thead><tbody>' +
              (run.riders || []).map((r) => {
                const contact = [
                  r.emergency && r.emergency.parentPhone,
                  r.emergency && r.emergency.emergencyContact,
                  r.emergency && r.emergency.emergencyPhone
                ].filter(Boolean).join(' · ') || '—';
                return '<tr class="' + (r.noShow ? 'bus-noshow' : '') + '">' +
                  '<td><strong>' + escapeHtml(r.name) + '</strong>' +
                  (r.classId ? ' <span class="muted">(' + escapeHtml(r.classId) + ')</span>' : '') +
                  (r.noShow ? ' <span class="error">No-show</span>' : '') + '</td>' +
                  '<td class="muted small">' + escapeHtml(contact) + '</td>' +
                  (isPickup
                    ? '<td class="bus-duty-action"><button type="button" class="btn btn-ghost bus-ns-btn" data-run="' +
                      escapeHtml(run.runId) + '" data-sid="' + escapeHtml(r.studentId) + '">No-show</button></td>'
                    : '') +
                '</tr>';
              }).join('') || '<tr><td colspan="3" class="muted">No riders</td></tr>' +
            '</tbody></table></section>';
        }).join('') || '<p class="muted">No active runs.</p>' +
      '</div>';

    mount.querySelectorAll('.bus-ns-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/bus/noshow', {
            method: 'POST',
            body: { dateStr: board.dateStr, runId: btn.dataset.run, studentId: btn.dataset.sid }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
  }

  return { init, open };
})();
