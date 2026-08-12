// Push/email send history, backed by the shared activity_logs table (via
// /api/activity-logs) so every device and browser sees the same records.
// The server writes these rows at send time (admin-notifications-send,
// process-scheduled-push, broadcast-email) — this module only reads/deletes.

export type NotificationAudience =
  | 'single'
  | 'all_customers'
  | 'all_vendors'
  | 'all_staff'
  | 'segment';

export type NotificationType = 'order_update' | 'product' | 'promotion' | 'general';

export interface NotificationSegment {
  platform?: 'android' | 'web';
}

export interface NotificationPayload {
  audience: NotificationAudience;
  customerId?: string;
  segment?: NotificationSegment;
  title: string;
  message: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  scheduleAt?: string;
}

export interface NotificationHistoryEntry {
  id: string;
  createdAt: string;
  createdBy: string;
  request: NotificationPayload;
  response: unknown;
  success: boolean;
  statusCode: number;
  sent: number | null;
  failed: number | null;
  matchedTokensCount: number | null;
}

const HISTORY_ACTIONS = ['PUSH_NOTIFICATION_SENT', 'EMAIL_BROADCAST_SENT'];
const apiBase = import.meta.env.VITE_API_BASE_URL || '';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const mapRow = (row: unknown): NotificationHistoryEntry | null => {
  if (!isRecord(row) || typeof row.id !== 'string' || typeof row.created_at !== 'string') return null;
  const details = isRecord(row.details) ? row.details : {};
  if (!isRecord(details.request)) return null;

  return {
    id: row.id,
    createdAt: row.created_at,
    createdBy: typeof row.actor_email === 'string' && row.actor_email ? row.actor_email : 'unknown',
    request: details.request as unknown as NotificationPayload,
    response: details.response,
    success: details.success === true,
    statusCode: toNumberOrNull(details.statusCode) ?? 0,
    sent: toNumberOrNull(details.sent),
    failed: toNumberOrNull(details.failed),
    matchedTokensCount: toNumberOrNull(details.matchedTokensCount),
  };
};

export const loadNotificationHistory = async (accessToken: string): Promise<NotificationHistoryEntry[]> => {
  const res = await fetch(
    `${apiBase}/api/activity-logs?action_in=${HISTORY_ACTIONS.join(',')}&limit=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Could not load notification history (${res.status})`);
  const json = await res.json();
  const rows: unknown[] = Array.isArray(json?.data) ? json.data : [];
  return rows.map(mapRow).filter((entry): entry is NotificationHistoryEntry => entry !== null);
};

export const findNotificationHistoryEntry = async (
  accessToken: string,
  id: string,
): Promise<NotificationHistoryEntry | null> => {
  const entries = await loadNotificationHistory(accessToken);
  return entries.find((entry) => entry.id === id) || null;
};

export const removeNotificationHistoryEntry = async (accessToken: string, id: string): Promise<boolean> => {
  const res = await fetch(`${apiBase}/api/activity-logs?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.ok;
};
