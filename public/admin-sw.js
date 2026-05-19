// Admin service worker — network-only.
// Caching is intentionally disabled: the admin dashboard requires live network
// to function and a stale cache causes blank/frozen pages after deploys.
// This file is kept for future push-notification use and to allow graceful
// eviction of any previously-cached version.

const ADMIN_CACHE_PREFIX = 'jm-admin-shell-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Delete ALL previously cached admin shells so stale assets cannot be served
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(ADMIN_CACHE_PREFIX))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// No fetch handler — all requests go straight to the network.
