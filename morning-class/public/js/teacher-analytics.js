/* Salt Morning Class — Learning Analytics (teacher class / admin school-wide) */
window.SaltAnalytics = (function() {
  let deps = {};
  let dash = null;
  let statusFilter = '';
  let classFilter = '';
  let selectedId = '';
  let mode = 'class'; // 'class' | 'school'
  let role = 'teacher';
  let records = null;
  let batchFilter = '';
  let highlightBatchId = '';

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
        loadRecords();
      });
    }
    if ($('laImportBtn')) $('laImportBtn').addEventListener('click', importData);
    if ($('laReloadRecords')) $('laReloadRecords').addEventListener('click', loadRecords);
    if ($('laClearMock')) $('laClearMock').addEventListener('click', clearMockData);
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

  function recordsBase() {
    if (mode === 'school') return '/api/admin/analytics/records';
    const cls = getClass();
    if (!cls) return '';
    return '/api/teacher/class/' + encodeURIComponent(cls.classId) + '/analytics/records';
  }

  function recordsClassId() {
    if (mode === 'school') {
      return classFilter || ($('laClassFilter') && $('laClassFilter').value) || '';
    }
    const cls = getClass();
    return cls ? cls.classId : '';
  }

  async function loadRecords() {
    const base = recordsBase();
    const cid = recordsClassId();
    if (!base) return;
    if (mode === 'school' && !cid) {
      if ($('laRecords')) {
        $('laRecords').innerHTML = '<p class="muted small">Choose a class to view assessment records.</p>';
      }
      return;
    }
    if ($('laRecords')) {
      $('laRecords').innerHTML = '<p class="muted small">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    }
    try {
      const q = mode === 'school' ? ('?classId=' + encodeURIComponent(cid)) : '';
      records = await api(base + q);
      renderBatches();
      renderRecordsTable();
      if ($('laRecordsMsg')) {
        const c = records.counts || {};
        $('laRecordsMsg').textContent =
          (c.testReports || 0) + ' test scores, ' + (c.dailyLogs || 0) + ' engagement logs' +
          (c.mockTestReports ? (' · ' + c.mockTestReports + ' demo test scores') : '') +
          (c.mockDailyLogs ? (' · ' + c.mockDailyLogs + ' demo logs') : '');
      }
    } catch (e) {
      if ($('laRecords')) $('laRecords').innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderBatches() {
    const box = $('laBatches');
    if (!box || !records) return;
    const batches = records.batches || [];
    if (!batches.length) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML =
      '<div class="la-batch-chips">' +
      '<button type="button" class="la-batch-chip' + (!batchFilter ? ' active' : '') + '" data-batch="">All imports</button>' +
      batches.map((b) =>
        '<button type="button" class="la-batch-chip' +
          (batchFilter === b.batchId ? ' active' : '') +
          (highlightBatchId === b.batchId ? ' la-batch-new' : '') +
          '" data-batch="' + escapeHtml(b.batchId) + '">' +
          escapeHtml(b.label) + ' (' + b.includedCount + '/' + b.reportCount + ')</button>'
      ).join('') +
      '</div>';
    box.querySelectorAll('.la-batch-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        batchFilter = btn.dataset.batch || '';
        renderBatches();
        renderRecordsTable();
      });
    });
  }

  function formatScoreRow(r) {
    if (r.source === 'map') {
      return (r.ritScore != null ? ('RIT ' + r.ritScore) : '—') +
        (r.percentile != null ? (' · ' + r.percentile + 'th %ile') : '');
    }
    const bits = [];
    if (r.score != null) bits.push('Score ' + r.score);
    if (r.percentile != null) bits.push(r.percentile + 'th %ile');
    if (r.lexile) bits.push(r.lexile);
    return bits.length ? bits.join(' · ') : '—';
  }

  function renderRecordsTable() {
    const box = $('laRecords');
    if (!box || !records) return;
    let rows = (records.testReports || []).slice();
    if (batchFilter) {
      rows = rows.filter((r) => {
        const bid = r.importBatchId || (r.isMock ? 'mock_demo' : 'legacy_untagged');
        return bid === batchFilter;
      });
    }
    rows.sort((a, b) => String(b.testDate || b.createdAt).localeCompare(String(a.testDate || a.createdAt)));
    if (!rows.length) {
      box.innerHTML = '<p class="muted small">No assessment records yet. Upload a Star Reading or MAP report above.</p>';
      return;
    }
    box.innerHTML =
      '<table class="la-table la-records-table"><thead><tr>' +
      '<th>Date</th><th>Student</th><th>Source</th><th>Extracted scores</th><th>Include</th><th></th>' +
      '</tr></thead><tbody>' +
      rows.map((r) =>
        '<tr data-rid="' + escapeHtml(r.reportId) + '"' +
          (highlightBatchId && r.importBatchId === highlightBatchId ? ' class="la-row-new"' : '') + '>' +
          '<td>' + escapeHtml(r.testDate || '—') + '</td>' +
          '<td><strong>' + escapeHtml(r.studentName || r.studentId) + '</strong></td>' +
          '<td>' + escapeHtml(r.sourceLabel || r.source) +
            (r.isMock ? ' <span class="la-tag-mock">demo</span>' : '') +
            (r.importedFrom ? '<div class="muted small">' + escapeHtml(r.importedFrom) + '</div>' : '') +
          '</td>' +
          '<td class="small">' + escapeHtml(formatScoreRow(r)) + '</td>' +
          '<td><label class="la-include-toggle"><input type="checkbox" class="la-include-cb" data-rid="' +
            escapeHtml(r.reportId) + '"' + (r.included !== false ? ' checked' : '') + '> Include</label></td>' +
          '<td class="la-rec-actions">' +
            '<button type="button" class="btn btn-ghost la-view-record" data-rid="' + escapeHtml(r.reportId) + '">View</button>' +
            '<button type="button" class="btn btn-ghost la-danger-btn la-del-record" data-rid="' + escapeHtml(r.reportId) + '">Delete</button>' +
          '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';

    box.querySelectorAll('.la-include-cb').forEach((cb) => {
      cb.addEventListener('change', () => toggleReportIncluded(cb.dataset.rid, cb.checked));
    });
    box.querySelectorAll('.la-view-record').forEach((btn) => {
      btn.addEventListener('click', () => showReportDetail(btn.dataset.rid));
    });
    box.querySelectorAll('.la-del-record').forEach((btn) => {
      btn.addEventListener('click', () => deleteReport(btn.dataset.rid));
    });
  }

  function showReportDetail(reportId) {
    const r = (records && records.testReports || []).find((x) => x.reportId === reportId);
    const box = $('laRecordDetail');
    if (!r || !box) return;
    const domains = (r.domainScores || []).map((d) =>
      '<li><strong>' + escapeHtml(d.label || d.domain) + '</strong>: ' +
      (d.score != null ? d.score : '—') +
      (d.percentile != null ? (' (' + d.percentile + 'th %ile)') : '') + '</li>'
    ).join('') || '<li class="muted">No domain breakdown was extracted.</li>';

    box.classList.remove('hidden');
    box.innerHTML =
      '<div class="la-record-detail-head">' +
        '<h4 style="margin:0">' + escapeHtml(r.studentName || r.studentId) + ' · ' + escapeHtml(r.sourceLabel || r.source) + '</h4>' +
        '<button type="button" class="btn btn-ghost" id="laRecordDetailClose">Close</button>' +
      '</div>' +
      '<dl class="la-record-meta">' +
        '<div><dt>Test date</dt><dd>' + escapeHtml(r.testDate || '—') + '</dd></div>' +
        '<div><dt>Imported</dt><dd>' + escapeHtml(r.createdAt ? r.createdAt.slice(0, 10) : '—') + '</dd></div>' +
        '<div><dt>Source file</dt><dd>' + escapeHtml(r.importedFrom || (r.isMock ? 'Demo / mock generator' : '—')) + '</dd></div>' +
        '<div><dt>AI model</dt><dd>' + escapeHtml(r.extractionModel || (r.isMock ? '—' : '—')) + '</dd></div>' +
        '<div><dt>Import batch</dt><dd>' + escapeHtml(r.importBatchId || (r.isMock ? 'mock_demo' : 'legacy')) + '</dd></div>' +
        '<div><dt>Included in analytics</dt><dd>' + (r.included !== false ? 'Yes' : 'No') + '</dd></div>' +
      '</dl>' +
      '<h4>Extracted scores</h4>' +
      '<p>' + escapeHtml(formatScoreRow(r)) + '</p>' +
      '<h4>Domain / skill breakdown</h4>' +
      '<ul class="la-domain-list">' + domains + '</ul>';

    const closeBtn = $('laRecordDetailClose');
    if (closeBtn) closeBtn.addEventListener('click', () => box.classList.add('hidden'));
  }

  async function toggleReportIncluded(reportId, included) {
    const cid = recordsClassId();
    if (!cid) return;
    try {
      const path = mode === 'school'
        ? ('/api/admin/analytics/reports/' + encodeURIComponent(reportId))
        : ('/api/teacher/class/' + encodeURIComponent(cid) + '/analytics/reports/' + encodeURIComponent(reportId));
      await api(path, { method: 'PATCH', body: { included, classId: cid } });
      await loadRecords();
      await loadDashboard();
    } catch (e) {
      if ($('laRecordsMsg')) $('laRecordsMsg').textContent = e.message;
      await loadRecords();
    }
  }

  async function deleteReport(reportId) {
    if (!window.confirm('Delete this assessment record permanently?')) return;
    const cid = recordsClassId();
    if (!cid) return;
    try {
      const path = mode === 'school'
        ? ('/api/admin/analytics/reports/' + encodeURIComponent(reportId) + '?classId=' + encodeURIComponent(cid))
        : ('/api/teacher/class/' + encodeURIComponent(cid) + '/analytics/reports/' + encodeURIComponent(reportId));
      await api(path, { method: 'DELETE' });
      if ($('laRecordDetail')) $('laRecordDetail').classList.add('hidden');
      await loadRecords();
      await loadDashboard();
    } catch (e) {
      if ($('laRecordsMsg')) $('laRecordsMsg').textContent = e.message;
    }
  }

  async function clearMockData() {
    const cid = recordsClassId();
    if (!cid) {
      if ($('laRecordsMsg')) $('laRecordsMsg').textContent = 'Choose a class first.';
      return;
    }
    if (!window.confirm('Remove all demo/mock SR, MAP, and engagement data for this class? Real uploaded reports are kept.')) return;
    try {
      const path = mode === 'school'
        ? '/api/admin/analytics/clear-mock'
        : ('/api/teacher/class/' + encodeURIComponent(cid) + '/analytics/clear-mock');
      const res = await api(path, { method: 'POST', body: mode === 'school' ? { classId: cid } : {} });
      if ($('laRecordsMsg')) {
        $('laRecordsMsg').textContent =
          'Removed ' + (res.deletedTestReports || 0) + ' demo test scores and ' +
          (res.deletedDailyLogs || 0) + ' demo engagement logs.';
      }
      batchFilter = '';
      highlightBatchId = '';
      await loadRecords();
      await loadDashboard();
    } catch (e) {
      if ($('laRecordsMsg')) $('laRecordsMsg').textContent = e.message;
    }
  }

  function onClassOpen() {
    statusFilter = '';
    selectedId = '';
    batchFilter = '';
    highlightBatchId = '';
    if ($('laStatusFilter')) $('laStatusFilter').value = '';
    if ($('laDetail')) $('laDetail').classList.add('hidden');
    if ($('laRecordDetail')) $('laRecordDetail').classList.add('hidden');
    loadDashboard();
    loadRecords();
  }

  function onSchoolOpen(classes) {
    statusFilter = '';
    selectedId = '';
    batchFilter = '';
    highlightBatchId = '';
    if ($('laStatusFilter')) $('laStatusFilter').value = '';
    if ($('laDetail')) $('laDetail').classList.add('hidden');
    if ($('laRecordDetail')) $('laRecordDetail').classList.add('hidden');
    fillClassFilter(classes || []);
    loadDashboard();
    loadRecords();
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
      if (res.importBatchId) {
        highlightBatchId = res.importBatchId;
        batchFilter = res.importBatchId;
        msg += ' Review the extracted data below.';
      }
      if (res.unmatched && res.unmatched.length) {
        msg += ' Unmatched: ' + res.unmatched.join(', ') + '.';
      }
      if (res.warnings && res.warnings.length) {
        msg += ' ' + res.warnings.join(' ');
      }
      $('laImportMsg').textContent = msg;
      if (input) input.value = '';
      if ($('laDataMgmt')) $('laDataMgmt').open = true;
      await loadRecords();
      await loadDashboard();
    } catch (e) {
      $('laImportMsg').textContent = e.message;
    }
    $('laImportBtn').disabled = false;
  }

  return { init, onClassOpen, onSchoolOpen, loadDashboard };
})();
