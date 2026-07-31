import { useState } from 'react';
import { useNotification } from '../../../contexts/NotificationContext';
import { WebhooksPanel } from '../../../components/settings-developer/WebhooksPanel';
import { SettingsSubpage } from '../../components/SettingsParts';

export default function MobileSettingsWebhooks() {
  const notification = useNotification();
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    notification.success('Copied', label);
    setTimeout(() => setCopiedItem(null), 1500);
  };

  return (
    <SettingsSubpage title="Webhooks" subtitle="Live inbound URLs">
      <WebhooksPanel copiedItem={copiedItem} copyToClipboard={copyToClipboard} compact />
    </SettingsSubpage>
  );
}
