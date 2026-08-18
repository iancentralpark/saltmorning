/* Salt Morning Class — Admin School Calendar / 연간 계획표 */
window.SaltSchoolCalendar = (function() {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TYPE_LABEL = {
    holiday: 'School holiday',
    break: 'Break / 방학',
    event: 'School event',
    school_day: 'Force school day',
    kr_holiday: 'KR public holiday',
    class_day: 'Class day',
    off: 'No class'
  };

  const KR_HOLIDAY_EN = {
    '신정': "New Year's Day",
    '설날': 'Seollal (Lunar New Year)',
    '설날 연휴': 'Seollal holiday',
    '삼일절': 'Independence Movement Day',
    '어린이날': "Children's Day",
    '부처님오신날': "Buddha's Birthday",
    '석가탄신일': "Buddha's Birthday",
    '현충일': 'Memorial Day',
    '광복절': 'Liberation Day',
    '추석': 'Chuseok',
    '추석 연휴': 'Chuseok holiday',
    '개천절': 'National Foundation Day',
    '한글날': 'Hangeul Day',
    '기독탄신일': 'Christmas Day',
    '성탄절': 'Christmas Day',
    '대체공휴일': 'Substitute holiday',
    '임시공휴일': 'Temporary holiday'
  };

  let deps = {};
  let viewMode = 'month';
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let academic = null;
  let yearData = null;
  let monthData = null;

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, deps.role || 'admin'); }
  function show(el) { if (deps.show) deps.show(el); else if (el) el.classList.remove('hidden'); }
  function hide(el) { if (deps.hide) deps.hide(el); else if (el) el.classList.add('hidden'); }

  function init(options) {
    deps = options || {};
    $('scPrev').addEventListener('click', () => shift(-1));
    $('scNext').addEventListener('click', () => shift(1));
    $('scToday').addEventListener('click', () => {
      const d = new Date();
      year = d.getFullYear();
      month = d.getMonth() + 1;
      refresh();
    });
    $('scViewMonth').addEventListener('click', () => { viewMode = 'month'; refresh(); });
    $('scViewYear').addEventListener('click', () => { viewMode = 'year'; refresh(); });
    $('scPrint').addEventListener('click', () => window.print());
    $('scEntryForm').addEventListener('submit', saveEntry);
    $('scEntryCancel').addEventListener('click', resetForm);
    $('scDayType').addEventListener('change', syncBlocksDefault);
    if ($('scMultiDay')) {
      $('scMultiDay').addEventListener('change', syncMultiDayUi);
    }
    if ($('scDate')) {
      $('scDate').addEventListener('change', () => {
        if (!$('scMultiDay').checked) $('scEndDate').value = $('scDate').value;
      });
    }
    if ($('scSemestersBtn')) {
      $('scSemestersBtn').addEventListener('click', openSemesterModal);
    }
    if ($('scSemesterClose')) {
      $('scSemesterClose').addEventListener('click', closeSemesterModal);
    }
    if ($('scSemesterModal')) {
      $('scSemesterModal').addEventListener('click', (e) => {
        if (e.target === $('scSemesterModal')) closeSemesterModal();
      });
    }
    if ($('scSemesterForm')) {
      $('scSemesterForm').addEventListener('submit', addSemester);
    }
    if ($('scNewStart')) {
      $('scNewStart').addEventListener('change', () => {
        if ($('scNewLabel') && !$('scNewLabel').value.trim()) {
          $('scNewLabel').value = suggestSemesterLabel($('scNewStart').value);
        }
      });
    }
    syncBlocksDefault();
    syncMultiDayUi();
    try {
      window.addEventListener('salt:langchange', () => {
        if (viewMode === 'year' && yearData) {
          $('scMount').innerHTML = renderYear(yearData);
        }
      });
    } catch (_) { /* ignore */ }
  }

  function syncMultiDayUi() {
    const multi = $('scMultiDay') && $('scMultiDay').checked;
    const wrap = $('scEndDateWrap');
    if (wrap) {
      if (multi) show(wrap);
      else hide(wrap);
    }
    if (!multi && $('scDate') && $('scEndDate')) {
      $('scEndDate').value = $('scDate').value || '';
    }
  }

  function setMultiDay(enabled) {
    if ($('scMultiDay')) $('scMultiDay').checked = !!enabled;
    syncMultiDayUi();
  }

  /** School-wide calendar only — class filter removed from UI. */
  function classId() {
    return '*';
  }

  function setClasses() {
    /* no-op: school calendar is school-wide only */
  }

  function syncBlocksDefault() {
    const t = $('scDayType').value;
    if (t === 'event') {
      $('scBlocksAttendance').checked = false;
    } else if (t === 'school_day') {
      $('scBlocksAttendance').checked = false;
    } else {
      $('scBlocksAttendance').checked = true;
    }
  }

  function shift(delta) {
    if (viewMode === 'year') {
      year += delta;
      if (academic) {
        academic = null;
      }
      refresh();
      return;
    }
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    refresh();
  }

  async function open() {
    await loadSemesters();
    await refresh();
  }

  async function openSemesterModal() {
    await loadSemesters();
    if ($('scSemesterModal')) show($('scSemesterModal'));
  }

  function closeSemesterModal() {
    if ($('scSemesterModal')) hide($('scSemesterModal'));
  }

  function suggestSemesterLabel(startDate) {
    if (!startDate) return '';
    const year = Number(startDate.slice(0, 4));
    const month = Number(startDate.slice(5, 7));
    if (!year || !month) return '';
    const slot = (month >= 3 && month <= 8) ? 1 : 2;
    return year + ' Semester ' + slot;
  }

  async function loadSemesters() {
    const list = $('scSemesterList');
    if (!list) return;
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await api('/api/admin/school-semesters');
      const semesters = (data.semesters || []).slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      if (!semesters.length) {
        list.innerHTML = '<p class="muted small">No semesters yet — add one below.</p>';
        return;
      }
      list.innerHTML = semesters.map((s) => {
        const isActive = s.key === data.activeSemesterKey;
        const badge = s.closed
          ? '<span class="sc-semester-badge is-closed">Closed</span>'
          : (isActive ? '<span class="sc-semester-badge is-current">Current</span>' : '<span class="sc-semester-badge is-open">Open</span>');
        const action = s.closed
          ? '<button type="button" class="btn btn-ghost sc-semester-reopen" data-key="' + escapeHtml(s.key) + '">Reopen</button>'
          : '<button type="button" class="btn btn-ghost sc-semester-close-btn" data-key="' + escapeHtml(s.key) + '" data-label="' + escapeHtml(s.label) + '">Close</button>';
        return '<div class="sc-semester-item' + (isActive ? ' is-active' : '') + '">' +
          '<div class="sc-semester-item-info">' +
          '<div class="sc-semester-item-label">' + escapeHtml(s.label) + ' ' + badge + '</div>' +
          '<div class="sc-semester-item-dates">' + escapeHtml(s.startDate) + ' – ' + escapeHtml(s.endDate) + '</div>' +
          '</div>' +
          '<div class="sc-semester-item-actions">' + action + '</div>' +
          '</div>';
      }).join('');

      list.querySelectorAll('.sc-semester-close-btn').forEach((btn) => {
        btn.addEventListener('click', () => closeSemesterByKey(btn.dataset.key, btn.dataset.label));
      });
      list.querySelectorAll('.sc-semester-reopen').forEach((btn) => {
        btn.addEventListener('click', () => reopenSemesterByKey(btn.dataset.key));
      });

      if ($('scSemesterError')) $('scSemesterError').textContent = '';
    } catch (err) {
      list.innerHTML = '';
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not load semesters.';
    }
  }

  async function closeSemesterByKey(key, label) {
    if (!window.confirm('Close "' + label + '"?\n\nTeachers will no longer be able to edit grades or report cards for this semester.')) return;
    try {
      const res = await api('/api/admin/school-semesters/' + encodeURIComponent(key) + '/close', { method: 'POST' });
      await loadSemesters();
      const warn = res && res.semester && res.semester.warnings;
      if (warn && warn.inFlightReportCards && $('scSemesterMsg')) {
        $('scSemesterMsg').style.color = '#a66b42';
        $('scSemesterMsg').textContent =
          warn.inFlightReportCards + ' report card(s) for this semester are still mid-approval (not yet shared). ' +
          'They can still finish their sign-off, but no new edits are allowed.';
      }
    } catch (err) {
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not close semester.';
    }
  }

  async function reopenSemesterByKey(key) {
    if (!window.confirm('Reopen this semester for editing?')) return;
    try {
      await api('/api/admin/school-semesters/' + encodeURIComponent(key) + '/reopen', { method: 'POST' });
      await loadSemesters();
    } catch (err) {
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not reopen semester.';
    }
  }

  async function addSemester(e) {
    e.preventDefault();
    if ($('scSemesterError')) $('scSemesterError').textContent = '';
    if ($('scSemesterMsg')) $('scSemesterMsg').textContent = 'Saving…';
    try {
      await api('/api/admin/school-semesters', {
        method: 'POST',
        body: {
          label: $('scNewLabel').value.trim(),
          startDate: $('scNewStart').value,
          endDate: $('scNewEnd').value
        }
      });
      if ($('scSemesterMsg')) {
        $('scSemesterMsg').style.color = '#16a34a';
        $('scSemesterMsg').textContent = 'Semester added.';
      }
      $('scSemesterForm').reset();
      await loadSemesters();
      setTimeout(() => { if ($('scSemesterMsg')) $('scSemesterMsg').textContent = ''; }, 1500);
    } catch (err) {
      if ($('scSemesterMsg')) $('scSemesterMsg').textContent = '';
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not add semester.';
    }
  }

  async function refresh() {
    $('scViewMonth').classList.toggle('active', viewMode === 'month');
    $('scViewYear').classList.toggle('active', viewMode === 'year');
    $('scMount').innerHTML = '<p class="muted">Loading calendar…</p>';
    try {
      if (viewMode === 'year') {
        let start = '';
        let end = '';
        if (!academic) {
          const meta = await api('/api/admin/school-calendar');
          academic = meta.academicYear;
        }
        // Navigate academic years by shifting start year
        const baseStartY = Number((academic.startDate || '').slice(0, 4)) || year;
        const offset = year - baseStartY;
        if (offset !== 0 && academic.startDate && academic.endDate) {
          const sy = Number(academic.startDate.slice(0, 4)) + offset;
          const ey = Number(academic.endDate.slice(0, 4)) + offset;
          start = sy + academic.startDate.slice(4);
          end = ey + academic.endDate.slice(4);
        }
        const q = '?classId=' + encodeURIComponent(classId()) +
          (start ? '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) : '');
        yearData = await api('/api/admin/school-calendar/year' + q);
        year = Number(yearData.startDate.slice(0, 4));
        $('scLabel').textContent = 'Academic year ' + yearData.label +
          ' · ' + yearData.schoolDayCount + ' school days';
        $('scMount').innerHTML = renderYear(yearData);
        $('scEntryList').innerHTML = renderEntryList(yearData.entries || []);
      } else {
        monthData = await api(
          '/api/admin/school-calendar/month?year=' + year +
          '&month=' + month +
          '&classId=' + encodeURIComponent(classId())
        );
        $('scLabel').textContent = MONTH_NAMES[month - 1] + ' ' + year;
        $('scMount').innerHTML = renderMonth(monthData);
        $('scEntryList').innerHTML = renderEntryList(monthData.entries || []);
        bindMonthClicks();
      }
      bindEntryActions();
    } catch (e) {
      $('scMount').innerHTML = '<p class="error">' + escapeHtml(e.message || 'Failed') + '</p>';
    }
  }

  function currentLang() {
    if (window.SaltI18n && typeof SaltI18n.getLang === 'function') return SaltI18n.getLang();
    return 'en';
  }

  function localizeDayTitle(raw) {
    const title = String(raw || '').trim();
    if (!title) return '';
    if (currentLang() === 'ko') return title;
    // Prefer exact map, then translate known suffixes while keeping Korean stem mapped when possible.
    if (KR_HOLIDAY_EN[title]) return KR_HOLIDAY_EN[title];
    let out = title;
    Object.keys(KR_HOLIDAY_EN).sort((a, b) => b.length - a.length).forEach((ko) => {
      if (out.indexOf(ko) !== -1) out = out.split(ko).join(KR_HOLIDAY_EN[ko]);
    });
    return out;
  }

  function monthDisplayName(monthNum) {
    const namesEn = MONTH_NAMES;
    const namesKo = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const idx = Number(monthNum) - 1;
    return currentLang() === 'ko' ? namesKo[idx] : namesEn[idx];
  }

  function buildMonthNotes(days) {
    const items = [];
    (days || []).forEach((day) => {
      if (!day || day.outOfRange) return;
      const notable = day.dayType === 'holiday' || day.dayType === 'kr_holiday' ||
        day.dayType === 'break' || day.dayType === 'event' || day.dayType === 'school_day';
      if (!notable) return;
      let title = day.title || '';
      if (!title && day.events && day.events.length) {
        title = day.events.map((e) => e.title).filter(Boolean).join(', ');
      }
      if (!title && day.krHoliday) title = day.krHoliday;
      if (!title) return;
      items.push({
        date: day.date,
        dayNum: Number(String(day.date).slice(8, 10)),
        title: localizeDayTitle(title),
        dayType: day.dayType
      });
    });

    // Collapse consecutive same-title days into ranges (e.g. summer break).
    const collapsed = [];
    items.forEach((it) => {
      const prev = collapsed[collapsed.length - 1];
      if (
        prev &&
        prev.title === it.title &&
        prev.dayType === it.dayType &&
        Number(it.dayNum) === Number(prev.endDay) + 1
      ) {
        prev.endDay = it.dayNum;
        prev.endDate = it.date;
        return;
      }
      collapsed.push({
        startDay: it.dayNum,
        endDay: it.dayNum,
        title: it.title,
        dayType: it.dayType,
        startDate: it.date,
        endDate: it.date
      });
    });
    return collapsed;
  }

  function renderMonthNotes(days) {
    const notes = buildMonthNotes(days);
    if (!notes.length) return '';
    return '<ul class="sc-month-notes">' + notes.map((n) => {
      const label = n.startDay === n.endDay
        ? String(n.startDay)
        : (n.startDay + '–' + n.endDay);
      return '<li class="sc-month-note sc-note-' + escapeHtml(n.dayType) + '">' +
        '<span class="sc-month-note-day">' + escapeHtml(label) + '</span>' +
        '<span class="sc-month-note-title">' + escapeHtml(n.title) + '</span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function dayClass(day) {
    const parts = ['sc-day'];
    if (day.outOfRange) parts.push('sc-day-out');
    else if (!day.isClassDay) parts.push('sc-day-off');
    if (day.dayType === 'kr_holiday' || day.dayType === 'holiday') parts.push('sc-day-holiday');
    if (day.dayType === 'break') parts.push('sc-day-break');
    if (day.dayType === 'event') parts.push('sc-day-event');
    if (day.dayType === 'school_day') parts.push('sc-day-force');
    if (day.isClassDay) parts.push('sc-day-class');
    return parts.join(' ');
  }

  function dayCaption(day) {
    if (day.title) return day.title;
    if (day.events && day.events.length) return day.events.map((e) => e.title).join(', ');
    return '';
  }

  function renderMonth(data) {
    const firstDow = new Date(data.year, data.month - 1, 1).getDay();
    let html = '<div class="sc-month-grid">';
    DOW.forEach((d) => { html += '<div class="sc-dow">' + d + '</div>'; });
    for (let i = 0; i < firstDow; i++) {
      html += '<div class="sc-day sc-day-pad"></div>';
    }
    (data.days || []).forEach((day) => {
      const num = Number(day.date.slice(8, 10));
      const cap = dayCaption(day);
      html += '<button type="button" class="' + dayClass(day) + '" data-date="' + escapeHtml(day.date) + '">' +
        '<span class="sc-day-num">' + num + '</span>' +
        (cap ? '<span class="sc-day-cap">' + escapeHtml(cap) + '</span>' : '') +
        ((day.events || []).length && !day.title
          ? '<span class="sc-day-cap">' + escapeHtml(day.events.map((e) => e.title).join(', ')) + '</span>'
          : '') +
        '</button>';
    });
    html += '</div>';
    html += '<div class="sc-legend">' +
      '<span><i class="sc-swatch sc-swatch-class"></i> Class day</span>' +
      '<span><i class="sc-swatch sc-swatch-holiday"></i> Holiday</span>' +
      '<span><i class="sc-swatch sc-swatch-break"></i> Break</span>' +
      '<span><i class="sc-swatch sc-swatch-event"></i> Event</span>' +
      '<span><i class="sc-swatch sc-swatch-force"></i> Forced school day</span>' +
      '</div>';
    return html;
  }

  function renderYear(data) {
    let html = '<div class="sc-year-grid sc-print-root">';
    html += '<header class="sc-print-head"><h2>Annual School Calendar</h2>' +
      '<p>' + escapeHtml(data.label) + ' · School-wide' +
      ' · ' + data.schoolDayCount + ' school days</p></header>';
    (data.months || []).forEach((mo) => {
      html += '<section class="sc-year-month"><h3>' + monthDisplayName(mo.month) + ' ' + mo.year + '</h3>';
      html += '<div class="sc-mini-grid">';
      DOW.forEach((d) => { html += '<div class="sc-mini-dow">' + d.charAt(0) + '</div>'; });
      const firstDow = new Date(mo.year, mo.month - 1, 1).getDay();
      for (let i = 0; i < firstDow; i++) html += '<div class="sc-mini-pad"></div>';
      (mo.days || []).forEach((day) => {
        const num = Number(String(day.date).slice(8, 10));
        const title = dayCaption(day);
        html += '<div class="' + dayClass(day).replace(/\bsc-day\b/g, 'sc-mini') + '" title="' +
          escapeHtml(localizeDayTitle(title) || day.date) + '">' + num + '</div>';
      });
      html += '</div>';
      html += renderMonthNotes(mo.days || []);
      html += '</section>';
    });
    html += '</div>';
    return html;
  }

  function renderEntryList(entries) {
    if (!entries.length) return '<p class="muted small">No admin overrides in this range. KR public holidays still apply automatically.</p>';
    return '<table class="sc-entry-table"><thead><tr><th>Dates</th><th>Type</th><th>Title</th><th></th></tr></thead><tbody>' +
      entries.map((e) => {
        const range = e.date === e.endDate ? e.date : e.date + ' → ' + e.endDate;
        return '<tr>' +
          '<td>' + escapeHtml(range) + '</td>' +
          '<td>' + escapeHtml(TYPE_LABEL[e.dayType] || e.dayType) + '</td>' +
          '<td>' + escapeHtml(e.title) + (e.blocksAttendance ? ' <span class="muted">(no class)</span>' : '') + '</td>' +
          '<td><button type="button" class="btn btn-ghost" data-edit-id="' + escapeHtml(e.entryId) + '">Edit</button> ' +
          '<button type="button" class="btn btn-ghost" data-del-id="' + escapeHtml(e.entryId) + '">Remove</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function bindMonthClicks() {
    $('scMount').querySelectorAll('[data-date]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('scDate').value = btn.dataset.date;
        $('scEndDate').value = btn.dataset.date;
        setMultiDay(false);
        $('scTitle').focus();
      });
    });
  }

  function bindEntryActions() {
    $('scEntryList').querySelectorAll('[data-del-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this calendar entry?')) return;
        try {
          await api('/api/admin/school-calendar/' + encodeURIComponent(btn.dataset.delId), { method: 'DELETE' });
          refresh();
        } catch (e) {
          alert(e.message || 'Could not delete.');
        }
      });
    });
    $('scEntryList').querySelectorAll('[data-edit-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.editId;
        const pool = (viewMode === 'year' ? (yearData && yearData.entries) : (monthData && monthData.entries)) || [];
        const e = pool.find((x) => x.entryId === id);
        if (!e) return;
        $('scEntryId').value = e.entryId;
        $('scDate').value = e.date;
        $('scEndDate').value = e.endDate;
        setMultiDay(String(e.date) !== String(e.endDate));
        $('scDayType').value = e.dayType;
        $('scTitle').value = e.title;
        $('scBlocksAttendance').checked = !!e.blocksAttendance;
        $('scNotes').value = e.notes || '';
        $('scFormTitle').textContent = (window.SaltI18n
          ? SaltI18n.t('admin.schoolCal.editTitle', 'Edit calendar entry')
          : 'Edit calendar entry');
      });
    });
  }

  function resetForm() {
    $('scEntryId').value = '';
    $('scEntryForm').reset();
    setMultiDay(false);
    $('scFormTitle').textContent = (window.SaltI18n
      ? SaltI18n.t('admin.schoolCal.addTitle', 'Add to annual plan')
      : 'Add to annual plan');
    syncBlocksDefault();
  }

  async function saveEntry(e) {
    e.preventDefault();
    $('scFormError').textContent = '';
    const start = $('scDate').value;
    const multi = $('scMultiDay') && $('scMultiDay').checked;
    const end = multi ? ($('scEndDate').value || start) : start;
    if (multi && end < start) {
      $('scFormError').textContent = 'End date must be on or after the start date.';
      return;
    }
    try {
      await api('/api/admin/school-calendar', {
        method: 'POST',
        body: {
          entryId: $('scEntryId').value || undefined,
          date: start,
          endDate: end,
          dayType: $('scDayType').value,
          title: $('scTitle').value,
          blocksAttendance: $('scBlocksAttendance').checked,
          classId: '*',
          notes: $('scNotes').value
        }
      });
      resetForm();
      refresh();
    } catch (err) {
      $('scFormError').textContent = err.message || 'Could not save.';
    }
  }

  return { init, open, setClasses };
})();
