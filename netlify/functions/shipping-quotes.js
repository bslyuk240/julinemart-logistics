import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { assertStaffCanCreateShipment, STAFF_WRITE_ROLES } from './services/shipmentAccess.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { loadShipmentContext } from './services/shipping/loadShipmentContext.js';
import { requestQuotes } from './services/shipping/aggregator.js';
import { toPublicQuote } from './services/shipping/quoteModel.js';
import { recordFulfilmentAction } from './services/shipping/fulfilmentAudit.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

async function staffAuth(event) {
  const access = await assertStaffCanCreateShipment(event);
  if (!access.ok) return access;
  const admin = await requireAdmin(event, STAFF_WRITE_ROLES);
  return { ok: true, authUser: admin.authUser, profile: admin.profile };
}

async function loadActiveQuotes(subOrderId, customerCharge) {
  const { data } = await supabase
    .from('shipping_quotes')
    .select('*')
    .eq('sub_order_id', subOrderId)
    .eq('quote_status', 'active')
    .order('cost', { ascending: true });
  return (data || []).map((row) => toPublicQuote(row, customerCharge));
}

export const handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  if (event.httpMethod === 'OPTIONS') return preflightResponse(event.headers?.origin || event.headers?.Origin);

  const auth = await staffAuth(event);
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: auth.body };

  try {
    const body = event.httpMethod === 'GET' ? {} : JSON.parse(event.body || '{}');
    const subOrderId = event.queryStringParameters?.subOrderId || body.subOrderId;
    if (!subOrderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'subOrderId is required' }) };
    }

    if (body.package_override) {
      await supabase
        .from('sub_orders')
        .update({ package_override: body.package_override })
        .eq('id', subOrderId);
    }

    const ctx = await loadShipmentContext(supabase, subOrderId);
    if (!ctx.ok) {
      return { statusCode: ctx.statusCode, headers, body: JSON.stringify({ success: false, error: ctx.error }) };
    }

    if (ctx.summary.selected_lane === 'local_rider') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Local rider shipments do not use carrier quotes.' }),
      };
    }

    const action = event.httpMethod === 'GET'
      ? (event.queryStringParameters?.refresh === '1' ? 'refresh' : 'status')
      : body.action || 'refresh';

    if (action === 'status') {
      const quotes = await loadActiveQuotes(subOrderId, ctx.customerCharge);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: { ...ctx.summary, quotes, providers: [] } }),
      };
    }

    if (!ctx.packageInfo.ready) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unable to request shipping rates. Missing package information.',
          missing: ctx.packageInfo.missing,
          data: { ...ctx.summary, quotes: [], providers: [] },
        }),
      };
    }

    const onlyProvider = action === 'retry' ? body.provider : null;
    const result = await requestQuotes({
      supabase,
      subOrder: ctx.subOrder,
      shipment: ctx.packageInfo,
      onlyProvider,
    });

    await recordFulfilmentAction(supabase, event, auth.authUser, {
      action: onlyProvider ? 'quotes_retry_provider' : 'quotes_requested',
      orderId: ctx.summary.order_id,
      subOrderId,
      provider: onlyProvider,
      metadata: { providers: result.providers, quote_count: result.quotes.length },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          ...ctx.summary,
          quotes_requested_at: result.requested_at,
          quotes_expires_at: result.expires_at,
          quotes: result.quotes,
          providers: result.providers,
        },
      }),
    };
  } catch (error) {
    console.error('[shipping-quotes]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message || 'Failed to load shipping quotes' }),
    };
  }
};
