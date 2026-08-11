/* Salt Morning Class — Parent portal */
window.SaltParent = (function() {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  let deps = {};
  let overview = null;
  let yearAtt = null;
  let yearAttMonthIdx = 0;
  let currentTab = '';
  let badgeSources = {
    feed: [],
    announcements: [],
    homework: [],
    reportcards: []
  };

  const TAB_TITLE_KEYS = {
    feed: 'nav.feed',
    announcements: 'nav.parentAnnouncements',
    attendance: 'nav.attendance',
    timetable: 'nav.timetable',
    homework: 'nav.homework',
    reportcards: 'nav.parentReports',
    profile: 'nav.profile'
  };

  const BADGE_TABS = ['feed', 'announcements', 'homework', 'reportcards'];
  const SEEN_KEY = 'salt_pp_seen_v1';

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, 'parent'); }
  function t(key, fallback) {
    return window.SaltI18n ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function readSeen() {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeSeen(map) {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(map || {})); } catch (_) { /* ignore */ }
  }

  function unseenCount(tab) {
    const items = badgeSources[tab] || [];
    const seen = readSeen()[tab] || {};
    const ids = new Set((seen.ids || []).map(String));
    return items.filter((it) => it && it.id && !ids.has(String(it.id))).length;
  }

  function markTabSeen(tab) {
    if (!BADGE_TABS.includes(tab)) return;
    const items = badgeSources[tab] || [];
    const map = readSeen();
    map[tab] = {
      ids: items.map((it) => String(it.id || '')).filter(Boolean),
      at: Date.now()
    };
    writeSeen(map);
    renderBadges();
  }

  function renderBadges() {
    BADGE_TABS.forEach((tab) => {
      const el = document.querySelector('#parentNav [data-badge="' + tab + '"]');
      if (!el) return;
      const n = unseenCount(tab);
      if (n > 0) {
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.remove('hidden');
      } else {
        el.textContent = '0';
        el.classList.add('hidden');
      }
    });
  }

  function init(options) {
    deps = options || {};
    document.querySelectorAll('#parentNav .class-subnav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    window.addEventListener('hashchange', applyRoute);
    window.addEventListener('salt:langchange', () => {
      if (overview) renderHeader(overview);
      if (window.SaltI18n) SaltI18n.apply(document.getElementById('appView'));
    });
    $('ppProfileForm').addEventListener('submit', saveProfile);
    const childSel = $('ppChildSwitcher');
    if (childSel) {
      childSel.addEventListener('change', () => switchActiveChild(childSel.value));
    }
    $('yearAttPrev').addEventListener('click', () => {
      if (!yearAtt) return;
      yearAttMonthIdx = Math.max(0, yearAttMonthIdx - 1);
      renderAttMonth();
    });
    $('yearAttNext').addEventListener('click', () => {
      if (!yearAtt) return;
      yearAttMonthIdx = Math.min(yearAtt.months.length - 1, yearAttMonthIdx + 1);
      renderAttMonth();
    });
  }

  async function switchActiveChild(studentId) {
    studentId = String(studentId || '').trim();
    if (!studentId) return;
    const activeId = overview && overview.student && overview.student.studentId;
    if (studentId === activeId) return;
    try {
      const result = await api('/api/parent/active-child', {
        method: 'POST',
        body: { studentId }
      });
      if (result.token && window.SaltApp) {
        SaltApp.setToken('parent', result.token);
        SaltApp.setProfile('parent', result.profile || null);
      }
      // Reset seen badges for the new child context
      writeSeen({});
      currentTab = '';
      await boot();
      if (window.SaltMessenger && typeof SaltMessenger.refresh === 'function') {
        try { await SaltMessenger.refresh(); } catch (_) { /* optional */ }
      }
    } catch (e) {
      window.alert(e.message || 'Could not switch child.');
      renderHeader(overview || {});
    }
  }

  function setRoute(tab, replace) {
    const hash = '#/' + encodeURIComponent(tab || 'feed');
    if (replace) history.replaceState(null, '', hash);
    else if (location.hash !== hash) location.hash = hash;
  }

  function applyRoute() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    const tab = decodeURIComponent(raw.split('/')[0] || 'feed');
    const next = TAB_TITLE_KEYS[tab] ? tab : 'feed';
    if (currentTab === next) return;
    switchTab(next, { skipHash: true });
  }

  function switchTab(name, opts) {
    opts = opts || {};
    if (!TAB_TITLE_KEYS[name]) name = 'feed';
    if (!opts.skipHash) setRoute(name, !!opts.replace);
    if (currentTab === name && !opts.force) return;
    currentTab = name;
    document.querySelectorAll('#parentNav .class-subnav-item').forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.tab === name));
    ['feed', 'announcements', 'attendance', 'timetable', 'homework', 'reportcards', 'profile'].forEach((k) => {
      const el = $('tab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) deps.hide(el);
    });
    const map = {
      feed: 'tabFeed',
      announcements: 'tabAnnouncements',
      attendance: 'tabAttendance',
      timetable: 'tabTimetable',
      homework: 'tabHomework',
      reportcards: 'tabReportcards',
      profile: 'tabProfile'
    };
    deps.show($(map[name]));
    markTabSeen(name);
    if (name === 'announcements') loadAnnouncements();
    if (name === 'attendance') loadAttendance();
    if (name === 'timetable') loadTimetable();
    if (name === 'homework') loadHomework();
    if (name === 'reportcards') loadReportCards();
    if (name === 'profile') loadProfile();
    if (window.SaltI18n) SaltI18n.apply(document.getElementById('appView'));
  }

  async function loadAnnouncements() {
    const mount = $('ppAnnList');
    if (!mount) return;
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/parent/announcements');
      if (window.SaltAnnouncements) {
        SaltAnnouncements.renderGroupedList(mount, data.announcements || [], {
          emptyText: 'No announcements yet.'
        });
      } else {
        mount.innerHTML = '<p class="muted">Could not load announcement UI.</p>';
      }
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function boot() {
    const data = await api('/api/parent/overview');
    overview = data;
    badgeSources = Object.assign({
      feed: [], announcements: [], homework: [], reportcards: []
    }, data.badgeSources || {});
    renderHeader(data);
    renderFeed(data.newsfeed || []);
    if (window.SaltMessenger && SaltMessenger.setQuickContacts) {
      SaltMessenger.setQuickContacts(data.teachers || []);
    }
    renderBadges();
    if (!location.hash || location.hash === '#') {
      switchTab('feed', { replace: true });
    } else {
      applyRoute();
    }
    if (window.SaltI18n) SaltI18n.apply(document.getElementById('appView'));
  }

  function renderHeader(data) {
    const s = data.student || {};
    const children = Array.isArray(data.children) ? data.children : [];
    const name = s.name || t('parent.brand', 'Parent');
    const sub = [s.className || s.classId || '', s.gradeLevel || '']
      .filter(Boolean)
      .join(' · ');
    if ($('ppHeaderName')) $('ppHeaderName').textContent = name;
    if ($('ppHeaderSub')) $('ppHeaderSub').textContent = sub;

    const wrap = $('ppChildSwitcherWrap');
    const sel = $('ppChildSwitcher');
    if (wrap && sel) {
      if (children.length > 1) {
        wrap.classList.remove('hidden');
        const cur = s.studentId || '';
        sel.innerHTML = children.map((c) =>
          '<option value="' + escapeHtml(c.studentId) + '"' +
          (c.studentId === cur || c.active ? ' selected' : '') + '>' +
          escapeHtml(c.name || c.studentId) +
          '</option>'
        ).join('');
        sel.value = cur || (children[0] && children[0].studentId) || '';
      } else {
        wrap.classList.add('hidden');
        sel.innerHTML = '';
      }
    }

    const img = $('ppHeaderPhotoImg');
    const fallback = $('ppHeaderPhotoFallback');
    if (!img || !fallback) return;
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    fallback.textContent = initial;
    if (s.photoPath) {
      img.src = s.photoPath + (s.photoPath.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
      img.alt = name;
      img.classList.remove('hidden');
      fallback.classList.add('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      fallback.classList.remove('hidden');
    }
  }

  function renderFeed(items) {
    const box = $('ppFeed');
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<p class="muted">No updates yet. Grades and teacher comments will appear here.</p>';
      return;
    }
    const typeLabel = {
      announcement: 'Announcement',
      grade: 'Grade',
      comment: "Teacher's comment",
      homework: 'Homework',
      report: 'Report card',
      attendance: 'Attendance'
    };
    box.innerHTML = items.map((it) => {
      let extra = '';
      if (it.type === 'announcement' && it.meta) {
        if (it.meta.imagePath) {
          extra += '<a href="' + escapeHtml(it.meta.imagePath) + '" target="_blank" rel="noopener">' +
            '<img class="ann-image" src="' + escapeHtml(it.meta.imagePath) + '" alt=""></a>';
        }
        if (it.meta.linkUrl) {
          extra += '<p class="ann-link"><a href="' + escapeHtml(it.meta.linkUrl) + '" target="_blank" rel="noopener">' +
            escapeHtml(it.meta.linkLabel || it.meta.linkUrl) + '</a></p>';
        }
        if (it.meta.attachmentPath) {
          extra += '<p class="ann-attach"><a href="' + escapeHtml(it.meta.attachmentPath) + '" target="_blank" rel="noopener">' +
            '📎 ' + escapeHtml(it.meta.attachmentName || 'Attachment') + '</a></p>';
        }
      }
      return '<article class="pp-feed-item pp-feed-' + escapeHtml(it.type) + '">' +
        '<div class="pp-feed-type">' + escapeHtml(typeLabel[it.type] || it.type) +
          (it.meta && it.meta.source ? ' · ' + escapeHtml(it.meta.source) : '') +
        '</div>' +
        '<h3>' + escapeHtml(it.title || '') + '</h3>' +
        '<p>' + escapeHtml(it.body || '') + '</p>' +
        extra +
        '<div class="pp-feed-meta muted small">' +
          escapeHtml(String(it.at || '').slice(0, 16).replace('T', ' ')) +
          (it.meta && it.meta.subject ? ' · ' + escapeHtml(it.meta.subject) : '') +
          (it.meta && it.meta.letterGrade ? ' · ' + escapeHtml(it.meta.letterGrade) : '') +
        '</div>' +
      '</article>';
    }).join('');
  }

  async function loadAttendance() {
    $('ppAttMeta').innerHTML = '<p class="muted">Loading…</p>';
    try {
      yearAtt = await api('/api/parent/attendance');
      const s = yearAtt.summary || {};
      const pct = s.percentages || {};
      $('ppAttMeta').innerHTML =
        '<div><strong>Year</strong> ' + escapeHtml(yearAtt.yearLabel) + '</div>' +
        '<div><strong>School days</strong> ' + yearAtt.schoolDays + '</div>' +
        '<div><strong>Present</strong> ' + (s.present || 0) + ' (' + (pct.present || 0) + '%)</div>' +
        '<div><strong>Absent</strong> ' + (s.absent || 0) + '</div>' +
        '<div><strong>Tardy</strong> ' + (s.tardy || 0) + '</div>';
      $('ppAttPie').style.background = pieGradient(s);
      const now = new Date();
      const idx = (yearAtt.months || []).findIndex((m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1);
      yearAttMonthIdx = idx >= 0 ? idx : 0;
      renderAttMonth();
    } catch (e) {
      $('ppAttMeta').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function pieGradient(summary) {
    const parts = [
      { color: '#3b82f6', n: summary.present || 0 },
      { color: '#f9a8d4', n: summary.absent || 0 },
      { color: '#86efac', n: summary.tardy || 0 },
      { color: '#fdba74', n: summary.absentExcused || 0 },
      { color: '#fde047', n: summary.tardyExcused || 0 }
    ].filter((p) => p.n > 0);
    const total = parts.reduce((s, p) => s + p.n, 0) || 1;
    if (!parts.length) return 'conic-gradient(#e5e7eb 0 100%)';
    let acc = 0;
    return 'conic-gradient(' + parts.map((p) => {
      const start = (acc / total) * 100;
      acc += p.n;
      return p.color + ' ' + start + '% ' + ((acc / total) * 100) + '%';
    }).join(', ') + ')';
  }

  function renderAttMonth() {
    if (!yearAtt || !yearAtt.months.length) return;
    const mo = yearAtt.months[yearAttMonthIdx];
    $('ppAttMonthLabel').textContent = MONTH_NAMES[mo.month - 1] + ' ' + mo.year;
    const firstDow = new Date(mo.year, mo.month - 1, 1).getDay();
    let html = '<div class="ya-cal-grid">';
    DAY_NAMES.forEach((d) => { html += '<div class="ya-cal-dow">' + d + '</div>'; });
    for (let i = 0; i < firstDow; i++) html += '<div class="ya-cal-pad"></div>';
    mo.days.forEach((day) => {
      const cls = ['ya-cal-day'];
      if (day.greyOut || day.outOfRange) cls.push('ya-cal-grey');
      if (day.category === 'present') cls.push('ya-cal-present');
      if (day.category === 'absent') cls.push('ya-cal-absent');
      if (day.category === 'tardy') cls.push('ya-cal-tardy');
      if (day.category === 'absentExcused') cls.push('ya-cal-absent-ex');
      if (day.category === 'tardyExcused') cls.push('ya-cal-tardy-ex');
      const tip = [day.title].concat((day.events || []).map((e) => e.title)).filter(Boolean).join(' · ');
      html += '<div class="' + cls.join(' ') + '" title="' + escapeHtml(tip || day.date) + '">' +
        '<span class="ya-cal-num">' + day.day + '</span></div>';
    });
    html += '</div>';
    $('ppAttCal').innerHTML = html;
  }

  async function loadTimetable() {
    $('ppTimetable').innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await api('/api/parent/timetable');
      const byDay = data.byDay || {};
      let html = '<div class="pp-tt-grid">';
      for (let d = 1; d <= 5; d++) {
        const slots = byDay[String(d)] || byDay[d] || [];
        html += '<section class="pp-tt-day"><h4>' + DAY_NAMES[d] + '</h4>';
        if (!slots.length) html += '<p class="muted small">No classes</p>';
        else {
          html += slots.map((s) => {
            const color = (window.SaltSubjectColors && SaltSubjectColors.forSubject)
              ? SaltSubjectColors.forSubject(s.subject || '', {
                isBreak: !!s.isBreak,
                classId: s.classId || (overview && overview.student && overview.student.classId) || ''
              })
              : { bg: '#eef3ea', border: '#a3b18a' };
            return '<div class="pp-tt-slot pp-tt-slot-colored" style="background:' + color.bg +
              ';border-left-color:' + color.border + ';">' +
              '<strong>' + escapeHtml(s.subject || '') + '</strong>' +
              '<span>' + escapeHtml((s.startTime || '') + '–' + (s.endTime || '')) + '</span>' +
              '<span class="muted">' + escapeHtml(s.teacherName || s.room || '') + '</span>' +
            '</div>';
          }).join('');
        }
        html += '</section>';
      }
      html += '</div>';
      $('ppTimetable').innerHTML = html;
    } catch (e) {
      $('ppTimetable').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function loadHomework() {
    $('ppHomework').innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await api('/api/parent/homework');
      const pending = data.pending || [];
      const completed = data.completed || [];
      let html = '<h4>Pending</h4>';
      if (!pending.length) html += '<p class="muted">No pending homework.</p>';
      else {
        html += pending.map((h) =>
          '<div class="pp-hw-item">' +
            '<strong>' + escapeHtml(h.title) + '</strong>' +
            '<div class="muted small">Assigned ' + escapeHtml(h.assignedDate || '') +
              (h.dueDate ? ' · Due ' + escapeHtml(h.dueDate) : '') + '</div>' +
            '<p>' + escapeHtml(h.description || '') + '</p>' +
          '</div>'
        ).join('');
      }
      html += '<h4 style="margin-top:1rem">Recently completed</h4>';
      if (!completed.length) html += '<p class="muted">None yet.</p>';
      else {
        html += completed.slice(0, 10).map((h) =>
          '<div class="pp-hw-item done">' +
            '<strong>' + escapeHtml(h.title) + '</strong>' +
            '<div class="muted small">Done ' + escapeHtml(String(h.completedAt || '').slice(0, 10)) + '</div>' +
          '</div>'
        ).join('');
      }
      $('ppHomework').innerHTML = html;
    } catch (e) {
      $('ppHomework').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderParentCard(card) {
    let html = '<div class="rc-full-toolbar no-print">' +
      '<button type="button" class="btn btn-primary" id="parentPrintBtn">Print</button></div>';
    if (window.SaltReportCardPrint && SaltReportCardPrint.renderPrintableCard) {
      html += SaltReportCardPrint.renderPrintableCard(card);
    } else {
      html += '<p class="error">Could not render report card.</p>';
    }
    return html;
  }

  async function loadReportCards() {
    const list = $('parentReportList');
    const body = $('parentReportBody');
    const err = $('parentReportError');
    err.textContent = '';
    list.innerHTML = '<p class="muted">Loading…</p>';
    body.innerHTML = '';
    try {
      const data = await api('/api/parent/report-cards');
      const reports = data.reports || [];
      if (!reports.length) {
        list.innerHTML = '<p class="muted">' + escapeHtml(data.message || 'No report card has been shared yet.') + '</p>';
        return;
      }
      list.innerHTML = reports.map((r, idx) =>
        '<button type="button" class="btn btn-primary parent-rc-open" data-idx="' + idx + '">' +
        'View ' + escapeHtml(r.term) + ' — ' + escapeHtml(r.student.name) + '</button>'
      ).join('');
      list.querySelectorAll('.parent-rc-open').forEach((btn) => {
        btn.addEventListener('click', () => {
          body.innerHTML = renderParentCard(reports[Number(btn.dataset.idx)]);
          const printBtn = $('parentPrintBtn');
          if (printBtn) printBtn.addEventListener('click', () => window.print());
        });
      });
      list.querySelector('.parent-rc-open').click();
    } catch (e) {
      list.innerHTML = '';
      err.textContent = e.message;
    }
  }

  async function loadProfile() {
    $('ppProfileError').textContent = '';
    try {
      const data = await api('/api/parent/student-profile');
      const p = data.profile || {};
      $('ppName').textContent = data.name || '';
      $('ppClass').textContent = data.className
        ? (' · ' + data.className)
        : (data.classId ? (' · ' + data.classId) : '');

      const photoPath = data.photoPath || (p && p.photoPath) || '';
      const img = $('ppPhotoImg');
      const fallback = $('ppPhotoFallback');
      if (fallback) {
        fallback.textContent = String(data.name || '?').trim().charAt(0).toUpperCase() || '?';
      }
      if (img) {
        if (photoPath) {
          img.src = photoPath + (photoPath.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
          img.classList.remove('hidden');
          if (fallback) fallback.classList.add('hidden');
          img.onerror = () => {
            img.classList.add('hidden');
            if (fallback) fallback.classList.remove('hidden');
          };
        } else {
          img.removeAttribute('src');
          img.classList.add('hidden');
          if (fallback) fallback.classList.remove('hidden');
        }
      }

      ['address', 'phone', 'email', 'parentName', 'parentPhone', 'parentEmail',
        'emergencyContact', 'emergencyPhone', 'nationality', 'notes'].forEach((k) => {
        const el = $('pp_' + k);
        if (el) el.value = p[k] || '';
      });
      const med = data.medicalFields || [];
      $('ppMedical').innerHTML = med.length
        ? med.map((f, i) =>
          '<label>' + escapeHtml(f.label) +
          '<input data-med-idx="' + i + '" data-med-label="' + escapeHtml(f.label) +
          '" data-med-id="' + escapeHtml(f.fieldId || '') +
          '" value="' + escapeHtml(f.value || '') + '"></label>'
        ).join('')
        : '<p class="muted small pp-span-2">No medical fields yet.</p>';
    } catch (e) {
      $('ppProfileError').textContent = e.message;
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    $('ppProfileError').textContent = '';
    $('ppProfileOk').textContent = '';
    const body = {};
    ['address', 'phone', 'email', 'parentName', 'parentPhone', 'parentEmail',
      'emergencyContact', 'emergencyPhone', 'nationality', 'notes'].forEach((k) => {
      body[k] = $('pp_' + k).value;
    });
    body.medicalFields = Array.from(document.querySelectorAll('#ppMedical [data-med-idx]')).map((inp) => ({
      fieldId: inp.dataset.medId || '',
      label: inp.dataset.medLabel || '',
      value: inp.value
    }));
    try {
      await api('/api/parent/student-profile', { method: 'POST', body });
      $('ppProfileOk').textContent = 'Saved.';
      boot();
    } catch (err) {
      $('ppProfileError').textContent = err.message;
    }
  }

  return { init, boot, switchTab };
})();
