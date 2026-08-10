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
    ['admin', 'principal', 'teacher', 'parent', 'student'].forEach((role) => {
      setToken(role, '');
      setProfile(role, null);
    });
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
      throw new Error(detail || (res.statusText ? (res.statusText + ' (' + res.status + ')') : ('Request failed (' + res.status + ')')));
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

  global.SaltApp = {
    API,
    getToken,
    setToken,
    getProfile,
    setProfile,
    clearAllAuth,
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
    prepareSignatureFile
  };
})(window);
