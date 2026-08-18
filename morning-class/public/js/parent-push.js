/* Salt Morning — parent web push opt-in */
window.SaltParentPush = (function () {
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
      throw new Error('This browser does not support web push. Try Chrome/Safari (home screen).');
    }
    const info = await api('/api/parent/push/public-key');
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
    await api('/api/parent/push/subscribe', {
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
    await api('/api/parent/push/unsubscribe', {
      method: 'POST',
      body: { endpoint }
    });
    return { ok: true };
  }

  return { enable, disable };
})();
