/**
 * Public vendor trust profile for PWA storefront.
 * GET /api/vendor-trust?vendor_id=<woo_or_uuid>
 */
import { createClient } from '@supabase/supabase-js';
import { buildVendorTrustProfile } from './services/sellerMetrics.js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function resolveVendor(vendorKey) {
  const key = String(vendorKey || '').trim();
  if (!key) return null;

  const select = 'id, store_name, woocommerce_vendor_id, city, state, approved_location_id';

  const isUuid = /^[0-9a-f-]{36}$/i.test(key);
  if (isUuid) {
    const { data } = await adminClient.from('vendors').select(select).eq('id', key).maybeSingle();
    return data;
  }

  const { data } = await adminClient
    .from('vendors')
    .select(select)
    .eq('woocommerce_vendor_id', key)
    .maybeSingle();
  return data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const url = new URL(event.rawUrl);
    const vendorKey = url.searchParams.get('vendor_id') || url.searchParams.get('id');
    const vendor = await resolveVendor(vendorKey);

    if (!vendor) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'Vendor not found' }),
      };
    }

    const [{ data: verifications }, { data: metrics }, { data: location }] = await Promise.all([
      adminClient
        .from('seller_verifications')
        .select('verification_type, status, verified_at')
        .eq('vendor_id', vendor.id),
      adminClient
        .from('seller_performance_snapshots')
        .select('*')
        .eq('vendor_id', vendor.id)
        .maybeSingle(),
      vendor.approved_location_id
        ? adminClient
            .from('approved_vendor_locations')
            .select('public_area, city, state, store_photos, opening_hours, supports_customer_pickup')
            .eq('id', vendor.approved_location_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const physicalVerified = (verifications || []).some(
      (v) => v.verification_type === 'physical_store' && v.status === 'approved'
    );

    const trust = buildVendorTrustProfile(vendor.id, verifications, metrics);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        success: true,
        data: {
          ...trust,
          store_name: vendor.store_name,
          physical_store: physicalVerified
            ? {
                area: location?.public_area || vendor.city,
                city: location?.city || vendor.city,
                state: location?.state || vendor.state,
                supports_pickup: Boolean(location?.supports_customer_pickup),
                photos: location?.store_photos || [],
                opening_hours: location?.opening_hours || null,
              }
            : null,
        },
      }),
    };
  } catch (err) {
    console.error('[vendor-trust]', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err?.message || 'Server error' }),
    };
  }
}
