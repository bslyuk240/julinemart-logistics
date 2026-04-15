/**
 * JulineMart brand mark — raster PNG from /admin-icon-192.png (served from vendor-portal/public).
 */
export function JulineMartLogo({ className = '' }: { className?: string }) {
  return (
    <img
      src="/admin-icon-192.png"
      alt="JulineMart"
      className={className}
      decoding="async"
    />
  );
}
