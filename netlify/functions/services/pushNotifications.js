const sanitizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value) => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeCustomerId = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
};

const parseResponseBody = async (response) => {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { raw };
  }
};

const firstDefinedCustomerId = (candidates) => {
  for (const candidate of candidates) {
    const normalized = normalizeCustomerId(candidate);
    if (normalized) return normalized;
  }
  return null;
};

export const extractCustomerIdFromOrder = (orderRecord) => {
  if (!isRecord(orderRecord)) return null;
  const metadata = parseRecord(orderRecord.metadata);
  return firstDefinedCustomerId([
    orderRecord.customer_id,
    orderRecord.customerId,
    orderRecord.wc_customer_id,
    orderRecord.woocommerce_customer_id,
    metadata?.customer_id,
    metadata?.customerId,
    metadata?.wc_customer_id,
    metadata?.woocommerce_customer_id,
  ]);
};

export const extractOrderReference = (orderRecord) => {
  if (!isRecord(orderRecord)) return null;
  const metadata = parseRecord(orderRecord.metadata);
  const candidates = [
    orderRecord.woocommerce_order_id,
    orderRecord.order_number,
    orderRecord.order_id,
    metadata?.woocommerce_order_id,
    metadata?.order_number,
    orderRecord.id,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
};

export const buildOrderDeepLink = (orderReference) => {
  if (!orderReference || !String(orderReference).trim()) return undefined;
  return `/orders/${encodeURIComponent(String(orderReference).trim())}`;
};

export async function sendPushToCustomer(customerId, input) {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!normalizedCustomerId) {
    return { success: false, skipped: true, reason: 'missing_customer_id' };
  }

  const baseUrl = sanitizeBaseUrl(process.env.PWA_BASE_URL);
  if (!baseUrl) {
    return { success: false, skipped: true, reason: 'missing_pwa_base_url' };
  }

  const payload = {
    customerId: normalizedCustomerId,
    title: String(input?.title || '').trim(),
    message: String(input?.message || '').trim(),
    type: String(input?.type || 'order_update').trim() || 'order_update',
  };

  if (!payload.title || !payload.message) {
    return { success: false, skipped: true, reason: 'missing_title_or_message' };
  }

  if (isRecord(input?.data) && Object.keys(input.data).length > 0) {
    payload.data = input.data;
  }

  const endpoint = `${baseUrl}/api/notifications/send`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      console.error('[Push] Upstream send error:', {
        endpoint,
        status: response.status,
        body,
      });
      return { success: false, status: response.status, body };
    }

    return { success: true, status: response.status, body };
  } catch (error) {
    console.error('[Push] Request failed:', {
      endpoint,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
