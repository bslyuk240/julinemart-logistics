import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, Loader2, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  addNotificationHistoryEntry,
  NotificationAudience,
  NotificationPayload,
  NotificationType,
} from '../utils/notificationsHistory';

type SendMode = 'now' | 'later';

const defaultDataJson = '';

const buildRequestPayload = (params: {
  audience: NotificationAudience;
  customerId: string;
  segmentPlatform: 'android' | 'web';
  title: string;
  message: string;
  type: NotificationType;
  data: Record<string, unknown> | undefined;
  sendMode: SendMode;
  scheduleAt: string;
}): NotificationPayload => {
  const payload: NotificationPayload = {
    audience: params.audience,
    title: params.title,
    message: params.message,
    type: params.type,
    ...(params.data ? { data: params.data } : {}),
  };

  if (params.audience === 'single') {
    payload.customerId = params.customerId;
  }

  if (params.audience === 'segment') {
    payload.segment = { platform: params.segmentPlatform };
  }

  if (params.sendMode === 'later') {
    payload.scheduleAt = new Date(params.scheduleAt).toISOString();
  }

  return payload;
};

const parseDataJson = (value: string) => {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Optional data JSON must be an object, e.g. {"route":"/orders/123"}');
  }
  return parsed as Record<string, unknown>;
};

const getErrorMessage = (payload: unknown) => {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const message = record.message;
    const error = record.error;
    if (typeof message === 'string' && message.trim()) return message;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return 'Notification request failed';
};

const getCountText = (payload: unknown) => {
  const source =
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).meta as Record<string, unknown>) ||
        ((payload as Record<string, unknown>).data as Record<string, unknown>) ||
        (payload as Record<string, unknown>)
      : null;

  if (!source || typeof source !== 'object') return 'Notification sent successfully.';
  const sent = source.sent ?? source.sentCount ?? source.successCount;
  const failed = source.failed ?? source.failedCount ?? source.errorCount;
  const matched = source.matchedTokensCount ?? source.matched_tokens_count ?? source.matchedCount;
  return `Sent: ${sent ?? 0}, Failed: ${failed ?? 0}, Matched tokens: ${matched ?? 0}`;
};

export function NotificationsNewPage() {
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const notification = useNotification();

  const [audience, setAudience] = useState<NotificationAudience>('single');
  const [customerId, setCustomerId] = useState('');
  const [segmentPlatform, setSegmentPlatform] = useState<'android' | 'web'>('android');
  const [type, setType] = useState<NotificationType>('general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [dataJson, setDataJson] = useState(defaultDataJson);
  const [sendMode, setSendMode] = useState<SendMode>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [sending, setSending] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!title.trim() || !message.trim()) return false;
    if (audience === 'single' && !customerId.trim()) return false;
    if (sendMode === 'later' && !scheduleAt) return false;
    if (jsonError) return false;
    return true;
  }, [audience, customerId, title, message, sendMode, scheduleAt, jsonError]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!session?.access_token) {
      notification.error('Unauthorized', 'Please sign in again.');
      return;
    }

    let parsedData: Record<string, unknown> | undefined;
    try {
      parsedData = parseDataJson(dataJson);
      setJsonError(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Invalid JSON';
      setJsonError(msg);
      notification.error('Invalid JSON', msg);
      return;
    }

    const payload = buildRequestPayload({
      audience,
      customerId: customerId.trim(),
      segmentPlatform,
      title: title.trim(),
      message: message.trim(),
      type,
      data: parsedData,
      sendMode,
      scheduleAt,
    });

    setSending(true);

    try {
      const response = await fetch('/api/admin/notifications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const raw = await response.text();
      let body: unknown = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { message: raw || 'Unexpected response from notification proxy' };
      }
      const bodyRecord =
        body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const success = response.ok && bodyRecord.success !== false;

      const entry = addNotificationHistoryEntry({
        createdBy: user?.email || user?.id || 'unknown',
        request: payload,
        response: body,
        success,
        statusCode: response.status,
      });

      if (!success) {
        notification.error('Send failed', getErrorMessage(body));
        return;
      }

      notification.success('Push sent', getCountText(body));
      navigate(`/admin/notifications/${entry.id}`);
    } catch (error) {
      addNotificationHistoryEntry({
        createdBy: user?.email || user?.id || 'unknown',
        request: payload,
        response: { error: error instanceof Error ? error.message : 'Unknown error' },
        success: false,
        statusCode: 500,
      });
      notification.error('Send failed', error instanceof Error ? error.message : 'Unexpected error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">New Push Notification</h1>
          <p className="mt-2 text-gray-600">
            Compose and send a manual push using the existing PWA notification pipeline.
          </p>
        </div>
        <button onClick={() => navigate('/admin/notifications')} className="btn-secondary">
          View History
        </button>
      </div>

      <form onSubmit={onSubmit} className="card space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Audience *</label>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value as NotificationAudience)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            >
              <option value="single">Single customer</option>
              <option value="all_customers">All customers</option>
              <option value="all_vendors">All vendors</option>
              <option value="all_staff">All staff</option>
              <option value="segment">Segment (platform)</option>
            </select>
          </div>

          {audience === 'single' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Customer ID *</label>
              <input
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                placeholder="e.g. 58"
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          )}

          {audience === 'segment' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Segment platform *</label>
              <select
                value={segmentPlatform}
                onChange={(event) => setSegmentPlatform(event.target.value as 'android' | 'web')}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
              >
                <option value="android">Android</option>
                <option value="web">Web</option>
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type *</label>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as NotificationType)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            >
              <option value="order_update">Order Update</option>
              <option value="product">Product</option>
              <option value="promotion">Promotion</option>
              <option value="general">General</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Title *</label>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Flash sale starts now"
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Message *</label>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Write the push message content..."
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Optional data (JSON object)</label>
          <textarea
            value={dataJson}
            onChange={(event) => {
              setDataJson(event.target.value);
              if (!event.target.value.trim()) {
                setJsonError(null);
                return;
              }
              try {
                parseDataJson(event.target.value);
                setJsonError(null);
              } catch (error) {
                setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
              }
            }}
            placeholder='{"deepLink":"/orders/123","campaign":"flash_sale"}'
            rows={4}
            className={`w-full rounded-lg border px-4 py-2 font-mono text-sm focus:ring-2 ${
              jsonError ? 'border-red-300 focus:ring-red-500' : 'border-gray-300 focus:ring-primary-500'
            }`}
          />
          {jsonError && <p className="mt-1 text-sm text-red-600">{jsonError}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Send mode *</label>
            <select
              value={sendMode}
              onChange={(event) => setSendMode(event.target.value as SendMode)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            >
              <option value="now">Send now</option>
              <option value="later">Schedule for later</option>
            </select>
          </div>

          {sendMode === 'later' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Schedule at *</label>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(event) => setScheduleAt(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 pt-4">
          <div className="text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Bell className="h-4 w-4" />
              Uses secure server-side proxy.
            </span>
          </div>
          <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={!canSubmit || sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : sendMode === 'later' ? (
              <>
                <CalendarClock className="h-4 w-4" />
                Schedule Notification
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Notification
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
