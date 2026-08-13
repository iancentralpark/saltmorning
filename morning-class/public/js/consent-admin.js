/* Admin Consents — templates, publish, analytics, remind */
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

  function setEditorFromTemplate(tpl) {
    editorState.templateId = tpl.templateId || '';
    editorState.category = tpl.category || 'General';
    editorState.title = tpl.title || '';
    editorState.contentHtml = tpl.contentHtml || '';
    editorState.fieldsJson = tpl.fieldsJson || {};
    const titleEl = $('consentTitle');
    const bodyEl = $('consentBody');
    const catEl = $('consentCategory');
    if (titleEl) titleEl.value = editorState.title;
    if (bodyEl) bodyEl.innerHTML = editorState.contentHtml;
    if (catEl) catEl.value = editorState.category;
  }

  function readEditor() {
    editorState.title = ($('consentTitle') && $('consentTitle').value) || '';
    editorState.contentHtml = ($('consentBody') && $('consentBody').innerHTML) || '';
    editorState.category = ($('consentCategory') && $('consentCategory').value) || editorState.category;
    editorState.targetGrades = ($('consentTargets') && $('consentTargets').value) || '*';
    editorState.dueDate = ($('consentDue') && $('consentDue').value) || '';
    return editorState;
  }

  async function loadTemplates() {
    const data = await api('/api/admin/consent-templates', {}, role);
    templates = data.templates || [];
    const sel = $('consentTemplateSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">' + escapeHtml(t('consent.pickTemplate', 'Select a template…')) + '</option>' +
      templates.map((tpl) =>
        '<option value="' + escapeHtml(tpl.templateId) + '">' +
        escapeHtml(tpl.title) + (tpl.isCustomSaved ? ' ★' : '') +
        '</option>'
      ).join('');
  }

  async function loadForms() {
    const data = await api('/api/admin/consents', {}, role);
    forms = data.forms || [];
    const box = $('consentFormsList');
    if (!box) return;
    if (!forms.length) {
      box.innerHTML = '<p class="muted">' + escapeHtml(t('consent.noForms', 'No published forms yet.')) + '</p>';
      return;
    }
    box.innerHTML = '<table class="grades-table"><thead><tr>' +
      '<th>Title</th><th>Category</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>' +
      forms.map((f) =>
        '<tr>' +
        '<td>' + escapeHtml(f.title) + '</td>' +
        '<td>' + escapeHtml(f.category) + '</td>' +
        '<td>' + escapeHtml(f.dueDate || '—') + '</td>' +
        '<td>' + escapeHtml(f.status) + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button type="button" class="btn btn-ghost" data-consent-analytics="' + escapeHtml(f.formId) + '">Track</button> ' +
        (f.status === 'Active'
          ? '<button type="button" class="btn btn-ghost" data-consent-close="' + escapeHtml(f.formId) + '">Close</button>'
          : '') +
        '</td></tr>'
      ).join('') +
      '</tbody></table>';

    box.querySelectorAll('[data-consent-analytics]').forEach((btn) => {
      btn.addEventListener('click', () => openAnalytics(btn.dataset.consentAnalytics));
    });
    box.querySelectorAll('[data-consent-close]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Close this form? Parents will no longer be able to submit.')) return;
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
  }

  async function openAnalytics(formId) {
    activeFormId = formId;
    const panel = $('consentAnalytics');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/analytics', {}, role);
      const clusters = (data.clusters || []).map((c) =>
        '<tr><td>' + escapeHtml(c.apartment) + '</td><td>' + c.count + '</td>' +
        '<td class="muted small">' + escapeHtml((c.students || []).map((s) => s.name).join(', ')) + '</td></tr>'
      ).join('');
      panel.innerHTML =
        '<div class="teacher-panel-head"><div>' +
        '<h3 style="margin:0">' + escapeHtml(data.form.title) + '</h3>' +
        '<p class="muted small" style="margin:0.35rem 0 0">Submitted ' +
        data.submittedCount + ' / ' + data.total + ' (' + data.rate + '%)</p></div>' +
        '<div style="display:flex;gap:0.5rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-primary" id="consentRemindBtn">Remind pending</button>' +
        '<a class="btn btn-ghost" target="_blank" href="/api/admin/consents/' + encodeURIComponent(formId) +
        '/print">Print roster</a>' +
        '<a class="btn btn-ghost" href="/api/admin/consents/' + encodeURIComponent(formId) +
        '/clusters.csv">Clusters CSV</a>' +
        '<button type="button" class="btn btn-ghost" id="consentAnalyticsClose">Close</button>' +
        '</div></div>' +
        '<div class="table-wrap" style="margin-top:1rem"><h4>Pending</h4>' +
        ((data.pending || []).length
          ? '<table class="grades-table"><thead><tr><th>Student</th><th>Class</th></tr></thead><tbody>' +
            data.pending.map((p) =>
              '<tr><td>' + escapeHtml(p.name) + '</td><td>' + escapeHtml(p.className || p.classId) + '</td></tr>'
            ).join('') + '</tbody></table>'
          : '<p class="muted">None pending.</p>') +
        '</div>' +
        ((data.form.category === 'BusSurvey' || (data.clusters || []).length)
          ? '<div class="table-wrap" style="margin-top:1rem"><h4>Demand clusters</h4>' +
            '<table class="grades-table"><thead><tr><th>Apartment / area</th><th>Count</th><th>Students</th></tr></thead><tbody>' +
            (clusters || '<tr><td colspan="3" class="muted">No cluster data</td></tr>') +
            '</tbody></table></div>'
          : '');

      const remind = $('consentRemindBtn');
      if (remind) {
        remind.addEventListener('click', async () => {
          try {
            const res = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/remind', {
              method: 'POST'
            }, role);
            alert('Reminders sent: ' + (res.sent || 0));
          } catch (e) {
            alert(e.message);
          }
        });
      }
      const closeBtn = $('consentAnalyticsClose');
      if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

      // Attach auth token for print/csv links via fetch-open
      panel.querySelectorAll('a[href*="/api/admin/consents/"]').forEach((a) => {
        a.addEventListener('click', async (e) => {
          e.preventDefault();
          const path = a.getAttribute('href');
          try {
            const token = global.SaltApp.getToken(role);
            const res = await fetch((global.SaltApp.API || '') + path, {
              headers: { Authorization: token ? ('Bearer ' + token) : '' }
            });
            if (!res.ok) throw new Error('Download failed');
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
    const saveTpl = $('consentSaveTemplateBtn');
    if (saveTpl) {
      saveTpl.addEventListener('click', async () => {
        const ed = readEditor();
        try {
          await api('/api/admin/consent-templates', {
            method: 'POST',
            body: {
              title: ed.title + ' (saved)',
              category: ed.category,
              contentHtml: ed.contentHtml,
              fieldsJson: ed.fieldsJson,
              isCustomSaved: true
            }
          }, role);
          await loadTemplates();
          alert('Saved as custom template.');
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
        try {
          await api('/api/admin/consents/publish', {
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
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = 'Published. Parents will see it under Consents.';
          }
        } catch (e) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = e.message;
          } else alert(e.message);
        }
      });
    }
    // Basic formatting
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
    const catEl = $('consentCategory');
    if (catEl) {
      catEl.addEventListener('change', () => {
        editorState.category = catEl.value || 'General';
      });
    }
    const refresh = $('consentRefreshBtn');
    if (refresh) refresh.addEventListener('click', () => open().catch((e) => alert(e.message)));
  }

  function syncClassTargets() {
    const sel = $('consentTargets');
    if (!sel) return;
    const cur = sel.value || '*';
    sel.innerHTML = '<option value="*">All enrolled students</option>' +
      (classes || []).map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name || c.classId) + '</option>'
      ).join('');
    sel.value = cur;
  }

  async function open() {
    syncClassTargets();
    await Promise.all([loadTemplates(), loadForms()]);
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
