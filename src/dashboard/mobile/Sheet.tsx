import { ReactNode, useEffect } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
}

// Generic bottom sheet — position:fixed so it stays pinned to the viewport
// regardless of which scrolling screen mounts it (MobileShell's <main> is
// the scroll container, but fixed descendants ignore it).
export function Sheet({ open, onClose, children, ariaLabel }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[84vh] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white px-4 pb-6 pt-2.5 transition-transform duration-300 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        <span className="mx-auto h-1 w-9 shrink-0 rounded-full bg-gray-200" />
        {children}
      </div>
    </>
  );
}
