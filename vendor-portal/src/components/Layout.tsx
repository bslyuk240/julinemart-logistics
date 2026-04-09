import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingBag, TrendingUp,
  Wallet, Settings, LogOut, Store, Menu, X, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const nav = [
  { to: '/',            label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/products',    label: 'Products',   icon: Package },
  { to: '/orders',      label: 'Orders',     icon: ShoppingBag },
  { to: '/earnings',    label: 'Earnings',   icon: TrendingUp },
  { to: '/withdrawals', label: 'Withdrawals',icon: Wallet },
  { to: '/settings',    label: 'Settings',   icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { vendor, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const Sidebar = ({ mobile = false }) => (
    <aside className={`${mobile ? 'flex flex-col h-full' : 'hidden lg:flex flex-col'} w-64 bg-white border-r border-gray-100 min-h-screen`}>
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          {vendor?.logo_url
            ? <img src={vendor.logo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            : <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center"><Store className="w-5 h-5 text-white" /></div>
          }
          <div className="min-w-0">
            <p className="font-bold text-gray-900 truncate text-sm">{vendor?.store_name || 'Vendor Portal'}</p>
            <p className="text-xs text-gray-500 truncate">{vendor?.email}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Commission badge */}
      {vendor?.commission_rate != null && (
        <div className="mx-4 mb-3 p-3 bg-purple-50 rounded-lg">
          <p className="text-xs text-purple-600 font-medium">Your Commission Rate</p>
          <p className="text-lg font-bold text-purple-700">{vendor.commission_rate}%</p>
          <p className="text-xs text-purple-500">Platform fee per sale</p>
        </div>
      )}

      {/* Sign out */}
      <div className="px-3 pb-4">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors w-full"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-50 w-64 h-full">
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-gray-100">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-gray-900 text-sm">{vendor?.store_name}</span>
          <div className="w-9" />
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
