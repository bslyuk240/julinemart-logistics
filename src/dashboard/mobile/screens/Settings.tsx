import { useNavigate } from 'react-router-dom';
import {
  Book,
  Database,
  Globe,
  Key,
  Mail,
  ScrollText,
  Settings as SettingsIcon,
  Truck,
  Webhook,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { EnvHealthPanel } from '../../components/settings-developer/EnvHealthPanel';
import { DeveloperResourceLinks } from '../../components/settings-developer/DeveloperResourceLinks';
import { SettingsGroup, SettingsNavRow } from '../components/SettingsParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';

export default function MobileSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const go = (path: string) => () => navigate(path);

  return (
    <div className="min-h-full bg-gray-50" style={{ paddingBottom: TABBAR_SPACE }}>
      <div className="px-4 pb-2 pt-4">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-primary-950 p-5 text-white shadow-lg">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur">
              <SettingsIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold">Settings</h1>
              <p className="mt-0.5 text-sm text-slate-300">Integrations, email &amp; developer tools</p>
              {user?.email && (
                <p className="mt-2 truncate text-xs text-slate-400">{user.email}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-2">
        <SettingsGroup title="Integrations">
          <SettingsNavRow
            icon={<Globe className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm"
            title="Global Sourcing"
            subtitle="Pricing defaults, FX, CJ health & sync log"
            onClick={go('/admin/settings/global-sourcing')}
          />
          <SettingsNavRow
            icon={<Truck className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm"
            title="Courier APIs"
            subtitle="Fez credentials, tracking & labels"
            onClick={go('/admin/settings/couriers')}
          />
          <SettingsNavRow
            icon={<Mail className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm"
            title="Email"
            subtitle="SMTP provider & test send"
            onClick={go('/admin/settings/email')}
          />
          <SettingsNavRow
            icon={<ScrollText className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm"
            title="Email logs"
            subtitle="Recent sent & failed delivery attempts"
            onClick={go('/admin/settings/email/logs')}
          />
        </SettingsGroup>

        <div className="mb-5">
          <EnvHealthPanel compact />
        </div>

        <SettingsGroup title="Developer">
          <SettingsNavRow
            icon={<Book className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm"
            title="Documentation"
            subtitle="Workflow, concepts & environment"
            onClick={go('/admin/settings/documentation')}
          />
          <SettingsNavRow
            icon={<Webhook className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-pink-500 to-rose-600 shadow-sm"
            title="Webhooks"
            subtitle="Paystack, Fez & order ingestion"
            onClick={go('/admin/settings/webhooks')}
          />
          <SettingsNavRow
            icon={<Key className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm"
            title="API reference"
            subtitle="Endpoints & base URL"
            onClick={go('/admin/settings/api')}
          />
          <SettingsNavRow
            icon={<Database className="h-5 w-5 text-white" />}
            iconClass="bg-gradient-to-br from-slate-500 to-slate-700 shadow-sm"
            title="Database"
            subtitle="Schema overview & backups"
            onClick={go('/admin/settings/database')}
          />
        </SettingsGroup>

        <div className="mb-5">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Quick links</p>
          <DeveloperResourceLinks compact />
        </div>

        <p className="px-2 pb-4 text-center text-[11px] text-gray-400">
          Admin-only configuration · secrets never shown in full
        </p>
      </div>
    </div>
  );
}
