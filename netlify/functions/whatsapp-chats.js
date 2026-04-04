// ============================================================
// WhatsApp Chats Management
// ============================================================
// Purpose: Manage WhatsApp chats (list, assign, close, reopen)
// Endpoints:
//   GET  /api/whatsapp-chats - List chats with filters
//   GET  /api/whatsapp-chats/:id - Get single chat with messages
//   PATCH /api/whatsapp-chats/:id - Update chat (assign, close, etc.)
//   DELETE /api/whatsapp-chats/:id - Delete chat and messages (admin only)
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const READ_ONLY_KEY =
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  SERVICE_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');
const supabaseAuth = createClient(SUPABASE_URL || '', READ_ONLY_KEY || '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Parse URL path to get ID
 */
function getChatIdFromPath(path) {
  const parts = path.split('/');
  const chatsIndex = parts.findIndex(p => p === 'whatsapp-chats');
  if (chatsIndex >= 0 && parts.length > chatsIndex + 1) {
    return parts[chatsIndex + 1];
  }
  return null;
}

/**
 * Log activity
 */
async function logActivity(userId, chatId, action, details) {
  await supabase.from('activity_logs').insert({
    user_id: userId,
    action: action,
    resource_type: 'whatsapp_chat',
    resource_id: chatId,
    details: details
  });
}

const unauthorized = (message = 'Unauthorized') => ({
  statusCode: 401,
  headers: corsHeaders,
  body: JSON.stringify({ success: false, error: 'unauthorized', message })
});

const forbidden = (message = 'Forbidden') => ({
  statusCode: 403,
  headers: corsHeaders,
  body: JSON.stringify({ success: false, error: 'forbidden', message })
});

async function requireStaffAuth(event) {
  if (!SUPABASE_URL || !SERVICE_KEY || !READ_ONLY_KEY) {
    return {
      errorResponse: {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Server not configured',
          message: 'Supabase credentials missing for authentication'
        })
      }
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { errorResponse: unauthorized('Missing bearer token') };
  }

  const token = authHeader.split(' ')[1];
  const { data: authData, error: authError } = await supabaseAuth.auth.getUser(token);
  if (authError || !authData?.user) {
    return { errorResponse: unauthorized('Invalid or expired token') };
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, role, full_name, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    return { errorResponse: forbidden('User profile not found') };
  }

  if (!profile.is_active) {
    return { errorResponse: forbidden('User is inactive') };
  }

  if (!['admin', 'agent'].includes(profile.role)) {
    return { errorResponse: forbidden('Insufficient permissions') };
  }

  return { profile };
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handler(event) {
  // Handle OPTIONS for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }
  
  const chatId = getChatIdFromPath(event.path);
  
  // ============================================================
  // GET /api/whatsapp-chats - List all chats
  // ============================================================
  if (event.httpMethod === 'GET' && !chatId) {
    try {
      const params = event.queryStringParameters || {};
      
      // Build query
      let query = supabase
        .from('whatsapp_chat_summary')
        .select('*');
      
      // Apply filters
      if (params.status) {
        query = query.eq('status', params.status);
      }
      
      if (params.assigned_to) {
        if (params.assigned_to === 'unassigned') {
          query = query.is('assigned_staff_id', null);
        } else {
          query = query.eq('assigned_staff_id', params.assigned_to);
        }
      }
      
      if (params.has_order) {
        if (params.has_order === 'true') {
          query = query.not('linked_order_id', 'is', null);
        } else {
          query = query.is('linked_order_id', null);
        }
      }
      
      if (params.search) {
        // Search in customer name or phone
        query = query.or(`customer_name.ilike.%${params.search}%,customer_phone.ilike.%${params.search}%`);
      }
      
      // Sort by last message time (newest first)
      query = query.order('last_message_at', { ascending: false });
      
      // Pagination
      const limit = parseInt(params.limit) || 50;
      const offset = parseInt(params.offset) || 0;
      query = query.range(offset, offset + limit - 1);
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data || [],
          pagination: {
            limit,
            offset,
            count: data?.length || 0
          }
        })
      };
      
    } catch (error) {
      console.error('Error fetching chats:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to fetch chats'
        })
      };
    }
  }
  
  // ============================================================
  // GET /api/whatsapp-chats/:id - Get single chat with messages
  // ============================================================
  if (event.httpMethod === 'GET' && chatId) {
    try {
      // Get chat details
      const { data: chat, error: chatError } = await supabase
        .from('whatsapp_chat_summary')
        .select('*')
        .eq('id', chatId)
        .single();
      
      if (chatError || !chat) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Chat not found'
          })
        };
      }
      
      // Get messages for this chat
      const { data: messages, error: messagesError } = await supabase
        .from('whatsapp_messages')
        .select(`
          *,
          sent_by_staff:users!sent_by_staff_id (
            id,
            full_name,
            email
          )
        `)
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      
      if (messagesError) {
        console.error('Error fetching messages:', messagesError);
      }
      
      // Get order details if linked
      let orderDetails = null;
      if (chat.linked_order_id) {
        const { data: order } = await supabase
          .from('orders')
          .select(`
            *,
            sub_orders (
              id,
              status,
              tracking_number,
              courier_id,
              hubs (name),
              couriers (name)
            )
          `)
          .eq('id', chat.linked_order_id)
          .single();
        
        orderDetails = order;
      }
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            chat,
            messages: messages || [],
            order: orderDetails
          }
        })
      };
      
    } catch (error) {
      console.error('Error fetching chat:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to fetch chat'
        })
      };
    }
  }
  
  // ============================================================
  // PATCH /api/whatsapp-chats/:id - Update chat
  // ============================================================
  if (event.httpMethod === 'PATCH' && chatId) {
    try {
      const auth = await requireStaffAuth(event);
      if (auth.errorResponse) return auth.errorResponse;
      const actor = auth.profile;

      const body = JSON.parse(event.body || '{}');
      const { 
        status, 
        assigned_staff_id, 
        linked_order_id
      } = body;

      const { data: currentChat, error: currentChatError } = await supabase
        .from('whatsapp_chats')
        .select('id, status, assigned_staff_id')
        .eq('id', chatId)
        .single();

      if (currentChatError || !currentChat) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Chat not found'
          })
        };
      }
      
      const updateData = {};
      const activityDetails = {};
      let activityAction = 'whatsapp_chat_updated';

      const joinChat = body.join_chat === true;
      const leaveChat = body.leave_chat === true;
      const takeOver = body.take_over === true;
      const joinActionsCount = [joinChat, leaveChat, takeOver].filter(Boolean).length;

      if (joinActionsCount > 1) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Only one of join_chat, leave_chat or take_over can be true'
          })
        };
      }

      if ((joinChat || takeOver) && currentChat.status === 'closed') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Cannot join a closed chat'
          })
        };
      }

      if (joinChat || takeOver) {
        const wasAssignedTo = currentChat.assigned_staff_id || null;
        const actionType = wasAssignedTo && wasAssignedTo !== actor.id ? 'whatsapp_chat_taken_over' : 'whatsapp_chat_joined';

        updateData.assigned_staff_id = actor.id;
        updateData.status = 'assigned';
        activityAction = actionType;
        activityDetails.previous_assigned_staff_id = wasAssignedTo;
        activityDetails.joined_by = actor.id;
      }

      if (leaveChat) {
        const isCurrentAssignee = currentChat.assigned_staff_id === actor.id;
        const isAdmin = actor.role === 'admin';

        if (!isCurrentAssignee && !isAdmin) {
          return forbidden('Only the current assignee or admin can leave/unassign this chat');
        }

        updateData.assigned_staff_id = null;
        if (!status && currentChat.status === 'assigned') {
          updateData.status = 'open';
        }
        activityAction = 'whatsapp_chat_left';
        activityDetails.previous_assigned_staff_id = currentChat.assigned_staff_id || null;
        activityDetails.left_by = actor.id;
      }
      
      // Update status
      if (status) {
        updateData.status = status;
        activityDetails.status = status;
        
        if (status === 'closed') {
          updateData.closed_at = new Date().toISOString();
          activityAction = 'whatsapp_chat_closed';
        } else if (status === 'open') {
          updateData.closed_at = null;
          activityAction = 'whatsapp_chat_reopened';
        }
      }
      
      // Backward-compatible assignment updates
      if (assigned_staff_id !== undefined && !joinChat && !leaveChat && !takeOver) {
        const assigningToSelf = assigned_staff_id && assigned_staff_id === actor.id;
        const assigningToOther = assigned_staff_id && assigned_staff_id !== actor.id;
        const unassigning = assigned_staff_id === null;
        const isAdmin = actor.role === 'admin';
        const isCurrentAssignee = currentChat.assigned_staff_id === actor.id;

        if (assigningToOther && !isAdmin) {
          return forbidden('Only admin can assign a chat to another staff member');
        }

        if (unassigning && !isAdmin && !isCurrentAssignee) {
          return forbidden('Only the current assignee or admin can unassign this chat');
        }

        updateData.assigned_staff_id = assigned_staff_id;
        activityDetails.assigned_to = assigned_staff_id;
        activityAction = assigningToSelf ? 'whatsapp_chat_joined' : (unassigning ? 'whatsapp_chat_unassigned' : 'whatsapp_chat_assigned');
        
        if (assigned_staff_id && status !== 'assigned') {
          updateData.status = 'assigned';
        }
        if (unassigning && !status && currentChat.status === 'assigned') {
          updateData.status = 'open';
        }
      }
      
      // Update order link
      if (linked_order_id !== undefined) {
        updateData.linked_order_id = linked_order_id;
        activityDetails.linked_order = linked_order_id;
        activityAction = 'whatsapp_chat_order_linked';
      }
      
      // Mark as read (reset unread count)
      if (body.mark_as_read) {
        updateData.unread_count = 0;
        if (activityAction === 'whatsapp_chat_updated') {
          activityAction = 'whatsapp_chat_read';
        }
      }
      
      if (Object.keys(updateData).length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'No valid update fields provided'
          })
        };
      }
      
      // Perform update
      const { data, error } = await supabase
        .from('whatsapp_chats')
        .update(updateData)
        .eq('id', chatId)
        .select()
        .single();
      
      if (error) throw error;
      
      // Log activity
      await logActivity(actor.id, chatId, activityAction, activityDetails);
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: data,
          message: 'Chat updated successfully'
        })
      };
      
    } catch (error) {
      console.error('Error updating chat:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to update chat'
        })
      };
    }
  }

  // ============================================================
  // DELETE /api/whatsapp-chats/:id - Delete chat
  // ============================================================
  if (event.httpMethod === 'DELETE' && chatId) {
    try {
      const auth = await requireStaffAuth(event);
      if (auth.errorResponse) return auth.errorResponse;
      const actor = auth.profile;

      if (actor.role !== 'admin') {
        return forbidden('Only admin can delete chats');
      }

      const { data: currentChat, error: currentChatError } = await supabase
        .from('whatsapp_chats')
        .select('id, customer_phone, assigned_staff_id, status')
        .eq('id', chatId)
        .single();

      if (currentChatError || !currentChat) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Chat not found'
          })
        };
      }

      // Remove child messages first in case FK cascade is not configured.
      const { error: messagesDeleteError } = await supabase
        .from('whatsapp_messages')
        .delete()
        .eq('chat_id', chatId);

      if (messagesDeleteError) throw messagesDeleteError;

      const { error: chatDeleteError } = await supabase
        .from('whatsapp_chats')
        .delete()
        .eq('id', chatId);

      if (chatDeleteError) throw chatDeleteError;

      await logActivity(actor.id, chatId, 'whatsapp_chat_deleted', {
        customer_phone: currentChat.customer_phone,
        previous_status: currentChat.status,
        previous_assigned_staff_id: currentChat.assigned_staff_id
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Chat deleted successfully'
        })
      };
    } catch (error) {
      console.error('Error deleting chat:', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.message || 'Failed to delete chat'
        })
      };
    }
  }
  
  // Method not allowed
  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
}
