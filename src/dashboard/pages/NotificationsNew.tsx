import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, ChevronDown, ChevronUp, Loader2, Mail, Send, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  addNotificationHistoryEntry,
  NotificationAudience,
  NotificationPayload,
  NotificationType,
} from '../utils/notificationsHistory';

type Channel = 'push' | 'email';
type SendMode = 'now' | 'later';
type ProductFormFields = {
  productName: string;
  productLink: string;
  productId: string;
  ctaText: string;
};

const defaultDataJson = '';
const primaryProxyPath = '/api/admin/notifications/send';
const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
const fallbackProxyPath = `${functionsBase}/admin-notifications-send`;

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

const parseOptionalNumber = (value: string) => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeProductLink = (rawValue: string) => {
  const value = rawValue.trim();
  if (!value) return undefined;

  if (value.startsWith('/')) {
    return value;
  }

  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path || '/';
  } catch {
    return `/product/${value.replace(/^\/+/, '')}`;
  }
};

const buildProductData = (type: NotificationType, fields: ProductFormFields) => {
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

const getProxyCandidates = () => {
  const urls = [primaryProxyPath, fallbackProxyPath];

  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost' &&
    window.location.port !== '8888'
  ) {
    urls.push('http://localhost:8888/api/admin/notifications/send');
    urls.push('http://localhost:8888/.netlify/functions/admin-notifications-send');
  }

  return Array.from(new Set(urls));
};

const sendViaNotificationProxy = async (accessToken: string, payload: NotificationPayload) => {
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
      if (response.status !== 404 || isLast) {
        return response;
      }
    } catch (error) {
      lastNetworkError = error;
      if (isLast) throw error;
    }
  }

  if (lastNetworkError) throw lastNetworkError;
  throw new Error('Notification proxy endpoint is unavailable');
};

