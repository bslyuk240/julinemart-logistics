import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  MapPin, 
  Truck, 
  DollarSign,
  BarChart3,
  Users,
  RotateCcw,
  Menu,
  X,
  LogOut,
  User,
  Settings,
  ChevronDown,
  Mail,
  Percent,
  MessageSquare,
  Megaphone,
  Ticket,
  BellRing,
  Search,
  ClipboardCheck,
  LayoutGrid,
  DatabaseZap
} from 'lucide-react';
import { NotificationsPanel } from './NotificationsPanel';
import { BrandLogo } from '../../shared/BrandLogo';
import { useAuth } from '../contexts/AuthContext';

interface DashboardLayoutProps {
  children: ReactNode;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

// catalog_access flag on an agent grants access to catalog nav items
type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  roles: string[];
  requireCatalogAccess?: boolean;
};

const navigation: NavItem[] = [
  // Shared: admin + agent
  { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard, roles: ['admin', 'agent'] },
  { name: 'Orders', href: '/admin/orders', icon: Package, roles: ['admin', 'agent'] },
  { name: 'Hub Dispatch', href: '/admin/dispatch/hub', icon: Truck, roles: ['admin', 'agent'] },
  { name: 'WhatsApp Support', href: '/admin/whatsapp', icon: MessageSquare, roles: ['admin', 'agent'] },
  { name: 'Refunds', href: '/admin/refunds', icon: RotateCcw, roles: ['admin', 'agent'] },
  { name: 'Shipping Rates', href: '/admin/rates', icon: DollarSign, roles: ['admin', 'agent'] },
  // Catalog: admin, shop_manager, and agents with catalog_access
  { name: 'Global Sourcing', href: '/admin/global-sourcing', icon: Search, roles: ['admin', 'shop_manager'], requireCatalogAccess: true },
  { name: 'Product Moderation', href: '/admin/products/moderation', icon: ClipboardCheck, roles: ['admin', 'shop_manager'], requireCatalogAccess: true },
  { name: 'Homepage Content', href: '/admin/homepage-content', icon: LayoutGrid, roles: ['admin', 'shop_manager'] },
  { name: 'Catalog Migration', href: '/admin/catalog-migration', icon: DatabaseZap, roles: ['admin'] },
  // Admin only
  { name: 'Hubs', href: '/admin/hubs', icon: MapPin, roles: ['admin'] },
  { name: 'Couriers', href: '/admin/couriers', icon: Truck, roles: ['admin'] },
  { name: 'Settlements', href: '/admin/settlements', icon: DollarSign, roles: ['admin'] },
  { name: 'Analytics', href: '/admin/analytics', icon: BarChart3, roles: ['admin'] },
  { name: 'Users', href: '/admin/users', icon: Users, roles: ['admin'] },
  { name: 'Shipping Discounts', href: '/admin/discounts', icon: Percent, roles: ['admin'] },
  { name: 'Vouchers', href: '/admin/vouchers', icon: Ticket, roles: ['admin'] },
  { name: 'Influencers', href: '/admin/influencers', icon: Megaphone, roles: ['admin'] },
  { name: 'Courier Settings', href: '/admin/courier-settings', icon: Settings, roles: ['admin'] },
  { name: 'Settings', href: '/admin/settings', icon: Settings, roles: ['admin'] },
  { name: 'Email Settings', href: '/admin/email-settings', icon: Mail, roles: ['admin'] },
  { name: 'Notifications', href: '/admin/notifications', icon: BellRing, roles: ['admin'] },
];

const ADMIN_MANIFEST_LINK_ID = 'admin-manifest-link';
const ADMIN_MANIFEST_HREF = '/admin-manifest.webmanifest';
const ADMIN_APPLE_TOUCH_ICON_LINK_ID = 'admin-apple-touch-icon-link';
const ADMIN_APPLE_TOUCH_ICON_HREF = '/apple-touch-icon.png';

const isLocalAdminDev = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const ensureHeadLink = (id: string, rel: string, href: string) => {
  const existingLink = document.getElementById(id) as HTMLLinkElement | null;
  if (existingLink) return existingLink;

  const link = document.createElement('link');
  link.id = id;
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
  return link;
};

