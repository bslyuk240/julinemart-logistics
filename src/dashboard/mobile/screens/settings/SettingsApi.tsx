import { useState } from 'react';
import { useNotification } from '../../../contexts/NotificationContext';
import { ApiPanel } from '../../../components/settings-developer/ApiPanel';
import { SettingsSubpage } from '../../components/SettingsParts';

export default function MobileSettingsApi() {
  const notification = useNotification();
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    notification.success('Copied', label);
    setTimeout(() => setCopiedItem(null), 1500);
  };

  return (
    <SettingsSubpage title="API reference" subtitle="Live Netlify endpoints & tester">
      <ApiPanel copiedItem={copiedItem} copyToClipboard={copyToClipboard} compact />
    </SettingsSubpage>
  );
}