export function NotificationsNewPage() {
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const notification = useNotification();

  const [channel, setChannel] = useState<Channel>('push');

  // ── Email newsletter state ───────────────────────────────────────────────────
  const [emailAudience, setEmailAudience] = useState<'customers' | 'vendors' | 'both'>('customers');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  // AI email draft state
  const [emailAiOpen, setEmailAiOpen] = useState(false);
  const [emailAiPurpose, setEmailAiPurpose] = useState('flash_sale');
  const [emailAiContext, setEmailAiContext] = useState('');
  const [emailAiResult, setEmailAiResult] = useState<{ subject: string; body: string } | null>(null);
  const [emailAiGenerating, setEmailAiGenerating] = useState(false);

  const generateEmailAiDraft = async () => {
    if (!session?.access_token) return;
    setEmailAiGenerating(true);
    setEmailAiResult(null);
    try {
      const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
      const res = await fetch(`${functionsBase}/admin-ai-email-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ purpose: emailAiPurpose, context: emailAiContext, audience: emailAudience }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'AI draft failed');
      setEmailAiResult(json.data);
    } catch (err) {
      notification.error('AI Draft', err instanceof Error ? err.message : 'Failed to generate draft');
    } finally {
      setEmailAiGenerating(false);
    }
  };

  const onEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) { notification.error('Unauthorized', 'Please sign in again.'); return; }
    setEmailSending(true);
    try {
      const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
      const res = await fetch(`${functionsBase}/broadcast-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ audience: emailAudience, subject: emailSubject.trim(), body: emailBody.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to send');

      const entry = addNotificationHistoryEntry({
        createdBy: user?.email || user?.id || 'unknown',
        request: {
          audience: emailAudience === 'vendors' ? 'all_vendors' : 'all_customers',
          title: emailSubject.trim(),
          message: emailBody.trim(),
          type: 'general',
          data: { channel: 'email', emailAudience, sent: data.sent, failed: data.failed, total: data.total },
        },
        response: data,
        success: true,
        statusCode: res.status,
      });

      notification.success('Email sent', `Sent: ${data.sent}, Failed: ${data.failed}, Total: ${data.total}`);
      navigate(`/admin/notifications/${entry.id}`);
    } catch (err) {
      addNotificationHistoryEntry({
        createdBy: user?.email || user?.id || 'unknown',
        request: {
          audience: emailAudience === 'vendors' ? 'all_vendors' : 'all_customers',
          title: emailSubject.trim(),
          message: emailBody.trim(),
          type: 'general',
          data: { channel: 'email', emailAudience },
        },
        response: { error: err instanceof Error ? err.message : 'Unknown error' },
        success: false,
        statusCode: 500,
      });
      notification.error('Send failed', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setEmailSending(false);
    }
  };

  // ── Push notification state ──────────────────────────────────────────────────
  const [audience, setAudience] = useState<NotificationAudience>('single');
  const [customerId, setCustomerId] = useState('');
  const [segmentPlatform, setSegmentPlatform] = useState<'android' | 'web'>('android');
  const [type, setType] = useState<NotificationType>('general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [productName, setProductName] = useState('');
  const [productLink, setProductLink] = useState('');
  const [productId, setProductId] = useState('');
  const [ctaText, setCtaText] = useState('Shop now');
  const [dataJson, setDataJson] = useState(defaultDataJson);
  const [sendMode, setSendMode] = useState<SendMode>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [sending, setSending] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // AI draft state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPurpose, setAiPurpose] = useState('flash_sale');
  const [aiContext, setAiContext] = useState('');
  const [aiResult, setAiResult] = useState<{ title: string; body: string } | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);

  const generateAiDraft = async () => {
    if (!session?.access_token) return;
    setAiGenerating(true);
    setAiResult(null);
    try {
      const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
      const res = await fetch(`${functionsBase}/admin-ai-notification-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ purpose: aiPurpose, context: aiContext, notifType: type }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'AI draft failed');
      setAiResult(json.data);
    } catch (err) {
      notification.error('AI Draft', err instanceof Error ? err.message : 'Failed to generate draft');
    } finally {
      setAiGenerating(false);
    }
  };

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

    const productData = buildProductData(type, {
      productName,
      productLink,
      productId,
      ctaText,
    });
    const mergedData =
      parsedData || productData ? { ...(productData || {}), ...(parsedData || {}) } : undefined;

    const payload = buildRequestPayload({
      audience,
      customerId: customerId.trim(),
      segmentPlatform,
      title: title.trim(),
      message: message.trim(),
      type,
      data: mergedData,
      sendMode,
      scheduleAt,
    });

    setSending(true);

    try {
      const response = await sendViaNotificationProxy(session.access_token, payload);

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
          <h1 className="text-3xl font-bold text-gray-900">New Notification</h1>
          <p className="mt-2 text-gray-600">Send a push notification or email newsletter to customers and vendors.</p>
        </div>
        <button onClick={() => navigate('/admin/notifications')} className="btn-secondary">
          View History
        </button>
      </div>

      {/* Channel tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setChannel('push')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${channel === 'push' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Bell className="w-4 h-4" /> Push Notification
        </button>
        <button
          type="button"
          onClick={() => setChannel('email')}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${channel === 'email' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Mail className="w-4 h-4" /> Email Newsletter
        </button>
      </div>

      {/* ── EMAIL FORM ── */}
      {channel === 'email' && (
        <form onSubmit={onEmailSubmit} className="card space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Audience *</label>
            <div className="grid grid-cols-3 gap-3">
              {(['customers', 'vendors', 'both'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setEmailAudience(a)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${emailAudience === a ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}
                >
                  <Users className="w-4 h-4" />
                  {a === 'both' ? 'Both' : a.charAt(0).toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {emailAudience === 'customers' && 'Sends to all registered storefront customers.'}
              {emailAudience === 'vendors' && 'Sends to all active vendors.'}
              {emailAudience === 'both' && 'Sends to all customers and all active vendors.'}
            </p>
          </div>

          {/* AI Draft Panel */}
          <div className="rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setEmailAiOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-purple-800">
                <Sparkles className="w-4 h-4 text-purple-500" />
                Draft with AI
                <span className="text-xs font-normal text-purple-500">— generate subject &amp; body instantly</span>
              </span>
              {emailAiOpen ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />}
            </button>

            {emailAiOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-purple-200">
                <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Purpose</label>
                    <select
                      value={emailAiPurpose}
                      onChange={(e) => { setEmailAiPurpose(e.target.value); setEmailAiResult(null); }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                    >
                      <option value="flash_sale">🔥 Flash Sale / Promo</option>
                      <option value="new_product">🆕 New Product Launch</option>
                      <option value="restock">📦 Restock Alert</option>
                      <option value="festive">🎉 Festive / Seasonal</option>
                      <option value="vendor_update">📋 Vendor Update</option>
                      <option value="general">📢 General Newsletter</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Context <span className="text-gray-400">(optional — e.g. "30% off shoes this weekend")</span>
                    </label>
                    <input
                      type="text"
                      value={emailAiContext}
                      onChange={(e) => { setEmailAiContext(e.target.value); setEmailAiResult(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateEmailAiDraft(); } }}
                      placeholder="Describe the campaign…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void generateEmailAiDraft()}
                  disabled={emailAiGenerating}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {emailAiGenerating
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                    : <><Sparkles className="w-4 h-4" /> Generate</>}
                </button>

                {emailAiResult && (
                  <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Subject</p>
                        <p className="text-sm font-medium text-gray-900">{emailAiResult.subject}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEmailSubject(emailAiResult.subject)}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                      >
                        Use
                      </button>
                    </div>
                    <div className="border-t border-gray-100" />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Body</p>
                        <p className="text-sm text-gray-900 whitespace-pre-line line-clamp-4">{emailAiResult.body}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEmailBody(emailAiResult.body)}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                      >
                        Use
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setEmailSubject(emailAiResult.subject); setEmailBody(emailAiResult.body); }}
                      className="w-full py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                    >
                      Use both
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Subject *</label>
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="e.g. Exciting news from JulineMart 🎉"
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Message *</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Write your message here. Keep it clear and friendly."
              rows={8}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">Plain text — line breaks are preserved in the email.</p>
          </div>

          <div className="flex items-center justify-between border-t border-gray-200 pt-4">
            <span className="inline-flex items-center gap-1 text-sm text-gray-500">
              <Mail className="h-4 w-4" /> Sent via your configured SMTP settings.
            </span>
            <button
              type="submit"
              className="btn-primary inline-flex items-center gap-2"
              disabled={!emailSubject.trim() || !emailBody.trim() || emailSending}
            >
              {emailSending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Send className="h-4 w-4" /> Send Email</>}
            </button>
          </div>
        </form>
      )}

      {/* ── PUSH FORM ── */}
      {channel === 'push' && <form onSubmit={onSubmit} className="card space-y-5">
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

        {/* ── AI Draft Panel ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setAiOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-50 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-purple-800">
              <Sparkles className="w-4 h-4 text-purple-500" />
              Draft with AI
              <span className="text-xs font-normal text-purple-500">— generate title &amp; body instantly</span>
            </span>
            {aiOpen
              ? <ChevronUp className="w-4 h-4 text-purple-400" />
              : <ChevronDown className="w-4 h-4 text-purple-400" />}
          </button>

          {aiOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-purple-200">
              <div className="grid grid-cols-1 gap-3 pt-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Purpose</label>
                  <select
                    value={aiPurpose}
                    onChange={(e) => { setAiPurpose(e.target.value); setAiResult(null); }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="flash_sale">🔥 Flash Sale / Promo</option>
                    <option value="new_product">🆕 New Product Launch</option>
                    <option value="restock">📦 Restock Alert</option>
                    <option value="festive">🎉 Festive / Seasonal</option>
                    <option value="order_update">🚚 Order / Delivery Update</option>
                    <option value="general">📢 General Announcement</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Context <span className="text-gray-400">(optional — e.g. "30% off shoes today")</span>
                  </label>
                  <input
                    type="text"
                    value={aiContext}
                    onChange={(e) => { setAiContext(e.target.value); setAiResult(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateAiDraft(); } }}
                    placeholder="Describe the campaign in a sentence…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void generateAiDraft()}
                disabled={aiGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {aiGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                  : <><Sparkles className="w-4 h-4" /> Generate</>}
              </button>

              {aiResult && (
                <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Title</p>
                      <p className="text-sm font-medium text-gray-900">{aiResult.title}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{aiResult.title.length} chars</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTitle(aiResult.title)}
                      className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                    >
                      Use
                    </button>
                  </div>
                  <div className="border-t border-gray-100" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Body</p>
                      <p className="text-sm text-gray-900">{aiResult.body}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{aiResult.body.length} chars</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMessage(aiResult.body)}
                      className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                    >
                      Use
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setTitle(aiResult.title); setMessage(aiResult.body); }}
                    className="w-full py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                  >
                    Use both
                  </button>
                </div>
              )}
            </div>
          )}
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

        {type === 'product' && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
            <h3 className="text-sm font-semibold text-blue-900">Product details (no JSON needed)</h3>
            <p className="mt-1 text-sm text-blue-800">
              Fill these in plain language. We will convert them into notification data automatically.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Product name</label>
                <input
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="e.g. Glow Body Lotion"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Product link or slug</label>
                <input
                  value={productLink}
                  onChange={(event) => setProductLink(event.target.value)}
                  placeholder="e.g. /product/glow-body-lotion or glow-body-lotion"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Product ID (optional)</label>
                <input
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  placeholder="e.g. 123"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Button text (optional)</label>
                <input
                  value={ctaText}
                  onChange={(event) => setCtaText(event.target.value)}
                  placeholder="e.g. Shop now"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Optional advanced data (JSON object)
          </label>
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
          <p className="mt-1 text-xs text-gray-500">
            Leave this empty unless you need extra technical fields. Product details above already build data for you.
          </p>
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
      </form>}
    </div>
  );
}
