import { useState } from 'react';

export type GiftEditableDetail = {
  recipient_name: string;
  recipient_phone?: string | null;
  recipient_email?: string | null;
  recipient_address?: string | null;
  recipient_city: string;
  recipient_state: string;
  recipient_zone?: string | null;
  gift_message?: string | null;
  sender_visible: boolean;
  requested_delivery_date?: string | null;
  occasion_date?: string | null;
};

type Props = {
  detail: GiftEditableDetail;
  saving: boolean;
  inputClassName: string;
  onSave: (changes: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Staff-only edit of a gift's recipient, message and dates. Only changed
 * fields are sent. The server rejects the edit once delivery is arranged and
 * does not allow the delivery city/state to change (the fee was priced for it).
 */
export default function GiftEditDetailsForm({ detail, saving, inputClassName, onSave, onCancel }: Props) {
  const [form, setForm] = useState({
    recipient_name: detail.recipient_name || '',
    recipient_phone: detail.recipient_phone || '',
    recipient_email: detail.recipient_email || '',
    recipient_address: detail.recipient_address || '',
    recipient_zone: detail.recipient_zone || '',
    gift_message: detail.gift_message || '',
    sender_visible: detail.sender_visible !== false,
    requested_delivery_date: detail.requested_delivery_date || '',
    occasion_date: detail.occasion_date || '',
  });

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const original: Record<string, unknown> = {
    recipient_name: detail.recipient_name || '',
    recipient_phone: detail.recipient_phone || '',
    recipient_email: detail.recipient_email || '',
    recipient_address: detail.recipient_address || '',
    recipient_zone: detail.recipient_zone || '',
    gift_message: detail.gift_message || '',
    sender_visible: detail.sender_visible !== false,
    requested_delivery_date: detail.requested_delivery_date || '',
    occasion_date: detail.occasion_date || '',
  };

  const changes = Object.fromEntries(
    Object.entries(form).filter(([key, value]) => value !== original[key])
  );
  const hasChanges = Object.keys(changes).length > 0;

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        className={inputClassName}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      <p className="text-xs text-gray-600">
        Delivery to {detail.recipient_city}, {detail.recipient_state} (city and state can&apos;t be changed here).
        Editing is only possible until delivery has been arranged.
      </p>
      {field('Recipient name', 'recipient_name')}
      {field('Recipient phone', 'recipient_phone', 'tel')}
      {field('Recipient email (optional)', 'recipient_email', 'email')}
      {field('Delivery address', 'recipient_address')}
      {field('Delivery zone / area', 'recipient_zone')}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Gift message (max 500)</span>
        <textarea
          className={inputClassName}
          rows={3}
          maxLength={500}
          value={form.gift_message}
          onChange={(e) => set('gift_message', e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={form.sender_visible}
          onChange={(e) => set('sender_visible', e.target.checked)}
        />
        Show sender&apos;s name to recipient
      </label>
      {field('Requested delivery date', 'requested_delivery_date', 'date')}
      {field('Occasion date (optional)', 'occasion_date', 'date')}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={saving || !hasChanges}
          onClick={() => onSave(changes)}
          className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm text-gray-700">
          Close
        </button>
      </div>
    </div>
  );
}
