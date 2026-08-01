import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

const ADMIN_MANIFEST_LINK_ID = 'admin-manifest-link';
const ADMIN_MANIFEST_HREF = '/admin-manifest.webmanifest';
const ADMIN_APPLE_TOUCH_ICON_LINK_ID = 'admin-apple-touch-icon-link';
const ADMIN_APPLE_TOUCH_ICON_HREF = '/apple-touch-icon.png';

const isLocalAdminDev = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const ensureHeadLink = (id: string, rel: string, href: string) => {
  const existingLink = document.getElementById(id) as HTMLLinkElement | null;
  if (existingLink) return existingLink;

  const link = document.createElement('link');
  link.id = id;
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
  return link;
};

const removeHeadLink = (id: string) => {
  const link = document.getElementById(id);
  if (link?.parentNode) {
    link.parentNode.removeChild(link);
  }
};

// Shared between the desktop drawer shell (DashboardLayout) and the mobile
// tab-bar shell (MobileShell) so the PWA install prompt, manifest link and
// service worker registration can't drift between the two surfaces.
//
// Open to every role, not just admin — this was previously admin-only; the
// mobile build confirmed that restriction should lift since agents/managers
// working from a hub need to install to the home screen too. The route is
// already gated by ProtectedRoute, so anything mounting this hook has a
// legitimate staff session.
export function useAdminShellEffects() {
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    document.body.classList.add('admin-shell');
    return () => {
      document.body.classList.remove('admin-shell');
    };
  }, []);

  useEffect(() => {
    const checkInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone || isIosStandalone);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPromptEvent(null);
    };

    checkInstalled();

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (isLocalAdminDev()) {
      removeHeadLink(ADMIN_MANIFEST_LINK_ID);
      removeHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID);
      return;
    }

    ensureHeadLink(ADMIN_MANIFEST_LINK_ID, 'manifest', ADMIN_MANIFEST_HREF);
    ensureHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID, 'apple-touch-icon', ADMIN_APPLE_TOUCH_ICON_HREF);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/admin-sw.js', { scope: '/admin/' })
        .catch((error) => {
          console.error('Failed to register admin service worker:', error);
        });
    }

    return () => {
      removeHeadLink(ADMIN_MANIFEST_LINK_ID);
      removeHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID);
    };
  }, []);

  const canInstallApp = !isInstalled;
  const hasInstallPrompt = installPromptEvent !== null;

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;

    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  return { canInstallApp, handleInstallApp, hasInstallPrompt, isInstalled };
}
