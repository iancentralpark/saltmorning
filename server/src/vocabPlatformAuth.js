/**
 * Vocab Booster platform-owner auth (central admin console).
 * Separate role from school teachers; password: VOCAB_PLATFORM_ADMIN_PASSWORD
 * (falls back to TEACHER_GATE_PASSWORD for single-operator setups).
 */
'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'vocab_platform_admin';
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function getSigningSecret() {
  return (
    process.env.VOCAB_PLATFORM_SECRET ||
    process.env.TEACHER_AUTH_SECRET ||
    process.env.STUDENT_AUTH_SECRET ||
    'vocab-platform-dev-secret'
  );
}

function getAdminPassword() {
  return (
    process.env.VOCAB_PLATFORM_ADMIN_PASSWORD ||
    process.env.TEACHER_GATE_PASSWORD ||
    ''
  );
}

function signPlatformAdminToken() {
  const body = {
    role: 'vocab_platform_admin',
    exp: Date.now() + TOKEN_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyPlatformAdminToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const body = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (body.role !== 'vocab_platform_admin' || !body.exp || Date.now() > Number(body.exp)) {
      return null;
    }
    return { role: 'vocab_platform_admin' };
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(function (part) {
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
  const h = (req && req.headers && req.headers.authorization) || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

function readPlatformAdminTokenFromRequest(req) {
  const bearer = readBearerToken(req);
  if (bearer && verifyPlatformAdminToken(bearer)) return bearer;
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const cookieToken = cookies[COOKIE_NAME] || '';
  if (cookieToken && verifyPlatformAdminToken(cookieToken)) return cookieToken;
  return bearer || cookieToken;
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function setPlatformAdminCookie(res, req, token) {
  const parts = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(TOKEN_TTL_MS / 1000)
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearPlatformAdminCookie(res, req) {
  const parts = [
    COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function requirePlatformAdminAuth(req, res, next) {
  const session = verifyPlatformAdminToken(readPlatformAdminTokenFromRequest(req));
  if (!session) {
    return res.status(401).json({ error: 'Platform admin login required.' });
  }
  req.platformAdminSession = session;
  next();
}

function requirePlatformAdminPage(req, res, next) {
  const token = readPlatformAdminTokenFromRequest(req);
  if (verifyPlatformAdminToken(token)) return next();
  const nextUrl = encodeURIComponent(req.originalUrl || '/vocab-admin');
  return res.redirect('/vocab-admin-login?next=' + nextUrl);
}

function issuePlatformAdminLogin(password) {
  const expected = getAdminPassword();
  if (!expected) {
    const err = new Error('Platform admin password is not configured (VOCAB_PLATFORM_ADMIN_PASSWORD).');
    err.statusCode = 503;
    throw err;
  }
  if (String(password || '') !== expected) {
    const err = new Error('Incorrect password.');
    err.statusCode = 401;
    throw err;
  }
  return signPlatformAdminToken();
}

module.exports = {
  COOKIE_NAME,
  getAdminPassword,
  signPlatformAdminToken,
  verifyPlatformAdminToken,
  readPlatformAdminTokenFromRequest,
  setPlatformAdminCookie,
  clearPlatformAdminCookie,
  requirePlatformAdminAuth,
  requirePlatformAdminPage,
  issuePlatformAdminLogin
};
