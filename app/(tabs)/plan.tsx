import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type PlanView = 'today' | 'week';

export default function PlanScreen() {
  const [view, setView] = useState<PlanView>('today');

  const today = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Plan</Text>
        <Text style={styles.sub}>{today}</Text>
      </View>

      <View style={styles.segmented}>
        {(['today', 'week'] as const).map((v) => (
          <Pressable
            key={v}
            style={[styles.seg, view === v && styles.segActive]}
            onPress={() => setView(v)}
          >
            <Text style={[styles.segText, view === v && styles.segTextActive]}>
              {v === 'today' ? 'Today' : 'This week'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.empty}>
        <Ionicons name="calendar-outline" size={40} color={colors.slate} />
        <Text style={styles.emptyTitle}>Nothing scheduled</Text>
        <Text style={styles.emptyBody}>
          Inspections, installs, and meetings will appear here once you add them to a job.
        </Text>
      </View>

      <View style={styles.routeStub}>
        <Text style={styles.sectionLabel}>Suggested route</Text>
        <View style={styles.empty}>
          <Ionicons name="map-outline" size={32} color={colors.slate} />
          <Text style={styles.emptyBody}>
            Add at least one stop to your day and we'll build the shortest route.
          </Text>
        </View>
      </View>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: {},
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodyMd, color: colors.slate, marginTop: spacing.xs },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    padding: 4,
  },
  seg: {
    flex: 1,
    minHeight: touchTarget.small,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segActive: { backgroundColor: colors.surface, ...shadows.card },
  segText: { fontSize: fontSize.bodyMd, color: colors.slate, fontWeight: fontWeight.medium },
  segTextActive: { color: colors.navy, fontWeight: fontWeight.semibold },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  emptyBody: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
  },

  routeStub: { gap: spacing.sm },
  sectionLabel: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
});
