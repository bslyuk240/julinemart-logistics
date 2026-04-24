/* JulineMart Vendor Portal — Firebase Cloud Messaging Service Worker */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

let messaging = null;

async function initFirebase() {
  if (messaging) return messaging;
  try {
    const res = await fetch('/.netlify/functions/vendor-firebase-config');
    const { config } = await res.json();
    if (!config.projectId) return null;
    firebase.initializeApp(config);
    messaging = firebase.messaging();
    return messaging;
  } catch (err) {
    console.error('[vendor-sw] Firebase init failed:', err);
    return null;
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Background push messages (app not in foreground)
self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { notification: { title: 'New notification' } }; }

  const n = payload.notification ?? payload.data ?? {};
  const title = n.title || 'JulineMart Vendor';
  const body  = n.body  || '';
  const data  = payload.data || {};

  await self.registration.showNotification(title, {
    body,
    icon:  '/admin-icon-192.png',
    badge: '/favicon.ico',
    tag:   data.order_id || 'julinemart-vendor',
    data,
    vibrate: [200, 100, 200],
    requireInteraction: true,
  });
}

// Firebase background message handler (FCM envelope)
initFirebase().then((msg) => {
  if (!msg) return;
  msg.onBackgroundMessage((payload) => {
    const n = payload.notification ?? {};
    const data = payload.data ?? {};
    const title = n.title || 'JulineMart Vendor';
    const body  = n.body  || '';

    self.registration.showNotification(title, {
      body,
      icon:  '/admin-icon-192.png',
      badge: '/favicon.ico',
      tag:   data.order_id || 'julinemart-vendor',
      data,
      vibrate: [200, 100, 200],
      requireInteraction: true,
    });
  });
});

// Notification click — open/focus the vendor portal
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let path = '/orders';
  if (data.order_id) path = `/orders`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(path);
          return client.focus();
        }
      }
      return self.clients.openWindow(path);
    })
  );
});
