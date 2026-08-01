import { createClient } from '@supabase/supabase-js';
import { assertStaffCanReadShipments } from './services/shipmentAccess.js';
import { normalizeScanCode, resolveScanMatch } from './services/scanLookup.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    '',
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

async function hubIdsForDispatch(hubId) {
  const { data: subHubRows } = await supabase
    .from('hubs')
    .select('id')
    .eq('parent_hub_id', hubId)
    .eq('is_sub_hub', true);

  const subHubIds = (subHubRows || []).map((h) => h.id);
  return [hubId, ...subHubIds];
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const readAccess = await assertStaffCanReadShipments(event);
  if (!readAccess.ok) {
    return { statusCode: readAccess.statusCode, headers, body: readAccess.body };
  }

  try {
    const rawUrl =
      event.rawUrl ||
      `http://localhost${event.path}${event.queryStringParameters ? `?${new URLSearchParams(event.queryStringParameters).toString()}` : ''}`;
    const url = new URL(rawUrl);
    const code = normalizeScanCode(url.searchParams.get('code') || '');
    const hubId = url.searchParams.get('hubId');

    if (!code) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'code is required' }),
      };
    }

    const hubIds = hubId ? await hubIdsForDispatch(hubId) : null;
    const result = await resolveScanMatch(supabase, code, hubIds);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result }),
    };
  } catch (error) {
    console.error('scan-waybill error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error?.message || 'Failed to resolve scanned code',
      }),
    };
  }
}
