/**
 * Google Drive picker + Forms helpers for teacher homework.
 */
(function(global) {
  let deps = null;
  let config = null;
  let status = null;
  let pickerLoaded = false;
  let pickerLoading = null;
  let pendingReturnTo = '';

  const pickState = {
    googleFormId: '',
    googleDriveFileId: '',
    assignmentType: '',
    attachmentName: '',
    linkUrl: '',
    webViewLink: ''
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensurePicker() {
    if (pickerLoaded) return;
    if (pickerLoading) return pickerLoading;
    pickerLoading = (async () => {
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((resolve, reject) => {
        global.gapi.load('picker', { callback: resolve, onerror: reject });
      });
      pickerLoaded = true;
    })();
    return pickerLoading;
  }

  function clearPick() {
    pickState.googleFormId = '';
    pickState.googleDriveFileId = '';
    pickState.assignmentType = '';
    pickState.attachmentName = '';
    pickState.linkUrl = '';
    pickState.webViewLink = '';
    renderPickSummary();
  }

  function renderPickSummary() {
    const box = deps.$('hwGooglePickSummary');
    if (!box) return;
    if (!pickState.googleFormId && !pickState.googleDriveFileId) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    let html = '<div class="hw-google-pick">';
    if (pickState.assignmentType === 'quiz') {
      html += '<span class="hw-google-badge"><i class="fa-solid fa-circle-question"></i> Quiz</span>';
    } else if (pickState.assignmentType === 'assignment' && pickState.googleFormId) {
      html += '<span class="hw-google-badge"><i class="fa-solid fa-list-check"></i> Form</span>';
    } else if (pickState.googleDriveFileId) {
      html += '<span class="hw-google-badge"><i class="fa-brands fa-google-drive"></i> Drive</span>';
    }
    html += '<span>' + deps.escapeHtml(pickState.attachmentName || 'Attached') + '</span> ';
    html += '<button type="button" class="btn btn-ghost" id="hwGooglePickClear">Remove</button>';
    html += '</div>';
    box.innerHTML = html;
    box.classList.remove('hidden');
    const btn = deps.$('hwGooglePickClear');
    if (btn) btn.addEventListener('click', clearPick);
  }

  function applyPick(data) {
    pickState.googleFormId = data.formId || '';
    pickState.googleDriveFileId = data.fileId || '';
    pickState.attachmentName = data.name || data.title || 'Google attachment';
    pickState.linkUrl = data.responderUri || data.webViewLink || '';
    pickState.webViewLink = data.webViewLink || '';
    if (data.isQuiz) pickState.assignmentType = 'quiz';
    else if (pickState.googleFormId) pickState.assignmentType = 'assignment';
    else pickState.assignmentType = '';
    if (pickState.linkUrl && deps.$('hwComposeLink')) {
      deps.$('hwComposeLink').value = pickState.linkUrl;
    }
    renderPickSummary();
  }

  function getFormExtras() {
    return {
      googleFormId: pickState.googleFormId,
      googleDriveFileId: pickState.googleDriveFileId,
      assignmentType: pickState.assignmentType,
      linkUrl: pickState.linkUrl || (deps.$('hwComposeLink') && deps.$('hwComposeLink').value.trim()) || '',
      driveWebLink: pickState.webViewLink || '',
      driveAttachmentName: pickState.attachmentName || ''
    };
  }

  async function loadConfig() {
    config = await deps.api('/api/teacher/google/config', {}, deps.role);
    status = await deps.api('/api/teacher/google/status', {}, deps.role);
    return { config, status };
  }

  function renderBar() {
    const bar = deps.$('hwGoogleBar');
    if (!bar) return;
    if (!status || !status.configured) {
      bar.innerHTML =
        '<p class="muted small" style="margin:0;text-align:center">' +
        'Google Drive &amp; Forms: OAuth not configured on server. You can still paste links or upload files.' +
        '</p>';
      bar.classList.remove('hidden');
      return;
    }
    if (!status.linked) {
      bar.innerHTML =
        '<div class="hw-google-connect">' +
          '<div class="hw-google-connect-copy">' +
            '<span class="hw-google-account-icon"><i class="fa-brands fa-google" aria-hidden="true"></i></span>' +
            '<p class="muted small">Connect Google to attach Drive files or create Forms &amp; quizzes.</p>' +
          '</div>' +
          '<button type="button" class="btn btn-primary hw-google-connect-btn" id="hwGoogleConnectBtn">' +
            '<i class="fa-brands fa-google" aria-hidden="true"></i> Connect Google' +
          '</button>' +
        '</div>';
      bar.classList.remove('hidden');
      const btn = deps.$('hwGoogleConnectBtn');
      if (btn) {
        btn.addEventListener('click', async () => {
          const returnTo = deps.getReturnTo ? deps.getReturnTo() : 'homework';
          try {
            const data = await deps.api(
              '/api/teacher/google/connect-url?returnTo=' + encodeURIComponent(returnTo),
              {},
              deps.role
            );
            if (data && data.url) global.location.href = data.url;
          } catch (e) {
            const err = deps.$('hwComposeError');
            if (err) err.textContent = e.message;
          }
        });
      }
      return;
    }
    bar.innerHTML =
      '<div class="hw-google-tools">' +
        '<div class="hw-google-account">' +
          '<span class="hw-google-account-icon"><i class="fa-brands fa-google" aria-hidden="true"></i></span>' +
          '<span class="hw-google-email" title="' + deps.escapeHtml(status.email || '') + '">' +
            deps.escapeHtml(status.email || 'Google connected') +
          '</span>' +
        '</div>' +
        '<div class="hw-google-actions">' +
          '<button type="button" class="hw-google-chip hw-google-chip--drive" id="hwGoogleDriveBtn">' +
            '<i class="fa-brands fa-google-drive" aria-hidden="true"></i> Drive' +
          '</button>' +
          '<button type="button" class="hw-google-chip hw-google-chip--form" id="hwGoogleFormBtn">' +
            '<i class="fa-solid fa-list-check" aria-hidden="true"></i> New Form' +
          '</button>' +
          '<button type="button" class="hw-google-chip hw-google-chip--quiz" id="hwGoogleQuizBtn">' +
            '<i class="fa-solid fa-circle-question" aria-hidden="true"></i> New Quiz' +
          '</button>' +
          '<button type="button" class="hw-google-chip hw-google-chip--muted" id="hwGoogleDisconnectBtn">' +
            '<i class="fa-solid fa-link-slash" aria-hidden="true"></i> Disconnect' +
          '</button>' +
        '</div>' +
      '</div>';
    bar.classList.remove('hidden');
    deps.$('hwGoogleDriveBtn').addEventListener('click', () => openDrivePicker());
    deps.$('hwGoogleFormBtn').addEventListener('click', () => createForm(false));
    deps.$('hwGoogleQuizBtn').addEventListener('click', () => createForm(true));
    deps.$('hwGoogleDisconnectBtn').addEventListener('click', disconnect);
  }

  async function refreshBar() {
    await loadConfig();
    renderBar();
  }

  async function disconnect() {
    if (!confirm('Disconnect Google account from Salt Morning?')) return;
    await deps.api('/api/teacher/google/disconnect', { method: 'POST' }, deps.role);
    clearPick();
    await refreshBar();
  }

  async function openDrivePicker() {
    const err = deps.$('hwComposeError');
    if (err) err.textContent = '';
    if (!config || !config.clientId || !config.apiKey) {
      if (err) err.textContent = 'Google Picker needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_API_KEY on the server.';
      return;
    }
    try {
      await ensurePicker();
      const tokenData = await deps.api('/api/teacher/google/access-token', {}, deps.role);
      const docsView = new global.google.picker.DocsView()
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);
      const formsView = new global.google.picker.DocsView(global.google.picker.ViewId.FORMS)
        .setIncludeFolders(false);
      const builder = new global.google.picker.PickerBuilder()
        .setDeveloperKey(config.apiKey)
        .setOAuthToken(tokenData.accessToken);
      if (config.appId) builder.setAppId(config.appId);
      const picker = builder
        .addView(docsView)
        .addView(formsView)
        .setCallback(pickerCallback)
        .build();
      picker.setVisible(true);
    } catch (e) {
      if (err) err.textContent = e.message;
    }
  }

  async function pickerCallback(data) {
    if (!data || data.action !== global.google.picker.Action.PICKED) return;
    const doc = data.docs && data.docs[0];
    if (!doc || !doc.id) return;
    const err = deps.$('hwComposeError');
    try {
      const shared = await deps.api('/api/teacher/google/drive/share', {
        method: 'POST',
        body: { fileId: doc.id }
      }, deps.role);
      applyPick({
        fileId: shared.fileId,
        formId: shared.formId || (shared.isForm ? shared.fileId : ''),
        name: shared.name || doc.name,
        responderUri: shared.responderUri,
        webViewLink: shared.webViewLink,
        isQuiz: false
      });
    } catch (e) {
      if (err) err.textContent = e.message;
    }
  }

  async function createForm(isQuiz) {
    const err = deps.$('hwComposeError');
    if (err) err.textContent = '';
    const title = (deps.$('hwComposeTitle') && deps.$('hwComposeTitle').value.trim()) || 'Homework';
    const description = (deps.$('hwComposeDesc') && deps.$('hwComposeDesc').value.trim()) || '';
    try {
      const form = await deps.api('/api/teacher/google/forms/create', {
        method: 'POST',
        body: { title, description, isQuiz: !!isQuiz }
      }, deps.role);
      applyPick({
        formId: form.formId,
        fileId: form.formId,
        name: form.title,
        responderUri: form.responderUri,
        isQuiz: !!isQuiz
      });
      if (deps.$('hwComposeTitle') && !deps.$('hwComposeTitle').value.trim()) {
        deps.$('hwComposeTitle').value = form.title;
      }
      if (form.editUri) {
        global.open(form.editUri, '_blank', 'noopener');
      }
    } catch (e) {
      if (err) err.textContent = e.message;
    }
  }

  function init(options) {
    deps = options;
    const params = new URLSearchParams(global.location.search);
    if (params.get('google') === 'connected') {
      pendingReturnTo = params.get('returnTo') || '';
      params.delete('google');
      params.delete('returnTo');
      params.delete('msg');
      const next = global.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
      global.history.replaceState({}, '', next);
    } else if (params.get('google') === 'error') {
      const msg = params.get('msg') || 'Google sign-in failed.';
      params.delete('google');
      params.delete('msg');
      params.delete('returnTo');
      const next = global.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
      global.history.replaceState({}, '', next);
      const err = deps.$('hwComposeError');
      if (err) err.textContent = decodeURIComponent(msg);
    }
  }

  async function handlePendingReturn(handlers) {
    if (!pendingReturnTo) return;
    const rt = pendingReturnTo;
    pendingReturnTo = '';
    if (rt.indexOf('class:') === 0) {
      const parts = rt.split(':');
      if (parts[1] && handlers && handlers.onReturnToClass) {
        await handlers.onReturnToClass(parts[1], parts[2] || 'homework');
      }
    }
  }

  global.SaltGoogleHomework = {
    init,
    refreshBar,
    clearPick,
    getFormExtras,
    renderPickSummary,
    handlePendingReturn
  };
})(window);
