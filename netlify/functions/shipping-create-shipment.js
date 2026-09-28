import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { assertStaffCanCreateShipment, STAFF_WRITE_ROLES } from './services/shipmentAccess.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { loadShipmentContext } from './services/shipping/loadShipmentContext.js';
import { getProviderAdapter } from './services/shipping/registry.js';
import { recordFulfilmentAction } from './services/shipping/fulfilmentAudit.js';
import { fezProvider } from './services/shipping/providers/fezProvider.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  if (event.httpMethod === 'OPTIONS') return preflightResponse(event.headers?.origin || event.headers?.Origin);
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const access = await assertStaffCanCreateShipment(event);
  if (!access.ok) return { statusCode: access.statusCode, headers, body: access.body };
  const admin = await requireAdmin(event, STAFF_WRITE_ROLES);

  try {
    const { subOrderId, quoteId, force } = JSON.parse(event.body || '{}');
    if (!subOrderId || !quoteId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'subOrderId and quoteId are required' }) };
    }

    const ctx = await loadShipmentContext(supabase, subOrderId);
    if (!ctx.ok) {
      return { statusCode: ctx.statusCode, headers, body: JSON.stringify({ success: false, error: ctx.error }) };
    }
    if (ctx.summary.selected_lane === 'local_rider') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Local rider shipments do not use carrier quotes.' }) };
    }

    const { data: quote, error: quoteError } = await supabase
      .from('shipping_quotes')
      .select('*')
      .eq('id', quoteId)
      .eq('sub_order_id', subOrderId)
      .single();

    if (quoteError || !quote) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Quote not found' }) };
    }
    if (quote.quote_status !== 'active' && quote.quote_status !== 'selected') {
      return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This quote is no longer available. Refresh quotes and select again.' }) };
    }
    if (quote.expires_at && new Date(quote.expires_at).getTime() < Date.now()) {
      await supabase.from('shipping_quotes').update({ quote_status: 'expired' }).eq('id', quote.id);
      return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This quote has expired. Refresh quotes and select again.' }) };
    }

    await supabase.from('shipping_quotes').update({ quote_status: 'selected' }).eq('id', quote.id);
    await recordFulfilmentAction(supabase, event, admin.authUser, {
      action: 'provider_selected',
      orderId: ctx.summary.order_id,
      subOrderId,
      provider: quote.provider,
      metadata: { quote_id: quote.id, courier: quote.courier_name, cost: quote.cost },
    });

    const adapter = getProviderAdapter(quote.provider);
    if (!adapter) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: `Unknown provider: ${quote.provider}` }) };
    }

    const quoteWithCharge = {
      ...quote,
      customer_shipping_charge: ctx.customerCharge,
    };

    const result = adapter.code === 'fez'
      ? await fezProvider.createShipment({ supabase, subOrderId, quote: quoteWithCharge, force })
      : await adapter.createShipment({
        supabase,
        subOrder: ctx.subOrder,
        quote: quoteWithCharge,
      });

    if (!result.ok) {
      await recordFulfilmentAction(supabase, event, admin.authUser, {
        action: 'shipment_create_failed',
        orderId: ctx.summary.order_id,
        subOrderId,
        provider: quote.provider,
        metadata: { quote_id: quote.id, error: result.error },
      });
      return {
        statusCode: result.statusCode || 502,
        headers,
        body: JSON.stringify({ success: false, error: result.error || 'Failed to create shipment' }),
      };
    }

    await supabase.from('shipping_quotes').update({ quote_status: 'booked' }).eq('id', quote.id);
    await recordFulfilmentAction(supabase, event, admin.authUser, {
      action: 'shipment_created',
      orderId: ctx.summary.order_id,
      subOrderId,
      provider: quote.provider,
      metadata: { quote_id: quote.id, tracking: result.data?.tracking_number, courier: quote.courier_name },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: result.data }),
    };
  } catch (error) {
    console.error('[shipping-create-shipment]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'Failed to create shipment' }),
    };
  }
};
