import { useState } from 'react';
import { Book, Database, Key, Settings, Webhook } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { ApiPanel } from '../components/settings-developer/ApiPanel';
import { DatabasePanel } from '../components/settings-developer/DatabasePanel';
import { DocumentationPanel } from '../components/settings-developer/DocumentationPanel';
import { EnvHealthPanel } from '../components/settings-developer/EnvHealthPanel';
import { WebhooksPanel } from '../components/settings-developer/WebhooksPanel';

type TabType = 'documentation' | 'webhooks' | 'api' | 'database';

export function SettingsPage() {
  const notification = useNotification();
  const [activeTab, setActiveTab] = useState<TabType>('documentation');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    notification.success('Copied!', `${label} copied to clipboard`);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const tabs: { id: TabType; label: string; icon: typeof Book }[] = [
    { id: 'documentation', label: 'Documentation', icon: Book },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'api', label: 'API Reference', icon: Key },
    { id: 'database', label: 'Database', icon: Database },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600 flex-shrink-0" />
          System Settings &amp; Documentation
        </h1>
        <p className="text-gray-600 mt-1 text-sm sm:text-base">
          Live integration health, API reference, webhooks, and schema docs
        </p>
      </div>

      <div className="mb-6">
        <EnvHealthPanel />
      </div>

      <div className="border-b border-gray-200 mb-6 -mx-4 sm:mx-0">
        <nav className="flex overflow-x-auto px-4 sm:px-0" style={{ scrollbarWidth: 'none' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div>
        {activeTab === 'documentation' && <DocumentationPanel />}
        {activeTab === 'webhooks' && (
          <WebhooksPanel copiedItem={copiedItem} copyToClipboard={copyToClipboard} />
        )}
        {activeTab === 'api' && <ApiPanel copiedItem={copiedItem} copyToClipboard={copyToClipboard} />}
        {activeTab === 'database' && <DatabasePanel />}
      </div>
    </div>
  );
}
