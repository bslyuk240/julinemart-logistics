import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  isPlainObject,
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

const PROVIDER_CJ = 'cj';
const SUPPLIER_ORDER_MODE_AUTOMATIC = 'automatic';
const SUPPLIER_ORDER_MODE_MANUAL = 'manual';
const SUPPLIER_ORDER_STATUS_AWAITING = 'awaiting_supplier_order';
const SUPPLIER_ORDER_STATUS_PLACED = 'supplier_order_placed';
const SUPPLIER_ORDER_STATUS_SHIPPED = 'supplier_shipped';
const SUPPLIER_ORDER_STATUS_RECEIVED = 'received_at_hub';
const LEGACY_INBOUND_STATUS_AWAITING = 'awaiting_supplier_fulfillment';
const LEGACY_INBOUND_STATUS_CREATED = 'supplier_order_created';

function parseObject(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function pickString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function pickOptionalText(value) {
  return pickString(value) || null;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => pickString(value))
        .filter(Boolean)
    )
  );
}

function normalizeIsoDateTime(value) {
  const normalized = pickString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('ordered_at must be a valid date/time');
  }
  return parsed.toISOString();
}

function extractShipmentMetadata(shipment) {
  return parseObject(shipment?.metadata);
}

function extractSubOrderMetadata(shipment) {
  return parseObject(shipment?.sub_orders?.metadata);
}

function extractShipmentSourcing(shipment) {
  const subOrderMetadata = extractSubOrderMetadata(shipment);
  return parseObject(subOrderMetadata.global_sourcing);
}

function extractShipmentItems(shipment) {
  const sourcing = extractShipmentSourcing(shipment);
  if (Array.isArray(sourcing.items) && sourcing.items.length > 0) {
    return sourcing.items.filter((item) => isPlainObject(item));
  }

  const shipmentMetadata = extractShipmentMetadata(shipment);
  if (Array.isArray(shipmentMetadata.items) && shipmentMetadata.items.length > 0) {
    return shipmentMetadata.items.filter((item) => isPlainObject(item));
  }

  return [];
}

function resolveShipmentItem(shipment) {
  const shipmentCjVid = pickString(shipment?.cj_vid);
  const shipmentCjPid = pickString(shipment?.cj_pid);
  const items = extractShipmentItems(shipment);

  const exactVariant = items.find(
    (item) => pickString(item?.cj_vid, item?.cjVid) === shipmentCjVid && shipmentCjVid
  );
  if (exactVariant) return exactVariant;

  const exactProduct = items.find(
    (item) => pickString(item?.cj_pid, item?.cjPid) === shipmentCjPid && shipmentCjPid
  );
  if (exactProduct) return exactProduct;

  return items[0] || {};
}

