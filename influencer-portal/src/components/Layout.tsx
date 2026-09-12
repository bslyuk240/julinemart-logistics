import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Receipt, User, LogOut, Megaphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { JulineMartLogo } from './JulineMartLogo';

const nav = [
  { to: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sales',    label: 'Sales',     icon: Receipt },
  { to: '/profile',  label: 'Profile',   icon: User },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { influencer, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-100 min-h-screen sticky top-0 h-screen">
        <div className="brand-gradient px-5 py-4">
          <div className="flex items-center gap-2.5 mb-3">
            <JulineMartLogo className="h-10 w-10 object-contain rounded-full ring-2 ring-white/25 shadow-sm" />
          </div>
          <p className="text-primary-100 text-xs font-medium mb-3">Influencer Portal</p>
          <div className="bg-white/10 rounded-xl px-3 py-2.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center ring-2 ring-white/30">
              <Megaphone className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white truncate text-sm leading-tight">{influencer?.name || 'Influencer'}</p>
              <p className="text-primary-200 text-xs truncate leading-tight font-mono">{influencer?.coupon_code}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-primary-600'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary-600' : ''}`} />
                  {label}
                  {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {influencer?.commission_rate != null && (
          <div className="mx-3 mb-3 p-3 bg-gradient-to-br from-primary-50 to-secondary-50 rounded-xl border border-primary-100">
            <p className="text-xs text-primary-600 font-medium">Commission Rate</p>
            <p className="text-xl font-bold text-primary-700 leading-tight">{influencer.commission_rate}%</p>
          </div>
        )}

        <div className="px-3 pb-4 border-t border-gray-100 pt-2">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors w-full"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full brand-gradient flex items-center justify-center">
              <Megaphone className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate leading-tight max-w-[160px]">{influencer?.name || 'Influencer'}</p>
              <p className="text-xs text-primary-600 font-mono">{influencer?.coupon_code}</p>
            </div>
          </div>
          <JulineMartLogo className="h-8 w-8 object-contain shrink-0" />
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8 pb-24 lg:pb-8 w-full">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex"
           style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                isActive ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-primary-50' : ''}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-medium leading-tight">{label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          onClick={handleSignOut}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-gray-400 hover:text-red-500 transition-colors"
        >
          <div className="p-1.5 rounded-xl">
            <LogOut className="w-5 h-5" />
          </div>
          <span className="text-[10px] font-medium leading-tight">Logout</span>
        </button>
      </nav>
    </div>
  );
}
