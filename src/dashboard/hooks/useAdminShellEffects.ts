import { useEffect } from 'react';

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
// tab-bar shell (MobileShell) so the manifest link and service worker
// registration can't drift between the two surfaces. The install prompt itself
// lives in lib/installPrompt (captured at app start) + AdminInstallBanner.
//
// Open to every role, not just admin — this was previously admin-only; the
// mobile build confirmed that restriction should lift since agents/managers
// working from a hub need to install to the home screen too. The route is
// already gated by ProtectedRoute, so anything mounting this hook has a
// legitimate staff session.
export function useAdminShellEffects() {
  useEffect(() => {
    document.body.classList.add('admin-shell');
    return () => {
      document.body.classList.remove('admin-shell');
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
}
