/**
 * POST /api/product-sku-next
 * Body: { prefix: "LAP-JUL-", extra_skus?: string[] }
 *
 * Auth: vendor JWT (linked vendors row) OR JLO staff (same roles as catalog-product-upsert).
 * Uses service role to read all product + variation SKUs so the next code matches the global catalog
 * (no duplicate CAT-VEN-### across vendor portal vs admin).
 */
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';
import {
  headers,
  parseJsonBody,
  jsonResponse,
  requireAdmin,
  GLOBAL_SOURCING_ALLOWED_ROLES,
} from './services/global-sourcing-utils.js';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maxSuffixForPrefix(prefix, skuList) {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  let max = 0;
  for (const raw of skuList) {
    const m = String(raw || '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const vendorAuth = await authenticateVendor(event);
  let staffAuth = null;
  if (vendorAuth.error) {
    staffAuth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
    if (staffAuth.errorResponse) return staffAuth.errorResponse;
  }

  const body = parseJsonBody(event.body);
  if (!body || typeof body !== 'object') return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

  const prefix = String(body.prefix || '').trim();
  if (!prefix || prefix.length > 64) {
    return jsonResponse(400, { success: false, error: 'prefix is required (max 64 chars)' });
  }
  if (!/^[A-Za-z0-9-]+$/i.test(prefix)) {
    return jsonResponse(400, { success: false, error: 'prefix may only contain letters, numbers, and hyphens' });
  }

  const extraRaw = Array.isArray(body.extra_skus) ? body.extra_skus : [];
  const extraSkus = extraRaw.map((s) => String(s || '').trim()).filter(Boolean);

  const adminClient = getAdminClient();
  const pattern = `${prefix}%`;

  try {
    const [pr, vr] = await Promise.all([
      adminClient.from('products').select('sku').not('sku', 'is', null).ilike('sku', pattern),
      adminClient.from('product_variations').select('sku').not('sku', 'is', null).ilike('sku', pattern),
    ]);
    if (pr.error) throw pr.error;
    if (vr.error) throw vr.error;

    const fromDb = [];
    for (const r of pr.data || []) if (r.sku) fromDb.push(r.sku);
    for (const r of vr.data || []) if (r.sku) fromDb.push(r.sku);

    const combined = [...fromDb, ...extraSkus];
    const max = maxSuffixForPrefix(prefix, combined);
    const next = max + 1;
    const seq = String(Math.max(0, Math.floor(next))).padStart(3, '0');
    const next_sku = `${prefix}${seq}`;

    return jsonResponse(200, {
      success: true,
      data: {
        max_suffix: max,
        next_suffix: next,
        next_sku,
      },
    });
  } catch (e) {
    return jsonResponse(500, { success: false, error: e?.message || 'Failed to compute next SKU' });
  }
}
