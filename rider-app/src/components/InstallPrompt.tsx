import { Download, Share, SquarePlus, X } from 'lucide-react';

export function InstallPrompt({
  platform,
  onInstall,
  onDismiss,
}: {
  platform: 'android' | 'ios';
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute top-4 right-4 text-gray-400"
        >
          <X className="w-5 h-5" />
        </button>

        <img src="/icon-192.png" alt="" className="w-14 h-14 rounded-xl" />
        <h3 className="mt-4 text-base font-bold text-gray-900">Install JulineMart Dispatch</h3>
        <p className="mt-1 text-sm text-gray-500">
          Add it to your home screen for one-tap access to jobs and delivery alerts — no browser tabs to dig
          through.
        </p>

        {platform === 'android' ? (
          <button
            type="button"
            onClick={onInstall}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white"
          >
            <Download className="w-4 h-4" />
            Install app
          </button>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary-50 flex items-center justify-center shrink-0 text-xs font-bold text-primary-600">
                1
              </div>
              <p className="text-sm text-gray-700 pt-0.5">
                Tap the <Share className="w-3.5 h-3.5 inline -mt-0.5" /> Share icon in Safari's toolbar
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary-50 flex items-center justify-center shrink-0 text-xs font-bold text-primary-600">
                2
              </div>
              <p className="text-sm text-gray-700 pt-0.5">
                Scroll down and tap <SquarePlus className="w-3.5 h-3.5 inline -mt-0.5" /> "Add to Home Screen"
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-primary-50 flex items-center justify-center shrink-0 text-xs font-bold text-primary-600">
                3
              </div>
              <p className="text-sm text-gray-700 pt-0.5">Tap "Add" in the top-right corner</p>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              className="mt-2 w-full rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-600"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
