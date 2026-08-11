import { Link, useLocation } from 'react-router-dom';
import { CUSTOMER_TABS, customerBaseFromPath, customerTabHref } from './lib/nav';

function isTabActive(pathname: string, href: string, isHomeTab: boolean): boolean {
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const hrefNorm = href.endsWith('/') && href.length > 1 ? href.slice(0, -1) : href;

  if (isHomeTab) {
    return normalized === hrefNorm || normalized === '/customer' || normalized === '/';
  }
  return normalized === hrefNorm || normalized.startsWith(`${hrefNorm}/`);
}

export function CustomerTabBar() {
  const location = useLocation();
  const base = customerBaseFromPath(location.pathname);

  return (
    <nav
      role="tablist"
      aria-label="Customer portal"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-gray-200 bg-white"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        paddingTop: '6px',
      }}
    >
      {CUSTOMER_TABS.map((tab, index) => {
        const href = customerTabHref(base, tab.hrefSuffix);
        const Icon = tab.icon;
        const active = isTabActive(location.pathname, href, index === 0);

        return (
          <Link
            key={tab.name}
            to={href}
            role="tab"
            aria-selected={active}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-medium tracking-wide ${
              active ? 'text-primary-600' : 'text-gray-500'
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
