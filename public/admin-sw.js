// Admin service worker — network-only (no caching).
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

// Navigation-only pass-through. Nothing is cached — every page load still
// comes from the network. The handler exists because Chrome/Samsung Internet on
// many Android tablets only offer "Install app" (instead of "Create shortcut")
// when the controlling worker has a fetch handler; it also shows a readable
// message instead of the browser's offline dino when the network is down.
// Non-navigation requests (JS, CSS, API) are not intercepted at all.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline</title><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">' +
            '<h1>You are offline</h1><p>The JulineMart admin dashboard needs a network connection. Reconnect and reload.</p>' +
            '<button onclick="location.reload()" style="padding:.6rem 1.2rem">Reload</button></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
