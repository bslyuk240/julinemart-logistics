// ============================================================
// WhatsApp Chats Management
// ============================================================
// Purpose: Manage WhatsApp chats (list, assign, close, reopen)
// Endpoints:
//   GET  /api/whatsapp-chats - List chats with filters
//   GET  /api/whatsapp-chats/:id - Get single chat with messages
//   PATCH /api/whatsapp-chats/:id - Update chat (assign, close, etc.)
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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
      const body = JSON.parse(event.body || '{}');
      const { 
        status, 
        assigned_staff_id, 
        linked_order_id,
        staff_id // Who is making the change
      } = body;
      
      const updateData = {};
      const activityDetails = {};
      let activityAction = 'whatsapp_chat_updated';
      
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
      
      // Update assignment
      if (assigned_staff_id !== undefined) {
        updateData.assigned_staff_id = assigned_staff_id;
        activityDetails.assigned_to = assigned_staff_id;
        activityAction = 'whatsapp_chat_assigned';
        
        if (assigned_staff_id && status !== 'assigned') {
          updateData.status = 'assigned';
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
        activityAction = 'whatsapp_chat_read';
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
      if (staff_id) {
        await logActivity(staff_id, chatId, activityAction, activityDetails);
      }
      
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
  
  // Method not allowed
  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
}