import { useState } from 'react';
import GlobalSourcingCjProducts from './GlobalSourcingCjProducts';
import GlobalSourcingInbound from './GlobalSourcingInbound';
import GlobalSourcingImported from './GlobalSourcingImported';
import GlobalSourcingImportUrl from './GlobalSourcingImportUrl';
import { TABBAR_SPACE } from '../lib/functionsAuth';

type TabKey = 'cj' | 'import' | 'imported' | 'inbound';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'cj', label: 'CJ Products' },
  { key: 'import', label: 'Import URL' },
  { key: 'imported', label: 'Imported' },
  { key: 'inbound', label: 'Inbound' },
];

export default function MobileGlobalSourcing() {
  const [tab, setTab] = useState<TabKey>('cj');

  return (
    <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
      <div>
        <h1 className="text-lg font-bold text-gray-900">Global Sourcing</h1>
        <p className="text-xs text-gray-500">CJ dropshipping — import, track, receive</p>
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
              tab === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'cj' && <GlobalSourcingCjProducts />}
      {tab === 'inbound' && <GlobalSourcingInbound embedded />}
      {tab === 'imported' && <GlobalSourcingImported />}
      {tab === 'import' && <GlobalSourcingImportUrl />}
    </div>
  );
}
