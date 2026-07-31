import { DocumentationPanel } from '../../../components/settings-developer/DocumentationPanel';
import { SettingsSubpage } from '../../components/SettingsParts';

export default function MobileSettingsDocumentation() {
  return (
    <SettingsSubpage title="Documentation" subtitle="Workflow, env vars & tools">
      <DocumentationPanel compact />
    </SettingsSubpage>
  );
}
