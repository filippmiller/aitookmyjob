// Service Worker for AI Took My Job
const CACHE_NAME = 'aitookmyjob-v2';
const STATIC_CACHE = 'static-v2';
const DATA_CACHE = 'data-v2';

const STATIC_FILES = [
  '/',
  '/index.html',
  '/forum.html',
  '/styles.css',
  '/app.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=JetBrains+Mono:wght@100..800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(n => n !== STATIC_CACHE && n !== DATA_CACHE && n !== CACHE_NAME)
          .map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: network-first with cache fallback
  if (url.pathname.startsWith('/api/') && request.method === 'GET') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(DATA_CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || new Response(JSON.stringify({ error: 'Offline', offline: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          )
        )
    );
    return;
  }

  // Static assets: cache-first
  if (isStatic(request)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});

function isStatic(request) {
  const p = new URL(request.url).pathname;
  return /\.(css|js|png|jpg|jpeg|gif|svg|woff2?)$/.test(p) || p === '/' || p.startsWith('/i18n/');
}

// Background sync for offline story submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'submit-story') {
    event.waitUntil(Promise.resolve());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || 'general',
      data: payload.data
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
