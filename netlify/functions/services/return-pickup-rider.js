/**
 * Local-rider pickup for a return.
 *
 * A return pickup is a manual shipment going the other way: the sender is the
 * customer's address, the destination is the hub. The rider app already
 * handles this "drop it at a hub" leg (it needs a photo at the hub, then marks
 * the package at_hub), so a return reuses it rather than adding a new flow.
 * rider-jobs then reports progress back through return-pickup-sync.js.
 */
import { handler as broadcastHandler } from '../manual-shipment-broadcast-rider.js';
import { computeDispatchCost, lookupShippingRate, resolveZoneForState } from './shippingRateLookup.js';

function generateShipmentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'MSH-';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

/**
 * Creates the manual shipment and offers it to online riders in the pickup
 * town. Returns { shipment, broadcast: { ok, riders_notified, error } }. A
 * failed broadcast is not fatal: the shipment exists and staff can dispatch it
 * from Manual Shipments, so the return approval itself shouldn't fail.
 */
export async function createLocalRiderPickup(client, event, {
  pickupFrom,
  hub,
  returnCode,
  itemSummary,
  staffUserId = null,
}) {
  const zone = await resolveZoneForState(client, pickupFrom.state);
  const rate = zone ? await lookupShippingRate(client, { zoneId: zone.id }) : null;
  if (!zone || !rate) {
    throw new Error(
      'No shipping rate is configured for the pickup area, so a rider cannot be priced. Add one under Admin → Rates, or use Fez.'
    );
  }

  const { data: shipment, error } = await client
    .from('manual_shipments')
    .insert({
      shipment_code: generateShipmentCode(),
      sender_hub_id: null,
      sender: {
        name: pickupFrom.name,
        address: pickupFrom.address,
        city: pickupFrom.city || '',
        state: pickupFrom.state,
        phone: pickupFrom.phone || '',
      },
      recipient: {
        name: hub.name || 'JulineMart Hub',
        address: hub.address || '',
        city: hub.city || '',
        state: hub.state || '',
        phone: hub.phone || '',
      },
      destination_hub_id: hub.id,
      item_description: `Return ${returnCode}: ${itemSummary}`.slice(0, 250),
      item_weight: 1,
      item_value: 0,
      zone_id: zone.id,
      shipping_fee: computeDispatchCost(rate, 1),
      created_by: staffUserId,
    })
    .select()
    .single();
  if (error) throw new Error(`Could not create the rider pickup: ${error.message}`);

  const broadcast = { ok: false, riders_notified: 0, error: null };
  try {
    const res = await broadcastHandler({
      httpMethod: 'POST',
      headers: event.headers || {},
      body: JSON.stringify({ shipment_id: shipment.id }),
    });
    const parsed = JSON.parse(res.body || '{}');
    broadcast.ok = res.statusCode === 200 && parsed.success !== false;
    broadcast.riders_notified = Number(parsed.riders_notified || 0);
    if (!broadcast.ok) broadcast.error = parsed.error || parsed.message || 'Broadcast failed';
  } catch (err) {
    broadcast.error = err?.message || String(err);
  }

  return { shipment, broadcast };
}
