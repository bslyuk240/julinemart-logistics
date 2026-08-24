/**
 * Scheduled (every 30 min, see netlify.toml): finds shipments that have been
 * in a non-terminal status for longer than SKOLA_DELAYED_THRESHOLD_HOURS
 * (default 24h) since creation and fires a 'shipment.delayed' webhook event
 * for each one exactly once, tracked via metadata.skola_delayed_notified_at
 * so re-runs don't re-notify the same shipment.
 */
import { createClient } from '@supabase/supabase-js';
import { sendWebhookEvent } from './services/webhookDelivery.js';
import { fetchSourceDetails, summarizeShipment, SHIPMENT_LIST_SELECT } from './services/shipmentSummary.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, serviceKey);

const TERMINAL_STATUSES = ['delivered', 'failed', 'cancelled', 'returned'];
const THRESHOLD_HOURS = Number(process.env.SKOLA_DELAYED_THRESHOLD_HOURS) || 24;

export const handler = async () => {
  const cutoff = new Date(Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(SHIPMENT_LIST_SELECT)
    .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
    .lt('created_at', cutoff)
    .is("metadata->>'skola_delayed_notified_at'", null)
    .limit(200);

  if (error) {
    console.error('[detect-delayed-shipments] query failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  if (!shipments || shipments.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ notified: 0 }) };
  }

  const { subOrderMap, manualMap } = await fetchSourceDetails(supabase, shipments);
  let notified = 0;

  for (const shipment of shipments) {
    const summary = summarizeShipment(shipment, subOrderMap, manualMap);
    if (!summary) continue;

    const ageHours = Math.round((Date.now() - new Date(shipment.created_at).getTime()) / 3_600_000);

    await sendWebhookEvent('shipment.delayed', {
      shipment_id: shipment.id,
      tracking_number: summary.tracking_number,
      status: summary.status,
      order_number: summary.order_number,
      age_hours: ageHours,
      threshold_hours: THRESHOLD_HOURS,
      dropoff_city: summary.dropoff?.city || null,
      dropoff_state: summary.dropoff?.state || null,
      created_at: shipment.created_at,
    });

    const nextMetadata = { ...(shipment.metadata || {}), skola_delayed_notified_at: new Date().toISOString() };
    await supabase.from('shipments').update({ metadata: nextMetadata }).eq('id', shipment.id);
    notified += 1;
  }

  return { statusCode: 200, body: JSON.stringify({ notified }) };
};
