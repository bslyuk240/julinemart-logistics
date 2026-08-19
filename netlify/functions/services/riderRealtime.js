/**
 * Realtime "wake up and refetch" signals for rider dispatch — Supabase
 * Realtime Broadcast, not Postgres Changes. Broadcast channels don't need
 * RLS policies to subscribe (unlike postgres_changes, which would require
 * opening up riders/shipments to client-side reads to work), so payloads
 * here are deliberately just pings: an event name plus IDs. Every real
 * data read still goes through the authenticated rider-jobs.js /
 * admin-* endpoints — this only tells a listening client "go call those
 * again now" instead of waiting for its next poll.
 *
 * Best-effort by design, same as pushNotifications.js and shipmentSync.js
 * — a failure here must never fail the dispatch write it's announcing.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function riderAreaChannelName(city, state) {
  return `rider-area-${normalize(state)}-${normalize(city)}`;
}

export function riderChannelName(riderId) {
  return `rider-${riderId}`;
}

// Keyed by the *source* row (manual_shipments.id or sub_orders.id) — that's
// what the admin detail pages actually have in hand, not the unified
// shipments.id, which they never load.
export function dispatchChannelName(sourceType, sourceId) {
  const kind = sourceType === 'sub_order' ? 'sub-order' : 'manual-shipment';
  return `dispatch-${kind}-${sourceId}`;
}

async function send(channelName, event, payload) {
  let channel;
  try {
    channel = supabase.channel(channelName);
    await channel.subscribe();
    await channel.send({ type: 'broadcast', event, payload });
  } catch (err) {
    console.warn(`riderRealtime send (${channelName}/${event}) failed:`, err?.message || err);
  } finally {
    if (channel) {
      try {
        await supabase.removeChannel(channel);
      } catch {
        // best-effort cleanup only
      }
    }
  }
}

/** Notify every rider client subscribed to a pickup area (broadcast created/claimed). */
export function notifyRiderArea(city, state, event, payload = {}) {
  if (!city || !state) return Promise.resolve();
  return send(riderAreaChannelName(city, state), event, payload);
}

/** Notify one rider's own client directly (assigned/declined/claim confirmed). */
export function notifyRider(riderId, event, payload = {}) {
  if (!riderId) return Promise.resolve();
  return send(riderChannelName(riderId), event, payload);
}

/** Notify whoever's viewing a shipment's admin detail page that something changed. */
export function notifyDispatch(sourceType, sourceId, event, payload = {}) {
  if (!sourceId) return Promise.resolve();
  return send(dispatchChannelName(sourceType, sourceId), event, payload);
}
