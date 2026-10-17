// Influencer portal service worker — network-only (no caching), so a new
// deploy is always picked up on the next load. It exists to make the portal
// installable as an app (Chrome/Samsung Internet want a worker with a fetch
// handler) and to show a readable page instead of the offline dino.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline</title><body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">' +
            '<h1>You are offline</h1><p>Reconnect to the internet and reload to see your coupon stats.</p>' +
            '<button onclick="location.reload()" style="padding:.6rem 1.2rem">Reload</button></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
    ),
  );
});
