/* Salt Morning — shared web push client (all roles) */
window.SaltPush = (function () {
  const ON_KEY = 'salt_push_on';
  const DISMISS_KEY = 'salt_push_prompt_dismissed';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function isGranted() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return true;
      if (localStorage.getItem(ON_KEY) === '1') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  }

  function findCard(opts) {
    if (opts.cardEl) return opts.cardEl;
    const fromBtn = opts.enableBtn && opts.enableBtn.closest
      && opts.enableBtn.closest('.push-prompt, .pp-push-card, [id$="PushCard"]');
    return fromBtn || null;
  }

  function hideCard(card) {
    if (!card) return;
    card.classList.add('is-on');
    card.hidden = true;
  }

  function showCard(card) {
    if (!card) return;
    card.classList.remove('is-on');
    card.hidden = false;
  }

  async function enable(api) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('This browser does not support web push. Try Chrome or add to Home Screen on iPhone.');
    }
    const info = await api('/api/push/public-key');
    if (!info.enabled || !info.publicKey) {
      throw new Error('Push notifications are not enabled on the server yet.');
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was denied.');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey)
      });
    }
    await api('/api/push/subscribe', {
      method: 'POST',
      body: { subscription: sub.toJSON() }
    });
    try { localStorage.setItem(ON_KEY, '1'); } catch (_) { /* ignore */ }
    return { ok: true };
  }

  async function disable(api) {
    if (!('serviceWorker' in navigator)) return { ok: true };
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    const endpoint = sub ? sub.endpoint : '';
    if (sub) await sub.unsubscribe();
    await api('/api/push/unsubscribe', {
      method: 'POST',
      body: { endpoint }
    });
    try { localStorage.removeItem(ON_KEY); } catch (_) { /* ignore */ }
    return { ok: true };
  }

  function bindButtons(opts) {
    const api = opts.api;
    const enableBtn = opts.enableBtn;
    const disableBtn = opts.disableBtn;
    const dismissBtn = opts.dismissBtn;
    const statusEl = opts.statusEl;
    const card = findCard(opts);
    const t = opts.t || function (k, f) { return f || k; };
    const keepVisibleWhenOn = !!opts.keepVisibleWhenOn;

    function applyHidden() {
      if (keepVisibleWhenOn) return;
      if (isGranted() || isDismissed()) hideCard(card);
    }
    applyHidden();

    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        try {
          await enable(api);
          if (statusEl) statusEl.textContent = t('push.on', 'Notifications on');
          if (!keepVisibleWhenOn) hideCard(card);
        } catch (e) {
          if (statusEl) statusEl.textContent = e.message || 'Failed';
        }
      });
    }
    if (disableBtn) {
      disableBtn.addEventListener('click', async () => {
        try {
          await disable(api);
          if (statusEl) statusEl.textContent = t('push.off', 'Notifications off');
          if (keepVisibleWhenOn) showCard(card);
        } catch (e) {
          if (statusEl) statusEl.textContent = e.message || 'Failed';
        }
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (_) { /* ignore */ }
        hideCard(card);
      });
    }
  }

  return { enable, disable, bindButtons, isGranted };
})();

/* Back-compat alias used by parent portal */
window.SaltParentPush = window.SaltPush;
