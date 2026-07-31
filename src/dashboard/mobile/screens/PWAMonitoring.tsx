import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle,
  Download,
  Eye,
  Loader,
  RefreshCw,
  Smartphone,
  TrendingUp,
} from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { supabase } from '../../contexts/AuthContext';
import { PullToRefresh } from '../PullToRefresh';
import { TABBAR_SPACE } from '../lib/functionsAuth';

interface RawEvent {
  event_name: string;
  platform: string | null;
  source_page: string | null;
  created_at: string | null;
  anonymous_id: string | null;
}

interface WebhookError {
  id: string;
  error_message: string | null;
  created_at: string | null;
  woocommerce_order_id: string | null;
}

type FeedTab = 'activity' | 'sources' | 'errors';

const EVENT_LABELS: Record<string, string> = {
  pwa_install_prompt_shown: 'Prompt shown',
  pwa_install_clicked: 'Install clicked',
  pwa_install_accepted: 'Install accepted',
  pwa_install_dismissed: 'Dismissed',
  pwa_appinstalled: 'App installed',
  pwa_opened_standalone: 'Standalone open',
  pwa_ios_guide_dismissed: 'iOS guide skipped',
  notification_prompt_shown: 'Notif prompt',
  notification_prompt_allowed: 'Notif allowed',
  notification_prompt_declined: 'Notif declined',
  notification_prompt_snoozed: 'Notif snoozed',
};

const PLATFORM_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-orange-500'];

