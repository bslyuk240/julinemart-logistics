import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft,
  Send,
  User,
  Package,
  Phone,
  Mail,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  UserCheck,
  XCircle,
  MoreVertical,
  Image as ImageIcon,
  FileText,
  Mic
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

interface Message {
  id: string;
  chat_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string | null;
  media_url: string | null;
  status: string;
  sent_by_staff_id: string | null;
  sent_by_staff: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

interface ChatData {
  chat: any;
  messages: Message[];
  order: any;
}

export default function WhatsAppChatView() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const notification = useNotification();
  
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const quickActionBaseClass = 'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1';
  const joinActionClass = `${quickActionBaseClass} bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-300`;
  const takeOverActionClass = `${quickActionBaseClass} bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-300`;
  const leaveActionClass = `${quickActionBaseClass} bg-slate-700 text-white hover:bg-slate-800 focus:ring-slate-300`;
  const reopenActionClass = `${quickActionBaseClass} bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-300`;
  const closeActionClass = `${quickActionBaseClass} bg-red-600 text-white hover:bg-red-700 focus:ring-red-300`;
  
  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getJsonHeaders = (): HeadersInit => {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
    return headers;
  };

  const getValidAvatarUrl = (rawUrl: string | null) => {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a') return null;
    if (trimmed.startsWith('http://')) return `https://${trimmed.substring('http://'.length)}`;
    if (trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) return trimmed;
    return null;
  };
  
  // Fetch chat data
  const fetchChatData = async () => {
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`);
      const result = await response.json();
      
      if (result.success) {
        setChatData(result.data);
        
        // Mark as read
        if (session?.access_token) {
          await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
            method: 'PATCH',
            headers: getJsonHeaders(),
            body: JSON.stringify({
              mark_as_read: true
            })
          });
        }
      } else {
        throw new Error(result.error || 'Failed to fetch chat');
      }
    } catch (error) {
      console.error('Error fetching chat:', error);
      notification.error('Error', 'Failed to load chat');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchChatData();
    
    // Refresh chat every 5 seconds
    const interval = setInterval(fetchChatData, 5000);
    return () => clearInterval(interval);
  }, [chatId, session?.access_token]);
  
  useEffect(() => {
    scrollToBottom();
  }, [chatData?.messages]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [chatId, chatData?.chat?.customer_profile_pic_url]);
  
  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!messageText.trim()) return;
    if (!session?.access_token) {
      notification.error('Authentication required', 'Please sign in again to send messages');
      return;
    }
    
    setSending(true);
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-send`, {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({
          chat_id: chatId,
          message: messageText.trim(),
          context_message_id: null
        })
      });
      
      const result = await response.json();

      if (result.success) {
        setMessageText('');
        await fetchChatData(); // Refresh to show sent message
        notification.success('Sent', 'Message sent successfully');
      } else if (result.error === 'outside_24h_window') {
        notification.error(
          '24-hour window expired',
          'You cannot send free-form messages after 24 hours of customer inactivity. Go to Meta Business Manager → WhatsApp → Message Templates, create and get a template approved, then use the Templates button to send.'
        );
      } else {
        throw new Error(result.message || result.error || 'Failed to send message');
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      notification.error('Send failed', error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };
  
  const handleJoinAction = async (action: 'join' | 'take_over' | 'leave') => {
    try {
      if (!session?.access_token) {
        notification.error('Authentication required', 'Please sign in again to continue');
        return;
      }

      const payload =
        action === 'join' ? { join_chat: true } :
        action === 'take_over' ? { take_over: true } :
        { leave_chat: true };

      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
        method: 'PATCH',
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchChatData();
        const message =
          action === 'join' ? 'You joined this chat' :
          action === 'take_over' ? 'You took over this chat' :
          'You left this chat';
        notification.success('Updated', message);
      } else {
        throw new Error(result.error || 'Failed to update chat ownership');
      }
    } catch (error: any) {
      console.error('Error updating join action:', error);
      notification.error('Error', error.message || 'Failed to update chat ownership');
    }
  };
  
  // Close chat
  const handleCloseChat = async () => {
    if (!confirm('Are you sure you want to close this chat?')) return;
    
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
        method: 'PATCH',
        headers: getJsonHeaders(),
        body: JSON.stringify({
          status: 'closed'
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        notification.success('Closed', 'Chat closed successfully');
        navigate('/admin/whatsapp');
      } else {
        throw new Error(result.error || 'Failed to close chat');
      }
    } catch (error: any) {
      console.error('Error closing chat:', error);
      notification.error('Error', error.message || 'Failed to close chat');
    }
  };
  
