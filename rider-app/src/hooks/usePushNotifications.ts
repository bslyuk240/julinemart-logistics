import { useCallback, useEffect, useRef, useState } from 'react';

const JLO_BASE = ((import.meta.env.VITE_JLO_API_URL as string) || '').replace(/\/$/, '');
const SW_PATH = '/rider-messaging-sw.js';
const CONFIG_URL = `${JLO_BASE}/.netlify/functions/vendor-firebase-config`;
const REGISTER_URL = `${JLO_BASE}/.netlify/functions/rider-register-push`;
const TOKEN_KEY = 'jlr_fcm_token';

type PermissionState = NotificationPermission | 'unsupported';

// Split from the actual token/registration flow: the browser only lets a
// permission prompt fire from a real user gesture with any decent opt-in
// rate, so this hook never calls requestPermission() on its own — it only
// auto-runs the init flow when permission is already granted, and exposes
// requestPermission() for a UI (NotificationPrompt) to call on tap.
export function usePushNotifications(riderId: string | null) {
  const initialised = useRef(false);
  const [permission, setPermission] = useState<PermissionState>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    if (!riderId || initialised.current) return;
    if (permission !== 'granted') return;

    initialised.current = true;
    initPush(riderId).catch((err) => console.warn('[push] init failed:', err?.message ?? err));
  }, [riderId, permission]);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported' as const;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted' && riderId && !initialised.current) {
      initialised.current = true;
      await initPush(riderId).catch((err) => console.warn('[push] init failed:', err?.message ?? err));
    }
    return result;
  }, [riderId]);

  return { permission, requestPermission };
}

async function initPush(riderId: string) {
  if (!('serviceWorker' in navigator)) return;

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
