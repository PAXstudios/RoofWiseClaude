import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { IconChip } from '@/components/ui/IconChip';
import { AddressAutocomplete, type ResolvedLocation } from '@/components/AddressAutocomplete';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
// The measurement instrument is Google's Solar API; on screen it is "roof
// measurement" (owner directive — no "solar" in user-facing copy).
import {
  measureRoof,
  type RoofMeasurement,
  SolarNotFoundError,
  imageryIsStale,
} from '@/lib/services/solar';
import { geocodeText } from '@/lib/services/geocoding';
import { describeGoogleApiError } from '@/lib/services/googleApi';
import {
  estimateCost,
  regionForState,
  type CostEstimate,
  type DamageScope,
} from '@/lib/services/costEstimator';
import {
  ROOF_MATERIAL_LABELS,
  type RoofMaterial,
} from '@/lib/models/types';

type Step = 0 | 1 | 2 | 3;

type Draft = {
  address: string;
  lat?: number;
  lng?: number;
  measurement?: RoofMeasurement;
  manualSquares?: number;
  material: RoofMaterial;
  scope: DamageScope;
};

const MATERIAL_CHOICES: RoofMaterial[] = [
  'three_tab_asphalt',
  'architectural_asphalt',
  'metal_standing_seam',
  'wood_shake',
  'clay_tile',
  'slate',
];

const SCOPE_CHOICES: { id: DamageScope; label: string; sub: string }[] = [
  { id: 'repair', label: 'Repair only', sub: 'Spot fixes — minor damage' },
  { id: 'partial_replacement', label: 'Partial replacement', sub: 'One or two slopes' },
  { id: 'full_replacement', label: 'Full replacement', sub: 'Whole-roof tear-off' },
];

