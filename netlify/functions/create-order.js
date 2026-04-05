/**
 * POST /api/create-order
 *
 * Public endpoint — no authentication required (customers place orders).
 * Creates an order in Supabase, grouped into sub-orders by vendor.
 * Returns the order ID and a Paystack-compatible payment reference.
 *
 * Body:
 *   customer_name, customer_email, customer_phone   (required)
 *   delivery_address, delivery_city, delivery_state, delivery_zone  (required)
 *   delivery_lga, delivery_landmark  (optional)
 *   items: [{ product_id, variation_id?, quantity }]  (required, min 1)
 *   shipping_fee: number  (required, ₦)
 *   voucher_code?: string
 *   special_instructions?: string
 *   order_notes?: string
 */

import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';

function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JLO-${ts}-${rand}`;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON body' }); }

  const {
    customer_name,
    customer_email,
    customer_phone,
    delivery_address,
    delivery_city,
    delivery_state,
    delivery_zone,
    delivery_lga,
    delivery_landmark,
    items = [],
    shipping_fee = 0,
    voucher_code,
    special_instructions,
    order_notes,
  } = body;

  // ── Validate required fields ──────────────────────────────────────────────
  const missing = [];
  if (!customer_name?.trim()) missing.push('customer_name');
  if (!customer_email?.trim()) missing.push('customer_email');
  if (!customer_phone?.trim()) missing.push('customer_phone');
  if (!delivery_address?.trim()) missing.push('delivery_address');
  if (!delivery_city?.trim()) missing.push('delivery_city');
  if (!delivery_state?.trim()) missing.push('delivery_state');
  if (!delivery_zone?.trim()) missing.push('delivery_zone');
  if (!Array.isArray(items) || items.length === 0) missing.push('items');
  if (missing.length > 0) {
    return jsonResponse(400, { error: `Missing required fields: ${missing.join(', ')}` });
  }

  for (const item of items) {
    if (!item.product_id) return jsonResponse(400, { error: 'Each item must have a product_id' });
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return jsonResponse(400, { error: 'Each item must have a quantity >= 1' });
    }
  }

  try {
    // ── Resolve products and prices ─────────────────────────────────────────
    const productIds = [...new Set(items.map((i) => i.product_id))];
    const variationIds = [...new Set(items.map((i) => i.variation_id).filter(Boolean))];

    // Separate UUIDs from WooCommerce numeric IDs (items added from listing page
    // via WooCommerce fallback won't have Supabase UUIDs)
    const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
    const productUuids = productIds.filter(isUuid);
    const productWooIds = productIds.filter((id) => !isUuid(id) && Number(id) > 0).map(Number);
    const variationUuids = variationIds.filter(isUuid);
    const variationWooIds = variationIds.filter((id) => !isUuid(id) && Number(id) > 0).map(Number);

    const productSelect = 'id, woo_product_id, name, slug, sku, regular_price, sale_price, stock_status, vendor_id, hub_id, type';
    const variationSelect = 'id, woo_variation_id, product_id, sku, regular_price, sale_price, stock_status, attributes, vendor_id, hub_id';

    const [
      { data: productsByUuid },
      { data: productsByWoo },
      { data: variationsByUuid },
      { data: variationsByWoo },
    ] = await Promise.all([
      productUuids.length > 0
        ? adminClient.from('products').select(productSelect).in('id', productUuids)
        : Promise.resolve({ data: [] }),
      productWooIds.length > 0
        ? adminClient.from('products').select(productSelect).in('woo_product_id', productWooIds)
        : Promise.resolve({ data: [] }),
      variationUuids.length > 0
        ? adminClient.from('product_variations').select(variationSelect).in('id', variationUuids)
        : Promise.resolve({ data: [] }),
      variationWooIds.length > 0
        ? adminClient.from('product_variations').select(variationSelect).in('woo_variation_id', variationWooIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build lookup maps: keyed by UUID and by WC numeric id
    const productMap = new Map();
    for (const p of [...(productsByUuid || []), ...(productsByWoo || [])]) {
      productMap.set(p.id, p);
      if (p.woo_product_id) productMap.set(String(p.woo_product_id), p);
    }
    const variationMap = new Map();
    for (const v of [...(variationsByUuid || []), ...(variationsByWoo || [])]) {
      variationMap.set(v.id, v);
      if (v.woo_variation_id) variationMap.set(String(v.woo_variation_id), v);
    }

    // ── Build resolved line items ───────────────────────────────────────────
    const resolvedItems = [];
    for (const item of items) {
      const product = productMap.get(item.product_id) || productMap.get(String(item.product_id));
      if (!product) return jsonResponse(404, { error: `Product not found: ${item.product_id}` });

      const variation = item.variation_id
        ? (variationMap.get(item.variation_id) || variationMap.get(String(item.variation_id)))
        : null;
      if (item.variation_id && !variation) {
        return jsonResponse(404, { error: `Variation not found: ${item.variation_id}` });
      }

      // Use sale_price if set, else regular_price; variation price takes precedence
      const source = variation || product;
      const unitPrice = Number(source.sale_price || source.regular_price || 0);
      if (unitPrice <= 0) {
        return jsonResponse(400, { error: `Product "${product.name}" has no price set` });
      }

      resolvedItems.push({
        product_id: product.id,
        product_name: product.name,
        product_sku: variation?.sku || product.sku || null,
        variation_id: variation?.id || null,
        variation_details: variation ? { attributes: variation.attributes || [] } : null,
        vendor_id: variation?.vendor_id || product.vendor_id || null,
        hub_id: variation?.hub_id || product.hub_id || null,
        unit_price: unitPrice,
        quantity: item.quantity,
        subtotal: unitPrice * item.quantity,
        // for sub_order items JSONB
        _name: product.name,
        _sku: variation?.sku || product.sku || null,
        _vendorId: variation?.vendor_id || product.vendor_id || null,
        _hubId: variation?.hub_id || product.hub_id || null,
        _variationAttributes: variation?.attributes || [],
      });
    }

    // ── Voucher check ──────────────────────────────────────────────────────
    let discountAmount = 0;
    let voucherRow = null;
    if (voucher_code?.trim()) {
      const { data: voucher } = await adminClient
        .from('campaign_vouchers')
        .select('id, code, discount_type, discount_value, min_order_amount, max_uses, current_uses, expires_at, is_active')
        .eq('code', voucher_code.trim().toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (!voucher) return jsonResponse(400, { error: 'Invalid or expired voucher code' });
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return jsonResponse(400, { error: 'Voucher has expired' });
      }
      if (voucher.max_uses != null && voucher.current_uses >= voucher.max_uses) {
        return jsonResponse(400, { error: 'Voucher has reached its usage limit' });
      }

      const rawSubtotal = resolvedItems.reduce((s, i) => s + i.subtotal, 0);
      if (voucher.min_order_amount && rawSubtotal < Number(voucher.min_order_amount)) {
        return jsonResponse(400, {
          error: `Minimum order amount for this voucher is ₦${Number(voucher.min_order_amount).toLocaleString()}`,
        });
      }

      discountAmount = voucher.discount_type === 'percentage'
        ? Math.round((rawSubtotal * Number(voucher.discount_value)) / 100)
        : Math.min(Number(voucher.discount_value), rawSubtotal);

      voucherRow = voucher;
    }

    // ── Totals ─────────────────────────────────────────────────────────────
    const subtotal = resolvedItems.reduce((s, i) => s + i.subtotal, 0);
    const shippingFee = Math.max(Number(shipping_fee) || 0, 0);
    const totalAmount = Math.max(subtotal - discountAmount + shippingFee, 0);
    const paymentReference = generateRef();

    // ── Insert order ───────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await adminClient
      .from('orders')
      .insert({
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim().toLowerCase(),
        customer_phone: customer_phone.trim(),
        delivery_address: delivery_address.trim(),
        delivery_city: delivery_city.trim(),
        delivery_state: delivery_state.trim(),
        delivery_zone: delivery_zone.trim(),
        delivery_lga: delivery_lga?.trim() || null,
        delivery_landmark: delivery_landmark?.trim() || null,
        subtotal,
        total_amount: totalAmount,
        shipping_fee_paid: shippingFee,
        discount_amount: discountAmount,
        payment_status: 'pending',
        overall_status: 'pending',
        payment_reference: paymentReference,
        special_instructions: special_instructions?.trim() || null,
        order_notes: order_notes?.trim() || null,
        metadata: {
          voucher_code: voucherRow ? voucherRow.code : null,
          source: 'pwa',
        },
      })
      .select('id')
      .single();

    if (orderErr) return jsonResponse(500, { error: 'Failed to create order', detail: orderErr.message });
    const orderId = order.id;

    // ── Insert order items ─────────────────────────────────────────────────
    const { error: itemsErr } = await adminClient.from('order_items').insert(
      resolvedItems.map((i) => ({
        order_id: orderId,
        product_id: i.product_id,
        product_name: i.product_name,
        product_sku: i.product_sku,
        variation_id: i.variation_id,
        variation_details: i.variation_details,
        vendor_id: i.vendor_id,
        hub_id: i.hub_id,
        unit_price: i.unit_price,
        quantity: i.quantity,
        subtotal: i.subtotal,
      }))
    );
    if (itemsErr) return jsonResponse(500, { error: 'Failed to save order items', detail: itemsErr.message });

    // ── Group into sub-orders by vendor ────────────────────────────────────
    const vendorGroups = new Map();
    for (const item of resolvedItems) {
      const key = item._vendorId || 'unassigned';
      if (!vendorGroups.has(key)) {
        vendorGroups.set(key, {
          vendor_id: item._vendorId,
          hub_id: item._hubId,
          items: [],
          subtotal: 0,
        });
      }
      const group = vendorGroups.get(key);
      group.subtotal += item.subtotal;
      group.items.push({
        productId: item.product_id,
        variationId: item.variation_id,
        name: item._name,
        sku: item._sku,
        price: item.unit_price,
        quantity: item.quantity,
        total: item.subtotal,
        vendorId: item._vendorId,
        hubId: item._hubId,
        variationAttributes: item._variationAttributes,
      });
    }

    const subOrderRows = Array.from(vendorGroups.values()).map((g) => ({
      main_order_id: orderId,
      vendor_id: g.vendor_id,
      hub_id: g.hub_id,
      items: g.items,
      subtotal: g.subtotal,
      allocated_shipping_fee: vendorGroups.size === 1 ? shippingFee : 0,
      status: 'pending',
    }));

    const { error: subErr } = await adminClient.from('sub_orders').insert(subOrderRows);
    if (subErr) return jsonResponse(500, { error: 'Failed to create sub-orders', detail: subErr.message });

    // ── Increment voucher usage ────────────────────────────────────────────
    if (voucherRow) {
      await adminClient
        .from('campaign_vouchers')
        .update({ current_uses: (voucherRow.current_uses || 0) + 1 })
        .eq('id', voucherRow.id);
    }

    return jsonResponse(201, {
      success: true,
      data: {
        order_id: orderId,
        payment_reference: paymentReference,
        subtotal,
        discount_amount: discountAmount,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        item_count: resolvedItems.length,
      },
    });

  } catch (err) {
    return jsonResponse(500, { error: 'Order creation failed', message: err?.message || String(err) });
  }
}
