import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  MapPin, 
  Truck, 
  DollarSign,
  BarChart3,
  Users,
  Menu,
  X,
  LogOut,
  User,
  Settings,
  ChevronDown,
  Mail,
  Percent
} from 'lucide-react';
import { NotificationsPanel } from './NotificationsPanel';
import { BrandLogo } from '../../shared/BrandLogo';
import { useAuth } from '../contexts/AuthContext';

interface DashboardLayoutProps {
  children: ReactNode;
}

const navigation = [
  // Agent can access: Dashboard, Orders, Shipping Rates
  { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard, roles: ['admin', 'agent'] },
  { name: 'Orders', href: '/admin/orders', icon: Package, roles: ['admin', 'agent'] },
  { name: 'Shipping Rates', href: '/admin/rates', icon: DollarSign, roles: ['admin', 'agent'] },
  // Admin only pages
  { name: 'Hubs', href: '/admin/hubs', icon: MapPin, roles: ['admin'] },
  { name: 'Couriers', href: '/admin/couriers', icon: Truck, roles: ['admin'] },
  { name: 'Settlements', href: '/admin/settlements', icon: DollarSign, roles: ['admin'] },
  { name: 'Analytics', href: '/admin/analytics', icon: BarChart3, roles: ['admin'] },
  { name: 'Users', href: '/admin/users', icon: Users, roles: ['admin'] },
  { name: 'Shipping Discounts', href: '/admin/discounts', icon: Percent, roles: ['admin'] },
  { name: 'Courier Settings', href: '/admin/courier-settings', icon: Settings, roles: ['admin'] },
  { name: 'Settings', href: '/admin/settings', icon: Settings, roles: ['admin'] },
  { name: 'Email Settings', href: '/admin/email-settings', icon: Mail, roles: ['admin'] },
];

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      agent: 'bg-blue-100 text-blue-800',
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  // Filter navigation items based on user role
  const filteredNavigation = navigation.filter(item => 
    !item.roles || item.roles.includes(user?.role || '')
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 
        transform transition-transform duration-300 ease-in-out lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <BrandLogo withText size={32} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="px-4 py-6 space-y-1">
          {filteredNavigation.map((item) => {
            const isActive =
              location.pathname === item.href ||
              (item.href !== '/admin/dashboard' && location.pathname.startsWith(`${item.href}/`)) ||
              (item.href === '/admin/dashboard' && location.pathname.startsWith('/admin/dashboard'));
            const Icon = item.icon;
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`
                  flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors
                  ${isActive 
                    ? 'bg-primary-50 text-primary-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                  }
                `}
              >
                <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-40 h-16 bg-white border-b border-gray-200 flex items-center px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-gray-500 hover:text-gray-700 mr-4"
          >
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex-1 flex justify-end items-center gap-4">
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
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
