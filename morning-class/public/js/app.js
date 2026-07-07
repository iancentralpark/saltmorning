(function(global) {
  const API = location.origin;

  function getToken(role) {
    return localStorage.getItem('salt_' + role + '_token') || '';
  }

  function setToken(role, token) {
    if (token) localStorage.setItem('salt_' + role + '_token', token);
    else localStorage.removeItem('salt_' + role + '_token');
  }

  function setProfile(role, profile) {
    if (profile) localStorage.setItem('salt_' + role + '_profile', JSON.stringify(profile));
    else localStorage.removeItem('salt_' + role + '_profile');
  }

  function getProfile(role) {
    try { return JSON.parse(localStorage.getItem('salt_' + role + '_profile') || 'null'); }
    catch (e) { return null; }
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
    if (!res.ok) throw new Error(data.error || res.statusText || 'Request failed');
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

  global.SaltApp = {
    API, getToken, setToken, getProfile, setProfile, api, $, show, hide, todayISO, escapeHtml
  };
})(window);
