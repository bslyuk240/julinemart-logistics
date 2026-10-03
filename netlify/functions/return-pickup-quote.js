// POST /api/return-pickup-quote
//
// Tells the return form whether pickup is available and what it would cost,
// before the customer submits. Requires the customer's login and that the
// order is theirs.
//
// Body: { order_id, reason_code, complaint_type?, pickup_state, pickup_city? }
//       or { probe: true } to ask only whether pickup is enabled.
// Response: { enabled, available, free, fee, quoted_fee, lane_hint, hub }
//   enabled   false until the pickup migration is applied (hide the option)
//   available false when no shipping rate exists for the customer's state
//   free      true when the return is JulineMart's fault (we pay)
//   fee       what the customer owes (deducted from their refund)
import { supabase, fetchSupabaseOrder } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';
import {
  chooseReturnLane,
  isPickupEnabled,
  pickupChargeFor,
  resolveReturnHub,
} from './services/return-pickup.js';

const reply = (statusCode, body) => ({ statusCode, headers: corsHeaders(), body: JSON.stringify(body) });

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') return reply(405, { success: false, error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'return-pickup-quote',
    max: 30,
    window: '10 m',
    retryAfterSeconds: 600,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...corsHeaders() } };

  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) return reply(401, { success: false, error: 'Sign in required' });

  try {
    if (!(await isPickupEnabled(supabase))) {
      return reply(200, { success: true, data: { enabled: false } });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    // A bare availability check: lets the form decide whether to offer pickup
    // at all, before the customer has picked a reason or an address.
    if (body.probe) return reply(200, { success: true, data: { enabled: true } });

    const { order_id, reason_code, complaint_type, pickup_state, pickup_city } = body;
    if (!order_id || !reason_code || !pickup_state) {
      return reply(400, { success: false, error: 'order_id, reason_code and pickup_state are required' });
    }

    let order = null;
    try {
      order = await fetchSupabaseOrder(order_id);
    } catch {
      order = null;
    }
    if (!order || String(order.customer_email || '').trim().toLowerCase() !== email) {
      return reply(404, { success: false, error: 'Order not found' });
    }

    const charge = await pickupChargeFor(supabase, {
      reasonCode: reason_code,
      complaintType: complaint_type,
      state: pickup_state,
    });
    const hub = await resolveReturnHub(supabase, { city: pickup_city, state: pickup_state });

    return reply(200, {
      success: true,
      data: {
        enabled: true,
        available: charge.available,
        free: charge.free,
        fee: charge.fee,
        quoted_fee: charge.quoted_fee,
        lane_hint: hub ? chooseReturnLane({ pickupCity: pickup_city, hubCity: hub.city }) : 'fez',
        hub: hub ? { id: hub.id, name: hub.name, city: hub.city, state: hub.state } : null,
      },
    });
  } catch (error) {
    console.error('return-pickup-quote error:', error);
    return reply(500, { success: false, error: 'Could not price the pickup' });
  }
}
