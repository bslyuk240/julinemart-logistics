/**
 * GET /api/catalog-product?id=<uuid>
 * GET /api/catalog-product?woo_id=<int>
 * GET /api/catalog-product?slug=<slug>
 *
 * Returns a single product with full detail:
 * vendor, hub, images, categories, tags, attributes, variations.
 */

import {
  headers,
  jsonResponse,
  adminClient,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const q = event.queryStringParameters || {};

  try {
    let productQuery = adminClient
      .from('products')
      .select(
        `id, woo_product_id, name, slug, description, short_description, status, type,
         regular_price, sale_price, sku, weight, length, width, height,
         manage_stock, stock_quantity, stock_status,
         is_virtual, is_downloadable, ships_from_abroad, sold_individually,
         average_rating, rating_count, reviews_allowed,
         sourcing_meta, seo_title, seo_description, created_at, updated_at,
         vendors!vendor_id ( id, store_name, store_slug, woocommerce_vendor_id, phone, city, state ),
         hubs!hub_id ( id, name, code, city, state ),
         product_images ( id, src, alt, position, is_thumbnail, variation_id ),
         product_category_map ( categories ( id, name, slug, parent_id ) ),
         product_tag_map ( tags ( id, name, slug ) ),
         product_attribute_map (
           id, options, is_variation, display_order,
           product_attributes ( id, name, slug, type )
         ),
         product_variations (
           id, woo_variation_id, sku, regular_price, sale_price,
           stock_quantity, stock_status, manage_stock, attributes, is_active,
           vendor_id, hub_id, sourcing_meta,
           product_images ( id, src, alt, position )
         )`
      );

    if (q.id) {
      productQuery = productQuery.eq('id', q.id);
    } else if (q.woo_id) {
      productQuery = productQuery.eq('woo_product_id', Number(q.woo_id));
    } else if (q.slug) {
      productQuery = productQuery.eq('slug', q.slug);
    } else {
      return jsonResponse(400, { error: 'Provide id, woo_id, or slug' });
    }

    // Storefront (slug / woo_id): only published, matching catalog-products.
    // Lookup by Supabase id is used by the dashboard Product Upload editor — allow any status.
    const listStatus = q.status || 'published';
    const isStorefrontLookup = !q.id && Boolean(q.slug || q.woo_id);
    if (isStorefrontLookup && listStatus !== 'all') {
      productQuery = productQuery.eq('status', listStatus);
    }

    const { data, error } = await productQuery.maybeSingle();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    if (!data) return jsonResponse(404, { success: false, error: 'Product not found' });

    return jsonResponse(200, {
      success: true,
      data: normalizeProductDetail(data),
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to load product',
      message: error?.message || String(error),
    });
  }
}

function normalizeProductDetail(p) {
  const allImages = (p.product_images || []).sort((a, b) => a.position - b.position);
  const productImages = allImages.filter((img) => !img.variation_id);

  const variations = (p.product_variations || [])
    .filter((v) => v.is_active)
    .map((v) => ({
      ...v,
      image: (v.product_images || [])[0] || null,
      product_images: undefined,
    }))
    .sort((a, b) => (a.woo_variation_id || 0) - (b.woo_variation_id || 0));

  const attributes = (p.product_attribute_map || [])
    .sort((a, b) => a.display_order - b.display_order)
    .map((a) => ({
      id: a.product_attributes?.id,
      name: a.product_attributes?.name,
      slug: a.product_attributes?.slug,
      type: a.product_attributes?.type,
      options: a.options || [],
      is_variation: a.is_variation,
    }));

  return {
    ...p,
    vendor: p.vendors || null,
    hub: p.hubs || null,
    images: productImages,
    categories: (p.product_category_map || []).map((r) => r.categories).filter(Boolean),
    tags: (p.product_tag_map || []).map((r) => r.tags).filter(Boolean),
    attributes,
    variations,
    // Remove raw relation keys
    vendors: undefined,
    hubs: undefined,
    product_images: undefined,
    product_category_map: undefined,
    product_tag_map: undefined,
    product_attribute_map: undefined,
    product_variations: undefined,
  };
}
