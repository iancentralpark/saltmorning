/* Salt Morning Class — Learning Analytics teacher dashboard */
window.SaltAnalytics = (function() {
  let deps = {};
  let dash = null;
  let statusFilter = '';
  let selectedId = '';

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts, 'teacher'); }
  function getClass() { return typeof deps.getClass === 'function' ? deps.getClass() : null; }

  function init(options) {
    deps = options || {};
    $('laRefresh').addEventListener('click', loadDashboard);
    $('laSeedMock').addEventListener('click', seedMock);
    $('laStatusFilter').addEventListener('change', () => {
      statusFilter = $('laStatusFilter').value;
      renderRoster();
    });
    $('laImportBtn').addEventListener('click', importData);
    $('laDetailClose').addEventListener('click', () => {
      selectedId = '';
      $('laDetail').classList.add('hidden');
    });
    $('laDiagnoseBtn').addEventListener('click', runDiagnose);
  }

  function onClassOpen() {
    statusFilter = '';
    selectedId = '';
    $('laStatusFilter').value = '';
    $('laDetail').classList.add('hidden');
    loadDashboard();
  }

  async function loadDashboard() {
    const cls = getClass();
    if (!cls) return;
    $('laRoster').innerHTML = '<p class="muted">Loading analytics…</p>';
    try {
      const q = statusFilter ? ('?status=' + encodeURIComponent(statusFilter)) : '';
      dash = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics' + q);
      renderCounts();
      renderRoster();
    } catch (e) {
      $('laRoster').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderCounts() {
    const c = (dash && dash.counts) || {};
    $('laCounts').innerHTML = [
      ['on_track', 'On Track', c.on_track || 0],
      ['attention', 'Attention', c.attention || 0],
      ['warning', 'Warning', c.warning || 0],
      ['intervention', 'Intervention', c.intervention || 0]
    ].map((row) =>
      '<button type="button" class="la-count la-count-' + row[0] + '" data-status="' + row[0] + '">' +
        '<strong>' + row[2] + '</strong><span>' + row[1] + '</span></button>'
    ).join('');
    $('laCounts').querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        statusFilter = btn.dataset.status;
        $('laStatusFilter').value = statusFilter;
        // client filter from full dash — reload without server filter for counts integrity
        api('/api/teacher/class/' + encodeURIComponent(getClass().classId) + '/analytics').then((data) => {
          dash = data;
          renderCounts();
          renderRoster();
        });
      });
    });
  }

  function badge(st) {
    const s = st || {};
    return '<span class="la-badge la-badge-' + escapeHtml(s.status || '') + '">' +
      escapeHtml(s.label || s.status || '') + '</span>';
  }

  function renderRoster() {
    const box = $('laRoster');
    if (!dash) return;
    let students = dash.students || [];
    if (statusFilter) students = students.filter((s) => s.status.status === statusFilter);
    if (!students.length) {
      box.innerHTML = '<p class="muted">No students match this filter. Seed mock data to try the demo.</p>';
      return;
    }
    box.innerHTML =
      '<table class="la-table"><thead><tr>' +
      '<th>Student</th><th>Status</th><th>HW%</th><th>Vocab</th><th>Latest SR</th><th>Latest MAP</th><th></th>' +
      '</tr></thead><tbody>' +
      students.map((s) => {
        const eng = s.engagement || {};
        const sr = s.status.metrics && s.status.metrics.starReading;
        const map = s.status.metrics && s.status.metrics.map;
        return '<tr data-sid="' + escapeHtml(s.studentId) + '">' +
          '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
          '<td>' + badge(s.status) + '</td>' +
          '<td>' + Math.round((eng.homeworkCompletionRate || 0) * 100) + '%</td>' +
          '<td>' + (eng.avgVocabScore != null ? Math.round(eng.avgVocabScore) : '—') + '</td>' +
          '<td>' + (sr && sr.latest != null ? sr.latest : '—') + '</td>' +
          '<td>' + (map && map.latest != null ? map.latest : '—') + '</td>' +
          '<td><button type="button" class="btn btn-ghost la-open" data-sid="' +
            escapeHtml(s.studentId) + '">Analyze</button></td>' +
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
    const cls = getClass();
    $('laDetail').classList.remove('hidden');
    $('laDetailBody').innerHTML = '<p class="muted">Loading…</p>';
    try {
      const s = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/analytics/students/' + encodeURIComponent(studentId)
      );
      renderDetail(s);
    } catch (e) {
      $('laDetailBody').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderDetail(s) {
    $('laDetailTitle').textContent = s.name + ' — Learning Analytics';
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

    if (s.latestIntervention) {
      $('laDiagOut').innerHTML =
        '<h4>Latest diagnostic</h4>' +
        '<pre class="la-pre">' + escapeHtml(s.latestIntervention.teacherReport || '') + '</pre>' +
        '<h4>Parent summary</h4>' +
        '<pre class="la-pre">' + escapeHtml(s.latestIntervention.parentReport || '') + '</pre>';
    }
  }

  async function runDiagnose() {
    if (!selectedId) return;
    const cls = getClass();
    $('laDiagnoseBtn').disabled = true;
    try {
      const data = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/analytics/students/' + encodeURIComponent(selectedId) + '/diagnose',
        { method: 'POST', body: {} }
      );
      const d = data.diagnostic || {};
      $('laDiagOut').innerHTML =
        '<h4>Teacher report <span class="muted small">(' + escapeHtml(d.source || '') + ')</span></h4>' +
        '<pre class="la-pre">' + escapeHtml(d.teacherReport || '') + '</pre>' +
        '<h4>Parent / student summary</h4>' +
        '<pre class="la-pre">' + escapeHtml(d.parentReport || '') + '</pre>' +
        '<h4>Actions</h4><ul>' +
        (d.recommendedActions || []).map((a) => '<li>' + escapeHtml(a) + '</li>').join('') +
        '</ul>';
      loadDashboard();
    } catch (e) {
      $('laDiagOut').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
    $('laDiagnoseBtn').disabled = false;
  }

  async function seedMock() {
    const cls = getClass();
    if (!cls) return;
    $('laSeedMock').disabled = true;
    try {
      const res = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics/seed-mock',
        { method: 'POST', body: {} }
      );
      $('laImportMsg').textContent = res.message ||
        ('Seeded ' + (res.savedReports || 0) + ' reports, ' + (res.savedLogs || 0) + ' daily logs.');
      await loadDashboard();
    } catch (e) {
      $('laImportMsg').textContent = e.message;
    }
    $('laSeedMock').disabled = false;
  }

  async function importData() {
    const cls = getClass();
    const raw = $('laImportArea').value.trim();
    if (!raw) return;
    try {
      const body = {
        classId: cls.classId,
        source: $('laImportSource').value,
        data: raw
      };
      const res = await api(
        '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics/import',
        { method: 'POST', body }
      );
      $('laImportMsg').textContent = 'Imported ' + (res.saved || 0) + ' row(s).';
      await loadDashboard();
    } catch (e) {
      $('laImportMsg').textContent = e.message;
    }
  }

  return { init, onClassOpen, loadDashboard };
})();
