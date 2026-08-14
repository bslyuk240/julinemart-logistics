/**
 * POST /api/create-gift-order
 *
 * Ready-made gift box checkout (Mode A).
 * Creates orders + gift_orders + component order_items for packing/margin.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';

function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JLO-GFT-${ts}-${rand}`;
}

function jloTrackingPlaceholder() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'JLO-';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const poolKey = (pid, vid) => `${pid}:${vid || ''}`;

async function createCustomBuildOrder(params) {
  const {
    builder_session_token,
    gfc_code,
    gfc_id,
    customer_name,
    customer_email,
    customer_phone,
    recipient_name,
    recipient_phone,
    recipient_email,
    recipient_address,
    recipient_city,
    recipient_state,
    recipient_zone,
    gift_message,
    sender_visible = true,
    occasion,
    shipping_fee = 0,
  } = params;

  const { data: session, error: sessErr } = await adminClient
    .from('gift_builder_sessions')
    .select(`
      id, session_token, status, gift_fulfilment_centre_id, gift_packaging_type_id,
      gift_fulfilment_centres ( id, name, code ),
      gift_packaging_types ( id, code, name, price )
    `)
    .eq('session_token', builder_session_token)
    .maybeSingle();

  if (sessErr) return jsonResponse(500, { error: sessErr.message });
  if (!session || session.status !== 'draft') {
    return jsonResponse(400, { error: 'Invalid or expired builder session' });
  }

  const gfc = session.gift_fulfilment_centres;
  if (!gfc) return jsonResponse(404, { error: 'Gift fulfilment centre not found' });
  if (gfc_id && gfc.id !== gfc_id) {
    return jsonResponse(400, { error: 'Session hub mismatch' });
  }
  if (gfc_code && gfc.code !== String(gfc_code).trim().toLowerCase()) {
    return jsonResponse(400, { error: 'Session hub mismatch' });
  }

  if (!session.gift_packaging_type_id || !session.gift_packaging_types) {
    return jsonResponse(400, { error: 'Select a packaging tier before checkout' });
  }

  const { data: builderItems, error: biErr } = await adminClient
    .from('gift_builder_items')
    .select('id, product_id, variation_id, quantity, unit_price, component_cost')
    .eq('gift_builder_session_id', session.id);

  if (biErr) return jsonResponse(500, { error: biErr.message });
  if (!builderItems?.length) {
    return jsonResponse(400, { error: 'Add at least one item to your gift box' });
  }

  const productIds = [...new Set(builderItems.map((i) => i.product_id))];
  const { data: products, error: prodErr } = await adminClient
    .from('products')
    .select('id, name, slug, sku, vendor_id, hub_id, gift_eligible, status, cost_price')
    .in('id', productIds);

  if (prodErr) return jsonResponse(500, { error: prodErr.message });
  const productMap = new Map((products || []).map((p) => [p.id, p]));

  const { data: poolRows, error: poolErr } = await adminClient
    .from('gift_pool_inventory')
    .select('product_id, variation_id, available_qty, gift_program_cost, active')
    .eq('gift_fulfilment_centre_id', gfc.id)
    .in('product_id', productIds)
    .eq('active', true);

  if (poolErr) return jsonResponse(500, { error: poolErr.message });
  const poolMap = new Map((poolRows || []).map((r) => [poolKey(r.product_id, r.variation_id), r]));

  let componentCostTotal = 0;
  const resolvedItems = [];

  for (const item of builderItems) {
    const product = productMap.get(item.product_id);
    if (!product?.gift_eligible || !['publish', 'published'].includes(product.status)) {
      return jsonResponse(400, { error: `Product "${product?.name || item.product_id}" is unavailable` });
    }

    const pool =
      poolMap.get(poolKey(item.product_id, item.variation_id)) ||
      poolMap.get(poolKey(item.product_id, null));

    if (!pool || pool.available_qty < item.quantity) {
      return jsonResponse(400, { error: `Insufficient pool stock for "${product.name}"` });
    }

    const unitCost =
      item.component_cost != null
        ? Number(item.component_cost)
        : pool.gift_program_cost != null
          ? Number(pool.gift_program_cost)
          : Number(product.cost_price || 0);

    componentCostTotal += unitCost * item.quantity;

    resolvedItems.push({
      product_id: product.id,
      product_name: product.name,
      product_sku: product.sku || null,
      variation_id: item.variation_id || null,
      variation_details: null,
      vendor_id: product.vendor_id || null,
      hub_id: product.hub_id || null,
      unit_price: 0,
      cost_price: unitCost,
      quantity: item.quantity,
      subtotal: 0,
      _name: product.name,
      _sku: product.sku || null,
      _vendorId: product.vendor_id || null,
      _hubId: product.hub_id || null,
    });
  }

  const packaging = session.gift_packaging_types;
  const itemsRetail = builderItems.reduce(
    (s, i) => s + Number(i.unit_price) * i.quantity,
    0
  );
  const listPrice = itemsRetail + Number(packaging.price);
  const shippingFee = Math.max(0, Number(shipping_fee) || 0);
  const totalAmount = listPrice + shippingFee;
  const paymentReference = generateRef();

  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .insert({
      order_kind: 'gift_custom',
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: customer_phone.trim(),
      delivery_address: recipient_address.trim(),
      delivery_city: recipient_city.trim(),
      delivery_state: recipient_state.trim(),
      delivery_zone: recipient_zone.trim(),
      subtotal: listPrice,
      total_amount: totalAmount,
      shipping_fee_paid: shippingFee,
      discount_amount: 0,
      payment_status: 'pending',
      overall_status: 'pending',
      payment_reference: paymentReference,
      fulfillment_method: 'delivery',
      metadata: {
        source: 'pwa_gifts',
        order_kind: 'gift_custom',
        gift_builder_session_id: session.id,
        gift_fulfilment_centre_id: gfc.id,
        gift_packaging_code: packaging.code,
        order_confirmation_handler: 'netlify_create_gift_order',
      },
    })
    .select('id, order_number')
    .single();

  if (orderErr) {
    return jsonResponse(500, { error: 'Failed to create order', detail: orderErr.message });
  }

  const orderId = order.id;
  const orderNumber = order.order_number;

  const { error: giftErr } = await adminClient.from('gift_orders').insert({
    order_id: orderId,
    gift_box_id: null,
    gift_builder_session_id: session.id,
    gift_packaging_type_id: packaging.id,
    gift_fulfilment_centre_id: gfc.id,
    order_kind: 'gift_custom',
    recipient_name: recipient_name.trim(),
    recipient_phone: recipient_phone.trim(),
    recipient_email: recipient_email?.trim() || null,
    recipient_address: recipient_address.trim(),
    recipient_city: recipient_city.trim(),
    recipient_state: recipient_state.trim(),
    recipient_zone: recipient_zone.trim(),
    gift_message: gift_message?.trim() || null,
    sender_visible: sender_visible !== false,
    occasion: occasion?.trim() || session.occasion || null,
    component_cost_total: componentCostTotal,
    gift_status: 'new',
  });

  if (giftErr) {
    await adminClient.from('orders').delete().eq('id', orderId);
    return jsonResponse(500, { error: 'Failed to save gift details', detail: giftErr.message });
  }

  const { data: giftOrderRow } = await adminClient
    .from('gift_orders')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (giftOrderRow?.id) {
    await adminClient.from('gift_order_events').insert({
      gift_order_id: giftOrderRow.id,
      status: 'new',
      note: 'Custom gift box order created',
    });
  }

  const { data: insertedItems, error: oiErr } = await adminClient
    .from('order_items')
    .insert(
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
        cost_price: i.cost_price,
        quantity: i.quantity,
        subtotal: i.subtotal,
      }))
    )
    .select('id, product_id, product_name, quantity');

  if (oiErr) {
    await adminClient.from('orders').delete().eq('id', orderId);
    return jsonResponse(500, { error: 'Failed to save packing items', detail: oiErr.message });
  }

  await adminClient
    .from('gift_builder_sessions')
    .update({ status: 'converted', updated_at: new Date().toISOString() })
    .eq('id', session.id);

  const packingChecklist = (insertedItems || []).map((row) => ({
    order_item_id: row.id,
    product_id: row.product_id,
    name: row.product_name,
    quantity: row.quantity,
  }));

  const primaryHubId = resolvedItems.find((i) => i.hub_id)?.hub_id || null;

  const { data: subOrder, error: subErr } = await adminClient
    .from('sub_orders')
    .insert({
      main_order_id: orderId,
      vendor_id: null,
      hub_id: primaryHubId,
      courier_id: null,
      tracking_number: jloTrackingPlaceholder(),
      items: resolvedItems.map((i) => ({
        productId: i.product_id,
        variationId: i.variation_id,
        name: i._name,
        sku: i._sku,
        price: 0,
        quantity: i.quantity,
        total: 0,
        vendorId: i._vendorId,
        hubId: i._hubId,
      })),
      subtotal: listPrice,
      allocated_shipping_fee: shippingFee,
      status: 'pending',
      metadata: {
        source: 'gift_custom',
        order_kind: 'gift_custom',
        gift_fulfilment_centre_id: gfc.id,
        gift_builder_session_id: session.id,
        gift_packaging: packaging,
        packing_checklist: packingChecklist,
        component_cost_total: componentCostTotal,
      },
    })
    .select('id')
    .single();

  if (subErr) {
    await adminClient.from('orders').delete().eq('id', orderId);
    return jsonResponse(500, { error: 'Failed to create gift sub-order', detail: subErr.message });
  }

  if (subOrder?.id) {
    await adminClient.from('tracking_events').insert({
      sub_order_id: subOrder.id,
      status: 'pending',
      description: 'Custom gift order received — awaiting payment',
      location_name: gfc.name,
      event_time: new Date().toISOString(),
    });
  }

  return jsonResponse(201, {
    success: true,
    data: {
      order_id: orderId,
      order_number: orderNumber,
      payment_reference: paymentReference,
      subtotal: listPrice,
      shipping_fee: shippingFee,
      total_amount: totalAmount,
      component_cost_total: componentCostTotal,
      order_kind: 'gift_custom',
      packaging: { code: packaging.code, name: packaging.name },
      gfc: { id: gfc.id, code: gfc.code, name: gfc.name },
      packing_item_count: packingChecklist.length,
    },
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const {
    gift_box_id,
    gift_box_slug,
    builder_session_token,
    gfc_code,
    gfc_id,
    customer_name,
    customer_email,
    customer_phone,
    recipient_name,
    recipient_phone,
    recipient_email,
    recipient_address,
    recipient_city,
    recipient_state,
    recipient_zone,
    gift_message,
    sender_visible = true,
    occasion,
    shipping_fee = 0,
  } = body;

  const missing = [];
  if (!customer_name?.trim()) missing.push('customer_name');
  if (!customer_email?.trim()) missing.push('customer_email');
  if (!customer_phone?.trim()) missing.push('customer_phone');
  if (!recipient_name?.trim()) missing.push('recipient_name');
  if (!recipient_phone?.trim()) missing.push('recipient_phone');
  if (!recipient_address?.trim()) missing.push('recipient_address');
  if (!recipient_city?.trim()) missing.push('recipient_city');
  if (!recipient_state?.trim()) missing.push('recipient_state');
  if (!recipient_zone?.trim()) missing.push('recipient_zone');
  const isCustomBuild = Boolean(builder_session_token?.trim());
  if (!isCustomBuild && !gift_box_id && !gift_box_slug) {
    missing.push('gift_box_id or gift_box_slug');
  }
  if (isCustomBuild && !builder_session_token?.trim()) missing.push('builder_session_token');
  if (missing.length) {
    return jsonResponse(400, { error: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    if (isCustomBuild) {
      return await createCustomBuildOrder({
        builder_session_token: builder_session_token.trim(),
        gfc_code,
        gfc_id,
        customer_name,
        customer_email,
        customer_phone,
        recipient_name,
        recipient_phone,
        recipient_email,
        recipient_address,
        recipient_city,
        recipient_state,
        recipient_zone,
        gift_message,
        sender_visible,
        occasion,
        shipping_fee,
      });
    }

    let gfcQuery = adminClient
      .from('gift_fulfilment_centres')
      .select('id, code, name, active')
      .eq('active', true);

    if (gfc_id) gfcQuery = gfcQuery.eq('id', gfc_id);
    else if (gfc_code) gfcQuery = gfcQuery.eq('code', String(gfc_code).trim().toLowerCase());
    else gfcQuery = gfcQuery.eq('is_default', true);

    const { data: gfc, error: gfcErr } = await gfcQuery.maybeSingle();
    if (gfcErr) return jsonResponse(500, { error: gfcErr.message });
    if (!gfc) return jsonResponse(404, { error: 'Gift fulfilment centre not found' });

    let boxQuery = adminClient
      .from('gift_boxes')
      .select('id, name, slug, list_price, gift_fulfilment_centre_id, active')
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true);

    if (gift_box_id) boxQuery = boxQuery.eq('id', gift_box_id);
    else boxQuery = boxQuery.eq('slug', String(gift_box_slug).trim().toLowerCase());

    const { data: box, error: boxErr } = await boxQuery.maybeSingle();
    if (boxErr) return jsonResponse(500, { error: boxErr.message });
    if (!box) return jsonResponse(404, { error: 'Gift box not found or inactive' });

    const { data: boxItems, error: itemsErr } = await adminClient
      .from('gift_box_items')
      .select('id, product_id, variation_id, quantity, component_cost')
      .eq('gift_box_id', box.id)
      .order('sort_order', { ascending: true });

    if (itemsErr) return jsonResponse(500, { error: itemsErr.message });
    if (!boxItems?.length) {
      return jsonResponse(400, { error: 'This gift box has no items configured' });
    }

    const productIds = [...new Set(boxItems.map((i) => i.product_id))];
    const { data: products, error: prodErr } = await adminClient
      .from('products')
      .select('id, name, slug, sku, vendor_id, hub_id, gift_eligible, status, cost_price')
      .in('id', productIds);

    if (prodErr) return jsonResponse(500, { error: prodErr.message });

    const productMap = new Map((products || []).map((p) => [p.id, p]));

    const { data: poolRows, error: poolErr } = await adminClient
      .from('gift_pool_inventory')
      .select('product_id, variation_id, available_qty, gift_program_cost, active')
      .eq('gift_fulfilment_centre_id', gfc.id)
      .in('product_id', productIds)
      .eq('active', true);

    if (poolErr) return jsonResponse(500, { error: poolErr.message });

    const poolKeyFn = (pid, vid) => `${pid}:${vid || ''}`;
    const poolMap = new Map(
      (poolRows || []).map((r) => [poolKeyFn(r.product_id, r.variation_id), r])
    );

    let componentCostTotal = 0;
    const resolvedItems = [];

    for (const item of boxItems) {
      const product = productMap.get(item.product_id);
      if (!product || !product.gift_eligible) {
        return jsonResponse(400, { error: `Product unavailable for gifting in "${box.name}"` });
      }
      if (!['publish', 'published'].includes(product.status)) {
        return jsonResponse(400, { error: `"${product.name}" is not available` });
      }

      const pool =
        poolMap.get(poolKeyFn(item.product_id, item.variation_id)) ||
        poolMap.get(poolKeyFn(item.product_id, null));

      if (!pool || pool.available_qty < item.quantity) {
        return jsonResponse(400, {
          error: `Insufficient pool stock for "${product.name}" at ${gfc.name}`,
        });
      }

      const unitCost =
        item.component_cost != null
          ? Number(item.component_cost)
          : pool.gift_program_cost != null
            ? Number(pool.gift_program_cost)
            : Number(product.cost_price || 0);

      componentCostTotal += unitCost * item.quantity;

      resolvedItems.push({
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku || null,
        variation_id: item.variation_id || null,
        variation_details: null,
        vendor_id: product.vendor_id || null,
        hub_id: product.hub_id || null,
        unit_price: 0,
        cost_price: unitCost,
        quantity: item.quantity,
        subtotal: 0,
        _name: product.name,
        _sku: product.sku || null,
        _vendorId: product.vendor_id || null,
        _hubId: product.hub_id || null,
      });
    }

    const listPrice = Number(box.list_price);
    const shippingFee = Math.max(0, Number(shipping_fee) || 0);
    const totalAmount = listPrice + shippingFee;
    const paymentReference = generateRef();

    const { data: order, error: orderErr } = await adminClient
      .from('orders')
      .insert({
        order_kind: 'gift_ready_made',
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim().toLowerCase(),
        customer_phone: customer_phone.trim(),
        delivery_address: recipient_address.trim(),
        delivery_city: recipient_city.trim(),
        delivery_state: recipient_state.trim(),
        delivery_zone: recipient_zone.trim(),
        subtotal: listPrice,
        total_amount: totalAmount,
        shipping_fee_paid: shippingFee,
        discount_amount: 0,
        payment_status: 'pending',
        overall_status: 'pending',
        payment_reference: paymentReference,
        fulfillment_method: 'delivery',
        metadata: {
          source: 'pwa_gifts',
          order_kind: 'gift_ready_made',
          gift_box_id: box.id,
          gift_box_slug: box.slug,
          gift_fulfilment_centre_id: gfc.id,
          order_confirmation_handler: 'netlify_create_gift_order',
        },
      })
      .select('id, order_number')
      .single();

    if (orderErr) {
      return jsonResponse(500, { error: 'Failed to create order', detail: orderErr.message });
    }

    const orderId = order.id;
    const orderNumber = order.order_number;

    const { error: giftErr } = await adminClient.from('gift_orders').insert({
      order_id: orderId,
      gift_box_id: box.id,
      gift_fulfilment_centre_id: gfc.id,
      order_kind: 'gift_ready_made',
      recipient_name: recipient_name.trim(),
      recipient_phone: recipient_phone.trim(),
      recipient_email: recipient_email?.trim() || null,
      recipient_address: recipient_address.trim(),
      recipient_city: recipient_city.trim(),
      recipient_state: recipient_state.trim(),
      recipient_zone: recipient_zone.trim(),
      gift_message: gift_message?.trim() || null,
      sender_visible: sender_visible !== false,
      occasion: occasion?.trim() || null,
      component_cost_total: componentCostTotal,
      gift_status: 'new',
    });

    if (giftErr) {
      await adminClient.from('orders').delete().eq('id', orderId);
      return jsonResponse(500, { error: 'Failed to save gift details', detail: giftErr.message });
    }

    const { data: giftOrderRow } = await adminClient
      .from('gift_orders')
      .select('id')
      .eq('order_id', orderId)
      .maybeSingle();

    if (giftOrderRow?.id) {
      await adminClient.from('gift_order_events').insert({
        gift_order_id: giftOrderRow.id,
        status: 'new',
        note: 'Gift order created',
      });
    }

    const { data: insertedItems, error: oiErr } = await adminClient
      .from('order_items')
      .insert(
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
          cost_price: i.cost_price,
          quantity: i.quantity,
          subtotal: i.subtotal,
        }))
      )
      .select('id, product_id, product_name, quantity');

    if (oiErr) {
      await adminClient.from('orders').delete().eq('id', orderId);
      return jsonResponse(500, { error: 'Failed to save packing items', detail: oiErr.message });
    }

    const packingChecklist = (insertedItems || []).map((row) => ({
      order_item_id: row.id,
      product_id: row.product_id,
      name: row.product_name,
      quantity: row.quantity,
    }));

    const primaryHubId = resolvedItems.find((i) => i.hub_id)?.hub_id || null;

    const { data: subOrder, error: subErr } = await adminClient
      .from('sub_orders')
      .insert({
        main_order_id: orderId,
        vendor_id: null,
        hub_id: primaryHubId,
        courier_id: null,
        tracking_number: jloTrackingPlaceholder(),
        items: resolvedItems.map((i) => ({
          productId: i.product_id,
          variationId: i.variation_id,
          name: i._name,
          sku: i._sku,
          price: 0,
          quantity: i.quantity,
          total: 0,
          vendorId: i._vendorId,
          hubId: i._hubId,
        })),
        subtotal: listPrice,
        allocated_shipping_fee: shippingFee,
        status: 'pending',
        metadata: {
          source: 'gift_ready_made',
          order_kind: 'gift_ready_made',
          gift_fulfilment_centre_id: gfc.id,
          gift_box_id: box.id,
          gift_box_name: box.name,
          packing_checklist: packingChecklist,
          component_cost_total: componentCostTotal,
        },
      })
      .select('id')
      .single();

    if (subErr) {
      await adminClient.from('orders').delete().eq('id', orderId);
      return jsonResponse(500, { error: 'Failed to create gift sub-order', detail: subErr.message });
    }

    if (subOrder?.id) {
      await adminClient.from('tracking_events').insert({
        sub_order_id: subOrder.id,
        status: 'pending',
        description: 'Gift order received — awaiting payment',
        location_name: gfc.name,
        event_time: new Date().toISOString(),
      });
    }

    return jsonResponse(201, {
      success: true,
      data: {
        order_id: orderId,
        order_number: orderNumber,
        payment_reference: paymentReference,
        subtotal: listPrice,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        component_cost_total: componentCostTotal,
        gift_box: { id: box.id, slug: box.slug, name: box.name },
        gfc: { id: gfc.id, code: gfc.code, name: gfc.name },
        packing_item_count: packingChecklist.length,
      },
    });
  } catch (err) {
    return jsonResponse(500, { error: 'Gift order creation failed', message: err?.message || String(err) });
  }
}
