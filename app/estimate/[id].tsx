// A saved estimate — the property and the numbers, not the wizard.
//
// Owner: "when user presses a saved estimate, it goes to the page where you
// can start a new estimation. it needs to show the property information and
// the estimate." There was no detail route at all; the Home tile pushed the
// wizard from step 0. This is the page it should have opened.

import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDate } from '@/lib/format/date';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { RoofOverheadView } from '@/components/RoofOverheadView';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip } from '@/components/ui/IconChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { ROOF_MATERIAL_LABELS } from '@/lib/models/types';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { imageryIsStale } from '@/lib/services/solar';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const SCOPE_LABEL = {
  repair: 'Repair only',
  partial_replacement: 'Partial replacement',
  full_replacement: 'Full replacement',
} as const;

export default function SavedEstimateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const est = useEstimateStore((s) => s.estimates.find((e) => e.id === id));
  const remove = useEstimateStore((s) => s.remove);
  const setPrefill = useWizardPrefillStore((s) => s.set);

  if (!est) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Estimate" back={() => router.back()} />
        <View style={styles.empty}>
          <IconChip name="calculator-outline" tone="quiet" size="md" />
          <Text style={styles.emptyTitle}>This estimate isn't here any more</Text>
          <Text style={styles.emptyText}>It may have been deleted. Saved estimates are on the Home screen.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const m = est.measurement;
  const convertToJob = () => {
    setPrefill({
      source: 'estimate',
      address: est.address,
      addressLat: est.lat,
      addressLng: est.lng,
      material: est.material,
    });
    router.replace('/new-job');
  };

  const confirmDelete = () =>
    Alert.alert('Delete this estimate?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove(est.id);
          router.back();
        },
      },
    ]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Estimate"
        subtitle={`Saved ${formatDate(est.createdAt, 'recently')}`}
        back={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* The property first — where it is and what the roof looks like from above. */}
        <View style={styles.addressBlock}>
          <Ionicons name="location" size={18} color={colors.brand} />
          <Text style={styles.address}>{est.address || 'No address'}</Text>
        </View>

        {m ? (
          <RoofOverheadView planes={m.planes} bounds={m.bounds} center={m.center ?? (est.lat != null && est.lng != null ? { lat: est.lat, lng: est.lng } : undefined)} />
        ) : (
          <RichCard icon="create-outline" iconTone="blue" title="Squares entered by hand">
            <Text style={styles.cardSub}>
              This estimate was priced on a manual square count, so there is no aerial measurement to show.
              Re-estimate to measure the roof from imagery.
            </Text>
          </RichCard>
        )}

        <View style={styles.factsRow}>
          <View style={styles.fact}>
            <Text style={styles.factValue}>{est.totalSquares.toFixed(1)}</Text>
            <Text style={styles.factLabel}>SQUARES</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factValue}>{m ? m.planes.length : '—'}</Text>
            <Text style={styles.factLabel}>ROOF FACES</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factValue}>{m?.imageryDate ? m.imageryDate.slice(0, 4) : '—'}</Text>
            <Text style={styles.factLabel}>IMAGERY</Text>
          </View>
        </View>
        {m && imageryIsStale(m.imageryDate) && (
          <View style={styles.notice}>
            <Ionicons name="time-outline" size={16} color={colors.warn} />
            <Text style={styles.noticeText}>Imagery is more than 2 years old — verify on site.</Text>
          </View>
        )}

        <SectionHeader title="Estimate" />
        <View style={styles.priceCard}>
          <View style={styles.chipRow}>
            <Pill label={ROOF_MATERIAL_LABELS[est.material]} tone="neutral" size="sm" />
            <Pill label={SCOPE_LABEL[est.scope]} tone="brand" size="sm" />
          </View>
          <Text style={styles.priceLabel}>Estimated cost range</Text>
          <Text style={styles.priceMid}>${est.totalMid.toLocaleString()}</Text>
          <Text style={styles.priceRange}>
            ${est.totalLow.toLocaleString()} — ${est.totalHigh.toLocaleString()}
          </Text>
          <Text style={styles.priceFoot}>
            Priced per square on {est.totalSquares.toFixed(1)} squares. A saved estimate is a snapshot —
            re-estimate for today's regional pricing.
          </Text>
        </View>

        <SectionHeader title="Actions" />
        <View style={styles.actions}>
          <PressableScale
            style={styles.primary}
            accessibilityRole="button"
            accessibilityLabel="Convert this estimate to a job"
            onPress={convertToJob}
          >
            <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
            <Text style={styles.primaryText}>Convert to job</Text>
          </PressableScale>
          <View style={styles.secondaryRow}>
            <PressableScale
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Start a new estimate for this address"
              onPress={() => {
                setPrefill({
                  source: 'estimate',
                  address: est.address,
                  addressLat: est.lat,
                  addressLng: est.lng,
                  material: est.material,
                });
                router.push('/estimator');
              }}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.text} />
              <Text style={styles.secondaryText}>Re-estimate</Text>
            </PressableScale>
            <PressableScale
              style={styles.secondary}
              accessibilityRole="button"
              accessibilityLabel="Delete this estimate"
              onPress={confirmDelete}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.secondaryText, { color: colors.danger }]}>Delete</Text>
            </PressableScale>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  addressBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  address: { flex: 1, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  factsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
  },
  fact: { flex: 1, gap: 2 },
  factValue: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  factLabel: { fontSize: fontSize.caption, color: colors.textSubtle, fontWeight: fontWeight.semibold, letterSpacing: 0.4 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noticeText: { flex: 1, fontSize: fontSize.bodySm, color: colors.warn },
  priceCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.raised,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  priceLabel: { fontSize: fontSize.bodySm, color: colors.textSubtle, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceMid: { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  priceRange: { fontSize: fontSize.bodyMd, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  priceFoot: { marginTop: spacing.sm, fontSize: fontSize.caption, color: colors.textSubtle, lineHeight: 15 },
  cardSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  actions: { gap: spacing.sm },
  primary: {
    minHeight: touchTarget.preferred,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
  },
  primaryText: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.textInverse },
  secondaryRow: { flexDirection: 'row', gap: spacing.sm },
  secondary: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  secondaryText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  emptyText: { fontSize: fontSize.bodyMd, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
