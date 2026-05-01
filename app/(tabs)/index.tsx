import { ScrollView, View, StyleSheet, Platform } from 'react-native';
import { HeaderGreeting } from '@/components/shell/HeaderGreeting';
import { OverviewKpis } from '@/components/dashboard/OverviewKpis';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { WeatherStormCard } from '@/components/dashboard/WeatherStormCard';
import { AreaActivityMap } from '@/components/dashboard/AreaActivityMap';
import { PipelineKanban } from '@/components/dashboard/PipelineKanban';
import { TodaysSchedule } from '@/components/dashboard/TodaysSchedule';
import { RecentJobs } from '@/components/dashboard/RecentJobs';
import { AiInsightsQueue } from '@/components/dashboard/AiInsightsQueue';
import { MyTasks } from '@/components/dashboard/MyTasks';
import { RecentActivity } from '@/components/dashboard/RecentActivity';
import { useResponsive } from '@/theme/useResponsive';
import { colors, spacing } from '@/theme/tokens';

export default function DashboardScreen() {
  const { isWide } = useResponsive();

  if (isWide) {
    return (
      <ScrollView contentContainerStyle={styles.desktop}>
        <View style={styles.desktopInner}>
          <OverviewKpis />
          <View style={styles.row2}>
            <View style={styles.col}>
              <WeatherStormCard />
              <AreaActivityMap />
              <PipelineKanban />
            </View>
            <View style={styles.col}>
              <TodaysSchedule />
              <RecentJobs />
              <AiInsightsQueue />
            </View>
          </View>
          <View style={styles.row2}>
            <View style={styles.col}>
              <MyTasks />
            </View>
            <View style={styles.col}>
              <RecentActivity />
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.mobile}
      showsVerticalScrollIndicator={false}
    >
      <HeaderGreeting />
      <OverviewKpis />
      <QuickActions />
      <WeatherStormCard />
      <AreaActivityMap />
      <PipelineKanban />
      <TodaysSchedule />
      <RecentJobs />
      <AiInsightsQueue />
      <MyTasks />
      <RecentActivity />
      <View style={{ height: 96 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mobile: {
    backgroundColor: colors.bg,
    paddingBottom: Platform.OS === 'ios' ? spacing.xxxl : spacing.xl,
  },
  desktop: {
    backgroundColor: colors.bg,
    padding: spacing.xl,
  },
  desktopInner: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  row2: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  col: { flex: 1 },
});
