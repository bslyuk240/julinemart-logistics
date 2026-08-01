import { Link, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getMobileTabBar } from '../lib/permissions';

const MORE_HREF = '/admin/more';

function isTabActive(pathname: string, href: string, isHomeTab: boolean): boolean {
  if (isHomeTab) {
    return pathname === href || pathname === '/admin' || pathname === '/admin/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TabBar() {
  const { user } = useAuth();
  const location = useLocation();

  const { tabs, showMore } = getMobileTabBar(user);
  const activeIndex = tabs.findIndex((tab, index) =>
    isTabActive(location.pathname, tab.href, index === 0),
  );
  const moreActive = showMore && activeIndex === -1;
  const columnCount = tabs.length + (showMore ? 1 : 0);

  return (
    <nav
      role="tablist"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      style={{
        gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
        paddingTop: '6px',
      }}
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = index === activeIndex;
        return (
          <Link
            key={`${tab.href}-${tab.name}`}
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

      {showMore && (
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
      )}
    </nav>
  );
}