const removeHeadLink = (id: string) => {
  const link = document.getElementById(id);
  if (link?.parentNode) {
    link.parentNode.removeChild(link);
  }
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [unreadWhatsAppCount, setUnreadWhatsAppCount] = useState(0);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    document.body.classList.add('admin-shell');
    return () => {
      document.body.classList.remove('admin-shell');
    };
  }, []);

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

  useEffect(() => {
    const checkInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone || isIosStandalone);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPromptEvent(null);
    };

    checkInstalled();

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') {
      removeHeadLink(ADMIN_MANIFEST_LINK_ID);
      removeHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID);
      return;
    }

    if (isLocalAdminDev()) {
      removeHeadLink(ADMIN_MANIFEST_LINK_ID);
      removeHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID);
      return;
    }

    ensureHeadLink(ADMIN_MANIFEST_LINK_ID, 'manifest', ADMIN_MANIFEST_HREF);
    ensureHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID, 'apple-touch-icon', ADMIN_APPLE_TOUCH_ICON_HREF);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/admin-sw.js', { scope: '/admin/' })
        .catch((error) => {
          console.error('Failed to register admin service worker:', error);
        });
    }

    return () => {
      removeHeadLink(ADMIN_MANIFEST_LINK_ID);
      removeHeadLink(ADMIN_APPLE_TOUCH_ICON_LINK_ID);
    };
  }, [user?.role]);

  // Fetch unread WhatsApp chat count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const response = await fetch('/.netlify/functions/whatsapp-chats?status=open');
        const result = await response.json();
        
        if (result.success) {
          // Count chats with unread messages
          const unreadCount = result.data.filter((chat: { unread_count?: number | null }) => (chat.unread_count ?? 0) > 0).length;
          setUnreadWhatsAppCount(unreadCount);
        }
      } catch (error) {
        console.error('Error fetching unread count:', error);
      }
    };

    fetchUnreadCount();
    
    // Refresh count every 30 seconds
    const interval = setInterval(fetchUnreadCount, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      window.alert('To install, open your browser menu and tap "Add to Home screen".');
      return;
    }

    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      agent: 'bg-blue-100 text-blue-800',
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  // Filter navigation items based on user role and catalog_access flag
  const filteredNavigation = navigation.filter(item => {
    if (!item.roles) return true;
    if (item.roles.includes(user?.role || '')) return true;
    // Agents with catalog_access can see items marked requireCatalogAccess
    if (item.requireCatalogAccess && user?.role === 'agent' && user?.catalog_access) return true;
    return false;
  });
  const canInstallApp = user?.role === 'admin' && !isInstalled;

  return (
    <div className="admin-portal admin-shell-root bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col
        transform transition-transform duration-300 ease-in-out lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 shrink-0">
          <BrandLogo withText size={32} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="admin-sidebar-scroll flex-1 overflow-y-auto px-4 py-6 space-y-1">
          {filteredNavigation.map((item) => {
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/admin/dashboard' && location.pathname.startsWith(`${item.href}/`)) ||
              (item.href === '/admin/dashboard' && location.pathname.startsWith('/admin/dashboard'));
            const Icon = item.icon;
            
            // Show unread badge for WhatsApp Support
            const showBadge = item.href === '/admin/whatsapp' && unreadWhatsAppCount > 0;
            
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors relative
                  ${isActive 
                    ? 'bg-primary-50 text-primary-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
                {item.name}
                {showBadge && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                    {unreadWhatsAppCount > 9 ? '9+' : unreadWhatsAppCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="lg:pl-64 h-full">
        <div className="flex h-full flex-col">
          {/* Top bar */}
          <div className="sticky top-0 z-40 h-16 bg-white border-b border-gray-200 flex items-center px-4 sm:px-6 shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-500 hover:text-gray-700 mr-4"
            >
              <Menu className="w-6 h-6" />
            </button>
            
            <div className="flex-1 flex justify-end items-center gap-4">
              {canInstallApp && (
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="inline-flex items-center rounded-lg border border-primary-600 px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 transition-colors"
                >
                  Install App
                </button>
              )}
              {/* Notifications Panel */}
              <NotificationsPanel />
              
              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                    {user?.full_name?.charAt(0) || user?.email?.charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden md:block text-left">
                    <p className="text-sm font-medium text-gray-900">
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
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                      <div className="px-4 py-3 border-b border-gray-200">
                        <p className="text-sm font-medium text-gray-900">
                          {user?.full_name || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{user?.email}</p>
                      </div>
                      
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
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
                          className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-3"
                          onClick={() => {
                            setUserMenuOpen(false);
                            navigate('/admin/settings');
                          }}
                        >
                          <Settings className="w-4 h-4" />
                          Settings
                        </button>
                      )}
                      
                      <div className="border-t border-gray-200 my-2" />
                      
                      <button
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
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
          <main className="admin-main-scroll flex-1 overflow-y-auto p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
