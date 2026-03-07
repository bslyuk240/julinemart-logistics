import {
  fetchSourceLinkProductSnapshot,
  headers,
  isPlainObject,
  jsonResponse,
  normalizeSupportedSourceUrl,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import {
  mapCjSourcingRequestStatus,
  refreshCjSourceLinkRequest,
  submitCjSourceLinkRequest,
} from './services/global-sourcing-cj.js';

const TABLE = 'global_sourcing_requests';
const PROVIDER = 'cj';
const REQUEST_TYPE = 'link';
const REUSABLE_STATUSES = ['submitted', 'processing', 'ready_to_import'];

function asPositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('requested_quantity must be a positive integer');
  }
  return parsed;
}

function pickString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function asMetadata(value) {
  return isPlainObject(value) ? value : {};
}

async function ensureActiveReference(client, table, id, label) {
  if (!id) return null;

  const query = client.from(table).select('id');
  if (table === 'hubs' || table === 'vendors') {
    query.eq('is_active', true);
  }

  const { data, error } = await query.eq('id', id).maybeSingle();
  if (error || !data?.id) {
    throw new Error(`${label} was not found or is inactive`);
  }

  return data.id;
}

async function loadHubMap(client, ids) {
  if (ids.length === 0) return new Map();
  const { data } = await client.from('hubs').select('id, name, code').in('id', ids);
  return new Map((data || []).map((hub) => [hub.id, hub]));
}

async function loadVendorMap(client, ids) {
  if (ids.length === 0) return new Map();
  const { data } = await client
    .from('vendors')
    .select('id, store_name, woocommerce_vendor_id')
    .in('id', ids);
  return new Map((data || []).map((vendor) => [vendor.id, vendor]));
}

function normalizeRequestRow(row, hubMap, vendorMap) {
  const metadata = asMetadata(row?.metadata);
  const rawRequestPayload = asMetadata(row?.raw_request_payload);
  const rawResponsePayload = asMetadata(row?.raw_response_payload);
  const receivingHubId = pickString(row?.receiving_hub_id);
  const vendorId = pickString(row?.vendor_id);

  return {
    id: row.id,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    provider: row.provider || PROVIDER,
    request_type: row.request_type || REQUEST_TYPE,
    source_url: row.source_url,
    source_domain: row.source_domain || null,
    status: row.status,
    note: row.note || null,
    requested_quantity: row.requested_quantity ?? null,
    vendor_id: vendorId,
    vendor: vendorId && vendorMap.has(vendorId) ? vendorMap.get(vendorId) : null,
    receiving_hub_id: receivingHubId,
    receiving_hub:
      receivingHubId && hubMap.has(receivingHubId) ? hubMap.get(receivingHubId) : null,
    cj_request_id: row.cj_request_id || null,
    cj_pid: row.cj_pid || null,
    cj_vid: row.cj_vid || null,
    resolved_product_title: row.resolved_product_title || null,
    resolved_variant_title: row.resolved_variant_title || null,
    error_message: row.error_message || null,
    metadata,
    raw_request_payload: rawRequestPayload,
    raw_response_payload: rawResponsePayload,
    can_continue_to_import: Boolean(row.cj_pid),
  };
}

async function normalizeRequestRows(client, rows) {
  const hubIds = Array.from(
    new Set(rows.map((row) => pickString(row?.receiving_hub_id)).filter(Boolean))
  );
  const vendorIds = Array.from(
    new Set(rows.map((row) => pickString(row?.vendor_id)).filter(Boolean))
  );
  const [hubMap, vendorMap] = await Promise.all([
    loadHubMap(client, hubIds),
    loadVendorMap(client, vendorIds),
  ]);

  return rows.map((row) => normalizeRequestRow(row, hubMap, vendorMap));
}

async function loadRequestById(client, requestId) {
  const { data, error } = await client.from(TABLE).select('*').eq('id', requestId).maybeSingle();
  if (error) throw error;
  if (!data?.id) return null;
  const [normalized] = await normalizeRequestRows(client, [data]);
  return normalized || null;
}

async function loadRequests(client) {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return normalizeRequestRows(client, data || []);
}

async function findLatestRequestBySourceUrl(client, sourceUrl) {
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('provider', PROVIDER)
    .eq('request_type', REQUEST_TYPE)
    .eq('source_url', sourceUrl)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data[0] ? data[0] : null;
}

function buildRequestMetadataPatch(existingMetadata, requestRecord, extras = {}) {
  const next = {
    ...asMetadata(existingMetadata),
    ...extras,
    cj_source_number: requestRecord?.sourceNumber || extras.cj_source_number || null,
    cj_status_raw: requestRecord?.sourceStatus || extras.cj_status_raw || null,
    cj_status_label: requestRecord?.sourceStatusLabel || extras.cj_status_label || null,
    cj_variant_sku: requestRecord?.cjVariantSku || extras.cj_variant_sku || null,
    query_product_id: requestRecord?.queryProductId || extras.query_product_id || null,
    query_variant_id: requestRecord?.queryVariantId || extras.query_variant_id || null,
    shop_id: requestRecord?.shopId || extras.shop_id || null,
    shop_name: requestRecord?.shopName || extras.shop_name || null,
    last_refreshed_at: new Date().toISOString(),
  };

  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined)
  );
}

