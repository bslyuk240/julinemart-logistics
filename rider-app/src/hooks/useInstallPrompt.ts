import { useInstallPrompt as useSharedInstallPrompt } from '../lib/installPrompt';

// Thin wrapper over lib/installPrompt, which captures `beforeinstallprompt` at
// app start. Listening here instead (Home mounts only after login) missed the
// event entirely, so the native "Install app" button never showed.
//
// platform:
//  'android' — native install dialog available (any Chromium browser)
//  'ios'     — iPhone/iPad Safari Share-sheet steps
//  'manual'  — touch device without a native prompt: browser-menu steps
export function useInstallPrompt() {
  // 'jlr' keeps the existing localStorage key (jlr_install_dismissed_at).
  const { mode, install, dismiss } = useSharedInstallPrompt('jlr');
  const platform: 'android' | 'ios' | 'manual' | null = mode === 'prompt' ? 'android' : mode;
  return { eligible: platform !== null, platform, promptInstall: install, dismiss };
}
