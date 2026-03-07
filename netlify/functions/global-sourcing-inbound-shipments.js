import {
  headers,
  jsonResponse,
  mergeGlobalSourcingMetadata,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import { createCjOrderForSubOrder } from './services/global-sourcing-cj.js';
import { getCjAccessToken, requestCjJson } from './services/cjAuth.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';
import { refreshOverallOrderStatus } from './helpers/orderStatusHelper.js';

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
    const nextSubOrderStatus =
      subOrder.status && subOrder.status !== 'pending' ? subOrder.status : 'assigned';
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
      .update({
        metadata: nextMetadata,
        status: nextSubOrderStatus,
        last_tracking_update: now,
      })
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
        status: nextSubOrderStatus,
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
      await refreshOverallOrderStatus(client, subOrder.main_order_id);
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

function mapCjTrackingToInboundStatus(trackingStatus, currentStatus) {
  if (currentStatus === 'received_at_hub') {
    return currentStatus;
  }

  const normalized = String(trackingStatus || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return currentStatus || 'supplier_order_created';
  }

  if (normalized.includes('deliver')) {
    return 'supplier_delivered';
  }
  if (normalized.includes('transit')) {
    return 'supplier_in_transit';
  }
  if (normalized.includes('ship')) {
    return 'supplier_shipped';
  }

  return currentStatus || 'supplier_order_created';
}

function parseCjTrackingRecord(payload) {
  const records = Array.isArray(payload?.data) ? payload.data : [];
  return records[0] || null;
}

async function refreshCjTracking(client, shipmentId) {
  const now = new Date().toISOString();
  const { data: shipment, error: shipmentError } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      *,
      hubs ( id, name, code ),
      sub_orders ( id, status, main_order_id, metadata, last_tracking_update )
    `
    )
    .eq('id', shipmentId)
    .single();

  if (shipmentError || !shipment) {
    throw new Error('Inbound shipment not found');
  }

  const currentMetadata =
    shipment.sub_orders?.metadata && typeof shipment.sub_orders.metadata === 'object'
      ? shipment.sub_orders.metadata
      : {};
  const currentSourcing =
    currentMetadata.global_sourcing && typeof currentMetadata.global_sourcing === 'object'
      ? currentMetadata.global_sourcing
      : {};

  const trackingNumber =
    shipment.inbound_tracking_number ||
    currentSourcing.inbound_tracking_number ||
    null;

  if (!trackingNumber) {
    throw new Error('No CJ tracking number is available for this inbound shipment');
  }

  const { accessToken } = await getCjAccessToken();
  const result = await requestCjJson({
    pathCandidates: ['/v1/logistic/trackInfo', '/logistic/trackInfo'],
    method: 'GET',
    accessToken,
    queryCandidates: [{ trackNumber: trackingNumber }],
  });

  const tracking = parseCjTrackingRecord(result.data);
  if (!tracking) {
    throw new Error('CJ tracking lookup succeeded but returned no tracking data');
  }

  const nextInboundStatus = mapCjTrackingToInboundStatus(
    tracking.trackingStatus,
    shipment.inbound_status
  );

  const shipmentMetadata =
    shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : {};

  const updatePayload = {
    inbound_tracking_number: tracking.trackingNumber || shipment.inbound_tracking_number || null,
    supplier_status: tracking.trackingStatus || shipment.supplier_status || null,
    carrier_name:
      tracking.lastMileCarrier ||
      tracking.logisticName ||
      shipment.carrier_name ||
      null,
    estimated_arrival_at: tracking.deliveryTime || shipment.estimated_arrival_at || null,
    inbound_status: nextInboundStatus,
    updated_at: now,
    metadata: {
      ...shipmentMetadata,
      last_tracking_refresh_at: now,
      tracking_response: tracking,
      logistic_name: tracking.logisticName || null,
      tracking_from: tracking.trackingFrom || null,
      tracking_to: tracking.trackingTo || null,
      last_mile_tracking_number: tracking.lastTrackNumber || null,
      delivery_day: tracking.deliveryDay || null,
    },
  };

  const { data: updatedShipment, error: updateError } = await client
    .from('cj_inbound_shipments')
    .update(updatePayload)
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

  if (shipment.sub_orders?.id) {
    const nextMetadata = mergeGlobalSourcingMetadata(currentMetadata, {
      fulfillment_mode: 'cj_hub',
      global_sourcing: {
        ...currentSourcing,
        provider: updatedShipment.provider || 'cj',
        cj_order_id: updatedShipment.cj_order_id || null,
        receiving_hub_id: updatedShipment.hub_id || null,
        inbound_status: nextInboundStatus,
        inbound_tracking_number:
          updatePayload.inbound_tracking_number || currentSourcing.inbound_tracking_number || null,
        supplier_status: updatePayload.supplier_status || null,
        carrier_name: updatePayload.carrier_name || null,
        estimated_arrival_at: updatePayload.estimated_arrival_at || null,
        last_mile_tracking_number: tracking.lastTrackNumber || null,
      },
    });

    const { error: subOrderUpdateError } = await client
      .from('sub_orders')
      .update({
        metadata: nextMetadata,
        last_tracking_update: now,
      })
      .eq('id', shipment.sub_orders.id);

    if (subOrderUpdateError) throw subOrderUpdateError;
  }

  return updatedShipment;
}

async function deleteInboundTestOrder(client, shipmentId) {
  const { data: shipment, error: shipmentError } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      id,
      woo_order_id,
      cj_order_id,
      sub_order_id,
      inbound_status,
      sub_orders ( id, main_order_id )
    `
    )
    .eq('id', shipmentId)
    .single();

  if (shipmentError || !shipment) {
    throw new Error('Inbound shipment not found');
  }

  if (shipment.cj_order_id) {
    throw new Error('Only test inbound shipments without a CJ supplier order can be deleted');
  }

  const linkedSubOrder = shipment.sub_orders;
  const mainOrderId = linkedSubOrder?.main_order_id || null;

  if (mainOrderId) {
    const { count, error: countError } = await client
      .from('sub_orders')
      .select('id', { count: 'exact', head: true })
      .eq('main_order_id', mainOrderId);

    if (countError) throw countError;
    if ((count || 0) > 1) {
      throw new Error(
        'This inbound shipment belongs to an order with multiple shipments and cannot be deleted from this test-only action'
      );
    }
  }

  const { error: deleteShipmentError } = await client
    .from('cj_inbound_shipments')
    .delete()
    .eq('id', shipmentId);

  if (deleteShipmentError) throw deleteShipmentError;

  if (mainOrderId) {
    const { error: deleteOrderError } = await client
      .from('orders')
      .delete()
      .eq('id', mainOrderId);

    if (deleteOrderError) throw deleteOrderError;
  } else if (linkedSubOrder?.id) {
    const { error: deleteSubOrderError } = await client
      .from('sub_orders')
      .delete()
      .eq('id', linkedSubOrder.id);

    if (deleteSubOrderError) throw deleteSubOrderError;
  }

  return {
    shipment_id: shipmentId,
    woo_order_id: shipment.woo_order_id || null,
    deleted_main_order_id: mainOrderId,
    deleted_sub_order_id: linkedSubOrder?.id || null,
  };
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

      if (payload.action === 'refresh_cj_tracking') {
        const shipment = await refreshCjTracking(auth.adminClient, payload.shipment_id);
        return jsonResponse(200, { success: true, data: shipment });
      }

      if (payload.action === 'delete_test_inbound') {
        const result = await deleteInboundTestOrder(auth.adminClient, payload.shipment_id);
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
