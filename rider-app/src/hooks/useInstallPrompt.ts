import { useEffect, useState } from 'react';

const DISMISS_KEY = 'jlr_install_dismissed_at';
const REPROMPT_DAYS = 7;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
}

function cooledDown() {
  const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() - dismissedAt > REPROMPT_DAYS * 24 * 60 * 60 * 1000;
}

// Android/Chrome fires beforeinstallprompt and lets us trigger the native
// install dialog programmatically. iOS Safari doesn't support that API at
// all, so "install" there can only ever be a manual Share-sheet guide.
export function useInstallPrompt() {
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || !cooledDown()) return;

    if (isIOS()) {
      setPlatform('ios');
      return;
    }

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
      setPlatform('android');
    };
    const handleInstalled = () => {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setPlatform(null);
      setDeferredEvent(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setPlatform(null);
    setDeferredEvent(null);
  };

  const promptInstall = async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const { outcome } = await deferredEvent.userChoice;
    setDeferredEvent(null);
    setPlatform(null);
    if (outcome !== 'accepted') localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  return { eligible: platform !== null, platform, promptInstall, dismiss };
}
