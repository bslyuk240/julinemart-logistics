import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

function readMatch(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
}

// Viewport-based, not user-agent sniffing, so resizing/rotating a device
// (or a desktop devtools resize) updates the shell live rather than sticking
// to whatever the browser claimed on first load.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(readMatch);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = () => setIsMobile(mql.matches);

    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
