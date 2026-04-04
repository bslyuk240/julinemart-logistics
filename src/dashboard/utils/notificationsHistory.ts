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

const STORAGE_KEY = 'jm_admin_push_history_v1';
const MAX_ENTRIES = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const extractCount = (source: Record<string, unknown> | null, keys: string[]) => {
  if (!source) return null;
  for (const key of keys) {
    const value = toNumberOrNull(source[key]);
    if (value !== null) return value;
  }
  return null;
};

const safeJsonParse = (raw: string | null) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getEntryId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const loadNotificationHistory = (): NotificationHistoryEntry[] => {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse(window.localStorage.getItem(STORAGE_KEY));
  return parsed.filter((entry): entry is NotificationHistoryEntry => {
    if (!isRecord(entry)) return false;
    return (
      typeof entry.id === 'string' &&
      typeof entry.createdAt === 'string' &&
      typeof entry.createdBy === 'string' &&
      isRecord(entry.request) &&
      typeof entry.success === 'boolean' &&
      typeof entry.statusCode === 'number'
    );
  });
};

const saveNotificationHistory = (entries: NotificationHistoryEntry[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
};

export const addNotificationHistoryEntry = (input: {
  createdBy: string;
  request: NotificationPayload;
  response: unknown;
  success: boolean;
  statusCode: number;
}) => {
  const responseRecord = isRecord(input.response) ? input.response : null;
  const meta = responseRecord && isRecord(responseRecord.meta) ? responseRecord.meta : null;
  const data = responseRecord && isRecord(responseRecord.data) ? responseRecord.data : null;
  const source = meta || data || responseRecord;

  const entry: NotificationHistoryEntry = {
    id: getEntryId(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    request: input.request,
    response: input.response,
    success: input.success,
    statusCode: input.statusCode,
    sent: extractCount(source, ['sent', 'sentCount', 'successCount']),
    failed: extractCount(source, ['failed', 'failedCount', 'errorCount']),
    matchedTokensCount: extractCount(source, [
      'matchedTokensCount',
      'matched_tokens_count',
      'matchedCount',
    ]),
  };

  const next = [entry, ...loadNotificationHistory()];
  saveNotificationHistory(next);
  return entry;
};

export const findNotificationHistoryEntry = (id: string) =>
  loadNotificationHistory().find((entry) => entry.id === id) || null;

export const removeNotificationHistoryEntry = (id: string) => {
  const current = loadNotificationHistory();
  const next = current.filter((entry) => entry.id !== id);
  saveNotificationHistory(next);
  return next.length !== current.length;
};
