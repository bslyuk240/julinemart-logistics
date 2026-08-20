import { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Settings, User } from 'lucide-react';
import { BrandLogo } from '../../shared/BrandLogo';
import { NotificationsPanel } from '../components/NotificationsPanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { AdminInstallBanner } from './AdminInstallBanner';
import { TabBar } from './TabBar';
import { DeskOnlyNotice } from './DeskOnlyNotice';

interface MobileShellProps {
  children: ReactNode;
}

const TABBAR_HEIGHT = 58;

const MOBILE_NATIVE_PATHS = new Set([
  '/admin',
  '/admin/',
  '/admin/dashboard',
  '/admin/orders',
  '/admin/dispatch/hub',
  '/admin/support',
  '/admin/refunds',
  '/admin/inbox',
  '/admin/notifications',
  '/admin/notifications/new',
  '/admin/notifications/tokens',
  '/admin/profile',
  '/admin/rates',
  '/admin/global-sourcing',
  '/admin/homepage-content',
  '/admin/tags',
  '/admin/categories',
  '/admin/products/reviews',
  '/admin/customers',
  '/admin/users',
  '/admin/analytics',
  '/admin/customer-journey',
  '/admin/activity-logs',
  '/admin/pwa-monitoring',
  '/admin/vendors',
  '/admin/seller-verifications',
  '/admin/riders',
  '/admin/rider-verifications',
  '/admin/rider-roster',
  '/admin/delivery-problems',
  '/admin/vendor-campaign-approvals',
  '/admin/gift-fulfilment-centres',
  '/admin/gift-boxes',
  '/admin/gift-ops',
  '/admin/gift-box-reviews',
  '/admin/gift-packaging',
  '/admin/vendor-withdrawals',
  '/admin/vendor-debits',
  '/admin/vendor-locations',
  '/admin/campaigns',
  '/admin/vouchers',
  '/admin/discounts',
  '/admin/influencers',
  '/admin/meta-ads',
  '/admin/google-ads',
  '/admin/finance',
  '/admin/settlements',
  '/admin/hubs',
  '/admin/couriers',
  '/admin/manual-shipments',
  '/admin/manual-shipments/create',
  '/admin/custom-orders',
  '/admin/products/moderation',
  '/admin/products/upload',
  '/admin/more',
  '/admin/settings',
]);

const MOBILE_NATIVE_PREFIXES = [
  '/admin/support/',
  '/admin/orders/',
  '/admin/manual-shipments/',
  '/admin/refunds/',
  '/admin/vendors/',
  '/admin/influencers/',
  '/admin/notifications/',
  '/admin/settings/',
];

function isMobileNativeRoute(pathname: string): boolean {
  if (MOBILE_NATIVE_PATHS.has(pathname)) return true;
  return MOBILE_NATIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function MobileShell({ children }: MobileShellProps) {
  const { user, signOut } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDeskOnly = !isMobileNativeRoute(location.pathname);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const initial = user?.full_name?.charAt(0) || user?.email?.charAt(0).toUpperCase() || '?';

  return (
    <div
      className={`admin-portal admin-shell-root flex h-full min-h-0 flex-col bg-gray-50 dark:bg-gray-950 ${
        isDark ? 'dark' : ''
      }`}
    >
      <header
        className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 dark:border-gray-800 dark:bg-gray-900"
        style={{
          height: 'calc(56px + env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <BrandLogo
          size={28}
          withText
          gapClassName="gap-2"
          subtitle="Logistics Orchestrator"
          textClassName="text-sm font-bold leading-tight text-primary-600 dark:text-primary-400"
        />

        <div className="flex-1" />

        <div className="flex shrink-0 items-center">
          <ThemeToggle />
          <NotificationsPanel />
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account menu"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-xs font-medium text-white"
          >
            {initial}
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-40 w-52 rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                <div className="border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {user?.full_name || 'User'}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">{user?.email}</p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/admin/profile');
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300"
                >
                  <User className="h-4 w-4" />
                  Profile
                </button>

                {user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate('/admin/settings');
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>
                )}

                <div className="my-2 border-t border-gray-200 dark:border-gray-700" />

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleSignOut();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-600 dark:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <AdminInstallBanner />

      <main
        className="admin-main-scroll min-h-0 flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950"
        style={{ paddingBottom: `calc(${TABBAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
      >
        {isDeskOnly && <DeskOnlyNotice />}
        {children}
      </main>

      <TabBar />
    </div>
  );
}
