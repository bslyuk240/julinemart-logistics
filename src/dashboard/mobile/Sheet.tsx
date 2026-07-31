import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
}

// Generic bottom sheet — portaled to document.body so z-index always wins over
// MobileShell's fixed tab bar (z-40), which otherwise paints on top when the
// sheet is mounted inside the scrolling <main> subtree.
export function Sheet({ open, onClose, children, ariaLabel }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[100] bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed inset-x-0 bottom-0 z-[110] flex max-h-[84vh] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white px-4 pb-6 pt-2.5 transition-transform duration-300 dark:bg-gray-900 ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        <span className="mx-auto h-1 w-9 shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
        {children}
      </div>
    </>,
    document.body,
  );
}
