import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!['PUT', 'PATCH', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const isAdmin = auth.user?.role === 'admin';

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      woo_product_id,
      // Basic
      name,
      description,
      short_description,
      // Pricing
      regular_price,
      sale_price,
      sku,
      // Stock
      stock_status,
      manage_stock,
      stock_quantity,
      // Shipping
      weight,
      dimensions,
      shipping_class,
      // Taxonomy
      categories,
      tags,
      // Media
      images,
      // Attributes (for variable products)
      attributes,
      // Vendor
      vendor_id,
      // Hub
      hub_id,
      // Variations batch update
      variations,
      // Publish flag
      publish,
    } = body;

    if (!woo_product_id) {
      return jsonResponse(400, { success: false, error: 'woo_product_id is required' });
    }
    if (publish && !isAdmin) {
      return jsonResponse(403, { success: false, error: 'Only admins can publish products' });
    }

    // Resolve vendor + hub from Supabase in parallel
    let wooVendorId = null;
    let vendorRecord = null;
    let hubRecord = null;

    const [vendorResult, hubResult] = await Promise.all([
      vendor_id
        ? auth.adminClient.from('vendors').select('id, store_name, woocommerce_vendor_id').eq('id', vendor_id).single()
        : Promise.resolve({ data: null, error: null }),
      hub_id
        ? auth.adminClient.from('hubs').select('id, name, code').eq('id', hub_id).single()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (vendor_id && (vendorResult.error || !vendorResult.data)) {
      return jsonResponse(400, { success: false, error: 'Vendor not found' });
    }
    if (hub_id && (hubResult.error || !hubResult.data)) {
      return jsonResponse(400, { success: false, error: 'Hub not found' });
    }

    vendorRecord = vendorResult.data || null;
    hubRecord = hubResult.data || null;
    wooVendorId = vendorRecord?.woocommerce_vendor_id || null;

    // ── Build WooCommerce product payload ──────────────────────────────────
    const payload = {};

    if (name !== undefined) payload.name = String(name).trim();
    if (description !== undefined) payload.description = description;
    if (short_description !== undefined) payload.short_description = short_description;
    if (regular_price !== undefined) payload.regular_price = String(regular_price);
    if (sale_price !== undefined) payload.sale_price = sale_price ? String(sale_price) : '';
    if (sku !== undefined) payload.sku = String(sku).trim();
    if (stock_status !== undefined) payload.stock_status = stock_status;
    if (manage_stock !== undefined) payload.manage_stock = Boolean(manage_stock);
    if (manage_stock && stock_quantity !== undefined) payload.stock_quantity = stock_quantity === '' ? null : Number(stock_quantity);
    if (weight !== undefined) payload.weight = String(weight);
    if (dimensions !== undefined) {
      payload.dimensions = {
        length: String(dimensions.length || ''),
        width: String(dimensions.width || ''),
        height: String(dimensions.height || ''),
      };
    }
    if (shipping_class !== undefined) payload.shipping_class = shipping_class;
    if (images !== undefined) {
      payload.images = images.map((img, i) =>
        img.id
          ? { id: img.id, src: img.src, alt: img.alt || '', position: i }
          : { src: img.src, alt: img.alt || '', position: i }
      );
    }
    if (categories !== undefined) {
      payload.categories = categories.map((c) => ({ id: c.id }));
    }
    if (tags !== undefined) {
      payload.tags = tags.map((t) => ({ id: t.id }));
    }
    if (attributes !== undefined) {
      payload.attributes = attributes.map((a) => ({
        id: a.id || 0,
        name: a.name,
        visible: a.visible !== false,
        variation: a.variation !== false,
        options: a.options || [],
      }));
    }
    if (publish) payload.status = 'publish';

    // ── Vendor meta ────────────────────────────────────────────────────────
    const metaEntries = [];
    if (wooVendorId) {
      payload.author = Number(wooVendorId);
      metaEntries.push(
        { key: '_wcfm_vendor_id', value: String(wooVendorId) },
        { key: 'wcfm_vendor_id', value: String(wooVendorId) },
        { key: '_woocommerce_vendor_id', value: String(wooVendorId) },
        { key: '_wcfm_product_author', value: String(wooVendorId) }
      );
    }
    if (vendor_id) {
      metaEntries.push(
        { key: '_jlo_vendor_id', value: vendor_id },
        { key: 'vendor_id', value: vendor_id },
        { key: '_vendor_id', value: vendor_id }
      );
    }
    if (hub_id && hubRecord) {
      metaEntries.push(
        { key: '_receiving_hub_id', value: hub_id },
        { key: 'receiving_hub_id', value: hub_id },
        { key: '_julinemart_hub_id', value: hub_id },
        { key: '_hub_id', value: hub_id },
        { key: 'hub_id', value: hub_id },
        { key: '_julinemart_hub_name', value: hubRecord.name },
        { key: '_hub_name', value: hubRecord.name },
        { key: 'hub_name', value: hubRecord.name }
      );
    }
    if (metaEntries.length > 0) payload.meta_data = metaEntries;

    // ── Update product ─────────────────────────────────────────────────────
    const updatePromises = [
      requestWoo(`/products/${encodeURIComponent(woo_product_id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    ];

    // ── Batch update variations ────────────────────────────────────────────
    // variations = [{ id, regular_price, sale_price, sku, stock_status, manage_stock, stock_quantity }]
    if (Array.isArray(variations) && variations.length > 0) {
      const variationUpdates = variations.map((v) => {
        const vPayload = { id: v.id };
        if (v.regular_price !== undefined) vPayload.regular_price = String(v.regular_price);
        if (v.sale_price !== undefined) vPayload.sale_price = v.sale_price ? String(v.sale_price) : '';
        if (v.sku !== undefined) vPayload.sku = String(v.sku).trim();
        if (v.stock_status !== undefined) vPayload.stock_status = v.stock_status;
        if (v.manage_stock !== undefined) vPayload.manage_stock = Boolean(v.manage_stock);
        if (v.manage_stock && v.stock_quantity !== undefined) {
          vPayload.stock_quantity = v.stock_quantity === '' ? null : Number(v.stock_quantity);
        }
        return vPayload;
      });

      updatePromises.push(
        requestWoo(`/products/${encodeURIComponent(woo_product_id)}/variations/batch`, {
          method: 'POST',
          body: JSON.stringify({ update: variationUpdates }),
        })
      );
    }

    const [updated] = await Promise.all(updatePromises);

    return jsonResponse(200, {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        regular_price: updated.regular_price,
        permalink: updated.permalink || null,
        vendor: vendorRecord,
        hub: hubRecord,
      },
      message: publish ? 'Product published successfully' : 'Product saved',
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to update product',
      message: error?.message,
      details: error?.responseBody || null,
    });
  }
}
