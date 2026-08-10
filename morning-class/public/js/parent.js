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

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, 'parent'); }

  function init(options) {
    deps = options || {};
    document.querySelectorAll('#appView .tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    $('ppProfileForm').addEventListener('submit', saveProfile);
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

  function switchTab(name) {
    document.querySelectorAll('#appView .tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === name));
    ['feed', 'attendance', 'timetable', 'homework', 'reportcards', 'profile', 'messages'].forEach((k) => {
      const el = $('tab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (el) deps.hide(el);
    });
    const map = {
      feed: 'tabFeed',
      attendance: 'tabAttendance',
      timetable: 'tabTimetable',
      homework: 'tabHomework',
      reportcards: 'tabReportcards',
      profile: 'tabProfile',
      messages: 'tabMessages'
    };
    deps.show($(map[name]));
    if (name === 'attendance') loadAttendance();
    if (name === 'timetable') loadTimetable();
    if (name === 'homework') loadHomework();
    if (name === 'reportcards') loadReportCards();
    if (name === 'profile') loadProfile();
    if (name === 'messages') loadMessagesTab();
  }

  async function boot() {
    const data = await api('/api/parent/overview');
    overview = data;
    renderHero(data);
    renderFeed(data.newsfeed || []);
    renderTeachers(data.teachers || []);
  }

  function renderHero(data) {
    const s = data.student || {};
    const photo = s.photoPath
      ? '<img class="pp-hero-photo" src="' + escapeHtml(s.photoPath) + '" alt="">'
      : '<div class="pp-hero-fallback">' + escapeHtml((s.name || '?').charAt(0)) + '</div>';
    $('ppHero').innerHTML =
      photo +
      '<div class="pp-hero-text">' +
        '<div class="pp-hero-eyebrow">My child</div>' +
        '<h2>' + escapeHtml(s.name || '') + '</h2>' +
        '<p class="muted">' +
          escapeHtml(s.className || s.classId || '') +
          (s.gradeLevel ? ' · ' + escapeHtml(s.gradeLevel) : '') +
        '</p>' +
        '<div class="pp-hero-stats">' +
          '<span>' + (data.homeworkSummary && data.homeworkSummary.pending || 0) + ' homework pending</span>' +
          '<span>' + (data.reportCardsShared || 0) + ' report card(s)</span>' +
        '</div>' +
      '</div>';
    $('welcomeText').textContent = (data.parent && data.parent.name ? data.parent.name : 'Parent') +
      ' · ' + (s.name || '');
  }

  function renderFeed(items) {
    const box = $('ppFeed');
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
    box.innerHTML = items.map((it) =>
      '<article class="pp-feed-item pp-feed-' + escapeHtml(it.type) + '">' +
        '<div class="pp-feed-type">' + escapeHtml(typeLabel[it.type] || it.type) + '</div>' +
        '<h3>' + escapeHtml(it.title || '') + '</h3>' +
        '<p>' + escapeHtml(it.body || '') + '</p>' +
        '<div class="pp-feed-meta muted small">' +
          escapeHtml(String(it.at || '').slice(0, 16).replace('T', ' ')) +
          (it.meta && it.meta.subject ? ' · ' + escapeHtml(it.meta.subject) : '') +
          (it.meta && it.meta.letterGrade ? ' · ' + escapeHtml(it.meta.letterGrade) : '') +
        '</div>' +
      '</article>'
    ).join('');
  }

  function renderTeachers(teachers) {
    const box = $('ppTeacherList');
    if (!box) return;
    if (!teachers.length) {
      box.innerHTML = '<p class="muted small">No teachers linked yet.</p>';
      return;
    }
    box.innerHTML = teachers.map((t) =>
      '<button type="button" class="pp-teacher-chip" data-tid="' + escapeHtml(t.teacherId) + '">' +
        '<strong>' + escapeHtml(t.name) + '</strong>' +
        '<span>' + escapeHtml(t.isHomeroom ? 'Homeroom' : ((t.subjects || []).join(', ') || 'Teacher')) + '</span>' +
      '</button>'
    ).join('');
    box.querySelectorAll('.pp-teacher-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab('messages');
        if (window.SaltMessenger && SaltMessenger.openThreadForTeacher) {
          SaltMessenger.openThreadForTeacher(btn.dataset.tid);
        } else if (window.SaltMessenger && SaltMessenger.open) {
          SaltMessenger.open();
        }
      });
    });
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
              ? SaltSubjectColors.forSubject(s.subject || '', { isBreak: !!s.isBreak })
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
    html += '<article class="rc-print-sheet" id="rcPrintSheet">' +
      '<header class="rc-print-header">' +
      '<div class="rc-print-school">' + escapeHtml(card.schoolName || 'Salt Academy Morning Class') + '</div>' +
      '<h2>Student Report Card</h2>' +
      '<div class="rc-print-meta">' +
      '<div><span>Student</span><strong>' + escapeHtml(card.student.name) + '</strong></div>' +
      '<div><span>Grade Level</span><strong>' + escapeHtml(card.student.gradeLevel || '—') + '</strong></div>' +
      '<div><span>Class</span><strong>' + escapeHtml(card.className || '') + '</strong></div>' +
      '<div><span>Term</span><strong>' + escapeHtml(card.term) + '</strong></div>' +
      '<div><span>Homeroom Teacher</span><strong>' + escapeHtml(card.homeroomTeacherName || '—') + '</strong></div>' +
      '</div></header>';
    (card.subjects || []).forEach((subj) => {
      html += '<section class="rc-print-subject">' +
        '<div class="rc-print-subject-head"><h3>' + escapeHtml(subj.subject) + '</h3>' +
        '<div class="muted small">Teacher: ' + escapeHtml((subj.teacherNames || []).join(', ') || '—') + '</div></div>' +
        '<div class="rc-print-grades">' +
        '<div><span>Letter Grade</span><strong>' + escapeHtml(subj.letterGrade || '—') + '</strong></div>' +
        '<div><span>Percentage</span><strong>' +
        (subj.percentageGrade != null ? escapeHtml(String(subj.percentageGrade)) + '%' : '—') +
        '</strong></div></div>' +
        '<table class="rc-print-habits"><thead><tr><th>Work Habits / SEL</th><th>Rating</th></tr></thead><tbody>';
      (subj.workHabits || []).forEach((h) => {
        html += '<tr><td>' + escapeHtml(h.label) + '</td><td>' + escapeHtml(h.rating || '—') + '</td></tr>';
      });
      html += '</tbody></table>' +
        '<div class="rc-print-comment"><span>Teacher Comment</span><p>' +
        escapeHtml(subj.subjectComment || '—') + '</p></div></section>';
    });
    html += '<footer class="rc-print-footer muted small">Shared with parents' +
      (card.sharedAt ? ' · ' + escapeHtml(String(card.sharedAt).slice(0, 10)) : '') +
      '</footer></article>';
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
      $('ppClass').textContent = data.className || data.classId || '';
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
        : '<p class="muted small">No medical fields yet.</p>';
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

  function loadMessagesTab() {
    $('ppMessagesHint').innerHTML =
      '<p class="muted">Message your child’s Homeroom and subject teachers. Turn on Auto Translate in the chat to read teacher messages in Korean.</p>';
    renderTeachers(overview && overview.teachers ? overview.teachers : []);
    if (window.SaltMessenger && SaltMessenger.open) SaltMessenger.open();
  }

  return { init, boot, switchTab };
})();
