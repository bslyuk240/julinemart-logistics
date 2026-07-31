import { useState } from 'react';

type BrandLogoProps = {
  size?: number;
  withText?: boolean;
  className?: string;
  textClassName?: string;
  gapClassName?: string;
  subtitle?: string;
  subtitleClassName?: string;
};

export function BrandLogo({
  size = 32,
  withText = false,
  className = '',
  textClassName = 'text-xl font-bold text-primary-600 dark:text-primary-400',
  gapClassName = 'gap-3',
  subtitle,
  subtitleClassName = 'text-[9px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-400',
}: BrandLogoProps) {
  const appName = (import.meta.env.VITE_APP_NAME as string) || 'JulineMart';
  const logoUrl = import.meta.env.VITE_LOGO_URL as string | undefined;
  const [imgFailed, setImgFailed] = useState(false);

  const initials = appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join('');

  const showImage = Boolean(logoUrl) && !imgFailed;

  return (
    <div className={`flex items-center ${gapClassName} ${className}`.trim()}>
      {showImage ? (
        <img
          src={logoUrl}
          alt={appName}
          style={{ height: size, width: size }}
          className="rounded-md object-contain shrink-0"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div
          style={{ height: size, width: size }}
          className="shrink-0 rounded-md bg-primary-600 text-white flex items-center justify-center font-bold"
          aria-label={appName}
          title={appName}
        >
          {initials || 'J'}
        </div>
      )}
      {withText && (
        <div className="min-w-0">
          <span className={`block truncate leading-tight ${textClassName}`}>{appName}</span>
          {subtitle ? <span className={`block truncate ${subtitleClassName}`}>{subtitle}</span> : null}
        </div>
      )}
    </div>
  );
}

