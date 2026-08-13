const crypto = require('crypto');
const { AUTH_SECRET } = require('../config');
const { hasPermission } = require('../services/staffPermissionService');

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

function isAdminPortalRole(role) {
  return role === 'admin' || role === 'principal' || role === 'staff';
}

function requireRole(...roles) {
  return function authMiddleware(req, res, next) {
    const session = verifyToken(readBearerToken(req));
    if (!session || !session.role) {
      return res.status(401).json({ error: 'Login required.' });
    }
    // Principal + staff inherit Admin-gated portal APIs; permission keys gate finer access.
    const ok = roles.includes(session.role) ||
      (isAdminPortalRole(session.role) && roles.includes('admin'));
    if (!ok) {
      return res.status(401).json({ error: 'Login required.' });
    }
    req.session = session;

    // Path-level permission gate for faculty on admin APIs (Admin superuser bypasses).
    if (roles.includes('admin') && session.role !== 'admin') {
      const path = String(req.path || '');
      const rule = ADMIN_PATH_PERMS.find((r) => r.re.test(path));
      if (rule && !hasPermission(session, rule.perm)) {
        return res.status(403).json({ error: 'You do not have permission for this action.' });
      }
    }
    next();
  };
}

const ADMIN_PATH_PERMS = [
  { re: /^\/admin\/teachers/, perm: 'admin.faculty' },
  { re: /^\/admin\/faculty/, perm: 'admin.faculty' },
  { re: /^\/admin\/class-assignments/, perm: 'admin.faculty' },
  { re: /^\/admin\/bus/, perm: 'admin.bus' },
  { re: /^\/admin\/classes/, perm: 'admin.classes' },
  { re: /^\/admin\/students/, perm: 'admin.students' },
  { re: /^\/admin\/parents/, perm: 'admin.students' },
  { re: /^\/admin\/school-calendar/, perm: 'admin.schoolCal' },
  { re: /^\/admin\/school-semesters/, perm: 'admin.schoolCal' },
  { re: /^\/admin\/terms/, perm: 'admin.schoolCal' },
  { re: /^\/admin\/timetable/, perm: 'admin.timetables' },
  { re: /^\/admin\/announcements/, perm: 'admin.announcements' },
  { re: /^\/admin\/report-cards/, perm: 'admin.reportCards' },
  { re: /^\/admin\/signature/, perm: 'admin.reportCards' },
  { re: /^\/admin\/ensure-leadership/, perm: 'admin.reportCards' },
  { re: /^\/admin\/material-requests/, perm: 'admin.materials' },
  { re: /^\/admin\/analytics/, perm: 'admin.analytics' },
  { re: /^\/admin\/lesson-plans/, perm: 'admin.lessons' },
  { re: /^\/admin\/semester-plans/, perm: 'admin.lessons' },
  { re: /^\/admin\/monitoring/, perm: 'admin.monitor' },
  { re: /^\/admin\/overview/, perm: 'admin.monitor' },
  { re: /^\/admin\/vocab/, perm: 'admin.vocabPlatform' },
  { re: /^\/messenger\/directory/, perm: 'admin.monitor' }
];

/** After requireRole — Admin always passes; faculty need one of the listed keys. */
function requirePerm(...permKeys) {
  return function permMiddleware(req, res, next) {
    if (!req.session) {
      return res.status(401).json({ error: 'Login required.' });
    }
    if (hasPermission(req.session, ...permKeys)) return next();
    return res.status(403).json({ error: 'You do not have permission for this action.' });
  };
}

module.exports = {
  signToken,
  verifyToken,
  readBearerToken,
  requireRole,
  requirePerm,
  isAdminPortalRole
};
