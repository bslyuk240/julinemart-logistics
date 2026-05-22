import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, Search, Bot, User, Clock, Circle, RefreshCw } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useAuth } from '../contexts/AuthContext';

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
type ModeFilter   = 'all' | 'ai' | 'human';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SupportInbox() {
  const { user }   = useAuth();
  const navigate   = useNavigate();

  const [sessions, setSessions]           = useState<SupportSession[]>([]);
  const [loading, setLoading]             = useState(true);
  const [searchTerm, setSearchTerm]       = useState('');
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('all');
  const [modeFilter, setModeFilter]       = useState<ModeFilter>('all');
  const [newSessionAlert, setNewSessionAlert] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch sessions ────────────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    let query = supabase
      .from('support_sessions')
      .select('id, customer_name, customer_email, status, mode, assigned_staff_id, assigned_staff_name, last_message_at, last_message_preview, unread_count, created_at, source_app')
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (modeFilter   !== 'all') query = query.eq('mode', modeFilter);

    const { data, error } = await query;
    if (!error && data) setSessions(data);
    setLoading(false);
  }, [statusFilter, modeFilter]);

  // ── Realtime subscription ─────────────────────────────────────────────────

  useEffect(() => {
    fetchSessions();

    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel('support_sessions_inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_sessions' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newSession = payload.new as SupportSession;
            setSessions(prev => [newSession, ...prev]);
            // Alert for human-requested sessions
            if (newSession.mode === 'human') {
              setNewSessionAlert(true);
              setTimeout(() => setNewSessionAlert(false), 4000);
              // Browser notification
              if (Notification.permission === 'granted') {
                new Notification('New Support Chat', {
                  body: `${newSession.customer_name || 'A customer'} needs help`,
                  icon: '/icon-192.png',
                });
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as SupportSession;
            setSessions(prev =>
              prev.map(s => s.id === updated.id ? { ...s, ...updated } : s)
            );
            // Notify when a session flips to human mode
            if (updated.mode === 'human') {
              setNewSessionAlert(true);
              setTimeout(() => setNewSessionAlert(false), 4000);
              if (Notification.permission === 'granted') {
                new Notification('Customer Needs an Agent', {
                  body: `${updated.customer_name || 'A customer'} requested a human agent`,
                  icon: '/icon-192.png',
                });
              }
            }
          }
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [fetchSessions]);

  // ── Request browser notification permission on first visit ────────────────

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Filtered sessions ─────────────────────────────────────────────────────

  const filtered = sessions.filter(s => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      s.customer_name?.toLowerCase().includes(q) ||
      s.customer_email?.toLowerCase().includes(q) ||
      s.last_message_preview?.toLowerCase().includes(q)
    );
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  const humanWaiting = sessions.filter(s => s.mode === 'human' && s.status === 'open' && !s.assigned_staff_id).length;
  const myChats      = sessions.filter(s => s.assigned_staff_id === user?.id).length;
  const totalUnread  = sessions.reduce((acc, s) => acc + (s.unread_count ?? 0), 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#77088a' }}>
            <Headphones className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Live Support</h1>
            <p className="text-sm text-gray-500">Customer chat inbox</p>
          </div>
        </div>
        <button onClick={fetchSessions} className="p-2 text-gray-500 hover:text-gray-700 transition-colors" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* New session alert */}
      {newSessionAlert && (
        <div className="mb-4 px-4 py-3 rounded-xl text-white font-medium text-sm animate-fade-in"
          style={{ backgroundColor: '#77088a' }}>
          A customer is requesting a human agent — check the list below.
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Waiting for agent" value={humanWaiting} highlight={humanWaiting > 0} />
        <StatCard label="My active chats"   value={myChats} />
        <StatCard label="Total unread"       value={totalUnread} highlight={totalUnread > 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email or message…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="assigned">Assigned</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value as ModeFilter)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"
        >
          <option value="all">All modes</option>
          <option value="human">Human only</option>
          <option value="ai">AI only</option>
        </select>
      </div>

      {/* Session list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading sessions…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {searchTerm ? 'No sessions match your search.' : 'No support sessions yet.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              isMySession={session.assigned_staff_id === user?.id}
              onClick={() => navigate(`/admin/support/${session.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 text-center ${highlight ? 'border-purple-200 bg-purple-50' : 'border-gray-100 bg-white'}`}>
      <p className={`text-2xl font-bold ${highlight ? 'text-purple-700' : 'text-gray-800'}`} style={highlight ? { color: '#77088a' } : {}}>
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function SessionCard({
  session,
  isMySession,
  onClick,
}: {
  session: SupportSession;
  isMySession: boolean;
  onClick: () => void;
}) {
  const needsAgent = session.mode === 'human' && session.status === 'open' && !session.assigned_staff_id;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border p-4 flex items-center gap-4 hover:shadow-md transition-all ${
        needsAgent ? 'border-purple-200 ring-1 ring-purple-100' : 'border-gray-100'
      }`}
    >
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm"
        style={{ backgroundColor: '#77088a' }}>
        {session.customer_name ? session.customer_name.charAt(0).toUpperCase() : '?'}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-gray-900 text-sm truncate">
            {session.customer_name || 'Anonymous'}
          </span>
          {/* Mode badge */}
          {session.mode === 'human' ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
              <User className="w-2.5 h-2.5" /> Human
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
              <Bot className="w-2.5 h-2.5" /> AI
            </span>
          )}
          {session.source_app === 'julineservices' && (
            <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700">
              JulineServices
            </span>
          )}
          {session.source_app === 'storefront' && (
            <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700">
              PWA
            </span>
          )}
          {isMySession && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: '#77088a' }}>
              Mine
            </span>
          )}
        </div>
        <p className="text-gray-500 text-xs truncate">{session.last_message_preview || 'No messages yet'}</p>
        {session.customer_email && (
          <p className="text-gray-400 text-[11px] mt-0.5">{session.customer_email}</p>
        )}
      </div>

      {/* Right side */}
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        <span className="text-gray-400 text-[11px] flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo(session.last_message_at)}
        </span>
        {session.unread_count > 0 && (
          <span className="text-[11px] font-bold text-white rounded-full w-5 h-5 flex items-center justify-center" style={{ backgroundColor: '#77088a' }}>
            {session.unread_count > 9 ? '9+' : session.unread_count}
          </span>
        )}
        {needsAgent && (
          <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#77088a' }}>
            <Circle className="w-2 h-2 fill-current animate-pulse" /> Waiting
          </span>
        )}
        {/* Status dot */}
        <span className={`w-2 h-2 rounded-full ${
          session.status === 'open'     ? 'bg-green-400' :
          session.status === 'assigned' ? 'bg-blue-400'  : 'bg-gray-300'
        }`} />
      </div>
    </button>
  );
}