function getShipmentQuantity(shipment) {
  const item = resolveShipmentItem(shipment);
  const quantity = Number(item?.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getShipmentSupplierOrderMode(shipment) {
  return (
    pickString(shipment?.supplier_order_mode, extractShipmentSourcing(shipment)?.supplier_order_mode) ||
    SUPPLIER_ORDER_MODE_AUTOMATIC
  );
}

function getShipmentSupplierOrderStatus(shipment) {
  const sourcing = extractShipmentSourcing(shipment);
  const explicit = pickString(shipment?.supplier_order_status, sourcing?.supplier_order_status);
  if (explicit) return explicit;
  if (shipment?.received_at_hub_at || shipment?.inbound_status === SUPPLIER_ORDER_STATUS_RECEIVED) {
    return SUPPLIER_ORDER_STATUS_RECEIVED;
  }
  if (
    shipment?.inbound_status === 'supplier_shipped' ||
    shipment?.inbound_status === 'supplier_in_transit' ||
    shipment?.inbound_status === 'supplier_delivered'
  ) {
    return SUPPLIER_ORDER_STATUS_SHIPPED;
  }
  if (shipment?.cj_order_id) {
    return SUPPLIER_ORDER_STATUS_PLACED;
  }
  return SUPPLIER_ORDER_STATUS_AWAITING;
}

function getShipmentProductSnapshot(shipment) {
  const item = resolveShipmentItem(shipment);
  const shipmentMetadata = extractShipmentMetadata(shipment);

  return {
    productId: pickString(item?.product_id, item?.productId),
    variationId: pickString(item?.variation_id, item?.variationId),
    cjPid: pickString(shipment?.cj_pid, item?.cj_pid, item?.cjPid),
    cjVid: pickString(shipment?.cj_vid, item?.cj_vid, item?.cjVid),
    title: pickString(item?.name, shipmentMetadata?.title, shipmentMetadata?.product_title),
    quantity: getShipmentQuantity(shipment),
  };
}

function getShipmentCompatibilityKey(shipment) {
  const provider = pickString(shipment?.provider, extractShipmentSourcing(shipment)?.provider) || PROVIDER_CJ;
  const snapshot = getShipmentProductSnapshot(shipment);
  if (!snapshot.cjPid || !snapshot.cjVid) {
    const reference = pickString(
      shipment?.sub_orders?.tracking_number,
      shipment?.woo_order_id,
      shipment?.id
    );
    throw new Error(
      `Shipment ${reference || 'unknown'} is missing CJ product or variant data and cannot be grouped manually`
    );
  }

  return [provider, snapshot.cjPid, snapshot.cjVid].join(':');
}

function buildManualSupplierOrderState({ shipment, manualOrderId, cjOrderId, orderedAt, notes }) {
  const currentSourcing = extractShipmentSourcing(shipment);
  const nextInboundStatus =
    shipment?.inbound_status === SUPPLIER_ORDER_STATUS_RECEIVED
      ? SUPPLIER_ORDER_STATUS_RECEIVED
      : shipment?.inbound_status && shipment.inbound_status !== LEGACY_INBOUND_STATUS_AWAITING
        ? shipment.inbound_status
        : LEGACY_INBOUND_STATUS_CREATED;

  return {
    shipmentUpdate: {
      cj_order_id: cjOrderId,
      inbound_status: nextInboundStatus,
      supplier_order_mode: SUPPLIER_ORDER_MODE_MANUAL,
      supplier_order_status: SUPPLIER_ORDER_STATUS_PLACED,
      manual_supplier_order_id: manualOrderId,
      supplier_ordered_at: orderedAt,
      metadata: {
        ...extractShipmentMetadata(shipment),
        supplier_order_mode: SUPPLIER_ORDER_MODE_MANUAL,
        supplier_order_status: SUPPLIER_ORDER_STATUS_PLACED,
        manual_supplier_order: {
          id: manualOrderId,
          provider: PROVIDER_CJ,
          cj_order_id: cjOrderId,
          ordered_at: orderedAt,
          status: SUPPLIER_ORDER_STATUS_PLACED,
          notes: notes || null,
        },
      },
    },
    subOrderMetadata: mergeGlobalSourcingMetadata(shipment?.sub_orders?.metadata, {
      fulfillment_mode: 'cj_hub',
      global_sourcing: {
        ...currentSourcing,
        provider: PROVIDER_CJ,
        cj_order_id: cjOrderId,
        receiving_hub_id: pickString(currentSourcing.receiving_hub_id, shipment?.hub_id),
        inbound_status: nextInboundStatus,
        supplier_order_mode: SUPPLIER_ORDER_MODE_MANUAL,
        supplier_order_status: SUPPLIER_ORDER_STATUS_PLACED,
        manual_supplier_order_id: manualOrderId,
        supplier_ordered_at: orderedAt,
        supplier_order_created_at: pickString(
          currentSourcing.supplier_order_created_at,
          orderedAt,
          new Date().toISOString()
        ),
        last_order_create_source: 'admin_manual_supplier_order',
      },
    }),
  };
}

function buildSupplierOrderMetadataPatch(shipment, overrides = {}) {
  const sourcing = extractShipmentSourcing(shipment);
  return mergeGlobalSourcingMetadata(shipment?.sub_orders?.metadata, {
    fulfillment_mode: 'cj_hub',
    global_sourcing: {
      ...sourcing,
      provider: pickString(shipment?.provider, sourcing.provider) || PROVIDER_CJ,
      cj_order_id: pickString(overrides.cj_order_id, shipment?.cj_order_id, sourcing.cj_order_id),
      receiving_hub_id: pickString(sourcing.receiving_hub_id, shipment?.hub_id),
      inbound_status: pickString(overrides.inbound_status, shipment?.inbound_status, sourcing.inbound_status),
      inbound_tracking_number: pickString(
        overrides.inbound_tracking_number,
        shipment?.inbound_tracking_number,
        sourcing.inbound_tracking_number
      ),
      supplier_status: pickString(overrides.supplier_status, shipment?.supplier_status, sourcing.supplier_status),
      carrier_name: pickString(overrides.carrier_name, shipment?.carrier_name, sourcing.carrier_name),
      estimated_arrival_at:
        overrides.estimated_arrival_at || shipment?.estimated_arrival_at || sourcing.estimated_arrival_at || null,
      last_mile_tracking_number:
        pickString(overrides.last_mile_tracking_number, sourcing.last_mile_tracking_number) || null,
      supplier_order_mode:
        pickString(overrides.supplier_order_mode, shipment?.supplier_order_mode, sourcing.supplier_order_mode) ||
        SUPPLIER_ORDER_MODE_AUTOMATIC,
      supplier_order_status:
        pickString(
          overrides.supplier_order_status,
          shipment?.supplier_order_status,
          sourcing.supplier_order_status
        ) || SUPPLIER_ORDER_STATUS_AWAITING,
      manual_supplier_order_id:
        pickString(
          overrides.manual_supplier_order_id,
          shipment?.manual_supplier_order_id,
          sourcing.manual_supplier_order_id
        ) || null,
      supplier_ordered_at:
        overrides.supplier_ordered_at || shipment?.supplier_ordered_at || sourcing.supplier_ordered_at || null,
    },
  });
}

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
      supplier_order_mode,
      supplier_order_status,
      manual_supplier_order_id,
      supplier_ordered_at,
      metadata,
      sub_orders (
        id,
        tracking_number,
        status,
        main_order_id,
        metadata
      ),
      manual_supplier_orders:manual_supplier_order_id (
        id,
        provider,
        supplier_order_mode,
        cj_order_id,
        ordered_at,
        status,
        notes,
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
  const shipments = data || [];

  // ── Attach product thumbnail images ──────────────────────────────────────
  // Extract product_id / variation_id from each shipment's item snapshot,
  // then batch-fetch thumbnails from product_images.
  const productIds = new Set();
  const variationIds = new Set();
  const snapshotMap = new Map();

  for (const shipment of shipments) {
    const snapshot = getShipmentProductSnapshot(shipment);
    snapshotMap.set(shipment.id, snapshot);
    if (snapshot.productId) productIds.add(snapshot.productId);
    if (snapshot.variationId) variationIds.add(snapshot.variationId);
  }

  // Fetch thumbnails for all referenced products/variations in one query
  const imageByVariationId = new Map();
  const imageByProductId = new Map();

  if (productIds.size > 0) {
    const { data: imgs } = await client
      .from('product_images')
      .select('product_id, variation_id, src, is_thumbnail')
      .in('product_id', Array.from(productIds));

    for (const img of (imgs || [])) {
      if (!img.src) continue;
      if (img.variation_id && img.is_thumbnail) {
        if (!imageByVariationId.has(img.variation_id)) {
          imageByVariationId.set(img.variation_id, img.src);
        }
      } else if (img.product_id && img.is_thumbnail && !img.variation_id) {
        if (!imageByProductId.has(img.product_id)) {
          imageByProductId.set(img.product_id, img.src);
        }
      }
    }

    // Fallback: first non-thumbnail image if no thumbnail found
    for (const img of (imgs || [])) {
      if (!img.src) continue;
      if (img.variation_id && !imageByVariationId.has(img.variation_id)) {
        imageByVariationId.set(img.variation_id, img.src);
      } else if (img.product_id && !img.variation_id && !imageByProductId.has(img.product_id)) {
        imageByProductId.set(img.product_id, img.src);
      }
    }
  }

  return shipments.map((shipment) => {
    const snapshot = snapshotMap.get(shipment.id);
    const product_image =
      (snapshot?.variationId && imageByVariationId.get(snapshot.variationId)) ||
      (snapshot?.productId && imageByProductId.get(snapshot.productId)) ||
      null;
    return { ...shipment, product_image };
  });
}

function validateShipmentForManualSupplierOrder(shipment, compatibilityKey = null) {
  const provider = pickString(shipment?.provider, extractShipmentSourcing(shipment)?.provider) || PROVIDER_CJ;
  const orderMode = getShipmentSupplierOrderMode(shipment);
  const orderStatus = getShipmentSupplierOrderStatus(shipment);

  if (provider !== PROVIDER_CJ) {
    throw new Error('Manual grouping currently supports CJ provider rows only');
  }
  if (shipment?.received_at_hub_at || shipment?.inbound_status === SUPPLIER_ORDER_STATUS_RECEIVED) {
    throw new Error('Received shipments cannot be attached to a manual supplier order');
  }
  if (pickString(shipment?.manual_supplier_order_id)) {
    throw new Error('One or more selected shipments are already linked to another manual supplier order');
  }
  if (orderMode === SUPPLIER_ORDER_MODE_MANUAL) {
    throw new Error('One or more selected shipments are already committed to manual ordering');
  }
  if (pickString(shipment?.cj_order_id)) {
    throw new Error('One or more selected shipments already have a supplier order reference');
  }
  if (orderStatus !== SUPPLIER_ORDER_STATUS_AWAITING) {
    throw new Error(`Shipment is not awaiting supplier ordering (status: ${orderStatus})`);
  }

  const nextCompatibilityKey = getShipmentCompatibilityKey(shipment);
  if (compatibilityKey && nextCompatibilityKey !== compatibilityKey) {
    throw new Error(
      'Selected shipments must match the same provider, CJ product, and CJ variant for manual grouping'
    );
  }

  return nextCompatibilityKey;
}

function deriveManualSupplierOrderStatus(shipments) {
  if (!Array.isArray(shipments) || shipments.length === 0) {
    return SUPPLIER_ORDER_STATUS_PLACED;
  }

  const statuses = shipments.map((shipment) => getShipmentSupplierOrderStatus(shipment));
  if (statuses.every((status) => status === SUPPLIER_ORDER_STATUS_RECEIVED)) {
    return SUPPLIER_ORDER_STATUS_RECEIVED;
  }
  if (statuses.some((status) => status === SUPPLIER_ORDER_STATUS_SHIPPED)) {
    return SUPPLIER_ORDER_STATUS_SHIPPED;
  }
  return SUPPLIER_ORDER_STATUS_PLACED;
}

async function reconcileManualSupplierOrderStatus(client, manualSupplierOrderId) {
  const normalizedId = pickString(manualSupplierOrderId);
  if (!normalizedId) return null;

  const { data: linkedShipments, error: linkedError } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      id,
      inbound_status,
      supplier_order_status,
      received_at_hub_at,
      supplier_order_mode
    `
    )
    .eq('manual_supplier_order_id', normalizedId);

  if (linkedError) throw linkedError;

  const nextStatus = deriveManualSupplierOrderStatus(linkedShipments || []);
  const { error: updateError } = await client
    .from('manual_supplier_orders')
    .update({ status: nextStatus })
    .eq('id', normalizedId);

  if (updateError) throw updateError;
  return nextStatus;
}

async function createManualSupplierOrder(client, payload) {
  const shipmentIds = uniqueStrings(payload?.shipment_ids);
  if (shipmentIds.length === 0) {
    throw new Error('shipment_ids must include at least one inbound shipment');
  }

  const cjOrderId = pickString(payload?.cj_order_id);
  if (!cjOrderId) {
    throw new Error('cj_order_id is required for manual supplier orders');
  }

  const orderedAt = normalizeIsoDateTime(payload?.ordered_at);
  const notes = pickOptionalText(payload?.notes);

  const { data: existingManualOrder, error: existingManualOrderError } = await client
    .from('manual_supplier_orders')
    .select('id')
    .eq('provider', PROVIDER_CJ)
    .eq('cj_order_id', cjOrderId)
    .maybeSingle();

  if (existingManualOrderError) throw existingManualOrderError;
  if (existingManualOrder?.id) {
    throw new Error(`Manual CJ order ${cjOrderId} is already recorded`);
  }

  const { data: shipments, error: shipmentError } = await client
    .from('cj_inbound_shipments')
    .select(
      `
      *,
      sub_orders (
        id,
        main_order_id,
        tracking_number,
        metadata
      )
    `
    )
    .in('id', shipmentIds);

  if (shipmentError) throw shipmentError;
  if (!Array.isArray(shipments) || shipments.length !== shipmentIds.length) {
    throw new Error('One or more selected inbound shipments could not be found');
  }

  let compatibilityKey = null;
  let totalQuantity = 0;
  let primarySnapshot = null;

  for (const shipment of shipments) {
    compatibilityKey = validateShipmentForManualSupplierOrder(shipment, compatibilityKey);
    const snapshot = getShipmentProductSnapshot(shipment);
    totalQuantity += snapshot.quantity || 1;
    if (!primarySnapshot) primarySnapshot = snapshot;
  }

  const now = new Date().toISOString();
  const { data: manualOrder, error: manualOrderError } = await client
    .from('manual_supplier_orders')
    .insert({
      provider: PROVIDER_CJ,
      supplier_order_mode: SUPPLIER_ORDER_MODE_MANUAL,
      cj_order_id: cjOrderId,
      ordered_at: orderedAt,
      status: SUPPLIER_ORDER_STATUS_PLACED,
      notes,
      metadata: {
        shipment_ids: shipmentIds,
        shipment_count: shipments.length,
        total_quantity: totalQuantity,
        product_id: primarySnapshot?.productId || null,
        variation_id: primarySnapshot?.variationId || null,
        cj_pid: primarySnapshot?.cjPid || null,
        cj_vid: primarySnapshot?.cjVid || null,
        product_title: primarySnapshot?.title || null,
        created_from: 'global_sourcing_inbound_shipments',
        saved_at: now,
      },
    })
    .select('*')
    .single();

  if (manualOrderError) throw manualOrderError;

  const manualOrderItems = shipments.map((shipment) => {
    const snapshot = getShipmentProductSnapshot(shipment);
    return {
      manual_supplier_order_id: manualOrder.id,
      cj_inbound_shipment_id: shipment.id,
      sub_order_id: shipment.sub_order_id || shipment.sub_orders?.id || null,
      order_id: shipment.sub_orders?.main_order_id || null,
      product_id: snapshot.productId,
      variation_id: snapshot.variationId,
      cj_pid: snapshot.cjPid,
      cj_vid: snapshot.cjVid,
      quantity: snapshot.quantity || 1,
    };
  });

  const { error: manualOrderItemsError } = await client
    .from('manual_supplier_order_items')
    .insert(manualOrderItems);

  if (manualOrderItemsError) throw manualOrderItemsError;

  for (const shipment of shipments) {
    const nextState = buildManualSupplierOrderState({
      shipment,
      manualOrderId: manualOrder.id,
      cjOrderId,
      orderedAt,
      notes,
    });

    const { error: shipmentUpdateError } = await client
      .from('cj_inbound_shipments')
      .update({
        ...nextState.shipmentUpdate,
        updated_at: now,
      })
      .eq('id', shipment.id);

    if (shipmentUpdateError) throw shipmentUpdateError;

    if (shipment?.sub_orders?.id) {
      const { error: subOrderUpdateError } = await client
        .from('sub_orders')
        .update({
          metadata: nextState.subOrderMetadata,
          last_tracking_update: now,
        })
        .eq('id', shipment.sub_orders.id);

      if (subOrderUpdateError) throw subOrderUpdateError;
    }
  }

  return {
    ...manualOrder,
    shipment_ids: shipmentIds,
    total_quantity: totalQuantity,
  };
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
  if (shipment.inbound_status !== SUPPLIER_ORDER_STATUS_RECEIVED || !shipment.received_at_hub_at) {
    const { data, error: updateError } = await client
      .from('cj_inbound_shipments')
      .update({
        inbound_status: SUPPLIER_ORDER_STATUS_RECEIVED,
        supplier_order_status: SUPPLIER_ORDER_STATUS_RECEIVED,
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
    const nextMetadata = buildSupplierOrderMetadataPatch(
      {
        ...shipment,
        supplier_order_status: updatedShipment.supplier_order_status,
        supplier_order_mode: updatedShipment.supplier_order_mode,
        manual_supplier_order_id: updatedShipment.manual_supplier_order_id,
        supplier_ordered_at: updatedShipment.supplier_ordered_at,
      },
      {
        cj_order_id: updatedShipment.cj_order_id || null,
        inbound_status: SUPPLIER_ORDER_STATUS_RECEIVED,
        inbound_tracking_number: updatedShipment.inbound_tracking_number || null,
        supplier_order_status: SUPPLIER_ORDER_STATUS_RECEIVED,
      }
    );

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
          provider: updatedShipment.provider || PROVIDER_CJ,
          inbound_status: SUPPLIER_ORDER_STATUS_RECEIVED,
          supplier_order_mode: updatedShipment.supplier_order_mode || SUPPLIER_ORDER_MODE_AUTOMATIC,
          supplier_order_status: SUPPLIER_ORDER_STATUS_RECEIVED,
          manual_supplier_order_id: updatedShipment.manual_supplier_order_id || null,
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
              status: SUPPLIER_ORDER_STATUS_RECEIVED,
              orderReference: String(orderRef),
              shipmentId: shipmentId,
              ...(deepLink ? { targetPath: deepLink } : {}),
            },
          });

          if (!pushResult.success && !pushResult.skipped) {
            console.warn('Global sourcing received-at-hub push failed:', pushResult);
          }
        }
      }
    }
  }

  if (updatedShipment.manual_supplier_order_id) {
    await reconcileManualSupplierOrderStatus(client, updatedShipment.manual_supplier_order_id);
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

  if (
    getShipmentSupplierOrderMode(shipment) === SUPPLIER_ORDER_MODE_MANUAL ||
    pickString(shipment.manual_supplier_order_id)
  ) {
    throw new Error(
      'This inbound shipment is already assigned to a manual supplier order and cannot use the automatic path'
    );
  }

  return createCjOrderForSubOrder({
    client,
    subOrder: shipment.sub_orders,
    wooOrderId: shipment.woo_order_id,
    triggerSource: 'admin_retry',
    inboundShipment: shipment,
  });
}

function mapCjTrackingToInboundStatus(trackingStatus, currentStatus) {
  if (currentStatus === SUPPLIER_ORDER_STATUS_RECEIVED) {
    return currentStatus;
  }

  const normalized = String(trackingStatus || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return currentStatus || LEGACY_INBOUND_STATUS_CREATED;
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

  return currentStatus || LEGACY_INBOUND_STATUS_CREATED;
}

function mapCjTrackingToSupplierOrderStatus(trackingStatus, currentStatus) {
  if (currentStatus === SUPPLIER_ORDER_STATUS_RECEIVED) {
    return currentStatus;
  }

  const normalized = String(trackingStatus || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return currentStatus || SUPPLIER_ORDER_STATUS_PLACED;
  }
  if (
    normalized.includes('deliver') ||
    normalized.includes('transit') ||
    normalized.includes('ship')
  ) {
    return SUPPLIER_ORDER_STATUS_SHIPPED;
  }

  return currentStatus || SUPPLIER_ORDER_STATUS_PLACED;
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

  const currentSourcing = extractShipmentSourcing(shipment);
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
  const nextSupplierOrderStatus = mapCjTrackingToSupplierOrderStatus(
    tracking.trackingStatus,
    getShipmentSupplierOrderStatus(shipment)
  );

  const shipmentMetadata = extractShipmentMetadata(shipment);
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
    supplier_order_status: nextSupplierOrderStatus,
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
    const nextMetadata = buildSupplierOrderMetadataPatch(
      {
        ...shipment,
        supplier_order_status: nextSupplierOrderStatus,
      },
      {
        inbound_status: nextInboundStatus,
        inbound_tracking_number: updatePayload.inbound_tracking_number,
        supplier_status: updatePayload.supplier_status,
        carrier_name: updatePayload.carrier_name,
        estimated_arrival_at: updatePayload.estimated_arrival_at,
        last_mile_tracking_number: tracking.lastTrackNumber || null,
        supplier_order_status: nextSupplierOrderStatus,
      }
    );

    const { error: subOrderUpdateError } = await client
      .from('sub_orders')
      .update({
        metadata: nextMetadata,
        last_tracking_update: now,
      })
      .eq('id', shipment.sub_orders.id);

    if (subOrderUpdateError) throw subOrderUpdateError;
  }

  if (updatedShipment.manual_supplier_order_id) {
    await reconcileManualSupplierOrderStatus(client, updatedShipment.manual_supplier_order_id);
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
      manual_supplier_order_id,
      sub_orders ( id, main_order_id )
    `
    )
    .eq('id', shipmentId)
    .single();

  if (shipmentError || !shipment) {
    throw new Error('Inbound shipment not found');
  }

  if (shipment.cj_order_id || shipment.manual_supplier_order_id) {
    throw new Error('Only test inbound shipments without a supplier order can be deleted');
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

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
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

      if (payload.action === 'create_manual_supplier_order') {
        const manualOrder = await createManualSupplierOrder(auth.adminClient, payload);
        return jsonResponse(200, { success: true, data: manualOrder });
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
      details: error?.details || error?.responseBody || null,
    });
  }
}
