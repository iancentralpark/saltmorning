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
    box.querySelectorAll('[data-excuse-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => onExcuseToggle(btn));
    });
    box.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.addEventListener('click', () => openPlannedModal(btn.dataset.studentId, btn.dataset.studentName));
    });
    box.querySelectorAll('.att-excuse-input').forEach((inp) => {
      inp.addEventListener('blur', () => onExcuseBlur(inp));
    });
    box.querySelectorAll('.att-quiz-input').forEach((inp) => {
      inp.addEventListener('change', () => onQuizChange(inp));
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
        '<strong>' + escapeHtml(std.name) + '</strong>' +
        '<div class="att-badges">' + planned + excusedBadge + '<span class="att-save-status" data-status></span></div>' +
      '</div>' +
      '<div class="att-btn-row">' +
        ['present', 'tardy', 'absent'].map((k) =>
          '<button type="button" class="att-status-btn att-' + k + (attKey === k ? ' active' : '') + '" data-att="' + k + '">' + ATT_LABEL[k] + '</button>'
        ).join('') +
      '</div>' +
      '<div class="att-excuse-row' + (showExcuse ? '' : ' hidden') + '" data-excuse-row>' +
        '<button type="button" class="btn btn-ghost att-excuse-toggle' + (hasExcuse ? ' active' : '') + '" data-excuse-toggle>With excuse</button>' +
        '<input type="text" class="att-excuse-input' + (hasExcuse ? '' : ' hidden') + '" placeholder="Reason (doctor, family trip…)" value="' + escapeHtml(std.excuse || '') + '" maxlength="200">' +
      '</div>' +
      '<div class="att-quiz-row">' +
        '<label>Daily quiz <input type="number" class="att-quiz-input" min="0" max="100" value="' + (std.vocabScore || '') + '" placeholder="pts"></label>' +
        '<button type="button" class="btn btn-ghost" data-plan data-student-id="' + escapeHtml(key) + '" data-student-name="' + escapeHtml(std.name) + '">Plan absence</button>' +
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

  async function persistStudent(studentId, patch) {
    const cls = getClass();
    if (!cls) return;
    const card = cardEl(studentId);
    if (!card) return;

    const attendance = patch.attendance != null ? patch.attendance : card.dataset.attendance;
    const excuse = patch.excuse != null ? patch.excuse : (card.dataset.excuse || '');
    const quizInp = card.querySelector('.att-quiz-input');
    const vocabScore = patch.vocabScore != null ? patch.vocabScore : (quizInp ? quizInp.value : 0);

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
          vocabScore,
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
      const inp = card.querySelector('.att-excuse-input');
      if (inp) { inp.value = ''; inp.classList.add('hidden'); }
      card.querySelector('[data-excuse-toggle]').classList.remove('active');
    }
    persistStudent(studentId, { attendance, excuse: showExcuse ? card.dataset.excuse : '' });
  }

  function onExcuseToggle(btn) {
    const card = btn.closest('.att-student-card');
    const inp = card.querySelector('.att-excuse-input');
    btn.classList.toggle('active');
    const show = btn.classList.contains('active');
    inp.classList.toggle('hidden', !show);
    if (show) {
      inp.focus();
    } else {
      inp.value = '';
      card.dataset.excuse = '';
      persistStudent(card.dataset.studentId, { excuse: '' });
    }
  }

  function onExcuseBlur(inp) {
    const card = inp.closest('.att-student-card');
    const excuse = inp.value.trim();
    card.dataset.excuse = excuse;
    const toggle = card.querySelector('[data-excuse-toggle]');
    if (excuse) toggle.classList.add('active');
    inp.classList.toggle('hidden', !toggle.classList.contains('active'));
    persistStudent(card.dataset.studentId, { excuse });
  }

  function onQuizChange(inp) {
    const card = inp.closest('.att-student-card');
    persistStudent(card.dataset.studentId, { vocabScore: inp.value });
  }

  let plannedStudentId = '';

  function openPlannedModal(studentId, studentName) {
    plannedStudentId = studentId;
    $('plannedStudentName').textContent = studentName;
    $('plannedDate').value = $('attDate').value;
    $('plannedType').value = ATT.absent;
    $('plannedNote').value = '';
    loadPlannedList(studentId);
    deps.show($('plannedModal'));
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
    box.innerHTML = items.map((it) =>
      '<div class="planned-item">' +
        '<span>' + escapeHtml(it.dateStr) + ' · ' + (it.type === ATT.tardy ? 'Tardy' : 'Absent') +
        (it.note ? ' — ' + escapeHtml(it.note) : '') + '</span>' +
        '<button type="button" class="btn btn-ghost" data-cancel="' + escapeHtml(it.noticeId) + '">Remove</button>' +
      '</div>'
    ).join('');
    box.querySelectorAll('[data-cancel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cls2 = getClass();
        await api('/api/teacher/class/' + encodeURIComponent(cls2.classId) + '/planned-attendance/cancel', {
          method: 'POST',
          body: { noticeId: btn.dataset.cancel }
        });
        loadPlannedList(studentId);
        loadWork();
      });
    });
  }

  async function submitPlanned(e) {
    e.preventDefault();
    const cls = getClass();
    $('plannedError').textContent = '';
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/planned-attendance', {
        method: 'POST',
        body: {
          studentId: plannedStudentId,
          dateStr: $('plannedDate').value,
          type: $('plannedType').value,
          note: $('plannedNote').value
        }
      });
      deps.hide($('plannedModal'));
      loadWork();
    } catch (err) {
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

  function renderMonthlyReport(data) {
    if (!data.classes || !data.classes.length) return '<p class="muted">No data.</p>';
    const cls = data.classes[0];
    if (!cls.dates.length) return '<p class="muted">No scheduled class days this month.</p>';

    let html = '<h3>' + escapeHtml(cls.name) + ' — ' + escapeHtml(data.monthLabel) + '</h3>';
    html += '<p class="muted small">O = Present · △ = Tardy · X = Absent · (n) = quiz · * = excused (counts Present)</p>';

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
        const score = cell.vocabScore ? '<small>(' + cell.vocabScore + ')</small>' : '';
        const star = cell.excused ? '<sup>*</sup>' : '';
        html += '<td class="' + m.cls + '">' + m.sym + star + score + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<table class="report-summary"><thead><tr><th>Student</th><th>Present†</th><th>Tardy</th><th>Absent</th><th>Excused</th><th>Avg quiz</th></tr></thead><tbody>';
    cls.students.forEach((std) => {
      const s = std.summary;
      html += '<tr><td>' + escapeHtml(std.name) + '</td><td>' + s.present + '</td><td>' + s.tardy + '</td><td>' + s.absent +
        '</td><td>' + s.excused + '</td><td>' + (s.avgVocab != null ? s.avgVocab : '—') + '</td></tr>';
    });
    html += '</tbody></table><p class="muted small">† Present includes excused tardy/absent.</p>';
    return html;
  }

  return { init, onClassOpen, loadWork, ATT };
})();
