import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TABBAR_SPACE } from '../lib/functionsAuth';

export function SettingsSubpage({
  title,
  subtitle,
  children,
  backTo = '/admin/settings',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backTo?: string;
}) {
  const navigate = useNavigate();

  return (
    <div style={{ paddingBottom: TABBAR_SPACE }}>
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-2 py-3">
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 active:bg-gray-100"
            aria-label="Back to settings"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 pr-2">
            <h1 className="truncate text-base font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      {title && (
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      )}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">{children}</div>
    </div>
  );
}

export function SettingsNavRow({
  icon,
  iconClass,
  title,
  subtitle,
  onClick,
  badge,
}: {
  icon: ReactNode;
  iconClass: string;
  title: string;
  subtitle?: string;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3.5 text-left last:border-b-0 active:bg-gray-50"
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {badge && (
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700">{badge}</span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      </div>
      <svg className="h-4 w-4 shrink-0 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export function StatusPill({
  ok,
  label,
  tone,
}: {
  ok?: boolean;
  label: string;
  tone?: 'ok' | 'bad' | 'neutral' | 'warn';
}) {
  const resolved = tone ?? (ok ? 'ok' : 'bad');
  const styles = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    bad: 'bg-red-50 text-red-700 ring-red-100',
    neutral: 'bg-gray-100 text-gray-600 ring-gray-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-100',
  };
  const dot = {
    ok: 'bg-emerald-500',
    bad: 'bg-red-500',
    neutral: 'bg-gray-400',
    warn: 'bg-amber-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles[resolved]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[resolved]}`} />
      {label}
    </span>
  );
}

export const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

const ENV_KEY_LABELS: Record<string, string> = {
  cj_api_key: 'CJ_API_KEY',
  cj_api_base_url: 'CJ_API_BASE_URL',
};

export function formatEnvKey(key: string) {
  return ENV_KEY_LABELS[key] || key.replace(/_/g, ' ').toUpperCase();
}

export function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-3.5 last:border-b-0">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <div className="flex items-start justify-between gap-3 border-b border-gray-50 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
