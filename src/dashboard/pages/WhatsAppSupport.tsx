import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MessageSquare, 
  Search, 
  Filter,
  User,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  UserCheck,
  Mail,
  Phone
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

interface WhatsAppChat {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  customer_profile_pic_url: string | null;
  status: 'open' | 'assigned' | 'closed';
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  linked_order_id: string | null;
  woocommerce_order_id: string | null;
  order_status: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  total_messages: number;
  customer_service_window_expires_at: string | null;
  within_service_window: boolean;
  created_at: string;
}

export default function WhatsAppSupportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const notification = useNotification();
  
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<string>('all');
  const [orderFilter, setOrderFilter] = useState<string>('all');
  
  // Fetch chats
  const fetchChats = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (assignmentFilter === 'assigned_to_me') params.append('assigned_to', user?.id || '');
      if (assignmentFilter === 'unassigned') params.append('assigned_to', 'unassigned');
      if (orderFilter === 'with_order') params.append('has_order', 'true');
      if (orderFilter === 'without_order') params.append('has_order', 'false');
      if (searchTerm) params.append('search', searchTerm);
      
      const response = await fetch(`/.netlify/functions/whatsapp-chats?${params.toString()}`);
      const result = await response.json();
      
      if (result.success) {
        setChats(result.data);
      } else {
        throw new Error(result.error || 'Failed to fetch chats');
      }
    } catch (error) {
      console.error('Error fetching chats:', error);
      notification.error('Error', 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchChats();
    
    // Refresh chats every 10 seconds
    const interval = setInterval(fetchChats, 10000);
    return () => clearInterval(interval);
  }, [statusFilter, assignmentFilter, orderFilter, searchTerm]);
  
  // Status badge color
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      open: 'bg-green-100 text-green-800',
      assigned: 'bg-blue-100 text-blue-800',
      closed: 'bg-gray-100 text-gray-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };
  
  // Format relative time
  const formatRelativeTime = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString();
  };
  
  // Format phone number for display
  const formatPhone = (phone: string) => {
    if (phone.startsWith('0')) {
      return phone.replace(/(\d{4})(\d{3})(\d{4})/, '$1 $2 $3');
    }
    return phone;
  };
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-primary-600" />
            WhatsApp Support
          </h1>
          <p className="text-gray-600 mt-1">
            Manage customer conversations and support tickets
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={fetchChats}
            className="btn-secondary"
          >
            Refresh
          </button>
        </div>
      </div>
      
      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Customer
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
          
          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          
          {/* Assignment Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assignment
            </label>
            <select
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Chats</option>
              <option value="assigned_to_me">Assigned to Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Chats</p>
              <p className="text-2xl font-bold text-gray-900">{chats.length}</p>
            </div>
            <MessageSquare className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Open</p>
              <p className="text-2xl font-bold text-green-600">
                {chats.filter(c => c.status === 'open').length}
              </p>
            </div>
            <Clock className="w-8 h-8 text-green-500" />
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Assigned</p>
              <p className="text-2xl font-bold text-blue-600">
                {chats.filter(c => c.status === 'assigned').length}
              </p>
            </div>
            <UserCheck className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Unread</p>
              <p className="text-2xl font-bold text-red-600">
                {chats.filter(c => c.unread_count > 0).length}
              </p>
            </div>
            <Mail className="w-8 h-8 text-red-500" />
          </div>
        </div>
      </div>
      
      {/* Chats List */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading chats...</p>
          </div>
        ) : chats.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Chats Found</h3>
            <p className="text-gray-600">
              {searchTerm || statusFilter !== 'all' || assignmentFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Waiting for customer messages...'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {chats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => navigate(`/admin/whatsapp/${chat.id}`)}
                className={`p-4 border rounded-lg cursor-pointer transition-all hover:border-primary-300 hover:shadow-md ${
                  chat.unread_count > 0 ? 'bg-blue-50 border-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {chat.customer_profile_pic_url ? (
                      <img
                        src={chat.customer_profile_pic_url}
                        alt={chat.customer_name || 'Customer'}
                        className="w-12 h-12 rounded-full"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
                        {chat.customer_name?.charAt(0) || 'C'}
                      </div>
                    )}
                  </div>
                  
                  {/* Chat Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {chat.customer_name || 'Unknown Customer'}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                          <Phone className="w-4 h-4" />
                          <span>{formatPhone(chat.customer_phone)}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(chat.status)}`}>
                          {chat.status}
                        </span>
                        {chat.unread_count > 0 && (
                          <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-bold">
                            {chat.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* Last Message */}
                    <p className="text-sm text-gray-600 truncate mb-2">
                      {chat.last_message_preview || 'No messages yet'}
                    </p>
                    
                    {/* Meta Info */}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(chat.last_message_at)}
                      </span>
                      
                      <span>
                        {chat.total_messages} {chat.total_messages === 1 ? 'message' : 'messages'}
                      </span>
                      
                      {chat.assigned_staff_name && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {chat.assigned_staff_name}
                        </span>
                      )}
                      
                      {chat.woocommerce_order_id && (
                        <span className="flex items-center gap-1 text-primary-600">
                          <Package className="w-3 h-3" />
                          {chat.woocommerce_order_id}
                        </span>
                      )}
                      
                      {!chat.within_service_window && (
                        <span className="flex items-center gap-1 text-amber-600 font-medium">
                          <Clock className="w-3 h-3" />
                          Outside 24h window
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}