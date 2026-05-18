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

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const {
      order_id,
      reason_code,
      reason_note,
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

    if (!validateReturnWindow(order, windowDays)) {
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
        images: [],
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
