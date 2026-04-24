import { useEffect, useRef } from 'react';

const SW_PATH = '/firebase-messaging-sw.js';
const CONFIG_URL = '/.netlify/functions/vendor-firebase-config';
const REGISTER_URL = '/.netlify/functions/vendor-register-push';
const TOKEN_KEY = 'jlv_fcm_token';

export function usePushNotifications(vendorId: string | null) {
  const initialised = useRef(false);

  useEffect(() => {
    if (!vendorId || initialised.current) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    initialised.current = true;
    initPush(vendorId).catch((err) =>
      console.warn('[push] init failed:', err?.message ?? err)
    );
  }, [vendorId]);
}

async function initPush(vendorId: string) {
  // 1. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  // 2. Register service worker
  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  await navigator.serviceWorker.ready;

  // 3. Fetch Firebase config + VAPID key
  const res = await fetch(CONFIG_URL);
  const { config, vapidKey } = await res.json();
  if (!config?.projectId || !vapidKey) {
    console.warn('[push] Firebase not configured on server');
    return;
  }

  // 4. Dynamically import Firebase (avoids bundling Firebase in main bundle)
  const [{ initializeApp, getApps }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js' as any),
  ]);

  // Prevent double-init across HMR / strict mode
  const existing = getApps().find((a: any) => a.name === 'vendor-portal');
  const app = existing ?? initializeApp(config, 'vendor-portal');

  const { getMessaging, getToken, onMessage } = await import(
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js' as any
  );

  const messaging = getMessaging(app);

  // 5. Get FCM token
  const fcmToken: string = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!fcmToken) return;

  // Skip re-registration if same token
  const cached = localStorage.getItem(TOKEN_KEY);
  if (cached === fcmToken) return;

  // 6. Register token with backend
  await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor_id: vendorId, fcm_token: fcmToken }),
  });

  localStorage.setItem(TOKEN_KEY, fcmToken);

  // 7. Foreground message handler — show a basic in-app toast via custom event
  onMessage(messaging, (payload: any) => {
    const n = payload.notification ?? payload.data ?? {};
    window.dispatchEvent(
      new CustomEvent('vendor-push', {
        detail: { title: n.title ?? 'New notification', body: n.body ?? '', data: payload.data ?? {} },
      })
    );
  });
}
