/* Salt Morning Class — Admin Bus (timetable grid) */
window.SaltAdminBus = (function () {
  const DAY_LABELS = [
    { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }
  ];
  const PICKUP_TIME = '08:00';

  let deps = {};
  let setup = null;
  let board = null;
  let sub = 'setup';
  let editRun = null;
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

  function activeBuses() {
    return (setup && setup.buses || []).filter((b) => b.active !== false);
  }

  function dismissalTimes() {
    const times = new Set();
    (setup && setup.runs || []).forEach((r) => {
      if (r.active === false) return;
      if (r.runType !== 'dismissal') return;
      const tm = String(r.startTime || '').slice(0, 5);
      if (/^\d{2}:\d{2}$/.test(tm)) times.add(tm);
    });
    return Array.from(times).sort();
  }

  function dismissLabel(time, index) {
    return (index + 1) + '차하교 ' + time;
  }

  function findRun(busId, runType, time) {
    return (setup.runs || []).find((r) => {
      if (r.active === false) return false;
      if (r.busId !== busId) return false;
      if (r.runType !== runType) return false;
      if (runType === 'pickup') return true;
      return String(r.startTime || '').slice(0, 5) === time;
    }) || null;
  }

  function daysCheckboxesHtml(selected) {
    const set = new Set((selected || [1, 2, 3, 4, 5]).map(Number));
    return DAY_LABELS.map((d) =>
      '<label class="bus-day"><input type="checkbox" data-days="route" value="' + d.n + '"' +
      (set.has(d.n) ? ' checked' : '') + '> ' + d.label + '</label>'
    ).join(' ');
  }

  function readDays() {
    const el = $('busRouteDays');
    if (!el) return [1, 2, 3, 4, 5];
    const boxes = el.querySelectorAll('input[data-days="route"]:checked');
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

    if ($('busAddDismissBtn')) $('busAddDismissBtn').addEventListener('click', addDismissalTime);
    if ($('busRouteSaveBtn')) $('busRouteSaveBtn').addEventListener('click', saveRouteCell);
    if ($('busRouteModalClose')) $('busRouteModalClose').addEventListener('click', closeRouteModal);
    if ($('busRouteModal')) {
      $('busRouteModal').addEventListener('click', (e) => {
        if (e.target === $('busRouteModal')) closeRouteModal();
      });
    }

    const search = $('busStudentSearch');
    if (search) {
      search.addEventListener('input', onStudentSearch);
      search.addEventListener('blur', () => setTimeout(hideSearchResults, 150));
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
      const saved = await api('/api/admin/bus', {
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
      await ensureRunsForBus(saved.bus);
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function ensureRunsForBus(bus) {
    if (!bus || !bus.busId) return;
    const times = dismissalTimes();
    await api('/api/admin/bus/run', {
      method: 'POST',
      body: {
        busId: bus.busId,
        runType: 'pickup',
        label: '등교',
        startTime: PICKUP_TIME,
        sortOrder: 10,
        active: true
      }
    });
    for (let i = 0; i < times.length; i++) {
      await api('/api/admin/bus/run', {
        method: 'POST',
        body: {
          busId: bus.busId,
          runType: 'dismissal',
          label: dismissLabel(times[i], i),
          startTime: times[i],
          sortOrder: 50 + i * 10,
          active: true
        }
      });
    }
  }

  async function ensureMatrix() {
    const buses = activeBuses();
    const times = dismissalTimes();
    for (const bus of buses) {
      if (!findRun(bus.busId, 'pickup')) {
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            busId: bus.busId,
            runType: 'pickup',
            label: '등교',
            startTime: PICKUP_TIME,
            sortOrder: 10,
            active: true
          }
        });
      }
      for (let i = 0; i < times.length; i++) {
        if (!findRun(bus.busId, 'dismissal', times[i])) {
          await api('/api/admin/bus/run', {
            method: 'POST',
            body: {
              busId: bus.busId,
              runType: 'dismissal',
              label: dismissLabel(times[i], i),
              startTime: times[i],
              sortOrder: 50 + i * 10,
              active: true
            }
          });
        } else {
          // keep labels in sync with order
          const existing = findRun(bus.busId, 'dismissal', times[i]);
          if (existing && existing.label !== dismissLabel(times[i], i)) {
            await api('/api/admin/bus/run', {
              method: 'POST',
              body: {
                runId: existing.runId,
                busId: bus.busId,
                runType: 'dismissal',
                label: dismissLabel(times[i], i),
                startTime: times[i],
                sortOrder: 50 + i * 10,
                active: true
              }
            });
          }
        }
      }
    }
  }

  async function addDismissalTime() {
    const input = $('busNewDismissTime');
    const time = input && input.value ? String(input.value).slice(0, 5) : '';
    if (!/^\d{2}:\d{2}$/.test(time)) {
      window.alert(t('admin.bus.needTime', 'Select a time.'));
      return;
    }
    if (dismissalTimes().includes(time)) {
      window.alert(t('admin.bus.timeExists', 'That dismissal time already exists.'));
      return;
    }
    const buses = activeBuses();
    if (!buses.length) {
      window.alert(t('admin.bus.needBusFirst', 'Add a bus first.'));
      return;
    }
    try {
      const nextIndex = dismissalTimes().length;
      for (const bus of buses) {
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            busId: bus.busId,
            runType: 'dismissal',
            label: dismissLabel(time, nextIndex),
            startTime: time,
            sortOrder: 50 + nextIndex * 10,
            active: true
          }
        });
      }
      if (input) input.value = '';
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  function renderFleetList() {
    const mount = $('busFleetList');
    if (!mount || !setup) return;
    const buses = activeBuses();
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

  function renderDismissTimes() {
    const mount = $('busDismissTimes');
    if (!mount) return;
    const times = dismissalTimes();
    if (!times.length) {
      mount.innerHTML = '<span class="muted small">' +
        escapeHtml(t('admin.bus.noDismissTimes', 'No dismissal times yet — add 14:30, 15:30…')) +
        '</span>';
      return;
    }
    mount.innerHTML = times.map((tm, i) =>
      '<span class="bus-dismiss-chip"><strong>' + escapeHtml(dismissLabel(tm, i)) + '</strong></span>'
    ).join('');
  }

  function cellSummary(run) {
    if (!run) return { count: 0, duty: '', days: [1, 2, 3, 4, 5] };
    const assigns = (setup.assignments || []).filter((a) => a.runId === run.runId && a.active !== false);
    const duty = (setup.duties || []).find((d) => d.runId === run.runId && d.active !== false);
    const teacher = duty
      ? ((setup.teachers || []).find((te) => te.teacherId === duty.teacherId) || {}).name || duty.teacherId
      : '';
    const days = (duty && duty.days) || (assigns[0] && assigns[0].days) || [1, 2, 3, 4, 5];
    return { count: assigns.length, duty: teacher || '', days, assigns, dutyRow: duty };
  }

  function renderRouteGrid() {
    const mount = $('busRouteGrid');
    if (!mount || !setup) return;
    const buses = activeBuses();
    const times = dismissalTimes();

    if (!buses.length) {
      mount.innerHTML = '<p class="muted">' + escapeHtml(t('admin.bus.noBuses', 'No buses yet.')) + '</p>';
      return;
    }

    const rows = [{ key: 'pickup', label: t('admin.bus.pickupRow', '등교'), runType: 'pickup', time: PICKUP_TIME }]
      .concat(times.map((tm, i) => ({
        key: 'd-' + tm,
        label: dismissLabel(tm, i),
        runType: 'dismissal',
        time: tm
      })));

    let html = '<div class="bus-tt-scroll"><table class="bus-tt-grid"><thead><tr>' +
      '<th class="bus-tt-corner">' + escapeHtml(t('admin.bus.route', 'Route')) + '</th>' +
      buses.map((b) => '<th>' + escapeHtml(b.name) + '</th>').join('') +
      '</tr></thead><tbody>';

    rows.forEach((row) => {
      html += '<tr><th class="bus-tt-rowlabel">' + escapeHtml(row.label) + '</th>';
      buses.forEach((bus) => {
        const run = findRun(bus.busId, row.runType, row.time);
        const sum = cellSummary(run);
        const empty = !run || sum.count === 0;
        html += '<td><button type="button" class="bus-tt-card' + (empty ? ' bus-tt-empty' : '') + '"' +
          ' data-bus="' + escapeHtml(bus.busId) + '"' +
          ' data-type="' + escapeHtml(row.runType) + '"' +
          ' data-time="' + escapeHtml(row.time) + '"' +
          (run ? ' data-run="' + escapeHtml(run.runId) + '"' : '') +
          '>' +
          '<strong>' + escapeHtml(String(sum.count)) + ' ' +
          escapeHtml(t('admin.bus.studentsShort', 'students')) + '</strong>' +
          '<span class="muted small">' +
            escapeHtml(sum.duty || t('admin.bus.noDuty', 'No duty')) +
          '</span></button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    mount.innerHTML = html;

    mount.querySelectorAll('.bus-tt-card').forEach((btn) => {
      btn.addEventListener('click', () => openRouteCell(btn.dataset));
    });
  }

  async function openRouteCell(ds) {
    const busId = ds.bus;
    const runType = ds.type;
    const time = ds.time;
    let run = findRun(busId, runType, time);
    if (!run) {
      try {
        const times = dismissalTimes();
        const idx = times.indexOf(time);
        const res = await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            busId,
            runType,
            label: runType === 'pickup' ? '등교' : dismissLabel(time, Math.max(0, idx)),
            startTime: runType === 'pickup' ? PICKUP_TIME : time,
            sortOrder: runType === 'pickup' ? 10 : (50 + Math.max(0, idx) * 10),
            active: true
          }
        });
        run = res.run;
        await loadSetup(false);
        run = findRun(busId, runType, time) || run;
      } catch (e) {
        window.alert(e.message);
        return;
      }
    }
    editRun = run;
    const bus = activeBuses().find((b) => b.busId === busId);
    const sum = cellSummary(run);
    const title = (bus ? bus.name + ' · ' : '') +
      (runType === 'pickup'
        ? t('admin.bus.pickupRow', '등교')
        : dismissLabel(time, Math.max(0, dismissalTimes().indexOf(time))));
    if ($('busRouteModalTitle')) $('busRouteModalTitle').textContent = title;
    if ($('busRouteModalMeta')) {
      $('busRouteModalMeta').textContent = t(
        'admin.bus.cellHelp',
        'Semester default riders for this route. Parent notices update the daily board.'
      );
    }

    const teacherOpts = '<option value="">—</option>' + (setup.teachers || [])
      .map((te) => '<option value="' + escapeHtml(te.teacherId) + '">' + escapeHtml(te.name) + '</option>')
      .join('');
    if ($('busRouteTeacherId')) {
      $('busRouteTeacherId').innerHTML = teacherOpts;
      $('busRouteTeacherId').value = sum.dutyRow ? sum.dutyRow.teacherId : '';
    }
    if ($('busRouteDays')) $('busRouteDays').innerHTML = daysCheckboxesHtml(sum.days);

    selectedStudents = new Map();
    (sum.assigns || []).forEach((a) => {
      const st = (setup.students || []).find((s) => s.studentId === a.studentId);
      selectedStudents.set(a.studentId, st || { studentId: a.studentId, name: a.studentId, classId: '' });
    });
    renderStudentChips();
    if ($('busRouteError')) $('busRouteError').textContent = '';
    if ($('busRouteOk')) $('busRouteOk').textContent = '';
    if ($('busStudentSearch')) $('busStudentSearch').value = '';
    hideSearchResults();
    deps.show($('busRouteModal'));
  }

  function closeRouteModal() {
    if ($('busRouteModal')) deps.hide($('busRouteModal'));
    editRun = null;
    selectedStudents = new Map();
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
      hideSearchResults();
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

  async function saveRouteCell() {
    if (!editRun) return;
    const errEl = $('busRouteError');
    const okEl = $('busRouteOk');
    if (errEl) errEl.textContent = '';
    if (okEl) okEl.textContent = '';

    const teacherId = $('busRouteTeacherId') && $('busRouteTeacherId').value;
    const days = readDays();
    if (!teacherId) {
      if (errEl) errEl.textContent = t('admin.bus.needTeacher', 'Select a duty teacher.');
      return;
    }

    try {
      await api('/api/admin/bus/duty', {
        method: 'POST',
        body: { runId: editRun.runId, teacherId, days, active: true }
      });

      const existing = (setup.assignments || []).filter((a) => a.runId === editRun.runId && a.active !== false);
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
            runId: editRun.runId,
            days,
            active: true
          }
        });
      }
      if (okEl) okEl.textContent = t('admin.bus.routeSaved', 'Route saved.');
      await loadSetup(false);
      editRun = findRun(editRun.busId, editRun.runType, editRun.startTime) || editRun;
    } catch (e) {
      if (errEl) errEl.textContent = e.message || 'Failed';
    }
  }

  async function loadSetup(doEnsure) {
    try {
      setup = await api('/api/admin/bus/setup');
      if (doEnsure !== false) {
        const before = JSON.stringify((setup.runs || []).map((r) => r.runId).sort());
        await ensureMatrix();
        setup = await api('/api/admin/bus/setup');
        const after = JSON.stringify((setup.runs || []).map((r) => r.runId).sort());
        if (before !== after) {
          // labels may need second pass
          await ensureMatrix();
          setup = await api('/api/admin/bus/setup');
        }
      }
      renderFleetList();
      renderDismissTimes();
      renderRouteGrid();
    } catch (e) {
      if ($('busRouteGrid')) {
        $('busRouteGrid').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
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
          const title = isPickup
            ? (run.busName + ' · 등교')
            : (run.busName + ' · ' + (run.label || run.startTime));
          return '<section class="bus-duty-card">' +
            '<header class="bus-duty-head">' +
              '<div><strong>' + escapeHtml(title) + '</strong> ' +
              (isPickup ? '' : '<span class="muted">' + escapeHtml(run.startTime || '') + '</span>') +
              '</div>' +
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
