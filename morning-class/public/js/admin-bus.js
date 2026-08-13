/* Salt Morning Class — Admin Bus (weekday schedule view) */
window.SaltAdminBus = (function () {
  const DAY_LABELS = [
    { n: 1, label: 'Mon', ko: '월' },
    { n: 2, label: 'Tue', ko: '화' },
    { n: 3, label: 'Wed', ko: '수' },
    { n: 4, label: 'Thu', ko: '목' },
    { n: 5, label: 'Fri', ko: '금' }
  ];
  const PICKUP_TIME = '08:00';

  let deps = {};
  let setup = null;
  let board = null;
  let editRun = null;
  let selectedStudents = new Map();
  let setupWeekday = 1; // 1 Mon .. 5 Fri
  let boardWeekday = 1;
  let boardWeekMonday = null; // YYYY-MM-DD of Monday

  function $(id) { return deps.$(id); }
  function api(path, opts) { return deps.api(path, opts || {}, deps.role || 'admin'); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function t(key, fallback) {
    return window.SaltI18n ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function todayISO() {
    const d = new Date();
    return formatISO(d);
  }

  function formatISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function parseISO(s) {
    return new Date(String(s).slice(0, 10) + 'T12:00:00');
  }

  function mondayOf(dateStr) {
    const d = parseISO(dateStr || todayISO());
    const dow = d.getDay(); // 0 Sun
    const offset = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + offset);
    return formatISO(d);
  }

  function dateForWeekday(mondayStr, weekday) {
    // weekday 1=Mon .. 5=Fri
    const d = parseISO(mondayStr);
    d.setDate(d.getDate() + (Number(weekday) - 1));
    return formatISO(d);
  }

  function jsDowToWeekday(jsDow) {
    if (jsDow === 0 || jsDow === 6) return 1;
    return jsDow; // 1..5
  }

  function activeBuses() {
    return (setup && setup.buses || []).filter((b) => b.active !== false)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
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

  function studentName(id) {
    const st = (setup.students || []).find((s) => s.studentId === id);
    return st ? st.name : id;
  }

  function daysCheckboxesHtml(selected) {
    const set = new Set((selected || [1, 2, 3, 4, 5]).map(Number));
    return DAY_LABELS.map((d) =>
      '<label class="bus-day"><input type="checkbox" data-days="route" value="' + d.n + '"' +
      (set.has(d.n) ? ' checked' : '') + '> ' + d.ko + '</label>'
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
    const today = todayISO();
    boardWeekMonday = mondayOf(today);
    boardWeekday = jsDowToWeekday(parseISO(today).getDay());
    setupWeekday = boardWeekday;

    if ($('busSubSetup')) $('busSubSetup').addEventListener('click', () => openSetupModal());
    if ($('busSetupClose')) $('busSetupClose').addEventListener('click', closeSetupModal);
    if ($('busSetupModal')) {
      $('busSetupModal').addEventListener('click', (e) => {
        if (e.target === $('busSetupModal')) closeSetupModal();
      });
    }
    if ($('busBoardRefresh')) $('busBoardRefresh').addEventListener('click', loadBoard);
    if ($('busBoardPrevWeek')) $('busBoardPrevWeek').addEventListener('click', () => shiftBoardWeek(-7));
    if ($('busBoardNextWeek')) $('busBoardNextWeek').addEventListener('click', () => shiftBoardWeek(7));
    if ($('busBoardThisWeek')) $('busBoardThisWeek').addEventListener('click', () => {
      boardWeekMonday = mondayOf(todayISO());
      boardWeekday = jsDowToWeekday(parseISO(todayISO()).getDay());
      loadBoard();
    });

    if ($('busAddFleetBtn')) $('busAddFleetBtn').addEventListener('click', () => openFleetModal());
    if ($('busFleetCancel')) $('busFleetCancel').addEventListener('click', closeFleetModal);
    if ($('busFleetForm')) $('busFleetForm').addEventListener('submit', onSaveFleetBus);
    if ($('busFleetModal')) {
      $('busFleetModal').addEventListener('click', (e) => {
        if (e.target === $('busFleetModal')) closeFleetModal();
      });
    }

    if ($('busAddDismissSlotBtn')) $('busAddDismissSlotBtn').addEventListener('click', addDismissSlot);

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

  function openSetupModal() {
    if ($('busSetupModal')) deps.show($('busSetupModal'));
    loadSetup();
  }

  function closeSetupModal() {
    if ($('busSetupModal')) deps.hide($('busSetupModal'));
  }

  async function open() {
    if ($('busBoardPanel')) deps.show($('busBoardPanel'));
    await loadBoard();
  }

  function shiftBoardWeek(deltaDays) {
    const d = parseISO(boardWeekMonday);
    d.setDate(d.getDate() + deltaDays);
    boardWeekMonday = formatISO(d);
    loadBoard();
  }

  function renderDayTabs(mountId, activeDay, onPick) {
    const mount = $(mountId);
    if (!mount) return;
    mount.innerHTML = DAY_LABELS.map((d) =>
      '<button type="button" class="bus-day-tab' + (d.n === activeDay ? ' active' : '') +
      '" data-day="' + d.n + '">' + escapeHtml(d.ko) + '</button>'
    ).join('');
    mount.querySelectorAll('.bus-day-tab').forEach((btn) => {
      btn.addEventListener('click', () => onPick(Number(btn.dataset.day)));
    });
  }

  /* ── Fleet ─────────────────────────────────────────────── */
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

  /* ── Dismissal slots ───────────────────────────────────── */
  async function ensureRunsForBus(bus) {
    if (!bus || !bus.busId) return;
    const times = dismissalTimes();
    await api('/api/admin/bus/run', {
      method: 'POST',
      body: {
        busId: bus.busId, runType: 'pickup', label: '등교',
        startTime: PICKUP_TIME, sortOrder: 10, active: true
      }
    });
    for (let i = 0; i < times.length; i++) {
      await api('/api/admin/bus/run', {
        method: 'POST',
        body: {
          busId: bus.busId, runType: 'dismissal', label: dismissLabel(times[i], i),
          startTime: times[i], sortOrder: 50 + i * 10, active: true
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
            busId: bus.busId, runType: 'pickup', label: '등교',
            startTime: PICKUP_TIME, sortOrder: 10, active: true
          }
        });
      }
      for (let i = 0; i < times.length; i++) {
        const existing = findRun(bus.busId, 'dismissal', times[i]);
        if (!existing) {
          await api('/api/admin/bus/run', {
            method: 'POST',
            body: {
              busId: bus.busId, runType: 'dismissal', label: dismissLabel(times[i], i),
              startTime: times[i], sortOrder: 50 + i * 10, active: true
            }
          });
        } else if (existing.label !== dismissLabel(times[i], i)) {
          await api('/api/admin/bus/run', {
            method: 'POST',
            body: {
              runId: existing.runId, busId: bus.busId, runType: 'dismissal',
              label: dismissLabel(times[i], i), startTime: times[i],
              sortOrder: 50 + i * 10, active: true
            }
          });
        }
      }
    }
  }

  function renderDismissSettings() {
    const mount = $('busDismissTimes');
    if (!mount) return;
    const times = dismissalTimes();
    if (!times.length) {
      mount.innerHTML = '<p class="muted small">' +
        escapeHtml(t('admin.bus.noDismissTimes', 'No dismissal slots yet. Add 1차하교, 2차하교…')) +
        '</p>';
      return;
    }
    mount.innerHTML = times.map((tm, i) =>
      '<div class="bus-dismiss-edit-row" data-old="' + escapeHtml(tm) + '">' +
        '<span class="bus-dismiss-ord">' + escapeHtml((i + 1) + '차하교') + '</span>' +
        '<input type="time" class="bus-dismiss-time" value="' + escapeHtml(tm) + '">' +
        '<button type="button" class="btn btn-ghost bus-dismiss-save" data-i18n-ignore>Save</button>' +
        '<button type="button" class="btn btn-ghost bus-dismiss-del" title="Remove">×</button>' +
      '</div>'
    ).join('');

    mount.querySelectorAll('.bus-dismiss-edit-row').forEach((row) => {
      const oldTime = row.dataset.old;
      row.querySelector('.bus-dismiss-save').addEventListener('click', () => {
        const next = row.querySelector('.bus-dismiss-time').value;
        updateDismissTime(oldTime, next);
      });
      row.querySelector('.bus-dismiss-del').addEventListener('click', () => removeDismissTime(oldTime));
    });
  }

  async function addDismissSlot() {
    const buses = activeBuses();
    if (!buses.length) {
      window.alert(t('admin.bus.needBusFirst', 'Add a bus first.'));
      openFleetModal();
      return;
    }
    const times = dismissalTimes();
    let candidate = '15:00';
    const presets = ['14:30', '15:30', '16:00', '16:30', '17:00'];
    for (const p of presets) {
      if (!times.includes(p)) { candidate = p; break; }
    }
    while (times.includes(candidate)) {
      const [h, m] = candidate.split(':').map(Number);
      const mins = h * 60 + m + 30;
      candidate = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    }
    const idx = times.length;
    try {
      for (const bus of buses) {
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            busId: bus.busId, runType: 'dismissal', label: dismissLabel(candidate, idx),
            startTime: candidate, sortOrder: 50 + idx * 10, active: true
          }
        });
      }
      await loadSetup(false);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function updateDismissTime(oldTime, newTime) {
    newTime = String(newTime || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(newTime)) {
      window.alert(t('admin.bus.needTime', 'Select a time.'));
      return;
    }
    if (oldTime === newTime) return;
    if (dismissalTimes().includes(newTime)) {
      window.alert(t('admin.bus.timeExists', 'That dismissal time already exists.'));
      return;
    }
    const times = dismissalTimes();
    const idx = times.indexOf(oldTime);
    try {
      const runs = (setup.runs || []).filter((r) =>
        r.active !== false && r.runType === 'dismissal' && String(r.startTime).slice(0, 5) === oldTime
      );
      for (const r of runs) {
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            runId: r.runId, busId: r.busId, runType: 'dismissal',
            label: dismissLabel(newTime, Math.max(0, idx)),
            startTime: newTime, sortOrder: 50 + Math.max(0, idx) * 10, active: true
          }
        });
      }
      await loadSetup(false);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function removeDismissTime(time) {
    if (!window.confirm(t('admin.bus.confirmRemoveDismiss', 'Remove this dismissal slot from all buses?'))) return;
    try {
      const runs = (setup.runs || []).filter((r) =>
        r.active !== false && r.runType === 'dismissal' && String(r.startTime).slice(0, 5) === time
      );
      for (const r of runs) {
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            runId: r.runId, busId: r.busId, runType: 'dismissal',
            label: r.label, startTime: r.startTime, sortOrder: r.sortOrder, active: false
          }
        });
      }
      await loadSetup(false);
    } catch (e) {
      window.alert(e.message);
    }
  }

  /* ── Setup day schedule ────────────────────────────────── */
  function routeRows() {
    const times = dismissalTimes();
    return [{ key: 'pickup', label: t('admin.bus.pickupRow', '등교'), runType: 'pickup', time: PICKUP_TIME }]
      .concat(times.map((tm, i) => ({
        key: 'd-' + tm,
        label: dismissLabel(tm, i),
        runType: 'dismissal',
        time: tm
      })));
  }

  function ridersForRunOnDay(run, weekday) {
    if (!run) return [];
    return (setup.assignments || [])
      .filter((a) => a.runId === run.runId && a.active !== false && (a.days || []).includes(weekday))
      .map((a) => ({
        studentId: a.studentId,
        name: studentName(a.studentId),
        classId: ((setup.students || []).find((s) => s.studentId === a.studentId) || {}).classId || ''
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderSetupSchedule() {
    renderDayTabs('busSetupDayTabs', setupWeekday, (day) => {
      setupWeekday = day;
      renderSetupSchedule();
    });

    const mount = $('busRouteGrid');
    if (!mount || !setup) return;
    const buses = activeBuses();
    if (!buses.length) {
      mount.innerHTML =
        '<div class="bus-tt-empty-state"><p class="muted">' +
        escapeHtml(t('admin.bus.noBuses', 'No buses yet.')) +
        '</p><button type="button" class="btn btn-primary" id="busEmptyAddBus">' +
        escapeHtml(t('admin.bus.addBusBtn', '+ Add bus')) +
        '</button></div>';
      const btn = mount.querySelector('#busEmptyAddBus');
      if (btn) btn.addEventListener('click', () => openFleetModal());
      return;
    }

    const dayName = DAY_LABELS.find((d) => d.n === setupWeekday);
    let html = '<div class="bus-sched-day-title">' +
      escapeHtml((dayName && dayName.ko) || '') +
      escapeHtml(t('admin.bus.daySuffix', '요일 기본 배정')) +
      '</div>';

    routeRows().forEach((row) => {
      html += '<section class="bus-sched-block">' +
        '<h4 class="bus-sched-run">' + escapeHtml(row.label) + '</h4>' +
        '<div class="bus-sched-buses">';
      buses.forEach((bus) => {
        const run = findRun(bus.busId, row.runType, row.time);
        const riders = ridersForRunOnDay(run, setupWeekday);
        const running = riders.length > 0;
        html += '<button type="button" class="bus-sched-bus' + (running ? '' : ' bus-sched-off') + '"' +
          ' data-bus="' + escapeHtml(bus.busId) + '"' +
          ' data-type="' + escapeHtml(row.runType) + '"' +
          ' data-time="' + escapeHtml(row.time) + '">' +
          '<div class="bus-sched-bus-name"><strong>' + escapeHtml(bus.name) + '</strong></div>' +
          (running
            ? '<ul class="bus-sched-names">' + riders.map((r) =>
              '<li>' + escapeHtml(r.name) +
              (r.classId ? ' <span class="muted">(' + escapeHtml(r.classId) + ')</span>' : '') +
              '</li>'
            ).join('') + '</ul>'
            : '<div class="muted small">' + escapeHtml(t('admin.bus.notRunning', '운행 안함')) + '</div>') +
          '</button>';
      });
      html += '</div></section>';
    });

    mount.innerHTML = html;
    mount.querySelectorAll('.bus-sched-bus').forEach((btn) => {
      btn.addEventListener('click', () => openRouteCell(btn.dataset));
    });
  }

  /* ── Route edit modal ──────────────────────────────────── */
  async function openRouteCell(ds) {
    const busId = ds.bus;
    const runType = ds.type;
    const time = ds.time;
    let run = findRun(busId, runType, time);
    if (!run) {
      try {
        const times = dismissalTimes();
        const idx = times.indexOf(time);
        await api('/api/admin/bus/run', {
          method: 'POST',
          body: {
            busId, runType,
            label: runType === 'pickup' ? '등교' : dismissLabel(time, Math.max(0, idx)),
            startTime: runType === 'pickup' ? PICKUP_TIME : time,
            sortOrder: runType === 'pickup' ? 10 : (50 + Math.max(0, idx) * 10),
            active: true
          }
        });
        await loadSetup(false);
        run = findRun(busId, runType, time);
      } catch (e) {
        window.alert(e.message);
        return;
      }
    }
    editRun = run;
    const bus = activeBuses().find((b) => b.busId === busId);
    const assigns = (setup.assignments || []).filter((a) => a.runId === run.runId && a.active !== false);
    const duty = (setup.duties || []).find((d) => d.runId === run.runId && d.active !== false);
    // Prefer existing days; for a new empty cell, default to the weekday you're editing
    let days = (duty && duty.days) || (assigns[0] && assigns[0].days) || null;
    if (!days || !days.length) days = [setupWeekday];

    const title = (bus ? bus.name + ' · ' : '') +
      (runType === 'pickup'
        ? t('admin.bus.pickupRow', '등교')
        : dismissLabel(time, Math.max(0, dismissalTimes().indexOf(time))));
    if ($('busRouteModalTitle')) $('busRouteModalTitle').textContent = title;
    if ($('busRouteModalMeta')) {
      $('busRouteModalMeta').textContent = t(
        'admin.bus.cellHelp',
        'Check weekdays this student rides. Empty weekdays = bus not running that day.'
      );
    }

    const teacherOpts = '<option value="">—</option>' + (setup.teachers || [])
      .map((te) => '<option value="' + escapeHtml(te.teacherId) + '">' + escapeHtml(te.name) + '</option>')
      .join('');
    if ($('busRouteTeacherId')) {
      $('busRouteTeacherId').innerHTML = teacherOpts;
      $('busRouteTeacherId').value = duty ? duty.teacherId : '';
    }
    if ($('busRouteDays')) $('busRouteDays').innerHTML = daysCheckboxesHtml(days);

    selectedStudents = new Map();
    assigns.forEach((a) => {
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
      ' <button type="button" class="bus-chip-remove" data-id="' + escapeHtml(s.studentId) + '">×</button></span>'
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
    if (q.length < 1) { hideSearchResults(); return; }
    const hits = (setup.students || []).filter((s) => {
      const hay = (s.name + ' ' + s.classId + ' ' + s.studentId).toLowerCase();
      return hay.includes(q) && !selectedStudents.has(s.studentId);
    }).slice(0, 12);
    if (!hits.length) {
      results.innerHTML = '<div class="muted small" style="padding:0.45rem">No matches</div>';
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
        if (st) { selectedStudents.set(st.studentId, st); renderStudentChips(); }
        if ($('busStudentSearch')) $('busStudentSearch').value = '';
        hideSearchResults();
      });
    });
  }

  function hideSearchResults() {
    const results = $('busStudentSearchResults');
    if (results) { results.classList.add('hidden'); results.innerHTML = ''; }
  }

  async function saveRouteCell() {
    if (!editRun) return;
    const errEl = $('busRouteError');
    const okEl = $('busRouteOk');
    if (errEl) errEl.textContent = '';
    if (okEl) okEl.textContent = '';
    const teacherId = $('busRouteTeacherId') && $('busRouteTeacherId').value;
    const days = readDays();
    const wantIds = new Set(Array.from(selectedStudents.keys()));
    if (!wantIds.size) {
      // Clearing riders → this weekday shows 운행 안함; teacher optional
    } else if (!teacherId) {
      if (errEl) errEl.textContent = t('admin.bus.needTeacher', 'Select a duty teacher.');
      return;
    }
    try {
      if (teacherId) {
        await api('/api/admin/bus/duty', {
          method: 'POST',
          body: { runId: editRun.runId, teacherId, days, active: true }
        });
      }
      const existing = (setup.assignments || []).filter((a) => a.runId === editRun.runId && a.active !== false);
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
            studentId: sid, runId: editRun.runId, days, active: true
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

  /* ── Daily board (weekday tabs) ────────────────────────── */
  function updateWeekLabel() {
    const el = $('busBoardWeekLabel');
    if (!el) return;
    const fri = dateForWeekday(boardWeekMonday, 5);
    el.textContent = boardWeekMonday + ' ~ ' + fri;
  }

  async function loadBoard() {
    renderDayTabs('busBoardDayTabs', boardWeekday, (day) => {
      boardWeekday = day;
      loadBoard();
    });
    updateWeekLabel();
    const mount = $('busBoardBody');
    if (!mount) return;
    const dateStr = dateForWeekday(boardWeekMonday, boardWeekday);
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      if (!setup) setup = await api('/api/admin/bus/setup');
      board = await api('/api/admin/bus/board?date=' + encodeURIComponent(dateStr));
      renderBoardDay();
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function teacherOptionsHtml(selectedId) {
    const teachers = (setup && setup.teachers) || [];
    return '<option value="">' + escapeHtml(t('admin.bus.dutyDefault', 'Semester duty')) + '</option>' +
      teachers.map((te) =>
        '<option value="' + escapeHtml(te.teacherId) + '"' +
        (te.teacherId === selectedId ? ' selected' : '') + '>' +
        escapeHtml(te.name) + '</option>'
      ).join('');
  }

  function renderBoardDay() {
    const mount = $('busBoardBody');
    if (!mount || !board) return;
    const dayName = DAY_LABELS.find((d) => d.n === boardWeekday);
    const runs = board.runs || [];
    const buses = activeBuses();

    let html = '<div class="bus-sched-day-title">' +
      escapeHtml(board.dateStr || '') + ' · ' +
      escapeHtml((dayName && dayName.ko) || '') +
      escapeHtml(t('admin.bus.daySuffixShort', '요일')) +
      '</div>';

    if (board.note) {
      html += '<p class="muted small">' + escapeHtml(board.note) + '</p>';
    }

    if (!buses.length) {
      html += '<p class="muted">' + escapeHtml(t('admin.bus.noBuses', 'No buses yet.')) + '</p>';
      mount.innerHTML = html;
      return;
    }

    // Same layout as semester routes: 등교 + each 하교 slot × every bus
    const rows = routeRows();
    rows.forEach((row) => {
      html += '<section class="bus-sched-block">' +
        '<h4 class="bus-sched-run">' + escapeHtml(row.label) + '</h4>' +
        '<div class="bus-sched-buses">';
      buses.forEach((bus) => {
        const run = runs.find((r) => {
          if (r.busId !== bus.busId || r.runType !== row.runType) return false;
          if (row.runType === 'pickup') return true;
          return String(r.startTime || '').slice(0, 5) === row.time;
        });
        const riders = run ? (run.riders || []) : [];
        const running = riders.length > 0;
        const driver = (run && run.driverName) || bus.driverName || '';
        const plate = (run && run.vehiclePlate) || bus.vehiclePlate || '';
        const dutyList = (run && run.dutyTeachers) || [];
        const dutyId = dutyList[0] ? dutyList[0].teacherId : '';
        const dutyLabel = dutyList.map((d) => d.teacherName).filter(Boolean).join(', ');
        const isSub = run && run.dutySource === 'daily';

        html += '<div class="bus-sched-bus bus-sched-static' + (running ? '' : ' bus-sched-off') + '">' +
          '<div class="bus-sched-bus-name"><strong>' + escapeHtml(bus.name) + '</strong></div>' +
          '<div class="bus-sched-meta muted small">' +
            (driver
              ? escapeHtml(driver) + escapeHtml(t('admin.bus.driverHonorific', ' 기사님'))
              : escapeHtml(t('admin.bus.noDriver', '기사 미등록'))) +
            (plate ? ' · ' + escapeHtml(plate) : '') +
          '</div>' +
          (run
            ? '<label class="bus-duty-daily-label">' +
                '<span class="muted small">' +
                  escapeHtml(t('admin.bus.dutyTeacher', 'Duty')) +
                  (isSub ? ' · ' + escapeHtml(t('admin.bus.substitute', '대타')) : '') +
                '</span>' +
                '<select class="bus-duty-daily" data-run="' + escapeHtml(run.runId) + '">' +
                  teacherOptionsHtml(dutyId) +
                '</select>' +
                (dutyLabel && !dutyId
                  ? '<span class="muted small">' + escapeHtml(dutyLabel) + '</span>'
                  : '') +
              '</label>'
            : '');
        if (!running) {
          html += '<div class="muted small">' + escapeHtml(t('admin.bus.notRunning', '운행 안함')) + '</div>';
        } else {
          html += '<ul class="bus-sched-names">' + riders.map((r) => {
            const contact = [
              r.emergency && r.emergency.parentPhone,
              r.emergency && r.emergency.emergencyContact,
              r.emergency && r.emergency.emergencyPhone
            ].filter(Boolean).join(' · ');
            return '<li class="' + (r.noShow ? 'bus-noshow' : '') + '">' +
              '<div><strong>' + escapeHtml(r.name) + '</strong>' +
              (r.classId ? ' <span class="muted">(' + escapeHtml(r.classId) + ')</span>' : '') +
              (r.noShow ? ' <span class="error">No-show</span>' : '') +
              (r.source === 'override_include'
                ? ' <span class="muted small">(' + escapeHtml(t('admin.bus.overrideInclude', '당일 추가')) + ')</span>'
                : '') +
              '</div>' +
              (contact ? '<div class="muted small">' + escapeHtml(contact) + '</div>' : '') +
              '<div class="admin-toolbar" style="gap:0.35rem;margin-top:0.25rem">' +
              (row.runType === 'pickup'
                ? '<button type="button" class="btn btn-ghost bus-ns-btn" data-run="' +
                  escapeHtml(run.runId) + '" data-sid="' + escapeHtml(r.studentId) + '" data-ns="' +
                  (r.noShow ? '1' : '0') + '">' +
                  (r.noShow
                    ? escapeHtml(t('admin.bus.cancelNoShow', 'Cancel no-show'))
                    : escapeHtml(t('admin.bus.noShow', 'No-show'))) +
                  '</button>'
                : '') +
              '<button type="button" class="btn btn-ghost bus-ov-exclude" data-run="' +
                escapeHtml(run.runId) + '" data-sid="' + escapeHtml(r.studentId) + '">' +
                escapeHtml(t('admin.bus.overrideExclude', '오늘 제외')) +
              '</button></div>' +
              '</li>';
          }).join('') + '</ul>' +
          '<div class="bus-ov-include admin-toolbar" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.35rem">' +
            '<input class="bus-ov-sid" data-run="' + escapeHtml(run.runId) + '" placeholder="' +
              escapeHtml(t('admin.bus.overrideStudentId', 'Student ID')) + '" style="max-width:9rem">' +
            '<button type="button" class="btn btn-ghost bus-ov-include-btn" data-run="' +
              escapeHtml(run.runId) + '">' +
              escapeHtml(t('admin.bus.overrideIncludeBtn', '오늘 추가')) +
            '</button>' +
          '</div>';
        }
        html += '</div>';
      });
      html += '</div></section>';
    });

    if (!rows.length) {
      html += '<p class="muted">' + escapeHtml(t('admin.bus.noRoutes', 'No routes yet.')) + '</p>';
    }

    mount.innerHTML = html;
    mount.querySelectorAll('.bus-ns-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const cancel = btn.dataset.ns === '1';
          await api(cancel ? '/api/admin/bus/noshow/cancel' : '/api/admin/bus/noshow', {
            method: 'POST',
            body: { dateStr: board.dateStr, runId: btn.dataset.run, studentId: btn.dataset.sid }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
    mount.querySelectorAll('.bus-ov-exclude').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm(t('admin.bus.overrideExcludeConfirm', '오늘만 이 학생을 버스에서 제외할까요?'))) return;
        try {
          await api('/api/admin/bus/override', {
            method: 'POST',
            body: {
              dateStr: board.dateStr,
              runId: btn.dataset.run,
              studentId: btn.dataset.sid,
              action: 'exclude',
              reason: 'Admin same-day exclude'
            }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
    mount.querySelectorAll('.bus-ov-include-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const input = mount.querySelector('.bus-ov-sid[data-run="' + btn.dataset.run + '"]');
        const studentId = input && input.value.trim();
        if (!studentId) {
          window.alert(t('admin.bus.overrideNeedStudent', 'Student ID를 입력하세요.'));
          return;
        }
        try {
          await api('/api/admin/bus/override', {
            method: 'POST',
            body: {
              dateStr: board.dateStr,
              runId: btn.dataset.run,
              studentId,
              action: 'include',
              reason: 'Admin same-day include'
            }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
    mount.querySelectorAll('.bus-duty-daily').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api('/api/admin/bus/duty-daily', {
            method: 'POST',
            body: {
              dateStr: board.dateStr,
              runId: sel.dataset.run,
              teacherId: sel.value || ''
            }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
          await loadBoard();
        }
      });
    });
  }

  async function loadSetup(doEnsure) {
    try {
      setup = await api('/api/admin/bus/setup');
      if (doEnsure !== false) {
        await ensureMatrix();
        setup = await api('/api/admin/bus/setup');
      }
      renderFleetList();
      renderDismissSettings();
      renderSetupSchedule();
    } catch (e) {
      if ($('busRouteGrid')) {
        $('busRouteGrid').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }
  }

  return { init, open };
})();
