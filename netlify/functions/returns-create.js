// Create Return Request — admin reviews and creates shipment separately
import {
  supabase,
  fetchSupabaseOrder,
  validateReturnWindow,
  generateReturnCode,
  uploadReturnImages
} from './services/returns-utils.js';

import { corsHeaders, preflightResponse } from './services/cors.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from './services/rate-limit.js';
import { isGiftOrderKind } from './services/gift-cancel.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'returns-create',
    max: 10,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...corsHeaders() } };

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const {
      order_id,
      reason_code,
      reason_note,
      complaint_type,
      images = [],
      hub_id,
      method,
    } = body;

    if (!method || method !== 'dropoff') {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: "Only 'dropoff' return method is supported at this time." })
      };
    }

    if (!order_id || !reason_code || !hub_id) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'order_id, reason_code, hub_id are required' })
      };
    }

    const order = await fetchSupabaseOrder(order_id);
    const windowDays = Number(process.env.RETURN_WINDOW_DAYS || 14);

    // The window counts from delivery, not payment. Counting from payment
    // penalises slow deliveries (scheduled gifts, global-sourcing items) and
    // can expire before the parcel even arrives. validateReturnWindow anchors
    // on paid_at, so it is swapped for the delivery date when we have one.
    const { data: deliveredSubs } = await supabase
      .from('sub_orders')
      .select('delivered_at')
      .eq('main_order_id', order.id);
    const deliveredTimes = (deliveredSubs || [])
      .map((s) => (s.delivered_at ? new Date(s.delivered_at).getTime() : NaN))
      .filter((t) => !Number.isNaN(t));
    const deliveredAt = deliveredTimes.length ? new Date(Math.max(...deliveredTimes)).toISOString() : null;

    let windowOrder = order;
    if (isGiftOrderKind(order.order_kind)) {
      // Gifts can only be returned once delivered. Uses the order's own status
      // because only ops "Mark delivered" used to update gift_orders.gift_status.
      if (order.overall_status !== 'delivered') {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ success: false, error: 'A gift can only be returned after it has been delivered' })
        };
      }
      const { data: giftRow } = await supabase
        .from('gift_orders')
        .select('completed_at')
        .eq('order_id', order.id)
        .maybeSingle();
      windowOrder = {
        ...order,
        paid_at: deliveredAt || giftRow?.completed_at || order.updated_at || order.paid_at,
      };
    } else if (deliveredAt) {
      // Marketplace orders keep the old behaviour when no delivery date was
      // recorded (legacy orders), so nobody is newly blocked.
      windowOrder = { ...order, paid_at: deliveredAt };
    }

    if (!validateReturnWindow(windowOrder, windowDays)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: `Return window exceeded (${windowDays} days)` })
      };
    }

    const customerName = order.customer_name || 'Customer';

    const { data: hubRecord, error: hubErr } = await supabase
      .from('hubs')
      .select('id, name, phone, address, city, state')
      .eq('id', hub_id)
      .single();

    if (hubErr || !hubRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'Hub not found' })
      };
    }

    const returnCode = generateReturnCode();

    const resolvedComplaintType = complaint_type || (
      reason_code === 'wrong_item' ? 'wrong_product'
        : reason_code === 'damaged' ? 'damaged'
          : reason_code === 'not_as_described' ? 'not_as_described'
            : 'other'
    );

    const timelineEntry = {
      at: new Date().toISOString(),
      stage: 'complaint_submitted',
      label: 'Complaint submitted',
      actor: 'customer',
    };

    // Insert return_request only — shipment created by admin on approval
    const { data: request, error: reqErr } = await supabase
      .from('return_requests')
      .insert({
        order_id: order.woocommerce_order_id ? Number(order.woocommerce_order_id) : null,
        supabase_order_id: order.id,
        order_number: String(order.order_number || order.id),
        customer_email: order.customer_email,
        customer_name: customerName,
        hub_id,
        preferred_resolution: 'refund',
        reason_code,
        reason_note,
        complaint_type: resolvedComplaintType,
        images: [],
        evidence_urls: [],
        resolution_timeline: [timelineEntry],
        status: 'pending_review',
        fez_method: 'dropoff',
      })
      .select('*')
      .single();

    if (reqErr) throw reqErr;

    // Upload images
    let finalImages = [];
    try {
      finalImages = await uploadReturnImages(images || [], request.id);
      if (finalImages.length) {
        await supabase.from('return_requests').update({ images: finalImages }).eq('id', request.id);
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    }

    const adminUrl = `${process.env.JLO_URL || 'https://jlo.julinemart.com'}/admin/returns`;

    // Email customer: request received
    if (order.customer_email) {
      sendTransactionalEmail({
        templateName: 'Return Request Received',
        to: order.customer_email,
        orderId: order.id,
        data: {
          customerName,
          orderNumber: order.order_number ?? order.id,
          returnId: request.id,
          returnCode,
          reasonCode: reason_code || '',
          resolution: 'refund',
        },
      });
    }

    // Email admin alert recipients
    try {
      const { data: emailCfg } = await adminClient
        .from('email_config')
        .select('order_alert_emails')
        .single();

      const alertEmails = Array.isArray(emailCfg?.order_alert_emails)
        ? emailCfg.order_alert_emails.filter(Boolean)
        : [];

      for (const adminEmail of alertEmails) {
        sendTransactionalEmail({
          templateName: 'Return Admin Alert',
          to: adminEmail,
          orderId: order.id,
          data: {
            customerName,
            orderNumber: order.order_number ?? order.id,
            reasonCode: reason_code || '',
            reasonNote: reason_note || '',
            adminUrl,
          },
        });
      }
    } catch (err) {
      console.warn('Admin alert email failed:', err.message);
    }

    // Email vendor(s) whose items are in this order
    try {
      const { data: items } = await adminClient
        .from('order_items')
        .select('product_name, vendor_id, vendors!inner(email, store_name)')
        .eq('order_id', order.id)
        .not('vendor_id', 'is', null);

      if (items && items.length > 0) {
        // Group by vendor_id to send one email per vendor
        const byVendor = {};
        for (const item of items) {
          const vid = item.vendor_id;
          if (!byVendor[vid]) {
            byVendor[vid] = {
              email: item.vendors.email,
              store_name: item.vendors.store_name,
              itemNames: [],
            };
          }
          byVendor[vid].itemNames.push(item.product_name);
        }

        for (const vendor of Object.values(byVendor)) {
          if (vendor.email) {
            sendTransactionalEmail({
              templateName: 'Return Vendor Alert',
              to: vendor.email,
              orderId: order.id,
              data: {
                orderNumber: order.order_number ?? order.id,
                itemNames: vendor.itemNames.join(', '),
                reasonCode: reason_code || '',
              },
            });
          }
        }
      }
    } catch (err) {
      console.warn('Vendor alert email failed:', err.message);
    }

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          return_request: {
            ...request,
            images: finalImages,
            status: 'pending_review',
            reason_code,
            reason_note,
            return_shipments: [],
          },
        }
      })
    };

  } catch (error) {
    console.error('returns-create error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}
