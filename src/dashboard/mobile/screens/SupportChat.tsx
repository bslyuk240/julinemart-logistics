import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Headphones, MoreVertical, Send, User } from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';
import { useAuth } from '../../contexts/AuthContext';
import { Sheet } from '../Sheet';
import { useDevBannerHeight } from '../../../components/DevBanner';

interface SupportSession {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  status: 'open' | 'assigned' | 'closed';
  mode: 'ai' | 'human';
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  unread_count: number;
  created_at: string;
  source_app: string | null;
}

interface SupportMessage {
  id: string;
  sender_type: 'customer' | 'staff' | 'ai';
  sender_name: string | null;
  content: string;
  created_at: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

const TABBAR_SPACE = 'calc(58px + env(safe-area-inset-bottom))';

// Same session + message queries, realtime channel and six actions (join,
// leave, hand to AI, close, reopen, send) as SupportChatView.tsx (desktop) —
// a mobile layout over identical logic. Uses position:fixed to claim its own
// scroll region between the shell header and tab bar, the same way Sheet and
// Scanner already do, rather than fighting MobileShell's <main> scroll.
export default function MobileSupportChat() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const devBannerHeight = useDevBannerHeight();

  const [session, setSession] = useState<SupportSession | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [customerTyping, setCustomerTyping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelReadyRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    if (!sessionId) return;
    const [{ data: sessionData }, { data: msgData }] = await Promise.all([
      supabase
        .from('support_sessions')
        .select('id, customer_name, customer_email, status, mode, assigned_staff_id, assigned_staff_name, unread_count, created_at, source_app')
        .eq('id', sessionId)
        .single(),
      supabase
        .from('support_messages')
        .select('id, sender_type, sender_name, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(300),
    ]);
    if (sessionData) setSession(sessionData);
    if (msgData) setMessages(msgData);
    setLoading(false);
    if (sessionData?.unread_count) {
      supabase.from('support_sessions').update({ unread_count: 0 }).eq('id', sessionId).then(() => {});
    }
  }, [sessionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!sessionId) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel(`mobile_support_chat_${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const newMsg = payload.new as SupportMessage;
          setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
          setCustomerTyping(false);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          supabase.from('support_sessions').update({ unread_count: 0 }).eq('id', sessionId).then(() => {});
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_sessions', filter: `id=eq.${sessionId}` },
        (payload) => setSession(payload.new as SupportSession),
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.role === 'customer') {
          setCustomerTyping(true);
          if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
          typingClearTimerRef.current = setTimeout(() => setCustomerTyping(false), 3000);
        }
      })
      .on('broadcast', { event: 'stop_typing' }, (payload) => {
        if (payload.payload?.role === 'customer') setCustomerTyping(false);
      })
      .subscribe((status) => {
        channelReadyRef.current = status === 'SUBSCRIBED';
      });

    channelRef.current = channel;
    return () => {
      channelReadyRef.current = false;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!loading) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    }
  }, [loading]);

  const joinChat = async () => {
    if (!sessionId || !user) return;
    const { error } = await supabase
      .from('support_sessions')
      .update({ assigned_staff_id: user.id, assigned_staff_name: user.full_name || user.email, status: 'assigned', mode: 'human' })
      .eq('id', sessionId);
    if (!error) {
      await supabase.from('support_messages').insert({
        session_id: sessionId,
        sender_type: 'ai',
        sender_name: 'JulineMart Support',
        content: `${user.full_name || 'An agent'} has joined the chat.`,
      });
    }
  };

  const leaveChat = async () => {
    if (!sessionId || !user) return;
    setMenuOpen(false);
    await supabase
      .from('support_sessions')
      .update({ assigned_staff_id: null, assigned_staff_name: null, status: 'open', mode: 'ai' })
      .eq('id', sessionId);
    await supabase.from('support_messages').insert({
      session_id: sessionId,
      sender_type: 'ai',
      sender_name: 'JulineMart Support',
      content: `${user.full_name || 'The agent'} has left the chat. Our AI assistant will continue to help you.`,
    });
  };

  const handToAI = async () => {
    if (!sessionId || !user) return;
    setMenuOpen(false);
    await supabase
      .from('support_sessions')
      .update({ assigned_staff_id: null, assigned_staff_name: null, status: 'open', mode: 'ai' })
      .eq('id', sessionId);
    await supabase.from('support_messages').insert({
      session_id: sessionId,
      sender_type: 'ai',
      sender_name: 'JulineMart Support',
      content: `${user.full_name || 'The agent'} has handed this chat back to the AI assistant.`,
    });
  };

  const closeChat = async () => {
    if (!sessionId) return;
    setMenuOpen(false);
    await supabase.from('support_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId);
  };

  const reopenChat = async () => {
    if (!sessionId) return;
    await supabase.from('support_sessions').update({ status: 'open', closed_at: null }).eq('id', sessionId);
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !sessionId || !user || sending) return;
    setSending(true);
    setInputText('');
    const { error } = await supabase.from('support_messages').insert({
      session_id: sessionId,
      sender_type: 'staff',
      sender_name: user.full_name || user.email,
      content: text,
    });
    if (error) setInputText(text);
    if (channelReadyRef.current) {
      channelRef.current?.send({ type: 'broadcast', event: 'stop_typing', payload: { role: 'staff' } });
    }
    setSending(false);
  };

  const onInputChange = (value: string) => {
    setInputText(value);
    const ch = channelRef.current;
    if (!ch || !channelReadyRef.current) return;
    ch.send({ type: 'broadcast', event: 'typing', payload: { role: 'staff' } });
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      if (channelReadyRef.current) channelRef.current?.send({ type: 'broadcast', event: 'stop_typing', payload: { role: 'staff' } });
    }, 2000);
  };

  const isMyChat = session?.assigned_staff_id === user?.id;
  const canSend = isMyChat && session?.status !== 'closed';
  const canJoin = !isMyChat && session?.status !== 'closed';
  const isClosed = session?.status === 'closed';

  if (loading) {
    return <div className="flex h-40 items-center justify-center text-sm text-gray-400">Loading chat…</div>;
  }

  if (!session) {
    return <div className="p-4 text-sm text-gray-500">Session not found.</div>;
  }

  return (
    <div
      className="fixed inset-x-0 z-20 flex flex-col bg-gray-50"
      style={{ top: `calc(${56 + devBannerHeight}px + env(safe-area-inset-top))`, bottom: TABBAR_SPACE }}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 py-2.5">
        <button type="button" onClick={() => navigate('/admin/support')} className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: '#77088a' }}
        >
          {session.customer_name?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{session.customer_name || 'Anonymous'}</span>
            <ModeBadge mode={session.mode} />
            <StatusBadge status={session.status} />
          </div>
          {session.customer_email && <p className="truncate text-[11px] text-gray-400">{session.customer_email}</p>}
        </div>

        {canJoin && (
          <button
            type="button"
            onClick={joinChat}
            className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-semibold text-white"
            style={{ backgroundColor: '#77088a' }}
          >
            Join
          </button>
        )}
        {isMyChat && !isClosed && (
          <button type="button" onClick={() => setMenuOpen(true)} className="shrink-0 p-2 text-gray-500" aria-label="More actions">
            <MoreVertical className="h-5 w-5" />
          </button>
        )}
        {isClosed && (
          <button
            type="button"
            onClick={reopenChat}
            className="shrink-0 rounded-lg border border-green-200 px-3 py-2.5 text-xs font-semibold text-green-700"
          >
            Reopen
          </button>
        )}
      </div>

      {session.assigned_staff_name && !isMyChat && (
        <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-4 py-2 text-center text-xs text-blue-700">
          Assigned to <strong>{session.assigned_staff_name}</strong>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isOwnStaff={msg.sender_type === 'staff' && msg.sender_name === (user?.full_name || user?.email)} />
        ))}
        {customerTyping && (
          <div className="flex items-start gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300">
              <User className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 shadow-sm">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-gray-100 bg-white px-3 py-2.5" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        {isClosed ? (
          <p className="py-2 text-center text-sm text-gray-400">This chat is closed.</p>
        ) : !canSend ? (
          <p className="py-2 text-center text-sm text-gray-400">
            {session.mode === 'ai' ? 'AI is handling this chat. Join to take over.' : 'Join the chat to send messages.'}
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={inputText}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder="Type a reply…"
              rows={1}
              className="max-h-28 flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-gray-400"
              style={{ fontSize: '16px', minHeight: '42px' }}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!inputText.trim() || sending}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
              style={{ backgroundColor: '#77088a' }}
            >
              <Send className="h-4 w-4 text-white" />
            </button>
          </div>
        )}
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} ariaLabel="Chat actions">
        <div className="flex flex-col divide-y divide-gray-100">
          {session.mode === 'human' && (
            <button type="button" onClick={handToAI} className="py-3 text-left text-sm font-medium text-purple-700">
              Hand to AI
            </button>
          )}
          <button type="button" onClick={leaveChat} className="py-3 text-left text-sm font-medium text-gray-700">
            Leave chat
          </button>
          <button type="button" onClick={closeChat} className="py-3 text-left text-sm font-medium text-red-600">
            Close chat
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function MessageBubble({ msg, isOwnStaff }: { msg: SupportMessage; isOwnStaff: boolean }) {
  const isCustomer = msg.sender_type === 'customer';
  const isAi = msg.sender_type === 'ai';

  if (isAi && msg.sender_name === 'JulineMart Support') {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-400">{msg.content}</span>
      </div>
    );
  }

  if (isCustomer) {
    return (
      <div className="flex items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-300">
          <User className="h-3.5 w-3.5 text-white" />
        </div>
          <div className="max-w-[78%]">
          <div className="rounded-2xl rounded-tl-sm bg-[#F2F2F2] px-3.5 py-2.5 text-sm leading-relaxed text-gray-800">{msg.content}</div>
          <p className="mt-0.5 text-[10.5px] text-gray-400">{formatTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  if (isAi) {
    return (
      <div className="flex items-start gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: '#77088a' }}>
          <Bot className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="max-w-[78%]">
          <div
            className="rounded-2xl rounded-tl-sm bg-purple-50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-800"
            style={{ borderLeft: '3px solid #77088a' }}
          >
            {msg.content}
          </div>
          <p className="mt-0.5 text-[10.5px] text-gray-400">{formatTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  if (isOwnStaff) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%]">
          <div className="rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed text-white" style={{ backgroundColor: '#77088a' }}>
            {msg.content}
          </div>
          <p className="mt-0.5 text-right text-[10.5px] text-gray-400">You · {formatTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500">
        <Headphones className="h-3.5 w-3.5 text-white" />
      </div>
      <div className="max-w-[78%]">
        <p className="mb-0.5 text-[10.5px] text-gray-400">{msg.sender_name || 'Agent'}</p>
        <div className="rounded-2xl rounded-tl-sm bg-blue-50 px-3.5 py-2.5 text-sm leading-relaxed text-gray-800">{msg.content}</div>
        <p className="mt-0.5 text-[10.5px] text-gray-400">{formatTime(msg.created_at)}</p>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex h-4 items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-gray-300" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function ModeBadge({ mode }: { mode: 'ai' | 'human' }) {
  return mode === 'human' ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
      <User className="h-2.5 w-2.5" /> Human
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
      <Bot className="h-2.5 w-2.5" /> AI
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: 'bg-green-50 text-green-700',
    assigned: 'bg-blue-50 text-blue-700',
    closed: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}
