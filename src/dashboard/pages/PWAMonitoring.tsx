import { useEffect, useState, useCallback } from 'react';
import {
  RefreshCw, Smartphone, Bell, AlertTriangle, Activity,
  TrendingUp, Download, Eye, XCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import { supabase } from '../contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawEvent {
  event_name: string;
  platform: string | null;
  source_page: string | null;
  created_at: string | null;
}

interface WebhookError {
  id: string;
  error_message: string | null;
  created_at: string | null;
  woocommerce_order_id: string | null;
}

interface DayCount { date: string; events: number; installs: number; }
interface PlatformCount { name: string; value: number; }
interface SourceRow { page: string; count: number; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COLORS = ['#7c3aed', '#2563eb', '#16a34a', '#ea580c', '#dc2626'];

const EVENT_LABELS: Record<string, string> = {
  pwa_install_prompt_shown: 'Prompt Shown',
  pwa_install_clicked: 'Install Clicked',
  pwa_install_accepted: 'Install Accepted',
  pwa_install_dismissed: 'Dismissed',
  pwa_appinstalled: 'App Installed',
  pwa_opened_standalone: 'Standalone Opens',
  pwa_ios_guide_dismissed: 'iOS Guide Dismissed',
  notification_prompt_shown: 'Notif Prompt Shown',
  notification_prompt_allowed: 'Notif Allowed',
  notification_prompt_declined: 'Notif Declined',
  notification_prompt_snoozed: 'Notif Snoozed',
};

function StatCard({ label, value, color = 'purple', sub }: { label: string; value: number; color?: string; sub?: string }) {
  const bg: Record<string, string> = {
    purple: 'bg-purple-50', blue: 'bg-blue-50', green: 'bg-green-50',
    orange: 'bg-orange-50', red: 'bg-red-50', gray: 'bg-gray-50',
  };
  const text: Record<string, string> = {
    purple: 'text-purple-700', blue: 'text-blue-700', green: 'text-green-700',
    orange: 'text-orange-600', red: 'text-red-600', gray: 'text-gray-700',
  };
  return (
    <div className={`${bg[color] ?? bg.gray} rounded-lg p-3 text-center`}>
      <p className={`text-2xl font-bold ${text[color] ?? text.gray}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PWAMonitoringPage() {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [webhookErrors, setWebhookErrors] = useState<WebhookError[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsResult, errorsResult] = await Promise.all([
        supabase.from('pwa_install_events').select('event_name, platform, source_page, created_at').order('created_at', { ascending: false }),
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

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const count = (name: string) => events.filter((e) => e.event_name === name).length;
  const countPlat = (name: string, plat: string) => events.filter((e) => e.event_name === name && e.platform === plat).length;

  const promptShown    = count('pwa_install_prompt_shown');
  const installClicked = count('pwa_install_clicked');
  const installAccepted= count('pwa_install_accepted');
  const appInstalled   = count('pwa_appinstalled');
  const dismissed      = count('pwa_install_dismissed');
  const standaloneOpens= count('pwa_opened_standalone');
  const iosGuide       = count('pwa_ios_guide_dismissed');

  const conversionRate = promptShown > 0 ? ((appInstalled / promptShown) * 100).toFixed(1) : '0';

  // Platform breakdown
  const platformData: PlatformCount[] = [
    { name: 'iOS', value: events.filter((e) => e.platform === 'ios').length },
    { name: 'Android', value: events.filter((e) => e.platform === 'android_desktop').length },
    { name: 'PWA (Android)', value: events.filter((e) => e.platform === 'android_pwa').length },
  ].filter((p) => p.value > 0);

  // Trend — last 30 days
  const last30: DayCount[] = Array.from({ length: 30 }, (_, i) => {
    const d = subDays(new Date(), 29 - i);
    const dateStr = format(d, 'yyyy-MM-dd');
    const dayEvents = events.filter((e) => e.created_at && format(parseISO(e.created_at), 'yyyy-MM-dd') === dateStr);
    return {
      date: format(d, 'MMM d'),
      events: dayEvents.length,
      installs: dayEvents.filter((e) => e.event_name === 'pwa_appinstalled').length,
    };
  });

  // Source page breakdown
  const sourceCounts: Record<string, number> = {};
  for (const e of events) {
    const page = e.source_page || '/unknown';
    sourceCounts[page] = (sourceCounts[page] || 0) + 1;
  }
  const sourceRows: SourceRow[] = Object.entries(sourceCounts)
    .map(([page, c]) => ({ page, count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Recent events (last 20)
  const recentEvents = events.slice(0, 20);

  // Notification stats
  const notifShown   = count('notification_prompt_shown');
  const notifAllowed = count('notification_prompt_allowed');
  const notifDeclined= count('notification_prompt_declined');
  const notifSnoozed = count('notification_prompt_snoozed');

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-purple-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">PWA Monitoring</h1>
            <p className="text-xs text-gray-500">JulineMart customer app — install events &amp; backend errors</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Updated {format(lastUpdated, 'HH:mm:ss')}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Section 1: Install Funnel Stats ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Download className="w-4 h-4 text-purple-600" /> Install Funnel
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">All-time totals · {events.length} total events recorded</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-purple-700">{conversionRate}%</p>
            <p className="text-xs text-gray-500">Conversion rate</p>
          </div>
        </div>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Prompt Shown"     value={promptShown}     color="purple" />
            <StatCard label="Install Clicked"  value={installClicked}  color="blue" />
            <StatCard label="Install Accepted" value={installAccepted}  color="blue" />
            <StatCard label="App Installed"    value={appInstalled}    color="green" />
            <StatCard label="Standalone Opens" value={standaloneOpens}  color="orange" />
            <StatCard label="iOS Guide Skip"   value={iosGuide}        color="gray" />
            <StatCard label="Dismissed"        value={dismissed}       color="red" />
          </div>
        )}
      </div>

      {/* ── Section 2: Platform + Notification ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Platform Breakdown */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-blue-600" /> Platform Breakdown
          </h2>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={platformData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                  {platformData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Notification Opt-in */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Bell className="w-4 h-4 text-orange-500" /> Push Notification Opt-in
          </h2>
          {loading ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : notifShown === 0 ? (
            <p className="text-sm text-gray-400 mt-6 text-center">No notification prompt events yet</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <StatCard label="Prompt Shown" value={notifShown}   color="purple" />
              <StatCard label="Allowed"      value={notifAllowed} color="green" sub={notifShown > 0 ? `${((notifAllowed / notifShown) * 100).toFixed(0)}% opt-in` : ''} />
              <StatCard label="Declined"     value={notifDeclined}color="red" />
              <StatCard label="Snoozed"      value={notifSnoozed} color="orange" />
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: 30-day Trend ── */}
      <div className="card">
        <h2 className="text-base font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" /> Activity Trend — Last 30 Days
        </h2>
        {loading ? (
          <div className="h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={last30} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="events"   name="All Events"  fill="#7c3aed" radius={[2,2,0,0]} />
              <Bar dataKey="installs" name="App Installs" fill="#16a34a" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Section 4: Source Pages + Recent Events ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Source Pages */}
        <div className="card">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-500" /> Top Source Pages
          </h2>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-2">
              {sourceRows.map((row) => (
                <div key={row.page} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 truncate max-w-[75%] font-mono text-xs">{row.page}</span>
                  <span className="font-semibold text-gray-800 ml-2">{row.count}</span>
                </div>
              ))}
              {sourceRows.length === 0 && <p className="text-sm text-gray-400">No data</p>}
            </div>
          )}
        </div>

        {/* Recent Events */}
        <div className="card">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-500" /> Recent Events
          </h2>
          {loading ? (
            <div className="h-32 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {recentEvents.map((e, i) => (
                <div key={i} className="flex items-start justify-between text-xs border-b border-gray-50 pb-1.5">
                  <div>
                    <span className="font-medium text-gray-700">
                      {EVENT_LABELS[e.event_name] ?? e.event_name}
                    </span>
                    <span className="text-gray-400 ml-1.5">· {e.platform ?? '—'}</span>
                    {e.source_page && (
                      <span className="text-gray-400 ml-1.5 font-mono">· {e.source_page}</span>
                    )}
                  </div>
                  <span className="text-gray-400 ml-2 shrink-0">
                    {e.created_at ? format(parseISO(e.created_at), 'MMM d HH:mm') : '—'}
                  </span>
                </div>
              ))}
              {recentEvents.length === 0 && <p className="text-sm text-gray-400">No events yet</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5: Webhook Errors ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Backend Webhook Errors
          </h2>
          {webhookErrors.length > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
              {webhookErrors.length} errors
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : webhookErrors.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-green-600 py-4">
            <XCircle className="w-4 h-4" />
            No webhook errors recorded
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4 font-medium">Order Ref</th>
                  <th className="pb-2 pr-4 font-medium">Error</th>
                  <th className="pb-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {webhookErrors.map((err) => (
                  <tr key={err.id} className="hover:bg-red-50 transition">
                    <td className="py-2 pr-4 font-mono text-gray-600">{err.woocommerce_order_id ?? '—'}</td>
                    <td className="py-2 pr-4 text-red-700 max-w-xs truncate">{err.error_message ?? '—'}</td>
                    <td className="py-2 text-gray-400 whitespace-nowrap">
                      {err.created_at ? format(parseISO(err.created_at), 'MMM d HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
