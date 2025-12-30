// ============================================================
// WhatsApp Webhook Receiver
// ============================================================
// Purpose: Receives webhooks from Meta WhatsApp Business Platform
// Handles: Incoming messages, status updates, delivery receipts
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Normalize phone number from WhatsApp format (234XXXXXXXXXX) to local (08XXXXXXXXX)
 */
function normalizePhone(waPhone) {
  if (!waPhone) return null;
  
  // WhatsApp sends: "234XXXXXXXXXX"
  // We store: "08XXXXXXXXX" (local format)
  if (waPhone.startsWith('234')) {
    return '0' + waPhone.substring(3);
  }
  
  return waPhone;
}

/**
 * Get or create chat for customer
 */
async function getOrCreateChat(customerPhone, customerName = null, profilePicUrl = null) {
  const normalizedPhone = normalizePhone(customerPhone);
  
  // Try to find existing chat
  let { data: existingChat, error: fetchError } = await supabase
    .from('whatsapp_chats')
    .select('*')
    .eq('customer_phone', normalizedPhone)
    .single();
  
  if (existingChat) {
    // Reopen chat if it was closed
    if (existingChat.status === 'closed') {
      await supabase
        .from('whatsapp_chats')
        .update({ 
          status: 'open',
          updated_at: new Date().toISOString()
        })
        .eq('id', existingChat.id);
    }
    return existingChat;
  }
  
  // Create new chat
  const { data: newChat, error: createError } = await supabase
    .from('whatsapp_chats')
    .insert({
      customer_phone: normalizedPhone,
      customer_name: customerName,
      customer_profile_pic_url: profilePicUrl,
      status: 'open',
      customer_service_window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single();
  
  if (createError) {
    console.error('Error creating chat:', createError);
    throw createError;
  }
  
  return newChat;
}

/**
 * Process incoming message
 */
async function processIncomingMessage(message, chat) {
  const messageData = {
    chat_id: chat.id,
    direction: 'inbound',
    message_type: message.type || 'text',
    meta_message_id: message.id,
    meta_wamid: message.id,
    status: 'delivered',
    created_at: new Date(parseInt(message.timestamp) * 1000).toISOString()
  };
  
  // Handle different message types
  switch (message.type) {
    case 'text':
      messageData.content = message.text?.body;
      break;
      
    case 'image':
      messageData.media_url = message.image?.id; // Meta media ID
      messageData.media_mime_type = message.image?.mime_type;
      messageData.media_sha256 = message.image?.sha256;
      messageData.content = message.image?.caption || '[Image]';
      break;
      
    case 'audio':
      messageData.media_url = message.audio?.id;
      messageData.media_mime_type = message.audio?.mime_type;
      messageData.content = '[Voice Message]';
      break;
      
    case 'video':
      messageData.media_url = message.video?.id;
      messageData.media_mime_type = message.video?.mime_type;
      messageData.content = message.video?.caption || '[Video]';
      break;
      
    case 'document':
      messageData.media_url = message.document?.id;
      messageData.media_mime_type = message.document?.mime_type;
      messageData.content = message.document?.filename || '[Document]';
      break;
      
    case 'location':
      messageData.content = `[Location: ${message.location?.latitude}, ${message.location?.longitude}]`;
      messageData.metadata = { location: message.location };
      break;
      
    default:
      messageData.content = `[${message.type}]`;
  }
  
  // Insert message
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert(messageData)
    .select()
    .single();
  
  if (error) {
    console.error('Error inserting message:', error);
    throw error;
  }
  
  return data;
}

/**
 * Process message status update
 */
async function processStatusUpdate(status) {
  const statusMap = {
    'sent': 'sent',
    'delivered': 'delivered',
    'read': 'read',
    'failed': 'failed'
  };
  
  const newStatus = statusMap[status.status];
  if (!newStatus) return;
  
  const updateData = {
    status: newStatus
  };
  
  if (newStatus === 'delivered') {
    updateData.delivered_at = new Date(parseInt(status.timestamp) * 1000).toISOString();
  } else if (newStatus === 'read') {
    updateData.read_at = new Date(parseInt(status.timestamp) * 1000).toISOString();
  } else if (newStatus === 'failed') {
    updateData.error_code = status.errors?.[0]?.code;
    updateData.error_message = status.errors?.[0]?.title;
  }
  
  const { error } = await supabase
    .from('whatsapp_messages')
    .update(updateData)
    .eq('meta_message_id', status.id);
  
  if (error) {
    console.error('Error updating message status:', error);
  }
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
  
  // ============================================================
  // WEBHOOK VERIFICATION (GET request from Meta)
  // ============================================================
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    
    // Meta sends these parameters for verification
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];
    
    console.log('Webhook verification request:', { mode, token });
    
    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('✅ Webhook verified successfully');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: challenge
      };
    }
    
    console.error('❌ Webhook verification failed');
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Verification failed' })
    };
  }
  
  // ============================================================
  // WEBHOOK EVENT PROCESSING (POST request from Meta)
  // ============================================================
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      
      console.log('📨 Webhook received:', JSON.stringify(body, null, 2));
      
      // Log webhook event for debugging
      await supabase.from('whatsapp_webhook_events').insert({
        event_type: body.object || 'unknown',
        payload: body,
        processed: false
      });
      
      // Validate webhook structure
      if (body.object !== 'whatsapp_business_account') {
        console.log('⚠️ Not a WhatsApp webhook, ignoring');
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ success: true, message: 'Not a WhatsApp event' })
        };
      }
      
      // Process each entry
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          
          // Process messages
          if (value.messages) {
            for (const message of value.messages) {
              try {
                console.log('💬 Processing message:', message.id);
                
                // Get customer info
                const customerPhone = message.from;
                const customerName = value.contacts?.[0]?.profile?.name;
                const profilePicUrl = value.contacts?.[0]?.profile?.picture;
                
                // Get or create chat
                const chat = await getOrCreateChat(customerPhone, customerName, profilePicUrl);
                
                // Process message
                await processIncomingMessage(message, chat);
                
                console.log('✅ Message processed successfully');
              } catch (error) {
                console.error('❌ Error processing message:', error);
                // Continue processing other messages
              }
            }
          }
          
          // Process status updates
          if (value.statuses) {
            for (const status of value.statuses) {
              try {
                console.log('📊 Processing status update:', status.id);
                await processStatusUpdate(status);
                console.log('✅ Status updated successfully');
              } catch (error) {
                console.error('❌ Error processing status:', error);
              }
            }
          }
        }
      }
      
      // Mark webhook as processed
      await supabase
        .from('whatsapp_webhook_events')
        .update({ 
          processed: true,
          processed_at: new Date().toISOString()
        })
        .eq('payload', body);
      
      // Always return 200 to acknowledge receipt
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, message: 'Webhook processed' })
      };
      
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      
      // Still return 200 to prevent Meta from retrying
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: error.message,
          note: 'Error logged but returning 200 to prevent retries'
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