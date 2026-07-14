/* My Lil Famz — service worker
   Caches the app shell so it can be installed as a PWA and work offline.
   Bump CACHE_VERSION whenever you change index.html so users get the update. */
const CACHE_VERSION = 'mylilfamz-v5';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // API responses: network-first. This app mutates data constantly (approve
  // task, redeem reward, feed pet, choose pet...) and every action immediately
  // re-fetches to show the result — stale-while-revalidate was serving the
  // OLD cached response first in that exact moment, making actions look like
  // they did nothing even though they'd actually succeeded (the fresh data
  // only landed in the cache for NEXT time, with nothing to trigger a
  // re-render when it arrived). Cache is now only a fallback for offline use.
  if (req.url.includes('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.open(CACHE_VERSION).then((cache) => cache.match(req))
        )
    );
    return;
  }

  // HTML: network-first so updates show up; fallback to cache.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => cached))
  );
});

// Allow the page to trigger notifications through the SW (works better on mobile).
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = data;
    self.registration.showNotification(title || 'My Lil Famz', {
      body: body || '',
      tag: tag || 'mylilfamz',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [120, 60, 120],
      renotify: true
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/index.html');
    })
  );
});

// Stage 4: Push notifications from server
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'Reminder from My Lil Famz',
    tag: data.tag || 'reminder',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [120, 60, 120],
    renotify: true,
    data: data.data || {}
  };

  event.waitUntil(self.registration.showNotification(data.title || 'My Lil Famz', options));
});

// Stage 4: Background sync untuk offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-tasks') {
    event.waitUntil(
      // This will be triggered when device comes online
      // Frontend can queue actions and sync when ready
      Promise.resolve()
    );
  }
});

// Periodic background sync untuk check reminders (jika di-enable)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    event.waitUntil(
      // Check for pending reminders setiap X menit
      fetch('/api/reminders')
        .then(() => console.log('Reminders checked'))
        .catch(() => console.log('Reminders check failed - offline'))
    );
  }
});
