import { useEffect, useRef } from 'react';

const JLO_BASE = ((import.meta.env.VITE_JLO_API_URL as string) || '').replace(/\/$/, '');
const SW_PATH = '/rider-messaging-sw.js';
const CONFIG_URL = `${JLO_BASE}/.netlify/functions/vendor-firebase-config`;
const REGISTER_URL = `${JLO_BASE}/.netlify/functions/rider-register-push`;
const TOKEN_KEY = 'jlr_fcm_token';

export function usePushNotifications(riderId: string | null) {
  const initialised = useRef(false);

  useEffect(() => {
    if (!riderId || initialised.current) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    initialised.current = true;
    initPush(riderId).catch((err) => console.warn('[push] init failed:', err?.message ?? err));
  }, [riderId]);
}

async function initPush(riderId: string) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  await navigator.serviceWorker.ready;

  const res = await fetch(CONFIG_URL);
  const { config, vapidKey } = await res.json();
  if (!config?.projectId || !vapidKey) {
    console.warn('[push] Firebase not configured on server');
    return;
  }

  const [{ initializeApp, getApps }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js' as any),
  ]);

  const existing = getApps().find((a: any) => a.name === 'rider-app');
  const app = existing ?? initializeApp(config, 'rider-app');

  const { getMessaging, getToken, onMessage } = await import(
    'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js' as any
  );

  const messaging = getMessaging(app);

  const fcmToken: string = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!fcmToken) return;

  const cached = localStorage.getItem(TOKEN_KEY);
  if (cached === fcmToken) return;

  await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rider_id: riderId, fcm_token: fcmToken }),
  });

  localStorage.setItem(TOKEN_KEY, fcmToken);

  onMessage(messaging, (payload: any) => {
    const n = payload.notification ?? payload.data ?? {};
    window.dispatchEvent(
      new CustomEvent('rider-push', {
        detail: { title: n.title ?? 'New notification', body: n.body ?? '', data: payload.data ?? {} },
      })
    );
  });
}
