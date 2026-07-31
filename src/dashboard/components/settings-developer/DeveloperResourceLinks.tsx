import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DEVELOPER_RESOURCE_LINKS } from '../../lib/settingsDeveloperContent';

interface DeveloperResourceLinksProps {
  compact?: boolean;
}

export function DeveloperResourceLinks({ compact = false }: DeveloperResourceLinksProps) {
  const internal = DEVELOPER_RESOURCE_LINKS.filter((l) => !l.external);

  if (compact) {
    return (
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100">
        {internal.map((link, index) => (
          <Link
            key={link.href}
            to={link.href}
            className={`flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 ${
              index < internal.length - 1 ? 'border-b border-gray-50' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{link.label}</p>
              <p className="text-xs text-gray-500">{link.description}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3">In-app tools</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {internal.map((link) => (
          <Link
            key={link.href}
            to={link.href}
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
          >
            <div>
              <div className="font-semibold text-sm">{link.label}</div>
              <div className="text-xs text-gray-600">{link.description}</div>
            </div>
            <ChevronRight className="w-4 h-4 ml-auto text-gray-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
