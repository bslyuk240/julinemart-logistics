import { useEffect, useState } from 'react';

// Chrome fires `beforeinstallprompt` once per page load — usually on whatever
// screen is open first (often the login page), long before the logged-in
// layout that shows our install banner has mounted. A listener added in that
// layout misses it, and the "Install app" button never appears. So capture the
// event here, at module load (imported from main.tsx), and let the banner read
// it whenever it renders.

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    justInstalled = true;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iPadOS Safari reports itself as desktop Mac ("MacIntel"), so the UA test
// alone misses every iPad; a Mac with touch points is an iPad.
export function isIOS(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Feature-based rather than UA-based: Chrome on large Android tablets defaults
// to the desktop site, which drops "Android" from the user agent.
export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  // A captured event can only be prompted once.
  deferredPrompt = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  // Hide the banner straight away instead of waiting for `appinstalled`.
  if (outcome === 'accepted') justInstalled = true;
  notify();
  return outcome;
}

export type InstallMode = 'prompt' | 'ios' | 'manual' | null;

const DISMISS_KEY_SUFFIX = '_install_dismissed_at';
const REPROMPT_DAYS = 7;

function readDismissedAt(key: string): number {
  try {
    return Number(localStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
}

function writeDismissedAt(key: string) {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Private mode / blocked storage: the banner just comes back next load.
  }
}

// mode:
//  'prompt' — the browser handed us a native install dialog (Android/desktop Chromium)
//  'ios'    — iPhone/iPad Safari: no install API, show the Share-sheet steps
//  'manual' — touch device with no native prompt yet: show the browser-menu steps
//  null     — installed, dismissed recently, or a non-touch desktop without a prompt
//
// repromptDays: how long a dismissal is remembered across page loads. 0 means
// dismiss only hides it until the next fresh page load.
export function useInstallPrompt(appKey: string, repromptDays = REPROMPT_DAYS) {
  const dismissKey = `${appKey}${DISMISS_KEY_SUFFIX}`;
  const [, setVersion] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(() => readDismissedAt(dismissKey));
  const [dismissedThisLoad, setDismissedThisLoad] = useState(false);

  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const installed = justInstalled || isStandalone();
  const coolingDown = dismissedThisLoad || Date.now() - dismissedAt < repromptDays * 24 * 60 * 60 * 1000;

  let mode: InstallMode = null;
  if (!installed && !coolingDown) {
    if (deferredPrompt) mode = 'prompt';
    else if (isIOS()) mode = 'ios';
    else if (isTouchDevice()) mode = 'manual';
  }

  const dismiss = () => {
    setDismissedThisLoad(true);
    if (repromptDays > 0) {
      writeDismissedAt(dismissKey);
      setDismissedAt(Date.now());
    }
  };

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'dismissed') dismiss();
    return outcome;
  };

  return { mode, install, dismiss };
}
