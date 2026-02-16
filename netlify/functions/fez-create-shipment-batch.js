import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function runSingleShipment(subOrderId, force) {
  const singleModule = await import('./Fez-create-shipment.js');
  const singleHandler =
    singleModule?.handler ||
    singleModule?.default?.handler ||
    singleModule?.default;

  if (typeof singleHandler !== 'function') {
    throw new Error('Unable to load single Fez shipment handler');
  }

  const response = await singleHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ subOrderId, force: Boolean(force) }),
  });

  const payload = (() => {
    try {
      return JSON.parse(response?.body || '{}');
    } catch {
      return {};
    }
  })();

  return { response, payload };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    const { hubId, subOrderIds, force = false } = JSON.parse(event.body || '{}');

    if (!hubId || !Array.isArray(subOrderIds) || subOrderIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'hubId and non-empty subOrderIds[] are required',
        }),
      };
    }

    const uniqueIds = [...new Set(subOrderIds.filter(Boolean))];
    const { data: rows, error } = await supabase
      .from('sub_orders')
      .select('id, hub_id, metadata')
      .in('id', uniqueIds);

    if (error) {
      throw error;
    }

    const byId = new Map((rows || []).map((row) => [row.id, row]));
    const successes = [];
    const failures = [];
    const skipped = [];

    for (const subOrderId of uniqueIds) {
      const row = byId.get(subOrderId);
      if (!row) {
        skipped.push({ subOrderId, reason: 'not_found' });
        continue;
      }

      if (row.hub_id !== hubId) {
        skipped.push({
          subOrderId,
          reason: 'hub_mismatch',
          hub_id: row.hub_id,
        });
        continue;
      }

      const lane = row?.metadata?.selected_lane || 'fez';
      if (lane !== 'fez') {
        skipped.push({
          subOrderId,
          reason: 'lane_not_fez',
          selected_lane: lane,
        });
        continue;
      }

      try {
        const { response, payload } = await runSingleShipment(subOrderId, force);
        if (response?.statusCode >= 200 && response?.statusCode < 300 && payload?.success) {
          successes.push({
            subOrderId,
            tracking_number: payload?.data?.tracking_number || null,
            courier_shipment_id: payload?.data?.courier_shipment_id || null,
          });
        } else {
          failures.push({
            subOrderId,
            error: payload?.error || payload?.message || `HTTP ${response?.statusCode || 500}`,
          });
        }
      } catch (singleError) {
        failures.push({
          subOrderId,
          error: singleError?.message || 'Failed to dispatch shipment',
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        hubId,
        force: Boolean(force),
        counts: {
          requested: uniqueIds.length,
          successes: successes.length,
          failures: failures.length,
          skipped: skipped.length,
        },
        successes,
        failures,
        skipped,
      }),
    };
  } catch (error) {
    console.error('fez-create-shipment-batch error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error?.message || 'Failed to dispatch Fez batch',
      }),
    };
  }
}