  // Reopen chat
  const handleReopenChat = async () => {
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
        method: 'PATCH',
        headers: getJsonHeaders(),
        body: JSON.stringify({
          status: 'open'
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchChatData();
        notification.success('Reopened', 'Chat reopened successfully');
      } else {
        throw new Error(result.error || 'Failed to reopen chat');
      }
    } catch (error: any) {
      console.error('Error reopening chat:', error);
      notification.error('Error', error.message || 'Failed to reopen chat');
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }
  
  if (!chatData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Chat Not Found</h2>
          <button onClick={() => navigate('/admin/whatsapp')} className="btn-primary">
            Back to Inbox
          </button>
        </div>
      </div>
    );
  }
  
  const { chat, messages, order } = chatData;
  const customerAvatarUrl = getValidAvatarUrl(chat.customer_profile_pic_url);
  const showCustomerAvatar = Boolean(customerAvatarUrl && !avatarLoadFailed);
  const isClosed = chat.status === 'closed';
  const joinedByMe = Boolean(user?.id && chat.assigned_staff_id === user.id);
  const joinedByAnother = Boolean(chat.assigned_staff_id && !joinedByMe);

  const ownershipAction = isClosed
    ? null
    : joinedByMe
      ? {
          label: 'Leave Chat',
          icon: UserCheck,
          className: leaveActionClass,
          action: 'leave' as const
        }
      : joinedByAnother
        ? {
            label: 'Take Over Chat',
            icon: UserCheck,
            className: takeOverActionClass,
            action: 'take_over' as const
          }
        : {
            label: 'Join Chat',
            icon: UserCheck,
            className: joinActionClass,
            action: 'join' as const
          };

