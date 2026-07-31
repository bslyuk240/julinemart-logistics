import { Check, Copy } from 'lucide-react';
import {
  INBOUND_WEBHOOKS,
  WEBHOOK_SETUP_HELPERS,
} from '../../lib/settingsDeveloperContent';
import { buildApiUrl } from '../../lib/settingsDeveloperUtils';

interface WebhooksPanelProps {
  copiedItem: string | null;
  copyToClipboard: (text: string, label: string) => void;
  compact?: boolean;
}

function WebhookBlock({
  label,
  url,
  note,
  envKeys,
  copiedItem,
  copyToClipboard,
  compact,
}: {
  label: string;
  url: string;
  note: string;
  envKeys?: string[];
  copiedItem: string | null;
  copyToClipboard: (text: string, label: string) => void;
  compact?: boolean;
}) {
  const sectionClass = compact
    ? 'rounded-2xl bg-white p-4 ring-1 ring-gray-100'
    : 'border border-gray-200 rounded-lg p-4';

  return (
    <div className={sectionClass}>
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      <p className="mt-1 text-xs sm:text-sm text-gray-600">{note}</p>
      {envKeys?.length ? (
        <p className="mt-2 text-[11px] text-gray-500">
          Env: {envKeys.map((k) => (
            <code key={k} className="mx-0.5 rounded bg-gray-100 px-1">{k}</code>
          ))}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          value={url}
          readOnly
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => copyToClipboard(url, label)}
          className="btn-secondary flex items-center gap-2 flex-shrink-0 text-sm"
        >
          {copiedItem === label ? (
            <>
              <Check className="w-4 h-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function WebhooksPanel({ copiedItem, copyToClipboard, compact = false }: WebhooksPanelProps) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={compact ? '' : 'card'}>
        {!compact && <h2 className="text-lg sm:text-2xl font-bold mb-4">Inbound webhooks</h2>}
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-4">
          <p className="text-sm text-amber-900">
            WooCommerce order webhooks are retired. Orders flow from the JulineMart storefront via{' '}
            <code className="px-1 py-0.5 bg-white/80 rounded">/api/create-order</code>. URLs below use your live JLO
            deployment origin.
          </p>
        </div>

        <div className="space-y-4">
          {INBOUND_WEBHOOKS.map((hook) => (
            <WebhookBlock
              key={hook.id}
              label={hook.label}
              url={buildApiUrl(hook.path)}
              note={hook.note}
              envKeys={hook.envKeys}
              copiedItem={copiedItem}
              copyToClipboard={copyToClipboard}
              compact={compact}
            />
          ))}
        </div>
      </div>

      <div className={compact ? 'space-y-3' : 'card'}>
        {!compact && <h2 className="text-base font-bold mb-3">Setup helpers (not inbound)</h2>}
        {WEBHOOK_SETUP_HELPERS.map((hook) => (
          <WebhookBlock
            key={hook.id}
            label={hook.label}
            url={buildApiUrl(hook.path)}
            note={hook.note}
            copiedItem={copiedItem}
            copyToClipboard={copyToClipboard}
            compact={compact}
          />
        ))}
      </div>

      <p className="text-xs text-gray-500 px-1">
        Configure webhook URLs in Paystack, Fez, and Supabase using the production JLO domain (e.g.{' '}
        <code className="rounded bg-gray-100 px-1">https://jlo.julinemart.com</code>).
      </p>
    </div>
  );
}
