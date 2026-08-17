/**
 * Persist commercial gift orders: vendor catalog lines + gift fulfilment + audit lines.
 */
import { groupVendorSubOrders } from './gift-commercial.js';

function jloTrackingPlaceholder() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'JLO-';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export async function insertGiftCommercialOrder({
  adminClient,
  gfc,
  orderKind,
  customer,
  shippingFee,
  customerSubtotal,
  customerTotal,
  platformDiscount,
  pricingBreakdown,
  componentCostTotal,
  vendorSettlementSubtotal,
  vendorOrderItems,
  giftLines,
  giftMeta,
  packingChecklistMeta,
  paymentReference,
}) {
  const { data: order, error: orderErr } = await adminClient
    .from('orders')
    .insert({
      order_kind: orderKind,
      customer_name: customer.customer_name,
      customer_email: customer.customer_email,
      customer_phone: customer.customer_phone,
      delivery_address: customer.recipient_address,
      delivery_city: customer.recipient_city,
      delivery_state: customer.recipient_state,
      delivery_zone: customer.recipient_zone,
      subtotal: customerSubtotal,
      total_amount: customerTotal + shippingFee,
      shipping_fee_paid: shippingFee,
      discount_amount: platformDiscount,
      payment_status: 'pending',
      overall_status: 'pending',
      payment_reference: paymentReference,
      fulfillment_method: 'delivery',
      metadata: {
        source: 'pwa_gifts',
        order_kind: orderKind,
        gift_fulfilment_centre_id: gfc.id,
        platform_discount_absorbed: platformDiscount > 0,
        vendor_settlement_subtotal: vendorSettlementSubtotal,
        order_confirmation_handler: 'netlify_create_gift_order',
        ...giftMeta.orderMetadata,
      },
    })
    .select('id, order_number')
    .single();

  if (orderErr) throw new Error(orderErr.message);

  const orderId = order.id;

  const { error: giftErr } = await adminClient.from('gift_orders').insert({
    order_id: orderId,
    ...giftMeta.giftOrderRow,
    component_cost_total: componentCostTotal,
    customer_subtotal: customerSubtotal,
    vendor_settlement_subtotal: vendorSettlementSubtotal,
    platform_discount_amount: platformDiscount,
    pricing_breakdown: pricingBreakdown,
    gift_status: 'new',
  });

  if (giftErr) {
    await adminClient.from('orders').delete().eq('id', orderId);
    throw new Error(giftErr.message);
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
      note: giftMeta.eventNote || 'Gift order created',
    });
  }

  const orderItemIdByIndex = [];
  if (vendorOrderItems.length) {
    const { data: insertedItems, error: oiErr } = await adminClient
      .from('order_items')
      .insert(
        vendorOrderItems.map((i) => ({
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
          metadata: { gift_line_source: 'vendor_catalog', gift_order: true },
        }))
      )
      .select('id');

    if (oiErr) {
      await adminClient.from('orders').delete().eq('id', orderId);
      throw new Error(oiErr.message);
    }
    orderItemIdByIndex.push(...(insertedItems || []).map((r) => r.id));
  }

  if (giftOrderRow?.id && giftLines.length) {
    let vendorIdx = 0;
    const auditRows = giftLines.map((line) => {
      const orderItemId =
        line.line_source === 'vendor_catalog' ? orderItemIdByIndex[vendorIdx++] || null : null;
      return {
        gift_order_id: giftOrderRow.id,
        order_item_id: orderItemId,
        line_source: line.line_source,
        product_id: line.product_id,
        pool_sourced_item_id: line.pool_sourced_item_id,
        vendor_id: line.vendor_id,
        name: line.name,
        sku: line.sku,
        quantity: line.quantity,
        gift_program_cost: line.gift_program_cost,
        vendor_settlement_unit_price: line.vendor_settlement_unit_price,
        vendor_settlement_subtotal: line.vendor_settlement_subtotal,
        vendor_payout_status: line.vendor_payout_status,
        customisation_spec: line.customisation_spec || null,
      };
    });

    const { error: auditErr } = await adminClient.from('gift_order_line_items').insert(auditRows);
    if (auditErr) {
      await adminClient.from('orders').delete().eq('id', orderId);
      throw new Error(auditErr.message);
    }
  }

  const vendorGroups = groupVendorSubOrders(
    vendorOrderItems.map((i) => ({
      ...i,
      product_name: i.product_name,
    }))
  );

  for (const [, group] of vendorGroups) {
    if (!group.vendor_id) continue;
    await adminClient.from('sub_orders').insert({
      main_order_id: orderId,
      vendor_id: group.vendor_id,
      hub_id: group.hub_id,
      courier_id: null,
      tracking_number: jloTrackingPlaceholder(),
      items: group.items,
      subtotal: group.subtotal,
      allocated_shipping_fee: 0,
      status: 'pending',
      metadata: {
        source: orderKind,
        gift_order: true,
        vendor_settlement_only: true,
        gift_fulfilment_centre_id: gfc.id,
      },
    });
  }

  const primaryHubId = vendorOrderItems.find((i) => i.hub_id)?.hub_id || null;

  // Gift boxes ship as one consolidated parcel from the GFC — no single
  // vendor to match, so local rider only needs the GFC and recipient in
  // the same town.
  const gfcCity = (gfc.city || '').trim().toLowerCase();
  const recipientCity = (customer.recipient_city || '').trim().toLowerCase();
  const isLocalEligible = Boolean(gfcCity && recipientCity && gfcCity === recipientCity);

  const { data: giftSubOrder, error: subErr } = await adminClient
    .from('sub_orders')
    .insert({
      main_order_id: orderId,
      vendor_id: null,
      hub_id: primaryHubId,
      courier_id: null,
      tracking_number: jloTrackingPlaceholder(),
      items: packingChecklistMeta.items,
      subtotal: customerSubtotal,
      allocated_shipping_fee: shippingFee,
      status: 'pending',
      metadata: {
        source: orderKind,
        order_kind: orderKind,
        gift_fulfilment_centre_id: gfc.id,
        gift_fulfilment: true,
        selected_lane: isLocalEligible ? 'local_rider' : 'fez',
        eligible_lanes: isLocalEligible ? ['local_rider', 'fez'] : ['fez'],
        ...packingChecklistMeta.metadata,
        component_cost_total: componentCostTotal,
        vendor_settlement_subtotal: vendorSettlementSubtotal,
      },
    })
    .select('id')
    .single();

  if (subErr) {
    await adminClient.from('orders').delete().eq('id', orderId);
    throw new Error(subErr.message);
  }

  if (giftSubOrder?.id) {
    await adminClient.from('tracking_events').insert({
      sub_order_id: giftSubOrder.id,
      status: 'pending',
      description: 'Gift order received — awaiting payment',
      location_name: gfc.name,
      event_time: new Date().toISOString(),
    });
  }

  return { orderId, orderNumber: order.order_number, giftSubOrderId: giftSubOrder?.id };
}
