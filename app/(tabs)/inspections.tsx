import { ScrollView } from 'react-native';
import { StubScreen } from '@/components/shell/StubScreen';
import { AiInsightsQueue } from '@/components/dashboard/AiInsightsQueue';
import { colors, spacing } from '@/theme/tokens';

export default function InspectionsScreen() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
    >
      <StubScreen
        icon="camera-outline"
        title="Inspections"
        description="Capture drone imagery, run forensic damage detection, and resolve AI labels before they hit the customer-facing report."
        bullets={[
          'Schedule + assign inspections from Today\'s Schedule',
          'Drone batch upload with auto-stitching',
          'AI damage labeling — hail strikes, wind uplift, granule loss',
          'Adjuster-ready PDF export with annotated overlays',
        ]}
      />
      <AiInsightsQueue />
    </ScrollView>
  );
}
