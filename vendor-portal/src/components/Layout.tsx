import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingBag, TrendingUp,
  Wallet, Settings, LogOut, Store, Menu, X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const nav = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/products',    label: 'Products',    icon: Package },
  { to: '/orders',      label: 'Orders',      icon: ShoppingBag },
  { to: '/earnings',    label: 'Earnings',    icon: TrendingUp },
  { to: '/withdrawals', label: 'Withdrawals', icon: Wallet },
  { to: '/settings',    label: 'Settings',    icon: Settings },
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

      {/* ── JulineMart brand header ── */}
      <div className="brand-gradient px-5 py-4">
        <div className="flex items-center gap-2.5 mb-4">
          <img src="/logo.png" alt="JulineMart" className="h-7 object-contain" />
        </div>
        <p className="text-primary-100 text-xs font-medium mb-3">Vendor Portal</p>

        {/* Store card */}
        <div className="bg-white/10 rounded-xl px-3 py-2.5 flex items-center gap-3">
          {vendor?.logo_url
            ? <img src={vendor.logo_url} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/30" />
            : (
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center ring-2 ring-white/30">
                <Store className="w-4 h-4 text-white" />
              </div>
            )
          }
          <div className="min-w-0">
            <p className="font-semibold text-white truncate text-sm leading-tight">{vendor?.store_name || 'Your Store'}</p>
            <p className="text-primary-200 text-xs truncate leading-tight">{vendor?.email}</p>
          </div>
        </div>
      </div>

      {/* ── Nav links ── */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary-50 text-primary-700 shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-primary-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? 'text-primary-600' : ''}`} />
                {label}
                {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Commission badge ── */}
      {vendor?.commission_rate != null && (
        <div className="mx-3 mb-3 p-3 bg-gradient-to-br from-primary-50 to-secondary-50 rounded-xl border border-primary-100">
          <p className="text-xs text-primary-600 font-medium">Commission Rate</p>
          <p className="text-xl font-bold text-primary-700 leading-tight">{vendor.commission_rate}%</p>
          <p className="text-xs text-gray-500 mt-0.5">Platform fee deducted per sale</p>
        </div>
      )}

      {/* ── Sign out ── */}
      <div className="px-3 pb-4 border-t border-gray-100 pt-2">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-50 w-64 h-full shadow-2xl">
            <Sidebar mobile />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
          <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-primary-50 text-gray-600 hover:text-primary-600 transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <img src="/logo.png" alt="JulineMart" className="h-6 object-contain" />
          <button onClick={() => setOpen(false)} className={`p-2 rounded-lg transition-colors ${open ? 'hover:bg-gray-100' : 'invisible'}`}>
            <X className="w-5 h-5" />
          </button>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
