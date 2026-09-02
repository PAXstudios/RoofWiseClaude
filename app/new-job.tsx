import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  type BrittlenessResult,
  type BrittlenessTest,
  type CauseOfLoss,
  type CollateralChecklistItem,
  type CollateralEvidence,
  type CollateralZone,
  type InspectionKind,
  type InsuranceCarrier,
  type PolicyType,
  type RoofGeometry,
  type RoofCondition,
  type RoofMaterial,
  type StormEvent,
  CAUSES_OF_LOSS,
  CAUSE_OF_LOSS_LABELS,
  COLLATERAL_ZONES,
  COLLATERAL_ZONE_HINTS,
  COLLATERAL_ZONE_LABELS,
  INSURANCE_CARRIER_LABELS,
  INSURANCE_CARRIER_TIER,
  POLICY_TYPE_LABELS,
  ROOF_MATERIAL_LABELS,
  emptyCollateralEvidence,
  isDeductibleHigh,
  isStormCause,
} from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import {
  DOL_MATCH_WINDOW_DAYS,
  matchStorm,
  tripleCheckDateOfLoss,
} from '@/lib/services/stormMatch';
import { formatDate, formatDateShort } from '@/lib/format/date';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';

// Step model. General inspections keep the original 4-step flow untouched;
// Insurance Claim mode swaps the Insurance step for the fuller Claim & Policy
// questionnaire (§VI) and adds a Claim Evidence step (§VII–IX).
type StepKey = 'customer' | 'insurance' | 'claim' | 'roof' | 'evidence' | 'review';

const GENERAL_STEPS: StepKey[] = ['customer', 'insurance', 'roof', 'review'];
const CLAIM_STEPS: StepKey[] = ['customer', 'claim', 'roof', 'evidence', 'review'];

const STEP_TITLES: Record<StepKey, string> = {
  customer: 'Customer & Property',
  insurance: 'Insurance',
  claim: 'Claim & Policy',
  roof: 'Roof System',
  evidence: 'Claim Evidence',
  review: 'Review',
};

type Draft = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  addressLat?: number;
  addressLng?: number;

  carrier: InsuranceCarrier | null;
  policyNumber: string;
  claimNumber: string;
  adjusterName: string;

  material: RoofMaterial | null;
  ageYears: number;
  geometry: RoofGeometry | null;
  condition: RoofCondition | null;
  brittlenessTest: BrittlenessTest;

  // Insurance Claim mode
  kind: InspectionKind;
  causeOfLoss: CauseOfLoss | null;
  /**
   * Canonical date of loss — an ISO timestamp at LOCAL noon, or '' when the
   * inspector has not entered a complete date yet. Every downstream reader
   * (Triple-Check, HAAG report header, Long Report §03) parses this as a
   * date, so free text can never be stored here: an unparseable DOL silently
   * disables the storm corroboration the whole claim rests on.
   */
  dateOfLoss: string;
  /** Raw MM / DD / YYYY entry boxes. `dateOfLoss` is derived from these. */
  dolMonth: string;
  dolDay: string;
  dolYear: string;
  policyType: PolicyType | null;
  deductible: string;              // free text, parsed on save
  homeValue: string;               // free text, parsed on save
  priorClaimsWithin3Years: boolean | null;
  collateral: CollateralEvidence;
  brittlenessResult: BrittlenessResult | null;
  brittlenessPhotoIds: string[];
  brittlenessNotes: string;
  codeComplianceNotes: string;
};

const EMPTY: Draft = {
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  address: '',
  addressLat: undefined,
  addressLng: undefined,
  carrier: null,
  policyNumber: '',
  claimNumber: '',
  adjusterName: '',
  material: null,
  ageYears: 0,
  geometry: null,
  condition: null,
  brittlenessTest: 'not_tested',
  kind: 'general',
  causeOfLoss: null,
  dateOfLoss: '',
  dolMonth: '',
  dolDay: '',
  dolYear: '',
  policyType: null,
  deductible: '',
  homeValue: '',
  priorClaimsWithin3Years: null,
  collateral: emptyCollateralEvidence(),
  brittlenessResult: null,
  brittlenessPhotoIds: [],
  brittlenessNotes: '',
  codeComplianceNotes: '',
};

// ---------- Date of loss ----------
//
// The date of loss is the anchor the carrier checks the whole claim against:
// NOAA storm corroboration, the ±72h HAAG high-confidence window, and the
// Triple-Check discrepancy flag all key off it. So it is captured as a real
// calendar date, never as free text.
//
// STORED AS LOCAL NOON. A bare 'YYYY-MM-DD' parses as UTC midnight, which
// renders as the *previous* day in every US timezone — an off-by-one on the
// one date an adjuster will actually verify. Local noon survives any real
// device offset.

/** MM / DD / YYYY entry boxes → a real calendar date, or null if incomplete/impossible. */
function partsToDate(month: string, day: string, year: string): Date | null {
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  // Rejects rollovers like 02/30 (which JS would silently turn into Mar 2).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Apply an MM/DD/YYYY edit and re-derive the canonical ISO value in one step. */
function withDateParts(
  draft: Draft,
  parts: { dolMonth?: string; dolDay?: string; dolYear?: string },
): Draft {
  const next = { ...draft, ...parts };
  const date = partsToDate(next.dolMonth, next.dolDay, next.dolYear);
  return { ...next, dateOfLoss: date ? date.toISOString() : '' };
}

/** Set the date of loss from a Date (quick-pick chips). */
function withDate(draft: Draft, date: Date): Draft {
  return {
    ...draft,
    dolMonth: String(date.getMonth() + 1),
    dolDay: String(date.getDate()),
    dolYear: String(date.getFullYear()),
    dateOfLoss: new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12,
      0,
      0,
      0,
    ).toISOString(),
  };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const DOL_PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: '1 week ago', days: 7 },
  { label: '2 weeks ago', days: 14 },
  { label: '1 month ago', days: 30 },
];

/**
 * NOAA cross-check state for the entered date of loss. Kept at wizard level so
 * stepping back and forth does not re-hit the storm-history service, and so
 * `save()` can reuse the answer instead of asking twice.
 *
 * Drift #5: `unavailable` is surfaced as "not available", never collapsed into
 * "no storm found".
 */
type StormLookup =
  | { key: string; status: 'loading' }
  | { key: string; status: 'matched'; event: StormEvent }
  | { key: string; status: 'no_match' }
  | { key: string; status: 'unavailable'; reason: string };

/** NOAA queries are per-state; the state abbreviation comes from the address. */
function stateFromAddress(address: string): string | undefined {
  return address.match(/,\s*([A-Z]{2})/)?.[1];
}

