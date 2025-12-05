// Periodic sync of Fez return shipments
import { supabase, mapFezStatusToReturn } from './services/returns-utils.js';

const headers = {
  'Content-Type': 'application/json',
};

export async function handler(_event) {
  try {
    const { data: shipments, error } = await supabase
      .from('return_shipments')
      .select('id, return_request_id, fez_tracking, status')
      .not('status', 'in', '(delivered,cancelled)');

    if (error) throw error;
    if (!shipments || shipments.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated: 0 }) };
    }

    let updated = 0;
    for (const s of shipments) {
      if (!s.fez_tracking) continue;
      try {
        const res = await fetch(`${process.env.FEZ_API_BASE_URL}/order/${s.fez_tracking}`, {
          headers: { Authorization: `Bearer ${process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn('Fez tracking error', s.fez_tracking, data);
          continue;
        }
        const fezStatus = data?.status || data?.currentStatus || data?.trackingStatus;
        const mapped = mapFezStatusToReturn(fezStatus);
        await supabase.from('return_shipments').update({ status: mapped }).eq('id', s.id);
        await supabase.from('return_requests').update({ status: mapped }).eq('id', s.return_request_id);
        updated++;
      } catch (err) {
        console.error('Sync error for', s.fez_tracking, err);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, updated }) };
  } catch (error) {
    console.error('fez-sync-returns error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
