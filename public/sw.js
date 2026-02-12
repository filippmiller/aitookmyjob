// Service Worker for AI Took My Job - 2026 Edition
// Implements advanced caching strategies and offline functionality

const CACHE_NAME = 'aitookmyjob-v2026.1';
const STATIC_CACHE = 'static-v2026.1';
const DATA_CACHE = 'data-v2026.1';

// Files to cache statically
const STATIC_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/i18n/en.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap',
  'https://unpkg.com/@phosphor-icons/web@2.0.3/dist/phosphor.css',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE)
        .then(cache => {
          console.log('Service Worker: Caching static assets');
          return cache.addAll(STATIC_FILES);
        }),
      self.skipWaiting() // Activate immediately
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== STATIC_CACHE && name !== DATA_CACHE)
            .map(name => caches.delete(name))
        );
      }),
      self.clients.claim() // Take control of all clients
    ])
  );
});

// Fetch event - implement advanced caching strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle API requests with network-first strategy
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET') {
      event.respondWith(
        handleApiRequest(request)
      );
    }
    return;
  }
  
  // Handle static assets with cache-first strategy
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          return response || fetch(request);
        })
    );
    return;
  }
  
  // Handle everything else with network-first, fallback to cache
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        const networkResponsePromise = fetch(request);
        
        // Update cache in the background
        networkResponsePromise.then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, responseClone));
          }
        });
        
        return cachedResponse || networkResponsePromise;
      })
  );
});

// Handle API requests with smart caching
async function handleApiRequest(request) {
  const cache = await caches.open(DATA_CACHE);
  const cachedResponse = await cache.match(request);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // If successful, update cache
    if (networkResponse.ok) {
      const responseClone = networkResponse.clone();
      await cache.put(request, responseClone);
    }
    
    return networkResponse;
  } catch (error) {
    // If network fails, return cached response
    if (cachedResponse) {
      console.log(`Returning cached response for ${request.url}`);
      return cachedResponse;
    }
    
    // If no cache, return error response
    return new Response(JSON.stringify({ 
      error: 'Offline - data may be stale', 
      offline: true 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Determine if request is for static asset
function isStaticAsset(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  return pathname.endsWith('.css') ||
         pathname.endsWith('.js') ||
         pathname.endsWith('.png') ||
         pathname.endsWith('.jpg') ||
         pathname.endsWith('.jpeg') ||
         pathname.endsWith('.gif') ||
         pathname.endsWith('.svg') ||
         pathname.endsWith('.woff2') ||
         pathname === '/' ||
         pathname.startsWith('/i18n/');
}

// Background sync for offline story submissions
self.addEventListener('sync', (event) => {
  if (event.tag === 'submit-story') {
    event.waitUntil(syncPendingStories());
  }
});

// Sync pending stories when back online
async function syncPendingStories() {
  try {
    const pendingStories = await getPendingStories();
    
    for (const story of pendingStories) {
      const response = await fetch('/api/stories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(story.data)
      });
      
      if (response.ok) {
        // Remove from pending list
        await removePendingStory(story.id);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Get pending stories from IndexedDB
async function getPendingStories() {
  // Implementation would use IndexedDB
  // For now, return empty array
  return [];
}

// Remove pending story from IndexedDB
async function removePendingStory(id) {
  // Implementation would use IndexedDB
}

// Push notifications handler
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const payload = event.data.json();
  
  const options = {
    body: payload.body,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: payload.tag || 'general',
    data: payload.data
  };
  
  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});

// Periodic background sync for data updates
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-stats') {
    event.waitUntil(updateCachedStats());
  }
});

// Update cached statistics
async function updateCachedStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    
    const cache = await caches.open(DATA_CACHE);
    await cache.put('/api/stats', new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (error) {
    console.error('Failed to update stats:', error);
  }
}

// Cache important user data
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  if (type === 'cache-user-data') {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(`/api/users/${data.userId}`, new Response(JSON.stringify(data.userData), {
      headers: { 'Content-Type': 'application/json' }
    }));
  }
});