function buildFailedStatusMessage(requestRecord, fallback = null) {
  return (
    pickString(
      requestRecord?.sourceStatusLabel,
      requestRecord?.sourceStatus,
      fallback
    ) || 'CJ sourcing request failed'
  );
}

async function submitRequest(client, payload) {
  const normalized = normalizeSupportedSourceUrl(payload?.source_url);
  const note = pickString(payload?.note);
  const requestedQuantity = asPositiveInteger(payload?.requested_quantity);
  const vendorId = pickString(payload?.vendor_id);
  const receivingHubId = pickString(payload?.receiving_hub_id);

  await Promise.all([
    ensureActiveReference(client, 'vendors', vendorId, 'Selected vendor'),
    ensureActiveReference(client, 'hubs', receivingHubId, 'Selected receiving hub'),
  ]);

  const existing = await findLatestRequestBySourceUrl(client, normalized.sourceUrl);
  if (existing?.id && REUSABLE_STATUSES.includes(String(existing.status || ''))) {
    return {
      statusCode: 200,
      body: {
        success: true,
        reused: true,
        data: await loadRequestById(client, existing.id),
        message: 'An existing sourcing request already covers this URL. Refresh it instead of resubmitting.',
      },
    };
  }

  if (existing?.id && String(existing.status || '') === 'failed') {
    return {
      statusCode: 200,
      body: {
        success: true,
        reused: true,
        requires_retry: true,
        data: await loadRequestById(client, existing.id),
        message: 'A failed sourcing request already exists for this URL. Use Retry on that request to resubmit deliberately.',
      },
    };
  }

  const sourceSnapshot = await fetchSourceLinkProductSnapshot(normalized.sourceUrl);
  const submission = await submitCjSourceLinkRequest({
    sourceUrl: normalized.sourceUrl,
    note,
    requestedQuantity,
    sourceSnapshot,
  });
  const requestRecord = submission.request;
  const status = mapCjSourcingRequestStatus(requestRecord, 'submitted');

  const { data, error } = await client
    .from(TABLE)
    .insert({
      provider: PROVIDER,
      request_type: REQUEST_TYPE,
      source_url: normalized.sourceUrl,
      source_domain: normalized.sourceDomain,
      status,
      note,
      requested_quantity: requestedQuantity,
      vendor_id: vendorId || null,
      receiving_hub_id: receivingHubId || null,
      cj_request_id: requestRecord?.cjRequestId || null,
      cj_pid: requestRecord?.cjPid || null,
      cj_vid: requestRecord?.cjVid || null,
      resolved_product_title: requestRecord?.resolvedProductTitle || sourceSnapshot.title,
      resolved_variant_title: requestRecord?.resolvedVariantTitle || null,
      raw_request_payload: {
        source_snapshot: sourceSnapshot,
        cj_request_payload: submission.requestPayload,
      },
      raw_response_payload: submission.raw || {},
      error_message: status === 'failed' ? buildFailedStatusMessage(requestRecord) : null,
      metadata: buildRequestMetadataPatch(
        {},
        requestRecord,
        {
          source_snapshot: sourceSnapshot,
          submission_endpoint: submission.endpoint,
        }
      ),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw error || new Error('Unable to persist sourcing request');
  }

  return {
    statusCode: 201,
    body: {
      success: true,
      data: await loadRequestById(client, data.id),
      message: status === 'ready_to_import'
        ? 'CJ sourced item is ready to continue into import'
        : 'Source link submitted to CJ',
    },
  };
}

async function refreshRequest(client, requestId) {
  const existing = await client.from(TABLE).select('*').eq('id', requestId).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data?.id) {
    return {
      statusCode: 404,
      body: { success: false, error: 'Sourcing request not found' },
    };
  }

  if (!existing.data.cj_request_id) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: 'This sourcing request does not have a CJ request id yet',
      },
    };
  }

  const refreshResult = await refreshCjSourceLinkRequest({
    cjRequestId: existing.data.cj_request_id,
  });
  const requestRecord = refreshResult.request;
  const nextStatus = mapCjSourcingRequestStatus(
    requestRecord,
    String(existing.data.status || 'processing')
  );

  const { error: updateError } = await client
    .from(TABLE)
    .update({
      status: nextStatus,
      cj_pid: requestRecord?.cjPid || existing.data.cj_pid || null,
      cj_vid: requestRecord?.cjVid || existing.data.cj_vid || null,
      resolved_product_title:
        requestRecord?.resolvedProductTitle || existing.data.resolved_product_title || null,
      resolved_variant_title:
        requestRecord?.resolvedVariantTitle || existing.data.resolved_variant_title || null,
      raw_response_payload: refreshResult.raw || {},
      error_message:
        nextStatus === 'failed'
          ? buildFailedStatusMessage(requestRecord, existing.data.error_message)
          : null,
      metadata: buildRequestMetadataPatch(
        existing.data.metadata,
        requestRecord,
        { refresh_endpoint: refreshResult.endpoint }
      ),
    })
    .eq('id', requestId);

  if (updateError) throw updateError;

  return {
    statusCode: 200,
    body: {
      success: true,
      data: await loadRequestById(client, requestId),
      message:
        nextStatus === 'ready_to_import'
          ? 'Sourcing request is ready to continue into import'
          : 'Sourcing request status refreshed',
    },
  };
}

