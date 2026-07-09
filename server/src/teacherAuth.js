const crypto = require('crypto');

const TEACHER_COOKIE_NAME = 'mrpark_teacher';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
  return process.env.TEACHER_AUTH_SECRET ||
    process.env.STUDENT_AUTH_SECRET ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    'mrpark-teacher-dev-secret';
}

function signTeacherToken() {
  const body = {
    role: 'teacher',
    exp: Date.now() + TOKEN_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyTeacherToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (body.role !== 'teacher' || !body.exp || Date.now() > body.exp) return null;
    return { role: 'teacher' };
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function(part) {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch (e) {
      out[k] = v;
    }
  });
  return out;
}

function readBearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

function readTeacherTokenFromRequest(req) {
  const bearer = readBearerToken(req);
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[TEACHER_COOKIE_NAME] || '';
  if (bearer && verifyTeacherToken(bearer)) return bearer;
  if (cookieToken && verifyTeacherToken(cookieToken)) return cookieToken;
  return bearer || cookieToken;
}

function requireTeacherAuth(req, res, next) {
  const session = verifyTeacherToken(readTeacherTokenFromRequest(req));
  if (!session) {
    return res.status(401).json({ error: 'Teacher login required.' });
  }
  req.teacherSession = session;
  next();
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return proto === 'https';
}

function setTeacherAuthCookie(res, req, token) {
  const maxAge = Math.floor(TOKEN_TTL_MS / 1000);
  const parts = [
    TEACHER_COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + maxAge
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearTeacherAuthCookie(res, req) {
  const parts = [
    TEACHER_COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  TEACHER_COOKIE_NAME,
  signTeacherToken,
  verifyTeacherToken,
  readTeacherTokenFromRequest,
  requireTeacherAuth,
  setTeacherAuthCookie,
  clearTeacherAuthCookie
};
