import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, User, Settings, ChevronDown } from 'lucide-react';
import { NotificationsPanel } from './NotificationsPanel';
import { ThemeToggle } from './ThemeToggle';
import { BrandLogo } from '../../shared/BrandLogo';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { canAccessNavItem, navigationSections } from '../lib/permissions';
import { useAdminShellEffects } from '../hooks/useAdminShellEffects';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  useAdminShellEffects();
  const { isDark } = useTheme();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const isMobileSidebar = sidebarOpen && window.matchMedia('(max-width: 1023px)').matches;
    if (!isMobileSidebar) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

   const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      agent: 'bg-blue-100 text-blue-800',
      shop_manager: 'bg-purple-100 text-purple-800',
      manager: 'bg-indigo-100 text-indigo-800',
      viewer: 'bg-slate-100 text-slate-800',
      vendor: 'bg-green-100 text-green-800',
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  // Role-filter items, then drop empty sections so labels don't float alone
  const filteredSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessNavItem(item, user)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className={`admin-portal admin-shell-root bg-gray-50 dark:bg-gray-950 ${isDark ? 'dark' : ''}`}>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col
        transform transition-transform duration-300 ease-in-out lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <BrandLogo withText size={32} textClassName="text-lg font-bold text-primary-600 dark:text-primary-400" />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="admin-sidebar-scroll flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {filteredSections.map((section) => (
            <div key={section.id} className="space-y-1">
              {section.label && (
                <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const isActive =
                  location.pathname === item.href ||
                  (item.href !== '/admin/dashboard' && location.pathname.startsWith(`${item.href}/`)) ||
                  (item.href === '/admin/dashboard' && location.pathname.startsWith('/admin/dashboard'));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center px-4 py-2.5 text-sm font-medium rounded-lg transition-colors relative
                      ${isActive
                        ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }
                    `}
                  >
                    <Icon className={`w-5 h-5 mr-3 shrink-0 ${isActive ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`} />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="lg:pl-64 h-full">
        <div className="flex h-full flex-col">
          {/* Top bar */}
          <div className="sticky top-0 z-40 h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 sm:px-6 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mr-4"
            >
              <Menu className="w-6 h-6" />
            </button>

            <BrandLogo size={32} className="lg:hidden" />

            <div className="flex-1 flex justify-end items-center gap-3 sm:gap-4">
              <ThemeToggle />
              <NotificationsPanel />
              
              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                    {user?.full_name?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {user?.full_name || 'User'}
                    </p>
                    <p className={`text-xs px-2 py-0.5 rounded-full inline-block ${getRoleBadgeColor(user?.role || '')}`}>
                      {user?.role}
                    </p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>

                {/* Dropdown Menu */}
                {userMenuOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2 z-50">
                      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {user?.full_name || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{user?.email}</p>
                      </div>
                      
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-3"
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/admin/profile');
                        }}
                      >
                        <User className="w-4 h-4" />
                        Profile
                      </button>
                      
                      {user?.role === 'admin' && (
                        <button
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-3"
                          onClick={() => {
                            setUserMenuOpen(false);
                            navigate('/admin/settings');
                          }}
                        >
                          <Settings className="w-4 h-4" />
                          Settings
                        </button>
                      )}
                      
                      <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                      
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-3"
                        onClick={() => {
                          setUserMenuOpen(false);
                          handleSignOut();
                        }}
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Page content */}
          <main className="admin-main-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 dark:bg-gray-950">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
