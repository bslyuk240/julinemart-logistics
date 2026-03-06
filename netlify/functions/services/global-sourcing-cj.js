import {
  asFiniteNumber,
  computeWooNgnPricing,
  isPlainObject,
  mergeGlobalSourcingMetadata,
} from './global-sourcing-utils.js';
import { getCjAccessToken, requestCjJson } from './cjAuth.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './pushNotifications.js';

const PROVIDER = 'cj';
const INBOUND_STATUS_AWAITING = 'awaiting_supplier_fulfillment';
const INBOUND_STATUS_CREATED = 'supplier_order_created';

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

function pickHubMetadataValue(metadata, keys) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function resolveCountryName(countryCode, metadata) {
  return (
    pickHubMetadataValue(metadata, ['country_name', 'countryName', 'country']) ||
    process.env.GLOBAL_SOURCING_DEFAULT_COUNTRY_NAME ||
    (countryCode === 'NG' ? 'Nigeria' : null)
  );
}

function resolveDefaultInboundHub(hubs) {
  return (
    hubs.find((hub) => {
      if (hub?.is_default === true) return true;
      const metadata = parseObject(hub.metadata);
      return (
        metadata.default_inbound === true ||
        metadata.is_default_inbound === true ||
        metadata.defaultInbound === true ||
        metadata.isDefaultInbound === true
      );
    }) || null
  );
}

function normalizeReceivingHub(hub) {
  const metadata = parseObject(hub?.metadata);
  const countryCode = (
    pickHubMetadataValue(metadata, ['country_code', 'countryCode']) ||
    process.env.GLOBAL_SOURCING_DEFAULT_COUNTRY_CODE ||
    'NG' ||
    ''
  ).toUpperCase();
  const countryName = resolveCountryName(countryCode, metadata);
  const postcode = pickHubMetadataValue(metadata, ['postcode', 'postal_code', 'zip', 'zip_code']);
  const contactName = pickString(
    hub?.manager_name,
    pickHubMetadataValue(metadata, ['contact_name', 'contactName']),
    hub?.name
  );
  const contactPhone = pickString(
    hub?.manager_phone,
    hub?.phone,
    pickHubMetadataValue(metadata, ['contact_phone', 'contactPhone'])
  );

  if (!hub?.id || !hub?.address || !hub?.city || !hub?.state) {
    throw new Error('Receiving hub is missing address, city, or state required for CJ');
  }

  if (!countryCode) {
    throw new Error(
      'Receiving hub is missing country code. Add metadata.country_code on the hub or set GLOBAL_SOURCING_DEFAULT_COUNTRY_CODE'
    );
  }

  if (!countryName) {
    throw new Error(
      'Receiving hub is missing country name. Add metadata.country_name on the hub or set GLOBAL_SOURCING_DEFAULT_COUNTRY_NAME'
    );
  }

  if (!contactPhone) {
    throw new Error('Receiving hub is missing a contact phone required for CJ order placement');
  }

  return {
    id: hub.id,
    name: hub.name,
    code: hub.code,
    address: hub.address,
    city: hub.city,
    state: hub.state,
    postcode,
    countryCode,
    countryName,
    contactName,
    contactPhone,
    email: pickString(hub.email, pickHubMetadataValue(metadata, ['contact_email', 'contactEmail'])),
    metadata,
  };
}

export async function resolveReceivingHub(client, receivingHubId) {
  if (receivingHubId) {
    const { data: hub, error } = await client
      .from('hubs')
      .select(
        'id, name, code, address, city, state, phone, email, manager_name, manager_phone, metadata, is_active, is_default'
      )
      .eq('id', receivingHubId)
      .single();

    if (error || !hub?.is_active) {
      throw new Error('Selected receiving hub was not found or is inactive');
    }

    return normalizeReceivingHub(hub);
  }

  const { data: hubs, error } = await client
    .from('hubs')
    .select(
      'id, name, code, address, city, state, phone, email, manager_name, manager_phone, metadata, is_active, is_default'
    )
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    throw new Error('Unable to load hubs to resolve a default inbound hub');
  }

  const defaultHub = resolveDefaultInboundHub(hubs || []);
  if (!defaultHub) {
    throw new Error(
      'No receiving_hub_id was provided and no default inbound hub is configured in hub metadata'
    );
  }

  return normalizeReceivingHub(defaultHub);
}

