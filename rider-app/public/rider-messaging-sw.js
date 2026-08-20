/* JulineMart Dispatch (rider app) — Firebase Cloud Messaging Service Worker */

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// vendor-firebase-config is generic (just Firebase project config) — the
// rider app reuses the same JLO backend endpoint rather than duplicating it.
const CONFIG_URL = self.location.hostname === 'localhost'
  ? 'http://localhost:8888/.netlify/functions/vendor-firebase-config'
  : 'https://jlo.julinemart.com/.netlify/functions/vendor-firebase-config';

let messaging = null;

async function initFirebase() {
  if (messaging) return messaging;
  try {
    const res = await fetch(CONFIG_URL);
    const { config } = await res.json();
    if (!config.projectId) return null;
    firebase.initializeApp(config);
    messaging = firebase.messaging();
    return messaging;
  } catch (err) {
    console.error('[rider-sw] Firebase init failed:', err);
    return null;
  }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { notification: { title: 'New notification' } }; }

  const n = payload.notification ?? payload.data ?? {};
  const title = n.title || 'JulineMart Dispatch';
  const body = n.body || '';
  const data = payload.data || {};

  await self.registration.showNotification(title, {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: data.sub_order_id || 'julinemart-dispatch',
    data,
    vibrate: [200, 100, 200],
    requireInteraction: true,
  });
}

initFirebase().then((msg) => {
  if (!msg) return;
  msg.onBackgroundMessage((payload) => {
    const n = payload.notification ?? {};
    const data = payload.data ?? {};
    const title = n.title || 'JulineMart Dispatch';
    const body = n.body || '';

    self.registration.showNotification(title, {
      body,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: data.sub_order_id || 'julinemart-dispatch',
      data,
      vibrate: [200, 100, 200],
      requireInteraction: true,
    });
  });
});

// Notification click — routes to the push payload's own targetPath
// (data.targetPath), same value the backend already sends on every rider
// push (e.g. '/', '/profile'). Safe here specifically because this service
// worker only ever receives pushes sent to THIS rider's own FCM token —
// every sender (assign-rider.js, broadcast-rider.js, etc.) already targets
// rider-app routes, never a customer-PWA path. Only accept a same-origin
// relative path (starts with a single '/', not '//') as a defensive check
// against an unexpected payload shape.
function safeTargetPath(data) {
  const path = data?.targetPath;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = safeTargetPath(event.notification.data);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetPath);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetPath);
    })
  );
});
