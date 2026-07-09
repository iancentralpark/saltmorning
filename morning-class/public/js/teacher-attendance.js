/* Salt Morning Class — teacher attendance (Mr. Park style, auto-save) */
window.SaltAttendance = (function() {
  const ATT = { present: '출석', tardy: '지각', absent: '결석' };
  const ATT_REV = { '출석': 'present', '지각': 'tardy', '결석': 'absent' };
  const ATT_LABEL = { present: 'Present', tardy: 'Tardy', absent: 'Absent' };
  const ATT_MAP = {
    '출석': { sym: 'O', cls: 'sym-present' },
    '지각': { sym: '△', cls: 'sym-tardy' },
    '결석': { sym: 'X', cls: 'sym-absent' }
  };

  let deps = {};
  let workData = null;
  let saving = {};

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function todayISO() { return deps.todayISO(); }

  function getClass() {
    return typeof deps.getClass === 'function' ? deps.getClass() : null;
  }

  function api(path, opts) {
    return deps.api(path, opts, 'teacher');
  }

  function init(options) {
    deps = options;
    $('attDate').addEventListener('change', loadWork);
    $('monthlyReportBtn').addEventListener('click', openMonthlyReport);
    $('monthlyReportClose').addEventListener('click', () => deps.hide($('monthlyReportModal')));
    $('plannedForm').addEventListener('submit', submitPlanned);
    $('plannedModalClose').addEventListener('click', () => deps.hide($('plannedModal')));
    $('monthlyReportRun').addEventListener('click', runMonthlyReport);
  }

  function onClassOpen() {
    $('attDate').value = todayISO();
    loadWork();
  }

  async function loadWork() {
    const cls = getClass();
    if (!cls) return;
    const date = $('attDate').value;
    $('attScheduleAlert').textContent = 'Loading…';
    $('attScheduleAlert').className = 'att-alert';
    $('attStudentList').innerHTML = '';
    try {
      workData = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/work?date=' + encodeURIComponent(date));
      renderScheduleAlert();
      renderStudentList();
    } catch (e) {
      $('attScheduleAlert').textContent = e.message || 'Could not load attendance.';
      $('attScheduleAlert').className = 'att-alert att-alert-error';
    }
  }

  function renderScheduleAlert() {
    const el = $('attScheduleAlert');
    if (!workData) return;
    if (workData.holidayName) {
      el.className = 'att-alert att-alert-error';
      el.textContent = workData.holidayName + ' — Public holiday (no class)';
      return;
    }
    if (!workData.scheduledDay) {
      el.className = 'att-alert att-alert-error';
      el.textContent = 'Not a scheduled class day for this class.';
      return;
    }
    el.className = 'att-alert att-alert-ok';
    el.textContent = 'Scheduled class day';
  }

  function renderStudentList() {
    const box = $('attStudentList');
    if (!workData || !workData.scheduledDay) {
      box.innerHTML = '<p class="muted">Select a class day to take attendance.</p>';
      return;
    }
    const students = workData.students || [];
    if (!students.length) {
      box.innerHTML = '<p class="muted">No enrolled students.</p>';
      return;
    }
    box.innerHTML = students.map(renderStudentCard).join('');
    box.querySelectorAll('[data-att]').forEach((btn) => {
      btn.addEventListener('click', () => onStatusClick(btn));
    });
    box.querySelectorAll('[data-excuse-toggle]').forEach((el) => {
      el.addEventListener('change', () => onExcuseToggle(el));
    });
    box.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.addEventListener('click', () => openPlannedModal(btn.dataset.studentId, btn.dataset.studentName));
    });
    box.querySelectorAll('.att-excuse-input').forEach((inp) => {
      inp.addEventListener('blur', () => onExcuseBlur(inp));
    });
  }

  function renderStudentCard(std) {
    const key = std.studentId;
    const att = std.attendance || ATT.present;
    const attKey = ATT_REV[att] || 'present';
    const showExcuse = att === ATT.tardy || att === ATT.absent;
    const hasExcuse = !!(std.excuse && std.excuse.trim());
    const planned = std.plannedNotice
      ? '<span class="att-badge att-badge-planned">' + (std.plannedNotice.type === ATT.tardy ? 'Tardy' : 'Absent') + ' planned</span>'
      : '';
    const excusedBadge = hasExcuse && showExcuse
      ? '<span class="att-badge att-badge-excused">Excused → counts Present</span>'
      : '';

    return '<article class="att-student-card" data-student-id="' + escapeHtml(key) + '" data-attendance="' + escapeHtml(att) + '" data-excuse="' + escapeHtml(std.excuse || '') + '">' +
      '<div class="att-student-head">' +
        '<strong class="att-student-name">' + escapeHtml(std.name) + '</strong>' +
        '<div class="att-head-right">' +
          '<div class="att-badges">' + planned + excusedBadge + '<span class="att-save-status" data-status></span></div>' +
          '<button type="button" class="btn btn-ghost att-plan-btn" data-plan data-student-id="' + escapeHtml(key) + '" data-student-name="' + escapeHtml(std.name) + '">Plan absence</button>' +
        '</div>' +
      '</div>' +
      '<div class="att-btn-row">' +
        ['present', 'tardy', 'absent'].map((k) =>
          '<button type="button" class="att-status-btn att-' + k + (attKey === k ? ' active' : '') + '" data-att="' + k + '">' + ATT_LABEL[k] + '</button>'
        ).join('') +
      '</div>' +
      '<div class="att-excuse-row' + (showExcuse ? '' : ' hidden') + '" data-excuse-row>' +
        '<label class="att-excuse-label"><input type="checkbox" class="att-excuse-toggle" data-excuse-toggle' + (hasExcuse ? ' checked' : '') + '> With excuse (counts Present)</label>' +
        '<input type="text" class="att-excuse-input" placeholder="Excuse reason (doctor, family trip…)" value="' + escapeHtml(std.excuse || '') + '" maxlength="200">' +
      '</div>' +
    '</article>';
  }

  function cardEl(studentId) {
    return document.querySelector('.att-student-card[data-student-id="' + studentId + '"]');
  }

  function setSaveStatus(studentId, text, ok) {
    const card = cardEl(studentId);
    if (!card) return;
    const el = card.querySelector('[data-status]');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'att-save-status' + (ok ? ' ok' : ok === false ? ' err' : '');
  }

  function readExcuse(card) {
    const toggle = card.querySelector('[data-excuse-toggle]');
    const inp = card.querySelector('.att-excuse-input');
    if (!toggle || !toggle.checked) return '';
    return inp ? inp.value.trim() : '';
  }

  async function persistStudent(studentId, patch) {
    const cls = getClass();
    if (!cls) return;
    const card = cardEl(studentId);
    if (!card) return;

    const attendance = patch.attendance != null ? patch.attendance : card.dataset.attendance;
    const excuse = patch.excuse != null ? patch.excuse : readExcuse(card);

    if (saving[studentId]) return;
    saving[studentId] = true;
    setSaveStatus(studentId, 'Saving…', null);

    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/attendance/record', {
        method: 'POST',
        body: {
          studentId,
          date: $('attDate').value,
          attendance,
          excuse
        }
      });
      card.dataset.attendance = attendance;
      card.dataset.excuse = excuse;
      updateExcusedBadge(card, res.countsAsPresent, excuse, attendance);
      setSaveStatus(studentId, 'Saved', true);
      setTimeout(() => setSaveStatus(studentId, '', null), 1200);
    } catch (e) {
      setSaveStatus(studentId, e.message || 'Error', false);
    } finally {
      saving[studentId] = false;
    }
  }

  function updateExcusedBadge(card, countsAsPresent, excuse, attendance) {
    const box = card.querySelector('.att-badges');
    if (!box) return;
    let badge = box.querySelector('.att-badge-excused');
    const show = countsAsPresent && (attendance === ATT.tardy || attendance === ATT.absent) && excuse;
    if (show && !badge) {
      badge = document.createElement('span');
      badge.className = 'att-badge att-badge-excused';
      badge.textContent = 'Excused → counts Present';
      box.insertBefore(badge, box.querySelector('[data-status]'));
    } else if (!show && badge) {
      badge.remove();
    }
  }

  function onStatusClick(btn) {
    const card = btn.closest('.att-student-card');
    const studentId = card.dataset.studentId;
    const key = btn.dataset.att;
    const attendance = ATT[key];
    card.dataset.attendance = attendance;
    card.querySelectorAll('.att-status-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const excuseRow = card.querySelector('[data-excuse-row]');
    const showExcuse = key === 'tardy' || key === 'absent';
    excuseRow.classList.toggle('hidden', !showExcuse);
    if (!showExcuse) {
      card.dataset.excuse = '';
      const toggle = card.querySelector('[data-excuse-toggle]');
      const inp = card.querySelector('.att-excuse-input');
      if (toggle) toggle.checked = false;
      if (inp) inp.value = '';
    }
    persistStudent(studentId, { attendance, excuse: showExcuse ? readExcuse(card) : '' });
  }

  function onExcuseToggle(btn) {
    const card = btn.closest('.att-student-card');
    const inp = card.querySelector('.att-excuse-input');
    if (btn.checked && inp) inp.focus();
    if (!btn.checked && inp) inp.value = '';
    persistStudent(card.dataset.studentId, { excuse: readExcuse(card) });
  }

  function onExcuseBlur(inp) {
    const card = inp.closest('.att-student-card');
    const toggle = card.querySelector('[data-excuse-toggle]');
    const excuse = inp.value.trim();
    if (excuse && toggle) toggle.checked = true;
    card.dataset.excuse = readExcuse(card);
    persistStudent(card.dataset.studentId, { excuse: card.dataset.excuse });
  }

  let plannedStudentId = '';

  function openPlannedModal(studentId, studentName) {
    plannedStudentId = studentId;
    $('plannedStudentName').textContent = studentName;
    const base = $('attDate').value || todayISO();
    $('plannedStartDate').value = base;
    $('plannedEndDate').value = base;
    $('plannedType').value = ATT.absent;
    $('plannedNote').value = '';
    loadPlannedList(studentId);
    deps.show($('plannedModal'));
  }

  function groupPlannedItems(items) {
    if (!items.length) return [];
    const groups = [];
    let cur = null;
    items.forEach((it) => {
      const key = it.type + '\0' + (it.note || '');
      if (
        cur &&
        cur.key === key &&
        daysApart(cur.endDate, it.dateStr) === 1
      ) {
        cur.endDate = it.dateStr;
        cur.noticeIds.push(it.noticeId);
        return;
      }
      cur = {
        key,
        type: it.type,
        note: it.note,
        startDate: it.dateStr,
        endDate: it.dateStr,
        noticeIds: [it.noticeId]
      };
      groups.push(cur);
    });
    return groups;
  }

  function daysApart(a, b) {
    const d1 = new Date(a + 'T12:00:00');
    const d2 = new Date(b + 'T12:00:00');
    return Math.round((d2 - d1) / 86400000);
  }

  function formatPlannedRange(g) {
    const typeLabel = g.type === ATT.tardy ? 'Tardy' : 'Absent';
    const range = g.startDate === g.endDate ? g.startDate : g.startDate + ' → ' + g.endDate;
    return range + ' · ' + typeLabel + (g.note ? ' — ' + g.note : '');
  }

  async function loadPlannedList(studentId) {
    const cls = getClass();
    const data = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
      '/planned-attendance?studentId=' + encodeURIComponent(studentId));
    const box = $('plannedList');
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<p class="muted">No upcoming notices.</p>';
      return;
    }
    const groups = groupPlannedItems(items);
    box.innerHTML = groups.map((g) =>
      '<div class="planned-item">' +
        '<span>' + escapeHtml(formatPlannedRange(g)) + '</span>' +
        '<button type="button" class="btn btn-ghost" data-cancel-ids="' + escapeHtml(g.noticeIds.join(',')) + '">Remove</button>' +
      '</div>'
    ).join('');
    box.querySelectorAll('[data-cancel-ids]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cls2 = getClass();
        const ids = btn.dataset.cancelIds.split(',');
        for (const noticeId of ids) {
          await api('/api/teacher/class/' + encodeURIComponent(cls2.classId) + '/planned-attendance/cancel', {
            method: 'POST',
            body: { noticeId }
          });
        }
        loadPlannedList(studentId);
        loadWork();
      });
    });
  }

  async function submitPlanned(e) {
    e.preventDefault();
    const cls = getClass();
    $('plannedError').textContent = '';
    const startDateStr = $('plannedStartDate').value;
    const endDateStr = $('plannedEndDate').value;
    if (endDateStr < startDateStr) {
      $('plannedError').textContent = 'End date must be on or after start date.';
      return;
    }
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/planned-attendance', {
        method: 'POST',
        body: {
          studentId: plannedStudentId,
          startDateStr,
          endDateStr,
          type: $('plannedType').value,
          note: $('plannedNote').value
        }
      });
      $('plannedError').textContent = '';
      $('plannedError').className = 'ok';
      $('plannedError').textContent = res.message || 'Saved.';
      loadPlannedList(plannedStudentId);
      loadWork();
    } catch (err) {
      $('plannedError').className = 'error';
      $('plannedError').textContent = err.message;
    }
  }

  function openMonthlyReport() {
    const d = new Date($('attDate').value || todayISO());
    $('reportYear').value = d.getFullYear();
    $('reportMonth').value = d.getMonth() + 1;
    $('monthlyReportBody').innerHTML = '';
    deps.show($('monthlyReportModal'));
    runMonthlyReport();
  }

  async function runMonthlyReport() {
    const cls = getClass();
    if (!cls) return;
    $('monthlyReportBody').innerHTML = '<p class="muted">Building report…</p>';
    try {
      const data = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/monthly-report?year=' + $('reportYear').value + '&month=' + $('reportMonth').value);
      $('monthlyReportBody').innerHTML = renderMonthlyReport(data);
    } catch (e) {
      $('monthlyReportBody').innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
    }
  }

  function cellTitle(cell) {
    if (!cell.excuse) return '';
    return 'Excuse: ' + cell.excuse;
  }

  function renderMonthlyReport(data) {
    if (!data.classes || !data.classes.length) return '<p class="muted">No data.</p>';
    const cls = data.classes[0];
    if (!cls.dates.length) return '<p class="muted">No scheduled class days this month.</p>';

    let html = '<h3>' + escapeHtml(cls.name) + ' — ' + escapeHtml(data.monthLabel) + '</h3>';
    html += '<p class="muted small">O = Present · △ = Tardy · X = Absent · * = excused (counts Present) · P = planned</p>';

    html += '<div class="report-scroll"><table class="report-table"><thead><tr><th>Student</th>';
    cls.dates.forEach((d) => {
      const p = d.dateStr.split('-');
      html += '<th>' + Number(p[1]) + '/' + Number(p[2]) + '<br><small>' + escapeHtml(d.dayLabel) + '</small></th>';
    });
    html += '</tr></thead><tbody>';

    cls.students.forEach((std) => {
      html += '<tr><td class="name-col">' + escapeHtml(std.name) + '</td>';
      std.cells.forEach((cell, i) => {
        const meta = cls.dates[i];
        if (meta.holiday) {
          html += '<td class="holiday-cell" title="' + escapeHtml(meta.holiday) + '">★</td>';
          return;
        }
        if (!cell.attendance) {
          html += '<td class="empty-cell">·</td>';
          return;
        }
        const m = ATT_MAP[cell.attendance] || { sym: '?', cls: '' };
        const star = cell.excused ? '<sup>*</sup>' : '';
        const plannedMark = cell.planned ? '<sub class="planned-mark">P</sub>' : '';
        const title = cellTitle(cell);
        html += '<td class="' + m.cls + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + m.sym + star + plannedMark + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<table class="report-summary"><thead><tr><th>Student</th><th>Present†</th><th>Tardy</th><th>Absent</th><th>Excused</th></tr></thead><tbody>';
    cls.students.forEach((std) => {
      const s = std.summary;
      html += '<tr><td>' + escapeHtml(std.name) + '</td><td>' + s.present + '</td><td>' + s.tardy + '</td><td>' + s.absent +
        '</td><td>' + s.excused + '</td></tr>';
    });
    html += '</tbody></table><p class="muted small">† Present includes excused tardy/absent. Hover a cell for excuse details.</p>';
    return html;
  }

  return { init, onClassOpen, loadWork, ATT };
})();