export default function CostEstimatorScreen() {
  const router = useRouter();
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const saveEstimate = useEstimateStore((s) => s.save);
  const toast = useToastStore((s) => s.show);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>({
    address: '',
    material: 'architectural_asphalt',
    scope: 'full_replacement',
  });
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convertToJob = () => {
    setPrefill({
      source: 'estimate',
      address: draft.address,
      addressLat: draft.lat,
      addressLng: draft.lng,
      material: draft.material,
    });
    router.replace('/new-job');
  };

  const totalSquares = draft.measurement?.totalSquares ?? draft.manualSquares ?? 0;
  const estimate: CostEstimate | null =
    totalSquares > 0
      ? estimateCost({
          material: draft.material,
          region: regionForState(),
          scope: draft.scope,
          totalSquares,
        })
      : null;

  const runMeasurement = async () => {
    if (draft.address.trim().length === 0) return;
    setMeasuring(true);
    setError(null);
    try {
      // A hand-typed address (Places refused, or no suggestion picked) has no
      // coordinates yet — look them up first so measurement is never gated on
      // autocomplete working.
      let lat = draft.lat;
      let lng = draft.lng;
      if (lat === undefined || lng === undefined) {
        const g = await geocodeText(draft.address.trim());
        if (!g) {
          setError('Couldn\'t find that address on the map. Check the spelling, or enter squares manually below.');
          return;
        }
        lat = g.lat;
        lng = g.lng;
      }
      const m = await measureRoof({ lat, lng });
      setDraft({ ...draft, lat, lng, measurement: m });
    } catch (e) {
      if (e instanceof SolarNotFoundError) {
        setError('No aerial measurement available for this address — enter squares manually below.');
      } else {
        // A refused key says which Google API to enable; everything else is
        // the honest generic line. Manual entry stays available underneath.
        setError(
          describeGoogleApiError(e) ??
            (e instanceof Error ? e.message : 'Roof measurement didn\'t work — enter squares manually below.'),
        );
      }
    } finally {
      setMeasuring(false);
    }
  };

  const onLocation = (loc: ResolvedLocation) =>
    setDraft({ ...draft, address: loc.address, lat: loc.lat, lng: loc.lng, measurement: undefined });

  const canAdvance =
    (step === 0 && draft.address.trim().length > 0) ||
    (step === 1 && totalSquares > 0) ||
    step === 2 ||
    step === 3;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 0 ? router.back() : setStep((step - 1) as Step))}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <Ionicons name={step === 0 ? 'close' : 'chevron-back'} size={24} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepCount}>Step {step + 1} of 4</Text>
          <Text style={styles.stepTitle}>{['Address', 'Roof measurement', 'Damage scope', 'Result'][step]}</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step + 1) * 25}%` }]} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <View style={{ gap: spacing.lg }}>
              <Text style={styles.helper}>Enter the property address. We'll measure the roof from aerial imagery — or you can enter squares by hand on the next step.</Text>
              <AddressAutocomplete
                value={draft.address}
                onChangeText={(t) =>
                  setDraft({ ...draft, address: t, lat: undefined, lng: undefined, measurement: undefined })
                }
                onPlaceSelected={(p) =>
                  setDraft({ ...draft, address: p.description, lat: p.lat, lng: p.lng })
                }
                onLocationSelected={onLocation}
              />
            </View>
          )}

          {step === 1 && (
            <View style={{ gap: spacing.lg }}>
              {!draft.measurement && (
                <View style={styles.card}>
                  <IconChip name="globe-outline" tone="orange" />
                  <Text style={styles.cardTitle}>Measure the roof from the air</Text>
                  <Text style={styles.cardSub}>
                    {draft.lat !== undefined
                      ? 'Tap below to measure each slope from aerial imagery.'
                      : 'We\'ll look up the address you typed, then measure each slope from aerial imagery.'}
                  </Text>
                  <Pressable
                    style={[styles.secondaryBtn, draft.address.trim().length === 0 && { opacity: 0.4 }]}
                    disabled={draft.address.trim().length === 0 || measuring}
                    onPress={runMeasurement}
                    accessibilityRole="button"
                    accessibilityLabel="Measure roof"
                  >
                    {measuring ? (
                      <ActivityIndicator color={colors.textInverse} />
                    ) : (
                      <Text style={styles.secondaryBtnText}>Measure roof</Text>
                    )}
                  </Pressable>
                  {error && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="warning-outline" size={16} color={colors.danger} />
                      <Text style={styles.errorText}>{error}</Text>
                    </View>
                  )}
                </View>
              )}

              {draft.measurement && (
                <View style={styles.card}>
                  <IconChip name="layers-outline" tone="green" />
                  <Text style={styles.cardTitle}>{draft.measurement.totalSquares.toFixed(1)} squares</Text>
                  <Text style={styles.cardSub}>
                    {draft.measurement.slopes.length} slopes measured
                    {'  ·  Imagery '}{draft.measurement.imageryDate}
                    {'  ·  Quality '}{draft.measurement.imageryQuality}
                  </Text>
                  {imageryIsStale(draft.measurement.imageryDate) && (
                    <View style={styles.warnBanner}>
                      <Ionicons name="time-outline" size={16} color={colors.warn} />
                      <Text style={styles.warnText}>Imagery is more than 2 years old — verify on-site.</Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.card}>
                <Text style={styles.cardSub}>
                  Prefer to enter measurements by hand?
                </Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() =>
                      setDraft({ ...draft, manualSquares: Math.max(0, (draft.manualSquares ?? 0) - 1) })
                    }
                  >
                    <Ionicons name="remove" size={22} color={colors.navy} />
                  </Pressable>
                  <Text style={styles.stepperValue}>
                    {(draft.manualSquares ?? 0).toFixed(0)} sq
                  </Text>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setDraft({ ...draft, manualSquares: (draft.manualSquares ?? 0) + 1 })}
                  >
                    <Ionicons name="add" size={22} color={colors.navy} />
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {step === 2 && (
            <View style={{ gap: spacing.lg }}>
              <Text style={styles.subSection}>Material</Text>
              <View style={styles.chipWrap}>
                {MATERIAL_CHOICES.map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.bigChip, draft.material === m && styles.bigChipSelected]}
                    onPress={() => setDraft({ ...draft, material: m })}
                  >
                    <Text style={[styles.bigChipText, draft.material === m && styles.bigChipTextSelected]}>
                      {ROOF_MATERIAL_LABELS[m]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.subSection}>Scope</Text>
              {SCOPE_CHOICES.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.scopeCard, draft.scope === s.id && styles.scopeCardSelected]}
                  onPress={() => setDraft({ ...draft, scope: s.id })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.scopeTitle, draft.scope === s.id && styles.scopeTitleSel]}>
                      {s.label}
                    </Text>
                    <Text style={[styles.scopeSub, draft.scope === s.id && styles.scopeSubSel]}>
                      {s.sub}
                    </Text>
                  </View>
                  {draft.scope === s.id && (
                    <Ionicons name="checkmark-circle" size={22} color={colors.cream} />
                  )}
                </Pressable>
              ))}
            </View>
          )}

          {step === 3 && estimate && (
            <View style={{ gap: spacing.lg }}>
              <View style={styles.priceCard}>
                <Text style={styles.priceLabel}>Estimated cost range</Text>
                <Text style={styles.priceMid}>${estimate.totalMid.toLocaleString()}</Text>
                <Text style={styles.priceRange}>
                  ${estimate.totalLow.toLocaleString()} — ${estimate.totalHigh.toLocaleString()}
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Line items</Text>
                {estimate.lineItems.map((li) => (
                  <View key={li.key} style={styles.lineItem}>
                    <Text style={styles.lineItemLabel}>{li.label}</Text>
                    <Text style={styles.lineItemValue}>
                      ${Math.round(li.unitPriceLow * li.quantity).toLocaleString()} – ${Math.round(li.unitPriceHigh * li.quantity).toLocaleString()}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Pressable
                  style={[styles.secondarySaveBtn, { flex: 1 }]}
                  onPress={() => {
                    saveEstimate({
                      address: draft.address,
                      lat: draft.lat,
                      lng: draft.lng,
                      material: draft.material,
                      scope: draft.scope,
                      totalSquares,
                      totalLow: estimate.totalLow,
                      totalMid: estimate.totalMid,
                      totalHigh: estimate.totalHigh,
                    });
                    toast({ tone: 'success', title: 'Estimate saved' });
                  }}
                >
                  <Ionicons name="bookmark-outline" size={18} color={colors.navy} />
                  <Text style={styles.secondarySaveText}>Save</Text>
                </Pressable>
                <Pressable style={[styles.convertBtn, { flex: 1 }]} onPress={convertToJob}>
                  <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
                  <Text style={styles.convertBtnText}>Convert to job</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryBtn, !canAdvance && styles.primaryBtnDisabled]}
            disabled={!canAdvance}
            onPress={() => {
              if (step === 3) router.back();
              else setStep((step + 1) as Step);
            }}
          >
            <Text style={styles.primaryBtnText}>
              {step === 3 ? 'Done' : 'Next'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  },
  headerBtn: { padding: spacing.xs },
  stepCount: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold },
  stepTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },

  progressTrack: { height: 4, backgroundColor: colors.surfaceMuted, marginHorizontal: spacing.xl, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.orange, borderRadius: 2 },

  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },

  helper: { fontSize: fontSize.bodyMd, color: colors.slate },

  // Raised content-card rung, matching the crafted cards on Home/Leads/Job.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.raised,
  },
  cardTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.slate },

  secondaryBtn: {
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  secondaryBtnText: { color: colors.textInverse, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },

  warnBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  warnText: { color: colors.navy, fontSize: fontSize.bodySm, flex: 1 },

  errorBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, flex: 1 },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  stepperBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepperValue: { flex: 1, textAlign: 'center', fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.navy },

  subSection: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bigChip: {
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigChipSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  bigChipText: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  bigChipTextSelected: { color: colors.textInverse },

  scopeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  scopeCardSelected: { backgroundColor: colors.navy },
  scopeTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },
  scopeTitleSel: { color: colors.textInverse },
  scopeSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  scopeSubSel: { color: 'rgba(240,240,228,0.78)' },

  priceCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.card,
  },
  priceLabel: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.bodyMd, marginBottom: spacing.sm },
  priceMid: { color: colors.orange, fontSize: 48, fontWeight: fontWeight.bold },
  priceRange: { color: colors.cream, fontSize: fontSize.bodyMd, marginTop: spacing.xs },

  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineItemLabel: { fontSize: fontSize.bodyMd, color: colors.navy },
  lineItemValue: { fontSize: fontSize.bodyMd, color: colors.slate, fontWeight: fontWeight.medium },

  footer: {
    padding: spacing.xl,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  primaryBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },

  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
  },
  convertBtnText: { color: colors.textInverse, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },

  secondarySaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  secondarySaveText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
