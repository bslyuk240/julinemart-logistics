import type {
  NotificationAudience,
  NotificationPayload,
  NotificationType,
} from '../../utils/notificationsHistory';

const primaryProxyPath = '/api/admin/notifications/send';
const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
const fallbackProxyPath = `${functionsBase}/admin-notifications-send`;

export type SendMode = 'now' | 'later';

export type ProductFormFields = {
  productName: string;
  productLink: string;
  productId: string;
  ctaText: string;
};

export function getAudienceLabel(audience: NotificationAudience) {
  switch (audience) {
    case 'single':
      return 'Single customer';
    case 'all_customers':
      return 'All customers';
    case 'all_vendors':
      return 'All vendors';
    case 'all_staff':
      return 'All staff';
    case 'segment':
      return 'Segment';
    default:
      return audience;
  }
}

export function getTypeLabel(type: NotificationType) {
  switch (type) {
    case 'order_update':
      return 'Order update';
    case 'product':
      return 'Product';
    case 'promotion':
      return 'Promotion';
    case 'general':
      return 'General';
    default:
      return type;
  }
}

export function formatNotificationDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function parseDataJson(value: string) {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Optional data JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProductLink(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return undefined;
  if (value.startsWith('/')) return value;
  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path || '/';
  } catch {
    return `/product/${value.replace(/^\/+/, '')}`;
  }
}

export function buildProductData(type: NotificationType, fields: ProductFormFields) {
  if (type !== 'product') return undefined;
  const nextData: Record<string, unknown> = {};
  const productName = fields.productName.trim();
  const deepLink = normalizeProductLink(fields.productLink);
  const productId = parseOptionalNumber(fields.productId);
  const ctaText = fields.ctaText.trim();
  if (productName) nextData.productName = productName;
  if (deepLink) nextData.deepLink = deepLink;
  if (productId !== undefined) nextData.productId = productId;
  if (ctaText) nextData.ctaText = ctaText;
  return Object.keys(nextData).length > 0 ? nextData : undefined;
}

export function buildPushPayload(params: {
  audience: NotificationAudience;
  customerId: string;
  segmentPlatform: 'android' | 'web';
  title: string;
  message: string;
  type: NotificationType;
  data: Record<string, unknown> | undefined;
  sendMode: SendMode;
  scheduleAt: string;
}): NotificationPayload {
  const payload: NotificationPayload = {
    audience: params.audience,
    title: params.title,
    message: params.message,
    type: params.type,
    ...(params.data ? { data: params.data } : {}),
  };
  if (params.audience === 'single') payload.customerId = params.customerId;
  if (params.audience === 'segment') payload.segment = { platform: params.segmentPlatform };
  if (params.sendMode === 'later') payload.scheduleAt = new Date(params.scheduleAt).toISOString();
  return payload;
}

export function getErrorMessage(payload: unknown) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const message = record.message;
    const error = record.error;
    if (typeof message === 'string' && message.trim()) return message;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return 'Notification request failed';
}

export function getCountText(payload: unknown) {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (record?.scheduled === true) {
    const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : null;
    const scheduleAt = data?.scheduleAt;
    if (typeof scheduleAt === 'string') {
      return `Scheduled for ${new Date(scheduleAt).toLocaleString()}`;
    }
    return 'Push notification scheduled.';
  }

  const source =
    record
      ? (record.meta as Record<string, unknown>) ||
        (record.data as Record<string, unknown>) ||
        record
      : null;
  if (!source || typeof source !== 'object') return 'Notification sent successfully.';
  const sent = source.sent ?? source.sentCount ?? source.successCount;
  const failed = source.failed ?? source.failedCount ?? source.errorCount;
  const matched = source.matchedTokensCount ?? source.matched_tokens_count ?? source.matchedCount;
  const prefix = record?.partial === true ? 'Partially sent — ' : '';
  return `${prefix}Sent: ${sent ?? 0}, Failed: ${failed ?? 0}, Matched: ${matched ?? 0}`;
}

function getProxyCandidates() {
  const urls = [primaryProxyPath, fallbackProxyPath];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push('http://localhost:8888/api/admin/notifications/send');
    urls.push('http://localhost:8888/.netlify/functions/admin-notifications-send');
  }
  return Array.from(new Set(urls));
}

export async function sendPushNotification(accessToken: string, payload: NotificationPayload) {
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  };

  const candidates = getProxyCandidates();
  let lastNetworkError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    const isLast = index === candidates.length - 1;
    try {
      const response = await fetch(url, requestInit);
      if (response.status !== 404 || isLast) return response;
    } catch (error) {
      lastNetworkError = error;
      if (isLast) throw error;
    }
  }

  if (lastNetworkError) throw lastNetworkError;
  throw new Error('Notification proxy endpoint is unavailable');
}

export async function generateAiPushDraft(
  accessToken: string,
  params: { purpose: string; context: string; notifType: NotificationType },
) {
  const res = await fetch(`${functionsBase}/admin-ai-notification-draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'AI draft failed');
  return json.data as { title: string; body: string };
}

export type EmailBroadcastAudience = 'customers' | 'vendors' | 'both';

export async function generateAiEmailDraft(
  accessToken: string,
  params: { purpose: string; context: string; audience: EmailBroadcastAudience },
) {
  const res = await fetch(`${functionsBase}/admin-ai-email-draft`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'AI draft failed');
  return json.data as { subject: string; body: string };
}

export async function sendBroadcastEmail(
  accessToken: string,
  params: { audience: EmailBroadcastAudience; subject: string; body: string },
) {
  const urls = [`${functionsBase}/broadcast-email`, '/api/broadcast-email'];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${functionsBase}/broadcast-email`);
    urls.push('http://localhost:8888/api/broadcast-email');
  }

  let lastError: Error | null = null;
  for (const url of Array.from(new Set(urls))) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to send email');
      }
      return data as { success: boolean; sent: number; failed: number; total: number };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('Failed to send email');
    }
  }
  throw lastError || new Error('Failed to send email');
}

export function getHistoryChannel(request: NotificationPayload): 'push' | 'email' {
  if (request.data && typeof request.data === 'object' && request.data.channel === 'email') {
    return 'email';
  }
  return 'push';
}