function stormLookupKey(lat: number, lng: number, state: string, dolIso: string): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${state},${dolIso.slice(0, 10)}`;
}

function parseMoney(t: string): number | undefined {
  const cleaned = t.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatMoney(n: number | undefined): string {
  return n === undefined ? '—' : `$${n.toLocaleString()}`;
}

// Stable identity — an inline options object re-presents the modal on every
// render via navigation.setOptions (see estimator.tsx for the full rationale).
const MODAL_SCREEN_OPTIONS = {
  headerShown: false,
  presentation: 'modal',
  animation: 'slide_from_bottom',
} as const;

export default function NewJobWizard() {
  const router = useRouter();
  const createInspection = useInspectionStore((s) => s.create);
  const setEvent = useInspectionStore((s) => s.setEvent);
  const setStormSearchOutcome = useInspectionStore((s) => s.setStormSearchOutcome);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const consumePrefill = useWizardPrefillStore((s) => s.consume);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [stormLookup, setStormLookup] = useState<StormLookup | null>(null);
  const stormKeyRef = useRef<string | null>(null);

  const steps = draft.kind === 'insurance_claim' ? CLAIM_STEPS : GENERAL_STEPS;
  const stepKey = steps[stepIndex];

  // Thin ink progress bar — the fill springs to the new step's fraction
  // instead of snapping (motion.snappy, measured track width).
  const [progressTrackW, setProgressTrackW] = useState(0);
  const progressW = useSharedValue(0);
  const progressFraction = (stepIndex + 1) / steps.length;
  useEffect(() => {
    if (progressTrackW > 0) {
      progressW.value = withSpring(progressTrackW * progressFraction, motion.snappy);
    }
  }, [progressTrackW, progressFraction, progressW]);
  const progressStyle = useAnimatedStyle(() => ({ width: progressW.value }));

  // Hydrate from the prefill store (e.g. Lead → Convert flow). One-shot.
  useEffect(() => {
    const prefill = consumePrefill();
    if (!prefill) return;
    setDraft({
      ...EMPTY,
      customerName: prefill.customerName ?? '',
      customerPhone: prefill.customerPhone ?? '',
      customerEmail: prefill.customerEmail ?? '',
      address: prefill.address ?? '',
      addressLat: prefill.addressLat,
      addressLng: prefill.addressLng,
      carrier: prefill.carrier ?? null,
      policyNumber: prefill.policyNumber ?? '',
      claimNumber: prefill.claimNumber ?? '',
      adjusterName: prefill.adjusterName ?? '',
      material: prefill.material ?? null,
      ageYears: prefill.ageYears ?? 0,
      geometry: prefill.geometry ?? null,
      condition: prefill.condition ?? null,
    });
    if (prefill.source) {
      toast({
        tone: 'info',
        title: prefill.source === 'lead' ? 'Lead prefilled' : 'Estimate prefilled',
        body: prefill.customerName ?? prefill.address,
      });
    }
  }, [consumePrefill, toast]);

  // NOAA cross-check for the entered date of loss. Runs only once the
  // inspector has given us a real date and a geocoded address in a known
  // state — the ±30-day search window is anchored on the reported DOL, so
  // without one there is nothing meaningful to search around. Re-runs only
  // when that anchor actually changes (keyed), so editing other fields costs
  // nothing.
  const { kind, causeOfLoss, addressLat, addressLng, address, dateOfLoss } = draft;
  useEffect(() => {
    const state = stateFromAddress(address);
    const dol = dateOfLoss ? new Date(dateOfLoss) : null;
    const usable =
      kind === 'insurance_claim' &&
      isStormCause(causeOfLoss) &&
      addressLat !== undefined &&
      addressLng !== undefined &&
      !!state &&
      !!dol &&
      !Number.isNaN(dol.getTime());

    if (!usable) {
      stormKeyRef.current = null;
      // Functional update: returns the same reference when already null, so
      // this cannot loop.
      setStormLookup((prev) => (prev ? null : prev));
      return;
    }

    const key = stormLookupKey(addressLat!, addressLng!, state!, dateOfLoss);
    if (stormKeyRef.current === key) return;
    stormKeyRef.current = key;
    setStormLookup({ key, status: 'loading' });

    let cancelled = false;
    matchStorm({ lat: addressLat!, lng: addressLng!, near: dol!, state: state! })
      .then((result) => {
        if (cancelled) return;
        setStormLookup(
          result.status === 'matched'
            ? { key, status: 'matched', event: result.event }
            : result.status === 'no_match'
              ? { key, status: 'no_match' }
              : { key, status: 'unavailable', reason: result.reason },
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setStormLookup({
          key,
          status: 'unavailable',
          reason: e instanceof Error ? e.message : 'Storm history service unreachable',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, causeOfLoss, addressLat, addressLng, address, dateOfLoss]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);

  const onBack = () => {
    if (stepIndex === 0) {
      if (dirty) confirmDiscard(router.back);
      else router.back();
      return;
    }
    setStepIndex(stepIndex - 1);
  };

  const canAdvance = (() => {
    switch (stepKey) {
      case 'customer':
        return draft.customerName.trim().length > 0 && draft.address.trim().length > 0;
      case 'insurance':
        return true;
      case 'claim':
        return draft.causeOfLoss !== null;
      case 'roof':
        return draft.material !== null && draft.geometry !== null && draft.condition !== null;
      case 'evidence':
        // A recorded brittleness result without photos of the test process is
        // not defensible evidence — block Next until at least one is attached.
        return draft.brittlenessResult === null || draft.brittlenessPhotoIds.length > 0;
      case 'review':
        return true;
    }
  })();

  const onNext = () => {
    if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
    else save();
  };

  const save = () => {
    if (!draft.material || !draft.geometry || !draft.condition) return;
    const isClaim = draft.kind === 'insurance_claim';
    const ins = createInspection({
      customerName: draft.customerName.trim(),
      customerPhone: draft.customerPhone.trim() || undefined,
      customerEmail: draft.customerEmail.trim() || undefined,
      address: draft.address.trim(),
      lat: draft.addressLat,
      lng: draft.addressLng,
      carrier: draft.carrier ?? undefined,
      policyNumber: draft.policyNumber.trim() || undefined,
      claimNumber: draft.claimNumber.trim() || undefined,
      adjusterName: draft.adjusterName.trim() || undefined,
      material: draft.material,
      ageYears: draft.ageYears,
      geometry: draft.geometry,
      condition: draft.condition,
      // In claim mode the field protocol owns brittleness; the store derives
      // the legacy field from the protocol result.
      brittlenessTest: isClaim ? undefined : draft.brittlenessTest,
      kind: draft.kind,
      causeOfLoss: isClaim ? draft.causeOfLoss ?? undefined : undefined,
      policyType: isClaim ? draft.policyType ?? undefined : undefined,
      deductible: isClaim ? parseMoney(draft.deductible) : undefined,
      homeValue: isClaim ? parseMoney(draft.homeValue) : undefined,
      priorClaimsWithin3Years: isClaim ? draft.priorClaimsWithin3Years ?? undefined : undefined,
      // Persisted for every claim cause, not just storm ones: a carrier
      // date-anchors any peril, and the Long Report's missing-data register
      // flags an absent DOL on every insurance claim.
      dateOfLoss: isClaim ? draft.dateOfLoss || undefined : undefined,
      collateralEvidence: isClaim ? draft.collateral : undefined,
      brittlenessProtocol:
        isClaim && draft.brittlenessResult !== null
          ? {
              result: draft.brittlenessResult,
              photoIds: draft.brittlenessPhotoIds,
              notes: draft.brittlenessNotes.trim() || undefined,
            }
          : undefined,
      codeComplianceNotes: isClaim ? draft.codeComplianceNotes.trim() || undefined : undefined,
    });
    logActivity({
      kind: 'job_created',
      inspectionId: ins.id,
      message: `Created ${isClaim ? 'insurance claim' : 'job'} ${ins.reportId} for ${ins.customerName}`,
    });

    // Background storm-match — auto-fill Inspection.event when a qualifying
    // NOAA storm exists within 5mi / ±30d of the property and the anchor date.
    //
    // Record how the search resolved: only a genuine 'no_match' lets the
    // decision engine treat "no weather event" as verified (§4 step 1);
    // 'unavailable' stays unknown — never synthesized either way (Drift #5).
    const applyStormOutcome = (
      outcome: 'matched' | 'no_match' | 'unavailable',
      event?: StormEvent,
    ) => {
      setStormSearchOutcome(ins.id, outcome);
      if (outcome === 'matched' && event) {
        setEvent(ins.id, event);
        toast({
          tone: 'success',
          title: 'Storm event matched',
          body: `NOAA ${event.kind}${event.hailSizeInches ? ` ${event.hailSizeInches.toFixed(2)}"` : ''}${event.windSpeedMph ? ` ${event.windSpeedMph}mph` : ''} · ${event.distanceMiles?.toFixed(1)}mi away`,
        });
      }
    };

    if (ins.lat !== undefined && ins.lng !== undefined) {
      const state = stateFromAddress(ins.address);
      if (state) {
        // Anchor on the reported date of loss when we have one — a storm from
        // four months ago is invisible to a ±30-day window around "today".
        const dol = ins.dateOfLoss ? new Date(ins.dateOfLoss) : null;
        const anchor = dol && !Number.isNaN(dol.getTime()) ? dol : new Date(ins.createdAt);
        const key = stormLookupKey(ins.lat, ins.lng, state, anchor.toISOString());
        // The wizard already asked NOAA this exact question while the
        // inspector typed the date — reuse a settled answer rather than spend
        // a second call on it. 'unavailable' is NOT settled: connectivity may
        // have come back, so that case falls through and retries.
        if (
          stormLookup &&
          stormLookup.key === key &&
          (stormLookup.status === 'matched' || stormLookup.status === 'no_match')
        ) {
          applyStormOutcome(
            stormLookup.status,
            stormLookup.status === 'matched' ? stormLookup.event : undefined,
          );
        } else {
          matchStorm({ lat: ins.lat, lng: ins.lng, near: anchor, state })
            .then((result) =>
              applyStormOutcome(
                result.status,
                result.status === 'matched' ? result.event : undefined,
              ),
            )
            .catch(() => {});
        }
      }
    }

    Alert.alert('Job created', `Report ${ins.reportId} saved locally.`, [
      // dismissTo, not replace: replace stacked a second tab shell (NAV-3).
      { text: 'Done', onPress: () => router.dismissTo('/(tabs)') },
    ]);
  };

  return (
    <>
      <Stack.Screen options={MODAL_SCREEN_OPTIONS} />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={10} style={styles.headerBtn}>
            <Ionicons
              name={stepIndex === 0 ? 'close' : 'chevron-back'}
              size={26}
              color={colors.navy}
            />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerStep}>Step {stepIndex + 1} of {steps.length}</Text>
            <Text style={styles.headerTitle}>{STEP_TITLES[stepKey]}</Text>
          </View>
        </View>

        <View
          style={styles.progressTrack}
          onLayout={(e) => setProgressTrackW(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.progressFill, progressStyle]} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={88}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              key={stepKey}
              entering={FadeInDown.springify()
                .mass(motion.snappy.mass)
                .damping(motion.snappy.damping)
                .stiffness(motion.snappy.stiffness)}
            >
              {stepKey === 'customer' && <CustomerStep draft={draft} setDraft={setDraft} />}
              {stepKey === 'insurance' && <InsuranceStep draft={draft} setDraft={setDraft} />}
              {stepKey === 'claim' && (
                <ClaimStep draft={draft} setDraft={setDraft} stormLookup={stormLookup} />
              )}
              {stepKey === 'roof' && <RoofStep draft={draft} setDraft={setDraft} />}
              {stepKey === 'evidence' && <EvidenceStep draft={draft} setDraft={setDraft} />}
              {stepKey === 'review' && (
                <ReviewStep
                  draft={draft}
                  onEdit={(k) => setStepIndex(Math.max(0, steps.indexOf(k)))}
                />
              )}
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, !canAdvance && styles.primaryBtnDisabled]}
              onPress={onNext}
              disabled={!canAdvance}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAdvance }}
            >
              <Text style={[styles.primaryBtnText, !canAdvance && styles.primaryBtnTextDisabled]}>
                {stepKey === 'review' ? 'Save job' : 'Next'}
              </Text>
              {stepKey !== 'review' && (
                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={canAdvance ? colors.textInverse : colors.textMuted}
                />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

function confirmDiscard(onConfirm: () => void) {
  Alert.alert('Discard new job?', 'Your draft will be lost.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onConfirm },
  ]);
}

// ---------- Evidence photo helpers (claim mode) ----------
//
// Claim evidence is photographic evidence: collateral-zone shots and the
// brittleness protocol end up in the carrier packet next to the slope photos,
// so they go through the SAME capture pipeline (lib/services/imagePipeline).
// Skipping it shipped full-resolution HEIC/JPEG originals straight into the
// persisted record — the exact payloads the 2560px ladder exists to keep from
// OOM-crashing Expo Go on large library images.

async function launchEvidenceCamera(onPicked: (uri: string) => void) {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera access needed',
        'Enable camera access in Settings to photograph claim evidence.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
    });
    if (result.canceled || result.assets.length === 0) return;
    onPicked(await prepareCapturedPhoto(result.assets[0].uri));
  } catch (e) {
    Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
  }
}

async function launchEvidenceLibrary(onPicked: (uri: string) => void) {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photos access needed',
        'Enable Photos access in Settings to attach existing images.',
      );
      return;
    }
    // Single-select + Compatible representation — same rationale as
    // quick-inspection.tsx (Expo Go multi-select double-reject crash; HEIC
    // originals fail to load without transcoding).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || result.assets.length === 0) return;
    onPicked(await prepareCapturedPhoto(result.assets[0].uri));
  } catch (e) {
    Alert.alert('Photo pick failed', e instanceof Error ? e.message : 'Unknown error');
  }
}

function addEvidencePhoto(onPicked: (uri: string) => void) {
  Alert.alert('Add evidence photo', undefined, [
    { text: 'Take photo', onPress: () => void launchEvidenceCamera(onPicked) },
    { text: 'Choose from library', onPress: () => void launchEvidenceLibrary(onPicked) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

function EvidencePhotoRow({
  photoIds,
  onAdd,
  onRemove,
}: {
  photoIds: string[];
  onAdd: (uri: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <View style={styles.photoRow}>
      {photoIds.map((uri, i) => (
        <Pressable
          key={`${uri}-${i}`}
          onPress={() =>
            Alert.alert('Remove photo?', 'It will be dropped from the claim evidence.', [
              { text: 'Keep', style: 'cancel' },
              { text: 'Remove', style: 'destructive', onPress: () => onRemove(i) },
            ])
          }
        >
          <Image source={{ uri }} style={styles.photoThumb} contentFit="cover" />
        </Pressable>
      ))}
      <Pressable style={styles.addPhotoBtn} onPress={() => addEvidencePhoto(onAdd)}>
        <Ionicons name="camera-outline" size={22} color={colors.navy} />
        <Text style={styles.addPhotoText}>Photo</Text>
      </Pressable>
    </View>
  );
}

// ---------- Step: Customer & Property (+ inspection type toggle) ----------

function CustomerStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <View style={styles.stepBody}>
      <View>
        <Text style={styles.subSection}>Inspection type</Text>
        <View style={styles.kindRow}>
          <KindCard
            title="General"
            sub="Condition check, no carrier involved"
            selected={draft.kind === 'general'}
            onPress={() => setDraft({ ...draft, kind: 'general' })}
          />
          <KindCard
            title="Insurance Claim"
            sub="Build the evidence a carrier needs"
            selected={draft.kind === 'insurance_claim'}
            onPress={() => setDraft({ ...draft, kind: 'insurance_claim' })}
          />
        </View>
        {draft.kind === 'insurance_claim' && (
          <Text style={[styles.helperText, { marginTop: spacing.sm }]}>
            We'll walk you through what carriers ask for: cause of loss, policy details,
            collateral damage photos, and the brittleness test.
          </Text>
        )}
      </View>

      <Field
        label="Customer name *"
        value={draft.customerName}
        onChangeText={(t) => setDraft({ ...draft, customerName: t })}
        placeholder="Jane Doe"
      />
      <Field
        label="Phone"
        value={draft.customerPhone}
        onChangeText={(t) => setDraft({ ...draft, customerPhone: t })}
        keyboardType="phone-pad"
        placeholder="(555) 555-1234"
      />
      <Field
        label="Email"
        value={draft.customerEmail}
        onChangeText={(t) => setDraft({ ...draft, customerEmail: t })}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="customer@example.com"
      />
      <AddressAutocomplete
        label="Property address *"
        value={draft.address}
        onChangeText={(t) => setDraft({ ...draft, address: t, addressLat: undefined, addressLng: undefined })}
        onPlaceSelected={(p) =>
          setDraft({
            ...draft,
            address: p.description,
            addressLat: p.lat,
            addressLng: p.lng,
          })
        }
        useMyLocation
        onLocationSelected={(loc) =>
          setDraft({
            ...draft,
            address: loc.address,
            addressLat: loc.lat,
            addressLng: loc.lng,
          })
        }
      />
    </View>
  );
}

function KindCard({
  title,
  sub,
  selected,
  onPress,
}: {
  title: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.kindCard, selected && styles.kindCardSelected]} onPress={onPress}>
      <Text style={[styles.kindTitle, selected && styles.kindTitleSelected]}>{title}</Text>
      <Text style={[styles.kindSub, selected && styles.kindSubSelected]}>{sub}</Text>
    </Pressable>
  );
}

// ---------- Shared insurance fields (carrier grid + numbers) ----------

function InsuranceFields({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const carrierIds = Object.keys(INSURANCE_CARRIER_LABELS) as InsuranceCarrier[];
  const tier1 = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'tier1');
  const insurtech = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'insurtech');
  const regional = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'regional');

  return (
    <>
      <CarrierGroup
        title="Top carriers"
        ids={tier1}
        selected={draft.carrier}
        onSelect={(c) => setDraft({ ...draft, carrier: c })}
      />
      <CarrierGroup
        title="Insurtechs"
        ids={insurtech}
        selected={draft.carrier}
        onSelect={(c) => setDraft({ ...draft, carrier: c })}
      />
      <CarrierGroup
        title="Regional"
        ids={regional}
        selected={draft.carrier}
        onSelect={(c) => setDraft({ ...draft, carrier: c })}
      />
      <Pressable
        style={[styles.carrier, draft.carrier === 'other' && styles.carrierSelected, { width: '100%' }]}
        onPress={() => setDraft({ ...draft, carrier: 'other' })}
      >
        <Text style={[styles.carrierLabel, draft.carrier === 'other' && styles.carrierLabelSelected]}>
          Other
        </Text>
      </Pressable>

      <Field
        label="Policy number"
        value={draft.policyNumber}
        onChangeText={(t) => setDraft({ ...draft, policyNumber: t })}
        autoCapitalize="characters"
      />
      <Field
        label="Claim number"
        value={draft.claimNumber}
        onChangeText={(t) => setDraft({ ...draft, claimNumber: t })}
        autoCapitalize="characters"
      />
      <Field
        label="Adjuster name"
        value={draft.adjusterName}
        onChangeText={(t) => setDraft({ ...draft, adjusterName: t })}
      />
    </>
  );
}

// ---------- Step: Insurance (general mode — unchanged flow) ----------

function InsuranceStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <View style={styles.stepBody}>
      <Text style={styles.helperText}>
        Pick the carrier on the homeowner's policy. We'll match the report format.
      </Text>
      <InsuranceFields draft={draft} setDraft={setDraft} />
    </View>
  );
}

// ---------- Date of loss field (insurance claim mode, §VII) ----------

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Number pads on some keyboards emit separators; keep only digits. */
function digitsOnly(text: string, max: number): string {
  return text.replace(/[^0-9]/g, '').slice(0, max);
}

function DateOfLossField({
  draft,
  setDraft,
  stormLookup,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  stormLookup: StormLookup | null;
}) {
  const date = partsToDate(draft.dolMonth, draft.dolDay, draft.dolYear);
  const started = !!(draft.dolMonth || draft.dolDay || draft.dolYear);
  const incomplete = started && !date;
  const future = !!date && date.getTime() > Date.now();
  // NOAA is queried per state around a geocoded point. Say so rather than
  // silently showing nothing when the address was typed instead of picked.
  const geocoded =
    draft.addressLat !== undefined &&
    draft.addressLng !== undefined &&
    !!stateFromAddress(draft.address);
  const noaaUnreachableAddress = isStormCause(draft.causeOfLoss) && !!date && !geocoded;

  return (
    <View style={{ gap: spacing.md }}>
      <View>
        <Text style={styles.subSection}>Date of loss</Text>
        <Text style={styles.helperText}>
          The day the homeowner says the damage happened. The insurer verifies this date
          against weather records, so it has to be a real date — not "around mid-May".
        </Text>
      </View>

      <View style={styles.chipWrap}>
        {DOL_PRESETS.map(({ label, days }) => {
          const preset = daysAgo(days);
          const selected = !!date && isSameDay(date, preset);
          return (
            <Pressable
              key={label}
              style={[styles.bigChip, selected && styles.bigChipSelected]}
              onPress={() => setDraft(withDate(draft, preset))}
            >
              <Text style={[styles.bigChipText, selected && styles.bigChipTextSelected]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.dolRow}>
        <DatePart
          label="Month"
          value={draft.dolMonth}
          onChangeText={(t) => setDraft(withDateParts(draft, { dolMonth: digitsOnly(t, 2) }))}
          placeholder="MM"
          maxLength={2}
        />
        <DatePart
          label="Day"
          value={draft.dolDay}
          onChangeText={(t) => setDraft(withDateParts(draft, { dolDay: digitsOnly(t, 2) }))}
          placeholder="DD"
          maxLength={2}
        />
        <DatePart
          label="Year"
          flex={1.4}
          value={draft.dolYear}
          onChangeText={(t) => setDraft(withDateParts(draft, { dolYear: digitsOnly(t, 4) }))}
          placeholder="YYYY"
          maxLength={4}
        />
      </View>

      {date && !future && <Text style={styles.okText}>Date of loss: {formatDate(date)}</Text>}
      {incomplete && (
        <Text style={styles.helperText}>
          Fill in month, day and year — a partial date can't be checked against weather records.
        </Text>
      )}
      {future && (
        <View style={styles.warnBox}>
          <Ionicons name="alert-circle" size={20} color={colors.warn} />
          <Text style={styles.warnText}>
            That date is in the future. A carrier will reject a date of loss that hasn't
            happened yet — check it with the homeowner.
          </Text>
        </View>
      )}
      {!started && (
        <View style={styles.warnBox}>
          <Ionicons name="alert-circle" size={20} color={colors.warn} />
          <Text style={styles.warnText}>
            No date of loss yet. You can save the job without it, but the report has to
            disclose it as missing and the claim can't be date-anchored.
          </Text>
        </View>
      )}

      {noaaUnreachableAddress ? (
        <View style={styles.noaaRow}>
          <Ionicons name="location-outline" size={20} color={colors.slate} />
          <Text style={styles.noaaText}>
            Pick the property address from the suggestions on the previous step and we'll
            check this date against NOAA storm records for you.
          </Text>
        </View>
      ) : (
        <NoaaCrossCheck lookup={stormLookup} dolIso={draft.dateOfLoss} />
      )}
    </View>
  );
}

function DatePart({
  label,
  flex = 1,
  ...rest
}: { label: string; flex?: number } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={[styles.field, { flex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, styles.dolInput]}
        keyboardType="number-pad"
        placeholderTextColor={colors.textSubtle}
        {...rest}
      />
    </View>
  );
}

/**
 * NOAA cross-check shown beside the date of loss. Its whole job is to let the
 * inspector spot a date mismatch while the homeowner is still standing there —
 * the same discrepancy the Triple-Check raises downstream (stormMatch
 * `tripleCheckDateOfLoss`, HAAG_DECISION_ENGINE.md §6).
 *
 * Drift #5: an unreachable service says so. It is never rendered as "no storm".
 */
function NoaaCrossCheck({ lookup, dolIso }: { lookup: StormLookup | null; dolIso: string }) {
  if (!lookup) return null;

  if (lookup.status === 'loading') {
    return (
      <View style={styles.noaaRow}>
        <ActivityIndicator size="small" color={colors.info} />
        <Text style={styles.noaaText}>Checking NOAA storm records for this address…</Text>
      </View>
    );
  }

  if (lookup.status === 'unavailable') {
    return (
      <View style={styles.noaaRow}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.slate} />
        <Text style={styles.noaaText}>
          NOAA storm records aren't available right now. The date you entered still stands —
          we'll try the match again when you save the job.
        </Text>
      </View>
    );
  }

  if (lookup.status === 'no_match') {
    return (
      <View style={styles.warnBox}>
        <Ionicons name="alert-circle" size={20} color={colors.warn} />
        <Text style={styles.warnText}>
          No NOAA storm on record within 5 mi of this address in the ±{DOL_MATCH_WINDOW_DAYS}{' '}
          days around that date. The carrier runs the same check — confirm the date with the
          homeowner before you submit.
        </Text>
      </View>
    );
  }

  const event = lookup.event;
  const verdict = tripleCheckDateOfLoss({
    reportedDateOfLoss: dolIso,
    events: [event],
  });
  const offBy = Math.abs(verdict.daysFromDol ?? 0);
  const magnitude =
    event.kind === 'hail' && event.hailSizeInches !== undefined
      ? `${event.hailSizeInches.toFixed(2)}" hail`
      : event.kind === 'wind' && event.windSpeedMph !== undefined
        ? `${event.windSpeedMph} mph wind`
        : event.kind;

  return (
    <View style={verdict.withinWindow72h ? styles.noaaMatchBox : styles.warnBox}>
      <Ionicons
        name={verdict.withinWindow72h ? 'checkmark-circle' : 'alert-circle'}
        size={20}
        color={verdict.withinWindow72h ? colors.success : colors.warn}
      />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={verdict.withinWindow72h ? styles.noaaMatchText : styles.warnText}>
          NOAA event {formatDateShort(event.date)} · {magnitude}
          {event.distanceMiles !== undefined ? ` · ${event.distanceMiles.toFixed(1)} mi away` : ''}
        </Text>
        <Text style={verdict.withinWindow72h ? styles.noaaMatchSub : styles.warnText}>
          {verdict.withinWindow72h
            ? 'Matches the date you entered (within 72 hours) — the strongest version of this claim.'
            : `That's ${offBy} day${offBy === 1 ? '' : 's'} from the date you entered. Re-check it with the homeowner — the report flags a gap this wide.`}
        </Text>
      </View>
    </View>
  );
}

