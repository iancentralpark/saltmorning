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

  let deps = {};
  let viewMode = 'month';
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let academic = null;
  let yearData = null;
  let monthData = null;

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, 'admin'); }

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
    $('scClassFilter').addEventListener('change', refresh);
    $('scEntryForm').addEventListener('submit', saveEntry);
    $('scEntryCancel').addEventListener('click', resetForm);
    $('scDayType').addEventListener('change', syncBlocksDefault);
    if ($('scSemesterForm')) {
      $('scSemesterForm').addEventListener('submit', saveSemesters);
    }
    syncBlocksDefault();
  }

  function classId() {
    return $('scClassFilter').value || '*';
  }

  function setClasses(classes) {
    const sel = $('scClassFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="*">All classes (school-wide)</option>' +
      (classes || []).map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name) + '</option>'
      ).join('');
    if (cur) sel.value = cur;
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

  async function loadSemesters() {
    if (!$('scSem1Start')) return;
    try {
      const data = await api('/api/admin/school-semesters');
      const byKey = {};
      (data.semesters || []).forEach((s) => { byKey[s.key] = s; });
      $('scSem1Start').value = (byKey.sem1 && byKey.sem1.startDate) || '';
      $('scSem1End').value = (byKey.sem1 && byKey.sem1.endDate) || '';
      $('scSem2Start').value = (byKey.sem2 && byKey.sem2.startDate) || '';
      $('scSem2End').value = (byKey.sem2 && byKey.sem2.endDate) || '';
      if ($('scSemesterError')) $('scSemesterError').textContent = '';
      if ($('scSemesterMsg')) {
        $('scSemesterMsg').textContent = data.activeSemesterKey
          ? ('Active: ' + (data.activeSemesterKey === 'sem2' ? 'Semester 2' : 'Semester 1'))
          : '';
      }
    } catch (err) {
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not load semesters.';
    }
  }

  async function saveSemesters(e) {
    e.preventDefault();
    if ($('scSemesterError')) $('scSemesterError').textContent = '';
    if ($('scSemesterMsg')) $('scSemesterMsg').textContent = 'Saving…';
    try {
      await api('/api/admin/school-semesters', {
        method: 'PUT',
        body: {
          sem1: { startDate: $('scSem1Start').value, endDate: $('scSem1End').value },
          sem2: { startDate: $('scSem2Start').value, endDate: $('scSem2End').value }
        }
      });
      if ($('scSemesterMsg')) {
        $('scSemesterMsg').style.color = '#16a34a';
        $('scSemesterMsg').textContent = 'Semesters saved.';
      }
      await loadSemesters();
    } catch (err) {
      if ($('scSemesterMsg')) $('scSemesterMsg').textContent = '';
      if ($('scSemesterError')) $('scSemesterError').textContent = err.message || 'Could not save.';
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
      '<p>' + escapeHtml(data.label) + ' · ' + escapeHtml(data.className || 'All classes') +
      ' · ' + data.schoolDayCount + ' school days</p></header>';
    (data.months || []).forEach((mo) => {
      html += '<section class="sc-year-month"><h3>' + MONTH_NAMES[mo.month - 1] + ' ' + mo.year + '</h3>';
      html += '<div class="sc-mini-grid">';
      DOW.forEach((d) => { html += '<div class="sc-mini-dow">' + d.charAt(0) + '</div>'; });
      const firstDow = new Date(mo.year, mo.month - 1, 1).getDay();
      for (let i = 0; i < firstDow; i++) html += '<div class="sc-mini-pad"></div>';
      (mo.days || []).forEach((day) => {
        const num = Number(String(day.date).slice(8, 10));
        const title = dayCaption(day);
        html += '<div class="' + dayClass(day).replace(/\bsc-day\b/g, 'sc-mini') + '" title="' +
          escapeHtml(title || day.date) + '">' + num + '</div>';
      });
      html += '</div></section>';
    });
    html += '</div>';
    return html;
  }

  function renderEntryList(entries) {
    if (!entries.length) return '<p class="muted small">No admin overrides in this range. KR public holidays still apply automatically.</p>';
    return '<table class="sc-entry-table"><thead><tr><th>Dates</th><th>Type</th><th>Title</th><th>Class</th><th></th></tr></thead><tbody>' +
      entries.map((e) => {
        const range = e.date === e.endDate ? e.date : e.date + ' → ' + e.endDate;
        return '<tr>' +
          '<td>' + escapeHtml(range) + '</td>' +
          '<td>' + escapeHtml(TYPE_LABEL[e.dayType] || e.dayType) + '</td>' +
          '<td>' + escapeHtml(e.title) + (e.blocksAttendance ? ' <span class="muted">(no class)</span>' : '') + '</td>' +
          '<td>' + escapeHtml(e.classId === '*' ? 'All' : e.classId) + '</td>' +
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
        $('scDayType').value = e.dayType;
        $('scTitle').value = e.title;
        $('scBlocksAttendance').checked = !!e.blocksAttendance;
        $('scNotes').value = e.notes || '';
        $('scEntryClass').value = e.classId || '*';
        $('scFormTitle').textContent = (window.SaltI18n
          ? SaltI18n.t('admin.schoolCal.editTitle', 'Edit calendar entry')
          : 'Edit calendar entry');
      });
    });
  }

  function resetForm() {
    $('scEntryId').value = '';
    $('scEntryForm').reset();
    $('scFormTitle').textContent = (window.SaltI18n
      ? SaltI18n.t('admin.schoolCal.addTitle', 'Add to annual plan')
      : 'Add to annual plan');
    syncBlocksDefault();
  }

  async function saveEntry(e) {
    e.preventDefault();
    $('scFormError').textContent = '';
    try {
      await api('/api/admin/school-calendar', {
        method: 'POST',
        body: {
          entryId: $('scEntryId').value || undefined,
          date: $('scDate').value,
          endDate: $('scEndDate').value || $('scDate').value,
          dayType: $('scDayType').value,
          title: $('scTitle').value,
          blocksAttendance: $('scBlocksAttendance').checked,
          classId: $('scEntryClass').value || classId() || '*',
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