function ConversionRing({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const deg = (clamped / 100) * 360;
  return (
    <div
      className="relative h-16 w-16 shrink-0 rounded-full"
      style={{ background: `conic-gradient(#a78bfa ${deg}deg, #334155 ${deg}deg)` }}
    >
      <div className="absolute inset-1.5 flex flex-col items-center justify-center rounded-full bg-slate-900">
        <span className="text-sm font-bold text-white">{clamped.toFixed(0)}%</span>
        <span className="text-[8px] uppercase tracking-wide text-slate-400">conv.</span>
      </div>
    </div>
  );
}

function FunnelStep({
  label,
  value,
  unique,
  pct,
  accent,
  last,
}: {
  label: string;
  value: number;
  unique?: number;
  pct?: number;
  accent: string;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3">
      {!last && <div className="absolute left-[11px] top-7 h-[calc(100%-4px)] w-0.5 bg-violet-200" />}
      <div className={`relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${accent} text-[10px] font-bold text-white`}>
        {value > 99 ? '99+' : value}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {pct !== undefined && pct > 0 && (
            <span className="shrink-0 text-[10px] font-semibold text-violet-600">{pct.toFixed(0)}% of prompt</span>
          )}
        </div>
        {unique !== undefined && unique > 0 && (
          <p className="text-[10px] text-gray-400">{unique} unique users</p>
        )}
      </div>
    </div>
  );
}

function TrendChart({ rows, maxDay }: { rows: { date: string; events: number; installs: number }[]; maxDay: number }) {
  return (
    <div className="flex items-end justify-between gap-1 pt-2" style={{ height: 100 }}>
      {rows.map((d) => (
        <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="relative flex w-full flex-1 items-end justify-center gap-0.5">
            <div
              className="w-[42%] rounded-t bg-violet-300"
              style={{ height: `${Math.max(4, (d.events / maxDay) * 100)}%` }}
            />
            <div
              className="w-[42%] rounded-t bg-emerald-500"
              style={{ height: `${Math.max(2, (d.installs / maxDay) * 100)}%` }}
            />
          </div>
          <span className="truncate text-[8px] font-medium text-gray-400">{d.date.split(' ')[1]}</span>
        </div>
      ))}
    </div>
  );
}

export default function MobilePWAMonitoring() {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [webhookErrors, setWebhookErrors] = useState<WebhookError[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [feedTab, setFeedTab] = useState<FeedTab>('activity');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsResult, errorsResult] = await Promise.all([
        supabase.from('pwa_install_events').select('event_name, platform, source_page, created_at, anonymous_id').order('created_at', { ascending: false }),
        supabase.from('webhook_errors').select('id, error_message, created_at, woocommerce_order_id').order('created_at', { ascending: false }).limit(20),
      ]);
      setEvents(eventsResult.data ?? []);
      setWebhookErrors(errorsResult.data ?? []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('PWA Monitoring fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const stats = useMemo(() => {
    const count = (name: string) => events.filter((e) => e.event_name === name).length;
    const uniqueUsers = (eventName: string) =>
      new Set(events.filter((e) => e.event_name === eventName && e.anonymous_id).map((e) => e.anonymous_id)).size;

    const promptShown = count('pwa_install_prompt_shown');
    const appInstalled = count('pwa_appinstalled');
    const conversionNum = promptShown > 0 ? (appInstalled / promptShown) * 100 : 0;

    const funnel = [
      { key: 'prompt', label: 'Prompt shown', value: promptShown, unique: uniqueUsers('pwa_install_prompt_shown'), accent: 'bg-violet-600' },
      { key: 'click', label: 'Install clicked', value: count('pwa_install_clicked'), pct: promptShown ? (count('pwa_install_clicked') / promptShown) * 100 : 0, accent: 'bg-violet-500' },
      { key: 'accept', label: 'Install accepted', value: count('pwa_install_accepted'), pct: promptShown ? (count('pwa_install_accepted') / promptShown) * 100 : 0, accent: 'bg-indigo-500' },
      { key: 'installed', label: 'App installed', value: appInstalled, unique: uniqueUsers('pwa_appinstalled'), pct: promptShown ? conversionNum : 0, accent: 'bg-emerald-500' },
      { key: 'standalone', label: 'Standalone opens', value: count('pwa_opened_standalone'), unique: uniqueUsers('pwa_opened_standalone'), pct: promptShown ? (count('pwa_opened_standalone') / promptShown) * 100 : 0, accent: 'bg-teal-500' },
    ];

    const platformData = [
      { name: 'iOS browser', value: events.filter((e) => e.platform === 'ios').length },
      { name: 'Android browser', value: events.filter((e) => e.platform === 'android_desktop').length },
      { name: 'PWA Android', value: events.filter((e) => e.platform === 'android_pwa').length },
      { name: 'PWA iOS', value: events.filter((e) => e.platform === 'ios_pwa').length },
    ].filter((p) => p.value > 0);
    const platformTotal = platformData.reduce((s, p) => s + p.value, 0) || 1;

    const last14 = Array.from({ length: 14 }, (_, i) => {
      const d = subDays(new Date(), 13 - i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayEvents = events.filter((e) => e.created_at && format(parseISO(e.created_at), 'yyyy-MM-dd') === dateStr);
      return {
        date: format(d, 'MMM d'),
        events: dayEvents.length,
        installs: dayEvents.filter((e) => e.event_name === 'pwa_appinstalled').length,
      };
    });
    const maxDay = Math.max(...last14.map((d) => d.events), 1);

    const sourceCounts: Record<string, number> = {};
    for (const e of events) {
      const page = e.source_page || '/unknown';
      sourceCounts[page] = (sourceCounts[page] || 0) + 1;
    }
    const sourceRows = Object.entries(sourceCounts)
      .map(([page, c]) => ({ page, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const maxSource = Math.max(...sourceRows.map((r) => r.count), 1);

    const notifShown = count('notification_prompt_shown');
    const notifAllowed = count('notification_prompt_allowed');
    const notifOptIn = notifShown > 0 ? (notifAllowed / notifShown) * 100 : 0;

    return {
      count,
      promptShown,
      appInstalled,
      conversionNum,
      funnel,
      platformData,
      platformTotal,
      last14,
      maxDay,
      sourceRows,
      maxSource,
      notifShown,
      notifAllowed,
      notifOptIn,
      notifDeclined: count('notification_prompt_declined'),
      notifSnoozed: count('notification_prompt_snoozed'),
      dismissed: count('pwa_install_dismissed'),
      recentEvents: events.slice(0, 25),
    };
  }, [events]);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-4 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">PWA monitoring</h1>
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live · {lastUpdated ? format(lastUpdated, 'HH:mm') : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {loading && events.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <>
            {/* Hero */}
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-violet-950 via-purple-900 to-indigo-950 p-4 text-white shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-violet-300/80">Install conversion</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{stats.conversionNum.toFixed(1)}%</p>
                  <p className="mt-1 text-xs text-violet-200/70">
                    {stats.appInstalled} installs from {stats.promptShown} prompts
                  </p>
                </div>
                <ConversionRing pct={stats.conversionNum} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                <div>
                  <p className="text-[10px] text-violet-300/70">Total events</p>
                  <p className="text-sm font-semibold tabular-nums">{events.length}</p>
                </div>
                <div>
                  <p className="text-[10px] text-violet-300/70">Standalone</p>
                  <p className="text-sm font-semibold tabular-nums">{stats.count('pwa_opened_standalone')}</p>
                </div>
                <div>
                  <p className="text-[10px] text-violet-300/70">Dismissed</p>
                  <p className="text-sm font-semibold tabular-nums text-red-300">{stats.dismissed}</p>
                </div>
              </div>
            </div>

            {/* Funnel timeline */}
            <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Download className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-semibold text-gray-900">Install funnel</h2>
              </div>
              {stats.promptShown === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">No install prompts yet</p>
              ) : (
                stats.funnel.map((step, i) => (
                  <FunnelStep
                    key={step.key}
                    label={step.label}
                    value={step.value}
                    unique={step.unique}
                    pct={step.pct}
                    accent={step.accent}
                    last={i === stats.funnel.length - 1}
                  />
                ))
              )}
            </div>

            {/* Platform mix */}
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Platform mix</h2>
              </div>
              {stats.platformData.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">No platform data</p>
              ) : (
                <>
                  <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-gray-100">
                    {stats.platformData.map((p, i) => (
                      <div
                        key={p.name}
                        className={PLATFORM_COLORS[i % PLATFORM_COLORS.length]}
                        style={{ width: `${(p.value / stats.platformTotal) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="space-y-2">
                    {stats.platformData.map((p, i) => (
                      <div key={p.name} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-gray-700">
                          <span className={`h-2 w-2 rounded-full ${PLATFORM_COLORS[i % PLATFORM_COLORS.length]}`} />
                          {p.name}
                        </span>
                        <span className="font-semibold tabular-nums text-gray-900">{p.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 14-day trend */}
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold text-gray-900">14-day activity</h2>
                </div>
                <div className="flex gap-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-violet-300" />Events</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded bg-emerald-500" />Installs</span>
                </div>
              </div>
              <TrendChart rows={stats.last14} maxDay={stats.maxDay} />
            </div>

            {/* Notifications */}
            <div className="rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50/70 to-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Push opt-in</h2>
                </div>
                {stats.notifShown > 0 && (
                  <span className="text-sm font-bold text-orange-700">{stats.notifOptIn.toFixed(0)}%</span>
                )}
              </div>
              {stats.notifShown === 0 ? (
                <p className="py-2 text-center text-sm text-gray-400">No notification prompts yet</p>
              ) : (
                <>
                  <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.notifOptIn}%` }} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-white/80 p-2 ring-1 ring-orange-100">
                      <p className="text-base font-bold text-gray-900">{stats.notifShown}</p>
                      <p className="text-[9px] text-gray-500">Shown</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2 ring-1 ring-green-100">
                      <p className="text-base font-bold text-green-700">{stats.notifAllowed}</p>
                      <p className="text-[9px] text-gray-500">Allowed</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2 ring-1 ring-red-100">
                      <p className="text-base font-bold text-red-600">{stats.notifDeclined}</p>
                      <p className="text-[9px] text-gray-500">Declined</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Feed tabs */}
            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="flex border-b border-gray-100">
                {([
                  { id: 'activity' as const, label: 'Activity', icon: Activity },
                  { id: 'sources' as const, label: 'Sources', icon: Eye },
                  { id: 'errors' as const, label: 'Errors', icon: AlertTriangle, badge: webhookErrors.length },
                ]).map(({ id, label, icon: Icon, badge }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFeedTab(id)}
                    className={`relative flex flex-1 items-center justify-center gap-1 py-3 text-xs font-semibold ${
                      feedTab === id ? 'border-b-2 border-violet-600 text-violet-700' : 'text-gray-500'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {badge ? (
                      <span className="rounded-full bg-red-100 px-1.5 text-[9px] font-bold text-red-700">{badge}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              <div className="max-h-80 overflow-y-auto p-3">
                {feedTab === 'activity' && (
                  stats.recentEvents.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">No events yet</p>
                  ) : (
                    <div className="space-y-0">
                      {stats.recentEvents.map((e, i) => (
                        <div key={i} className="relative flex gap-3 pb-4">
                          {i < stats.recentEvents.length - 1 && (
                            <div className="absolute left-[7px] top-4 h-full w-0.5 bg-gray-100" />
                          )}
                          <div className="relative z-10 mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-violet-400 ring-2 ring-white" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">{EVENT_LABELS[e.event_name] ?? e.event_name}</p>
                            <p className="text-[11px] text-gray-500">{e.platform ?? 'Unknown platform'}</p>
                            {e.source_page && (
                              <p className="truncate font-mono text-[10px] text-gray-400">{e.source_page}</p>
                            )}
                            <p className="mt-0.5 text-[10px] text-gray-400">
                              {e.created_at ? format(parseISO(e.created_at), 'MMM d · HH:mm') : '—'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {feedTab === 'sources' && (
                  stats.sourceRows.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">No source data</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.sourceRows.map((row) => (
                        <div key={row.page}>
                          <div className="mb-1 flex justify-between gap-2 text-xs">
                            <span className="truncate font-mono text-gray-700">{row.page}</span>
                            <span className="shrink-0 font-bold tabular-nums text-gray-900">{row.count}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-violet-400" style={{ width: `${(row.count / stats.maxSource) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {feedTab === 'errors' && (
                  webhookErrors.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-green-600">
                      <CheckCircle className="h-8 w-8" />
                      <p className="text-sm font-medium">All clear — no webhook errors</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {webhookErrors.map((err) => (
                        <div key={err.id} className="rounded-xl bg-red-50 p-3 ring-1 ring-red-100">
                          <p className="font-mono text-xs font-medium text-gray-700">{err.woocommerce_order_id ?? 'Unknown order'}</p>
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-red-700">{err.error_message ?? '—'}</p>
                          <p className="mt-1.5 text-[10px] text-gray-400">
                            {err.created_at ? format(parseISO(err.created_at), 'MMM d · HH:mm') : '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
