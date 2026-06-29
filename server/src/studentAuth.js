const crypto = require('crypto');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  return process.env.STUDENT_AUTH_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || 'mrpark-student-dev-secret';
}

function signStudentToken(payload) {
  const body = {
    studentId: String(payload.studentId),
    classId: String(payload.classId),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyStudentToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!body.studentId || !body.classId || !body.exp || Date.now() > body.exp) return null;
    return { studentId: String(body.studentId), classId: String(body.classId) };
  } catch (e) {
    return null;
  }
}

function readBearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

function requireStudentAuth(req, res, next) {
  const session = verifyStudentToken(readBearerToken(req));
  if (!session) {
    return res.status(401).json({ error: 'Login required.' });
  }
  req.studentSession = session;
  next();
}

module.exports = {
  signStudentToken,
  verifyStudentToken,
  requireStudentAuth
};
