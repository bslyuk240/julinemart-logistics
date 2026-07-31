import { DatabasePanel } from '../../../components/settings-developer/DatabasePanel';
import { SettingsSubpage } from '../../components/SettingsParts';

export default function MobileSettingsDatabase() {
  return (
    <SettingsSubpage title="Database" subtitle="Supabase schema">
      <DatabasePanel compact />
    </SettingsSubpage>
  );
}
