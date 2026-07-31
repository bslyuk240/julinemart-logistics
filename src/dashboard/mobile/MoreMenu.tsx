import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getFilteredSections } from '../lib/permissions';

// Destination for the tab bar's "More" tab: every route the signed-in role
// can reach, grouped the same way the desktop sidebar groups them, with a
// client-side filter since the full list runs past a phone screen.
export default function MoreMenu() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const all = getFilteredSections(user).filter((section) => section.id !== 'overview');
    const q = query.trim().toLowerCase();
    if (!q) return all;

    return all
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.name.toLowerCase().includes(q)),
      }))
      .filter((section) => section.items.length > 0);
  }, [user, query]);

  return (
    <div className="pb-4">
      <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page"
            className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            style={{ fontSize: '16px' }}
          />
        </div>
      </div>

      {sections.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-gray-500">No pages match "{query}".</p>
      )}

      {sections.map((section) => (
        <div key={section.id} className="mt-2">
          {section.label && (
            <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {section.label}
            </p>
          )}
          <div className="bg-white">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-sm text-gray-900 last:border-b-0"
                >
                  <Icon className="h-4.5 w-4.5 shrink-0 text-gray-500" />
                  <span className="flex-1">{item.name}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
