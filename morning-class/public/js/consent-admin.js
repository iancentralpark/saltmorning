/* Admin Consents — publish formal letters + submission tracker */
(function (global) {
  let api = null;
  let escapeHtml = null;
  let role = 'admin';
  let $ = null;
  let classes = [];
  let templates = [];
  let forms = [];
  let activeFormId = '';
  let editorState = {
    templateId: '',
    category: 'General',
    title: '',
    contentHtml: '',
    fieldsJson: {},
    targetGrades: '*',
    dueDate: ''
  };

  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function agreedLabel(v) {
    const map = {
      Y: t('consent.agreed', 'Consented'),
      N: t('consent.declined', 'Did not consent'),
      Apply: t('consent.applied', 'Applied'),
      None: t('consent.notApplied', 'Did not apply')
    };
    return map[v] || v || '—';
  }

  function setEditorFromTemplate(tpl) {
    editorState.templateId = tpl.templateId || '';
    editorState.category = tpl.category || 'General';
    editorState.title = tpl.title || '';
    editorState.contentHtml = tpl.contentHtml || '';
    editorState.fieldsJson = Object.assign({}, tpl.fieldsJson || {});
    const titleEl = $('consentTitle');
    const bodyEl = $('consentBody');
    if (titleEl) titleEl.value = editorState.title;
    if (bodyEl) bodyEl.innerHTML = editorState.contentHtml;
    syncEventFieldsUI();
  }

  function syncEventFieldsUI() {
    const box = $('consentEventFields');
    const isEvent = editorState.category === 'Event' ||
      (editorState.fieldsJson && editorState.fieldsJson.kind === 'event');
    if (box) box.classList.toggle('hidden', !isEvent);
    if (!isEvent) return;
    const f = editorState.fieldsJson || {};
    if ($('consentCapacity')) $('consentCapacity').value = f.capacity != null ? f.capacity : 20;
    if ($('consentEventDate')) $('consentEventDate').value = f.eventDate || '';
    if ($('consentEventLocation')) $('consentEventLocation').value = f.location || '';
    if ($('consentEventFee')) $('consentEventFee').value = f.fee || '';
    if ($('consentEventSupplies')) $('consentEventSupplies').value = f.supplies || '';
  }

  function readEventFieldsIntoState() {
    const isEvent = editorState.category === 'Event' ||
      (editorState.fieldsJson && editorState.fieldsJson.kind === 'event');
    if (!isEvent) return;
    editorState.fieldsJson = Object.assign({}, editorState.fieldsJson || {}, {
      kind: 'event',
      capacity: Number(($('consentCapacity') && $('consentCapacity').value) || 0) || 0,
      eventDate: (($('consentEventDate') && $('consentEventDate').value) || '').trim(),
      location: (($('consentEventLocation') && $('consentEventLocation').value) || '').trim(),
      fee: (($('consentEventFee') && $('consentEventFee').value) || '').trim(),
      supplies: (($('consentEventSupplies') && $('consentEventSupplies').value) || '').trim(),
      firstCome: true
    });
  }

  function readEditor() {
    editorState.title = ($('consentTitle') && $('consentTitle').value) || '';
    editorState.contentHtml = ($('consentBody') && $('consentBody').innerHTML) || '';
    editorState.targetGrades = ($('consentTargets') && $('consentTargets').value) || '*';
    editorState.dueDate = ($('consentDue') && $('consentDue').value) || '';
    readEventFieldsIntoState();
    return editorState;
  }

  function showCompose(show) {
    const box = $('consentComposeCard');
    const btn = $('consentNewBtn');
    if (box) box.classList.toggle('hidden', !show);
    if (btn) btn.textContent = show
      ? t('common.close', 'Close')
      : t('admin.consents.new', 'New form');
    if (btn) btn.dataset.open = show ? '1' : '0';
  }

  async function loadTemplates() {
    const data = await api('/api/admin/consent-templates', {}, role);
    templates = data.templates || [];
    const sel = $('consentTemplateSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">' + escapeHtml(t('admin.consents.pickTemplate', 'Choose a template…')) + '</option>' +
      templates.map((tpl) => {
        const lang = tpl.fieldsJson && tpl.fieldsJson.language;
        const tag = lang === 'en' ? 'EN · ' : (lang === 'ko' ? 'KO · ' : '');
        return '<option value="' + escapeHtml(tpl.templateId) + '">' +
          escapeHtml(tag + tpl.title) + (tpl.isCustomSaved ? ' ★' : '') +
          '</option>';
      }).join('');
  }

  async function loadForms() {
    const box = $('consentFormsList');
    if (!box) return;
    box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/admin/consents', {}, role);
      forms = data.forms || [];
      if (!forms.length) {
        box.innerHTML = '<p class="muted">' +
          escapeHtml(t('consent.noForms', 'No published letters yet. Choose a template above to publish.')) +
          '</p>';
        return;
      }
      box.innerHTML = '<table class="grades-table"><thead><tr>' +
        '<th>' + escapeHtml(t('consent.col.title', 'Title')) + '</th>' +
        '<th>' + escapeHtml(t('consent.col.due', 'Due')) + '</th>' +
        '<th>' + escapeHtml(t('consent.col.status', 'Status')) + '</th>' +
        '<th>' + escapeHtml(t('consent.col.submitted', 'Submitted')) + '</th>' +
        '<th></th></tr></thead><tbody>' +
        forms.map((f) => {
          const total = f.total != null ? f.total : '—';
          const submitted = f.submittedCount != null ? f.submittedCount : '—';
          const rate = f.rate != null ? f.rate + '%' : '';
          return '<tr>' +
            '<td><button type="button" class="consent-title-link" data-consent-view="' +
            escapeHtml(f.formId) + '">' + escapeHtml(f.title) + '</button></td>' +
            '<td>' + escapeHtml(f.dueDate || '—') + '</td>' +
            '<td>' + escapeHtml(f.status === 'Active'
              ? t('consent.status.active', 'Open')
              : t('consent.status.closed', 'Closed')) + '</td>' +
            '<td><strong>' + submitted + '</strong> / ' + total +
            (rate ? ' <span class="muted small">(' + rate + ')</span>' : '') + '</td>' +
            '<td style="white-space:nowrap">' +
            '<button type="button" class="btn btn-ghost" data-consent-view="' +
            escapeHtml(f.formId) + '">' + escapeHtml(t('consent.viewLetter', 'View letter')) + '</button> ' +
            '<button type="button" class="btn btn-primary" data-consent-analytics="' +
            escapeHtml(f.formId) + '">' + escapeHtml(t('consent.submissions', 'Submissions')) + '</button> ' +
            (f.status === 'Active'
              ? '<button type="button" class="btn btn-ghost" data-consent-close="' +
                escapeHtml(f.formId) + '">' + escapeHtml(t('consent.close', 'Close')) + '</button>'
              : '') +
            '<button type="button" class="btn btn-ghost" data-consent-edit="' +
            escapeHtml(f.formId) + '" data-title="' + escapeHtml(f.title) +
            '" data-due="' + escapeHtml(f.dueDate || '') + '">' +
            escapeHtml(t('common.edit', 'Edit')) + '</button> ' +
            '<button type="button" class="btn btn-ghost" data-consent-delete="' +
            escapeHtml(f.formId) + '">' + escapeHtml(t('common.delete', 'Delete')) + '</button>' +
            '</td></tr>';
        }).join('') +
        '</tbody></table>';

      box.querySelectorAll('[data-consent-view]').forEach((btn) => {
        btn.addEventListener('click', () => openLetterView(btn.dataset.consentView));
      });
      box.querySelectorAll('[data-consent-analytics]').forEach((btn) => {
        btn.addEventListener('click', () => openAnalytics(btn.dataset.consentAnalytics));
      });
      box.querySelectorAll('[data-consent-close]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('consent.closeConfirm', 'Close this letter? Parents will not be able to submit.'))) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(btn.dataset.consentClose) + '/close', {
              method: 'POST'
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      box.querySelectorAll('[data-consent-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const formId = btn.dataset.consentEdit;
          const newTitle = window.prompt(t('consent.col.title', 'Title'), btn.dataset.title || '');
          if (newTitle == null) return;
          const newDue = window.prompt(t('consent.editDue', 'Due date (YYYY-MM-DD, blank for none)'), btn.dataset.due || '');
          if (newDue == null) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(formId), {
              method: 'PATCH',
              body: { title: newTitle, dueDate: newDue }
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      box.querySelectorAll('[data-consent-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('consent.deleteConfirm', 'Delete this letter completely? Submissions will also be removed.'))) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(btn.dataset.consentDelete), {
              method: 'DELETE'
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
    } catch (e) {
      box.innerHTML = '<p class="error">' + escapeHtml(e.message || t('consent.loadFail', 'Could not load the list.')) + '</p>';
    }
  }

  function hideLetterView() {
    const box = $('consentLetterView');
    if (box) box.classList.add('hidden');
    document.documentElement.classList.remove('printing-consent-letter');
  }

  async function openLetterView(formId) {
    const box = $('consentLetterView');
    if (!box) return;
    const analytics = $('consentAnalytics');
    if (analytics) analytics.classList.add('hidden');
    showCompose(false);
    box.classList.remove('hidden');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const titleEl = $('consentViewTitle');
    const metaEl = $('consentViewMeta');
    const bodyEl = $('consentViewBody');
    if (titleEl) titleEl.textContent = t('common.loading', 'Loading…');
    if (metaEl) metaEl.textContent = '';
    if (bodyEl) bodyEl.innerHTML = '';
    try {
      const data = await api('/api/admin/consents/' + encodeURIComponent(formId), {}, role);
      const form = data.form || (forms || []).find((f) => f.formId === String(formId));
      if (!form) throw new Error(t('consent.loadFail', 'Could not load the list.'));
      if (titleEl) titleEl.textContent = form.title || '';
      const bits = [];
      bits.push(form.status === 'Active'
        ? t('consent.status.active', 'Open')
        : t('consent.status.closed', 'Closed'));
      if (form.publishedAt) {
        bits.push(t('consent.publishedOn', 'Published') + ' ' + String(form.publishedAt).slice(0, 10));
      }
      if (form.dueDate) bits.push(t('consent.col.due', 'Due') + ' ' + form.dueDate);
      if (form.targetGrades && form.targetGrades !== '*') {
        bits.push(t('admin.consents.audience', 'Audience') + ': ' + form.targetGrades);
      }
      if (metaEl) metaEl.textContent = bits.join(' · ');
      if (bodyEl) bodyEl.innerHTML = form.contentHtml || '<p class="muted">—</p>';
      box.dataset.formId = form.formId;
    } catch (e) {
      if (titleEl) titleEl.textContent = '';
      if (bodyEl) bodyEl.innerHTML = '<p class="error">' + escapeHtml(e.message || '') + '</p>';
    }
  }

  async function openAnalytics(formId) {
    hideLetterView();
    activeFormId = formId;
    const panel = $('consentAnalytics');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/analytics', {}, role);
      const filter = { q: '', only: 'all' };

      function renderTables() {
        const q = String(filter.q || '').trim().toLowerCase();
        const match = (row) => {
          if (!q) return true;
          return String(row.name || '').toLowerCase().indexOf(q) >= 0 ||
            String(row.className || row.classId || '').toLowerCase().indexOf(q) >= 0;
        };
        let pending = (data.pending || []).filter(match);
        let submitted = (data.submitted || []).filter(match);
        if (filter.only === 'pending') submitted = [];
        if (filter.only === 'submitted') pending = [];
        if (filter.only === 'agreed') {
          pending = [];
          submitted = submitted.filter((s) => s.agreed === 'Y' || s.agreed === 'Apply');
        }
        if (filter.only === 'declined') {
          pending = [];
          submitted = submitted.filter((s) => s.agreed === 'N' || s.agreed === 'None');
        }

        const submittedRows = submitted.length
          ? '<table class="grades-table"><thead><tr>' +
            '<th>' + escapeHtml(t('consent.col.student', 'Student')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.class', 'Class')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.response', 'Response')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.reason', 'Reason')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.submittedAt', 'Submitted')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.signed', 'Signed')) + '</th>' +
            '<th></th></tr></thead><tbody>' +
            submitted.map((s) => {
              const isWaiting = (s.extraData && s.extraData.registrationStatus) === 'Waiting';
              return '<tr>' +
              '<td>' + escapeHtml(s.name) + '</td>' +
              '<td>' + escapeHtml(s.className || s.classId) + '</td>' +
              '<td><strong>' + escapeHtml(agreedLabel(s.agreed)) +
              (s.extraData && s.extraData.registrationStatus
                ? ' · ' + escapeHtml(isWaiting
                  ? (t('consent.waitNum', 'Waitlist #') + (s.extraData.waitNumber || ''))
                  : t('consent.confirmed', 'Confirmed'))
                : '') +
              '</strong></td>' +
              '<td class="muted small">' + escapeHtml(s.disagreedReason || (s.extraData && s.extraData.eventNotes) || '—') + '</td>' +
              '<td>' + escapeHtml(String(s.submittedAt || '').slice(0, 16).replace('T', ' ')) + '</td>' +
              '<td>' + (s.hasSignature ? '✓' : '—') + '</td>' +
              '<td style="white-space:nowrap">' +
              (isWaiting
                ? '<button type="button" class="btn btn-ghost consent-promote-btn" data-sub="' +
                  escapeHtml(s.submissionId || '') + '">' + escapeHtml(t('consent.promote', 'Confirm from waitlist')) + '</button> ' +
                  '<button type="button" class="btn btn-ghost consent-cancel-reg-btn" data-sub="' +
                  escapeHtml(s.submissionId || '') + '">' + escapeHtml(t('common.cancel', 'Cancel')) + '</button>'
                : (s.extraData && s.extraData.registrationStatus === 'Confirmed'
                  ? '<button type="button" class="btn btn-ghost consent-cancel-reg-btn" data-sub="' +
                    escapeHtml(s.submissionId || '') + '">' + escapeHtml(t('common.cancel', 'Cancel')) + '</button>'
                  : '')) +
              '</td>' +
              '</tr>';
            }).join('') + '</tbody></table>'
          : '<p class="muted">' + escapeHtml(t('consent.noMatch', 'No submissions match this filter.')) + '</p>';

        const pendingRows = pending.length
          ? '<table class="grades-table"><thead><tr>' +
            '<th>' + escapeHtml(t('consent.col.student', 'Student')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.class', 'Class')) + '</th>' +
            '<th>' + escapeHtml(t('consent.col.status', 'Status')) + '</th></tr></thead><tbody>' +
            pending.map((p) =>
              '<tr>' +
              '<td>' + escapeHtml(p.name) + '</td>' +
              '<td>' + escapeHtml(p.className || p.classId) + '</td>' +
              '<td><span class="error">' + escapeHtml(t('consent.pending', 'Not submitted')) + '</span></td>' +
              '</tr>'
            ).join('') + '</tbody></table>'
          : '<p class="muted">' + escapeHtml(t('consent.nonePending', 'Everyone has submitted.')) + '</p>';

        const clusters = (data.clusters || []).map((c) =>
          '<tr><td>' + escapeHtml(c.apartment) + '</td><td>' + c.count + '</td>' +
          '<td class="muted small">' + escapeHtml((c.students || []).map((s) => s.name).join(', ')) + '</td></tr>'
        ).join('');

        $('consentAnalyticsBody').innerHTML =
          '<div class="consent-stat-row">' +
          '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.stat.audience', 'Audience')) + '</div><strong>' + data.total + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.stat.submitted', 'Submitted')) + '</div><strong>' + data.submittedCount + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.stat.pending', 'Pending')) + '</div><strong>' + data.pendingCount + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.stat.rate', 'Rate')) + '</div><strong>' + data.rate + '%</strong></div>' +
          (data.eventStats
            ? '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.confirmed', 'Confirmed')) + '</div><strong>' + data.eventStats.confirmed +
              (data.eventStats.capacity ? ' / ' + data.eventStats.capacity : '') + '</strong></div>' +
              '<div class="consent-stat"><div class="muted small">' + escapeHtml(t('consent.waiting', 'Waitlist')) + '</div><strong>' + data.eventStats.waiting + '</strong></div>'
            : '') +
          '</div>' +
          '<div class="table-wrap" style="margin-top:1rem"><h4>' + escapeHtml(t('consent.submittedHeading', 'Submitted')) + '</h4>' + submittedRows + '</div>' +
          '<div class="table-wrap" style="margin-top:1rem"><h4>' + escapeHtml(t('consent.pendingHeading', 'Not submitted')) + '</h4>' + pendingRows + '</div>' +
          ((data.form.category === 'BusSurvey' || (data.clusters || []).length)
            ? '<div class="table-wrap" style="margin-top:1rem"><h4>' + escapeHtml(t('consent.clusters', 'Demand clusters (apartment / area)')) + '</h4>' +
              '<table class="grades-table"><thead><tr>' +
              '<th>' + escapeHtml(t('consent.col.area', 'Area')) + '</th>' +
              '<th>' + escapeHtml(t('consent.col.count', 'Count')) + '</th>' +
              '<th>' + escapeHtml(t('consent.col.student', 'Student')) + '</th></tr></thead><tbody>' +
              (clusters || '<tr><td colspan="3" class="muted">' + escapeHtml(t('consent.noData', 'No data')) + '</td></tr>') +
              '</tbody></table></div>'
            : '');

        $('consentAnalyticsBody').querySelectorAll('.consent-promote-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm(t('consent.promoteConfirm', 'Move this waitlist application to confirmed?'))) return;
            try {
              await api('/api/admin/consents/' + encodeURIComponent(formId) + '/promote', {
                method: 'POST',
                body: { submissionId: btn.dataset.sub }
              }, role);
              openAnalytics(formId);
            } catch (e) {
              alert(e.message);
            }
          });
        });
        $('consentAnalyticsBody').querySelectorAll('.consent-cancel-reg-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm(t('consent.cancelRegConfirm', 'Cancel this application / registration?'))) return;
            try {
              await api('/api/admin/consents/' + encodeURIComponent(formId) + '/cancel-registration', {
                method: 'POST',
                body: { submissionId: btn.dataset.sub }
              }, role);
              openAnalytics(formId);
            } catch (e) {
              alert(e.message);
            }
          });
        });
      }

      // Enrich signature flag for display (analytics already has extraData; signature itself not listed for size)
      (data.submitted || []).forEach((s) => {
        if (!s.extraData) s.extraData = {};
      });

      panel.innerHTML =
        '<div class="teacher-panel-head"><div>' +
        '<h3 style="margin:0">' + escapeHtml(data.form.title) + '</h3>' +
        '<p class="muted small" style="margin:0.35rem 0 0">' + escapeHtml(t('consent.publishedOn', 'Published')) + ' ' +
        escapeHtml(String(data.form.publishedAt || '').slice(0, 10)) +
        (data.form.dueDate ? ' · ' + escapeHtml(t('consent.col.due', 'Due')) + ' ' + escapeHtml(data.form.dueDate) : '') +
        '</p></div>' +
        '<div style="display:flex;gap:0.5rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-ghost" id="consentViewFromAnalytics">' +
        escapeHtml(t('consent.viewLetter', 'View letter')) + '</button>' +
        '<button type="button" class="btn btn-primary" id="consentRemindBtn">' +
        escapeHtml(t('consent.remind', 'Remind pending')) + '</button>' +
        '<a class="btn btn-ghost" href="/api/admin/consents/' + encodeURIComponent(formId) + '/print">' +
        escapeHtml(t('consent.printList', 'Print / PDF roster')) + '</a>' +
        '<a class="btn btn-ghost" href="/api/admin/consents/' + encodeURIComponent(formId) + '/clusters.csv">' +
        escapeHtml(t('consent.clusterCsv', 'Cluster CSV')) + '</a>' +
        '<button type="button" class="btn btn-ghost" id="consentAnalyticsClose">' +
        escapeHtml(t('common.close', 'Close')) + '</button>' +
        '</div></div>' +
        '<div class="admin-toolbar" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">' +
        '<input type="search" id="consentFilterQ" placeholder="' +
        escapeHtml(t('consent.searchPh', 'Search student / class')) + '" style="min-width:160px">' +
        '<select id="consentFilterOnly">' +
        '<option value="all">' + escapeHtml(t('consent.filter.all', 'All')) + '</option>' +
        '<option value="pending">' + escapeHtml(t('consent.filter.pending', 'Pending only')) + '</option>' +
        '<option value="submitted">' + escapeHtml(t('consent.filter.submitted', 'Submitted only')) + '</option>' +
        '<option value="agreed">' + escapeHtml(t('consent.filter.agreed', 'Consented / applied')) + '</option>' +
        '<option value="declined">' + escapeHtml(t('consent.filter.declined', 'Declined / not applied')) + '</option>' +
        '</select></div>' +
        '<div id="consentAnalyticsBody"></div>';

      renderTables();

      const qEl = $('consentFilterQ');
      const onlyEl = $('consentFilterOnly');
      if (qEl) qEl.addEventListener('input', () => { filter.q = qEl.value; renderTables(); });
      if (onlyEl) onlyEl.addEventListener('change', () => { filter.only = onlyEl.value; renderTables(); });

      const viewFromAn = $('consentViewFromAnalytics');
      if (viewFromAn) {
        viewFromAn.addEventListener('click', () => openLetterView(formId));
      }
      const remind = $('consentRemindBtn');
      if (remind) {
        remind.addEventListener('click', async () => {
          try {
            const res = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/remind', {
              method: 'POST'
            }, role);
            alert(t('consent.remindSent', 'Reminder sent') + ': ' + (res.sent || 0) +
              (res.reason ? ' (' + res.reason + ')' : ''));
          } catch (e) {
            alert(e.message);
          }
        });
      }
      const closeBtn = $('consentAnalyticsClose');
      if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

      panel.querySelectorAll('a[href*="/api/admin/consents/"]').forEach((a) => {
        a.addEventListener('click', async (e) => {
          e.preventDefault();
          const path = a.getAttribute('href');
          try {
            const token = global.SaltApp.getToken(role);
            const res = await fetch((global.SaltApp.API || '') + path, {
              headers: { Authorization: token ? ('Bearer ' + token) : '' }
            });
            if (!res.ok) throw new Error(t('consent.downloadFail', 'Download failed'));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            if (path.indexOf('print') >= 0) window.open(url, '_blank');
            else {
              const link = document.createElement('a');
              link.href = url;
              link.download = 'clusters.csv';
              link.click();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch (e) {
      panel.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function bindEditor() {
    const tplSel = $('consentTemplateSelect');
    if (tplSel) {
      tplSel.addEventListener('change', () => {
        const tpl = templates.find((x) => x.templateId === tplSel.value);
        if (tpl) setEditorFromTemplate(tpl);
      });
    }
    const deleteTpl = $('consentDeleteTemplateBtn');
    if (deleteTpl) {
      deleteTpl.addEventListener('click', async () => {
        const sel = $('consentTemplateSelect');
        const templateId = sel && sel.value;
        if (!templateId) {
          alert(t('consent.pickToDelete', 'Choose a template to delete first.'));
          return;
        }
        if (!confirm(t('consent.deleteTplConfirm', 'Delete this template? Already published letters are not affected.'))) return;
        try {
          await api('/api/admin/consent-templates/' + encodeURIComponent(templateId), { method: 'DELETE' }, role);
          await loadTemplates();
        } catch (e) {
          alert(e.message);
        }
      });
    }
    const saveTpl = $('consentSaveTemplateBtn');
    if (saveTpl) {
      saveTpl.addEventListener('click', async () => {
        const ed = readEditor();
        try {
          await api('/api/admin/consent-templates', {
            method: 'POST',
            body: {
              title: ed.title + ' (' + t('consent.savedCopy', 'saved copy') + ')',
              category: ed.category,
              contentHtml: ed.contentHtml,
              fieldsJson: ed.fieldsJson,
              isCustomSaved: true
            }
          }, role);
          await loadTemplates();
          alert(t('consent.savedTpl', 'Saved as a custom template. You can load it from the list next time.'));
        } catch (e) {
          alert(e.message);
        }
      });
    }
    const publish = $('consentPublishBtn');
    if (publish) {
      publish.addEventListener('click', async () => {
        const ed = readEditor();
        const err = $('consentEditorError');
        if (err) err.textContent = '';
        if (!ed.title || !ed.contentHtml) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = t('consent.needTitleBody', 'Choose a template and check the title and body.');
          }
          return;
        }
        try {
          const res = await api('/api/admin/consents/publish', {
            method: 'POST',
            body: {
              templateId: ed.templateId,
              category: ed.category,
              title: ed.title,
              contentHtml: ed.contentHtml,
              fieldsJson: ed.fieldsJson,
              targetGrades: ed.targetGrades,
              dueDate: ed.dueDate
            }
          }, role);
          await loadForms();
          showCompose(false);
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = t('consent.publishedOk', 'Published. It now appears on the parent Forms tab.');
          }
          if (res && res.form && res.form.formId) {
            openAnalytics(res.form.formId);
          }
        } catch (e) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = e.message;
          } else alert(e.message);
        }
      });
    }
    document.querySelectorAll('[data-consent-cmd]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.execCommand(btn.dataset.consentCmd, false, null);
        const body = $('consentBody');
        if (body) body.focus();
      });
    });
    document.querySelectorAll('[data-consent-var]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const body = $('consentBody');
        if (!body) return;
        body.focus();
        document.execCommand('insertText', false, btn.dataset.consentVar || '');
      });
    });
    const refresh = $('consentRefreshBtn');
    if (refresh) refresh.addEventListener('click', () => open());
    const newBtn = $('consentNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        const openNow = newBtn.dataset.open === '1';
        hideLetterView();
        showCompose(!openNow);
      });
    }
    const viewClose = $('consentViewCloseBtn');
    if (viewClose) viewClose.addEventListener('click', hideLetterView);
    const viewPrint = $('consentViewPrintBtn');
    if (viewPrint) {
      viewPrint.addEventListener('click', () => {
        document.documentElement.classList.add('printing-consent-letter');
        window.print();
      });
    }
    window.addEventListener('afterprint', () => {
      document.documentElement.classList.remove('printing-consent-letter');
    });
    const viewSubs = $('consentViewSubsBtn');
    if (viewSubs) {
      viewSubs.addEventListener('click', () => {
        const id = ($('consentLetterView') && $('consentLetterView').dataset.formId) || '';
        if (id) openAnalytics(id);
      });
    }
  }

  function syncClassTargets() {
    const sel = $('consentTargets');
    if (!sel) return;
    const cur = sel.value || '*';
    sel.innerHTML = '<option value="*">' + escapeHtml(t('admin.consents.allStudents', 'All enrolled students')) + '</option>' +
      (classes || []).map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name || c.classId) + '</option>'
      ).join('');
    sel.value = cur;
  }

  async function open() {
    syncClassTargets();
    showCompose(false);
    hideLetterView();
    const listErr = [];
    await Promise.all([
      loadTemplates().catch((e) => { listErr.push(e.message); }),
      loadForms().catch((e) => { listErr.push(e.message); })
    ]);
    if (listErr.length) {
      const box = $('consentFormsList');
      if (box && /Loading|불러/.test(box.textContent || '')) {
        box.innerHTML = '<p class="error">' + escapeHtml(listErr.join(' · ')) + '</p>';
      }
    }
  }

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    role = opts.role || 'admin';
    $ = opts.$;
    classes = opts.classes || [];
    bindEditor();
  }

  function setClasses(list) {
    classes = list || [];
    syncClassTargets();
  }

  global.SaltConsentAdmin = { init, open, setClasses };
})(window);
