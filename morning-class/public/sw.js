/* Salt Morning — parent web push service worker */
self.addEventListener('push', (event) => {
  let data = { title: 'Salt Morning', body: 'New message', url: '/parent' };
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
      data: { url: data.url || '/parent' },
      icon: '/favicon.ico'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/parent';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
