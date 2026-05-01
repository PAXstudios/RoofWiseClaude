import { ScrollView } from 'react-native';
import { StubScreen } from '@/components/shell/StubScreen';
import { RecentJobs } from '@/components/dashboard/RecentJobs';
import { colors, spacing } from '@/theme/tokens';

export default function JobsScreen() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: spacing.xxxl }}
    >
      <StubScreen
        icon="hammer-outline"
        title="Jobs"
        description="Active and completed roofing jobs with crew, materials, and customer comms in one view."
        bullets={[
          'Job status: Scheduled, Active, Needs Review, Done',
          'Materials lists + supplier delivery windows',
          'Crew assignment + timecards',
          'Customer-visible job timeline + photo gallery',
        ]}
      />
      <RecentJobs />
    </ScrollView>
  );
}
