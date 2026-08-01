/**
 * Shared Fez tracking helpers — status mapping, validation, API fetch.
 */
import { authenticateFez } from './fezAuth.js';

export function mapFezStatus(fezStatus) {
  const map = {
    'Pending Pick-Up': 'pending_pickup',
    'Assigned To A Rider': 'assigned',
    'Picked-Up': 'picked_up',
    Dispatched: 'in_transit',
    'Prepared for Delivery': 'in_transit',
    'Out for Delivery': 'out_for_delivery',
    'Delivery in Progress': 'out_for_delivery',
    Delivered: 'delivered',
    Cancelled: 'cancelled',
    Returned: 'returned',
    'Return in Progress': 'returned',
  };

  const mapped = map[fezStatus];
  if (!mapped) console.warn('Unknown Fez status — add to map:', fezStatus);
  return mapped || 'assigned';
}

export function isValidFezTrackingNumber(val) {
  if (!val || typeof val !== 'string') return false;
  return !/^[0-9a-f-]{36}$/i.test(val);
}

export async function fetchFezTracking(supabase, trackingNumber) {
  const { authToken, secretKey, baseUrl } = await authenticateFez(supabase);

  const response = await fetch(`${baseUrl}/order/track/${trackingNumber}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'secret-key': secretKey,
    },
  });

  const data = await response.json();
  if (data.status !== 'Success') {
    throw new Error(data.description || 'Order Not Found');
  }

  return {
    order: data.order,
    history: data.history || [],
  };
}

export function normalizeFezHistoryEntry(entry) {
  const fezLabel = entry?.orderStatus || entry?.status || entry?.statusDescription || '';
  return {
    status: mapFezStatus(fezLabel),
    fez_status: fezLabel,
    description: entry?.statusDescription || entry?.description || fezLabel || 'Status update',
    event_time: entry?.date || entry?.timestamp || entry?.statusDate || new Date().toISOString(),
    location_name: entry?.location || entry?.location_name || null,
  };
}

export async function insertTrackingEvent(supabase, payload) {
  const { error } = await supabase.from('tracking_events').insert(payload);
  if (error) console.warn('tracking_events insert failed:', error.message);
}
