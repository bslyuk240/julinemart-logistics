import {
  asFiniteNumber,
  computeWooNgnPricing,
  fetchWooProductSourcingContext,
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
const CJ_TRANSIENT_RATE_LIMIT_CODE = 1600200;
const DEFAULT_ORIGIN_COUNTRY_CODE =
  String(
    process.env.GLOBAL_SOURCING_DEFAULT_ORIGIN_COUNTRY_CODE ||
      process.env.CJ_DEFAULT_ORIGIN_COUNTRY_CODE ||
      'CN'
  )
    .trim()
    .toUpperCase() || 'CN';

const SOURCE_REQUEST_STATUS_SUBMITTED = 'submitted';
const SOURCE_REQUEST_STATUS_PROCESSING = 'processing';
const SOURCE_REQUEST_STATUS_READY = 'ready_to_import';
const SOURCE_REQUEST_STATUS_FAILED = 'failed';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchImportJobSourcingContext(client, { productId, variationId, cjPid }) {
  const normalizedProductId = pickString(productId);
  const normalizedCjPid = pickString(cjPid);
  if (!normalizedProductId && !normalizedCjPid) return null;

  const { data, error } = await client
    .from('global_sourcing_import_jobs')
    .select('payload, cursor, result, completed_at, created_at')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  for (const row of data) {
    const payload = parseObject(row?.payload);
    const cursor = parseObject(row?.cursor);
    const result = parseObject(row?.result);
    const rowWooProductId = pickString(
      result?.woo_product_id,
      cursor?.productSummary?.id,
      payload?.woo_product_id
    );

    const rowExternalProductId = pickString(
      payload?.external_product_id,
      payload?.cj_pid,
      result?.external_product_id
    );

    const matchesWooProduct =
      normalizedProductId && rowWooProductId === normalizedProductId;
    const matchesCjProduct =
      normalizedCjPid && rowExternalProductId === normalizedCjPid;

    if (!matchesWooProduct && !matchesCjProduct) {
      continue;
    }

    const importedVariationIds = Array.isArray(result?.woo_variation_ids)
      ? result.woo_variation_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const selectedWooVariationId = pickString(result?.woo_variation_id);
    const selectedCjVid = pickString(
      cursor?.selectedVariantId,
      payload?.external_variant_id,
      payload?.cj_vid
    );
    const resolvedCjPid = rowExternalProductId;
    const carrierName = pickString(
      cursor?.pricingPreview?.carrier_name,
      payload?.pricing_preview?.carrier_name,
      payload?.carrier_name
    );

    if (variationId) {
      if (selectedWooVariationId && selectedWooVariationId === String(variationId).trim()) {
        return {
          cjPid: resolvedCjPid || null,
          cjVid: selectedCjVid || null,
          carrierName: carrierName || null,
        };
      }

      if (importedVariationIds.includes(String(variationId).trim())) {
        return null;
      }
    } else if (selectedCjVid || resolvedCjPid) {
      return {
        cjPid: resolvedCjPid || null,
        cjVid: selectedCjVid || null,
        carrierName: carrierName || null,
      };
    }
  }

  return null;
}

function pickArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }
  return [];
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

