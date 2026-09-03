// Quick Actions — the "+" sheet. Every fast path in the app on one card grid,
// two per row, 56pt+ tiles, each opening the real screen (no dead tiles).

import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Action = {
  id: string;
  label: string;
  icon: IoniconName;
  tone: ChipTone;
  go: (router: ReturnType<typeof useRouter>) => void;
};

const ACTIONS: Action[] = [
  { id: 'lead', label: 'New Lead', icon: 'person-add-outline', tone: 'blue', go: (r) => r.push('/new-lead') },
  { id: 'inspect', label: 'Start Inspection', icon: 'search-outline', tone: 'orange', go: (r) => r.push('/quick-inspection') },
  { id: 'photo', label: 'Capture Damage Photo', icon: 'camera-outline', tone: 'orange', go: (r) => r.push('/quick-inspection') },
  { id: 'mileage', label: 'Track Mileage', icon: 'car-outline', tone: 'green', go: (r) => r.push('/mileage') },
  {
    id: 'claim',
    label: 'File Storm Claim',
    icon: 'thunderstorm-outline',
    tone: 'purple',
    // The New Job wizard; its first step is the General / Insurance Claim
    // choice, so the roofer picks claim mode there — no hidden prefill.
    go: (r) => r.push('/new-job'),
  },
  { id: 'job', label: 'New Job', icon: 'hammer-outline', tone: 'blue', go: (r) => r.push('/new-job') },
  { id: 'estimate', label: 'Cost Estimate', icon: 'calculator-outline', tone: 'green', go: (r) => r.push('/estimator') },
  {
    id: 'storm',
    label: 'Storm Tracer',
    icon: 'map-outline',
    tone: 'blue',
    go: (r) => r.push({ pathname: '/(tabs)/map', params: { filter: 'storms' } } as any),
  },
  { id: 'knock', label: 'Knock Route', icon: 'walk-outline', tone: 'purple', go: (r) => r.push('/door-knocking') },
  { id: 'finder', label: 'Where Should I Knock?', icon: 'compass-outline', tone: 'orange', go: (r) => r.push('/knock-finder') },
  { id: 'plan', label: 'Schedule', icon: 'calendar-outline', tone: 'quiet', go: (r) => r.push('/(tabs)/plan' as any) },
];

export function QuickActionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Quick Actions"
      subtitle="Capture work in seconds — everything lands in the pipeline."
      accessibilityLabel="Quick actions"
    >
      <View style={styles.grid}>
        {ACTIONS.map((a) => (
          <PressableScale
            key={a.id}
            style={styles.tile}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => {
              onClose();
              // Let the sheet finish leaving before the push, so the new
              // screen does not fight the dismiss animation.
              setTimeout(() => a.go(router), 120);
            }}
          >
            <IconChip name={a.icon} tone={a.tone} size="md" />
            <Text style={styles.tileLabel} numberOfLines={2}>
              {a.label}
            </Text>
          </PressableScale>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Two per row; tall enough that a gloved thumb never misses (Drift #1).
  tile: {
    width: '47%',
    minHeight: touchTarget.preferred * 2,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    justifyContent: 'space-between',
  },
  tileLabel: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.brand },
});
