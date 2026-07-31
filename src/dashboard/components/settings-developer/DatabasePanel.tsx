import { Database } from 'lucide-react';
import { DB_TABLES } from '../../lib/settingsDeveloperContent';

interface DatabasePanelProps {
  compact?: boolean;
}

export function DatabasePanel({ compact = false }: DatabasePanelProps) {
  const listClass = compact
    ? 'overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100'
    : 'card';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={`rounded-lg bg-amber-50 border border-amber-200 p-4 ${compact ? '' : ''}`}>
        <p className="text-sm text-amber-900">
          Supabase Postgres — connection via env vars only. Use Supabase Dashboard for migrations, RLS, and backups.
        </p>
      </div>

      <div className={listClass}>
        {!compact && <h2 className="text-lg sm:text-2xl font-bold mb-4">Schema overview</h2>}
        <div className={compact ? '' : 'space-y-3'}>
          {DB_TABLES.map((table, index) => (
            <div
              key={table.name}
              className={
                compact
                  ? `flex items-start gap-3 border-b border-gray-50 px-4 py-3 ${index === DB_TABLES.length - 1 ? 'last:border-b-0' : ''}`
                  : 'p-4 border border-gray-200 rounded-lg hover:border-primary-300'
              }
            >
              {compact ? (
                <>
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <Database className="h-4 w-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="font-mono text-sm font-semibold text-gray-900">{table.name}</p>
                    <p className="text-xs text-gray-600">{table.description}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{table.detail}</p>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between w-full">
                  <div>
                    <h3 className="font-mono font-semibold text-lg text-gray-900">{table.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{table.description}</p>
                    <p className="text-xs text-gray-500 mt-1">{table.detail}</p>
                  </div>
                  <Database className="w-5 h-5 text-gray-400 shrink-0" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={compact ? 'rounded-2xl bg-white p-4 ring-1 ring-gray-100' : 'card'}>
        <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-xl mb-3'}`}>Backups</h2>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1 ml-1">
          <li>Open Supabase Dashboard → your project</li>
          <li>Database → Backups → Create backup</li>
          <li>Run before major migrations or bulk imports</li>
        </ol>
      </div>
    </div>
  );
}
