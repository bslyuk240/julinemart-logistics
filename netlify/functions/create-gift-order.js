/**
 * POST /api/create-gift-order
 *
 * Ready-made gift box checkout (Mode A).
 * Creates orders + gift_orders + component order_items for packing/margin.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import {
  computeCustomerGiftTotal,
  loadGiftCommercialSettings,
} from './services/gift-commercial.js';
import { resolveBoxItemLines, resolveBuilderItemLines } from './services/gift-order-resolve.js';
import { insertGiftCommercialOrder } from './services/gift-order-insert.js';
import {
  validateGiftCampaignVoucher,
  resolveGiftVoucherContext,
  recordGiftVoucherRedemption,
} from './services/gift-voucher.js';
import {
  loadGfcSchedulingContext,
  maxLeadTimeForGiftLines,
  validateOccasionDate,
  validateRequestedDeliveryDate,
} from './services/gift-delivery-schedule.js';

async function logGiftOrderPlaced({
  orderId,
  orderNumber,
  orderKind,
  boxSku,
  totalAmount,
  voucherCode,
  customerEmail,
  customerName,
}) {
  try {
    await adminClient.from('activity_logs').insert({
      user_id: null,
      actor_email: customerEmail,
      action: 'GIFT_ORDER_PLACED',
      resource_type: 'gift_orders',
      resource_id: orderId,
      details: {
        order_number: orderNumber,
        order_kind: orderKind,
        box_sku: boxSku || null,
        total_amount: totalAmount,
        voucher_code: voucherCode || null,
        customer_name: customerName,
      },
      source: 'storefront',
    });
  } catch (activityError) {
    console.warn('[create-gift-order] activity log failed:', activityError?.message || activityError);
  }
}

async function validateGiftScheduleFields(adminClient, gfcId, lines, requested_delivery_date, occasion_date) {
  if (!requested_delivery_date?.trim()) {
    return { error: 'requested_delivery_date is required' };
  }

  const gfc = await loadGfcSchedulingContext(adminClient, gfcId);
  const maxLead = await maxLeadTimeForGiftLines(adminClient, lines, gfcId);
  const delivery = validateRequestedDeliveryDate({
    gfc,
    requestedDate: requested_delivery_date.trim(),
    maxLeadTimeDays: maxLead,
  });
  if (!delivery.valid) return { error: delivery.error };

  const occasion = validateOccasionDate(occasion_date);
  if (!occasion.valid) return { error: occasion.error };

  return {
    requested_delivery_date: delivery.requested_delivery_date,
    occasion_date: occasion.occasion_date,
  };
}

function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JLO-GFT-${ts}-${rand}`;
}

async function resolvePlatformDiscount({ customerEmail, voucher_code, giftContextParams }) {
  if (voucher_code?.trim()) {
    const giftContext = await resolveGiftVoucherContext(adminClient, giftContextParams);
    const result = await validateGiftCampaignVoucher(adminClient, {
      code: voucher_code.trim(),
      customerEmail: customerEmail.trim(),
      giftContext,
    });
    return { platformDiscount: result.discountAmount, voucher: result.voucher, giftContext };
  }

  return { platformDiscount: 0, voucher: null, giftContext: null };
}

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
    requested_delivery_date,
    occasion_date,
    shipping_fee = 0,
    voucher_code,
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
    .select(
      'id, product_id, variation_id, quantity, unit_price, component_cost, line_source, pool_sourced_item_id, customisation_spec'
    )
    .eq('gift_builder_session_id', session.id);

  if (biErr) return jsonResponse(500, { error: biErr.message });
  if (!builderItems?.length) {
    return jsonResponse(400, { error: 'Add at least one item to your gift box' });
  }

  let resolved;
  try {
    resolved = await resolveBuilderItemLines(adminClient, builderItems, gfc.id);
  } catch (resolveErr) {
    return jsonResponse(400, { error: resolveErr.message });
  }

  const { lines, componentCostTotal, vendorSettlementSubtotal, vendorOrderItems } = resolved;

  const schedule = await validateGiftScheduleFields(
    adminClient,
    gfc.id,
    lines,
    requested_delivery_date,
    occasion_date
  );
  if (schedule.error) return jsonResponse(400, { error: schedule.error });

  const packaging = session.gift_packaging_types;
  const commercialSettings = await loadGiftCommercialSettings(adminClient, gfc.id);
  const packagingFee = Number(packaging.price);
  const shippingFee = Math.max(0, Number(shipping_fee) || 0);

  const pricing = computeCustomerGiftTotal({
    componentCostTotal,
    packagingFee,
    settings: commercialSettings,
    discountAmount: 0,
  });

    let platformDiscount;
    let voucherRow = null;
    let giftVoucherContext = null;
    try {
      const discountResult = await resolvePlatformDiscount({
        customerEmail: customer_email,
        voucher_code,
        giftContextParams: {
          builder_session_token,
          gfc_code,
          gfc_id,
          occasion,
        },
      });
      platformDiscount = discountResult.platformDiscount;
      voucherRow = discountResult.voucher;
      giftVoucherContext = discountResult.giftContext;
  } catch (voucherErr) {
    return jsonResponse(400, { error: voucherErr.message });
  }

  const customerSubtotal = pricing.customerSubtotal;
  const customerTotal = Math.max(customerSubtotal - platformDiscount, 0);
  const totalAmount = customerTotal + shippingFee;
  const paymentReference = generateRef();

  let orderResult;
  try {
    orderResult = await insertGiftCommercialOrder({
      adminClient,
      gfc,
      orderKind: 'gift_custom',
      customer: {
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim().toLowerCase(),
        customer_phone: customer_phone.trim(),
        recipient_address: recipient_address.trim(),
        recipient_city: recipient_city.trim(),
        recipient_state: recipient_state.trim(),
        recipient_zone: recipient_zone.trim(),
      },
      shippingFee,
      customerSubtotal,
      customerTotal,
      platformDiscount,
      pricingBreakdown: {
        ...pricing.pricingBreakdown,
        platform_discount: platformDiscount,
        vendor_settlement_subtotal: vendorSettlementSubtotal,
        voucher_code: voucherRow?.code || null,
      },
      componentCostTotal,
      vendorSettlementSubtotal,
      vendorOrderItems,
      giftLines: lines,
      giftMeta: {
        eventNote: 'Custom gift box order created',
        orderMetadata: {
          gift_builder_session_id: session.id,
          gift_packaging_code: packaging.code,
          voucher_code: voucherRow?.code || null,
        },
        giftOrderRow: {
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
          occasion: occasion?.trim() || null,
          requested_delivery_date: schedule.requested_delivery_date,
          occasion_date: schedule.occasion_date,
          box_sku: giftVoucherContext?.boxSku || null,
        },
      },
      packingChecklistMeta: {
        items: lines.map((line) => ({
          productId: line.product_id,
          variationId: line.variation_id,
          poolSourcedItemId: line.pool_sourced_item_id,
          name: line.name,
          sku: line.sku,
          price: line.vendor_settlement_unit_price,
          quantity: line.quantity,
          total: line.vendor_settlement_subtotal,
          vendorId: line.vendor_id,
          hubId: line.hub_id,
          lineSource: line.line_source,
          customisation: line.customisation_spec?.summary_lines || null,
        })),
        metadata: {
          gift_builder_session_id: session.id,
          gift_packaging: packaging,
        },
      },
      paymentReference,
    });
  } catch (insertErr) {
    return jsonResponse(500, { error: 'Failed to create gift order', detail: insertErr.message });
  }

  if (voucherRow) {
    try {
      await recordGiftVoucherRedemption(adminClient, {
        voucher: voucherRow,
        orderId: orderResult.orderId,
        customerEmail: customer_email.trim().toLowerCase(),
        customerName: customer_name.trim(),
        customerSubtotal,
        discountAmount: platformDiscount,
        vendorSettlementSubtotal,
        orderKind: 'gift_custom',
        giftBoxSku: giftVoucherContext?.boxSku || null,
      });
    } catch (redeemErr) {
      console.error('[create-gift-order] voucher redemption failed:', redeemErr?.message);
    }
  }

  await adminClient
    .from('gift_builder_sessions')
    .update({ status: 'converted', updated_at: new Date().toISOString() })
    .eq('id', session.id);

  await logGiftOrderPlaced({
    orderId: orderResult.orderId,
    orderNumber: orderResult.orderNumber,
    orderKind: 'gift_custom',
    boxSku: giftVoucherContext?.boxSku || null,
    totalAmount,
    voucherCode: voucherRow?.code || null,
    customerEmail: customer_email.trim().toLowerCase(),
    customerName: customer_name.trim(),
  });

  return jsonResponse(201, {
    success: true,
    data: {
      order_id: orderResult.orderId,
      order_number: orderResult.orderNumber,
      payment_reference: paymentReference,
      subtotal: customerSubtotal,
      shipping_fee: shippingFee,
      total_amount: totalAmount,
      platform_discount: platformDiscount,
      component_cost_total: componentCostTotal,
      vendor_settlement_subtotal: vendorSettlementSubtotal,
      voucher_code: voucherRow?.code || null,
      order_kind: 'gift_custom',
      packaging: { code: packaging.code, name: packaging.name },
      gfc: { id: gfc.id, code: gfc.code, name: gfc.name },
      packing_item_count: lines.length,
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
    requested_delivery_date,
    occasion_date,
    shipping_fee = 0,
    voucher_code,
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
  if (!requested_delivery_date?.trim()) missing.push('requested_delivery_date');
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
        requested_delivery_date,
        occasion_date,
        shipping_fee,
        voucher_code,
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
      .select('id, name, slug, sku, list_price, gift_fulfilment_centre_id, active, recipient_types, occasion_types')
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true);

    if (gift_box_id) boxQuery = boxQuery.eq('id', gift_box_id);
    else boxQuery = boxQuery.eq('slug', String(gift_box_slug).trim().toLowerCase());

    const { data: box, error: boxErr } = await boxQuery.maybeSingle();
    if (boxErr) return jsonResponse(500, { error: boxErr.message });
    if (!box) return jsonResponse(404, { error: 'Gift box not found or inactive' });

    const { data: boxItems, error: itemsErr } = await adminClient
      .from('gift_box_items')
      .select(
        'id, product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id, vendor_payout_status'
      )
      .eq('gift_box_id', box.id)
      .order('sort_order', { ascending: true });

    if (itemsErr) return jsonResponse(500, { error: itemsErr.message });
    if (!boxItems?.length) {
      return jsonResponse(400, { error: 'This gift box has no items configured' });
    }

    let resolved;
    try {
      resolved = await resolveBoxItemLines(adminClient, boxItems, gfc.id);
    } catch (resolveErr) {
      return jsonResponse(400, { error: resolveErr.message });
    }

    const { lines, componentCostTotal, vendorSettlementSubtotal, vendorOrderItems } = resolved;

    const schedule = await validateGiftScheduleFields(
      adminClient,
      gfc.id,
      lines,
      requested_delivery_date,
      occasion_date
    );
    if (schedule.error) return jsonResponse(400, { error: schedule.error });

    const commercialSettings = await loadGiftCommercialSettings(adminClient, gfc.id);
    const shippingFee = Math.max(0, Number(shipping_fee) || 0);

    const pricing = computeCustomerGiftTotal({
      componentCostTotal,
      packagingFee: 0,
      settings: commercialSettings,
      discountAmount: 0,
      explicitListPrice: Number(box.list_price),
    });

    let platformDiscount;
    let voucherRow = null;
    let giftVoucherContext = null;
    try {
      const discountResult = await resolvePlatformDiscount({
        customerEmail: customer_email,
        voucher_code,
        giftContextParams: {
          gift_box_id: box.id,
          gfc_code,
          gfc_id,
          occasion,
        },
      });
      platformDiscount = discountResult.platformDiscount;
      voucherRow = discountResult.voucher;
      giftVoucherContext = discountResult.giftContext;
    } catch (voucherErr) {
      return jsonResponse(400, { error: voucherErr.message });
    }

    const customerSubtotal = pricing.customerSubtotal;
    const customerTotal = Math.max(customerSubtotal - platformDiscount, 0);
    const totalAmount = customerTotal + shippingFee;
    const paymentReference = generateRef();

    const packingChecklist = lines.map((line, idx) => ({
      line_source: line.line_source,
      product_id: line.product_id,
      pool_sourced_item_id: line.pool_sourced_item_id,
      name: line.name,
      quantity: line.quantity,
      order_item_id: vendorOrderItems[idx]?.id || null,
    }));

    let orderResult;
    try {
      orderResult = await insertGiftCommercialOrder({
        adminClient,
        gfc,
        orderKind: 'gift_ready_made',
        customer: {
          customer_name: customer_name.trim(),
          customer_email: customer_email.trim().toLowerCase(),
          customer_phone: customer_phone.trim(),
          recipient_address: recipient_address.trim(),
          recipient_city: recipient_city.trim(),
          recipient_state: recipient_state.trim(),
          recipient_zone: recipient_zone.trim(),
        },
        shippingFee,
        customerSubtotal,
        customerTotal,
        platformDiscount,
        pricingBreakdown: {
          ...pricing.pricingBreakdown,
          platform_discount: platformDiscount,
          vendor_settlement_subtotal: vendorSettlementSubtotal,
          voucher_code: voucherRow?.code || null,
        },
        componentCostTotal,
        vendorSettlementSubtotal,
        vendorOrderItems,
        giftLines: lines,
        giftMeta: {
          eventNote: 'Gift order created',
          orderMetadata: {
            gift_box_id: box.id,
            gift_box_slug: box.slug,
            voucher_code: voucherRow?.code || null,
          },
          giftOrderRow: {
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
            requested_delivery_date: schedule.requested_delivery_date,
            occasion_date: schedule.occasion_date,
            box_sku: box.sku || giftVoucherContext?.boxSku || null,
          },
        },
        packingChecklistMeta: {
          items: lines.map((line) => ({
            productId: line.product_id,
            variationId: line.variation_id,
            name: line.name,
            sku: line.sku,
            price: line.vendor_settlement_unit_price,
            quantity: line.quantity,
            total: line.vendor_settlement_subtotal,
            vendorId: line.vendor_id,
            hubId: line.hub_id,
            lineSource: line.line_source,
          })),
          metadata: {
            gift_box_id: box.id,
            gift_box_name: box.name,
            packing_checklist: packingChecklist,
          },
        },
        paymentReference,
      });
    } catch (insertErr) {
      return jsonResponse(500, { error: 'Failed to create gift order', detail: insertErr.message });
    }

    if (voucherRow) {
      try {
        await recordGiftVoucherRedemption(adminClient, {
          voucher: voucherRow,
          orderId: orderResult.orderId,
          customerEmail: customer_email.trim().toLowerCase(),
          customerName: customer_name.trim(),
          customerSubtotal,
          discountAmount: platformDiscount,
          vendorSettlementSubtotal,
          orderKind: 'gift_ready_made',
          giftBoxSku: giftVoucherContext?.boxSku || box.sku || null,
        });
      } catch (redeemErr) {
        console.error('[create-gift-order] voucher redemption failed:', redeemErr?.message);
      }
    }

    await logGiftOrderPlaced({
      orderId: orderResult.orderId,
      orderNumber: orderResult.orderNumber,
      orderKind: 'gift_ready_made',
      boxSku: giftVoucherContext?.boxSku || box.sku || null,
      totalAmount,
      voucherCode: voucherRow?.code || null,
      customerEmail: customer_email.trim().toLowerCase(),
      customerName: customer_name.trim(),
    });

    return jsonResponse(201, {
      success: true,
      data: {
        order_id: orderResult.orderId,
        order_number: orderResult.orderNumber,
        payment_reference: paymentReference,
        subtotal: customerSubtotal,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        platform_discount: platformDiscount,
        voucher_code: voucherRow?.code || null,
        component_cost_total: componentCostTotal,
        vendor_settlement_subtotal: vendorSettlementSubtotal,
        gift_box: { id: box.id, slug: box.slug, name: box.name },
        gfc: { id: gfc.id, code: gfc.code, name: gfc.name },
        packing_item_count: packingChecklist.length,
      },
    });
  } catch (err) {
    return jsonResponse(500, { error: 'Gift order creation failed', message: err?.message || String(err) });
  }
}
