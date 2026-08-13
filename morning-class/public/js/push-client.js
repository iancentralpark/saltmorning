/* Salt Morning — shared web push client (all roles) */
window.SaltPush = (function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
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
    return { ok: true };
  }

  function bindButtons(opts) {
    const api = opts.api;
    const enableBtn = opts.enableBtn;
    const disableBtn = opts.disableBtn;
    const statusEl = opts.statusEl;
    const t = opts.t || function (k, f) { return f || k; };
    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        try {
          await enable(api);
          if (statusEl) statusEl.textContent = t('push.on', 'Notifications on');
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
        } catch (e) {
          if (statusEl) statusEl.textContent = e.message || 'Failed';
        }
      });
    }
  }

  return { enable, disable, bindButtons };
})();

/* Back-compat alias used by parent portal */
window.SaltParentPush = window.SaltPush;
