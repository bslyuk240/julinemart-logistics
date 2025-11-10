import React from 'react';

type BrandLogoProps = {
  size?: number;
  withText?: boolean;
  className?: string;
  textClassName?: string;
  gapClassName?: string;
};

export function BrandLogo({
  size = 32,
  withText = false,
  className = '',
  textClassName = 'text-xl font-bold text-primary-600',
  gapClassName = 'gap-3',
}: BrandLogoProps) {
  const appName = (import.meta.env.VITE_APP_NAME as string) || 'JulineMart';
  const logoUrl = import.meta.env.VITE_LOGO_URL as string | undefined;

  const initials = appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join('');

  return (
    <div className={`flex items-center ${gapClassName} ${className}`.trim()}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={appName}
          style={{ height: size, width: size }}
          className="rounded-md object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div
          style={{ height: size, width: size }}
          className="rounded-md bg-primary-600 text-white flex items-center justify-center font-bold"
          aria-label={appName}
          title={appName}
        >
          {initials}
        </div>
      )}
      {withText && <span className={textClassName}>{appName}</span>}
    </div>
  );
}

