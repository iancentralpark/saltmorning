const { Server } = require('socket.io');
const { verifyToken } = require('./auth/tokenAuth');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const session = verifyToken(token);
    if (!session) return next(new Error('Unauthorized'));
    socket.session = session;
    next();
  });

  io.on('connection', (socket) => {
    const s = socket.session;
    socket.join('role:' + s.role);
    if (s.studentId) socket.join('user:student:' + s.studentId);
    if (s.teacherId) socket.join('user:teacher:' + s.teacherId);
    if (s.adminId) socket.join('user:admin:' + s.adminId);

    socket.on('messenger:join', (threadId) => {
      if (threadId) socket.join('thread:' + String(threadId));
    });
    socket.on('messenger:leave', (threadId) => {
      if (threadId) socket.leave('thread:' + String(threadId));
    });
  });

  return io;
}

function emitToThread(threadId, event, payload) {
  if (!io || !threadId) return;
  io.to('thread:' + String(threadId)).emit(event, payload);
}

function broadcastThreadsChanged() {
  if (!io) return;
  io.emit('messenger:threads-changed');
}

function notifyNewMessage(threadId, message) {
  emitToThread(threadId, 'messenger:message', { message });
  broadcastThreadsChanged();
}

function notifyThreadRead(threadId, role) {
  emitToThread(threadId, 'messenger:read', { threadId, role });
  broadcastThreadsChanged();
}

module.exports = {
  initRealtime,
  notifyNewMessage,
  notifyThreadRead,
  broadcastThreadsChanged
};
