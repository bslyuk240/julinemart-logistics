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
  const { user } = useAuth();
  const notification = useNotification();
  
  const [chatData, setChatData] = useState<ChatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [staff, setStaff] = useState<any[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Fetch chat data
  const fetchChatData = async () => {
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`);
      const result = await response.json();
      
      if (result.success) {
        setChatData(result.data);
        
        // Mark as read
        await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mark_as_read: true,
            staff_id: user?.id
          })
        });
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
  
  // Fetch staff list for assignment
  const fetchStaff = async () => {
    try {
      const response = await fetch(`/.netlify/functions/users?role=admin,agent`);
      const result = await response.json();
      if (result.success) {
        setStaff(result.data);
      }
    } catch (error) {
      console.error('Error fetching staff:', error);
    }
  };
  
  useEffect(() => {
    fetchChatData();
    fetchStaff();
    
    // Refresh chat every 5 seconds
    const interval = setInterval(fetchChatData, 5000);
    return () => clearInterval(interval);
  }, [chatId]);
  
  useEffect(() => {
    scrollToBottom();
  }, [chatData?.messages]);
  
  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!messageText.trim()) return;
    
    setSending(true);
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message: messageText.trim(),
          staff_id: user?.id
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setMessageText('');
        await fetchChatData(); // Refresh to show sent message
        notification.success('Sent', 'Message sent successfully');
      } else {
        throw new Error(result.error || 'Failed to send message');
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      notification.error('Error', error.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };
  
  // Assign chat
  const handleAssign = async (staffId: string | null) => {
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_staff_id: staffId,
          staff_id: user?.id
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        await fetchChatData();
        setAssignModalOpen(false);
        notification.success('Assigned', 'Chat assignment updated');
      } else {
        throw new Error(result.error || 'Failed to assign chat');
      }
    } catch (error: any) {
      console.error('Error assigning chat:', error);
      notification.error('Error', error.message || 'Failed to assign chat');
    }
  };
  
  // Close chat
  const handleCloseChat = async () => {
    if (!confirm('Are you sure you want to close this chat?')) return;
    
    try {
      const response = await fetch(`/.netlify/functions/whatsapp-chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'closed',
          staff_id: user?.id
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'open',
          staff_id: user?.id
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
  
  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white border-r border-gray-200">
        {/* Chat Header */}
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/admin/whatsapp')}
                className="text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              
              <div className="flex items-center gap-3">
                {chat.customer_profile_pic_url ? (
                  <img
                    src={chat.customer_profile_pic_url}
                    alt={chat.customer_name || 'Customer'}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {chat.customer_name?.charAt(0) || 'C'}
                  </div>
                )}
                
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {chat.customer_name || 'Unknown Customer'}
                  </h2>
                  <p className="text-sm text-gray-600">{chat.customer_phone}</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
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
                    <button
                      onClick={() => { setAssignModalOpen(true); setShowActions(false); }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <UserCheck className="w-4 h-4" />
                      Assign Chat
                    </button>
                    
                    {chat.status !== 'closed' ? (
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
            <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
              <Clock className="w-4 h-4" />
              <span>24-hour service window expired. Use templates for new messages.</span>
            </div>
          )}
        </div>
        
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
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
                <div className={`max-w-[70%] ${message.direction === 'outbound' ? 'order-2' : 'order-1'}`}>
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
          <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-4">
            <div className="flex items-end gap-2">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message..."
                rows={3}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
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
                className="btn-primary px-6 py-2 h-fit"
              >
                {sending ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Send
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
      
      {/* Right Sidebar - Customer & Order Info */}
      <div className="w-96 bg-white p-6 overflow-y-auto space-y-6">
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
                  <p className="text-sm text-gray-600">Assigned To</p>
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
            <button
              onClick={() => setAssignModalOpen(true)}
              className="w-full btn-secondary justify-start"
            >
              <UserCheck className="w-4 h-4 mr-2" />
              Change Assignment
            </button>
            
            {chat.status === 'closed' ? (
              <button
                onClick={handleReopenChat}
                className="w-full btn-secondary justify-start text-green-600"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Reopen Chat
              </button>
            ) : (
              <button
                onClick={handleCloseChat}
                className="w-full btn-secondary justify-start text-red-600"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Close Chat
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Assignment Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-4">Assign Chat</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              <button
                onClick={() => handleAssign(null)}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-lg"
              >
                Unassigned
              </button>
              {staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleAssign(s.id)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-50 rounded-lg flex items-center gap-2"
                >
                  <User className="w-4 h-4" />
                  {s.full_name} ({s.role})
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setAssignModalOpen(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}