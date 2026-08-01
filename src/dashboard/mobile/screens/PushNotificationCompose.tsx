import { FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, CalendarClock, Loader, Mail, Send, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { Field, SectionCard, SettingsSubpage, inputCls } from '../components/SettingsParts';
import {
  buildProductData,
  buildPushPayload,
  generateAiEmailDraft,
  generateAiPushDraft,
  getCountText,
  getErrorMessage,
  sendBroadcastEmail,
  sendPushNotification,
  type EmailBroadcastAudience,
  type SendMode,
} from '../lib/pushNotificationsApi';
import { addNotificationHistoryEntry, type NotificationAudience, type NotificationType } from '../../utils/notificationsHistory';

type Channel = 'push' | 'email';

const PUSH_AUDIENCES: { value: NotificationAudience; label: string }[] = [
  { value: 'single', label: 'One customer' },
  { value: 'all_customers', label: 'All customers' },
  { value: 'all_vendors', label: 'All vendors' },
  { value: 'all_staff', label: 'All staff' },
  { value: 'segment', label: 'Segment' },
];

const EMAIL_AUDIENCES: { value: EmailBroadcastAudience; label: string }[] = [
  { value: 'customers', label: 'Customers' },
  { value: 'vendors', label: 'Vendors' },
  { value: 'both', label: 'Both' },
];

const TYPES: { value: NotificationType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'product', label: 'Product' },
  { value: 'order_update', label: 'Order' },
];

const AI_PURPOSES = [
  { value: 'flash_sale', label: 'Flash sale' },
  { value: 'new_product', label: 'New product' },
  { value: 'restock', label: 'Restock' },
  { value: 'festive', label: 'Festive' },
  { value: 'order_update', label: 'Order update' },
  { value: 'general', label: 'General' },
];

const EMAIL_AI_PURPOSES = [
  { value: 'flash_sale', label: 'Flash sale' },
  { value: 'new_product', label: 'New product' },
  { value: 'restock', label: 'Restock' },
  { value: 'festive', label: 'Festive' },
  { value: 'vendor_update', label: 'Vendor update' },
  { value: 'general', label: 'Newsletter' },
];