function isCjRateLimitError(error) {
  const details = Array.isArray(error?.details) ? error.details : [];
  return details.some((entry) => {
    const status = Number(entry?.status || 0);
    const code = Number(entry?.response?.code || entry?.cjError?.code || 0);
    return status === 429 || code === CJ_TRANSIENT_RATE_LIMIT_CODE;
  });
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
  const requestPayload = {
    startCountryCode: DEFAULT_ORIGIN_COUNTRY_CODE,
    endCountryCode: hub.countryCode,
    zip: hub.postcode || undefined,
    products: [
      {
        vid: externalVariantId,
        quantity,
      },
    ],
  };

  let result;
  try {
    result = await requestCjJson({
      pathCandidates: ['/v1/logistic/freightCalculate'],
      method: 'POST',
      accessToken: token.accessToken,
      bodyCandidates: [requestPayload],
    });
  } catch (error) {
    if (!isCjRateLimitError(error)) {
      throw error;
    }

    await sleep(1200);

    result = await requestCjJson({
      pathCandidates: ['/v1/logistic/freightCalculate'],
      method: 'POST',
      accessToken: token.accessToken,
      bodyCandidates: [requestPayload],
    });
  }

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
  importBufferUsd,
  markupPercent,
  markupFlatNgn,
  usdToNgnRate,
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
    importBufferUsd,
    markupPercent,
    markupFlatNgn,
    usdToNgnRate,
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

async function resolveSubOrderItems(client, subOrder, inboundShipment = null) {
  const metadata = parseObject(subOrder?.metadata);
  const sourcing = parseObject(metadata.global_sourcing);
  const sourcingItems = Array.isArray(sourcing.items) ? sourcing.items : [];
  const items = Array.isArray(subOrder?.items) ? subOrder.items : [];
  let didHydrate = false;
  const sourceEntries =
    sourcingItems.length > 0
      ? sourcingItems
      : items.map((item) => ({
          product_id: pickString(item?.productId, item?.product_id),
          variation_id: pickString(item?.variationId, item?.variation_id),
          cj_pid: pickString(item?.globalSourcing?.cjPid, item?.globalSourcing?.cj_pid),
          cj_vid: pickString(item?.globalSourcing?.cjVid, item?.globalSourcing?.cj_vid),
          quantity: Number(item?.quantity || 1),
          name: pickString(item?.name),
        }));

  const resolvedItems = await Promise.all(
    sourceEntries.map(async (entry) => {
      const match =
        items.find(
          (item) =>
            pickString(item?.variationId, item?.variation_id) ===
              pickString(entry?.variation_id, entry?.variationId) ||
            (!pickString(entry?.variation_id, entry?.variationId) &&
              pickString(item?.productId, item?.product_id) ===
                pickString(entry?.product_id, entry?.productId))
        ) || null;

      const productId = pickString(entry?.product_id, entry?.productId, match?.productId, match?.product_id);
      const variationId = pickString(
        entry?.variation_id,
        entry?.variationId,
        match?.variationId,
        match?.variation_id
      );
      let cjPid = pickString(entry?.cj_pid, entry?.cjPid);
      let cjVid = pickString(entry?.cj_vid, entry?.cjVid);
      let carrierName = pickString(entry?.carrier_name, entry?.carrierName);

      if (!cjPid || !cjVid) {
        cjPid =
          cjPid ||
          pickString(match?.globalSourcing?.cjPid, match?.globalSourcing?.cj_pid);
        cjVid =
          cjVid ||
          pickString(match?.globalSourcing?.cjVid, match?.globalSourcing?.cj_vid);
      }

      if ((!cjPid || !cjVid) && productId) {
        const context = await fetchWooProductSourcingContext({ productId, variationId });
        if (context) {
          cjPid = cjPid || pickString(context.cjPid);
          cjVid = cjVid || pickString(context.cjVid);
          if (cjPid || cjVid) {
            didHydrate = true;
          }
        }
      }

      if ((!cjPid || !cjVid || !carrierName) && (productId || cjPid)) {
        const importContext = await fetchImportJobSourcingContext(client, {
          productId,
          variationId,
          cjPid,
        });
        if (importContext) {
          cjPid = cjPid || pickString(importContext.cjPid);
          cjVid = cjVid || pickString(importContext.cjVid);
          carrierName = carrierName || pickString(importContext.carrierName);
          if (cjPid || cjVid) {
            didHydrate = true;
          }
        }
      }

      return {
        productId: pickString(entry?.product_id, entry?.productId),
        variationId: pickString(entry?.variation_id, entry?.variationId),
        cjPid,
        cjVid,
        carrierName,
        quantity: Number(entry?.quantity || match?.quantity || 1),
        name: pickString(entry?.name, match?.name),
      };
    })
  );

  const hydratedMetadata = didHydrate
    ? mergeGlobalSourcingMetadata(metadata, {
        global_sourcing: {
          ...sourcing,
          items: resolvedItems.map((entry) => ({
            product_id: entry.productId,
            variation_id: entry.variationId,
            cj_pid: entry.cjPid || null,
            cj_vid: entry.cjVid || null,
            carrier_name: entry.carrierName || null,
            quantity: entry.quantity || 1,
            name: entry.name || null,
          })),
        },
      })
    : null;

  const fallbackShipmentItem =
    resolvedItems.filter((entry) => entry.cjVid && entry.quantity > 0).length === 0 &&
    pickString(inboundShipment?.cj_vid)
      ? [
          {
            productId: pickString(inboundShipment?.cj_pid),
            variationId: null,
            cjPid: pickString(inboundShipment?.cj_pid),
            cjVid: pickString(inboundShipment?.cj_vid),
            carrierName: pickString(inboundShipment?.carrier_name),
            quantity: 1,
            name: pickString(inboundShipment?.metadata?.title, inboundShipment?.provider),
          },
        ]
      : [];

  return {
    items:
      resolvedItems.filter((entry) => entry.cjVid && entry.quantity > 0).length > 0
        ? resolvedItems.filter((entry) => entry.cjVid && entry.quantity > 0)
        : fallbackShipmentItem,
    hydratedMetadata,
  };
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

function extractCjSourcingRows(payload) {
  return pickArray(
    payload?.data?.list,
    payload?.data?.records,
    payload?.data?.items,
    payload?.data?.dataList,
    payload?.data?.content,
    payload?.data,
    payload?.result?.list,
    payload?.result?.records,
    payload?.result?.items,
    payload?.result,
    payload?.list,
    payload?.records,
    payload?.items,
    payload
  ).filter((entry) => isPlainObject(entry));
}

function normalizeCjSourcingRecord(record) {
  if (!isPlainObject(record)) return null;

  return {
    cjRequestId: pickString(
      record.cjSourcingId,
      record.cj_sourcing_id,
      record.sourceId,
      record.source_id,
      record.id,
      record.sourceNumber,
      record.source_number
    ),
    sourceNumber: pickString(record.sourceNumber, record.source_number),
    sourceStatus: pickString(record.sourceStatus, record.status, record.state),
    sourceStatusLabel: pickString(
      record.sourceStatusStr,
      record.sourceStatusText,
      record.statusText,
      record.statusLabel
    ),
    cjPid: pickString(record.cjProductId, record.cj_pid),
    cjVid: pickString(record.cjVid, record.cjVariantId, record.cj_variant_id),
    cjVariantSku: pickString(record.cjVariantSku, record.cj_variant_sku, record.variantSku, record.sku),
    resolvedProductTitle: pickString(
      record.cjProductName,
      record.productName,
      record.productTitle,
      record.title
    ),
    resolvedVariantTitle: pickString(
      record.cjVariantName,
      record.variantName,
      record.variantTitle
    ),
    queryProductId: pickString(record.productId, record.product_id),
    queryVariantId: pickString(record.variantId, record.variant_id),
    shopId: pickString(record.shopId, record.shop_id),
    shopName: pickString(record.shopName, record.shop_name),
    raw: record,
  };
}

export function mapCjSourcingRequestStatus(record, fallback = SOURCE_REQUEST_STATUS_PROCESSING) {
  if (!record) {
    return fallback;
  }

  const normalizedStatus = String(record.sourceStatus || '').trim().toLowerCase();
  const normalizedLabel = String(record.sourceStatusLabel || '').trim().toLowerCase();
  const combined = `${normalizedStatus} ${normalizedLabel}`.trim();

  if (record.cjPid) {
    return SOURCE_REQUEST_STATUS_READY;
  }

  if (
    /(fail|failed|reject|rejected|close|closed|cancel|cancelled|invalid|error)/i.test(combined)
  ) {
    return SOURCE_REQUEST_STATUS_FAILED;
  }

  if (
    /(ready|quoted|completed|success|matched|resolved|processed)/i.test(combined) &&
    record.cjPid
  ) {
    return SOURCE_REQUEST_STATUS_READY;
  }

  if (/(processing|pending|waiting|queue|queued|review|submitted|sourcing)/i.test(combined)) {
    return normalizedStatus === 'submitted'
      ? SOURCE_REQUEST_STATUS_SUBMITTED
      : SOURCE_REQUEST_STATUS_PROCESSING;
  }

  return fallback;
}

export async function submitCjSourceLinkRequest({
  sourceUrl,
  note = null,
  requestedQuantity = null,
  sourceSnapshot,
}) {
  const accessToken = (await getCjAccessToken()).accessToken;
  const quantity = Math.max(Number(requestedQuantity || 1) || 1, 1);
  const remark = pickString(note);
  const basePayload = {
    productUrl: sourceUrl,
    amount: quantity,
    ...(remark ? { remark } : {}),
  };
  const productName = pickString(sourceSnapshot?.title);
  const productImage = pickString(sourceSnapshot?.image);
  if (!productImage) {
    throw new Error(
      sourceSnapshot?.fetch_error
        ? `Unable to extract a source product image required by CJ: ${sourceSnapshot.fetch_error}`
        : 'Unable to extract a source product image required by CJ from this supplier page'
    );
  }

  const requestPayload = {
    ...basePayload,
    productImage,
    thirdProductImage: productImage,
    thirdProductUrl: sourceUrl,
    ...(productName ? { productName } : {}),
    ...(productName ? { thirdProductName: productName } : {}),
  };

  const result = await requestCjJson({
    pathCandidates: ['/v1/product/sourcing/create'],
    method: 'POST',
    accessToken,
    bodyCandidates: [requestPayload],
  });

  const record =
    normalizeCjSourcingRecord(extractCjSourcingRows(result.data)[0]) ||
    normalizeCjSourcingRecord(result.data?.data) ||
    normalizeCjSourcingRecord(result.data);

  return {
    endpoint: result.endpoint,
    requestPayload,
    request: record,
    raw: result.data,
  };
}

export async function refreshCjSourceLinkRequest({ cjRequestId }) {
  const normalizedRequestId = pickString(cjRequestId);
  if (!normalizedRequestId) {
    throw new Error('cjRequestId is required to refresh a CJ sourcing request');
  }

  const accessToken = (await getCjAccessToken()).accessToken;
  const result = await requestCjJson({
    pathCandidates: ['/v1/product/sourcing/query'],
    method: 'POST',
    accessToken,
    bodyCandidates: [
      { sourceIds: [normalizedRequestId] },
      { sourceIds: normalizedRequestId.split(',').map((value) => value.trim()).filter(Boolean) },
    ],
  });

  const rows = extractCjSourcingRows(result.data).map((entry) => normalizeCjSourcingRecord(entry));
  const record =
    rows.find((entry) => entry?.cjRequestId === normalizedRequestId) ||
    rows[0] ||
    normalizeCjSourcingRecord(result.data?.data) ||
    normalizeCjSourcingRecord(result.data);

  if (!record) {
    throw new Error('CJ did not return a sourcing record for this request');
  }

  return {
    endpoint: result.endpoint,
    request: record,
    raw: result.data,
  };
}

function buildCreateOrderPayload({ subOrder, orderRecord, receivingHub, sourcedItems }) {
  const orderReference =
    pickString(orderRecord?.woocommerce_order_id, orderRecord?.id) || pickString(subOrder?.id);
  const logisticName = pickString(
    sourcedItems[0]?.carrierName,
    parseObject(subOrder?.metadata)?.global_sourcing?.carrier_name
  );

  const payload = {
    orderNumber: `JLO-${orderReference}-${String(subOrder.id).slice(0, 8)}`,
    fromCountryCode: DEFAULT_ORIGIN_COUNTRY_CODE,
    countryCode: receivingHub.countryCode,
    country: receivingHub.countryName,
    state: receivingHub.state,
    province: receivingHub.state,
    city: receivingHub.city,
    address: receivingHub.address,
    zip: receivingHub.postcode || '',
    zipCode: receivingHub.postcode || '',
    name: receivingHub.contactName,
    phone: receivingHub.contactPhone,
    shippingCountryCode: receivingHub.countryCode,
    shippingCountry: receivingHub.countryName,
    shippingProvince: receivingHub.state,
    shippingState: receivingHub.state,
    shippingCity: receivingHub.city,
    shippingAddress: receivingHub.address,
    shippingAddress1: receivingHub.address,
    shippingAddress2: '',
    shippingCounty: '',
    shippingZip: receivingHub.postcode || '',
    shippingZipCode: receivingHub.postcode || '',
    shippingCustomerName: receivingHub.contactName,
    shippingName: receivingHub.contactName,
    shippingPhone: receivingHub.contactPhone,
    products: sourcedItems.map((item) => ({
      vid: item.cjVid,
      quantity: item.quantity,
    })),
    remark: `JulineMart hub inbound order for Woo ${orderReference}`,
  };

  if (receivingHub.email) {
    payload.email = receivingHub.email;
    payload.shippingEmail = receivingHub.email;
  }

  if (logisticName) {
    payload.logisticName = logisticName;
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
  inboundShipment = null,
}) {
  const metadata = parseObject(subOrder?.metadata);
  const sourcing = parseObject(metadata.global_sourcing);

  if (metadata.fulfillment_mode !== 'cj_hub') {
    return { skipped: true, reason: 'not_cj_hub' };
  }

  if ((sourcing.provider || PROVIDER) !== PROVIDER) {
    return { skipped: true, reason: 'unsupported_provider' };
  }

  const { items: sourcedItems, hydratedMetadata } = await resolveSubOrderItems(
    client,
    subOrder,
    inboundShipment
  );
  if (hydratedMetadata) {
    const { error: hydrationError } = await client
      .from('sub_orders')
      .update({ metadata: hydratedMetadata })
      .eq('id', subOrder.id);
    if (hydrationError) throw hydrationError;
    subOrder = { ...subOrder, metadata: hydratedMetadata };
  }
  if (sourcedItems.length === 0) {
    const metadataItems = Array.isArray(sourcing.items) ? sourcing.items : [];
    const subOrderItems = Array.isArray(subOrder?.items) ? subOrder.items : [];
    throw new Error(
      `No CJ variant ids were found for this sourced sub-order (sub_order_id=${subOrder.id}, metadata_items=${metadataItems.length}, sub_order_items=${subOrderItems.length}, shipment_cj_vid=${pickString(inboundShipment?.cj_vid) || 'none'})`
    );
  }

  const ensuredInboundShipment =
    inboundShipment || (await ensureInboundShipment(client, subOrder, wooOrderId));
  const existingCjOrderId = pickString(sourcing.cj_order_id, ensuredInboundShipment?.cj_order_id);
  if (existingCjOrderId) {
    await reconcileExistingSupplierOrderState({
      client,
      subOrder,
      inboundShipment: ensuredInboundShipment,
      sourcing,
      receivingHubId: pickString(
        sourcing.receiving_hub_id,
        ensuredInboundShipment?.hub_id,
        subOrder.hub_id
      ),
      cjOrderId: existingCjOrderId,
      trackingNumber: pickString(
        sourcing.inbound_tracking_number,
        ensuredInboundShipment?.inbound_tracking_number
      ),
      supplierStatus: ensuredInboundShipment?.supplier_status || null,
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
