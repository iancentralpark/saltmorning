(function (global) {
  const { api, escapeHtml, getToken } = global.SaltApp;

  let role = '';
  let open = false;
  let view = 'threads'; // 'threads' (list shell) | 'chat'
  let listTab = 'chats'; // 'contacts' | 'chats' (parent Kakao-style)
  let threads = [];
  let activeThread = null;
  let messages = [];
  let pollTimer = null;
  let socket = null;
  let joinedThread = null;
  let socketReady = false;
  let directoryTimer = null;
  let directoryResults = [];
  let directoryQuery = '';
  let directorySearching = false;
  let quickContacts = [];

  function usesContactTabs() {
    return isParentRole();
  }

  function tabLabels() {
    const ko = global.SaltI18n && SaltI18n.getLang() === 'ko';
    return {
      contacts: ko ? '연락처' : 'Contacts',
      chats: ko ? '채팅' : 'Chats',
      emptyContacts: ko ? '연락처가 없습니다.' : 'No contacts yet.',
      emptyChats: ko ? '아직 대화가 없습니다.' : 'No conversations yet.',
      schoolOffice: ko ? '학교 사무실' : 'School office',
      homeroom: ko ? '담임' : 'Homeroom',
      teacher: ko ? '교사' : 'Teacher',
      messages: ko ? '메시지' : 'Messages'
    };
  }

  /** messageId → { original, translated, targetLang, error? } */
  const translationCache = Object.create(null);
  /** messageIds currently showing original while auto-translate is on */
  const showOriginalIds = new Set();
  /** messageIds manually requested for translation while Auto Translate is off */
  const manualShowTranslated = new Set();
  /** in-flight translate promises by messageId */
  const translateInFlight = Object.create(null);
  /** threadId → bool auto-translate preference */
  const autoTranslateByThread = Object.create(null);
  /** Prevent overlapping ensureTranslationsForThread loops */
  let translatingThreadId = null;
  const TRANSLATE_CONCURRENCY = 2;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (e) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function senderLabel(m) {
    if (m.senderName) return m.senderName;
    const map = { student: 'Student', parent: 'Parent', teacher: 'Teacher', admin: 'Admin' };
    return map[m.senderRole] || m.senderRole || 'User';
  }

  function isMine(m) {
    return m.senderRole === role;
  }

  function isParentRole() {
    return role === 'parent';
  }

  function targetLangForRole() {
    return isParentRole() ? 'ko' : 'en';
  }

  function labels() {
    if (isParentRole()) {
      return {
        auto: 'Auto Translate',
        translate: '번역',
        showOriginal: '원본보기',
        showTranslation: '번역보기',
        translating: '번역 중…',
        failed: '번역 실패'
      };
    }
    return {
      auto: 'Auto Translate',
      translate: 'Translate',
      showOriginal: 'Show original',
      showTranslation: 'Show translation',
      translating: 'Translating…',
      failed: 'Translate failed'
    };
  }

  function storageKey(threadId) {
    return 'salt-msg-auto-tr:' + role + ':' + threadId;
  }

  function getAutoTranslate(threadId) {
    if (!threadId) return false;
    if (Object.prototype.hasOwnProperty.call(autoTranslateByThread, threadId)) {
      return !!autoTranslateByThread[threadId];
    }
    try {
      const raw = localStorage.getItem(storageKey(threadId));
      autoTranslateByThread[threadId] = raw === '1';
    } catch (e) {
      autoTranslateByThread[threadId] = false;
    }
    return !!autoTranslateByThread[threadId];
  }

  function setAutoTranslate(threadId, on) {
    autoTranslateByThread[threadId] = !!on;
    try {
      localStorage.setItem(storageKey(threadId), on ? '1' : '0');
    } catch (e) { /* ignore */ }
  }

  function canAutoTranslateRole() {
    return role === 'parent' || role === 'teacher' || role === 'admin';
  }

  function isTranslatableMessage(m) {
    if (!m || isMine(m)) return false;
    if (!canAutoTranslateRole()) return false;
    if (role === 'parent') return m.senderRole === 'teacher' || m.senderRole === 'admin';
    if (role === 'teacher' || role === 'admin') {
      return m.senderRole === 'parent' || m.senderRole === 'student';
    }
    return false;
  }

  function root() {
    return document.getElementById('saltMessenger');
  }

  function isAdminRole() {
    return role === 'admin';
  }

  function renderFab(unread) {
    const fab = root().querySelector('.msg-fab');
    const badge = root().querySelector('.msg-fab-badge');
    if (!fab) return;
    badge.textContent = unread > 99 ? '99+' : String(unread || '');
    badge.classList.toggle('hidden', !unread);
  }

  function renderDirectoryResults() {
    const box = root() && root().querySelector('.msg-directory-results');
    if (!box || !isAdminRole()) return;
    if (!directoryQuery) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    if (directorySearching) {
      box.innerHTML = '<p class="msg-empty small">Searching…</p>';
      return;
    }
    if (!directoryResults.length) {
      box.innerHTML = '<p class="msg-empty small">No people found.</p>';
      return;
    }
    const typeLabel = { teacher: 'Teacher', parent: 'Parent', student: 'Student' };
    box.innerHTML = directoryResults.map((hit) =>
      '<button type="button" class="msg-directory-item" data-tid="' + escapeHtml(hit.threadId) + '">' +
      '<div class="msg-thread-top">' +
      '<strong>' + escapeHtml(hit.name) + '</strong>' +
      '<span class="msg-person-type">' + escapeHtml(typeLabel[hit.personType] || hit.personType) + '</span>' +
      '</div>' +
      '<div class="msg-thread-sub">' + escapeHtml(hit.subtitle || '') + '</div>' +
      '</button>'
    ).join('');
    box.querySelectorAll('.msg-directory-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hit = directoryResults.find((h) => h.threadId === btn.dataset.tid);
        if (!hit) return;
        openThreadWithMeta({
          threadId: hit.threadId,
          threadType: hit.threadType,
          title: hit.name,
          subtitle: hit.subtitle || '',
          classId: hit.classId || '',
          studentId: hit.studentId || '',
          studentName: hit.studentName || '',
          teacherId: hit.personType === 'teacher' ? hit.id : '',
          parentId: hit.personType === 'parent' ? hit.id : '',
          personType: hit.personType,
          unread: 0
        });
        clearDirectorySearch();
      });
    });
  }

  function clearDirectorySearch() {
    directoryQuery = '';
    directoryResults = [];
    directorySearching = false;
    const input = root() && root().querySelector('.msg-directory-input');
    if (input) input.value = '';
    renderDirectoryResults();
  }

  function scheduleDirectorySearch(q) {
    directoryQuery = String(q || '').trim();
    if (directoryTimer) clearTimeout(directoryTimer);
    if (!directoryQuery) {
      directoryResults = [];
      directorySearching = false;
      renderDirectoryResults();
      return;
    }
    directorySearching = true;
    renderDirectoryResults();
    directoryTimer = setTimeout(async () => {
      const qNow = directoryQuery;
      try {
        const data = await api(
          '/api/messenger/directory?q=' + encodeURIComponent(qNow),
          {},
          role
        );
        if (directoryQuery !== qNow) return;
        directoryResults = data.results || [];
      } catch (e) {
        if (directoryQuery !== qNow) return;
        directoryResults = [];
      }
      directorySearching = false;
      renderDirectoryResults();
    }, 220);
  }

  function renderThreads() {
    const list = root().querySelector('.msg-thread-list');
    if (!list) return;
    const L = tabLabels();
    if (!threads.length) {
      list.innerHTML = '<p class="msg-empty">' + escapeHtml(L.emptyChats) +
        (isAdminRole() ? ' Search above to message someone.' : '') + '</p>';
      return;
    }
    list.innerHTML = threads.map((t) => {
      const preview = t.lastMessage ? escapeHtml(t.lastMessage) : '<span class="muted">No messages yet</span>';
      const badge = t.unread ? '<span class="msg-thread-unread">' + t.unread + '</span>' : '';
      const initial = String(t.title || '?').trim().charAt(0).toUpperCase() || '?';
      return (
        '<button type="button" class="msg-thread-item" data-tid="' + escapeHtml(t.threadId) + '">' +
        '<div class="msg-avatar" aria-hidden="true">' + escapeHtml(initial) + '</div>' +
        '<div class="msg-thread-main">' +
        '<div class="msg-thread-top">' +
        '<strong>' + escapeHtml(t.title) + '</strong>' +
        badge +
        '</div>' +
        '<div class="msg-thread-sub">' + escapeHtml(t.subtitle || '') + '</div>' +
        '<div class="msg-thread-preview">' + preview + '</div>' +
        '</div>' +
        '</button>'
      );
    }).join('');

    list.querySelectorAll('.msg-thread-item').forEach((btn) => {
      btn.addEventListener('click', () => openThread(btn.dataset.tid));
    });
  }

  function renderContactsList() {
    const box = root() && root().querySelector('.msg-contact-list');
    if (!box) return;
    const L = tabLabels();
    if (!usesContactTabs()) {
      box.innerHTML = '';
      return;
    }
    const rows = [];
    rows.push({
      admin: true,
      name: 'Salt Admin',
      subtitle: L.schoolOffice,
      initial: 'A'
    });
    (quickContacts || []).forEach((t) => {
      const name = t.name || t.teacherId || '';
      rows.push({
        teacherId: t.teacherId,
        name,
        subtitle: t.isHomeroom ? L.homeroom : ((t.subjects || []).slice(0, 2).join(', ') || L.teacher),
        initial: String(name || '?').trim().charAt(0).toUpperCase() || '?'
      });
    });
    if (!rows.length) {
      box.innerHTML = '<p class="msg-empty">' + escapeHtml(L.emptyContacts) + '</p>';
      return;
    }
    box.innerHTML = rows.map((r) =>
      '<button type="button" class="msg-contact-item"' +
        (r.admin ? ' data-admin="1"' : ' data-tid="' + escapeHtml(r.teacherId) + '"') + '>' +
        '<div class="msg-avatar" aria-hidden="true">' + escapeHtml(r.initial) + '</div>' +
        '<div class="msg-contact-main">' +
          '<strong>' + escapeHtml(r.name) + '</strong>' +
          '<span>' + escapeHtml(r.subtitle) + '</span>' +
        '</div>' +
      '</button>'
    ).join('');
    box.querySelectorAll('.msg-contact-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.admin === '1') openThreadForAdmin();
        else openThreadForTeacher(btn.dataset.tid);
      });
    });
  }

  function syncListTabs() {
    const wrap = root();
    if (!wrap) return;
    const tabs = wrap.querySelector('.msg-list-tabs');
    const contactsPane = wrap.querySelector('.msg-view-contacts');
    const chatsPane = wrap.querySelector('.msg-view-chats');
    const showTabs = usesContactTabs();
    if (tabs) tabs.classList.toggle('hidden', !showTabs);
    if (!showTabs) listTab = 'chats';

    const L = tabLabels();
    const contactsBtn = wrap.querySelector('[data-list-tab="contacts"]');
    const chatsBtn = wrap.querySelector('[data-list-tab="chats"]');
    if (contactsBtn) {
      contactsBtn.textContent = L.contacts;
      contactsBtn.classList.toggle('is-active', listTab === 'contacts');
    }
    if (chatsBtn) {
      chatsBtn.textContent = L.chats;
      chatsBtn.classList.toggle('is-active', listTab === 'chats');
    }
    if (contactsPane) contactsPane.classList.toggle('hidden', listTab !== 'contacts');
    if (chatsPane) chatsPane.classList.toggle('hidden', listTab !== 'chats');

    const title = wrap.querySelector('.msg-panel-title');
    if (title) title.textContent = L.messages;
  }

  function setListTab(tab) {
    listTab = tab === 'contacts' ? 'contacts' : 'chats';
    syncListTabs();
    if (listTab === 'contacts') renderContactsList();
    else renderThreads();
  }

  function setQuickContacts(teachers) {
    quickContacts = Array.isArray(teachers) ? teachers.slice() : [];
    if (root()) {
      syncListTabs();
      if (listTab === 'contacts') renderContactsList();
    }
  }

  function displayBodyForMessage(m, autoOn) {
    const original = String(m.body || '');
    if (!isTranslatableMessage(m)) {
      return { text: original, mode: 'original', toggle: null };
    }

    const wantTranslated = autoOn || manualShowTranslated.has(m.messageId);
    const cached = translationCache[m.messageId];
    const showOrig = showOriginalIds.has(m.messageId);
    const L = labels();

    if (!wantTranslated) {
      return { text: original, mode: 'original', toggle: 'translate' };
    }
    if (showOrig) {
      return { text: original, mode: 'original', toggle: 'translation' };
    }
    if (cached && cached.translated) {
      return { text: cached.translated, mode: 'translated', toggle: 'original' };
    }
    if (cached && cached.error) {
      return { text: original, mode: 'original', toggle: 'translate', error: cached.error };
    }
    if (translateInFlight[m.messageId]) {
      return { text: L.translating, mode: 'pending', toggle: null };
    }
    return { text: L.translating, mode: 'pending', toggle: null };
  }

  function renderChat() {
    const head = root().querySelector('.msg-chat-head');
    const body = root().querySelector('.msg-chat-body');
    if (!head || !body || !activeThread) return;

    const L = labels();
    const autoOn = canAutoTranslateRole() && getAutoTranslate(activeThread.threadId);
    const showToggle = canAutoTranslateRole();

    head.innerHTML =
      '<button type="button" class="btn btn-ghost msg-back-btn" aria-label="Back">‹</button>' +
      '<div class="msg-chat-title">' +
      '<strong>' + escapeHtml(activeThread.title) + '</strong>' +
      '<span>' + escapeHtml(activeThread.subtitle || '') + '</span>' +
      '</div>' +
      (showToggle
        ? '<label class="msg-auto-tr" title="' + escapeHtml(L.auto) + '">' +
          '<span class="msg-auto-tr-label">' + escapeHtml(L.auto) + '</span>' +
          '<input type="checkbox" class="msg-auto-tr-input" ' + (autoOn ? 'checked' : '') + '>' +
          '<span class="msg-auto-tr-switch" aria-hidden="true"></span>' +
          '</label>'
        : '');

    head.querySelector('.msg-back-btn').addEventListener('click', () => {
      leaveThreadRoom();
      view = 'threads';
      activeThread = null;
      messages = [];
      showOriginalIds.clear();
      manualShowTranslated.clear();
      updatePanel();
      refreshThreads();
    });

    const autoInput = head.querySelector('.msg-auto-tr-input');
    if (autoInput) {
      autoInput.addEventListener('change', () => {
        setAutoTranslate(activeThread.threadId, autoInput.checked);
        showOriginalIds.clear();
        if (autoInput.checked) {
          messages.forEach((m) => {
            const c = translationCache[m.messageId];
            if (c && c.error) delete translationCache[m.messageId];
          });
        }
        renderChat();
      });
    }

    if (!messages.length) {
      let emptyHint = 'Say hello — send your first message.';
      if (activeThread.threadType === 'admin' || activeThread.threadType === 'parent_admin') {
        emptyHint = 'Say hello — message the school office.';
      } else if (role === 'admin') {
        emptyHint = 'Say hello — start the conversation.';
      } else if (role === 'student' || role === 'parent') {
        emptyHint = 'Say hello — your message goes to the teacher.';
      }
      body.innerHTML = '<p class="msg-empty">' + emptyHint + '</p>';
    } else {
      body.innerHTML = messages.map((m) => {
        const cls = isMine(m) ? 'msg-bubble mine' : 'msg-bubble theirs';
        const disp = displayBodyForMessage(m, autoOn);
        let footer = '';
        if (disp.toggle === 'translate') {
          footer = '<button type="button" class="msg-orig-toggle msg-translate-btn" data-mid="' +
            escapeHtml(m.messageId) + '" data-action="translate">' + escapeHtml(L.translate) + '</button>';
        } else if (disp.toggle === 'original') {
          footer = '<button type="button" class="msg-orig-toggle" data-mid="' +
            escapeHtml(m.messageId) + '" data-action="original">' + escapeHtml(L.showOriginal) + '</button>';
        } else if (disp.toggle === 'translation') {
          footer = '<button type="button" class="msg-orig-toggle" data-mid="' +
            escapeHtml(m.messageId) + '" data-action="translation">' + escapeHtml(L.showTranslation) + '</button>';
        }
        if (disp.error) {
          footer += '<div class="msg-tr-error muted small">' + escapeHtml(disp.error) + '</div>';
        }
        const modeCls = disp.mode === 'translated' ? ' msg-showing-tr' :
          (disp.mode === 'pending' ? ' msg-showing-pending' : '');
        return (
          '<div class="' + cls + modeCls + '" data-mid="' + escapeHtml(m.messageId) + '">' +
          '<div class="msg-bubble-meta">' + escapeHtml(senderLabel(m)) + ' · ' + escapeHtml(formatTime(m.createdAt)) + '</div>' +
          '<div class="msg-bubble-text">' + escapeHtml(disp.text) + '</div>' +
          footer +
          '</div>'
        );
      }).join('');

      body.querySelectorAll('.msg-orig-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mid = btn.dataset.mid;
          const action = btn.dataset.action;
          if (action === 'original') {
            showOriginalIds.add(mid);
            renderChat();
            return;
          }
          if (action === 'translation') {
            showOriginalIds.delete(mid);
            renderChat();
            return;
          }
          if (action === 'translate') {
            const msg = messages.find((x) => x.messageId === mid);
            if (!msg) return;
            manualShowTranslated.add(mid);
            showOriginalIds.delete(mid);
            const prev = translationCache[mid];
            if (prev && prev.error) delete translationCache[mid];
            renderChat();
            translateOne(msg).then(() => {
              if (view === 'chat' && activeThread) renderChat();
            });
          }
        });
      });
    }
    body.scrollTop = body.scrollHeight;

    if (autoOn) ensureTranslationsForThread();
  }

  async function translateOne(message) {
    const mid = message.messageId;
    const text = String(message.body || '').trim();
    if (!mid || !text) return null;
    if (translationCache[mid] && translationCache[mid].translated) return translationCache[mid];
    if (translationCache[mid] && translationCache[mid].error) {
      const until = translationCache[mid].retryAfter || 0;
      if (until && Date.now() < until) return translationCache[mid];
      if (!until) return translationCache[mid];
      delete translationCache[mid];
    }
    if (translateInFlight[mid]) return translateInFlight[mid];

    const targetLang = targetLangForRole();
    translateInFlight[mid] = (async () => {
      try {
        const data = await api('/api/messenger/translate', {
          method: 'POST',
          body: { text, targetLang }
        }, role);
        const entry = {
          original: text,
          translated: String(data.translated || '').trim(),
          targetLang: data.targetLang || targetLang
        };
        if (!entry.translated) throw new Error(labels().failed);
        translationCache[mid] = entry;
        return entry;
      } catch (e) {
        const msg = e.message || labels().failed;
        const retryable = /busy|moment|quota|rate|unavailable|overloaded/i.test(msg);
        translationCache[mid] = {
          original: text,
          translated: '',
          error: msg,
          retryAfter: retryable ? Date.now() + 3000 : 0
        };
        return translationCache[mid];
      } finally {
        delete translateInFlight[mid];
      }
    })();

    return translateInFlight[mid];
  }

  async function ensureTranslationsForThread() {
    if (!activeThread || !getAutoTranslate(activeThread.threadId)) return;
    const tid = activeThread.threadId;
    if (translatingThreadId === tid) return;
    translatingThreadId = tid;
    try {
      const pending = messages.filter((m) => {
        if (!isTranslatableMessage(m)) return false;
        if (translateInFlight[m.messageId]) return false;
        const c = translationCache[m.messageId];
        if (!c) return true;
        if (c.translated) return false;
        if (c.error) {
          if (c.retryAfter && Date.now() >= c.retryAfter) return true;
          return false;
        }
        return true;
      });
      if (!pending.length) return;

      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(TRANSLATE_CONCURRENCY, pending.length) },
        async () => {
          while (cursor < pending.length) {
            if (!activeThread || activeThread.threadId !== tid || !getAutoTranslate(tid)) return;
            const idx = cursor++;
            const m = pending[idx];
            await translateOne(m);
            if (view === 'chat' && activeThread && activeThread.threadId === tid) renderChat();
          }
        }
      );
      await Promise.all(workers);
    } finally {
      if (translatingThreadId === tid) translatingThreadId = null;
    }
  }

  function updatePanel() {
    const panel = root().querySelector('.msg-panel');
    const threadsView = root().querySelector('.msg-view-threads');
    const chatView = root().querySelector('.msg-view-chat');
    if (!panel) return;

    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    root().querySelector('.msg-fab').setAttribute('aria-expanded', open ? 'true' : 'false');

    if (threadsView) threadsView.classList.toggle('hidden', view !== 'threads');
    if (chatView) chatView.classList.toggle('hidden', view !== 'chat');

    if (view === 'threads') {
      syncListTabs();
      if (listTab === 'contacts') renderContactsList();
      else renderThreads();
    }
    if (view === 'chat') renderChat();
  }

  function joinThreadRoom(threadId) {
    if (!socket || !socketReady) return;
    if (joinedThread && joinedThread !== threadId) {
      socket.emit('messenger:leave', joinedThread);
    }
    joinedThread = threadId;
    socket.emit('messenger:join', threadId);
  }

  function leaveThreadRoom() {
    if (!socket || !joinedThread) return;
    socket.emit('messenger:leave', joinedThread);
    joinedThread = null;
  }

  function appendMessageIfNew(message) {
    if (!message || !message.messageId) return;
    if (messages.some((m) => m.messageId === message.messageId)) return;
    messages.push(message);
    messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (view === 'chat' && activeThread) {
      renderChat();
      if (getAutoTranslate(activeThread.threadId) && isTranslatableMessage(message)) {
        translateOne(message).then(() => {
          if (view === 'chat' && activeThread) renderChat();
        });
      }
    }
  }

  function connectSocket() {
    if (typeof io === 'undefined') return;
    const token = getToken(role);
    if (!token) return;
    if (socket) {
      socket.disconnect();
      socket = null;
      socketReady = false;
    }
    socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socketReady = true;
      if (activeThread) joinThreadRoom(activeThread.threadId);
    });
    socket.on('disconnect', () => { socketReady = false; });
    socket.on('messenger:message', (payload) => {
      if (!payload || !payload.message) return;
      if (activeThread && payload.message.threadId === activeThread.threadId) {
        appendMessageIfNew(payload.message);
      }
      refreshThreads();
    });
    socket.on('messenger:threads-changed', () => refreshThreads());
    socket.on('messenger:read', () => refreshThreads());
  }

  async function refreshThreads() {
    try {
      const data = await api('/api/messenger/threads', {}, role);
      threads = data.threads || [];
      renderFab(data.unreadTotal || 0);
      if (view === 'threads') {
        renderThreads();
        if (open && threads.length === 1 && role === 'student') {
          openThread(threads[0].threadId);
        }
      }
    } catch (e) { /* ignore poll errors */ }
  }

  async function openThreadWithMeta(meta) {
    if (!meta || !meta.threadId) return;
    let t = threads.find((x) => x.threadId === meta.threadId);
    if (!t) {
      t = Object.assign({
        unread: 0,
        lastMessage: '',
        lastAt: ''
      }, meta);
      threads.unshift(t);
    } else {
      if (meta.title) t.title = meta.title;
      if (meta.subtitle) t.subtitle = meta.subtitle;
      if (meta.threadType) t.threadType = meta.threadType;
      if (meta.personType) t.personType = meta.personType;
      if (meta.parentId) t.parentId = meta.parentId;
      if (meta.teacherId) t.teacherId = meta.teacherId;
      if (meta.studentId) t.studentId = meta.studentId;
      if (meta.studentName) t.studentName = meta.studentName;
      if (meta.classId) t.classId = meta.classId;
    }
    return openThread(meta.threadId);
  }

  async function openThread(threadId) {
    let t = threads.find((x) => x.threadId === threadId);
    if (!t) {
      t = {
        threadId,
        title: isAdminRole() ? 'Conversation' : 'Teacher',
        subtitle: '',
        unread: 0
      };
      threads.unshift(t);
    }
    activeThread = t;
    view = 'chat';
    showOriginalIds.clear();
    manualShowTranslated.clear();
    updatePanel();
    joinThreadRoom(threadId);
    try {
      const data = await api('/api/messenger/threads/' + encodeURIComponent(threadId), {}, role);
      messages = data.messages || [];
      renderChat();
      await api('/api/messenger/threads/' + encodeURIComponent(threadId) + '/read', { method: 'POST' }, role);
      t.unread = 0;
      const total = threads.reduce((s, x) => s + (x.unread || 0), 0);
      renderFab(total);
    } catch (e) {
      const body = root().querySelector('.msg-chat-body');
      if (body) body.innerHTML = '<p class="msg-empty" style="color:var(--danger)">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function sendMessage() {
    const input = root().querySelector('.msg-compose-input');
    const err = root().querySelector('.msg-compose-error');
    if (!input || !activeThread) return;
    const body = input.value.trim();
    if (!body) return;
    err.textContent = '';
    input.disabled = true;
    try {
      const data = await api(
        '/api/messenger/threads/' + encodeURIComponent(activeThread.threadId),
        { method: 'POST', body: { body } },
        role
      );
      appendMessageIfNew(data.message);
      input.value = '';
      renderChat();
      refreshThreads();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function buildDom() {
    if (document.getElementById('saltMessenger')) return;

    const L = tabLabels();
    const wrap = el('div', 'salt-messenger', '');
    wrap.id = 'saltMessenger';
    wrap.innerHTML =
      '<button type="button" class="msg-fab" aria-label="Messages" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>' +
      '<span class="msg-fab-badge hidden">0</span>' +
      '<span class="msg-live-dot hidden" title="Live"></span>' +
      '</button>' +
      '<div class="msg-panel" aria-hidden="true">' +
      '<div class="msg-panel-head">' +
      '<strong class="msg-panel-title">' + escapeHtml(L.messages) + '</strong>' +
      '<button type="button" class="btn btn-ghost msg-close-btn" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="msg-panel-body">' +
      '<div class="msg-view-threads">' +
      '<div class="msg-list-tabs' + (usesContactTabs() ? '' : ' hidden') + '" role="tablist">' +
      '<button type="button" class="msg-list-tab" role="tab" data-list-tab="contacts">' +
        escapeHtml(L.contacts) + '</button>' +
      '<button type="button" class="msg-list-tab is-active" role="tab" data-list-tab="chats">' +
        escapeHtml(L.chats) + '</button>' +
      '</div>' +
      '<div class="msg-view-contacts hidden">' +
      '<div class="msg-contact-list"></div>' +
      '</div>' +
      '<div class="msg-view-chats">' +
      (isAdminRole()
        ? '<div class="msg-directory">' +
          '<input type="search" class="msg-directory-input" placeholder="Search teachers, parents, students…" autocomplete="off">' +
          '<div class="msg-directory-results hidden"></div>' +
          '</div>'
        : '') +
      '<div class="msg-thread-list"></div>' +
      '</div>' +
      '</div>' +
      '<div class="msg-view-chat hidden">' +
      '<div class="msg-chat-head"></div>' +
      '<div class="msg-chat-body"></div>' +
      '<form class="msg-compose">' +
      '<textarea class="msg-compose-input" rows="2" maxlength="500" placeholder="Type a message… (Enter to send)"></textarea>' +
      '<button type="submit" class="btn btn-primary msg-send-btn">Send</button>' +
      '<div class="msg-compose-error error"></div>' +
      '</form>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="msg-backdrop hidden" aria-hidden="true"></div>';

    document.body.appendChild(wrap);

    wrap.querySelectorAll('[data-list-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setListTab(btn.dataset.listTab));
    });

    wrap.querySelector('.msg-fab').addEventListener('click', () => {
      open = !open;
      if (open) {
        view = 'threads';
        activeThread = null;
        leaveThreadRoom();
        if (usesContactTabs()) listTab = 'contacts';
        else listTab = 'chats';
        refreshThreads();
      }
      wrap.querySelector('.msg-backdrop').classList.toggle('hidden', !open);
      updatePanel();
    });

    wrap.querySelector('.msg-close-btn').addEventListener('click', () => {
      open = false;
      leaveThreadRoom();
      wrap.querySelector('.msg-backdrop').classList.add('hidden');
      updatePanel();
    });

    wrap.querySelector('.msg-backdrop').addEventListener('click', () => {
      open = false;
      leaveThreadRoom();
      wrap.querySelector('.msg-backdrop').classList.add('hidden');
      updatePanel();
    });

    wrap.querySelector('.msg-compose').addEventListener('submit', (e) => {
      e.preventDefault();
      sendMessage();
    });

    const composeInput = wrap.querySelector('.msg-compose-input');
    if (composeInput) {
      composeInput.addEventListener('keydown', (e) => {
        // Enter sends; Shift+Enter inserts a newline.
        if (e.key !== 'Enter' || e.shiftKey) return;
        if (e.isComposing || e.keyCode === 229) return; // IME composition (Korean etc.)
        e.preventDefault();
        sendMessage();
      });
    }

    const dirInput = wrap.querySelector('.msg-directory-input');
    if (dirInput) {
      dirInput.addEventListener('input', () => scheduleDirectorySearch(dirInput.value));
      dirInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          clearDirectorySearch();
          dirInput.blur();
        }
      });
    }

    window.addEventListener('salt:langchange', () => {
      if (!root()) return;
      syncListTabs();
      if (view === 'threads') {
        if (listTab === 'contacts') renderContactsList();
        else renderThreads();
      }
    });
  }

  function setLiveIndicator(on) {
    const dot = root() && root().querySelector('.msg-live-dot');
    if (dot) dot.classList.toggle('hidden', !on);
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      if (!role) return;
      if (socketReady) return;
      refreshThreads();
    }, 60000);
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function init(r) {
    role = r;
    buildDom();
    connectSocket();
    setLiveIndicator(typeof io !== 'undefined');
    refreshThreads();
    startPoll();
  }

  function destroy() {
    stopPoll();
    leaveThreadRoom();
    if (socket) {
      socket.disconnect();
      socket = null;
      socketReady = false;
    }
    const node = document.getElementById('saltMessenger');
    if (node) node.remove();
    role = '';
    open = false;
  }

  function openMessenger() {
    open = true;
    const wrap = root();
    if (wrap) wrap.querySelector('.msg-backdrop').classList.remove('hidden');
    updatePanel();
    refreshThreads();
  }

  function openThreadForTeacher(teacherId) {
    const profile = global.SaltApp.getProfile(role) || {};
    const studentId = profile.studentId;
    if (!studentId || !teacherId) {
      openMessenger();
      return;
    }
    const tid = 'pt_' + studentId + '__' + teacherId;
    open = true;
    const wrap = root();
    if (wrap) wrap.querySelector('.msg-backdrop').classList.remove('hidden');
    openThread(tid);
  }

  function openThreadForAdmin() {
    const profile = global.SaltApp.getProfile(role) || {};
    const parentId = profile.parentId;
    if (!parentId) {
      openMessenger();
      return;
    }
    open = true;
    const wrap = root();
    if (wrap) wrap.querySelector('.msg-backdrop').classList.remove('hidden');
    openThreadWithMeta({
      threadId: 'padm_' + parentId,
      threadType: 'parent_admin',
      title: 'Salt Admin',
      subtitle: 'School office',
      parentId,
      studentId: profile.studentId || '',
      classId: profile.classId || '',
      unread: 0
    });
  }

  global.SaltMessenger = {
    init,
    destroy,
    refresh: refreshThreads,
    open: openMessenger,
    openThreadForTeacher,
    openThreadForAdmin,
    setQuickContacts
  };
})(window);
