(function(global) {
  const API = location.origin;
  const PERSIST_KEY = 'salt_auth_persist';
  const SAVED_LOGIN_KEY = 'salt_saved_login';

  function authPersistEnabled() {
    // Default true when unset (existing users already in localStorage)
    const v = localStorage.getItem(PERSIST_KEY);
    return v !== '0';
  }

  function setAuthPersist(enabled) {
    localStorage.setItem(PERSIST_KEY, enabled ? '1' : '0');
  }

  function tokenStore() {
    return authPersistEnabled() ? localStorage : sessionStorage;
  }

  function getToken(role) {
    return localStorage.getItem('salt_' + role + '_token')
      || sessionStorage.getItem('salt_' + role + '_token')
      || '';
  }

  function setToken(role, token) {
    const key = 'salt_' + role + '_token';
    // Always clear both stores first so we don't leave a stale token behind.
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    if (token) tokenStore().setItem(key, token);
  }

  function setProfile(role, profile) {
    const key = 'salt_' + role + '_profile';
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    if (profile) tokenStore().setItem(key, JSON.stringify(profile));
  }

  function getProfile(role) {
    const raw = localStorage.getItem('salt_' + role + '_profile')
      || sessionStorage.getItem('salt_' + role + '_profile')
      || 'null';
    try { return JSON.parse(raw); }
    catch (e) { return null; }
  }

  function clearAllAuth() {
    ['admin', 'principal', 'staff', 'teacher', 'parent', 'student'].forEach((role) => {
      setToken(role, '');
      setProfile(role, null);
    });
  }

  function isAdminPortalRole(role) {
    return role === 'admin' || role === 'principal' || role === 'staff';
  }

  /** Prefer Admin token, then Principal, then Staff. */
  function resolveAdminPortalRole() {
    if (getToken('admin')) return 'admin';
    if (getToken('principal')) return 'principal';
    if (getToken('staff')) return 'staff';
    return '';
  }

  function hasPermission(profileOrPerms, key) {
    if (!key) return true;
    let perms = [];
    if (profileOrPerms && isAdminPortalRole(profileOrPerms.role) && profileOrPerms.role === 'admin') {
      return true;
    }
    // Principal = full admin portal (Consents and other new tabs stay visible)
    if (profileOrPerms && profileOrPerms.role === 'principal') return true;
    if (Array.isArray(profileOrPerms)) perms = profileOrPerms;
    else if (profileOrPerms && Array.isArray(profileOrPerms.permissions)) perms = profileOrPerms.permissions;
    if (perms.includes('*')) return true;
    // Legacy principal with empty perms = full access
    if (profileOrPerms && profileOrPerms.role === 'principal' && !perms.length) return true;
    if (key === 'admin.consents' &&
        (perms.indexOf('admin.bus') >= 0 || perms.indexOf('admin.announcements') >= 0) &&
        perms.filter(function (k) { return String(k).indexOf('admin.') === 0; }).length >= 5) {
      return true;
    }
    if (key === 'admin.lostFound' &&
        (perms.indexOf('admin.bus') >= 0 || perms.indexOf('admin.announcements') >= 0 ||
         perms.indexOf('admin.materials') >= 0)) {
      return true;
    }
    return perms.indexOf(key) >= 0;
  }

  function getSavedLogin() {
    try {
      const raw = localStorage.getItem(SAVED_LOGIN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return {
        loginId: String(data.loginId || ''),
        password: String(data.password || ''),
        staySignedIn: data.staySignedIn !== false,
        savePassword: data.savePassword === true
      };
    } catch (e) {
      return null;
    }
  }

  function setSavedLogin(opts) {
    opts = opts || {};
    if (!opts.savePassword) {
      localStorage.removeItem(SAVED_LOGIN_KEY);
      return;
    }
    localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({
      loginId: String(opts.loginId || ''),
      password: String(opts.password || ''),
      staySignedIn: opts.staySignedIn !== false,
      savePassword: true
    }));
  }

  async function api(path, options, role) {
    const opts = Object.assign({ headers: { Accept: 'application/json' } }, options || {});
    const token = getToken(role);
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, opts);
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { /* ignore */ }
    if (!res.ok) {
      const detail = data.error || data.message || data.detail;
      const err = new Error(detail || (res.statusText ? (res.statusText + ' (' + res.status + ')') : ('Request failed (' + res.status + ')')));
      err.status = res.status;
      err.data = data;
      // Surface any extra structured flags from the API error payload (e.g.
      // needsConfirm, mustChangePassword) directly on the Error for callers
      // that want to branch on them without re-parsing err.data.
      Object.keys(data || {}).forEach((k) => {
        if (k !== 'error' && k !== 'message' && !(k in err)) err[k] = data[k];
      });
      throw err;
    }
    return data;
  }

  function $(id) { return document.getElementById(id); }

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /**
   * Shrink signature images before upload so they fit durable Sheets storage
   * and still look sharp on the report card.
   */
  function prepareSignatureFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No signature file selected.'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 720;
          const maxH = 260;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.min(1, maxW / w, maxH / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Could not process signature image.'));
            resolve(new File([blob], 'signature.png', { type: 'image/png' }));
          }, 'image/png');
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read signature image.'));
      };
      img.src = url;
    });
  }

  /**
   * Show/hide toggle for password inputs. Auto-wires every
   * `input[type="password"]` on the page (including ones added later by
   * dynamic renders like admin forms or the change-password modal) via a
   * MutationObserver, so no per-page wiring is needed.
   */
  const EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 4.22-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  function wirePasswordToggle(input) {
    if (!input || input.dataset.pwToggled || !input.parentNode) return;
    input.dataset.pwToggled = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pw-field';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle-btn';
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = EYE_ICON;
    wrap.appendChild(btn);
    btn.addEventListener('click', function () {
      const willShow = input.type === 'password';
      input.type = willShow ? 'text' : 'password';
      btn.innerHTML = willShow ? EYE_OFF_ICON : EYE_ICON;
      btn.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
    });
  }

  function autoWirePasswordToggles(root) {
    (root || document).querySelectorAll('input[type="password"]:not([data-pw-toggled])').forEach(wirePasswordToggle);
  }

  if (typeof document !== 'undefined') {
    autoWirePasswordToggles(document);
    if (typeof MutationObserver !== 'undefined') {
      const pwObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          (m.addedNodes || []).forEach(function (node) {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('input[type="password"]')) wirePasswordToggle(node);
            if (node.querySelectorAll) autoWirePasswordToggles(node);
          });
        });
      });
      const startObserving = function () {
        pwObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
      };
      if (document.body) startObserving();
      else document.addEventListener('DOMContentLoaded', startObserving);
    }
  }

  global.SaltApp = {
    API,
    getToken,
    setToken,
    getProfile,
    setProfile,
    clearAllAuth,
    isAdminPortalRole,
    resolveAdminPortalRole,
    hasPermission,
    authPersistEnabled,
    setAuthPersist,
    getSavedLogin,
    setSavedLogin,
    api,
    $,
    show,
    hide,
    todayISO,
    escapeHtml,
    prepareSignatureFile,
    wirePasswordToggle,
    autoWirePasswordToggles
  };
})(window);
