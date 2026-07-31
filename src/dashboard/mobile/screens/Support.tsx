import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { PullToRefresh } from '../PullToRefresh';

interface SupportSession {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: 'open' | 'assigned' | 'closed';
  mode: 'ai' | 'human';
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  created_at: string;
  source_app: string | null;
}

type StatusFilter = 'all' | 'open' | 'assigned' | 'closed';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

// Same query, filters and realtime subscription as SupportInbox.tsx (the
// desktop page) — this is a mobile layout over identical data, not a
// separate feature.
export default function MobileSupport() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchSessions = useCallback(async () => {
    let query = supabase
      .from('support_sessions')
      .select('id, customer_name, customer_email, status, mode, assigned_staff_id, assigned_staff_name, last_message_at, last_message_preview, unread_count, created_at, source_app')
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);

    const { data, error } = await query;
    if (!error && data) setSessions(data);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Local Notifications API only (shown while this tab is open) — there's no
  // real push infrastructure for admin (no VAPID keys, no subscription
  // storage, no service worker push handler), so this can't reach a closed
  // app. Same pattern SupportInbox.tsx (desktop) already used, extended with
  // a click handler neither surface had before — clicking previously did
  // nothing but focus the browser.
  const notifyHumanRequested = (title: string, session: SupportSession) => {
    if (Notification.permission !== 'granted') return;
    const notif = new Notification(title, {
      body: `${session.customer_name || 'A customer'} needs help`,
      icon: '/icon-192.png',
    });
    notif.onclick = () => {
      window.focus();
      navigate(`/admin/support/${session.id}`);
      notif.close();
    };
  };

  useEffect(() => {
    fetchSessions();

    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel('mobile_support_sessions_inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_sessions' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newSession = payload.new as SupportSession;
            setSessions((prev) => [newSession, ...prev]);
            if (newSession.mode === 'human') {
              notifyHumanRequested('New Support Chat', newSession);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as SupportSession;
            setSessions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
            if (updated.mode === 'human') {
              notifyHumanRequested('Customer Needs an Agent', updated);
            }
          }
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSessions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.customer_name?.toLowerCase().includes(q) ||
        s.customer_email?.toLowerCase().includes(q) ||
        s.last_message_preview?.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const counts = useMemo(
    () => ({
      all: sessions.length,
      open: sessions.filter((s) => s.status === 'open').length,
      assigned: sessions.filter((s) => s.status === 'assigned').length,
      closed: sessions.filter((s) => s.status === 'closed').length,
    }),
    [sessions],
  );

  const filters: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'assigned', label: 'Assigned' },
    { key: 'closed', label: 'Closed' },
  ];

  return (
    <PullToRefresh onRefresh={fetchSessions}>
      <div className="sticky top-0 z-10 space-y-2.5 bg-gray-50 px-4 pb-3 pt-3 dark:bg-gray-950">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-900">
          <Search className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email or message"
            className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            style={{ fontSize: '16px' }}
          />
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          {filters.map((filter) => {
            const active = statusFilter === filter.key;
            const count = counts[filter.key];
            if (filter.key !== 'all' && count === 0) return null;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                aria-pressed={active}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                  active
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                }`}
              >
                {filter.label} {count}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-px">
          <div className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800" />
          <div className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800" />
          <div className="h-16 animate-pulse bg-gray-100 dark:bg-gray-800" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
            No conversations match.
          </div>
        </div>
      ) : (
        <div>
          {filtered.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => navigate(`/admin/support/${session.id}`)}
              className="flex w-full items-start gap-3 border-b border-gray-100 bg-white px-4 py-3 text-left dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {initials(session.customer_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {session.customer_name || session.customer_email || 'Unknown'}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-gray-400 dark:text-gray-500">{timeAgo(session.last_message_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                  {session.last_message_preview || 'No messages yet'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <SessionModeTag mode={session.mode} />
                  <SessionStatusTag status={session.status} />
                  {session.assigned_staff_name && (
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {session.assigned_staff_id === user?.id ? 'You' : session.assigned_staff_name}
                    </span>
                  )}
                </div>
              </div>
              {session.unread_count > 0 && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
            </button>
          ))}
        </div>
      )}
    </PullToRefresh>
  );
}

function SessionModeTag({ mode }: { mode: 'ai' | 'human' }) {
  return mode === 'human' ? (
    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">Human</span>
  ) : (
    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">AI</span>
  );
}

function SessionStatusTag({ status }: { status: 'open' | 'assigned' | 'closed' }) {
  const styles: Record<string, string> = {
    open: 'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-400',
    assigned: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400',
    closed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}
