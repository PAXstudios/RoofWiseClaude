import { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, Stack } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  colors,
  fontSize,
  fontWeight,
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
import { matchStorm } from '@/lib/services/stormMatch';
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
  dateOfLoss: string;
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

function parseMoney(t: string): number | undefined {
  const cleaned = t.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatMoney(n: number | undefined): string {
  return n === undefined ? '—' : `$${n.toLocaleString()}`;
}

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

  const steps = draft.kind === 'insurance_claim' ? CLAIM_STEPS : GENERAL_STEPS;
  const stepKey = steps[stepIndex];

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
      dateOfLoss:
        isClaim && isStormCause(draft.causeOfLoss)
          ? draft.dateOfLoss.trim() || undefined
          : undefined,
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
    // NOAA storm exists within 5mi / ±30d of the property + creation date.
    if (ins.lat !== undefined && ins.lng !== undefined) {
      const state = ins.address.match(/,\s*([A-Z]{2})/)?.[1];
      if (state) {
        matchStorm({ lat: ins.lat, lng: ins.lng, near: new Date(ins.createdAt), state })
          .then((result) => {
            // Record how the search resolved: only a genuine 'no_match' lets
            // the decision engine treat "no weather event" as verified (§4
            // step 1); 'unavailable' stays unknown — never synthesized
            // either way (Drift #5).
            setStormSearchOutcome(ins.id, result.status);
            if (result.status === 'matched') {
              const event = result.event;
              setEvent(ins.id, event);
              toast({
                tone: 'success',
                title: 'Storm event matched',
                body: `NOAA ${event.kind}${event.hailSizeInches ? ` ${event.hailSizeInches.toFixed(2)}"` : ''}${event.windSpeedMph ? ` ${event.windSpeedMph}mph` : ''} · ${event.distanceMiles?.toFixed(1)}mi away`,
              });
            }
          })
          .catch(() => {});
      }
    }

    Alert.alert('Job created', `Report ${ins.reportId} saved locally.`, [
      { text: 'Done', onPress: () => router.replace('/(tabs)') },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
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

        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${((stepIndex + 1) / steps.length) * 100}%` }]}
          />
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
            {stepKey === 'customer' && <CustomerStep draft={draft} setDraft={setDraft} />}
            {stepKey === 'insurance' && <InsuranceStep draft={draft} setDraft={setDraft} />}
            {stepKey === 'claim' && <ClaimStep draft={draft} setDraft={setDraft} />}
            {stepKey === 'roof' && <RoofStep draft={draft} setDraft={setDraft} />}
            {stepKey === 'evidence' && <EvidenceStep draft={draft} setDraft={setDraft} />}
            {stepKey === 'review' && (
              <ReviewStep
                draft={draft}
                onEdit={(k) => setStepIndex(Math.max(0, steps.indexOf(k)))}
              />
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, !canAdvance && styles.primaryBtnDisabled]}
              onPress={onNext}
              disabled={!canAdvance}
            >
              <Text style={styles.primaryBtnText}>
                {stepKey === 'review' ? 'Save job' : 'Next'}
              </Text>
              {stepKey !== 'review' && (
                <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
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
    onPicked(result.assets[0].uri);
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
    onPicked(result.assets[0].uri);
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

// ---------- Step: Claim & Policy (insurance claim mode, §VI–VII) ----------

function ClaimStep({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
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

      {isStormCause(draft.causeOfLoss) && (
        <View style={styles.stormBox}>
          <View style={styles.stormHead}>
            <Ionicons name="thunderstorm-outline" size={20} color={colors.info} />
            <Text style={styles.stormTitle}>Storm Damage Protocol</Text>
          </View>
          <Text style={styles.helperText}>
            When did the storm hit? Close is fine — we'll match the address against NOAA
            records automatically.
          </Text>
          <Field
            label="Date of loss"
            value={draft.dateOfLoss}
            onChangeText={(t) => setDraft({ ...draft, dateOfLoss: t })}
            placeholder={'e.g. 2026-05-14 or "around mid-May"'}
          />
        </View>
      )}

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
          {isStormCause(draft.causeOfLoss) && (
            <ReviewLine label="Date of loss" value={draft.dateOfLoss.trim() || '—'} />
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
        <Pressable onPress={onEdit} hitSlop={10}>
          <Ionicons name="pencil-outline" size={18} color={colors.orange} />
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
  headerBtn: { padding: spacing.xs },
  headerStep: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold },
  headerTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },

  progressTrack: {
    height: 4,
    backgroundColor: colors.surfaceMuted,
    marginHorizontal: spacing.xl,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: colors.orange, borderRadius: 2 },

  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  stepBody: { gap: spacing.lg },
  helperText: { fontSize: fontSize.bodyMd, color: colors.slate },

  footer: {
    padding: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  secondaryBtn: {
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
  secondaryBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  field: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.medium },
  input: {
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.bodyLg,
    color: colors.navy,
  },
  inputMultiline: { minHeight: 88, textAlignVertical: 'top' },

  subSection: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy, marginBottom: spacing.sm },

  carrierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  carrier: {
    width: '48%',
    minHeight: touchTarget.preferred,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  carrierSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  carrierLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy, textAlign: 'center' },
  carrierLabelSelected: { color: colors.textInverse },

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

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepperBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
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
  reviewTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
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
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    justifyContent: 'center',
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
    borderRadius: radii.md,
    padding: spacing.md,
  },
  warnText: { flex: 1, fontSize: fontSize.bodySm, color: colors.warn, fontWeight: fontWeight.medium },
  okText: { fontSize: fontSize.bodySm, color: colors.success, fontWeight: fontWeight.medium },

  zoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
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
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
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
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addPhotoText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
});
