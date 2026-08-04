/**
 * Vocab Booster embed SDK — mount the shared learner UI against central /api/vocab/v1.
 *
 * Usage (after your school server mints a session JWT):
 *
 *   <div id="vocab-booster-root"></div>
 *   <script src="https://YOUR_CENTRAL_HOST/js/vocab-embed.js"
 *           data-api-base="https://YOUR_CENTRAL_HOST"
 *           data-session="SIGNED_JWT"
 *           data-public-key="pk_…"
 *           async></script>
 *
 * Or call programmatically:
 *   VocabBooster.mount({ apiBase, session, root: '#vocab-booster-root' })
 */
(function (root) {
  'use strict';

  var SCRIPT = document.currentScript;
  var DEFAULT_ROOT = '#vocab-booster-root';
  var CSS_HREF = '/css/vocab-learn.css';
  var MOCK_SRC = '/js/vocab-mock-data.js';
  var LEARN_SRC = '/js/vocab-learn.js';
  var loaded = false;
  var loadingPromise = null;

  function attr(name, fallback) {
    if (!SCRIPT) return fallback;
    var v = SCRIPT.getAttribute(name);
    return v != null && v !== '' ? v : fallback;
  }

  function joinUrl(base, path) {
    return String(base || '').replace(/\/$/, '') + path;
  }

  function loadStylesheet(href) {
    if (document.querySelector('link[data-vocab-embed-css="1"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-vocab-embed-css', '1');
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-vocab-embed-src="' + src + '"]');
      if (existing) {
        if (existing.getAttribute('data-loaded') === '1') return resolve();
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.setAttribute('data-vocab-embed-src', src);
      s.onload = function () {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureShell(rootEl) {
    if (rootEl.querySelector('#vocabShell')) return;
    rootEl.innerHTML =
      '<div class="vocab-shell vocab-embed-shell" id="vocabShell" data-panel="home">' +
        '<div id="vocabNeedsPlacement">' +
          '<p class="vocab-lead">Take a short placement test to find your starting tier.</p>' +
          '<div class="vocab-actions">' +
            '<button type="button" class="vocab-btn" id="vocabStartTestBtn">Start Placement Test</button>' +
          '</div>' +
        '</div>' +
        '<div id="vocabPlacedFlow" class="hidden">' +
          '<div class="vocab-tier-hero" id="vocabTierHero" role="button" tabindex="0" aria-expanded="false" aria-controls="vocabTierLadder" aria-live="polite" title="See all tiers">' +
            '<div class="vocab-tier-badge-mark" id="vocabTierBadgeMark" aria-hidden="true"></div>' +
            '<div class="vocab-tier-hero-text">' +
              '<span class="vocab-tier-hero-name" id="vocabStatTier">—</span>' +
              '<span class="vocab-tier-hero-grade" id="vocabStatStart"></span>' +
            '</div>' +
          '</div>' +
          '<div id="vocabQuestBody"></div>' +
        '</div>' +
        '<div class="vocab-pane" id="vocabQuizPane">' +
          '<div class="vocab-pane-head"><strong id="vocabQuizCount">Question 1 / 12</strong></div>' +
          '<div class="vocab-progress"><span id="vocabQuizProgress"></span></div>' +
          '<div id="vocabQuizBody"></div>' +
        '</div>' +
        '<div class="vocab-pane" id="vocabResultPane"><div id="vocabResultBody"></div></div>' +
      '</div>';
  }

  function rewriteStudentPath(path) {
    var p = String(path || '');
    var q = '';
    var qi = p.indexOf('?');
    if (qi >= 0) {
      q = p.slice(qi);
      p = p.slice(0, qi);
    }
    var map = {
      '/api/student/vocab/summary': '/api/vocab/v1/summary',
      '/api/student/vocab/placement/meta': '/api/vocab/v1/placement/meta',
      '/api/student/vocab/placement/item': '/api/vocab/v1/placement/item',
      '/api/student/vocab/placement/next': '/api/vocab/v1/placement/next',
      '/api/student/vocab/placement/score': '/api/vocab/v1/placement/score',
      '/api/student/vocab/deep-dive': '/api/vocab/v1/deep-dive',
      '/api/student/vocab/daily-queue': '/api/vocab/v1/daily-queue',
      '/api/student/vocab/review': '/api/vocab/v1/review',
      '/api/student/vocab/daily-test/submit': '/api/vocab/v1/daily-test/submit'
    };
    return (map[p] || p) + q;
  }

  function installApiBridge(apiBase, sessionToken) {
    root.NODE_API = String(apiBase || '').replace(/\/$/, '');
    try {
      localStorage.setItem('vocab_v1_session', sessionToken);
      // Prefer v1 token over host portal tokens inside the embed.
      localStorage.setItem('salt_student_token', sessionToken);
    } catch (e) { /* ignore */ }

    root.mrParkStudentApi = function (path, opts) {
      opts = opts || {};
      var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      headers.Authorization = 'Bearer ' + sessionToken;
      var body = opts.body;
      if (body != null && typeof body !== 'string') body = JSON.stringify(body);
      return fetch(joinUrl(root.NODE_API, rewriteStudentPath(path)), {
        method: opts.method || 'GET',
        headers: headers,
        body: body
      }).then(function (res) {
        return res.json().then(function (payload) {
          if (!res.ok) throw new Error((payload && payload.error) || 'Request failed');
          return payload;
        });
      });
    };
  }

  function ensureAssets(apiBase) {
    if (loaded) return Promise.resolve();
    if (loadingPromise) return loadingPromise;
    loadStylesheet(joinUrl(apiBase, CSS_HREF));
    loadingPromise = loadScript(joinUrl(apiBase, MOCK_SRC))
      .then(function () { return loadScript(joinUrl(apiBase, LEARN_SRC)); })
      .then(function () { loaded = true; });
    return loadingPromise;
  }

  function mount(options) {
    options = options || {};
    var apiBase = options.apiBase || attr('data-api-base', root.location && root.location.origin);
    var session = options.session || attr('data-session', '');
    var rootSel = options.root || attr('data-root', DEFAULT_ROOT);
    var rootEl = typeof rootSel === 'string' ? document.querySelector(rootSel) : rootSel;

    if (!session) {
      return Promise.reject(new Error('VocabBooster: session JWT required (data-session or options.session)'));
    }
    if (!rootEl) {
      return Promise.reject(new Error('VocabBooster: root element not found (' + rootSel + ')'));
    }

    installApiBridge(apiBase, session);
    ensureShell(rootEl);

    return ensureAssets(apiBase).then(function () {
      if (!root.MrParkVocabLearn) throw new Error('VocabBooster: learner UI failed to load');
      if (typeof root.MrParkVocabLearn.onLogin === 'function') {
        return root.MrParkVocabLearn.onLogin();
      }
      root.MrParkVocabLearn.init();
    });
  }

  function autoBoot() {
    var session = attr('data-session', '');
    if (!session) return;
    var start = function () {
      mount({}).catch(function (err) {
        console.error('[VocabBooster]', err);
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  root.VocabBooster = {
    mount: mount,
    rewriteStudentPath: rewriteStudentPath
  };

  autoBoot();
})(typeof window !== 'undefined' ? window : globalThis);
