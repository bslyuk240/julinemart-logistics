// ============================================================
// WhatsApp Message Sender
// ============================================================
// Purpose: Send messages to customers via Meta WhatsApp API
// Handles: Text messages, media messages, template messages
// ============================================================

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const READ_ONLY_KEY =
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  SERVICE_KEY;

const WHATSAPP_PHONE_NUMBER_ID_KEYS = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'META_WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_PHONE_NUMBER_ID'
];

const WHATSAPP_ACCESS_TOKEN_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'META_WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_BUSINESS_ACCESS_TOKEN'
];

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');
const supabaseAuth = createClient(SUPABASE_URL || '', READ_ONLY_KEY || '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

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

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Normalize phone number from local (08XXXXXXXXX) to WhatsApp format (234XXXXXXXXXX)
 */
function formatPhoneForWhatsApp(localPhone) {
  if (!localPhone) return null;
  
  // Remove spaces, dashes, parentheses
  let cleaned = localPhone.replace(/[\s\-()]/g, '');
  
  // If starts with 0, replace with 234
  if (cleaned.startsWith('0')) {
    return '234' + cleaned.substring(1);
  }
  
  // If starts with +234, remove +
  if (cleaned.startsWith('+234')) {
    return cleaned.substring(1);
  }
  
  // If starts with 234, return as is
  if (cleaned.startsWith('234')) {
    return cleaned;
  }
  
  // Default: assume it needs 234 prefix
  return '234' + cleaned;
}

/**
 * Check if chat is within 24-hour service window
 */
function isWithinServiceWindow(chat) {
  if (!chat.customer_service_window_expires_at) return false;
  return new Date(chat.customer_service_window_expires_at) > new Date();
}

function resolveEnvValue(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return { key, value: value.trim() };
    }
  }
  return { key: null, value: null };
}

function resolveWhatsAppConfig() {
  const phoneNumberId = resolveEnvValue(WHATSAPP_PHONE_NUMBER_ID_KEYS);
  const accessToken = resolveEnvValue(WHATSAPP_ACCESS_TOKEN_KEYS);
  const apiVersion = (
    process.env.WHATSAPP_API_VERSION ||
    process.env.META_WHATSAPP_API_VERSION ||
    'v21.0'
  ).trim();

  const missing = [];
  if (!phoneNumberId.value) {
    missing.push(`phone number id (${WHATSAPP_PHONE_NUMBER_ID_KEYS.join(' or ')})`);
  }
  if (!accessToken.value) {
    missing.push(`access token (${WHATSAPP_ACCESS_TOKEN_KEYS.join(' or ')})`);
  }

  return {
    apiVersion,
    phoneNumberId: phoneNumberId.value,
    accessToken: accessToken.value,
    phoneNumberIdSource: phoneNumberId.key,
    accessTokenSource: accessToken.key,
    missing
  };
}

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
    .select('id, role, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile) {
    return { errorResponse: forbidden('User profile not found') };
  }
  if (!profile.is_active) {
    return { errorResponse: forbidden('User is inactive') };
  }
  if (!['admin', 'agent', 'manager', 'viewer', 'shop_manager'].includes(profile.role)) {
    return { errorResponse: forbidden('Insufficient permissions') };
  }

  return { profile };
}

function buildMetaApiError(result, fallbackMessage) {
  const metaError = result?.error || {};
  const rawMessage = metaError.message || fallbackMessage;
  const isAuthError = metaError.code === 190;
  const isExpiredSession = isAuthError && /session has expired/i.test(rawMessage || '');

  const error = new Error(
    isExpiredSession
      ? 'WhatsApp access token expired. Generate a new token in Meta and update WHATSAPP_ACCESS_TOKEN in Netlify and local env.'
      : rawMessage || 'Meta API request failed'
  );

  error.statusCode = isAuthError ? 401 : 502;
  error.meta = {
    code: metaError.code || null,
    subcode: metaError.error_subcode || null,
    type: metaError.type || null,
    fbtrace_id: metaError.fbtrace_id || null,
    message: rawMessage || null
  };

  return error;
}

/**
 * Send text message via Meta API
 */
