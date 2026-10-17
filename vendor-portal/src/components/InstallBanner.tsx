import { useState } from 'react';
import { Download, MoreVertical, Share, X } from 'lucide-react';
import { useInstallPrompt } from '../lib/installPrompt';

// Install-as-app banner. Shown on phones AND tablets (anything touch), plus
// desktop Chromium when the browser offers a native install dialog.
export function InstallBanner({ appKey, appName, iconSrc }: { appKey: string; appName: string; iconSrc: string }) {
  const { mode, install, dismiss } = useInstallPrompt(appKey);
  const [installing, setInstalling] = useState(false);

  if (!mode) return null;

  const onInstall = async () => {
    setInstalling(true);
    try {
      await install();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="mx-4 mt-4 md:mx-6 lg:mx-8 rounded-2xl border border-primary-100 bg-primary-50 p-4">
      <div className="flex items-start gap-3">
        <img src={iconSrc} alt="" className="h-11 w-11 shrink-0 rounded-xl" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">Install the {appName} app</p>
          <p className="mt-0.5 text-xs text-gray-600">
            Opens full-screen from your home screen or app list, like a normal app.
          </p>

          {mode === 'prompt' && (
            <button
              type="button"
              onClick={onInstall}
              disabled={installing}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {installing ? 'Installing…' : 'Install app'}
            </button>
          )}

          {mode === 'manual' && (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-700">
              <li>
                Tap <MoreVertical className="inline h-3.5 w-3.5 -mt-0.5" /> at the top-right of Chrome.
              </li>
              <li>
                Tap <span className="font-semibold">Install app</span>. If you only see{' '}
                <span className="font-semibold">Add to home screen</span>, tap it and choose{' '}
                <span className="font-semibold">Install</span>, not “Create shortcut”.
              </li>
            </ol>
          )}

          {mode === 'ios' && (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-700">
              <li>
                Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> <span className="font-semibold">Share</span> in
                Safari (top-right on iPad, bottom on iPhone).
              </li>
              <li>
                Tap <span className="font-semibold">Add to Home Screen</span>, then <span className="font-semibold">Add</span>.
              </li>
            </ol>
          )}
        </div>

        <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
