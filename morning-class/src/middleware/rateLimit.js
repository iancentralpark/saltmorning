'use strict';

/**
 * Minimal in-memory rate limiter (no external dependency). Good enough for
 * a single-process deployment; if this app is ever scaled to multiple
 * instances, swap the store for something shared (Redis, Postgres) — the
 * middleware signature would stay the same.
 */
function createRateLimiter(options) {
  const windowMs = (options && options.windowMs) || 60 * 1000;
  const max = (options && options.max) || 20;
  const message = (options && options.message) || 'Too many requests. Please wait a moment and try again.';
  const keyFn = (options && options.keyFn) || ((req) => req.ip);

  const hits = new Map(); // key -> { count, resetAt }

  // Periodic sweep so the map doesn't grow unbounded under sustained traffic.
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 30000));
  if (sweepInterval.unref) sweepInterval.unref();

  return function rateLimit(req, res, next) {
    const key = String(keyFn(req) || 'unknown');
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/** Prefer the authenticated account's loginId/studentId over bare IP when available, so a shared school IP doesn't lock everyone out from one abusive account — falls back to IP pre-auth. */
function loginAttemptKey(req) {
  const loginId = String((req.body && req.body.loginId) || '').trim().toLowerCase();
  return loginId ? 'login:' + loginId : 'ip:' + req.ip;
}

const loginRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyFn: loginAttemptKey,
  message: 'Too many login attempts. Please wait a few minutes and try again.'
});

const aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 12,
  keyFn: (req) => 'ai:' + (req.ip || 'unknown'),
  message: 'English Buddy is getting a lot of requests right now. Please wait a moment and try again.'
});

/**
 * Novel Study fire-and-forget jobs call Gemini many times with an internal
 * delay. Cap job starts (upload + generate), not each model call — otherwise
 * the shared AI limiter (12/min) would choke multi-part workbooks.
 */
const novelStudyJobLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 6,
  keyFn: (req) => {
    const sid =
      (req.session && (req.session.teacherId || req.session.adminId || req.session.userId)) ||
      req.ip ||
      'unknown';
    return 'novel-study:' + sid;
  },
  message: 'Novel Study is busy. Please wait a few minutes before starting another workbook.'
});

module.exports = { createRateLimiter, loginRateLimiter, aiRateLimiter, novelStudyJobLimiter };
