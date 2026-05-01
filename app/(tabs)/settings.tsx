import { StubScreen } from '@/components/shell/StubScreen';

export default function SettingsScreen() {
  return (
    <StubScreen
      icon="settings-outline"
      title="Settings"
      description="Workspace, team, integrations, and AI thresholds for the forensic engine."
      bullets={[
        'Team & roles (Adjuster, Crew Lead, Owner)',
        'CRM + accounting integrations (HubSpot, QuickBooks)',
        'AI thresholds: minimum confidence, auto-approve cutoffs',
        'Storm watch radius and notification channels',
      ]}
    />
  );
}
