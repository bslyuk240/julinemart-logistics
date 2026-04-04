/**
 * POST /api/catalog-product-upsert  — create a new product
 * PUT  /api/catalog-product-upsert?id=<uuid> — update existing product
 * DELETE /api/catalog-product-upsert?id=<uuid> — delete product and all related rows
 *
 * Accessible by: admin, shop_manager, and agents with catalog_access.
 * Writes to Supabase: products, product_images, product_category_map,
 *   product_tag_map, product_attribute_map, product_variations.
 */

import {
  headers,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
  GLOBAL_SOURCING_ALLOWED_ROLES,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const isPost = event.httpMethod === 'POST';
  const isPut = event.httpMethod === 'PUT';
  const isDelete = event.httpMethod === 'DELETE';
  if (!isPost && !isPut && !isDelete) return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const body = parseJsonBody(event.body);
  if (!body && !isDelete) return jsonResponse(400, { error: 'Invalid JSON body' });

  const productId = event.queryStringParameters?.id || null;
  if ((isPut || isDelete) && !productId) return jsonResponse(400, { error: 'id query param required' });

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (isDelete) {
    try {
      await Promise.all([
        auth.adminClient.from('product_images').delete().eq('product_id', productId),
        auth.adminClient.from('product_category_map').delete().eq('product_id', productId),
        auth.adminClient.from('product_tag_map').delete().eq('product_id', productId),
        auth.adminClient.from('product_attribute_map').delete().eq('product_id', productId),
        auth.adminClient.from('product_variations').delete().eq('product_id', productId),
      ]);
      const { error } = await auth.adminClient.from('products').delete().eq('id', productId);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true });
    } catch (err) {
      return jsonResponse(500, { success: false, error: 'Failed to delete product', message: err?.message });
    }
  }

  const {
    name,
    slug,
    description,
    short_description,
    status = 'draft',
    type = 'simple',
    regular_price,
    sale_price,
    sku,
    manage_stock = false,
    stock_quantity,
    stock_status = 'instock',
    is_virtual = false,
    ships_from_abroad = false,
    vendor_id,
    hub_id,
    seo_title,
    seo_description,
    images = [],       // [{ src, alt, position, is_thumbnail }]
    category_ids = [], // uuid[]
    tag_ids = [],      // uuid[]
    // attributes: [{name, options: string[], is_variation}] — only processed when key present
    // variations: [{id?, attributes: [{name,value}], sku, regular_price, sale_price, stock_status, manage_stock, stock_quantity}]
  } = body;

  const attributesProvided = 'attributes' in body;
  const variationsProvided = 'variations' in body;
  const rawAttributes = body.attributes || [];
  const rawVariations = body.variations || [];

  if (isPost && !name) return jsonResponse(400, { error: 'name is required' });
  if (isPost && !slug) return jsonResponse(400, { error: 'slug is required' });

  try {
    const productData = {
      ...(name !== undefined && { name }),
      ...(slug !== undefined && { slug }),
      ...(description !== undefined && { description }),
      ...(short_description !== undefined && { short_description }),
      ...(status !== undefined && { status }),
      ...(type !== undefined && { type }),
      ...(regular_price !== undefined && { regular_price: regular_price ? Number(regular_price) : null }),
      ...(sale_price !== undefined && { sale_price: sale_price ? Number(sale_price) : null }),
      ...(sku !== undefined && { sku: sku || null }),
      ...(manage_stock !== undefined && { manage_stock: !!manage_stock }),
      ...(stock_quantity !== undefined && { stock_quantity: stock_quantity != null ? Number(stock_quantity) : null }),
      ...(stock_status !== undefined && { stock_status }),
      ...(is_virtual !== undefined && { is_virtual: !!is_virtual }),
      ...(ships_from_abroad !== undefined && { ships_from_abroad: !!ships_from_abroad }),
      ...(vendor_id !== undefined && { vendor_id: vendor_id || null }),
      ...(hub_id !== undefined && { hub_id: hub_id || null }),
      ...(seo_title !== undefined && { seo_title: seo_title || null }),
      ...(seo_description !== undefined && { seo_description: seo_description || null }),
      updated_at: new Date().toISOString(),
    };

    let savedProduct;

    if (isPost) {
      const { data: existing } = await auth.adminClient
        .from('products')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (existing) return jsonResponse(409, { error: 'A product with this slug already exists' });

      const { data, error } = await auth.adminClient
        .from('products')
        .insert(productData)
        .select('id, slug, name, status')
        .single();
      if (error) return jsonResponse(500, { success: false, error: error.message });
      savedProduct = data;
    } else {
      const { data, error } = await auth.adminClient
        .from('products')
        .update(productData)
        .eq('id', productId)
        .select('id, slug, name, status')
        .single();
      if (error) return jsonResponse(500, { success: false, error: error.message });
      if (!data) return jsonResponse(404, { error: 'Product not found' });
      savedProduct = data;
    }

    const pid = savedProduct.id;

    // ── Write images, categories, tags, attributes, variations in parallel ────
    await Promise.all([

      // Images
      (async () => {
        if (images.length === 0 && isPut) return;
        await auth.adminClient.from('product_images').delete().eq('product_id', pid);
        if (images.length > 0) {
          await auth.adminClient.from('product_images').insert(
            images.map((img, i) => ({
              product_id: pid,
              src: img.src,
              alt: img.alt || '',
              position: img.position ?? i,
              is_thumbnail: img.is_thumbnail ?? i === 0,
            }))
          );
        }
      })(),

      // Categories
      (async () => {
        if (!Array.isArray(category_ids)) return;
        await auth.adminClient.from('product_category_map').delete().eq('product_id', pid);
        if (category_ids.length > 0) {
          await auth.adminClient.from('product_category_map').insert(
            category_ids.map((cid) => ({ product_id: pid, category_id: cid }))
          );
        }
      })(),

      // Tags
      (async () => {
        if (!Array.isArray(tag_ids)) return;
        await auth.adminClient.from('product_tag_map').delete().eq('product_id', pid);
        if (tag_ids.length > 0) {
          await auth.adminClient.from('product_tag_map').insert(
            tag_ids.map((tid) => ({ product_id: pid, tag_id: tid }))
          );
        }
      })(),

      // Attributes (only when key is present in body)
      (async () => {
        if (!attributesProvided) return;
        // Clear existing attribute map for this product
        await auth.adminClient.from('product_attribute_map').delete().eq('product_id', pid);
        if (rawAttributes.length === 0) return;

        for (let i = 0; i < rawAttributes.length; i++) {
          const attr = rawAttributes[i];
          if (!attr.name?.trim()) continue;
          const slug = attr.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

          // Upsert the global attribute by slug
          const { data: attrRow, error: attrErr } = await auth.adminClient
            .from('product_attributes')
            .upsert({ name: attr.name.trim(), slug }, { onConflict: 'slug' })
            .select('id')
            .single();
          if (attrErr || !attrRow) continue;

          await auth.adminClient.from('product_attribute_map').insert({
            product_id: pid,
            attribute_id: attrRow.id,
            options: Array.isArray(attr.options) ? attr.options : [],
            is_variation: attr.is_variation ?? true,
            display_order: i,
          });
        }
      })(),

      // Variations (only when key is present in body)
      (async () => {
        if (!variationsProvided) return;

        const submittedIds = rawVariations.filter((v) => v.id).map((v) => v.id);

        // Deactivate removed variations (those not in submitted list)
        if (isPut) {
          let deactivateQ = auth.adminClient
            .from('product_variations')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('product_id', pid);
          if (submittedIds.length > 0) {
            deactivateQ = deactivateQ.not('id', 'in', `(${submittedIds.map((id) => `"${id}"`).join(',')})`);
          }
          await deactivateQ;
        }

        for (const v of rawVariations) {
          const varData = {
            product_id: pid,
            sku: v.sku || null,
            regular_price: v.regular_price != null && v.regular_price !== '' ? Number(v.regular_price) : null,
            sale_price: v.sale_price != null && v.sale_price !== '' ? Number(v.sale_price) : null,
            stock_status: v.stock_status || 'instock',
            manage_stock: !!v.manage_stock,
            stock_quantity: v.manage_stock && v.stock_quantity != null && v.stock_quantity !== ''
              ? Number(v.stock_quantity) : null,
            attributes: Array.isArray(v.attributes) ? v.attributes : [],
            is_active: true,
            updated_at: new Date().toISOString(),
          };

          if (v.id) {
            await auth.adminClient
              .from('product_variations')
              .update(varData)
              .eq('id', v.id)
              .eq('product_id', pid);
          } else {
            await auth.adminClient
              .from('product_variations')
              .insert({ ...varData, vendor_id: vendor_id || null, hub_id: hub_id || null });
          }
        }
      })(),

    ]);

    return jsonResponse(isPost ? 201 : 200, { success: true, data: savedProduct });
  } catch (err) {
    return jsonResponse(500, { success: false, error: 'Failed to save product', message: err?.message || String(err) });
  }
}
