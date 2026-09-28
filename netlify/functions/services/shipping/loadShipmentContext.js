import { FEZ_SUB_ORDER_SELECT } from './fezCreateCore.js';
import { resolvePackageInfo } from './packageInfo.js';
import { resolveSender } from '../resolveSender.js';

export async function loadShipmentContext(supabase, subOrderId) {
  const { data: subOrder, error } = await supabase
    .from('sub_orders')
    .select(FEZ_SUB_ORDER_SELECT)
    .eq('id', subOrderId)
    .single();

  if (error || !subOrder) {
    return { ok: false, statusCode: 404, error: 'Sub-order not found' };
  }

  const packageInfo = await resolvePackageInfo(supabase, subOrder);
  const sender = resolveSender(subOrder);
  const order = subOrder.orders || {};
  const customerCharge = Number(subOrder.allocated_shipping_fee || order.shipping_fee_paid || 0);
  const booked = Boolean(
    subOrder.fulfilment_provider
    || (subOrder.courier_shipment_id && subOrder.tracking_number && !/^JLO-[A-Z0-9]{6,10}$/i.test(subOrder.tracking_number)),
  );

  return {
    ok: true,
    subOrder,
    packageInfo,
    sender,
    customerCharge,
    booked,
    summary: {
      order_id: order.id || subOrder.order_id,
      order_number: order.order_number,
      origin: {
        name: sender.name,
        address: sender.address,
        city: sender.city,
        state: sender.state,
      },
      destination: {
        name: order.customer_name,
        address: order.delivery_address,
        city: order.delivery_city,
        state: order.delivery_state,
      },
      package: {
        weight: packageInfo.weight,
        length: packageInfo.length,
        width: packageInfo.width,
        height: packageInfo.height,
        quantity: packageInfo.quantity,
        declared_value: packageInfo.declared_value,
        ready: packageInfo.ready,
        missing: packageInfo.missing,
      },
      customer_shipping_charge: customerCharge,
      shipment_status: booked ? 'booked' : 'not_booked',
      fulfilment_provider: subOrder.fulfilment_provider,
      fulfilment_courier_name: subOrder.fulfilment_courier_name,
      fulfilment_service_name: subOrder.fulfilment_service_name,
      tracking_number: subOrder.jlo_tracking_number || subOrder.tracking_number,
      courier_shipment_id: subOrder.courier_shipment_id,
      courier_tracking_url: subOrder.courier_tracking_url,
      waybill_url: subOrder.provider_metadata?.shipbubble?.waybill_url || subOrder.courier_waybill,
      carrier_cost: subOrder.carrier_cost,
      shipping_margin: subOrder.shipping_margin,
      quotes_requested_at: subOrder.quotes_requested_at,
      quotes_expires_at: subOrder.quotes_expires_at,
      selected_lane: subOrder.metadata?.selected_lane || 'fez',
    },
  };
}