async function retryRequest(client, requestId) {
  const existingResult = await client.from(TABLE).select('*').eq('id', requestId).maybeSingle();
  if (existingResult.error) throw existingResult.error;
  const existing = existingResult.data;

  if (!existing?.id) {
    return {
      statusCode: 404,
      body: { success: false, error: 'Sourcing request not found' },
    };
  }

  if (String(existing.status || '') !== 'failed') {
    return {
      statusCode: 409,
      body: {
        success: false,
        error: 'Only failed sourcing requests can be retried',
      },
    };
  }

  const normalized = normalizeSupportedSourceUrl(existing.source_url);
  const storedSnapshot = asMetadata(existing.raw_request_payload?.source_snapshot);
  const sourceSnapshot =
    storedSnapshot.title && storedSnapshot.image
      ? storedSnapshot
      : await fetchSourceLinkProductSnapshot(normalized.sourceUrl);

  const submission = await submitCjSourceLinkRequest({
    sourceUrl: normalized.sourceUrl,
    note: existing.note || null,
    requestedQuantity: existing.requested_quantity || null,
    sourceSnapshot,
  });
  const requestRecord = submission.request;
  const nextStatus = mapCjSourcingRequestStatus(requestRecord, 'submitted');
  const existingMetadata = asMetadata(existing.metadata);
  const previousRequestIds = Array.isArray(existingMetadata.previous_cj_request_ids)
    ? existingMetadata.previous_cj_request_ids.filter(Boolean)
    : [];

  if (existing.cj_request_id) {
    previousRequestIds.push(existing.cj_request_id);
  }

  const { error: updateError } = await client
    .from(TABLE)
    .update({
      status: nextStatus,
      cj_request_id: requestRecord?.cjRequestId || existing.cj_request_id || null,
      cj_pid: requestRecord?.cjPid || null,
      cj_vid: requestRecord?.cjVid || null,
      resolved_product_title: requestRecord?.resolvedProductTitle || sourceSnapshot.title,
      resolved_variant_title: requestRecord?.resolvedVariantTitle || null,
      raw_request_payload: {
        source_snapshot: sourceSnapshot,
        cj_request_payload: submission.requestPayload,
      },
      raw_response_payload: submission.raw || {},
      error_message:
        nextStatus === 'failed' ? buildFailedStatusMessage(requestRecord) : null,
      metadata: buildRequestMetadataPatch(
        existing.metadata,
        requestRecord,
        {
          source_snapshot: sourceSnapshot,
          submission_endpoint: submission.endpoint,
          previous_cj_request_ids: Array.from(new Set(previousRequestIds)),
          retried_at: new Date().toISOString(),
        }
      ),
    })
    .eq('id', requestId);

  if (updateError) throw updateError;

  return {
    statusCode: 200,
    body: {
      success: true,
      data: await loadRequestById(client, requestId),
      message: 'Failed sourcing request resubmitted to CJ',
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    if (event.httpMethod === 'GET') {
      return jsonResponse(200, {
        success: true,
        data: await loadRequests(auth.adminClient),
      });
    }

    const payload = parseJsonBody(event.body);
    if (payload === null || !isPlainObject(payload)) {
      return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
    }

    const action = String(payload.action || 'submit').trim().toLowerCase();
    const requestId = pickString(payload.id, payload.request_id);

    if (action === 'refresh') {
      if (!requestId) {
        return jsonResponse(400, { success: false, error: 'id is required to refresh a request' });
      }
      const response = await refreshRequest(auth.adminClient, requestId);
      return jsonResponse(response.statusCode, response.body);
    }

    if (action === 'retry') {
      if (!requestId) {
        return jsonResponse(400, { success: false, error: 'id is required to retry a request' });
      }
      const response = await retryRequest(auth.adminClient, requestId);
      return jsonResponse(response.statusCode, response.body);
    }

    const response = await submitRequest(auth.adminClient, payload);
    return jsonResponse(response.statusCode, response.body);
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Global sourcing source-link request failed',
      message: error?.message || 'Unable to process source-link request',
      details: error?.details || error?.responseBody || null,
    });
  }
}
