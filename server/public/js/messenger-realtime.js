(function(global) {
  var socket = null;
  var activeThread = '';
  var fallbackTimer = null;
  var reconnectTimer = null;
  var savedApiBase = '';
  var savedGetToken = null;
  var handlers = null;
  var FALLBACK_MS = 60000;
  var RECONNECT_MS = 3000;

  function openSocket() {
    if (!global.io || !savedApiBase) return false;
    var token = typeof savedGetToken === 'function' ? savedGetToken() : '';
    if (!token) return false;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    socket = global.io(savedApiBase.replace(/\/$/, ''), {
      path: '/socket.io',
      auth: { token: token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: RECONNECT_MS,
      reconnectionDelayMax: 15000
    });

    socket.on('connect', function() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (activeThread) socket.emit('messenger:join', activeThread);
      stopFallback();
      if (handlers && handlers.onConnect) handlers.onConnect();
    });

    socket.on('messenger:message', function(payload) {
      if (handlers && handlers.onMessage) handlers.onMessage(payload || {});
    });
    socket.on('messenger:threads-changed', function() {
      if (handlers && handlers.onThreadsChanged) handlers.onThreadsChanged();
    });
    socket.on('messenger:read', function(payload) {
      if (handlers && handlers.onRead) handlers.onRead(payload || {});
    });
    socket.on('disconnect', function() {
      if (handlers && handlers.onDisconnect) handlers.onDisconnect();
      startFallback();
    });
    socket.on('connect_error', function() {
      if (handlers && handlers.onDisconnect) handlers.onDisconnect();
      startFallback();
    });

    return true;
  }

  function connect(apiBase, getToken, h) {
    disconnect();
    savedApiBase = apiBase || '';
    savedGetToken = getToken || null;
    handlers = h || {};
    return openSocket();
  }

  function startFallback() {
    if (fallbackTimer || !handlers || !handlers.onFallbackPoll) return;
    fallbackTimer = setInterval(function() {
      if (socket && socket.connected) {
        stopFallback();
        return;
      }
      if (handlers.onFallbackPoll) handlers.onFallbackPoll();
    }, FALLBACK_MS);
  }

  function stopFallback() {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  function joinThread(threadId) {
    var next = threadId ? String(threadId) : '';
    if (socket && socket.connected && activeThread && activeThread !== next) {
      socket.emit('messenger:leave', activeThread);
    }
    activeThread = next;
    if (socket && socket.connected && activeThread) {
      socket.emit('messenger:join', activeThread);
    }
  }

  function leaveThread(threadId) {
    if (socket && threadId) socket.emit('messenger:leave', String(threadId));
    if (activeThread === String(threadId || '')) activeThread = '';
  }

  function disconnect() {
    stopFallback();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    activeThread = '';
    savedApiBase = '';
    savedGetToken = null;
    handlers = null;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  }

  function isConnected() {
    return !!(socket && socket.connected);
  }

  global.MrParkMessengerRealtime = {
    connect: connect,
    joinThread: joinThread,
    leaveThread: leaveThread,
    disconnect: disconnect,
    isConnected: isConnected,
    threadId: function(classId, studentId) {
      return String(classId) + '|' + String(studentId);
    }
  };
})(window);
