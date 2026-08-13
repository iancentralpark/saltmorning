/* Salt Morning Class — Learning Analytics (teacher class / admin school-wide) */
window.SaltAnalytics = (function() {
  let deps = {};
  let dash = null;
  let statusFilter = '';
  let classFilter = '';
  let selectedId = '';
  let mode = 'class'; // 'class' | 'school'
  let role = 'teacher';

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, role); }
  function getClass() { return typeof deps.getClass === 'function' ? deps.getClass() : null; }
  function t(key, fallback) {
    return window.SaltI18n ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function analyticsBase() {
    if (mode === 'school') return '/api/admin/analytics';
    const cls = getClass();
    if (!cls) return '';
    return '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics';
  }

  function init(options) {
    deps = options || {};
    mode = deps.mode === 'school' ? 'school' : 'class';
    role = deps.role || (mode === 'school' ? 'admin' : 'teacher');

    if ($('laRefresh')) $('laRefresh').addEventListener('click', loadDashboard);
    if ($('laSeedMock')) $('laSeedMock').addEventListener('click', seedMock);
    if ($('laStatusFilter')) {
      $('laStatusFilter').addEventListener('change', () => {
        statusFilter = $('laStatusFilter').value;
        renderRoster();
      });
    }
    if ($('laClassFilter')) {
      $('laClassFilter').addEventListener('change', () => {
        classFilter = $('laClassFilter').value;
        loadDashboard();
      });
    }
    if ($('laImportBtn')) $('laImportBtn').addEventListener('click', importData);
    if ($('laDetailClose')) {
      $('laDetailClose').addEventListener('click', () => {
        selectedId = '';
        $('laDetail').classList.add('hidden');
      });
    }
    if ($('laDiagnoseBtn')) $('laDiagnoseBtn').addEventListener('click', runDiagnose);

    window.addEventListener('salt:langchange', () => {
      if (dash) {
        renderCounts();
        renderRoster();
      }
    });
  }

  function onClassOpen() {
    statusFilter = '';
    selectedId = '';
    if ($('laStatusFilter')) $('laStatusFilter').value = '';
    if ($('laDetail')) $('laDetail').classList.add('hidden');
    loadDashboard();
  }

  function onSchoolOpen(classes) {
    statusFilter = '';
    selectedId = '';
    if ($('laStatusFilter')) $('laStatusFilter').value = '';
    if ($('laDetail')) $('laDetail').classList.add('hidden');
    fillClassFilter(classes || []);
    loadDashboard();
  }

  function fillClassFilter(classes) {
    const sel = $('laClassFilter');
    if (!sel) return;
    const prev = classFilter || sel.value || '';
    sel.innerHTML = '<option value="">' + escapeHtml(t('admin.analytics.allClasses', 'All classes')) + '</option>' +
      (classes || []).map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' +
        escapeHtml(c.name || c.className || c.classId) + '</option>'
      ).join('');
    if (prev) {
      sel.value = prev;
      classFilter = prev;
    }
  }

  async function loadDashboard() {
    const base = analyticsBase();
    if (!base && mode === 'class') return;
    if ($('laRoster')) $('laRoster').innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const params = new URLSearchParams();
      if (mode === 'school' && classFilter) params.set('classId', classFilter);
      // Load full dash for count integrity; filter roster client-side by status
      const q = params.toString() ? ('?' + params.toString()) : '';
      dash = await api(base + q);
      if (mode === 'school' && dash.classes && $('laClassFilter') && !$('laClassFilter').options.length) {
        fillClassFilter((dash.classes || []).map((c) => ({
          classId: c.classId,
          name: c.className
        })));
      }
      renderCounts();
      renderRoster();
    } catch (e) {
      if ($('laRoster')) {
        $('laRoster').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }
  }

  function renderCounts() {
    if (!$('laCounts')) return;
    const c = (dash && dash.counts) || {};
    const labels = [
      ['on_track', t('la.on_track', 'On Track'), c.on_track || 0],
      ['attention', t('la.attention', 'Attention'), c.attention || 0],
      ['warning', t('la.warning', 'Warning'), c.warning || 0],
      ['intervention', t('la.intervention', 'Intervention'), c.intervention || 0]
    ];
    $('laCounts').innerHTML = labels.map((row) =>
      '<button type="button" class="la-count la-count-' + row[0] + '" data-status="' + row[0] + '">' +
        '<strong>' + row[2] + '</strong><span>' + escapeHtml(row[1]) + '</span></button>'
    ).join('');
    $('laCounts').querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        statusFilter = btn.dataset.status;
        if ($('laStatusFilter')) $('laStatusFilter').value = statusFilter;
        renderRoster();
      });
    });
  }

  function badge(st) {
    const s = st || {};
    const key = 'la.' + (s.status || '');
    const label = t(key, s.label || s.status || '');
    return '<span class="la-badge la-badge-' + escapeHtml(s.status || '') + '">' +
      escapeHtml(label) + '</span>';
  }

  function renderRoster() {
    const box = $('laRoster');
    if (!box || !dash) return;
    let students = dash.students || [];
    if (statusFilter) students = students.filter((s) => s.status.status === statusFilter);
    if (!students.length) {
      box.innerHTML = '<p class="muted">' + escapeHtml(t('la.empty', 'No students match this filter.')) + '</p>';
      return;
    }
    const showClass = mode === 'school';
    box.innerHTML =
      '<table class="la-table"><thead><tr>' +
      '<th>' + escapeHtml(t('la.student', 'Student')) + '</th>' +
      (showClass ? '<th>' + escapeHtml(t('la.class', 'Class')) + '</th>' : '') +
      '<th>' + escapeHtml(t('la.status', 'Status')) + '</th>' +
      '<th>HW%</th><th>Vocab</th><th>Latest SR</th><th>Latest MAP</th><th></th>' +
      '</tr></thead><tbody>' +
      students.map((s) => {
        const eng = s.engagement || {};
        const sr = s.status.metrics && s.status.metrics.starReading;
        const map = s.status.metrics && s.status.metrics.map;
        return '<tr data-sid="' + escapeHtml(s.studentId) + '">' +
          '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
          (showClass ? '<td class="muted small">' + escapeHtml(s.className || s.classId || '') + '</td>' : '') +
          '<td>' + badge(s.status) + '</td>' +
          '<td>' + Math.round((eng.homeworkCompletionRate || 0) * 100) + '%</td>' +
          '<td>' + (eng.avgVocabScore != null ? Math.round(eng.avgVocabScore) : '—') + '</td>' +
          '<td>' + (sr && sr.latest != null ? sr.latest : '—') + '</td>' +
          '<td>' + (map && map.latest != null ? map.latest : '—') + '</td>' +
          '<td><button type="button" class="btn btn-ghost la-open" data-sid="' +
            escapeHtml(s.studentId) + '">' + escapeHtml(t('admin.analytics.analyze', 'Analyze')) +
            '</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';
    box.querySelectorAll('.la-open').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.sid));
    });
  }

  function sparkline(seriesKey, points) {
    const pts = (points || []).filter((p) => p.series === seriesKey);
    if (!pts.length) return '<p class="muted small">No data</p>';
    const vals = pts.map((p) => p.value);
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const span = Math.max(1, max - min);
    const w = 280;
    const h = 64;
    const coords = pts.map((p, i) => {
      const x = pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w;
      const y = h - ((p.value - min) / span) * (h - 8) - 4;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="la-spark" viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="64" aria-hidden="true">' +
      '<polyline fill="none" stroke="currentColor" stroke-width="2.5" points="' + coords + '"/></svg>' +
      '<div class="muted small">' + escapeHtml(pts[0].date) + ' → ' + escapeHtml(pts[pts.length - 1].date) +
      ' · ' + vals[0] + ' → ' + vals[vals.length - 1] + '</div>';
  }

  async function openDetail(studentId) {
    selectedId = studentId;
    $('laDetail').classList.remove('hidden');
    $('laDetailBody').innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      let s;
      if (mode === 'school') {
        s = await api('/api/admin/analytics/students/' + encodeURIComponent(studentId));
      } else {
        const cls = getClass();
        s = await api(
          '/api/teacher/class/' + encodeURIComponent(cls.classId) +
          '/analytics/students/' + encodeURIComponent(studentId)
        );
      }
      renderDetail(s);
    } catch (e) {
      $('laDetailBody').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function proseHtml(text) {
    const raw = String(text || '').trim();
    if (!raw) return '<p class="muted">No report yet.</p>';
    return raw.split(/\n{2,}/).map((block) => {
      const lines = block.split('\n').map((l) => escapeHtml(l)).join('<br>');
      return '<p class="la-essay-p">' + lines + '</p>';
    }).join('');
  }

  function renderDiagnostic(d, heading) {
    const source = d.source || (d.updatedAt ? 'saved' : '');
    const actions = (d.recommendedActions || []).map(String);
    const urgentList = (d.urgentInterventions && d.urgentInterventions.length)
      ? d.urgentInterventions.map(String)
      : actions.filter((a) => /^\[Urgent\]/i.test(a)).map((a) => a.replace(/^\[Urgent\]\s*/i, ''));
    const otherList = actions
      .filter((a) => !/^\[Urgent\]/i.test(a))
      .filter((a) => !urgentList.includes(a));

    return (
      (heading || '') +
      (d.learnerProfile
        ? '<p class="la-learner-profile"><strong>Learner profile.</strong> ' +
          escapeHtml(d.learnerProfile) + '</p>'
        : '') +
      '<h4>Teacher analysis <span class="muted small">(' + escapeHtml(source) + ')</span></h4>' +
      '<div class="la-essay">' + proseHtml(d.teacherReport) + '</div>' +
      '<h4>Parent / family summary</h4>' +
      '<div class="la-essay">' + proseHtml(d.parentReport) + '</div>' +
      (urgentList.length
        ? '<h4>Urgent interventions (next 1–2 weeks)</h4><ol class="la-interventions la-interventions-urgent">' +
          urgentList.map((a) => '<li>' + escapeHtml(a) + '</li>').join('') + '</ol>'
        : '') +
      (otherList.length
        ? '<h4>Instructional plan</h4><ul class="la-interventions">' +
          otherList.map((a) => '<li>' + escapeHtml(a) + '</li>').join('') + '</ul>'
        : '')
    );
  }

  function renderDetail(s) {
    $('laDetailTitle').textContent = s.name +
      (s.className ? ' · ' + s.className : '') +
      ' — Learning Analytics';
    const domains = (s.domainProfile || []).map((d) =>
      '<div class="la-domain la-domain-' + escapeHtml(d.band) + '">' +
        '<strong>' + escapeHtml(d.label) + '</strong>' +
        '<span>' + (d.latestScore != null ? d.latestScore : '—') + '</span>' +
        '<em>' + escapeHtml(d.band) +
        (d.trendDelta != null ? ' · Δ ' + d.trendDelta : '') + '</em></div>'
    ).join('') || '<p class="muted">No domain scores yet.</p>';

    $('laDetailBody').innerHTML =
      '<div class="la-detail-top">' + badge(s.status) +
        '<ul class="la-signals">' +
        (s.status.signals || []).map((x) => '<li>' + escapeHtml(x) + '</li>').join('') +
        '</ul></div>' +
      '<div class="la-charts">' +
        '<section><h4>Star Reading</h4>' + sparkline('star_reading', s.progressSeries) + '</section>' +
        '<section><h4>MAP</h4>' + sparkline('map', s.progressSeries) + '</section>' +
        '<section><h4>Daily Vocab</h4>' + sparkline('vocab', s.progressSeries) + '</section>' +
        '<section><h4>Formative</h4>' + sparkline('formative', s.progressSeries) + '</section>' +
      '</div>' +
      '<h4>Strengths & weaknesses</h4><div class="la-domains">' + domains + '</div>' +
      '<div id="laDiagOut" class="la-diag"></div>';

    if ($('laDiagnoseBtn')) {
      $('laDiagnoseBtn').textContent = t('la.diagnose', 'Generate AI learning profile');
    }

    if (s.latestIntervention) {
      $('laDiagOut').innerHTML = renderDiagnostic({
        teacherReport: s.latestIntervention.teacherReport,
        parentReport: s.latestIntervention.parentReport,
        recommendedActions: s.latestIntervention.recommendedActions || [],
        source: 'saved',
        learnerProfile: ''
      }, '<h4>Latest AI profile</h4>');
      appendShareParentButton();
    }
  }

  function appendShareParentButton() {
    if (mode === 'school' || !$('laDiagOut')) return;
    const wrap = document.createElement('div');
    wrap.style.marginTop = '0.75rem';
    wrap.innerHTML =
      '<button type="button" class="btn btn-primary" id="laShareParentBtn">' +
      escapeHtml(t('la.shareParent', 'Share with parent')) + '</button>' +
      '<span class="muted small" id="laShareParentMsg" style="margin-left:0.5rem"></span>';
    $('laDiagOut').appendChild(wrap);
    const btn = wrap.querySelector('#laShareParentBtn');
    const msg = wrap.querySelector('#laShareParentMsg');
    btn.addEventListener('click', async () => {
      const cls = getClass();
      if (!cls || !selectedId) return;
      btn.disabled = true;
      msg.textContent = '';
      try {
        await api(
          '/api/teacher/class/' + encodeURIComponent(cls.classId) +
          '/analytics/students/' + encodeURIComponent(selectedId) + '/share-parent',
          { method: 'POST', body: {} }
        );
        msg.textContent = t('la.shareParentDone', 'Shared with parent.');
      } catch (e) {
        msg.textContent = e.message;
      }
      btn.disabled = false;
    });
  }

  async function runDiagnose() {
    if (!selectedId) return;
    $('laDiagnoseBtn').disabled = true;
    $('laDiagOut').innerHTML = '<p class="muted">Generating pedagogical profile… this can take a moment.</p>';
    try {
      let data;
      if (mode === 'school') {
        data = await api(
          '/api/admin/analytics/students/' + encodeURIComponent(selectedId) + '/diagnose',
          { method: 'POST', body: {} }
        );
      } else {
        const cls = getClass();
        data = await api(
          '/api/teacher/class/' + encodeURIComponent(cls.classId) +
          '/analytics/students/' + encodeURIComponent(selectedId) + '/diagnose',
          { method: 'POST', body: {} }
        );
      }
      const d = data.diagnostic || {};
      $('laDiagOut').innerHTML = renderDiagnostic(d);
      appendShareParentButton();
      loadDashboard();
    } catch (e) {
      $('laDiagOut').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
    $('laDiagnoseBtn').disabled = false;
  }

  async function seedMock() {
    $('laSeedMock').disabled = true;
    try {
      let res;
      if (mode === 'school') {
        const cid = classFilter || ($('laClassFilter') && $('laClassFilter').value) || '';
        if (!cid) {
          $('laImportMsg').textContent = 'Choose a class first, then load demo data.';
          $('laSeedMock').disabled = false;
          return;
        }
        res = await api('/api/admin/analytics/seed-mock', {
          method: 'POST',
          body: { classId: cid }
        });
      } else {
        const cls = getClass();
        if (!cls) return;
        res = await api(
          '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics/seed-mock',
          { method: 'POST', body: {} }
        );
      }
      $('laImportMsg').textContent = res.message ||
        ('Seeded ' + (res.savedReports || 0) + ' reports, ' + (res.savedLogs || 0) + ' daily logs.');
      await loadDashboard();
    } catch (e) {
      $('laImportMsg').textContent = e.message;
    }
    $('laSeedMock').disabled = false;
  }

  async function importData() {
    const input = $('laImportFile');
    const file = input && input.files && input.files[0];
    if (!file) {
      $('laImportMsg').textContent = 'Choose a PDF or scan image first.';
      return;
    }
    $('laImportBtn').disabled = true;
    $('laImportMsg').textContent = 'AI is reading the report…';
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('source', $('laImportSource').value);
      let res;
      if (mode === 'school') {
        const cid = classFilter || ($('laClassFilter') && $('laClassFilter').value) || '';
        if (!cid) {
          $('laImportMsg').textContent = 'Choose a class for this import.';
          $('laImportBtn').disabled = false;
          return;
        }
        fd.append('classId', cid);
        res = await api('/api/admin/analytics/import', { method: 'POST', body: fd });
      } else {
        const cls = getClass();
        res = await api(
          '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics/import',
          { method: 'POST', body: fd }
        );
      }
      let msg = 'Imported ' + (res.saved || res.matched || 0) + ' student score(s).';
      if (res.unmatched && res.unmatched.length) {
        msg += ' Unmatched: ' + res.unmatched.join(', ') + '.';
      }
      if (res.warnings && res.warnings.length) {
        msg += ' ' + res.warnings.join(' ');
      }
      $('laImportMsg').textContent = msg;
      if (input) input.value = '';
      await loadDashboard();
    } catch (e) {
      $('laImportMsg').textContent = e.message;
    }
    $('laImportBtn').disabled = false;
  }

  return { init, onClassOpen, onSchoolOpen, loadDashboard };
})();
