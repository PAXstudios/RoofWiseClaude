import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useTrainingQueueStore } from '@/lib/stores/trainingQueueStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function TrainScreen() {
  const router = useRouter();
  const corrections = useCorrectionsStore((s) => s.corrections);
  const queueItems = useTrainingQueueStore((s) => s.items);

  const pendingCount = useMemo(
    () => queueItems.filter((i) => i.status === 'pending').length,
    [queueItems],
  );
  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);

  return (
    <View style={styles.root}>
    <ScreenHeader title="Train" subtitle="Inspector review queue + AI calibration" />
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.tilesRow}>
        <Pressable
          style={[styles.tile, styles.tilePrimary]}
          onPress={() => router.push('/swipe-review')}
        >
          <View style={styles.tileTopRow}>
            <Ionicons name="layers-outline" size={20} color={colors.textInverse} />
            <Text style={styles.tilePrimaryCount}>{pendingCount}</Text>
          </View>
          <Text style={styles.tilePrimaryLabel}>Pending review</Text>
          <Text style={styles.tilePrimarySub}>
            {pendingCount === 0
              ? 'All caught up.'
              : 'Photos waiting on your verdict'}
          </Text>
        </Pressable>

        <View style={[styles.tile, styles.tileSecondary]}>
          <View style={styles.tileTopRow}>
            <Ionicons name="bar-chart-outline" size={20} color={colors.navy} />
            <Text style={styles.tileSecondaryCount}>
              {accuracy === null ? '—' : `${accuracy}%`}
            </Text>
          </View>
          <Text style={styles.tileSecondaryLabel}>Calibration accuracy</Text>
          <Text style={styles.tileSecondarySub}>
            {accuracy === null
              ? `Available after 5 corrections (${corrections.length}/5)`
              : `From ${corrections.length} corrections`}
          </Text>
        </View>
      </View>

      <Section title="AI Calibration">
        <View style={styles.row}>
          <Ionicons name="git-branch-outline" size={20} color={colors.slate} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Calibrating to your inspection style</Text>
            <Text style={styles.rowSub}>{corrections.length} corrections recorded</Text>
          </View>
        </View>
      </Section>

      <Section title="Field tools">
        <Row
          icon="compass-outline"
          label="Pitch gauge"
          sub="Measure roof slope with the accelerometer"
          onPress={() => router.push('/pitch-gauge')}
        />
        <Row
          icon="bulb-outline"
          label="Damage explainer"
          sub="What each damage type looks like"
          onPress={() => router.push('/damage-explainer')}
        />
        <Row
          icon="walk-outline"
          label="Door knocking"
          sub="Live route stats + outcome logging"
          onPress={() => router.push('/door-knocking')}
        />
      </Section>

      <Section title="Lessons">
        <View style={styles.empty}>
          <Ionicons name="school-outline" size={32} color={colors.slate} />
          <Text style={styles.emptyText}>Lessons will appear here. Coming soon.</Text>
        </View>
      </Section>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.slate} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: {},
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodyMd, color: colors.slate, marginTop: spacing.xs },

  tilesRow: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    minHeight: 130,
    ...shadows.card,
  },
  tilePrimary: { backgroundColor: colors.navy },
  tileSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tilePrimaryCount: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.textInverse },
  tilePrimaryLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textInverse },
  tilePrimarySub: { fontSize: fontSize.bodySm, color: 'rgba(255,255,255,0.78)' },
  tileSecondaryCount: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },
  tileSecondaryLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  tileSecondarySub: { fontSize: fontSize.bodySm, color: colors.slate },

  sectionTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.standard },
  rowLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium, color: colors.navy },
  rowSub: { fontSize: fontSize.bodySm, color: colors.slate },

  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  emptyText: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
});
