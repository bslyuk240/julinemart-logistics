/**
 * GET /api/vendor-store-qr?vendor_id=<woo_or_uuid>&format=png|svg
 */
import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const STOREFRONT_BASE =
  process.env.STOREFRONT_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.PWA_URL ||
  'https://julinemart.com';

async function resolveVendor(vendorKey) {
  const key = String(vendorKey || '').trim();
  if (!key) return null;
  const isUuid = /^[0-9a-f-]{36}$/i.test(key);
  const select = 'id, store_name, woocommerce_vendor_id, store_slug';
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
    const format = (url.searchParams.get('format') || 'png').toLowerCase();
    const vendor = await resolveVendor(vendorKey);

    if (!vendor) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'Vendor not found' }),
      };
    }

    const wooId = vendor.woocommerce_vendor_id || vendorKey;
    const storeUrl = `${STOREFRONT_BASE.replace(/\/$/, '')}/vendor/${encodeURIComponent(wooId)}?qr=1`;

    if (format === 'svg') {
      const svg = await QRCode.toString(storeUrl, { type: 'svg', margin: 1, width: 280 });
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
        body: svg,
      };
    }

    const pngDataUrl = await QRCode.toDataURL(storeUrl, { margin: 1, width: 280 });
    return {
      statusCode: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({
        success: true,
        data: {
          vendor_id: wooId,
          store_name: vendor.store_name,
          store_url: storeUrl,
          png_data_url: pngDataUrl,
        },
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err?.message || 'QR generation failed' }),
    };
  }
}
