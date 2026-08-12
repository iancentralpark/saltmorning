/* Salt Morning Class — Admin Bus management */
window.SaltAdminBus = (function () {
  const DAY_LABELS = [
    { n: 1, label: 'Mon' },
    { n: 2, label: 'Tue' },
    { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' },
    { n: 5, label: 'Fri' }
  ];

  let deps = {};
  let setup = null;
  let board = null;
  let sub = 'board'; // board | setup

  function $(id) { return deps.$(id); }
  function api(path, opts) { return deps.api(path, opts || {}, deps.role || 'admin'); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function t(key, fallback) {
    return window.SaltI18n ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysCheckboxes(name, selected) {
    const set = new Set((selected || [1, 2, 3, 4, 5]).map(Number));
    return DAY_LABELS.map((d) =>
      '<label class="bus-day"><input type="checkbox" data-days="' + name + '" value="' + d.n + '"' +
      (set.has(d.n) ? ' checked' : '') + '> ' + d.label + '</label>'
    ).join(' ');
  }

  function readDays(container, name) {
    if (!container) return [1, 2, 3, 4, 5];
    const boxes = container.querySelectorAll('input[data-days="' + name + '"]:checked');
    const days = Array.from(boxes).map((b) => Number(b.value)).filter((n) => n >= 1 && n <= 5);
    return days.length ? days : [1, 2, 3, 4, 5];
  }

  function init(options) {
    deps = options || {};
    const dateEl = $('busBoardDate');
    if (dateEl && !dateEl.value) dateEl.value = todayISO();
    if ($('busBoardRefresh')) $('busBoardRefresh').addEventListener('click', loadBoard);
    if (dateEl) dateEl.addEventListener('change', loadBoard);
    if ($('busSubBoard')) $('busSubBoard').addEventListener('click', () => setSub('board'));
    if ($('busSubSetup')) $('busSubSetup').addEventListener('click', () => setSub('setup'));
    if ($('busSaveBusForm')) $('busSaveBusForm').addEventListener('submit', onSaveBus);
    if ($('busSaveRunForm')) $('busSaveRunForm').addEventListener('submit', onSaveRun);
    if ($('busSaveAssignForm')) $('busSaveAssignForm').addEventListener('submit', onSaveAssign);
    if ($('busSaveDutyForm')) $('busSaveDutyForm').addEventListener('submit', onSaveDuty);
    if ($('busOverrideForm')) $('busOverrideForm').addEventListener('submit', onOverride);
  }

  function setSub(name) {
    sub = name;
    if ($('busSubBoard')) $('busSubBoard').classList.toggle('active', name === 'board');
    if ($('busSubSetup')) $('busSubSetup').classList.toggle('active', name === 'setup');
    if ($('busBoardPanel')) deps[name === 'board' ? 'show' : 'hide']($('busBoardPanel'));
    if ($('busSetupPanel')) deps[name === 'setup' ? 'show' : 'hide']($('busSetupPanel'));
    if (name === 'board') loadBoard();
    if (name === 'setup') loadSetup();
  }

  async function open() {
    setSub(sub || 'board');
  }

  async function loadSetup() {
    const mount = $('busSetupBody');
    if (!mount) return;
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      setup = await api('/api/admin/bus/setup');
      renderSetup();
      fillSetupSelects();
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function fillSetupSelects() {
    if (!setup) return;
    const busOpts = (setup.buses || []).map((b) =>
      '<option value="' + escapeHtml(b.busId) + '">' + escapeHtml(b.name) + '</option>'
    ).join('');
    const runOpts = (setup.runs || []).map((r) => {
      const bus = (setup.buses || []).find((b) => b.busId === r.busId);
      const label = (bus ? bus.name + ' — ' : '') + (r.label || r.runType) + ' ' + (r.startTime || '');
      return '<option value="' + escapeHtml(r.runId) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    const studentOpts = (setup.students || []).map((s) =>
      '<option value="' + escapeHtml(s.studentId) + '">' +
      escapeHtml(s.name + (s.classId ? ' (' + s.classId + ')' : '')) + '</option>'
    ).join('');
    const teacherOpts = (setup.teachers || []).map((t) =>
      '<option value="' + escapeHtml(t.teacherId) + '">' + escapeHtml(t.name) + '</option>'
    ).join('');
    ['busRunBusId', 'busOvBusFilter'].forEach((id) => {
      if ($(id)) $(id).innerHTML = busOpts;
    });
    ['busAssignRunId', 'busDutyRunId', 'busOvRunId'].forEach((id) => {
      if ($(id)) $(id).innerHTML = runOpts;
    });
    if ($('busAssignStudentId')) $('busAssignStudentId').innerHTML = studentOpts;
    if ($('busOvStudentId')) $('busOvStudentId').innerHTML = studentOpts;
    if ($('busDutyTeacherId')) $('busDutyTeacherId').innerHTML = teacherOpts;
    if ($('busAssignDays')) $('busAssignDays').innerHTML = daysCheckboxes('assign', [1, 2, 3, 4, 5]);
    if ($('busDutyDays')) $('busDutyDays').innerHTML = daysCheckboxes('duty', [1, 2, 3, 4, 5]);
  }

  function renderSetup() {
    const mount = $('busSetupBody');
    if (!mount || !setup) return;
    const buses = setup.buses || [];
    const runs = setup.runs || [];
    const assigns = setup.assignments || [];
    const duties = setup.duties || [];
    const studentName = {};
    (setup.students || []).forEach((s) => { studentName[s.studentId] = s.name; });
    const teacherName = {};
    (setup.teachers || []).forEach((t) => { teacherName[t.teacherId] = t.name; });
    const runLabel = {};
    runs.forEach((r) => {
      const bus = buses.find((b) => b.busId === r.busId);
      runLabel[r.runId] = (bus ? bus.name + ' · ' : '') + (r.label || r.runType) + ' ' + (r.startTime || '');
    });

    mount.innerHTML =
      '<div class="bus-setup-grid">' +
        '<section><h4>' + escapeHtml(t('admin.bus.buses', 'Buses / vehicles')) + '</h4>' +
          (buses.length
            ? '<ul class="bus-list">' + buses.map((b) =>
              '<li><strong>' + escapeHtml(b.name) + '</strong>' +
              (b.active ? '' : ' <span class="muted">(inactive)</span>') +
              '<div class="muted small">' +
                escapeHtml([b.driverName, b.driverPhone, b.vehiclePlate, b.vehicleInfo].filter(Boolean).join(' · ')) +
              '</div></li>'
            ).join('') + '</ul>'
            : '<p class="muted small">No buses yet.</p>') +
        '</section>' +
        '<section><h4>' + escapeHtml(t('admin.bus.runs', 'Runs')) + '</h4>' +
          (runs.length
            ? '<ul class="bus-list">' + runs.map((r) =>
              '<li><strong>' + escapeHtml(runLabel[r.runId] || r.runId) + '</strong>' +
              ' <span class="muted small">' + escapeHtml(r.runType) + '</span>' +
              (r.active ? '' : ' <span class="muted">(inactive)</span>') +
              '</li>'
            ).join('') + '</ul>'
            : '<p class="muted small">No runs yet.</p>') +
        '</section>' +
        '<section><h4>' + escapeHtml(t('admin.bus.assignments', 'Student assignments')) + '</h4>' +
          (assigns.length
            ? '<ul class="bus-list">' + assigns.map((a) =>
              '<li>' + escapeHtml(studentName[a.studentId] || a.studentId) +
              ' → ' + escapeHtml(runLabel[a.runId] || a.runId) +
              ' <span class="muted small">[' + escapeHtml((a.days || []).join(',')) + ']</span>' +
              ' <button type="button" class="btn btn-ghost bus-del-assign" data-id="' +
              escapeHtml(a.assignmentId) + '">×</button></li>'
            ).join('') + '</ul>'
            : '<p class="muted small">No assignments yet.</p>') +
        '</section>' +
        '<section><h4>' + escapeHtml(t('admin.bus.duty', 'Duty teachers')) + '</h4>' +
          (duties.length
            ? '<ul class="bus-list">' + duties.map((d) =>
              '<li>' + escapeHtml(teacherName[d.teacherId] || d.teacherId) +
              ' → ' + escapeHtml(runLabel[d.runId] || d.runId) +
              ' <span class="muted small">[' + escapeHtml((d.days || []).join(',')) + ']</span></li>'
            ).join('') + '</ul>'
            : '<p class="muted small">No duty teachers yet.</p>') +
        '</section>' +
      '</div>';

    mount.querySelectorAll('.bus-del-assign').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Remove this assignment?')) return;
        try {
          await api('/api/admin/bus/assignment/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
          await loadSetup();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
  }

  async function onSaveBus(ev) {
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
          notes: $('busNotes').value,
          active: true
        }
      });
      ev.target.reset();
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function onSaveRun(ev) {
    ev.preventDefault();
    try {
      await api('/api/admin/bus/run', {
        method: 'POST',
        body: {
          busId: $('busRunBusId').value,
          runType: $('busRunType').value,
          label: $('busRunLabel').value,
          startTime: $('busRunTime').value,
          active: true
        }
      });
      ev.target.reset();
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function onSaveAssign(ev) {
    ev.preventDefault();
    try {
      await api('/api/admin/bus/assignment', {
        method: 'POST',
        body: {
          studentId: $('busAssignStudentId').value,
          runId: $('busAssignRunId').value,
          days: readDays($('busAssignDays'), 'assign'),
          active: true
        }
      });
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function onSaveDuty(ev) {
    ev.preventDefault();
    try {
      await api('/api/admin/bus/duty', {
        method: 'POST',
        body: {
          teacherId: $('busDutyTeacherId').value,
          runId: $('busDutyRunId').value,
          days: readDays($('busDutyDays'), 'duty'),
          active: true
        }
      });
      await loadSetup();
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function onOverride(ev) {
    ev.preventDefault();
    try {
      await api('/api/admin/bus/override', {
        method: 'POST',
        body: {
          dateStr: $('busOvDate').value || todayISO(),
          runId: $('busOvRunId').value,
          studentId: $('busOvStudentId').value,
          action: $('busOvAction').value,
          reason: $('busOvReason').value,
          source: 'admin_manual'
        }
      });
      window.alert('Override saved.');
      if (sub === 'board') loadBoard();
    } catch (e) {
      window.alert(e.message);
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
    const log = board.changeLog || [];
    mount.innerHTML =
      '<div class="bus-board-runs">' +
        runs.map((run) => {
          const duty = (run.dutyTeachers || []).map((t) => t.teacherName).join(', ') || '—';
          return '<section class="bus-run-card">' +
            '<header class="bus-run-head">' +
              '<div><strong>' + escapeHtml(run.busName) + '</strong> · ' +
              escapeHtml(run.label || run.runType) +
              ' <span class="muted">' + escapeHtml(run.startTime || '') + '</span></div>' +
              '<div class="muted small">' + escapeHtml(run.riderCount + ' riders') +
              ' · Duty: ' + escapeHtml(duty) + '</div>' +
              '<div class="muted small">' +
                escapeHtml([run.driverName, run.driverPhone, run.vehiclePlate].filter(Boolean).join(' · ')) +
              '</div>' +
            '</header>' +
            '<ul class="bus-rider-list">' +
              (run.riders || []).map((r) =>
                '<li class="' + (r.noShow ? 'bus-noshow' : '') + '">' +
                  '<span>' + escapeHtml(r.name) +
                  (r.classId ? ' <span class="muted">(' + escapeHtml(r.classId) + ')</span>' : '') +
                  (r.noShow ? ' <strong class="error">No-show</strong>' : '') +
                  '</span>' +
                  '<span class="bus-rider-actions">' +
                    '<button type="button" class="btn btn-ghost bus-ns-btn" data-run="' +
                    escapeHtml(run.runId) + '" data-sid="' + escapeHtml(r.studentId) + '">No-show</button>' +
                    '<button type="button" class="btn btn-ghost bus-ex-btn" data-run="' +
                    escapeHtml(run.runId) + '" data-sid="' + escapeHtml(r.studentId) + '">Exclude</button>' +
                  '</span>' +
                  '<div class="muted small">' +
                    escapeHtml([
                      r.emergency && r.emergency.parentPhone,
                      r.emergency && r.emergency.emergencyContact,
                      r.emergency && r.emergency.emergencyPhone
                    ].filter(Boolean).join(' · ')) +
                  '</div>' +
                '</li>'
              ).join('') || '<li class="muted">No riders</li>' +
            '</ul>' +
          '</section>';
        }).join('') || '<p class="muted">No active runs.</p>' +
      '</div>' +
      '<section class="bus-changelog">' +
        '<h4>' + escapeHtml(t('admin.bus.changeLog', 'Change log')) + '</h4>' +
        (log.length
          ? '<ul class="bus-list">' + log.map((l) =>
            '<li><span class="muted small">' + escapeHtml(l.createdAt) + '</span> ' +
            escapeHtml(l.action) + ' · ' + escapeHtml(l.studentId) +
            (l.detail ? ' — ' + escapeHtml(l.detail) : '') +
            '</li>'
          ).join('') + '</ul>'
          : '<p class="muted small">No changes today.</p>') +
      '</section>';

    mount.querySelectorAll('.bus-ns-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('/api/admin/bus/noshow', {
            method: 'POST',
            body: {
              dateStr: board.dateStr,
              runId: btn.dataset.run,
              studentId: btn.dataset.sid
            }
          });
          await loadBoard();
        } catch (e) {
          window.alert(e.message);
        }
      });
    });
    mount.querySelectorAll('.bus-ex-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reason = window.prompt('Reason for exclude (optional)') || '';
        try {
          await api('/api/admin/bus/override', {
            method: 'POST',
            body: {
              dateStr: board.dateStr,
              runId: btn.dataset.run,
              studentId: btn.dataset.sid,
              action: 'exclude',
              reason,
              source: 'admin_board'
            }
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