export default function MobilePushNotificationCompose() {
  const navigate = useNavigate();
  const { session, user } = useAuth();
  const notification = useNotification();

  const [channel, setChannel] = useState<Channel>('push');

  // Push state
  const [audience, setAudience] = useState<NotificationAudience>('all_customers');
  const [customerId, setCustomerId] = useState('');
  const [segmentPlatform, setSegmentPlatform] = useState<'android' | 'web'>('android');
  const [type, setType] = useState<NotificationType>('general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [productName, setProductName] = useState('');
  const [productLink, setProductLink] = useState('');
  const [productId, setProductId] = useState('');
  const [ctaText, setCtaText] = useState('Shop now');
  const [sendMode, setSendMode] = useState<SendMode>('now');
  const [scheduleAt, setScheduleAt] = useState('');
  const [sending, setSending] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPurpose, setAiPurpose] = useState('flash_sale');
  const [aiContext, setAiContext] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // Email state
  const [emailAudience, setEmailAudience] = useState<EmailBroadcastAudience>('customers');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailAiOpen, setEmailAiOpen] = useState(false);
  const [emailAiPurpose, setEmailAiPurpose] = useState('flash_sale');
  const [emailAiContext, setEmailAiContext] = useState('');
  const [emailAiGenerating, setEmailAiGenerating] = useState(false);

  const canSubmitPush = useMemo(() => {
    if (!title.trim() || !message.trim()) return false;
    if (audience === 'single' && !customerId.trim()) return false;
    if (sendMode === 'later' && !scheduleAt) return false;
    return true;
  }, [audience, customerId, title, message, sendMode, scheduleAt]);

  const canSubmitEmail = emailSubject.trim().length > 0 && emailBody.trim().length > 0;

  const generateAiDraft = async () => {
    if (!session?.access_token) return;
    setAiGenerating(true);
    try {
      const data = await generateAiPushDraft(session.access_token, {
        purpose: aiPurpose,
        context: aiContext,
        notifType: type,
      });
      setTitle(data.title);
      setMessage(data.body);
      notification.success('Draft ready', 'Title and message filled in');
    } catch (err) {
      notification.error('AI draft failed', err instanceof Error ? err.message : 'Could not generate');
    } finally {
      setAiGenerating(false);
    }
  };

  const generateEmailAiDraft = async () => {
    if (!session?.access_token) return;
    setEmailAiGenerating(true);
    try {
      const data = await generateAiEmailDraft(session.access_token, {
        purpose: emailAiPurpose,
        context: emailAiContext,
        audience: emailAudience,
      });
      setEmailSubject(data.subject);
      setEmailBody(data.body);
      notification.success('Draft ready', 'Subject and body filled in');
    } catch (err) {
      notification.error('AI draft failed', err instanceof Error ? err.message : 'Could not generate');
    } finally {
      setEmailAiGenerating(false);
    }
  };

  const onPushSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) {
      notification.error('Unauthorized', 'Please sign in again');
      return;
    }

    const productData = buildProductData(type, { productName, productLink, productId, ctaText });
    const payload = buildPushPayload({
      audience,
      customerId: customerId.trim(),
      segmentPlatform,
      title: title.trim(),
      message: message.trim(),
      type,
      data: productData,
      sendMode,
      scheduleAt,
    });

    setSending(true);
    try {
      const response = await sendPushNotification(session.access_token, payload);
      const raw = await response.text();
      let body: unknown = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { message: raw || 'Unexpected response' };
      }
      const bodyRecord = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const success = response.ok && bodyRecord.success !== false;
      const scheduled = bodyRecord.scheduled === true;
      const partial = bodyRecord.partial === true;

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

      if (scheduled) {
        notification.success('Push scheduled', getCountText(body));
      } else if (partial) {
        notification.warning('Partially sent', getCountText(body));
      } else {
        notification.success('Push sent', getCountText(body));
      }
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

  const onEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) {
      notification.error('Unauthorized', 'Please sign in again');
      return;
    }

    setEmailSending(true);
    try {
      const data = await sendBroadcastEmail(session.access_token, {
        audience: emailAudience,
        subject: emailSubject.trim(),
        body: emailBody.trim(),
      });

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
        statusCode: 200,
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

  return (
    <SettingsSubpage title="New notification" subtitle="Push or email newsletter" backTo="/admin/notifications">
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setChannel('push')}
          className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold ${
            channel === 'push' ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'
          }`}
        >
          <Bell className="h-4 w-4" />
          Push
        </button>
        <button
          type="button"
          onClick={() => setChannel('email')}
          className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold ${
            channel === 'email' ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'
          }`}
        >
          <Mail className="h-4 w-4" />
          Email
        </button>
      </div>

      {channel === 'push' ? (
        <form onSubmit={onPushSubmit} className="space-y-5">
          <SectionCard title="Audience">
            <div className="space-y-3 px-4 py-3.5">
              <div className="flex flex-wrap gap-2">
                {PUSH_AUDIENCES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAudience(value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      audience === value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {audience === 'single' && (
                <Field label="Customer ID">
                  <input
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className={inputCls}
                    placeholder="e.g. 58"
                    inputMode="numeric"
                  />
                </Field>
              )}
              {audience === 'segment' && (
                <Field label="Platform">
                  <div className="grid grid-cols-2 gap-2">
                    {(['android', 'web'] as const).map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => setSegmentPlatform(platform)}
                        className={`rounded-xl border py-2.5 text-sm font-semibold capitalize ${
                          segmentPlatform === platform
                            ? 'border-primary-600 bg-primary-50 text-primary-800'
                            : 'border-gray-200 text-gray-700'
                        }`}
                      >
                        {platform}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Message">
            <div className="space-y-3 px-4 py-3.5">
              <Field label="Type">
                <div className="grid grid-cols-2 gap-2">
                  {TYPES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setType(value)}
                      className={`rounded-xl border py-2 text-xs font-semibold ${
                        type === value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              <button
                type="button"
                onClick={() => setAiOpen((o) => !o)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-sm font-semibold text-violet-800"
              >
                <Sparkles className="h-4 w-4" />
                {aiOpen ? 'Hide AI draft' : 'Draft with AI'}
              </button>

              {aiOpen && (
                <div className="space-y-2 rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
                  <Field label="Purpose">
                    <select value={aiPurpose} onChange={(e) => setAiPurpose(e.target.value)} className={inputCls}>
                      {AI_PURPOSES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Context (optional)">
                    <input
                      value={aiContext}
                      onChange={(e) => setAiContext(e.target.value)}
                      className={inputCls}
                      placeholder="e.g. 30% off shoes today"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => void generateAiDraft()}
                    disabled={aiGenerating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {aiGenerating ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate
                  </button>
                </div>
              )}

              <Field label="Title">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
              </Field>
              <Field label="Message">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className={`${inputCls} min-h-[96px] resize-y`}
                  required
                />
              </Field>
            </div>
          </SectionCard>

          {type === 'product' && (
            <SectionCard title="Product details" subtitle="Optional deep link data">
              <div className="space-y-3 px-4 py-3.5">
                <Field label="Product name">
                  <input value={productName} onChange={(e) => setProductName(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Link or slug">
                  <input
                    value={productLink}
                    onChange={(e) => setProductLink(e.target.value)}
                    className={inputCls}
                    placeholder="/product/… or slug"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Product ID">
                    <input value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls} inputMode="numeric" />
                  </Field>
                  <Field label="Button text">
                    <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} className={inputCls} />
                  </Field>
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard title="Delivery">
            <div className="space-y-3 px-4 py-3.5">
              <div className="grid grid-cols-2 gap-2">
                {(['now', 'later'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSendMode(mode)}
                    className={`rounded-xl border py-2.5 text-sm font-semibold ${
                      sendMode === mode ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-700'
                    }`}
                  >
                    {mode === 'now' ? 'Send now' : 'Schedule'}
                  </button>
                ))}
              </div>
              {sendMode === 'later' && (
                <Field label="Schedule at">
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className={inputCls}
                    required
                  />
                </Field>
              )}
            </div>
          </SectionCard>

          <button
            type="submit"
            disabled={!canSubmitPush || sending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {sending ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : sendMode === 'later' ? (
              <CalendarClock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {sending ? 'Sending…' : sendMode === 'later' ? 'Schedule push' : 'Send push'}
          </button>
        </form>
      ) : (
        <form onSubmit={onEmailSubmit} className="space-y-5">
          <SectionCard title="Audience">
            <div className="space-y-3 px-4 py-3.5">
              <div className="grid grid-cols-3 gap-2">
                {EMAIL_AUDIENCES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEmailAudience(value)}
                    className={`rounded-xl border py-2.5 text-xs font-semibold ${
                      emailAudience === value
                        ? 'border-primary-600 bg-primary-50 text-primary-800'
                        : 'border-gray-200 text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                {emailAudience === 'customers' && 'All registered storefront customers'}
                {emailAudience === 'vendors' && 'All active vendors'}
                {emailAudience === 'both' && 'Customers and vendors'}
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Newsletter">
            <div className="space-y-3 px-4 py-3.5">
              <button
                type="button"
                onClick={() => setEmailAiOpen((o) => !o)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-sm font-semibold text-violet-800"
              >
                <Sparkles className="h-4 w-4" />
                {emailAiOpen ? 'Hide AI draft' : 'Draft with AI'}
              </button>

              {emailAiOpen && (
                <div className="space-y-2 rounded-xl bg-violet-50/60 p-3 ring-1 ring-violet-100">
                  <Field label="Purpose">
                    <select value={emailAiPurpose} onChange={(e) => setEmailAiPurpose(e.target.value)} className={inputCls}>
                      {EMAIL_AI_PURPOSES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Context (optional)">
                    <input
                      value={emailAiContext}
                      onChange={(e) => setEmailAiContext(e.target.value)}
                      className={inputCls}
                      placeholder="Describe the campaign…"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => void generateEmailAiDraft()}
                    disabled={emailAiGenerating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {emailAiGenerating ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate
                  </button>
                </div>
              )}

              <Field label="Subject">
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Exciting news from JulineMart"
                  required
                />
              </Field>
              <Field label="Message">
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className={`${inputCls} min-h-[160px] resize-y`}
                  placeholder="Write your newsletter message…"
                  required
                />
              </Field>
              <p className="text-xs text-gray-500">Plain text — line breaks are preserved. Sent via your SMTP settings.</p>
            </div>
          </SectionCard>

          <button
            type="submit"
            disabled={!canSubmitEmail || emailSending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {emailSending ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {emailSending ? 'Sending…' : 'Send email'}
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={() => navigate('/admin/notifications')}
        className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-sm font-medium text-gray-500"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to history
      </button>
    </SettingsSubpage>
  );
}
