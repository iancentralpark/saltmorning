const crypto = require('crypto');
const { AUTH_SECRET } = require('../config');

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signToken(payload) {
  const body = Object.assign({ exp: Date.now() + TOKEN_TTL_MS }, payload);
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!body.role || !body.exp || Date.now() > body.exp) return null;
    return body;
  } catch (e) {
    return null;
  }
}

function readBearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

function requireRole(...roles) {
  return function authMiddleware(req, res, next) {
    const session = verifyToken(readBearerToken(req));
    if (!session || !roles.includes(session.role)) {
      return res.status(401).json({ error: 'Login required.' });
    }
    req.session = session;
    next();
  };
}

module.exports = { signToken, verifyToken, readBearerToken, requireRole };
