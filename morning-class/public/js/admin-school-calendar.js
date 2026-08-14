/* Salt Morning Class — Admin School Calendar / 연간 계획표 */
window.SaltSchoolCalendar = (function() {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TYPE_LABEL = {
    holiday: 'School holiday',
    break: 'Break',
    event: 'School event',
    school_day: 'Force school day',
    kr_holiday: 'KR public holiday',
    class_day: 'Class day',
    off: 'No class'
  };

  const KR_HOLIDAY_EN = {
    '신정': "New Year's Day",
    '새해 첫날': "New Year's Day",
    '새해첫날': "New Year's Day",
    '설날': 'Seollal (Lunar New Year)',
    '설날 연휴': 'Seollal holiday',
    '설날연휴': 'Seollal holiday',
    '설날 전날': 'Seollal eve',
    '설날 다음날': 'Seollal holiday',
    '삼일절': 'Independence Movement Day',
    '어린이날': "Children's Day",
    '부처님오신날': "Buddha's Birthday",
    '석가탄신일': "Buddha's Birthday",
    '현충일': 'Memorial Day',
    '제헌절': 'Constitution Day',
    '광복절': 'Liberation Day',
    '추석': 'Chuseok',
    '추석 연휴': 'Chuseok holiday',
    '추석연휴': 'Chuseok holiday',
    '추석 전날': 'Chuseok holiday',
    '추석 다음날': 'Chuseok holiday',
    '개천절': 'National Foundation Day',
    '한글날': 'Hangeul Day',
    '기독탄신일': 'Christmas Day',
    '성탄절': 'Christmas Day',
    '크리스마스': 'Christmas Day',
    '크리스마스 이브': 'Christmas Eve',
    '크리스마스이브': 'Christmas Eve',
    '성탄 전야': 'Christmas Eve',
    '성탄전야': 'Christmas Eve',
    '섣달그믐날': "New Year's Eve",
    '섣달 그믐날': "New Year's Eve",
    '섣달그믐': "New Year's Eve",
    '근로자의 날': 'Labor Day',
    '근로자의날': 'Labor Day',
    '대체공휴일': 'Substitute holiday',
    '임시공휴일': 'Temporary holiday',
    '공휴일': 'Public holiday',
    '쉬는 날': 'Public holiday',
    '쉬는날': 'Public holiday',
    '여름방학': 'Summer Break',
    '겨울방학': 'Winter Break',
    '봄방학': 'Spring Break',
    '방학': 'Break'
  };

  let deps = {};
  let viewMode = 'month';
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  let academic = null;
  let yearData = null;
  let monthData = null;
  let yearOffset = 0;
  let semesterSpan = null;

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
      if (viewMode === 'year') yearOffset = offsetForCursorDate(d);
      refresh();
    });
    $('scViewMonth').addEventListener('click', () => { viewMode = 'month'; refresh(); });
    $('scViewYear').addEventListener('click', () => {
      viewMode = 'year';
      yearOffset = offsetForCursorDate(new Date(year, month - 1, 15));
      refresh();
    });
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
    if ($('scSemesterCancel')) {
      $('scSemesterCancel').addEventListener('click', closeSemesterModal);
    }
    if ($('scSemesterModal')) {
      $('scSemesterModal').addEventListener('click', (e) => {
        if (e.target === $('scSemesterModal')) closeSemesterModal();
      });
    }
    if ($('scSemesterForm')) {
      $('scSemesterForm').addEventListener('submit', saveSemesters);
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

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function addYearsToDate(dateStr, years) {
    const s = String(dateStr || '').slice(0, 10);
    const n = Number(years) || 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (!n) return s;
    const y = Number(s.slice(0, 4)) + n;
    const mm = s.slice(5, 7);
    const dd = s.slice(8, 10);
    if (mm === '02' && dd === '29') {
      const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return y + '-02-' + (leap ? '29' : '28');
    }
    return y + '-' + mm + '-' + dd;
  }

  function setSemesterSpan(data) {
    const starts = [];
    const ends = [];
    (data && data.semesters ? data.semesters : []).forEach((s) => {
      if (s.startDate && s.endDate) {
        starts.push(s.startDate);
        ends.push(s.endDate);
      }
    });
    if (!starts.length) {
      semesterSpan = null;
      return;
    }
    starts.sort();
    ends.sort();
    semesterSpan = { startDate: starts[0], endDate: ends[ends.length - 1] };
  }

  function offsetForCursorDate(d) {
    if (!semesterSpan || !d) return 0;
    const probe = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    for (let o = -4; o <= 5; o++) {
      const s = addYearsToDate(semesterSpan.startDate, o);
      const e = addYearsToDate(semesterSpan.endDate, o);
      if (s <= probe && probe <= e) return o;
    }
    return Number(probe.slice(0, 4)) - Number(semesterSpan.startDate.slice(0, 4));
  }

  function formatShortDate(dateStr) {
    const s = String(dateStr || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const mon = MONTH_NAMES[Number(s.slice(5, 7)) - 1];
    return (mon ? mon.slice(0, 3) : s.slice(5, 7)) + ' ' + Number(s.slice(8, 10)) + ', ' + s.slice(0, 4);
  }

  function shift(delta) {
    if (viewMode === 'year') {
      yearOffset += delta;
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

  async function loadSemesters() {
    try {
      const data = await api('/api/admin/school-semesters');
      setSemesterSpan(data);
      if (!$('scSem1Start')) return;
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
        $('scSemesterMsg').style.color = '';
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
      setTimeout(closeSemesterModal, 450);
      refresh();
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
        await loadSemesters();
        let q = '?classId=' + encodeURIComponent(classId());
        if (semesterSpan) {
          const start = addYearsToDate(semesterSpan.startDate, yearOffset);
          const end = addYearsToDate(semesterSpan.endDate, yearOffset);
          q += '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
        }
        yearData = await api('/api/admin/school-calendar/year' + q);
        const rangeLabel = yearData.startDate && yearData.endDate
          ? formatShortDate(yearData.startDate) + ' – ' + formatShortDate(yearData.endDate)
          : yearData.label;
        $('scLabel').textContent = 'Academic year ' + yearData.label +
          ' · ' + rangeLabel + ' · ' + yearData.schoolDayCount + ' school days';
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

  function holidayToEnglish(raw) {
    let title = String(raw || '').trim();
    if (!title) return '';
    const hadDayOffPrefix = /쉬는\s*날/.test(title);
    title = title.replace(/쉬는\s*날/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return 'Public holiday';
    if (KR_HOLIDAY_EN[title]) return KR_HOLIDAY_EN[title];
    const keys = Object.keys(KR_HOLIDAY_EN).sort((a, b) => b.length - a.length);
    let out = title;
    keys.forEach((ko) => {
      if (out.indexOf(ko) !== -1) out = out.split(ko).join(KR_HOLIDAY_EN[ko]);
    });
    out = out.replace(/\s+/g, ' ').trim();
    out = out.replace(/^[\-–—:,;()]+/, '').replace(/[\-–—:,;()]+$/, '').trim();
    if (!out) return hadDayOffPrefix ? 'Public holiday' : '';
    return out;
  }

  function localizeDayTitle(raw) {
    const title = String(raw || '').trim();
    if (!title) return '';
    if (currentLang() === 'ko') return title;
    return holidayToEnglish(title) || title;
  }

  function defaultTypeTitle(dayType) {
    if (dayType === 'event') return 'School event';
    if (dayType === 'break') return 'Break';
    if (dayType === 'holiday') return 'School holiday';
    if (dayType === 'school_day') return 'School day';
    if (dayType === 'kr_holiday') return 'Public holiday';
    return '';
  }

  function monthDisplayName(monthNum) {
    const namesEn = MONTH_NAMES;
    const namesKo = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
    const idx = Number(monthNum) - 1;
    return currentLang() === 'ko' ? namesKo[idx] : namesEn[idx];
  }

  function collectDayNoteItems(day, localize) {
    const items = [];
    const seen = {};
    function add(title, dayType) {
      const t = localize(title) || defaultTypeTitle(dayType);
      if (!t) return;
      const key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      items.push({ title: t, dayType: dayType || 'event' });
    }
    (day.adminEntries || []).forEach((e) => {
      if (e && (e.dayType === 'event' || e.dayType === 'holiday' ||
          e.dayType === 'break' || e.dayType === 'school_day')) {
        add(e.title, e.dayType);
      }
    });
    (day.events || []).forEach((e) => {
      add((e && e.title) || 'School event', 'event');
    });
    if (day.krHoliday || day.dayType === 'kr_holiday') {
      add(day.krHoliday || day.title, 'kr_holiday');
    }
    if (day.dayType === 'holiday' || day.dayType === 'break' ||
        day.dayType === 'event' || day.dayType === 'school_day') {
      add(day.title, day.dayType);
    }
    return items;
  }

  function buildMonthNotes(days, opts) {
    const forceEn = !!(opts && opts.english);
    const localize = forceEn ? holidayToEnglish : localizeDayTitle;
    const items = [];
    (days || []).forEach((day) => {
      if (!day || day.outOfRange) return;
      const dayNum = Number(String(day.date).slice(8, 10));
      collectDayNoteItems(day, localize).forEach((note) => {
        items.push({
          date: day.date,
          dayNum: dayNum,
          title: note.title,
          dayType: note.dayType
        });
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

  function renderMonthNotes(days, opts) {
    const notes = buildMonthNotes(days, opts);
    if (!notes.length) return '<ul class="sc-month-notes sc-month-notes-empty"></ul>';
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

  function renderMiniMonth(mo) {
    let html = '<div class="sc-mini-grid">';
    DOW.forEach((d) => { html += '<div class="sc-mini-dow">' + d.charAt(0) + '</div>'; });
    const firstDow = new Date(mo.year, mo.month - 1, 1).getDay();
    for (let i = 0; i < firstDow; i++) html += '<div class="sc-mini-pad"></div>';
    (mo.days || []).forEach((day) => {
      const num = Number(String(day.date).slice(8, 10));
      const titles = collectDayNoteItems(day, holidayToEnglish).map((n) => n.title);
      const tip = titles.join(', ') || day.date;
      html += '<div class="' + dayClass(day).replace(/\bsc-day\b/g, 'sc-mini') + '" title="' +
        escapeHtml(tip) + '">' + num + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderYearMonth(mo, side) {
    const notes = renderMonthNotes(mo.days || [], { english: true });
    const cal = renderMiniMonth(mo);
    const title = MONTH_NAMES[mo.month - 1] + ' ' + mo.year;
    const inner = side === 'left' ? (notes + cal) : (cal + notes);
    return '<section class="sc-year-month sc-year-month-' + side + '">' +
      '<h3>' + title + '</h3>' +
      '<div class="sc-year-month-body">' + inner + '</div>' +
      '</section>';
  }

  function splitSchoolYearMonths(months) {
    const list = (months || []).slice();
    const mid = Math.ceil(list.length / 2) || 0;
    return { left: list.slice(0, mid), right: list.slice(mid) };
  }

  function renderYear(data) {
    const cols = splitSchoolYearMonths(data.months || []);
    const rangeText = data.startDate && data.endDate
      ? formatShortDate(data.startDate) + ' – ' + formatShortDate(data.endDate)
      : String(data.label || '');
    let html = '<div class="sc-year-grid sc-print-root">';
    html += '<header class="sc-print-head"><h2>Annual School Calendar</h2>' +
      '<p>' + escapeHtml(data.label) + ' · ' + escapeHtml(rangeText) +
      ' · School-wide · ' + data.schoolDayCount + ' school days</p></header>';
    html += '<div class="sc-year-cols">';
    html += '<div class="sc-year-col sc-year-col-left">' +
      cols.left.map((mo) => renderYearMonth(mo, 'left')).join('') + '</div>';
    html += '<div class="sc-year-col sc-year-col-right">' +
      cols.right.map((mo) => renderYearMonth(mo, 'right')).join('') + '</div>';
    html += '</div></div>';
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
