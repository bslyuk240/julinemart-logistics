const BULK_AUDIENCES = new Set(['all_customers', 'all_vendors', 'all_staff', 'segment']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const asFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const extractMetric = (source, keys) => {
  if (!isRecord(source)) return null;
  for (const key of keys) {
    const found = asFiniteNumber(source[key]);
    if (found !== null) return found;
  }
  return null;
};

const sanitizeBaseUrl = (url) => (url || '').replace(/\/+$/, '');

const buildPwaHeaders = (audience, notificationsAdminSecret) => {
  const upstreamHeaders = { 'Content-Type': 'application/json' };
  if (BULK_AUDIENCES.has(audience)) {
    if (!notificationsAdminSecret) return { error: 'NOTIFICATIONS_ADMIN_SECRET is not configured' };
    upstreamHeaders['x-notifications-admin-secret'] = notificationsAdminSecret;
  }
  return { upstreamHeaders };
};

/**
 * Forward a push payload to the PWA send API and normalize the response.
 */
async function sendPushViaPwa({ pwaBaseUrl, notificationsAdminSecret, payload }) {
  const audience = String(payload.audience || '');
  const headersResult = buildPwaHeaders(audience, notificationsAdminSecret);
  if (headersResult.error) {
    return { ok: false, statusCode: 500, body: { success: false, error: headersResult.error } };
  }

  const upstreamUrl = `${sanitizeBaseUrl(pwaBaseUrl)}/api/notifications/send`;
  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: headersResult.upstreamHeaders,
    body: JSON.stringify(payload),
  });

  const raw = await upstreamResponse.text();
  let upstreamBody = {};
  try {
    upstreamBody = raw ? JSON.parse(raw) : {};
  } catch {
    upstreamBody = { raw };
  }

  if (!upstreamResponse.ok) {
    const upstreamMessage =
      isRecord(upstreamBody) && typeof upstreamBody.message === 'string'
        ? upstreamBody.message
        : null;
    return {
      ok: false,
      statusCode: upstreamResponse.status,
      body: {
        success: false,
        error: upstreamMessage || 'PWA notification service returned an error',
        upstream: upstreamBody,
      },
    };
  }

  const metricSource = isRecord(upstreamBody.meta)
    ? upstreamBody.meta
    : isRecord(upstreamBody.data)
      ? upstreamBody.data
      : upstreamBody;

  const sent = extractMetric(metricSource, ['sent', 'sentCount', 'successCount']);
  const failed = extractMetric(metricSource, ['failed', 'failedCount', 'errorCount']);
  const matchedTokensCount = extractMetric(metricSource, [
    'matchedTokensCount',
    'matched_tokens_count',
    'matchedCount',
  ]);

  const meta = { audience, sent, failed, matchedTokensCount };

  if (isRecord(upstreamBody) && upstreamBody.success === false) {
    if (sent !== null && sent > 0) {
      return {
        ok: true,
        statusCode: 200,
        partial: true,
        body: {
          success: true,
          partial: true,
          message:
            typeof upstreamBody.message === 'string'
              ? upstreamBody.message
              : 'Notifications partially sent',
          data: upstreamBody,
          meta,
        },
      };
    }

    return {
      ok: false,
      statusCode: 200,
      body: {
        success: false,
        error:
          typeof upstreamBody.message === 'string'
            ? upstreamBody.message
            : 'Notification service returned failure',
        upstream: upstreamBody,
        meta,
      },
    };
  }

  return {
    ok: true,
    statusCode: 200,
    body: {
      success: true,
      data: upstreamBody,
      meta,
    },
  };
}

export { sendPushViaPwa, BULK_AUDIENCES };
