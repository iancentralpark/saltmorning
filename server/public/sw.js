const CACHE = 'mrpark-shell-2026-07-13.13';
const SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icon-512.png',
  '/favicon-32.png',
  '/js/messenger-realtime.js',
  '/js/messenger-ui.js',
  '/css/messenger-ui.css'
];

function isAppHtml(pathname) {
  if (pathname === '/class' || pathname === '/teacher' || pathname === '/teacher-login' || pathname === '/student') {
    return true;
  }
  return pathname.startsWith('/tools/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate' && isAppHtml(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  if (isAppHtml(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      }).catch(() => cached);

      if (cached) {
        networkFetch.catch(() => {});
        return cached;
      }
      return networkFetch;
    })
  );
});