// ---------- Step: Claim & Policy (insurance claim mode, §VI–VII) ----------

function ClaimStep({
  draft,
  setDraft,
  stormLookup,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  stormLookup: StormLookup | null;
}) {
  const deductible = parseMoney(draft.deductible);
  const homeValue = parseMoney(draft.homeValue);
  const highDeductible = isDeductibleHigh(deductible, homeValue);

  return (
    <View style={styles.stepBody}>
      <View>
        <Text style={styles.subSection}>What caused the damage? *</Text>
        <Text style={styles.helperText}>
          Pick the primary cause of loss. Every finding in the report gets tied back to it.
        </Text>
        <View style={[styles.chipWrap, { marginTop: spacing.sm }]}>
          {CAUSES_OF_LOSS.map((c) => (
            <Pressable
              key={c}
              style={[styles.bigChip, draft.causeOfLoss === c && styles.bigChipSelected]}
              onPress={() => setDraft({ ...draft, causeOfLoss: c })}
            >
              <Text style={[styles.bigChipText, draft.causeOfLoss === c && styles.bigChipTextSelected]}>
                {CAUSE_OF_LOSS_LABELS[c]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {draft.causeOfLoss !== null &&
        (isStormCause(draft.causeOfLoss) ? (
          <View style={styles.stormBox}>
            <View style={styles.stormHead}>
              <Ionicons name="thunderstorm-outline" size={20} color={colors.info} />
              <Text style={styles.stormTitle}>Storm Damage Protocol</Text>
            </View>
            <DateOfLossField draft={draft} setDraft={setDraft} stormLookup={stormLookup} />
          </View>
        ) : (
          <DateOfLossField draft={draft} setDraft={setDraft} stormLookup={stormLookup} />
        ))}

      <InsuranceFields draft={draft} setDraft={setDraft} />

      <View>
        <Text style={styles.subSection}>Policy type</Text>
        <View style={styles.pairRow}>
          {(['RCV', 'ACV'] as PolicyType[]).map((p) => (
            <Pressable
              key={p}
              style={[styles.bigChip, { flex: 1 }, draft.policyType === p && styles.bigChipSelected]}
              onPress={() => setDraft({ ...draft, policyType: p })}
            >
              <Text style={[styles.bigChipText, draft.policyType === p && styles.bigChipTextSelected]}>
                {POLICY_TYPE_LABELS[p]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.helperText, { marginTop: spacing.sm }]}>
          RCV pays full replacement cost. ACV holds back depreciation — a harder claim.
        </Text>
      </View>

      <Field
        label="Deductible ($)"
        value={draft.deductible}
        onChangeText={(t) => setDraft({ ...draft, deductible: t })}
        keyboardType="number-pad"
        placeholder="2500"
      />
      <Field
        label="Home value ($)"
        value={draft.homeValue}
        onChangeText={(t) => setDraft({ ...draft, homeValue: t })}
        keyboardType="number-pad"
        placeholder="350000"
      />
      {highDeductible === true && (
        <View style={styles.warnBox}>
          <Ionicons name="alert-circle" size={20} color={colors.warn} />
          <Text style={styles.warnText}>
            Deductible is over 2% of home value — carriers approve fewer claims at this
            level. Double-check both numbers with the homeowner.
          </Text>
        </View>
      )}
      {highDeductible === false && (
        <Text style={styles.okText}>
          Deductible is under 2% of home value — good for claim viability.
        </Text>
      )}

      <View>
        <Text style={styles.subSection}>Prior claims in the last 3 years?</Text>
        <View style={styles.pairRow}>
          {([
            { v: false, label: 'No' },
            { v: true, label: 'Yes' },
          ] as const).map(({ v, label }) => (
            <Pressable
              key={label}
              style={[
                styles.bigChip,
                { flex: 1 },
                draft.priorClaimsWithin3Years === v && styles.bigChipSelected,
              ]}
              onPress={() => setDraft({ ...draft, priorClaimsWithin3Years: v })}
            >
              <Text
                style={[
                  styles.bigChipText,
                  draft.priorClaimsWithin3Years === v && styles.bigChipTextSelected,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.helperText, { marginTop: spacing.sm }]}>
          Recent claims on this roof lower approval odds — better to know before filing.
        </Text>
      </View>
    </View>
  );
}

// ---------- Step: Roof System ----------

const MATERIALS_DISPLAY: RoofMaterial[] = [
  'three_tab_asphalt',
  'architectural_asphalt',
  'luxury_asphalt',
  'metal_standing_seam',
  'metal_shingle',
  'wood_shake',
  'clay_tile',
  'concrete_tile',
  'slate',
  'tpo',
];

const GEOMETRIES: RoofGeometry[] = ['gable', 'hip', 'mansard', 'flat', 'mixed'];
const CONDITIONS: RoofCondition[] = ['excellent', 'good', 'fair', 'poor'];

function RoofStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <View style={styles.stepBody}>
      <View>
        <Text style={styles.subSection}>Material *</Text>
        <View style={styles.chipWrap}>
          {MATERIALS_DISPLAY.map((m) => (
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
      </View>

      <View>
        <Text style={styles.subSection}>Roof age</Text>
        <View style={styles.stepperRow}>
          <Pressable
            style={styles.stepperBtn}
            onPress={() => setDraft({ ...draft, ageYears: Math.max(0, draft.ageYears - 1) })}
          >
            <Ionicons name="remove" size={24} color={colors.navy} />
          </Pressable>
          <Text style={styles.stepperValue}>{draft.ageYears} yr</Text>
          <Pressable
            style={styles.stepperBtn}
            onPress={() => setDraft({ ...draft, ageYears: draft.ageYears + 1 })}
          >
            <Ionicons name="add" size={24} color={colors.navy} />
          </Pressable>
        </View>
      </View>

      <View>
        <Text style={styles.subSection}>Geometry *</Text>
        <View style={styles.chipWrap}>
          {GEOMETRIES.map((g) => (
            <Pressable
              key={g}
              style={[styles.bigChip, draft.geometry === g && styles.bigChipSelected]}
              onPress={() => setDraft({ ...draft, geometry: g })}
            >
              <Text
                style={[styles.bigChipText, draft.geometry === g && styles.bigChipTextSelected]}
              >
                {g[0].toUpperCase() + g.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View>
        <Text style={styles.subSection}>Condition</Text>
        <View style={styles.chipWrap}>
          {CONDITIONS.map((c) => (
            <Pressable
              key={c}
              style={[styles.bigChip, draft.condition === c && styles.bigChipSelected]}
              onPress={() => setDraft({ ...draft, condition: c })}
            >
              <Text
                style={[styles.bigChipText, draft.condition === c && styles.bigChipTextSelected]}
              >
                {c[0].toUpperCase() + c.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {draft.kind === 'general' && (
        <View>
          <Text style={styles.subSection}>Brittleness test (HAAG)</Text>
          <View style={styles.chipWrap}>
            {(['not_tested', 'passed', 'failed'] as const).map((b) => (
              <Pressable
                key={b}
                style={[styles.bigChip, draft.brittlenessTest === b && styles.bigChipSelected]}
                onPress={() => setDraft({ ...draft, brittlenessTest: b })}
              >
                <Text
                  style={[
                    styles.bigChipText,
                    draft.brittlenessTest === b && styles.bigChipTextSelected,
                  ]}
                >
                  {b.replace('_', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ---------- Step: Claim Evidence (insurance claim mode, §VII-C, §VIII, §IX) ----------

const BRITTLENESS_OPTIONS: { value: BrittlenessResult | null; label: string }[] = [
  { value: null, label: 'Not run yet' },
  { value: 'PASS', label: 'Pass' },
  { value: 'BORDERLINE', label: 'Borderline' },
  { value: 'FAIL', label: 'Fail' },
];

function EvidenceStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const updateZone = (zone: CollateralZone, patch: Partial<CollateralChecklistItem>) =>
    setDraft({
      ...draft,
      collateral: {
        ...draft.collateral,
        [zone]: { ...draft.collateral[zone], ...patch },
      },
    });

  return (
    <View style={styles.stepBody}>
      <View>
        <Text style={styles.subSection}>Collateral damage checklist</Text>
        <Text style={styles.helperText}>
          Adjusters look for matching hits off the roof. Work each zone and photograph it
          even if it's clean — a no-damage photo proves you checked.
        </Text>
      </View>

      {COLLATERAL_ZONES.map((zone) => {
        const item = draft.collateral[zone];
        return (
          <View key={zone} style={styles.zoneCard}>
            <Pressable
              style={styles.zoneCheckRow}
              onPress={() => updateZone(zone, { checked: !item.checked })}
            >
              <Ionicons
                name={item.checked ? 'checkbox' : 'square-outline'}
                size={26}
                color={item.checked ? colors.success : colors.slate}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneTitle}>{COLLATERAL_ZONE_LABELS[zone]}</Text>
                <Text style={styles.zoneHint}>{COLLATERAL_ZONE_HINTS[zone]}</Text>
              </View>
            </Pressable>
            <EvidencePhotoRow
              photoIds={item.photoIds}
              onAdd={(uri) => updateZone(zone, { photoIds: [...item.photoIds, uri], checked: true })}
              onRemove={(i) =>
                updateZone(zone, { photoIds: item.photoIds.filter((_, idx) => idx !== i) })
              }
            />
            <TextInput
              style={styles.zoneNote}
              value={item.note ?? ''}
              onChangeText={(t) => updateZone(zone, { note: t })}
              placeholder="What did you see?"
              placeholderTextColor={colors.textSubtle}
            />
          </View>
        );
      })}

      <View>
        <Text style={styles.subSection}>Brittleness test (HAAG)</Text>
        <Text style={styles.helperText}>
          Lift shingle corners in an undamaged area. Photograph the test while you run it —
          photos of the process are required evidence. Fail or borderline means repairs
          aren't feasible, which justifies full replacement.
        </Text>
        <View style={[styles.chipWrap, { marginTop: spacing.sm }]}>
          {BRITTLENESS_OPTIONS.map(({ value, label }) => (
            <Pressable
              key={label}
              style={[styles.bigChip, draft.brittlenessResult === value && styles.bigChipSelected]}
              onPress={() =>
                setDraft({
                  ...draft,
                  brittlenessResult: value,
                  ...(value === null ? { brittlenessPhotoIds: [], brittlenessNotes: '' } : {}),
                })
              }
            >
              <Text
                style={[
                  styles.bigChipText,
                  draft.brittlenessResult === value && styles.bigChipTextSelected,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        {draft.brittlenessResult === null ? (
          <Text style={[styles.helperText, { marginTop: spacing.sm }]}>
            You can run the test on the roof and record it later from the job screen — the
            insurance report needs it before it goes to the carrier.
          </Text>
        ) : (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            <EvidencePhotoRow
              photoIds={draft.brittlenessPhotoIds}
              onAdd={(uri) =>
                setDraft({ ...draft, brittlenessPhotoIds: [...draft.brittlenessPhotoIds, uri] })
              }
              onRemove={(i) =>
                setDraft({
                  ...draft,
                  brittlenessPhotoIds: draft.brittlenessPhotoIds.filter((_, idx) => idx !== i),
                })
              }
            />
            {draft.brittlenessPhotoIds.length === 0 && (
              <View style={styles.warnBox}>
                <Ionicons name="alert-circle" size={20} color={colors.warn} />
                <Text style={styles.warnText}>
                  Add at least one photo of the test process to continue.
                </Text>
              </View>
            )}
            <Field
              label="Test notes"
              value={draft.brittlenessNotes}
              onChangeText={(t) => setDraft({ ...draft, brittlenessNotes: t })}
              placeholder="Where you tested, how the shingles behaved"
              multiline
            />
          </View>
        )}
      </View>

      <View>
        <Text style={styles.subSection}>Code compliance notes</Text>
        <Text style={styles.helperText}>
          Local code items that grow the covered scope — ventilation, ice & water shield,
          drip edge. Carriers pay for code upgrades when the report cites them.
        </Text>
        <TextInput
          style={[styles.input, styles.inputMultiline, { marginTop: spacing.sm }]}
          value={draft.codeComplianceNotes}
          onChangeText={(t) => setDraft({ ...draft, codeComplianceNotes: t })}
          placeholder="e.g. City requires ice & water shield at eaves; current roof has none."
          placeholderTextColor={colors.textSubtle}
          multiline
          textAlignVertical="top"
        />
      </View>
    </View>
  );
}

// ---------- Step: Review ----------

function ReviewStep({ draft, onEdit }: { draft: Draft; onEdit: (k: StepKey) => void }) {
  const isClaim = draft.kind === 'insurance_claim';
  const deductible = parseMoney(draft.deductible);
  const homeValue = parseMoney(draft.homeValue);
  const highDeductible = isDeductibleHigh(deductible, homeValue);

  return (
    <View style={styles.stepBody}>
      <ReviewBlock title="Customer & Property" onEdit={() => onEdit('customer')}>
        <ReviewLine label="Type" value={isClaim ? 'Insurance Claim' : 'General'} />
        <ReviewLine label="Name" value={draft.customerName} />
        <ReviewLine label="Phone" value={draft.customerPhone || '—'} />
        <ReviewLine label="Email" value={draft.customerEmail || '—'} />
        <ReviewLine label="Address" value={draft.address} />
      </ReviewBlock>

      {!isClaim && (
        <ReviewBlock title="Insurance" onEdit={() => onEdit('insurance')}>
          <ReviewLine
            label="Carrier"
            value={draft.carrier ? INSURANCE_CARRIER_LABELS[draft.carrier] : '—'}
          />
          <ReviewLine label="Policy #" value={draft.policyNumber || '—'} />
          <ReviewLine label="Claim #" value={draft.claimNumber || '—'} />
          <ReviewLine label="Adjuster" value={draft.adjusterName || '—'} />
        </ReviewBlock>
      )}

      {isClaim && (
        <ReviewBlock title="Claim & Policy" onEdit={() => onEdit('claim')}>
          <ReviewLine
            label="Cause of loss"
            value={draft.causeOfLoss ? CAUSE_OF_LOSS_LABELS[draft.causeOfLoss] : '—'}
          />
          <ReviewLine label="Date of loss" value={formatDate(draft.dateOfLoss, 'Not recorded')} />
          {isStormCause(draft.causeOfLoss) && !draft.dateOfLoss && (
            <ReviewLine
              label="Weather check"
              value="Needs a date of loss before NOAA can corroborate"
            />
          )}
          <ReviewLine
            label="Carrier"
            value={draft.carrier ? INSURANCE_CARRIER_LABELS[draft.carrier] : '—'}
          />
          <ReviewLine label="Policy #" value={draft.policyNumber || '—'} />
          <ReviewLine label="Claim #" value={draft.claimNumber || '—'} />
          <ReviewLine label="Adjuster" value={draft.adjusterName || '—'} />
          <ReviewLine label="Policy type" value={draft.policyType ?? '—'} />
          <ReviewLine
            label="Deductible"
            value={
              highDeductible === undefined
                ? formatMoney(deductible)
                : `${formatMoney(deductible)} · ${highDeductible ? 'over' : 'under'} 2% of home value`
            }
          />
          <ReviewLine label="Home value" value={formatMoney(homeValue)} />
          <ReviewLine
            label="Prior claims (3 yr)"
            value={
              draft.priorClaimsWithin3Years === null
                ? '—'
                : draft.priorClaimsWithin3Years
                  ? 'Yes'
                  : 'No'
            }
          />
        </ReviewBlock>
      )}

      <ReviewBlock title="Roof System" onEdit={() => onEdit('roof')}>
        <ReviewLine
          label="Material"
          value={draft.material ? ROOF_MATERIAL_LABELS[draft.material] : '—'}
        />
        <ReviewLine label="Age" value={`${draft.ageYears} yr`} />
        <ReviewLine label="Geometry" value={draft.geometry ?? '—'} />
        <ReviewLine label="Condition" value={draft.condition ?? '—'} />
      </ReviewBlock>

      {isClaim && (
        <ReviewBlock title="Claim Evidence" onEdit={() => onEdit('evidence')}>
          {COLLATERAL_ZONES.map((z) => {
            const item = draft.collateral[z];
            return (
              <ReviewLine
                key={z}
                label={COLLATERAL_ZONE_LABELS[z]}
                value={`${item.checked ? 'Checked' : 'Not checked'} · ${item.photoIds.length} photo${item.photoIds.length === 1 ? '' : 's'}`}
              />
            );
          })}
          <ReviewLine
            label="Brittleness"
            value={
              draft.brittlenessResult
                ? `${draft.brittlenessResult} · ${draft.brittlenessPhotoIds.length} photo${draft.brittlenessPhotoIds.length === 1 ? '' : 's'}`
                : 'Not run yet'
            }
          />
          <ReviewLine label="Code notes" value={draft.codeComplianceNotes.trim() || '—'} />
        </ReviewBlock>
      )}
    </View>
  );
}

function ReviewBlock({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHead}>
        <Text style={styles.reviewTitle}>{title}</Text>
        <Pressable onPress={onEdit} hitSlop={10} style={styles.reviewEdit}>
          <Ionicons name="pencil-outline" size={18} color={colors.navy} />
        </Pressable>
      </View>
      <View style={{ gap: spacing.xs }}>{children}</View>
    </View>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewLine}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

// ---------- Carrier group ----------

function CarrierGroup({
  title,
  ids,
  selected,
  onSelect,
}: {
  title: string;
  ids: InsuranceCarrier[];
  selected: InsuranceCarrier | null;
  onSelect: (c: InsuranceCarrier) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.subSection}>{title}</Text>
      <View style={styles.carrierGrid}>
        {ids.map((c) => (
          <Pressable
            key={c}
            style={[styles.carrier, selected === c && styles.carrierSelected]}
            onPress={() => onSelect(c)}
          >
            <Text style={[styles.carrierLabel, selected === c && styles.carrierLabelSelected]}>
              {INSURANCE_CARRIER_LABELS[c]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ---------- Shared Field component ----------

function Field({
  label,
  ...rest
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, rest.multiline && styles.inputMultiline]}
        placeholderTextColor={colors.textSubtle}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerStep: { fontSize: fontSize.caption, color: colors.textSubtle, fontWeight: fontWeight.semibold },
  // Inline wizard title — iOS sub-screen bar: 17/semibold ink.
  headerTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },

  // Progress is a thin ink bar, not an orange pill (orange is saved for the CTA).
  progressTrack: {
    height: 3,
    backgroundColor: colors.fillQuiet,
    marginHorizontal: spacing.xl,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: colors.navy, borderRadius: radii.pill },

  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  stepBody: { gap: spacing.lg },
  helperText: { fontSize: fontSize.bodyMd, color: colors.slate },

  footer: {
    padding: spacing.xl,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // The screen's one orange moment (Drift #1: sticky 88pt CTA).
  primaryBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  // Flat neutral fill, not a washed accent and not element opacity: a tinted
  // burnt fill at 88pt full width still reads as a live primary button (so a
  // gloved roofer taps a dead control), and white on it measures ~1.9:1.
  // Neutral fill + muted ink reads as disabled AND stays legible in sun.
  primaryBtnDisabled: { backgroundColor: colors.fillDisabled },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  primaryBtnTextDisabled: { color: colors.textMuted },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  secondaryBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  field: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.medium },
  // Grouped white input cells — hairline edge on the grouped ground.
  input: {
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.bodyLg,
    color: colors.navy,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },

  // iOS grouped-list section header.
  subSection: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  carrierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  carrier: {
    width: '48%',
    minHeight: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  carrierSelected: { backgroundColor: colors.navy },
  carrierLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy, textAlign: 'center' },
  carrierLabelSelected: { color: colors.textInverse },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Quiet grey-fill cells; selection is ink, never saturated orange.
  bigChip: {
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigChipSelected: { backgroundColor: colors.navy },
  bigChipText: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.semibold },
  bigChipTextSelected: { color: colors.textInverse },

  // Stepper as a quiet track with white thumb-style buttons (segmented language).
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.button,
    padding: spacing.xs,
  },
  stepperBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },

  reviewCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },
  reviewEdit: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -spacing.sm,
    marginRight: -spacing.sm,
  },
  reviewLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  reviewLabel: { fontSize: fontSize.bodySm, color: colors.slate, flex: 1 },
  reviewValue: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium, flex: 2, textAlign: 'right' },

  // ---------- Insurance Claim mode ----------

  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindCard: {
    flex: 1,
    minHeight: touchTarget.sticky,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    justifyContent: 'center',
    ...shadows.card,
  },
  kindCardSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  kindTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },
  kindTitleSelected: { color: colors.textInverse },
  kindSub: { fontSize: fontSize.bodySm, color: colors.slate },
  kindSubSelected: { color: colors.textInverse },

  pairRow: { flexDirection: 'row', gap: spacing.sm },

  stormBox: {
    backgroundColor: colors.infoSoft,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  stormHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stormTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },

  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    borderRadius: radii.control,
    padding: spacing.md,
  },

  // Date of loss — MM / DD / YYYY boxes sized for a gloved thumb on a
  // number pad (Drift #1), plus the NOAA cross-check rows beneath them.
  dolRow: { flexDirection: 'row', gap: spacing.sm },
  dolInput: {
    minHeight: touchTarget.preferred,
    textAlign: 'center',
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
  },
  noaaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    padding: spacing.md,
  },
  noaaText: { flex: 1, fontSize: fontSize.bodySm, color: colors.slate },
  noaaMatchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: radii.control,
    padding: spacing.md,
  },
  noaaMatchText: {
    fontSize: fontSize.bodyMd,
    color: colors.success,
    fontWeight: fontWeight.semibold,
  },
  noaaMatchSub: { fontSize: fontSize.bodySm, color: colors.success },
  warnText: { flex: 1, fontSize: fontSize.bodySm, color: colors.warn, fontWeight: fontWeight.medium },
  okText: { fontSize: fontSize.bodySm, color: colors.success, fontWeight: fontWeight.medium },

  zoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  zoneCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
  },
  zoneTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },
  zoneHint: { fontSize: fontSize.bodySm, color: colors.slate },
  zoneNote: {
    minHeight: touchTarget.standard,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.bodyMd,
    color: colors.navy,
  },

  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  photoThumb: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceMuted,
  },
  addPhotoBtn: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addPhotoText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
});
