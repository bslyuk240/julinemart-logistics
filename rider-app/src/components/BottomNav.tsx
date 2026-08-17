import { NavLink } from 'react-router-dom';
import { Home, Wallet } from 'lucide-react';

const TABS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/earnings', label: 'Earnings', icon: Wallet, end: false },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex bg-white border-t border-gray-100"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium ${
              isActive ? 'text-primary-600' : 'text-gray-400'
            }`
          }
        >
          <Icon className="w-5 h-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
