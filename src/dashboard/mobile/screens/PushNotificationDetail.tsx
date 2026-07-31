import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { findNotificationHistoryEntry } from '../../utils/notificationsHistory';
import { SectionCard, SettingsRow, SettingsSubpage, StatusPill } from '../components/SettingsParts';
import {
  formatNotificationDate,
  getAudienceLabel,
  getHistoryChannel,
  getTypeLabel,
} from '../lib/pushNotificationsApi';

export default function MobilePushNotificationDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const entry = useMemo(() => findNotificationHistoryEntry(id), [id]);

  if (!entry) {
    return (
      <SettingsSubpage title="Not found" subtitle="History entry missing" backTo="/admin/notifications">
        <div className="rounded-2xl bg-white px-4 py-10 text-center ring-1 ring-gray-100">
          <p className="text-sm text-gray-600">This record may have been cleared from local storage.</p>
          <button
            type="button"
            onClick={() => navigate('/admin/notifications')}
            className="mt-4 text-sm font-semibold text-primary-600"
          >
            Back to history
          </button>
        </div>
      </SettingsSubpage>
    );
  }

  const channel = getHistoryChannel(entry.request);
  const emailAudience =
    entry.request.data && typeof entry.request.data === 'object'
      ? (entry.request.data.emailAudience as string | undefined)
      : undefined;

  return (
    <SettingsSubpage
      title={channel === 'email' ? 'Email send' : 'Push send'}
      subtitle={formatNotificationDate(entry.createdAt)}
      backTo="/admin/notifications"
    >
      <div className="space-y-5">
        <SectionCard title="Summary">
          <SettingsRow label="Channel">
            <span className="text-xs font-semibold text-gray-800">{channel === 'email' ? 'Email newsletter' : 'Push notification'}</span>
          </SettingsRow>
          <SettingsRow label="Status">
            <StatusPill ok={entry.success} label={entry.success ? 'Sent' : 'Failed'} />
          </SettingsRow>
          <SettingsRow label="Audience">
            <span className="text-xs font-medium text-gray-800">
              {channel === 'email' && emailAudience
                ? emailAudience.charAt(0).toUpperCase() + emailAudience.slice(1)
                : getAudienceLabel(entry.request.audience)}
            </span>
          </SettingsRow>
          {channel === 'push' && (
            <SettingsRow label="Type">
              <span className="text-xs font-medium text-gray-800">{getTypeLabel(entry.request.type)}</span>
            </SettingsRow>
          )}
          <SettingsRow label="Created by">
            <span className="max-w-[140px] truncate text-xs text-gray-700">{entry.createdBy}</span>
          </SettingsRow>
          <div className="border-b border-gray-50 px-4 py-3.5">
            <p className="text-xs text-gray-500">{channel === 'email' ? 'Subject' : 'Title'}</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{entry.request.title}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-xs text-gray-500">Message</p>
            <p className="mt-1 text-sm text-gray-800">{entry.request.message}</p>
          </div>
        </SectionCard>

        <SectionCard title="Delivery stats">
          <SettingsRow label="Sent">
            <span className="text-sm font-semibold text-gray-900">{entry.sent ?? 0}</span>
          </SettingsRow>
          <SettingsRow label="Failed">
            <span className="text-sm font-semibold text-gray-900">{entry.failed ?? 0}</span>
          </SettingsRow>
          <SettingsRow label="Matched tokens">
            <span className="text-sm font-semibold text-gray-900">{entry.matchedTokensCount ?? 0}</span>
          </SettingsRow>
          <SettingsRow label="HTTP status">
            <span className="text-xs font-mono text-gray-700">{entry.statusCode}</span>
          </SettingsRow>
        </SectionCard>

        <SectionCard title="Request payload">
          <pre className="overflow-x-auto px-4 py-3.5 text-[11px] leading-relaxed text-gray-800 font-mono whitespace-pre-wrap">
            {JSON.stringify(entry.request, null, 2)}
          </pre>
        </SectionCard>

        <SectionCard title="Response">
          <pre className="overflow-x-auto px-4 py-3.5 text-[11px] leading-relaxed text-gray-800 font-mono whitespace-pre-wrap">
            {JSON.stringify(entry.response, null, 2)}
          </pre>
        </SectionCard>
      </div>
    </SettingsSubpage>
  );
}
