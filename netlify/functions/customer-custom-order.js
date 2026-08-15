/**
 * GET /api/customer-custom-order?order_id=<uuid>
 * PATCH — customer approves proof or posts message (Bearer token required)
 */
import { createClient } from '@supabase/supabase-js';
import { authenticateCustomer } from './services/customerAuth.js';
import { recordAudit, requestMeta } from './services/auditLog.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

async function assertOrderOwnedByEmail(orderId, email) {
  const { data: order } = await supabase
    .from('orders')
    .select('id, customer_email')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.customer_email?.toLowerCase() !== email) {
    return { error: 'Order not found' };
  }
  return { order };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const { email, userId, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: authError }),
    };
  }

  if (event.httpMethod === 'GET') {
    const orderId = event.queryStringParameters?.order_id;
    if (!orderId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'order_id required' }),
      };
    }

    const owned = await assertOrderOwnedByEmail(orderId, email);
    if (owned.error) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: owned.error }),
      };
    }

    const { data: specs, error } = await supabase
      .from('custom_order_specs')
      .select(`
        id, order_id, order_item_id, schema_id, field_values, price_adjustment,
        status, approved_proof_url, approved_at, created_at, updated_at,
        order_items ( product_name, quantity, unit_price )
      `)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }

    const specIds = (specs || []).map((s) => s.id);
    let messages = [];
    if (specIds.length) {
      const { data: msgs } = await supabase
        .from('custom_order_messages')
        .select('*')
        .in('custom_order_spec_id', specIds)
        .order('created_at', { ascending: true });
      messages = msgs || [];
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: { specs: specs || [], messages } }),
    };
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
      };
    }

    const { spec_id: specId, action } = body;
    if (!specId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'spec_id required' }),
      };
    }

    const { data: spec } = await supabase
      .from('custom_order_specs')
      .select('id, order_id, status')
      .eq('id', specId)
      .maybeSingle();

    if (!spec) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Custom order not found' }),
      };
    }

    const owned = await assertOrderOwnedByEmail(spec.order_id, email);
    if (owned.error) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Not authorised' }),
      };
    }

    if (action === 'approve_proof') {
      if (spec.status !== 'proof_sent') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Proof is not awaiting approval' }),
        };
      }

      const { data, error } = await supabase
        .from('custom_order_specs')
        .update({
          status: 'customer_approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', specId)
        .select('*')
        .single();

      if (error) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: error.message }),
        };
      }

      await recordAudit({
        action: 'CUSTOM_ORDER_PROOF_APPROVED',
        resource_type: 'custom_order_specs',
        resource_id: specId,
        user_id: userId,
        actor_email: email,
        source: 'storefront',
        details: { order_id: spec.order_id },
        ...requestMeta(event),
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data }),
      };
    }

    if (action === 'message') {
      const message = String(body.message || '').trim();
      if (!message) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'message required' }),
        };
      }

      const { data, error } = await supabase
        .from('custom_order_messages')
        .insert({
          custom_order_spec_id: specId,
          sender_type: 'customer',
          message: message.slice(0, 4000),
          attachments: [],
        })
        .select('*')
        .single();

      if (error) {
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: error.message }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data }),
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Unknown action' }),
    };
  }

  return {
    statusCode: 405,
    headers: corsHeaders,
    body: JSON.stringify({ success: false, error: 'Method not allowed' }),
  };
}
