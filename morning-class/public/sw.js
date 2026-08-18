/* Salt Morning — web push service worker (all roles) */
self.addEventListener('push', (event) => {
  let data = { title: 'Salt Morning', body: 'New update', url: '/' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_) {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch (__) { /* ignore */ }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Salt Morning', {
      body: data.body || '',
      data: { url: data.url || '/' },
      icon: '/apple-touch-icon.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
