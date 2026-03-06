import {
  headers,
  jsonResponse,
  mergeGlobalSourcingMetadata,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import { createCjOrderForSubOrder } from './services/global-sourcing-cj.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';

async function listShipments(client) {
  const { data, error } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      id,
      created_at,
      updated_at,
      woo_order_id,
      sub_order_id,
      vendor_id,
      hub_id,
      provider,
      cj_order_id,
      cj_pid,
      cj_vid,
      inbound_tracking_number,
      supplier_status,
      inbound_status,
      carrier_name,
      estimated_arrival_at,
      received_at_hub_at,
      metadata,
      sub_orders (
        id,
        tracking_number,
        status,
        main_order_id,
        metadata
      ),
      hubs (
        id,
        name,
        code
      ),
      vendors (
        id,
        store_name,
        woocommerce_vendor_id
      )
    `
    )
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function markReceivedAtHub(client, shipmentId) {
  const now = new Date().toISOString();
  const { data: shipment, error: shipmentError } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      *,
      hubs ( id, name, code ),
      sub_orders ( id, status, main_order_id, metadata )
    `
    )
    .eq('id', shipmentId)
    .single();

  if (shipmentError || !shipment) {
    throw new Error('Inbound shipment not found');
  }

  let updatedShipment = shipment;
  if (shipment.inbound_status !== 'received_at_hub' || !shipment.received_at_hub_at) {
    const { data, error: updateError } = await client
      .from('cj_inbound_shipments')
      .update({
        inbound_status: 'received_at_hub',
        received_at_hub_at: now,
        updated_at: now,
      })
      .eq('id', shipmentId)
      .select(
        `
        *,
        hubs ( id, name, code ),
        vendors ( id, store_name, woocommerce_vendor_id )
      `
      )
      .single();

    if (updateError) throw updateError;
    updatedShipment = data;
  }

  const subOrder = shipment.sub_orders;
  if (subOrder?.id) {
    const nextMetadata = mergeGlobalSourcingMetadata(subOrder.metadata, {
      fulfillment_mode: 'cj_hub',
      global_sourcing: {
        provider: updatedShipment.provider || 'cj',
        cj_order_id: updatedShipment.cj_order_id || null,
        receiving_hub_id: updatedShipment.hub_id || null,
        inbound_status: 'received_at_hub',
        inbound_tracking_number: updatedShipment.inbound_tracking_number || null,
      },
    });

    const { error: subOrderError } = await client
      .from('sub_orders')
      .update({ metadata: nextMetadata })
      .eq('id', subOrder.id);

    if (subOrderError) throw subOrderError;

    const { data: existingTracking, error: existingTrackingError } = await client
      .from('tracking_events')
      .select('id')
      .eq('sub_order_id', subOrder.id)
      .eq('source', 'global_sourcing')
      .eq('description', 'Global sourcing shipment received at JulineMart hub')
      .limit(1)
      .maybeSingle();

    if (existingTrackingError) throw existingTrackingError;

    if (!existingTracking?.id) {
      const { error: trackingError } = await client.from('tracking_events').insert({
        sub_order_id: subOrder.id,
        status: subOrder.status || 'pending',
        description: 'Global sourcing shipment received at JulineMart hub',
        location_name: updatedShipment.hubs?.name || 'JulineMart Hub',
        event_time: now,
        actor_type: 'hub',
        source: 'global_sourcing',
        metadata: {
          provider: updatedShipment.provider || 'cj',
          inbound_status: 'received_at_hub',
          cj_order_id: updatedShipment.cj_order_id || null,
          inbound_tracking_number: updatedShipment.inbound_tracking_number || null,
        },
      });

      if (trackingError) throw trackingError;
    }

    if (subOrder.main_order_id) {
      const { data: orderRecord } = await client
        .from('orders')
        .select('*')
        .eq('id', subOrder.main_order_id)
        .maybeSingle();

      if (orderRecord) {
        const customerId = extractCustomerIdFromOrder(orderRecord);
        const orderRef =
          extractOrderReference(orderRecord) || updatedShipment.woo_order_id || subOrder.id;
        const deepLink = buildOrderDeepLink(orderRef);

        if (!existingTracking?.id) {
          const pushResult = await sendPushToCustomer(customerId, {
            title: 'Order received at hub',
            message: `Your order ${orderRef} has been received at the JulineMart hub.`,
            type: 'order_update',
            data: {
              status: 'received_at_hub',
              orderReference: String(orderRef),
              shipmentId: shipmentId,
              ...(deepLink ? { deepLink } : {}),
            },
          });

          if (!pushResult.success && !pushResult.skipped) {
            console.warn('Global sourcing received-at-hub push failed:', pushResult);
          }
        }
      }
    }
  }

  return updatedShipment;
}

async function createSupplierOrder(client, shipmentId) {
  const { data: shipment, error } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      *,
      sub_orders (
        id,
        main_order_id,
        hub_id,
        vendor_id,
        items,
        status,
        tracking_number,
        metadata
      )
    `
    )
    .eq('id', shipmentId)
    .single();

  if (error || !shipment?.sub_orders?.id) {
    throw new Error('Inbound shipment is missing its linked sub-order');
  }

  return createCjOrderForSubOrder({
    client,
    subOrder: shipment.sub_orders,
    wooOrderId: shipment.woo_order_id,
    triggerSource: 'admin_retry',
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    if (event.httpMethod === 'GET') {
      const shipments = await listShipments(auth.adminClient);
      return jsonResponse(200, { success: true, data: shipments });
    }

    if (event.httpMethod === 'POST') {
      const payload = parseJsonBody(event.body);
      if (payload === null) {
        return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
      }

      if (!payload.shipment_id) {
        return jsonResponse(400, {
          success: false,
          error: 'shipment_id is required',
        });
      }

      if (payload.action === 'mark_received_at_hub') {
        const shipment = await markReceivedAtHub(auth.adminClient, payload.shipment_id);
        return jsonResponse(200, { success: true, data: shipment });
      }

      if (payload.action === 'create_supplier_order') {
        const result = await createSupplierOrder(auth.adminClient, payload.shipment_id);
        return jsonResponse(200, { success: true, data: result });
      }

      return jsonResponse(400, {
        success: false,
        error: 'Unsupported action',
      });
    }

    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: 'Global sourcing inbound shipment request failed',
      message: error?.message || 'Unable to complete inbound shipment action',
    });
  }
}
