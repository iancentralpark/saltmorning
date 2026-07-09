const { Server } = require('socket.io');
const { verifyTeacherToken } = require('./teacherAuth');
const { verifyStudentToken } = require('./studentAuth');

let io = null;

function threadRoom(threadId) {
  return 'thread:' + String(threadId);
}

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const teacher = verifyTeacherToken(token);
    if (teacher) {
      socket.session = teacher;
      return next();
    }
    const student = verifyStudentToken(token);
    if (student) {
      socket.session = Object.assign({ role: 'student' }, student);
      return next();
    }
    return next(new Error('Unauthorized'));
  });

  io.on('connection', (socket) => {
    const s = socket.session || {};
    if (s.role === 'teacher') {
      socket.join('role:teacher');
    } else if (s.role === 'student' && s.studentId) {
      socket.join('role:student');
      socket.join('user:student:' + s.studentId);
      if (s.classId) {
        socket.join('class:' + s.classId);
      }
    }

    socket.on('messenger:join', (threadId) => {
      if (threadId) socket.join(threadRoom(threadId));
    });
    socket.on('messenger:leave', (threadId) => {
      if (threadId) socket.leave(threadRoom(threadId));
    });
  });

  return io;
}

function emitToThread(threadId, event, payload) {
  if (!io || !threadId) return;
  io.to(threadRoom(threadId)).emit(event, payload);
}

function broadcastThreadsChanged() {
  if (!io) return;
  io.to('role:teacher').emit('messenger:threads-changed');
}

function notifyNewMessage(classId, studentId, message) {
  const threadId = String(classId) + '|' + String(studentId);
  emitToThread(threadId, 'messenger:message', { threadId, message });
  io.to('user:student:' + String(studentId)).emit('messenger:message', { threadId, message });
  io.to('role:teacher').emit('messenger:message', { threadId, message });
  broadcastThreadsChanged();
}

function notifyThreadRead(classId, studentId, role) {
  const threadId = String(classId) + '|' + String(studentId);
  const payload = { threadId: threadId, role: role };
  emitToThread(threadId, 'messenger:read', payload);
  io.to('role:teacher').emit('messenger:read', payload);
  io.to('user:student:' + String(studentId)).emit('messenger:read', payload);
  broadcastThreadsChanged();
}

function isRealtimeEnabled() {
  return !!io;
}

module.exports = {
  initRealtime,
  notifyNewMessage,
  notifyThreadRead,
  broadcastThreadsChanged,
  isRealtimeEnabled
};
