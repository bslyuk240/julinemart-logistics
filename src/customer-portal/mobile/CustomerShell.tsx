import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { BrandLogo } from '../../shared/BrandLogo';
import { CustomerTabBar } from './TabBar';
import { shouldShowCustomerTabBar } from './lib/nav';

interface CustomerShellProps {
  children: ReactNode;
}

const TABBAR_HEIGHT = 58;

export function CustomerShell({ children }: CustomerShellProps) {
  const location = useLocation();
  const showTabBar = shouldShowCustomerTabBar(location.pathname);

  return (
    <div className="customer-portal flex h-full min-h-0 flex-col bg-gray-50">
      <header
        className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-4"
        style={{
          height: 'calc(52px + env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <BrandLogo
          size={26}
          withText
          gapClassName="gap-2"
          subtitle="Order Tracking"
          textClassName="text-sm font-bold leading-tight text-primary-600"
        />
      </header>

      <main
        className="customer-main-scroll min-h-0 flex-1 overflow-y-auto bg-gray-50"
        style={{
          paddingBottom: showTabBar
            ? `calc(${TABBAR_HEIGHT}px + env(safe-area-inset-bottom))`
            : 'env(safe-area-inset-bottom)',
        }}
      >
        {children}
      </main>

      {showTabBar && <CustomerTabBar />}
    </div>
  );
}