async function sendTextMessage(to, text, contextMessageId = null, whatsappConfig) {
  const url = `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: {
      preview_url: true,
      body: text
    }
  };
  
  // Add context for reply
  if (contextMessageId) {
    payload.context = {
      message_id: contextMessageId
    };
  }
  
  console.log('📤 Sending message to Meta API:', { to, text: text.substring(0, 50) });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${whatsappConfig.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (!response.ok) {
    console.error('❌ Meta API error:', result);
    throw buildMetaApiError(result, 'Failed to send message');
  }
  
  console.log('✅ Message sent successfully:', result);
  return result;
}

/**
 * Send template message (for outside 24h window)
 */
async function sendTemplateMessage(to, templateName, languageCode = 'en', parameters = [], whatsappConfig) {
  const url = `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: [
        {
          type: 'body',
          parameters: parameters.map(param => ({
            type: 'text',
            text: param
          }))
        }
      ]
    }
  };
  
  console.log('📤 Sending template message:', { to, templateName });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${whatsappConfig.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (!response.ok) {
    console.error('❌ Meta API error:', result);
    throw buildMetaApiError(result, 'Failed to send template');
  }
  
  console.log('✅ Template sent successfully:', result);
  return result;
}

/**
 * Log activity in activity_logs table
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
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }
  
  try {
    const auth = await requireStaffAuth(event);
    if (auth.errorResponse) return auth.errorResponse;
    const actor = auth.profile;

    // Validate environment variables
    const whatsappConfig = resolveWhatsAppConfig();

    if (whatsappConfig.missing.length > 0) {
      throw new Error(`WhatsApp API credentials not configured: missing ${whatsappConfig.missing.join(' and ')}`);
    }

    console.log('WhatsApp configuration resolved', {
      apiVersion: whatsappConfig.apiVersion,
      phoneNumberIdSource: whatsappConfig.phoneNumberIdSource,
      accessTokenSource: whatsappConfig.accessTokenSource
    });
    
    const body = JSON.parse(event.body || '{}');
    const { 
      chat_id, 
      message, 
      context_message_id,
      use_template,
      template_name,
      template_params
    } = body;
    
    // Validate required fields
    if (!chat_id || !message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'chat_id and message are required' 
        })
      };
    }
    
    // Get chat details
    const { data: chat, error: chatError } = await supabase
      .from('whatsapp_chats')
      .select('*')
      .eq('id', chat_id)
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
    
    // Check if chat is closed
    if (chat.status === 'closed') {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Cannot send message to closed chat' 
        })
      };
    }

    // Enforce join ownership: if chat is joined, only joiner or admin can send.
    if (chat.assigned_staff_id && chat.assigned_staff_id !== actor.id && actor.role !== 'admin') {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'This chat is currently joined by another staff member. Join/take over the chat to continue.'
        })
      };
    }
    
    // Format phone number for WhatsApp
    const whatsappPhone = formatPhoneForWhatsApp(chat.customer_phone);
    
    if (!whatsappPhone) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          success: false, 
          error: 'Invalid phone number' 
        })
      };
    }
    
    let metaResponse;
    
    // Check if we should use template (outside 24h window)
    if (use_template || !isWithinServiceWindow(chat)) {
      // Send template message
      const templateToUse = template_name || 'support_response';
      const params = template_params || [chat.customer_name || 'Customer', message];
      
      metaResponse = await sendTemplateMessage(
        whatsappPhone,
        templateToUse,
        'en',
        params,
        whatsappConfig
      );
    } else {
      // Send regular text message
      metaResponse = await sendTextMessage(
        whatsappPhone,
        message,
        context_message_id,
        whatsappConfig
      );
    }
    
    // Save message to database
    const { data: savedMessage, error: saveError } = await supabase
      .from('whatsapp_messages')
      .insert({
        chat_id: chat_id,
        direction: 'outbound',
        message_type: 'text',
        content: message,
        meta_message_id: metaResponse.messages?.[0]?.id,
        meta_wamid: metaResponse.messages?.[0]?.id,
        status: 'sent',
        sent_by_staff_id: actor.id,
        context_message_id: context_message_id
      })
      .select()
      .single();
    
    if (saveError) {
      console.error('Error saving message:', saveError);
      // Don't fail the request, message was sent successfully
    }
    
    // Log activity
    await logActivity(actor.id, chat_id, 'whatsapp_message_sent', {
      message_preview: message.substring(0, 100),
      meta_message_id: metaResponse.messages?.[0]?.id
    });
    
    // Reset unread count since staff replied
    await supabase
      .from('whatsapp_chats')
      .update({ 
        unread_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', chat_id);
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          message: savedMessage,
          meta_response: metaResponse
        }
      })
    };
    
  } catch (error) {
    console.error('❌ Error sending message:', error);
    
    return {
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Failed to send message',
        meta_error: error?.meta || undefined
      })
    };
  }
}
