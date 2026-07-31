import { Link, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { HOME_TAB, getMobileTabItems } from '../lib/permissions';

const MORE_HREF = '/admin/more';

function isTabActive(pathname: string, href: string): boolean {
  if (href === HOME_TAB.href) {
    return pathname === href || pathname === '/admin' || pathname === '/admin/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Bottom tab bar: Home + Orders/Dispatch/Support (design spec) + More.
export function TabBar() {
  const { user } = useAuth();
  const location = useLocation();

  const middleTabs = getMobileTabItems(user);
  const tabs = [HOME_TAB, ...middleTabs];
  const activeIndex = tabs.findIndex((tab) => isTabActive(location.pathname, tab.href));
  const moreActive = activeIndex === -1;

  return (
    <nav
      role="tablist"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      style={{
        gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))`,
        paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        paddingTop: '6px',
      }}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = index === activeIndex;
        return (
          <Link
            key={tab.href}
            to={tab.href}
            role="tab"
            aria-selected={active}
            className={`flex flex-col items-center gap-1 py-1 text-[10px] font-medium tracking-wide ${
              active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
            {tab.name}
          </Link>
        );
      })}

      <Link
        to={MORE_HREF}
        role="tab"
        aria-selected={moreActive}
        className={`flex flex-col items-center gap-1 py-1 text-[10px] font-medium tracking-wide ${
          moreActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={moreActive ? 2.25 : 2} />
        More
      </Link>
    </nav>
  );
}
