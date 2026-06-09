import { useMemo } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function StormAlertDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const alert = useStormAlertStore((s) => s.alerts.find((a) => a.id === id));
  const dismiss = useStormAlertStore((s) => s.dismiss);
  const markActedOn = useStormAlertStore((s) => s.markActedOn);
  const inspections = useInspectionStore((s) => s.inspections);

  const inAreaInspections = useMemo(() => {
    if (!alert) return [];
    const state = alert.areaLabel.match(/,\s*([A-Z]{2})/)?.[1]?.toLowerCase();
    const city = alert.areaLabel
      .replace(/,\s*[A-Z]{2}.*$/, '')
      .trim()
      .toLowerCase();
    return inspections.filter((ins) => {
      const addr = ins.address.toLowerCase();
      if (state && !addr.includes(state)) return false;
      if (city && !addr.includes(city)) return false;
      return true;
    });
  }, [alert, inspections]);

  if (!alert) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyText}>Alert not found.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const onDismiss = () => {
    dismiss(alert.id);
    router.back();
  };

  const onAct = () => {
    markActedOn(alert.id);
    router.replace('/(tabs)/map');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.headerTitle}>Storm Alert</Text>
        <Pressable onPress={onDismiss} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroChip}>
            <Ionicons name="thunderstorm" size={14} color={colors.textInverse} />
            <Text style={styles.heroChipText}>
              {alert.eventKind === 'hail'
                ? 'Severe Hail'
                : alert.eventKind === 'wind'
                ? 'Severe Wind'
                : 'Severe Storm'}
            </Text>
          </View>
          <Text style={styles.heroArea}>{alert.areaLabel}</Text>
          <Text style={styles.heroSub}>
            {new Date(alert.firedAt).toLocaleString(undefined, {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          </Text>
        </View>

        <View style={styles.statRow}>
          {alert.hailSizeInches && (
            <Stat label="Hail size" value={`${alert.hailSizeInches.toFixed(2)}"`} />
          )}
          {alert.windSpeedMph && (
            <Stat label="Wind speed" value={`${alert.windSpeedMph} mph`} />
          )}
          <Stat label="In range" value={String(alert.propertyCount)} />
        </View>

        <Text style={styles.sectionLabel}>Your properties in the impacted area</Text>
        {inAreaInspections.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="home-outline" size={28} color={colors.slate} />
            <Text style={styles.emptyCardText}>
              None of your saved properties are in this area yet.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {inAreaInspections.map((ins, i) => (
              <Pressable
                key={ins.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => router.push(`/job/${ins.id}` as any)}
              >
                <Ionicons name="home" size={20} color={colors.orange} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{ins.customerName}</Text>
                  <Text style={styles.rowSub}>{ins.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.slate} />
              </Pressable>
            ))}
          </View>
        )}

        <Pressable style={styles.primaryBtn} onPress={onAct}>
          <Ionicons name="map" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Open Map</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={() => router.push('/door-knocking')}>
          <Ionicons name="walk-outline" size={20} color={colors.navy} />
          <Text style={styles.secondaryBtnText}>Start knocking route</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.navy,
  },
  headerBtn: { padding: spacing.xs },
  headerTitle: { flex: 1, color: colors.textInverse, fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, textAlign: 'center' },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },

  hero: { gap: spacing.sm },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  heroChipText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroArea: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy, marginTop: spacing.sm },
  heroSub: { fontSize: fontSize.bodyMd, color: colors.slate },

  statRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  statValue: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.orange },
  statLabel: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs },

  sectionLabel: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  rowSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyCardText: { color: colors.slate, fontSize: fontSize.bodyMd, textAlign: 'center' },

  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  secondaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },
});