function pickFreightOptions(payload) {
  const candidates = [
    payload?.data?.list,
    payload?.data?.content,
    payload?.data?.items,
    payload?.data,
    payload?.result?.list,
    payload?.result?.content,
    payload?.result?.items,
    payload?.result,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (isPlainObject(candidate)) return [candidate];
  }

  return [];
}

function parseAgingWindow(value) {
  const raw = pickString(value);
  if (!raw) return { minDays: null, maxDays: null, label: null };

  const matches = raw.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!matches) return { minDays: null, maxDays: null, label: raw };

  const minDays = Number(matches[1] || 0) || null;
  const maxDays = Number(matches[2] || matches[1] || 0) || null;
  return { minDays, maxDays, label: raw };
}

function normalizeFreightQuote(payload) {
  const options = pickFreightOptions(payload)
    .map((option) => {
      const shippingUsd =
        asFiniteNumber(option?.logisticPrice) ??
        asFiniteNumber(option?.price) ??
        asFiniteNumber(option?.totalFee) ??
        asFiniteNumber(option?.customerFreight) ??
        asFiniteNumber(option?.freight) ??
        null;

      if (shippingUsd === null) return null;

      const aging = parseAgingWindow(
        option?.logisticAging ?? option?.aging ?? option?.deliveryTime ?? option?.shippingTime
      );

      return {
        shippingUsd,
        carrierName: pickString(option?.logisticName, option?.routeName, option?.name),
        agingLabel: aging.label,
        minDays: aging.minDays,
        maxDays: aging.maxDays,
        raw: option,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.shippingUsd - right.shippingUsd);

  return options[0] || null;
}

export async function quoteCjInboundFreight({
  client,
  receivingHubId,
  externalVariantId,
  quantity = 1,
}) {
  if (!externalVariantId) {
    throw new Error('A CJ variant id is required to request a freight quote');
  }

  const hub = await resolveReceivingHub(client, receivingHubId);
  const token = await getCjAccessToken();
  const result = await requestCjJson({
    pathCandidates: ['/v1/logistic/freightCalculate'],
    method: 'POST',
    accessToken: token.accessToken,
    bodyCandidates: [
      {
        vid: externalVariantId,
        quantity,
        endCountryCode: hub.countryCode,
        zip: hub.postcode || undefined,
      },
    ],
  });

  const quote = normalizeFreightQuote(result.data);
  if (!quote) {
    throw new Error('CJ did not return a usable freight quote for the selected hub and variant');
  }

  return {
    endpoint: result.endpoint,
    receivingHub: hub,
    shippingUsd: quote.shippingUsd,
    carrierName: quote.carrierName,
    agingLabel: quote.agingLabel,
    estimatedInboundDaysMin: quote.minDays,
    estimatedInboundDaysMax: quote.maxDays,
    raw: quote.raw,
  };
}

export async function buildLandedPricingPreview({
  client,
  receivingHubId,
  externalVariantId,
  sourcePrice,
  sourceCurrency = 'USD',
  quantity = 1,
}) {
  const quote = await quoteCjInboundFreight({
    client,
    receivingHubId,
    externalVariantId,
    quantity,
  });

  const pricing = computeWooNgnPricing({
    sourcePrice,
    sourceCurrency,
    inboundShippingUsd: quote.shippingUsd,
  });

  return {
    provider: PROVIDER,
    pricing_mode: 'landed',
    generated_at: new Date().toISOString(),
    receiving_hub_id: quote.receivingHub.id,
    receiving_hub_name: quote.receivingHub.name,
    selected_variant_id: externalVariantId,
    supplier_price_usd: Number(pricing.supplierPriceUsd.toFixed(2)),
    inbound_shipping_quote_usd: Number(pricing.inboundShippingUsd.toFixed(2)),
    import_buffer_usd: Number(pricing.importBufferUsd.toFixed(2)),
    landed_cost_usd: Number(pricing.landedCostUsd.toFixed(2)),
    exchange_rate: pricing.exchangeRate,
    markup_percent: pricing.markupPercent,
    markup_flat_ngn: pricing.markupFlatNgn,
    final_price_ngn: pricing.regularPriceWoo,
    sale_price_ngn: pricing.salePriceWoo,
    estimated_inbound_days_min: quote.estimatedInboundDaysMin,
    estimated_inbound_days_max: quote.estimatedInboundDaysMax,
    carrier_name: quote.carrierName,
    freight_endpoint: quote.endpoint,
  };
}

export function isUsablePricingPreview(preview, { receivingHubId, externalVariantId }) {
  if (!isPlainObject(preview)) return false;
  if (preview.pricing_mode !== 'landed') return false;
  if (pickString(preview.receiving_hub_id) !== pickString(receivingHubId)) return false;
  if (pickString(preview.selected_variant_id) !== pickString(externalVariantId)) return false;

  const generatedAt = Date.parse(String(preview.generated_at || ''));
  if (Number.isNaN(generatedAt)) return false;
  if (generatedAt < Date.now() - 30 * 60 * 1000) return false;

  return (
    asFiniteNumber(preview.supplier_price_usd) !== null &&
    asFiniteNumber(preview.inbound_shipping_quote_usd) !== null &&
    asFiniteNumber(preview.landed_cost_usd) !== null &&
    asFiniteNumber(preview.exchange_rate) !== null &&
    pickString(preview.final_price_ngn) !== null
  );
}

function normalizeSubOrderItems(subOrder) {
  const metadata = parseObject(subOrder?.metadata);
  const sourcing = parseObject(metadata.global_sourcing);
  const sourcingItems = Array.isArray(sourcing.items) ? sourcing.items : [];
  const items = Array.isArray(subOrder?.items) ? subOrder.items : [];

  return sourcingItems
    .map((entry) => {
      const match =
        items.find(
          (item) =>
            pickString(item?.variationId, item?.variation_id) ===
              pickString(entry?.variation_id, entry?.variationId) ||
            (!pickString(entry?.variation_id, entry?.variationId) &&
              pickString(item?.productId, item?.product_id) ===
                pickString(entry?.product_id, entry?.productId))
        ) || null;

      return {
        productId: pickString(entry?.product_id, entry?.productId),
        variationId: pickString(entry?.variation_id, entry?.variationId),
        cjPid: pickString(entry?.cj_pid, entry?.cjPid),
        cjVid: pickString(entry?.cj_vid, entry?.cjVid),
        quantity: Number(entry?.quantity || match?.quantity || 1),
        name: pickString(entry?.name, match?.name),
      };
    })
    .filter((entry) => entry.cjVid && entry.quantity > 0);
}

async function getMainOrder(client, mainOrderId) {
  if (!mainOrderId) return null;

  const { data } = await client.from('orders').select('*').eq('id', mainOrderId).maybeSingle();
  return data || null;
}

async function ensureInboundShipment(client, subOrder, wooOrderId) {
  const { data: existing } = await client
    .from('cj_inbound_shipments')
    .select('*')
    .eq('sub_order_id', subOrder.id)
    .maybeSingle();

  if (existing) return existing;

  const metadata = parseObject(subOrder.metadata);
  const sourcing = parseObject(metadata.global_sourcing);
  const items = Array.isArray(sourcing.items) ? sourcing.items : [];
  const primaryItem = items[0] || {};

  const { data, error } = await client
    .from('cj_inbound_shipments')
    .insert({
      woo_order_id: pickString(wooOrderId),
      sub_order_id: subOrder.id,
      vendor_id: subOrder.vendor_id || null,
      hub_id: sourcing.receiving_hub_id || subOrder.hub_id || null,
      provider: sourcing.provider || PROVIDER,
      cj_order_id: sourcing.cj_order_id || null,
      cj_pid: pickString(primaryItem.cj_pid, primaryItem.cjPid),
      cj_vid: pickString(primaryItem.cj_vid, primaryItem.cjVid),
      inbound_tracking_number: sourcing.inbound_tracking_number || null,
      inbound_status: sourcing.inbound_status || INBOUND_STATUS_AWAITING,
      metadata: {
        source: 'global_sourcing_phase_2',
        items,
      },
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

function parseCreatedOrder(payload) {
  const candidates = [
    payload?.data,
    payload?.result,
    payload,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate[0]) {
      return parseCreatedOrder(candidate[0]);
    }
    if (isPlainObject(candidate)) {
      const orderId = pickString(
        candidate.orderId,
        candidate.id,
        candidate.order_id,
        candidate.orderNumber,
        candidate.cjOrderId
      );
      if (orderId) {
        return {
          cjOrderId: orderId,
          supplierStatus: pickString(candidate.orderStatus, candidate.status),
          trackingNumber: pickString(
            candidate.trackNumber,
            candidate.trackingNumber,
            candidate.logisticTrackNumber
          ),
          raw: candidate,
        };
      }
    }
  }

  return null;
}

function buildCreateOrderPayload({ subOrder, orderRecord, receivingHub, sourcedItems }) {
  const orderReference =
    pickString(orderRecord?.woocommerce_order_id, orderRecord?.id) || pickString(subOrder?.id);

  const payload = {
    orderNumber: `JLO-${orderReference}-${String(subOrder.id).slice(0, 8)}`,
    shippingCountryCode: receivingHub.countryCode,
    shippingCountry: receivingHub.countryName,
    shippingState: receivingHub.state,
    shippingCity: receivingHub.city,
    shippingAddress: receivingHub.address,
    shippingZip: receivingHub.postcode || '',
    shippingName: receivingHub.contactName,
    shippingPhone: receivingHub.contactPhone,
    products: sourcedItems.map((item) => ({
      vid: item.cjVid,
      quantity: item.quantity,
    })),
    remark: `JulineMart hub inbound order for Woo ${orderReference}`,
  };

  if (receivingHub.email) {
    payload.shippingEmail = receivingHub.email;
  }

  return payload;
}

async function ensureTrackingEvent(client, payload) {
  const { data: existing } = await client
    .from('tracking_events')
    .select('id')
    .eq('sub_order_id', payload.sub_order_id)
    .eq('source', payload.source)
    .eq('description', payload.description)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing;

  const { data, error } = await client.from('tracking_events').insert(payload).select('id').maybeSingle();
  if (error) throw error;
  return data || null;
}

async function recordSupplierOrderTracking(client, subOrder, shipment, orderRecord, cjOrderId) {
  const now = new Date().toISOString();

  await ensureTrackingEvent(client, {
    sub_order_id: subOrder.id,
    status: subOrder.status || 'pending',
    description: 'Supplier order confirmed. Item is being shipped to JulineMart hub.',
    location_name: shipment?.hub_id ? 'Supplier Network' : 'Global Sourcing',
    event_time: now,
    actor_type: 'system',
    source: 'global_sourcing',
    metadata: {
      provider: PROVIDER,
      inbound_status: INBOUND_STATUS_CREATED,
      cj_order_id: cjOrderId,
    },
  });

  if (!orderRecord) return;

  const customerId = extractCustomerIdFromOrder(orderRecord);
  const orderRef = extractOrderReference(orderRecord) || pickString(shipment?.woo_order_id, subOrder.id);
  const deepLink = buildOrderDeepLink(orderRef);
  const pushResult = await sendPushToCustomer(customerId, {
    title: 'Supplier order confirmed',
    message: `Your order ${orderRef} is being shipped to the JulineMart hub.`,
    type: 'order_update',
    data: {
      status: INBOUND_STATUS_CREATED,
      orderReference: String(orderRef),
      cjOrderId,
      ...(deepLink ? { deepLink } : {}),
    },
  });

  if (!pushResult.success && !pushResult.skipped) {
    console.warn('Global sourcing supplier-order push failed:', pushResult);
  }
}

async function reconcileExistingSupplierOrderState({
  client,
  subOrder,
  inboundShipment,
  sourcing,
  receivingHubId,
  cjOrderId,
  trackingNumber = null,
  supplierStatus = null,
  triggerSource = 'webhook',
}) {
  const nextMetadata = mergeGlobalSourcingMetadata(subOrder?.metadata, {
    fulfillment_mode: 'cj_hub',
    global_sourcing: {
      ...sourcing,
      provider: PROVIDER,
      receiving_hub_id: receivingHubId,
      cj_order_id: cjOrderId,
      inbound_status: INBOUND_STATUS_CREATED,
      inbound_tracking_number: trackingNumber || sourcing.inbound_tracking_number || null,
      supplier_order_created_at:
        sourcing.supplier_order_created_at || new Date().toISOString(),
      last_order_create_source: triggerSource,
    },
  });

  const shipmentMetadata = {
    ...(parseObject(inboundShipment?.metadata) || {}),
    last_order_create_source: triggerSource,
  };

  const { error: subOrderError } = await client
    .from('sub_orders')
    .update({ metadata: nextMetadata })
    .eq('id', subOrder.id);

  if (subOrderError) throw subOrderError;

  const shipmentUpdate = {
    cj_order_id: cjOrderId,
    inbound_tracking_number:
      trackingNumber || inboundShipment?.inbound_tracking_number || null,
    inbound_status: INBOUND_STATUS_CREATED,
    supplier_status: supplierStatus || inboundShipment?.supplier_status || 'created',
    metadata: shipmentMetadata,
  };

  if (inboundShipment?.id) {
    const { error: shipmentError } = await client
      .from('cj_inbound_shipments')
      .update(shipmentUpdate)
      .eq('id', inboundShipment.id);
    if (shipmentError) throw shipmentError;
  } else {
    const { error: shipmentError } = await client.from('cj_inbound_shipments').insert({
      woo_order_id: pickString(inboundShipment?.woo_order_id),
      sub_order_id: subOrder.id,
      vendor_id: subOrder.vendor_id || null,
      hub_id: receivingHubId || subOrder.hub_id || null,
      provider: PROVIDER,
      cj_order_id: cjOrderId,
      cj_pid: null,
      cj_vid: null,
      inbound_tracking_number: trackingNumber || null,
      inbound_status: INBOUND_STATUS_CREATED,
      supplier_status: supplierStatus || 'created',
      metadata: shipmentMetadata,
    });
    if (shipmentError) throw shipmentError;
  }

  return nextMetadata;
}

async function logGlobalSourcingFailure(client, { wooOrderId, subOrderId, phase, error }) {
  const details = {
    sub_order_id: subOrderId,
    phase,
    message: error?.message || 'Unknown Global Sourcing error',
    details: error?.details || error?.responseBody || null,
  };

  await client.from('webhook_errors').insert({
    woocommerce_order_id: pickString(wooOrderId),
    error_message: details.message,
    payload: details,
  });
}

export async function createCjOrderForSubOrder({
  client,
  subOrder,
  wooOrderId,
  triggerSource = 'webhook',
}) {
  const metadata = parseObject(subOrder?.metadata);
  const sourcing = parseObject(metadata.global_sourcing);

  if (metadata.fulfillment_mode !== 'cj_hub') {
    return { skipped: true, reason: 'not_cj_hub' };
  }

  if ((sourcing.provider || PROVIDER) !== PROVIDER) {
    return { skipped: true, reason: 'unsupported_provider' };
  }

  const sourcedItems = normalizeSubOrderItems(subOrder);
  if (sourcedItems.length === 0) {
    throw new Error('No CJ variant ids were found for this sourced sub-order');
  }

  const inboundShipment = await ensureInboundShipment(client, subOrder, wooOrderId);
  const existingCjOrderId = pickString(sourcing.cj_order_id, inboundShipment?.cj_order_id);
  if (existingCjOrderId) {
    await reconcileExistingSupplierOrderState({
      client,
      subOrder,
      inboundShipment,
      sourcing,
      receivingHubId: pickString(sourcing.receiving_hub_id, inboundShipment?.hub_id, subOrder.hub_id),
      cjOrderId: existingCjOrderId,
      trackingNumber: pickString(
        sourcing.inbound_tracking_number,
        inboundShipment?.inbound_tracking_number
      ),
      supplierStatus: inboundShipment?.supplier_status || null,
      triggerSource,
    });
    return {
      success: true,
      skipped: true,
      reason: 'already_created',
      cjOrderId: existingCjOrderId,
    };
  }

  const receivingHub = await resolveReceivingHub(
    client,
    pickString(sourcing.receiving_hub_id, subOrder.hub_id)
  );

  const orderRecord = await getMainOrder(client, subOrder.main_order_id);
  const accessToken = (await getCjAccessToken()).accessToken;
  const payload = buildCreateOrderPayload({
    subOrder,
    orderRecord,
    receivingHub,
    sourcedItems,
  });
  const result = await requestCjJson({
    pathCandidates: ['/v1/shopping/order/createOrderV3', '/v1/shopping/order/createOrderV2'],
    method: 'POST',
    accessToken,
    bodyCandidates: [payload],
  });

  const createdOrder = parseCreatedOrder(result.data);
  if (!createdOrder?.cjOrderId) {
    throw new Error('CJ order creation succeeded but no CJ order id was returned');
  }

  await reconcileExistingSupplierOrderState({
    client,
    subOrder,
    inboundShipment,
    sourcing,
    receivingHubId: receivingHub.id,
    cjOrderId: createdOrder.cjOrderId,
    trackingNumber: createdOrder.trackingNumber || null,
    supplierStatus: createdOrder.supplierStatus || 'created',
    triggerSource,
  });

  const { data: updatedShipment, error: shipmentError } = await client
    .from('cj_inbound_shipments')
    .update({
      carrier_name: inboundShipment.carrier_name || null,
      metadata: {
        ...(parseObject(inboundShipment.metadata) || {}),
        last_order_create_source: triggerSource,
        order_payload: {
          orderNumber: payload.orderNumber,
          products: payload.products,
        },
        order_response: createdOrder.raw,
      },
    })
    .eq('id', inboundShipment.id)
    .select('*')
    .single();

  if (shipmentError) throw shipmentError;

  await recordSupplierOrderTracking(
    client,
    subOrder,
    updatedShipment,
    orderRecord,
    createdOrder.cjOrderId
  );

  return {
    success: true,
    cjOrderId: createdOrder.cjOrderId,
    shipment: updatedShipment,
  };
}

export async function autoCreateCjOrdersForSubOrders({
  client,
  subOrders,
  wooOrderId,
}) {
  const results = [];
  for (const subOrder of subOrders) {
    const metadata = parseObject(subOrder?.metadata);
    if (metadata.fulfillment_mode !== 'cj_hub') continue;

    try {
      const result = await createCjOrderForSubOrder({
        client,
        subOrder,
        wooOrderId,
        triggerSource: 'woocommerce_webhook',
      });
      results.push({ subOrderId: subOrder.id, ...result });
    } catch (error) {
      await logGlobalSourcingFailure(client, {
        wooOrderId,
        subOrderId: subOrder.id,
        phase: 'create_cj_supplier_order',
        error,
      });

      const nextMetadata = mergeGlobalSourcingMetadata(metadata, {
        fulfillment_mode: 'cj_hub',
        global_sourcing: {
          ...parseObject(metadata.global_sourcing),
          inbound_status: INBOUND_STATUS_AWAITING,
          last_order_create_error: {
            message: error?.message || 'Unknown CJ order creation error',
            details: error?.details || error?.responseBody || null,
            at: new Date().toISOString(),
          },
        },
      });

      await client.from('sub_orders').update({ metadata: nextMetadata }).eq('id', subOrder.id);
      await client
        .from('cj_inbound_shipments')
        .update({
          metadata: {
            ...parseObject(
              (
                await client
                  .from('cj_inbound_shipments')
                  .select('metadata')
                  .eq('sub_order_id', subOrder.id)
                  .maybeSingle()
              ).data?.metadata
            ),
            last_order_create_error: {
              message: error?.message || 'Unknown CJ order creation error',
              details: error?.details || error?.responseBody || null,
              at: new Date().toISOString(),
            },
          },
        })
        .eq('sub_order_id', subOrder.id);

      results.push({
        subOrderId: subOrder.id,
        success: false,
        error: error?.message || 'Unable to create CJ order',
      });
    }
  }

  return results;
}
