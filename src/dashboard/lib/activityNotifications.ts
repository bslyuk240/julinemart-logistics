export const ACTIVITY_NOTIFICATIONS_CLEARED_KEY = 'jm_dashboard_cleared_notifications_v1';
export const ACTIVITY_NOTIFICATIONS_READ_KEY = 'jm_dashboard_read_notifications_v1';

export function loadNotificationIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveNotificationIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export interface ActivityLogRow {
  id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, unknown> | string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export function shouldShowActivityNotification(log: ActivityLogRow): boolean {
  const actionLower = log.action?.toLowerCase() || '';
  const resourceLower = log.resource_type?.toLowerCase() || '';
  return (
    actionLower.includes('order') ||
    actionLower.includes('tracking') ||
    actionLower.includes('refund') ||
    resourceLower.includes('order') ||
    resourceLower.includes('return') ||
    resourceLower.includes('refund') ||
    resourceLower.includes('shipment')
  );
}
