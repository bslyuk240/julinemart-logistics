const ADMIN_CACHE = 'jm-admin-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(ADMIN_CACHE).then((cache) => cache.addAll(['/login'])).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== ADMIN_CACHE) {
              return caches.delete(key);
            }
            return Promise.resolve();
          }),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isApiRequest =
    requestUrl.pathname.startsWith('/api/') ||
    requestUrl.pathname.startsWith('/.netlify/functions/');
  if (isApiRequest) return;

  const isAdminAsset =
    requestUrl.pathname.startsWith('/admin') ||
    requestUrl.pathname.startsWith('/login') ||
    requestUrl.pathname.startsWith('/forgot-password') ||
    requestUrl.pathname.startsWith('/reset-password') ||
    requestUrl.pathname.startsWith('/assets/');

  if (!isAdminAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(ADMIN_CACHE).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;

        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('/login');
          if (fallback) return fallback;
        }

        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }),
  );
});
