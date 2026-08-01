import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { useAdminShellEffects } from '../hooks/useAdminShellEffects';

function isLocalAdminDev(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  );
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function detectAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/.test(navigator.userAgent.toLowerCase());
}

export function AdminInstallBanner() {
  const { canInstallApp, handleInstallApp, hasInstallPrompt, isInstalled } = useAdminShellEffects();
  // In-memory only — banner returns on every fresh page load until the PWA is installed.
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const isIos = detectIos();
  const isAndroid = detectAndroid();

  if (isLocalAdminDev() || isInstalled || dismissed || !canInstallApp) {
    return null;
  }

  // Only surface on mobile browsers where home-screen install is relevant.
  if (!isIos && !isAndroid && !hasInstallPrompt) {
    return null;
  }

  const dismiss = () => setDismissed(true);

  const onInstallClick = async () => {
    if (!hasInstallPrompt) return;
    setInstalling(true);
    try {
      await handleInstallApp();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="border-b border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-900/50 dark:bg-primary-950/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
          <Smartphone className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">Install JLO App</p>
          <p className="mt-0.5 text-xs leading-snug text-primary-800/80 dark:text-primary-200/80">
            Add the admin dashboard to your home screen for quick access.
          </p>

          {isAndroid && hasInstallPrompt && (
            <button
              type="button"
              onClick={onInstallClick}
              disabled={installing}
              className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              {installing ? 'Installing…' : 'Install app'}
            </button>
          )}

          {isAndroid && !hasInstallPrompt && (
            <p className="mt-2 text-xs leading-relaxed text-primary-900/90 dark:text-primary-100/90">
              Tap <span className="font-semibold">⋮</span> in Chrome, then choose{' '}
              <span className="font-semibold">Install app</span> or{' '}
              <span className="font-semibold">Add to Home screen</span>.
            </p>
          )}

          {isIos && (
            <ol className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-primary-900/90 dark:text-primary-100/90">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[10px] font-bold text-white">
                  1
                </span>
                <span className="pt-0.5">
                  Tap <Share className="mx-0.5 inline h-3.5 w-3.5 align-text-bottom" />{' '}
                  <span className="font-semibold">Share</span> at the bottom of Safari.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[10px] font-bold text-white">
                  2
                </span>
                <span className="pt-0.5">
                  Scroll and tap <span className="font-semibold">Add to Home Screen</span>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[10px] font-bold text-white">
                  3
                </span>
                <span className="pt-0.5">
                  Tap <span className="font-semibold">Add</span> in the top-right corner.
                </span>
              </li>
            </ol>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install banner"
          className="shrink-0 rounded-md p-1 text-primary-700/70 transition-colors hover:bg-primary-100 hover:text-primary-900 dark:text-primary-300/70 dark:hover:bg-primary-900/40 dark:hover:text-primary-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
