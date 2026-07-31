import { useState } from 'react';
import { Monitor, X } from 'lucide-react';

const DISMISSED_KEY = 'jlo-desk-only-dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

// A banner, not a block — every desktop page we haven't rebuilt for mobile
// still renders underneath this (confirmed on OrderDetails, SupportChatView:
// cramped in places, never actually broken). This just sets expectations
// instead of pretending the page was designed for a phone. Dismissal is one
// flag shared across every desk-only page for the tab's session — dismiss it
// once on any page, it stays dismissed everywhere until the tab closes,
// rather than nagging again on the next unbuilt route.
export function DeskOnlyNotice() {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
      <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="flex-1 text-xs leading-snug text-amber-800">
        This page is built for a bigger screen — some layouts may be tight here.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-amber-600"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
