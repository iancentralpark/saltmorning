(function (global) {
  const { api, escapeHtml, getToken } = global.SaltApp;

  let role = '';
  let open = false;
  let view = 'threads';
  let threads = [];
  let activeThread = null;
  let messages = [];
  let pollTimer = null;
  let socket = null;
  let joinedThread = null;
  let socketReady = false;

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

  function root() {
    return document.getElementById('saltMessenger');
  }

  function renderFab(unread) {
    const fab = root().querySelector('.msg-fab');
    const badge = root().querySelector('.msg-fab-badge');
    if (!fab) return;
    badge.textContent = unread > 99 ? '99+' : String(unread || '');
    badge.classList.toggle('hidden', !unread);
  }

  function renderThreads() {
    const list = root().querySelector('.msg-thread-list');
    if (!list) return;
    if (!threads.length) {
      list.innerHTML = '<p class="msg-empty">No conversations yet.</p>';
      return;
    }
    list.innerHTML = threads.map((t) => {
      const preview = t.lastMessage ? escapeHtml(t.lastMessage) : '<span class="muted">No messages yet</span>';
      const badge = t.unread ? '<span class="msg-thread-unread">' + t.unread + '</span>' : '';
      return (
        '<button type="button" class="msg-thread-item" data-tid="' + escapeHtml(t.threadId) + '">' +
        '<div class="msg-thread-top">' +
        '<strong>' + escapeHtml(t.title) + '</strong>' +
        badge +
        '</div>' +
        '<div class="msg-thread-sub">' + escapeHtml(t.subtitle || '') + '</div>' +
        '<div class="msg-thread-preview">' + preview + '</div>' +
        '</button>'
      );
    }).join('');

    list.querySelectorAll('.msg-thread-item').forEach((btn) => {
      btn.addEventListener('click', () => openThread(btn.dataset.tid));
    });
  }

  function renderChat() {
    const head = root().querySelector('.msg-chat-head');
    const body = root().querySelector('.msg-chat-body');
    if (!head || !body || !activeThread) return;

    head.innerHTML =
      '<button type="button" class="btn btn-ghost msg-back-btn" aria-label="Back">‹</button>' +
      '<div class="msg-chat-title">' +
      '<strong>' + escapeHtml(activeThread.title) + '</strong>' +
      '<span>' + escapeHtml(activeThread.subtitle || '') + '</span>' +
      '</div>';

    head.querySelector('.msg-back-btn').addEventListener('click', () => {
      leaveThreadRoom();
      view = 'threads';
      activeThread = null;
      messages = [];
      updatePanel();
      refreshThreads();
    });

    if (!messages.length) {
      body.innerHTML = '<p class="msg-empty">Say hello — your message goes to the teacher.</p>';
    } else {
      body.innerHTML = messages.map((m) => {
        const cls = isMine(m) ? 'msg-bubble mine' : 'msg-bubble theirs';
        return (
          '<div class="' + cls + '">' +
          '<div class="msg-bubble-meta">' + escapeHtml(senderLabel(m)) + ' · ' + escapeHtml(formatTime(m.createdAt)) + '</div>' +
          escapeHtml(m.body) +
          '</div>'
        );
      }).join('');
    }
    body.scrollTop = body.scrollHeight;
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

    if (view === 'threads') renderThreads();
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
    if (view === 'chat' && activeThread) renderChat();
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
        if (open && threads.length === 1 && (role === 'student' || role === 'parent')) {
          openThread(threads[0].threadId);
        }
      }
    } catch (e) { /* ignore poll errors */ }
  }

  async function openThread(threadId) {
    const t = threads.find((x) => x.threadId === threadId);
    if (!t) return;
    activeThread = t;
    view = 'chat';
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
      '<strong>Messages</strong>' +
      '<button type="button" class="btn btn-ghost msg-close-btn" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="msg-panel-body">' +
      '<div class="msg-view-threads">' +
      '<div class="msg-thread-list"></div>' +
      '</div>' +
      '<div class="msg-view-chat hidden">' +
      '<div class="msg-chat-head"></div>' +
      '<div class="msg-chat-body"></div>' +
      '<form class="msg-compose">' +
      '<textarea class="msg-compose-input" rows="2" maxlength="500" placeholder="Type a message…"></textarea>' +
      '<button type="submit" class="btn btn-primary msg-send-btn">Send</button>' +
      '<div class="msg-compose-error error"></div>' +
      '</form>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="msg-backdrop hidden" aria-hidden="true"></div>';

    document.body.appendChild(wrap);

    wrap.querySelector('.msg-fab').addEventListener('click', () => {
      open = !open;
      if (open) {
        view = 'threads';
        activeThread = null;
        leaveThreadRoom();
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

  global.SaltMessenger = { init, destroy, refresh: refreshThreads };
})(window);
