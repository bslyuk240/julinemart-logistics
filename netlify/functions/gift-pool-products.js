/**
 * GET /api/gift-pool-products?gfc=warri
 * GET /api/gift-pool-products?gfc_id=<uuid>
 *
 * Public storefront pool — gift-eligible products active in pool at the given GFC.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-pool-products',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const qs = event.queryStringParameters || {};
  const code = (qs.gfc || qs.code || '').trim().toLowerCase();
  const gfcIdParam = qs.gfc_id;

  try {
    let gfcQuery = adminClient
      .from('gift_fulfilment_centres')
      .select('id, name, code, city, state, is_default')
      .eq('active', true);

    if (gfcIdParam) {
      gfcQuery = gfcQuery.eq('id', gfcIdParam);
    } else if (code) {
      gfcQuery = gfcQuery.eq('code', code);
    } else {
      gfcQuery = gfcQuery.eq('is_default', true);
    }

    const { data: gfc, error: gfcErr } = await gfcQuery.maybeSingle();
    if (gfcErr) return jsonResponse(500, { success: false, error: gfcErr.message });
    if (!gfc) return jsonResponse(404, { success: false, error: 'Gift fulfilment centre not found' });

    const { data: poolRows, error: poolErr } = await adminClient
      .from('gift_pool_inventory')
      .select(`
        id, available_qty, gift_program_cost, lead_time_days,
        products!inner (
          id, name, slug, sku, regular_price, sale_price, status,
          gift_eligible, gift_category, gift_recipient_types, gift_occasion_types, gift_box_compatible,
          product_images ( src, alt, position, is_thumbnail )
        )
      `)
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true)
      .gt('available_qty', 0);

    if (poolErr) return jsonResponse(500, { success: false, error: poolErr.message });

    const products = (poolRows || [])
      .filter((row) => row.products?.gift_eligible && row.products?.gift_box_compatible !== false)
      .filter((row) => ['publish', 'published'].includes(row.products?.status))
      .map((row) => {
        const p = row.products;
        const images = (p.product_images || []).sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0)
        );
        const thumb = images.find((i) => i.is_thumbnail) || images[0];
        return {
          pool_id: row.id,
          product_id: p.id,
          name: p.name,
          slug: p.slug,
          sku: p.sku,
          price: Number(p.sale_price || p.regular_price || 0),
          gift_category: p.gift_category,
          gift_recipient_types: p.gift_recipient_types || [],
          gift_occasion_types: p.gift_occasion_types || [],
          available_qty: row.available_qty,
          gift_program_cost: row.gift_program_cost,
          lead_time_days: row.lead_time_days,
          image: thumb?.src || null,
        };
      });

    return {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
      body: JSON.stringify({
        success: true,
        data: {
          fulfilment_centre: gfc,
          products,
          count: products.length,
        },
      }),
    };
  } catch (err) {
    console.error('[gift-pool-products]', err);
    return jsonResponse(500, { success: false, error: 'Failed to load gift pool' });
  }
}
