import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

interface ToastPayload { title: string; body: string; }

export default function PushNotificationManager() {
  const { vendor } = useAuth();
  const [toast, setToast] = useState<ToastPayload | null>(null);

  usePushNotifications(vendor?.id ?? null);

  // Listen for foreground push events dispatched by the hook
  useEffect(() => {
    const handler = (e: Event) => {
      const { title, body } = (e as CustomEvent).detail as ToastPayload;
      setToast({ title, body });
      setTimeout(() => setToast(null), 6000);
    };
    window.addEventListener('vendor-push', handler);
    return () => window.removeEventListener('vendor-push', handler);
  }, []);

  if (!toast) return null;

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm w-full bg-white border border-purple-200 rounded-xl shadow-lg p-4 flex gap-3 items-start animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-bold">
        J
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm truncate">{toast.title}</p>
        {toast.body && <p className="text-gray-600 text-xs mt-0.5">{toast.body}</p>}
      </div>
      <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}
