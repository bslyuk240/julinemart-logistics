/**
 * GET /api/catalog-vendors
 * Browse active vendor storefronts with local discovery filters.
 *
 * Query: state, city, area, pickup_only, verified_only, lat, lng, sort (name|distance|quality)
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { haversineKm, parseCoord } from './services/geo.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!adminClient) {
    return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Database not configured' }) };
  }

  try {
    const q = event.queryStringParameters || {};
    const state = q.state ? String(q.state).trim() : null;
    const city = q.city ? String(q.city).trim() : null;
    const area = q.area ? String(q.area).trim() : null;
    const pickupOnly = q.pickup_only === 'true' || q.pickup_only === '1';
    const verifiedOnly = q.verified_only === 'true' || q.verified_only === '1';
    const userLat = parseCoord(q.lat);
    const userLng = parseCoord(q.lng);
    const sort = String(q.sort || 'name').toLowerCase();
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(q.per_page) || 48));
    const offset = (page - 1) * perPage;

    const { data: vendors, error: vErr } = await adminClient
      .from('vendors')
      .select(`
        id, store_name, logo_url, description, woocommerce_vendor_id, city, state,
        seller_quality_score,
        approved_location_id,
        approved_vendor_locations (
          id, state, city, public_area, supports_customer_pickup,
          latitude, longitude, pickup_instructions
        )
      `)
      .eq('is_active', true)
      .not('store_name', 'is', null)
      .order('store_name', { ascending: true });

    if (vErr) {
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: vErr.message }) };
    }

    const vendorIds = (vendors || []).map((v) => v.id);
    let verificationsByVendor = new Map();
    if (vendorIds.length) {
      const { data: verifications } = await adminClient
        .from('seller_verifications')
        .select('vendor_id, verification_type, status')
        .in('vendor_id', vendorIds)
        .eq('status', 'approved');
      for (const row of verifications || []) {
        if (!verificationsByVendor.has(row.vendor_id)) verificationsByVendor.set(row.vendor_id, []);
        verificationsByVendor.get(row.vendor_id).push(row.verification_type);
      }
    }

    let rows = (vendors || []).map((v) => {
      const loc = v.approved_vendor_locations || null;
      const verifications = verificationsByVendor.get(v.id) || [];
      const physicalVerified = verifications.includes('physical_store');
      const displayState = loc?.state || v.state || null;
      const displayCity = loc?.city || v.city || null;
      const displayArea = loc?.public_area || null;
      const supportsPickup = Boolean(physicalVerified && loc?.supports_customer_pickup);
      const lat = loc?.latitude != null ? Number(loc.latitude) : null;
      const lng = loc?.longitude != null ? Number(loc.longitude) : null;
      let distanceKm = null;
      if (userLat != null && userLng != null && lat != null && lng != null) {
        distanceKm = Math.round(haversineKm(userLat, userLng, lat, lng) * 10) / 10;
      }

      return {
        id: v.id,
        store_name: v.store_name,
        logo_url: v.logo_url,
        description: v.description,
        vendor_id: v.woocommerce_vendor_id || v.id,
        city: displayCity,
        state: displayState,
        area: displayArea,
        supports_pickup: supportsPickup,
        physical_store_verified: physicalVerified,
        verifications,
        latitude: lat,
        longitude: lng,
        distance_km: distanceKm,
        pickup_instructions: loc?.pickup_instructions || null,
        seller_quality_score: v.seller_quality_score != null ? Number(v.seller_quality_score) : null,
      };
    });

    if (state) {
      rows = rows.filter((r) => r.state && r.state.toLowerCase() === state.toLowerCase());
    }
    if (city) {
      rows = rows.filter((r) => r.city && r.city.toLowerCase() === city.toLowerCase());
    }
    if (area) {
      const needle = area.toLowerCase();
      rows = rows.filter((r) => r.area && r.area.toLowerCase().includes(needle));
    }
    if (pickupOnly) {
      rows = rows.filter((r) => r.supports_pickup);
    }
    if (verifiedOnly) {
      rows = rows.filter((r) => r.physical_store_verified);
    }

    if (sort === 'distance' && userLat != null && userLng != null) {
      rows.sort((a, b) => {
        if (a.distance_km == null && b.distance_km == null) return a.store_name.localeCompare(b.store_name);
        if (a.distance_km == null) return 1;
        if (b.distance_km == null) return -1;
        return a.distance_km - b.distance_km;
      });
    } else if (sort === 'quality') {
      rows.sort((a, b) => {
        const aq = a.seller_quality_score ?? -1;
        const bq = b.seller_quality_score ?? -1;
        if (bq !== aq) return bq - aq;
        return a.store_name.localeCompare(b.store_name);
      });
    } else {
      rows.sort((a, b) => a.store_name.localeCompare(b.store_name));
    }

    const total = rows.length;
    const paged = rows.slice(offset, offset + perPage);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Cache-Control': 'public, max-age=120' },
      body: JSON.stringify({
        success: true,
        data: paged,
        meta: {
          page,
          per_page: perPage,
          total,
          total_pages: total > 0 ? Math.ceil(total / perPage) : 0,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err?.message || 'Server error' }),
    };
  }
}
