import { useEffect, useState } from "react";

const BANNER_ID = "dev-banner";

/**
 * Measures the banner's actual rendered height instead of assuming a fixed
 * value. On narrow viewports the banner text wraps to two lines, so a
 * hardcoded height (previously 36px, sized for the single-line desktop
 * case) left the mobile shell header rendering partly underneath it.
 */
export function useDevBannerHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const el = document.getElementById(BANNER_ID);
    if (!el) return;
    // contentRect excludes padding/border — use the element's own box
    // height instead, since that's what pushes the header down.
    const observer = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return height;
}

export default function DevBanner() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      id={BANNER_ID}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        background: "#b91c1c",
        color: "#ffffff",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: "13px",
        fontWeight: 600,
        zIndex: 99999,
        letterSpacing: "0.5px",
      }}
    >
      ⚠️ DEV MODE — TEST ENVIRONMENT — NOT LIVE DATA
    </div>
  );
}