  const detailsPanel = (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Customer Info */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Customer Info</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <User className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Name</p>
              <p className="font-medium">{chat.customer_name || 'Not provided'}</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">Phone</p>
              <p className="font-medium">{chat.customer_phone}</p>
            </div>
          </div>
          
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="text-sm text-gray-600">First Contact</p>
              <p className="font-medium">
                {new Date(chat.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          
          {chat.assigned_staff_name && (
            <div className="flex items-start gap-3">
              <UserCheck className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-600">Joined By</p>
                <p className="font-medium">{chat.assigned_staff_name}</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Linked Order */}
      {order && (
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Linked Order</h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Package className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-600">Order Number</p>
                <button
                  onClick={() => navigate(`/admin/orders/${order.id}`)}
                  className="font-medium text-primary-600 hover:text-primary-700"
                >
                  #{order.woocommerce_order_id}
                </button>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-600">Status</p>
                <p className="font-medium capitalize">{order.overall_status}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-600">Email</p>
                <p className="font-medium text-sm">{order.customer_email}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm text-gray-600">Delivery</p>
                <p className="font-medium text-sm">{order.delivery_city}, {order.delivery_state}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Quick Actions */}
      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="space-y-2">
          {ownershipAction && (
            <button
              onClick={() => handleJoinAction(ownershipAction.action)}
              className={ownershipAction.className}
            >
              <ownershipAction.icon className="w-4 h-4" />
              {ownershipAction.label}
            </button>
          )}
          
          {isClosed ? (
            <button
              onClick={handleReopenChat}
              className={reopenActionClass}
            >
              <CheckCircle2 className="w-4 h-4" />
              Reopen Chat
            </button>
          ) : (
            <button
              onClick={handleCloseChat}
              className={closeActionClass}
            >
              <XCircle className="w-4 h-4" />
              Close Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
  
  return (
    <div className="h-[calc(100dvh-4rem)] flex flex-col lg:flex-row bg-white">
      {/* Main Chat Area */}
      <div className="flex-1 min-h-0 flex flex-col bg-white lg:border-r lg:border-gray-200">
        {/* Chat Header */}
        <div className="border-b border-gray-200 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2 sm:gap-4">
              <button
                onClick={() => navigate('/admin/whatsapp')}
                className="text-gray-600 hover:text-gray-900 shrink-0"
              >
                <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
              
              <div className="min-w-0 flex items-center gap-2 sm:gap-3">
                {showCustomerAvatar ? (
                  <img
                    src={customerAvatarUrl || ''}
                    alt={chat.customer_name || 'Customer'}
                    className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {chat.customer_name?.charAt(0) || 'C'}
                  </div>
                )}
                
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                    {chat.customer_name || 'Unknown Customer'}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 truncate">{chat.customer_phone}</p>
                  {chat.assigned_staff_name && (
                    <p className="text-[11px] sm:text-xs text-blue-700 truncate">
                      Joined by {chat.assigned_staff_name}
                    </p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <button
                onClick={() => setShowMobileDetails(!showMobileDetails)}
                className="lg:hidden px-2 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                {showMobileDetails ? 'Hide Info' : 'Info'}
              </button>
              <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-medium ${
                chat.status === 'open' ? 'bg-green-100 text-green-800' :
                chat.status === 'assigned' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {chat.status}
              </span>
              
              <div className="relative">
                <button
                  onClick={() => setShowActions(!showActions)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <MoreVertical className="w-5 h-5 text-gray-600" />
                </button>
                
                {showActions && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                    {ownershipAction && (
                      <button
                        onClick={() => { handleJoinAction(ownershipAction.action); setShowActions(false); }}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <ownershipAction.icon className="w-4 h-4" />
                        {ownershipAction.label}
                      </button>
                    )}
                    
                    {!isClosed ? (
                      <button
                        onClick={() => { handleCloseChat(); setShowActions(false); }}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-red-600"
                      >
                        <XCircle className="w-4 h-4" />
                        Close Chat
                      </button>
                    ) : (
                      <button
                        onClick={() => { handleReopenChat(); setShowActions(false); }}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2 text-green-600"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Reopen Chat
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {!chat.within_service_window && (
            <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs sm:text-sm text-amber-800">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>24-hour window expired.</strong> Free-form messaging is disabled. To re-engage this customer, create and get a WhatsApp message template approved in{' '}
                <a href="https://business.facebook.com" target="_blank" rel="noreferrer" className="underline font-medium">Meta Business Manager</a>
                {' '}→ WhatsApp → Message Templates, then use it here.
              </span>
            </div>
          )}
        </div>

        {/* Mobile Details */}
        {showMobileDetails && (
          <div className="lg:hidden border-b border-gray-200 bg-white max-h-[45vh] overflow-y-auto">
            {detailsPanel}
          </div>
        )}
        
        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4 bg-gray-50">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No messages yet. Waiting for customer...
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] sm:max-w-[70%] ${message.direction === 'outbound' ? 'order-2' : 'order-1'}`}>
                  <div className={`rounded-lg p-3 ${
                    message.direction === 'outbound'
                      ? 'bg-primary-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-900'
                  }`}>
                    {message.message_type === 'text' ? (
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    ) : message.message_type === 'image' ? (
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-5 h-5" />
                        <span>[Image]</span>
                      </div>
                    ) : message.message_type === 'audio' ? (
                      <div className="flex items-center gap-2">
                        <Mic className="w-5 h-5" />
                        <span>[Voice Message]</span>
                      </div>
                    ) : message.message_type === 'document' ? (
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5" />
                        <span>[Document]</span>
                      </div>
                    ) : (
                      <span>{message.content || '[Media]'}</span>
                    )}
                  </div>
                  
                  <div className={`flex items-center gap-2 mt-1 text-xs ${
                    message.direction === 'outbound' ? 'justify-end' : 'justify-start'
                  }`}>
                    <span className="text-gray-500">
                      {new Date(message.created_at).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                    
                    {message.direction === 'outbound' && (
                      <span className="text-gray-500">
                        {message.status === 'read' && <CheckCircle2 className="w-3 h-3 text-blue-500" />}
                        {message.status === 'delivered' && <CheckCircle2 className="w-3 h-3" />}
                        {message.status === 'sent' && <CheckCircle2 className="w-3 h-3" />}
                        {message.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                      </span>
                    )}
                    
                    {message.sent_by_staff && (
                      <span className="text-gray-500">
                        by {message.sent_by_staff.full_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        
        {/* Message Input */}
        {chat.status !== 'closed' && (
          <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-3 sm:p-4 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message..."
                rows={3}
                className="flex-1 px-3 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={sending || !messageText.trim()}
                className="btn-primary px-4 sm:px-6 h-11 shrink-0 inline-flex items-center justify-center"
              >
                {sending ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Send className="w-5 h-5 sm:mr-2" />
                    <span className="hidden sm:inline">Send</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-96 bg-white overflow-y-auto">
        {detailsPanel}
      </div>
    </div>
  );
}
