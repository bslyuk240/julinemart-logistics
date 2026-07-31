import { ReactNode, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

const PULL_THRESHOLD = 64;
const MAX_PULL = 96;

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

// Uses Pointer Events (not raw Touch Events) so the same code path handles a
// finger on a phone and a mouse drag in a desktop browser — that's also what
// makes this testable at all without physical touch hardware. Only starts
// tracking a pull when the nearest ".admin-main-scroll" ancestor (MobileShell's
// scroll container) is already at scrollTop 0, so it never fights normal
// scrolling.
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onPointerDown = (event: React.PointerEvent) => {
    const scroller = wrapperRef.current?.closest('.admin-main-scroll') as HTMLElement | null;
    if (!scroller || scroller.scrollTop > 0 || refreshing) return;
    scrollerRef.current = scroller;
    startY.current = event.clientY;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (startY.current == null || !scrollerRef.current) return;
    const delta = event.clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    if (scrollerRef.current.scrollTop > 0) {
      startY.current = null;
      setPull(0);
      return;
    }
    event.preventDefault();
    setPull(Math.min(delta * 0.5, MAX_PULL));
  };

  const endPull = async () => {
    const shouldRefresh = pull >= PULL_THRESHOLD;
    startY.current = null;
    scrollerRef.current = null;
    if (shouldRefresh) {
      setRefreshing(true);
      setPull(PULL_THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  };

  return (
    <div
      ref={wrapperRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPull}
      onPointerCancel={endPull}
      style={{ touchAction: pull > 0 ? 'none' : 'pan-y' }}
    >
      <div
        aria-hidden="true"
        className="flex items-center justify-center overflow-hidden text-gray-400"
        style={{ height: pull, transition: startY.current ? 'none' : 'height 180ms ease' }}
      >
        <Loader2 className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} style={{ opacity: Math.min(pull / PULL_THRESHOLD, 1) }} />
      </div>
      {children}
    </div>
  );
}
