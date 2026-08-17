/**
 * GET /api/gift-boxes?gfc=warri
 * GET /api/gift-boxes?slug=birthday-surprise
 *
 * Public ready-made gift boxes for storefront.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import {
  customerFacingLeadDays,
  maxLeadTimeForGiftLines,
} from './services/gift-delivery-schedule.js';

const BOX_SELECT =
  'id, slug, sku, name, description, image_url, gallery_urls, list_price, recipient_types, occasion_types, sort_order, gift_fulfilment_centre_id, average_rating, rating_count';

async function resolveGfc(qs) {
  const code = (qs.gfc || qs.code || '').trim().toLowerCase();
  const gfcIdParam = qs.gfc_id;

  let gfcQuery = adminClient
    .from('gift_fulfilment_centres')
    .select('id, name, code, city, state, is_default')
    .eq('active', true);

  if (gfcIdParam) gfcQuery = gfcQuery.eq('id', gfcIdParam);
  else if (code) gfcQuery = gfcQuery.eq('code', code);
  else gfcQuery = gfcQuery.eq('is_default', true);

  const { data, error } = await gfcQuery.maybeSingle();
  if (error) throw error;
  return data;
}

async function poolProductIdsForGfc(gfcId) {
  const { data: poolRows, error } = await adminClient
    .from('gift_pool_inventory')
    .select('product_id')
    .eq('gift_fulfilment_centre_id', gfcId)
    .eq('active', true)
    .gt('available_qty', 0);
  if (error) throw error;
  return new Set((poolRows || []).map((r) => r.product_id));
}

async function boxWithItems(box, poolProductIds, gfcId) {
  const { data: items, error } = await adminClient
    .from('gift_box_items')
    .select(`
      id, quantity, sort_order, variation_id, pool_sourced_item_id,
      products!inner ( id, name, gift_eligible, status,
        product_images ( src, alt, position, is_thumbnail )
      )
    `)
    .eq('gift_box_id', box.id)
    .order('sort_order', { ascending: true });

  if (error) throw error;

  const eligible = (items || []).filter(
    (row) =>
      row.products?.gift_eligible &&
      row.products?.status === 'published' &&
      poolProductIds.has(row.products.id)
  );

  const contents = eligible.map((row) => {
    const images = (row.products.product_images || []).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );
    const thumb = images.find((i) => i.is_thumbnail) || images[0];
    return {
      product_id: row.products.id,
      name: row.products.name,
      quantity: row.quantity,
      image: thumb?.src || null,
    };
  });

  const maxLead = await maxLeadTimeForGiftLines(
    adminClient,
    eligible.map((row) => ({
      product_id: row.products.id,
      variation_id: row.variation_id,
      pool_sourced_item_id: row.pool_sourced_item_id,
    })),
    gfcId
  );

  return {
    id: box.id,
    slug: box.slug,
    sku: box.sku,
    name: box.name,
    description: box.description,
    image_url: box.image_url,
    gallery_urls: Array.isArray(box.gallery_urls) ? box.gallery_urls : [],
    list_price: Number(box.list_price),
    recipient_types: box.recipient_types || [],
    occasion_types: box.occasion_types || [],
    average_rating: Number(box.average_rating || 0),
    rating_count: Number(box.rating_count || 0),
    item_count: contents.reduce((s, i) => s + i.quantity, 0),
    lead_time_days: customerFacingLeadDays(maxLead),
    contents,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-boxes',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const qs = event.queryStringParameters || {};
  const slug = (qs.slug || '').trim().toLowerCase();

  try {
    const gfc = await resolveGfc(qs);
    if (!gfc) return jsonResponse(404, { success: false, error: 'Gift fulfilment centre not found' });

    const poolProductIds = await poolProductIdsForGfc(gfc.id);

    if (slug) {
      const { data: box, error } = await adminClient
        .from('gift_boxes')
        .select(BOX_SELECT)
        .eq('slug', slug)
        .eq('gift_fulfilment_centre_id', gfc.id)
        .eq('active', true)
        .maybeSingle();

      if (error) return jsonResponse(500, { success: false, error: error.message });
      if (!box) return jsonResponse(404, { success: false, error: 'Gift box not found' });

      const detail = await boxWithItems(box, poolProductIds, gfc.id);
      if (detail.item_count === 0) {
        return jsonResponse(404, { success: false, error: 'Gift box not available at this hub' });
      }
      return jsonResponse(200, {
        success: true,
        data: detail,
        gfc: { id: gfc.id, code: gfc.code, name: gfc.name, city: gfc.city, state: gfc.state },
      });
    }

    const { data: boxes, error } = await adminClient
      .from('gift_boxes')
      .select(BOX_SELECT)
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) return jsonResponse(500, { success: false, error: error.message });

    let filtered = boxes || [];
    const occasion = (qs.occasion || '').trim().toLowerCase();
    const recipient = (qs.recipient || '').trim().toLowerCase();
    const budgetMax = qs.budget_max != null && qs.budget_max !== '' ? Number(qs.budget_max) : null;
    const budgetMin = qs.budget_min != null && qs.budget_min !== '' ? Number(qs.budget_min) : null;

    if (occasion) {
      filtered = filtered.filter((box) => {
        const tags = box.occasion_types || [];
        return tags.length === 0 || tags.includes(occasion);
      });
    }
    if (recipient) {
      filtered = filtered.filter((box) => {
        const tags = box.recipient_types || [];
        return tags.length === 0 || tags.includes(recipient);
      });
    }
    if (budgetMax != null && Number.isFinite(budgetMax)) {
      filtered = filtered.filter((box) => Number(box.list_price) <= budgetMax);
    }
    if (budgetMin != null && Number.isFinite(budgetMin)) {
      filtered = filtered.filter((box) => Number(box.list_price) >= budgetMin);
    }

    const list = (await Promise.all(filtered.map((box) => boxWithItems(box, poolProductIds, gfc.id)))).filter(
      (box) => box.item_count > 0
    );

    return jsonResponse(200, {
      success: true,
      data: list,
      gfc: { id: gfc.id, code: gfc.code, name: gfc.name, city: gfc.city, state: gfc.state },
    });
  } catch (err) {
    return jsonResponse(500, { success: false, error: err?.message || String(err) });
  }
}
