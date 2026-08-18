/* Salt Morning Class — teacher attendance (Mr. Park style, auto-save) */
window.SaltAttendance = (function() {
  const ATT = { present: '출석', tardy: '지각', absent: '결석', earlyLeave: '조퇴' };
  const ATT_REV = { '출석': 'present', '지각': 'tardy', '결석': 'absent', '조퇴': 'earlyLeave' };
  function attLabel(key) {
    const fallback = {
      present: 'Present',
      tardy: 'Tardy',
      absent: 'Absent',
      earlyLeave: '출석+조퇴'
    };
    if (key === 'earlyLeave' && window.SaltI18n) {
      return SaltI18n.t('attendance.earlyLeave', fallback.earlyLeave);
    }
    return fallback[key] || key;
  }
  const ATT_MAP = {
    '출석': { sym: 'O', cls: 'sym-present' },
    '지각': { sym: '△', cls: 'sym-tardy' },
    '결석': { sym: 'X', cls: 'sym-absent' },
    '조퇴': { sym: '↗', cls: 'sym-early' }
  };

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  let deps = {};
  let workData = null;
  let boardExtras = {};
  let saving = {};
  let yearAtt = null;
  let yearAttMonthIdx = 0;
  let yearStudent = null;

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function todayISO() { return deps.todayISO(); }

  function getClass() {
    return typeof deps.getClass === 'function' ? deps.getClass() : null;
  }

  function isHomeroom() {
    const cls = getClass();
    return !!(cls && cls.isHomeroom);
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
    $('yearAttClose').addEventListener('click', () => deps.hide($('yearAttModal')));
    $('yearAttPrev').addEventListener('click', () => {
      if (!yearAtt || !yearAtt.months.length) return;
      yearAttMonthIdx = Math.max(0, yearAttMonthIdx - 1);
      renderYearAttMonth();
    });
    $('yearAttNext').addEventListener('click', () => {
      if (!yearAtt || !yearAtt.months.length) return;
      yearAttMonthIdx = Math.min(yearAtt.months.length - 1, yearAttMonthIdx + 1);
      renderYearAttMonth();
    });
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
    $('attStudentList').innerHTML = '<p class="muted">Loading…</p>';
    boardExtras = {};
    try {
      const q = isHomeroom() ? '?monitors=1' : '';
      const [work, extras] = await Promise.all([
        api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/work?date=' + encodeURIComponent(date)),
        api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/attendance-board' + q)
      ]);
      workData = work;
      (extras.students || []).forEach((s) => { boardExtras[s.studentId] = s; });
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
    const events = (workData.events || []).map((e) => e.title).filter(Boolean);
    const eventNote = events.length ? ' · Event: ' + events.join(', ') : '';
    if (workData.dayType === 'kr_holiday' || workData.holidayName) {
      el.className = 'att-alert att-alert-error';
      el.textContent = (workData.holidayName || workData.dayTitle || 'Public holiday') +
        ' — No class (attendance locked)' + eventNote;
      return;
    }
    if (workData.dayType === 'holiday' || workData.dayType === 'break') {
      el.className = 'att-alert att-alert-error';
      el.textContent = (workData.dayTitle || 'School holiday') +
        ' — No class (attendance locked)' + eventNote;
      return;
    }
    if (workData.dayType === 'event' && !workData.scheduledDay) {
      el.className = 'att-alert att-alert-error';
      el.textContent = (workData.dayTitle || 'School event') +
        ' — No class (attendance locked)' + eventNote;
      return;
    }
    if (!workData.scheduledDay) {
      el.className = 'att-alert att-alert-error';
      el.textContent = 'Not a scheduled class day for this class.' + eventNote;
      return;
    }
    el.className = 'att-alert att-alert-ok';
    el.textContent = (workData.dayType === 'school_day'
      ? 'School day (admin override)'
      : 'Scheduled class day') + eventNote;
  }

  function renderStudentList() {
    const box = $('attStudentList');
    if (!workData) {
      box.innerHTML = '<p class="muted">Loading…</p>';
      return;
    }
    const students = workData.students || [];
    if (!students.length) {
      box.innerHTML = '<p class="muted">No enrolled students.</p>';
      return;
    }
    if (!workData.scheduledDay) {
      box.innerHTML = '<p class="muted small" style="margin-bottom:0.75rem">Attendance is locked today. Open a student for Year-Long Attendance.</p>' +
        students.map(renderStudentCard).join('');
    } else {
      box.innerHTML = students.map(renderStudentCard).join('');
    }
    box.querySelectorAll('[data-att]').forEach((btn) => {
      btn.addEventListener('click', () => onStatusClick(btn));
    });
    box.querySelectorAll('[data-excuse-toggle]').forEach((el) => {
      el.addEventListener('change', () => onExcuseToggle(el));
    });
    box.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.addEventListener('click', () => openPlannedModal(btn.dataset.studentId, btn.dataset.studentName));
    });
    box.querySelectorAll('[data-year-att]').forEach((btn) => {
      btn.addEventListener('click', () => openYearAttendance(btn.dataset.studentId, btn.dataset.studentName));
    });
    box.querySelectorAll('.att-excuse-input').forEach((inp) => {
      inp.addEventListener('blur', () => onExcuseBlur(inp));
    });
    box.querySelectorAll('.att-dollar-save').forEach((btn) => {
      btn.addEventListener('click', () => onDollarSave(btn));
    });
    box.querySelectorAll('.att-buddy-unlock').forEach((btn) => {
      btn.addEventListener('click', () => onBuddyUnlock(btn));
    });
    box.querySelectorAll('.att-vocab-reset').forEach((btn) => {
      btn.addEventListener('click', () => onVocabReset(btn));
    });
  }

  function renderStudentCard(std) {
    const key = std.studentId;
    const editable = !!(workData && workData.scheduledDay);
    const att = std.attendance || (editable ? ATT.present : '');
    const attKey = ATT_REV[att] || (editable ? 'present' : '');
    const showExcuse = att === ATT.tardy || att === ATT.absent || att === ATT.earlyLeave;
    const hasExcuse = !!(std.excuse && std.excuse.trim());
    const planned = std.plannedNotice
      ? '<span class="att-badge att-badge-planned">' + (std.plannedNotice.type === ATT.tardy ? 'Tardy' : 'Absent') + ' planned</span>'
      : '';
    const excusedBadge = hasExcuse && showExcuse
      ? '<span class="att-badge att-badge-excused">Excused → counts Present</span>'
      : '';
    const parentNoticeBadge = (std.parentNotice && !std.plannedNotice)
      ? '<span class="att-badge att-badge-parent-notice" title="' +
        escapeHtml('Parent: ' + (std.parentNotice.noticeType || '') + (std.parentNotice.note ? ' — ' + std.parentNotice.note : '')) +
        '">👪 Parent notice</span>'
      : '';
    const extra = boardExtras[key] || { dollars: 0 };
    const hr = isHomeroom();

    let attBlock;
    if (!editable) {
      attBlock = '<div class="att-readonly"><span class="muted small">No class today — attendance locked</span></div>';
    } else if (hr) {
      attBlock =
        '<div class="att-btn-row">' +
          ['present', 'tardy', 'absent', 'earlyLeave'].map((k) =>
            '<button type="button" class="att-status-btn att-' + k + (attKey === k ? ' active' : '') + '" data-att="' + k + '">' + attLabel(k) + '</button>'
          ).join('') +
        '</div>' +
        '<div class="att-excuse-row' + (showExcuse ? '' : ' hidden') + '" data-excuse-row>' +
          '<label class="att-excuse-label"><input type="checkbox" class="att-excuse-toggle" data-excuse-toggle' + (hasExcuse ? ' checked' : '') + '> With excuse (counts Present)</label>' +
          '<input type="text" class="att-excuse-input" placeholder="Excuse reason (doctor, family trip…)" value="' + escapeHtml(std.excuse || '') + '" maxlength="200">' +
        '</div>';
    } else {
      attBlock =
        '<div class="att-readonly">' +
          '<span class="att-status-pill att-' + attKey + '">' + attLabel(attKey) + '</span>' +
          (excusedBadge || '') +
          (planned || '') +
          (parentNoticeBadge || '') +
          '<span class="muted small">Homeroom only</span>' +
        '</div>';
    }

    let tools = '<div class="att-tools">' +
      '<div class="att-dollar-compact">' +
        '<strong class="att-dollar-bal" data-dollar-bal>$' + escapeHtml(String(extra.dollars || 0)) + '</strong>' +
        '<input type="number" class="att-dollar-amt" step="1" placeholder="±" title="Amount (+earn / −spend)">' +
        '<button type="button" class="btn btn-primary att-dollar-save" data-sid="' + escapeHtml(key) + '" title="Apply dollars">$</button>' +
      '</div>';

    if (hr) {
      const buddy = extra.buddy || { used: 0, remaining: '—', locked: false, strikes: 0 };
      const vocab = extra.vocab || { placementDone: false, tier: null, streak: 0 };
      tools += '<div class="att-tool-row att-monitor-row">' +
        '<span class="att-tool-label">Buddy</span>' +
        '<span class="muted small">' +
          (buddy.locked ? 'Locked · ' : '') +
          'left ' + escapeHtml(String(buddy.remaining)) +
          (buddy.strikes ? ' · strikes ' + buddy.strikes : '') +
        '</span>' +
        (buddy.locked
          ? '<button type="button" class="btn btn-ghost att-buddy-unlock" data-sid="' + escapeHtml(key) + '">Unlock</button>'
          : '') +
      '</div>';
      tools += '<div class="att-tool-row att-monitor-row">' +
        '<span class="att-tool-label">Booster</span>' +
        '<span class="muted small">' +
          (vocab.placementDone
            ? escapeHtml(String(vocab.tier || '—')) + ' Lv' + escapeHtml(String(vocab.gradeLevel || '—')) +
              ' · streak ' + escapeHtml(String(vocab.streak || 0)) +
              (vocab.questDone ? ' · quest done' : ' · quest open')
            : 'Placement pending') +
        '</span>' +
        '<button type="button" class="btn btn-ghost att-vocab-reset" data-sid="' + escapeHtml(key) + '">Reset</button>' +
      '</div>';
    }

    tools += '</div>';

    return '<article class="att-student-card' + (hr ? '' : ' att-card-subject') + '" data-student-id="' + escapeHtml(key) + '" data-attendance="' + escapeHtml(att) + '" data-excuse="' + escapeHtml(std.excuse || '') + '">' +
      '<div class="att-student-head">' +
        '<strong class="att-student-name">' + escapeHtml(std.name) + '</strong>' +
        '<div class="att-head-right">' +
          '<div class="att-badges">' +
            (hr ? planned + excusedBadge + parentNoticeBadge : '') +
            '<span class="att-save-status" data-status></span>' +
          '</div>' +
          '<button type="button" class="btn btn-ghost att-year-btn" data-year-att data-student-id="' + escapeHtml(key) + '" data-student-name="' + escapeHtml(std.name) + '">Year attendance</button>' +
          (hr
            ? '<button type="button" class="btn btn-ghost att-plan-btn" data-plan data-student-id="' + escapeHtml(key) + '" data-student-name="' + escapeHtml(std.name) + '">Plan absence</button>'
            : '') +
        '</div>' +
      '</div>' +
      attBlock +
      tools +
    '</article>';
  }

  async function openYearAttendance(studentId, studentName) {
    const cls = getClass();
    if (!cls) return;
    yearStudent = { studentId, studentName };
    $('yearAttTitle').textContent = studentName + ' — Year-Long Attendance';
    $('yearAttMeta').innerHTML = '<p class="muted">Loading…</p>';
    $('yearAttLegend').innerHTML = '';
    $('yearAttPie').style.background = 'conic-gradient(#e5e7eb 0 100%)';
    $('yearAttCal').innerHTML = '';
    $('yearAttMonthLabel').textContent = '';
    deps.show($('yearAttModal'));
    try {
      yearAtt = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/students/' + encodeURIComponent(studentId) + '/year-attendance'
      );
      const now = new Date();
      const idx = yearAtt.months.findIndex((m) => m.year === now.getFullYear() && m.month === (now.getMonth() + 1));
      yearAttMonthIdx = idx >= 0 ? idx : 0;
      renderYearAttOverview();
      renderYearAttMonth();
    } catch (e) {
      $('yearAttMeta').innerHTML = '<p class="error">' + escapeHtml(e.message || 'Failed') + '</p>';
    }
  }

  function pieGradient(summary) {
    const parts = [
      { key: 'present', color: '#3b82f6', n: summary.present },
      { key: 'absent', color: '#f9a8d4', n: summary.absent },
      { key: 'tardy', color: '#86efac', n: summary.tardy },
      { key: 'earlyLeave', color: '#c4b5fd', n: summary.earlyLeave || 0 },
      { key: 'absentExcused', color: '#fdba74', n: summary.absentExcused },
      { key: 'tardyExcused', color: '#fde047', n: summary.tardyExcused },
      { key: 'earlyLeaveExcused', color: '#ddd6fe', n: summary.earlyLeaveExcused || 0 }
    ].filter((p) => p.n > 0);
    const total = parts.reduce((s, p) => s + p.n, 0) || 1;
    if (!parts.length) return 'conic-gradient(#e5e7eb 0 100%)';
    let acc = 0;
    const stops = parts.map((p) => {
      const start = (acc / total) * 100;
      acc += p.n;
      const end = (acc / total) * 100;
      return p.color + ' ' + start + '% ' + end + '%';
    });
    return 'conic-gradient(' + stops.join(', ') + ')';
  }

  function renderYearAttOverview() {
    if (!yearAtt) return;
    const s = yearAtt.summary;
    const pct = s.percentages || {};
    $('yearAttMeta').innerHTML =
      '<div><strong>Year</strong> ' + escapeHtml(yearAtt.yearLabel) + '</div>' +
      '<div><strong>Start</strong> ' + escapeHtml(yearAtt.startDate) + '</div>' +
      '<div><strong>End</strong> ' + escapeHtml(yearAtt.endDate) + '</div>' +
      '<div><strong>School days</strong> ' + yearAtt.schoolDays + '</div>';
    $('yearAttPie').style.background = pieGradient(s);
    $('yearAttLegend').innerHTML = [
      ['Present', s.present, pct.present, '#3b82f6'],
      ['Absent', s.absent, pct.absent, '#f9a8d4'],
      ['Tardy', s.tardy, pct.tardy, '#86efac'],
      ['Early leave', s.earlyLeave || 0, pct.earlyLeave || 0, '#c4b5fd'],
      ['Absent With Excuse', s.absentExcused, pct.absentExcused, '#fdba74'],
      ['Tardy With Excuse', s.tardyExcused, pct.tardyExcused, '#fde047'],
      ['Early leave excused', s.earlyLeaveExcused || 0, pct.earlyLeaveExcused || 0, '#ddd6fe']
    ].map((row) =>
      '<div class="ya-legend-row"><i class="ya-swatch" style="background:' + row[3] + '"></i>' +
        '<span>' + row[0] + '</span><strong>' + row[1] + ' days — ' + row[2] + '%</strong></div>'
    ).join('');
  }

  function renderYearAttMonth() {
    if (!yearAtt || !yearAtt.months.length) return;
    const mo = yearAtt.months[yearAttMonthIdx];
    $('yearAttMonthLabel').textContent = MONTH_NAMES[mo.month - 1] + ' ' + mo.year;
    const firstDow = new Date(mo.year, mo.month - 1, 1).getDay();
    let html = '<div class="ya-cal-grid">';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
      html += '<div class="ya-cal-dow">' + d + '</div>';
    });
    for (let i = 0; i < firstDow; i++) html += '<div class="ya-cal-pad"></div>';
    mo.days.forEach((day) => {
      const cls = ['ya-cal-day'];
      if (day.greyOut || day.outOfRange) cls.push('ya-cal-grey');
      if (day.category === 'present') cls.push('ya-cal-present');
      if (day.category === 'absent') cls.push('ya-cal-absent');
      if (day.category === 'tardy') cls.push('ya-cal-tardy');
      if (day.category === 'earlyLeave' || day.category === 'earlyLeaveExcused') cls.push('ya-cal-tardy');
      if (day.category === 'absentExcused') cls.push('ya-cal-absent-ex');
      if (day.category === 'tardyExcused') cls.push('ya-cal-tardy-ex');
      if (day.isClassDay && !day.status) cls.push('ya-cal-unmarked');
      const tip = [
        day.title,
        ...(day.events || []).map((e) => e.title),
        day.status ? (attLabel(ATT_REV[day.status]) || day.status) : '',
        day.excuse ? 'Excuse: ' + day.excuse : ''
      ].filter(Boolean).join(' · ');
      html += '<div class="' + cls.join(' ') + '" title="' + escapeHtml(tip || day.date) + '">' +
        '<span class="ya-cal-num">' + day.day + '</span>' +
        (day.title || (day.events && day.events[0])
          ? '<span class="ya-cal-ev">' + escapeHtml(day.title || day.events[0].title) + '</span>'
          : '') +
        '</div>';
    });
    html += '</div>';
    $('yearAttCal').innerHTML = html;
  }

  async function onDollarSave(btn) {
    const cls = getClass();
    if (!cls) return;
    const card = btn.closest('.att-student-card');
    const amt = card.querySelector('.att-dollar-amt');
    if (!amt || amt.value === '' || Number(amt.value) === 0) {
      setSaveStatus(btn.dataset.sid, 'Enter amount', false);
      return;
    }
    btn.disabled = true;
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/dollars', {
        method: 'POST',
        body: {
          studentId: btn.dataset.sid,
          amount: amt.value,
          reason: 'Teacher adjust'
        }
      });
      const bal = card.querySelector('[data-dollar-bal]');
      if (bal) bal.textContent = '$' + (res.balance != null ? res.balance : (boardExtras[btn.dataset.sid] || {}).dollars || 0);
      if (boardExtras[btn.dataset.sid]) boardExtras[btn.dataset.sid].dollars = res.balance;
      amt.value = '';
      setSaveStatus(btn.dataset.sid, 'Saved', true);
      setTimeout(() => setSaveStatus(btn.dataset.sid, '', null), 1200);
    } catch (e) {
      setSaveStatus(btn.dataset.sid, e.message || 'Error', false);
    } finally {
      btn.disabled = false;
    }
  }

  async function onBuddyUnlock(btn) {
    const cls = getClass();
    if (!cls) return;
    btn.disabled = true;
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/english-buddy/' + encodeURIComponent(btn.dataset.sid) + '/unlock', { method: 'POST' });
      await loadWork();
    } catch (e) {
      setSaveStatus(btn.dataset.sid, e.message || 'Error', false);
      btn.disabled = false;
    }
  }

  async function onVocabReset(btn) {
    const cls = getClass();
    if (!cls) return;
    if (!confirm('Reset Vocab Booster placement for this student?')) return;
    btn.disabled = true;
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/vocab/' + encodeURIComponent(btn.dataset.sid), {
        method: 'POST',
        body: { resetPlacement: true }
      });
      await loadWork();
    } catch (e) {
      setSaveStatus(btn.dataset.sid, e.message || 'Error', false);
      btn.disabled = false;
    }
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
    if (!isHomeroom()) return;
    if (!workData || !workData.scheduledDay) return;
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
    if (!isHomeroom()) return;
    if (!workData || !workData.scheduledDay) return;
    const card = btn.closest('.att-student-card');
    const studentId = card.dataset.studentId;
    const key = btn.dataset.att;
    const attendance = ATT[key];
    card.dataset.attendance = attendance;
    card.querySelectorAll('.att-status-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const excuseRow = card.querySelector('[data-excuse-row]');
    const showExcuse = key === 'tardy' || key === 'absent';
    if (excuseRow) excuseRow.classList.toggle('hidden', !showExcuse);
    if (!showExcuse) {
      card.dataset.excuse = '';
      const toggle = card.querySelector('[data-excuse-toggle]');
      const inp = card.querySelector('.att-excuse-input');
      if (toggle) toggle.checked = false;
      if (inp) inp.value = '';
    }
    // 조퇴 (출석+조퇴) always counts present; no excuse needed
    persistStudent(studentId, { attendance, excuse: showExcuse ? readExcuse(card) : '' });
  }

  function onExcuseToggle(btn) {
    if (!isHomeroom()) return;
    const card = btn.closest('.att-student-card');
    const inp = card.querySelector('.att-excuse-input');
    if (btn.checked && inp) inp.focus();
    if (!btn.checked && inp) inp.value = '';
    persistStudent(card.dataset.studentId, { excuse: readExcuse(card) });
  }

  function onExcuseBlur(inp) {
    if (!isHomeroom()) return;
    const card = inp.closest('.att-student-card');
    const toggle = card.querySelector('[data-excuse-toggle]');
    const excuse = inp.value.trim();
    if (excuse && toggle) toggle.checked = true;
    card.dataset.excuse = readExcuse(card);
    persistStudent(card.dataset.studentId, { excuse: card.dataset.excuse });
  }

  let plannedStudentId = '';

  function openPlannedModal(studentId, studentName) {
    if (!isHomeroom()) return;
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
