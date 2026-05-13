import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, User, Bot, Headphones, UserCheck, X, CheckCircle } from 'lucide-react';
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
  unread_count: number;
  created_at: string;
}

interface SupportMessage {
  id: string;
  sender_type: 'customer' | 'staff' | 'ai';
  sender_name: string | null;
  content: string;
  created_at: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SupportChatView() {
  const { sessionId }  = useParams<{ sessionId: string }>();
  const { user }       = useAuth();
  const navigate       = useNavigate();

  const [session, setSession]     = useState<SupportSession | null>(null);
  const [messages, setMessages]   = useState<SupportMessage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending]     = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const channelRef     = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  // ── Load session + messages ───────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!sessionId) return;

    const [{ data: sessionData }, { data: msgData }] = await Promise.all([
      supabase
        .from('support_sessions')
        .select('id, customer_name, customer_email, status, mode, assigned_staff_id, assigned_staff_name, unread_count, created_at')
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
    if (msgData)     setMessages(msgData);
    setLoading(false);

    // Mark as read
    if (sessionData?.unread_count) {
      supabase.from('support_sessions').update({ unread_count: 0 }).eq('id', sessionId).then(() => {});
    }
  }, [sessionId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Realtime ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;

    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel(`support_chat_staff_${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const newMsg = payload.new as SupportMessage;
          setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          // Mark as read immediately when staff is viewing
          supabase.from('support_sessions').update({ unread_count: 0 }).eq('id', sessionId).then(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_sessions', filter: `id=eq.${sessionId}` },
        (payload) => setSession(payload.new as SupportSession)
      )
      .subscribe();

    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [sessionId]);

  // ── Scroll to bottom ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!loading) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    }
  }, [loading]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const joinChat = async () => {
    if (!sessionId || !user) return;
    const { error } = await supabase
      .from('support_sessions')
      .update({
        assigned_staff_id:   user.id,
        assigned_staff_name: user.full_name || user.email,
        status:              'assigned',
        mode:                'human',
      })
      .eq('id', sessionId);

    if (!error) {
      await supabase.from('support_messages').insert({
        session_id:  sessionId,
        sender_type: 'ai',
        sender_name: 'JulineMart Support',
        content:     `${user.full_name || 'An agent'} has joined the chat.`,
      });
    }
  };

  const leaveChat = async () => {
    if (!sessionId) return;
    await supabase
      .from('support_sessions')
      .update({ assigned_staff_id: null, assigned_staff_name: null, status: 'open' })
      .eq('id', sessionId);
  };

  const closeChat = async () => {
    if (!sessionId) return;
    await supabase
      .from('support_sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', sessionId);
  };

  const reopenChat = async () => {
    if (!sessionId) return;
    await supabase
      .from('support_sessions')
      .update({ status: 'open', closed_at: null })
      .eq('id', sessionId);
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !sessionId || !user || sending) return;
    setSending(true);
    setInputText('');

    const { error } = await supabase.from('support_messages').insert({
      session_id:  sessionId,
      sender_type: 'staff',
      sender_name: user.full_name || user.email,
      content:     text,
    });

    if (error) {
      setInputText(text); // restore on error
      console.error('[SupportChatView] send error:', error.message);
    }
    setSending(false);
    inputRef.current?.focus();
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const isMyChat   = session?.assigned_staff_id === user?.id;
  const canSend    = isMyChat && session?.status !== 'closed';
  const canJoin    = !isMyChat && session?.status !== 'closed';
  const isClosed   = session?.status === 'closed';

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading chat…</div>;
  }

  if (!session) {
    return <div className="p-6 text-gray-500 text-sm">Session not found.</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/admin/support')}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
          style={{ backgroundColor: '#77088a' }}>
          {session.customer_name?.charAt(0).toUpperCase() ?? '?'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 text-sm">{session.customer_name || 'Anonymous'}</span>
            <ModeBadge mode={session.mode} />
            <StatusBadge status={session.status} />
          </div>
          {session.customer_email && (
            <p className="text-xs text-gray-400">{session.customer_email}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {canJoin && (
            <button
              onClick={joinChat}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#77088a' }}
            >
              <UserCheck className="w-3.5 h-3.5" /> Join Chat
            </button>
          )}
          {isMyChat && !isClosed && (
            <button
              onClick={leaveChat}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Leave
            </button>
          )}
          {!isClosed ? (
            <button
              onClick={closeChat}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Close
            </button>
          ) : (
            <button
              onClick={reopenChat}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" /> Reopen
            </button>
          )}
        </div>
      </div>

      {/* Assignment banner */}
      {session.assigned_staff_name && !isMyChat && (
        <div className="px-4 py-2 bg-blue-50 text-blue-700 text-xs text-center flex-shrink-0 border-b border-blue-100">
          Assigned to <strong>{session.assigned_staff_name}</strong>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 flex flex-col gap-3">
        {messages.map(msg => (
          <StaffMessageBubble key={msg.id} msg={msg} isOwnStaff={msg.sender_type === 'staff' && msg.sender_name === (user?.full_name || user?.email)} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-100 px-4 py-3 flex-shrink-0">
        {isClosed ? (
          <p className="text-center text-sm text-gray-400 py-2">This chat is closed.</p>
        ) : !canSend ? (
          <p className="text-center text-sm text-gray-400 py-2">
            {session.mode === 'ai'
              ? 'AI is handling this chat. Join to take over.'
              : 'Join the chat to send messages.'}
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder="Type a reply… (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="flex-1 resize-none bg-gray-100 rounded-2xl px-4 py-2.5 text-sm outline-none placeholder:text-gray-400 max-h-32"
              style={{ minHeight: '42px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || sending}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#77088a' }}
              aria-label="Send"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StaffMessageBubble({ msg, isOwnStaff }: { msg: SupportMessage; isOwnStaff: boolean }) {
  const isCustomer = msg.sender_type === 'customer';
  const isAi       = msg.sender_type === 'ai';
  const isStaff    = msg.sender_type === 'staff';

  // System/AI messages (mode transition notices etc.) — centered
  if (isAi && msg.sender_name === 'JulineMart Support') {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    );
  }

  if (isCustomer) {
    return (
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="max-w-[70%]">
          <p className="text-[11px] text-gray-400 mb-0.5">{msg.sender_name || 'Customer'}</p>
          <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 shadow-sm text-sm text-gray-800 leading-relaxed">
            {msg.content}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{formatDateTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  if (isAi) {
    return (
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#77088a' }}>
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div className="max-w-[70%]">
          <p className="text-[11px] text-gray-400 mb-0.5">JulineMart AI</p>
          <div className="bg-purple-50 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-800 leading-relaxed" style={{ borderLeft: '3px solid #77088a' }}>
            {msg.content}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">{formatDateTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  // Staff message
  if (isOwnStaff) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%]">
          <div className="text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed" style={{ backgroundColor: '#77088a' }}>
            {msg.content}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 text-right">You · {formatDateTime(msg.created_at)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
        <Headphones className="w-4 h-4 text-white" />
      </div>
      <div className="max-w-[70%]">
        <p className="text-[11px] text-gray-400 mb-0.5">{msg.sender_name || 'Agent'}</p>
        <div className="bg-blue-50 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-800 leading-relaxed">
          {msg.content}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">{formatDateTime(msg.created_at)}</p>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: 'ai' | 'human' }) {
  return mode === 'human' ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">
      <User className="w-2.5 h-2.5" /> Human
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
      <Bot className="w-2.5 h-2.5" /> AI
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open:     'bg-green-50 text-green-700',
    assigned: 'bg-blue-50 text-blue-700',
    closed:   'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}
