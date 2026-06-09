import { useState } from 'react';
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
  type InsuranceCarrier,
  INSURANCE_CARRIER_LABELS,
  INSURANCE_CARRIER_TIER,
  type RoofGeometry,
  type RoofCondition,
  type RoofMaterial,
  ROOF_MATERIAL_LABELS,
} from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';

type Step = 0 | 1 | 2 | 3;

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
};

const STEP_TITLES = ['Customer & Property', 'Insurance', 'Roof System', 'Review'];

export default function NewJobWizard() {
  const router = useRouter();
  const createInspection = useInspectionStore((s) => s.create);
  const logActivity = useActivityStore((s) => s.log);
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);

  const onBack = () => {
    if (step === 0) {
      if (dirty) confirmDiscard(router.back);
      else router.back();
      return;
    }
    setStep((step - 1) as Step);
  };

  const canAdvance = (() => {
    switch (step) {
      case 0: return draft.customerName.trim().length > 0 && draft.address.trim().length > 0;
      case 1: return true;
      case 2: return draft.material !== null && draft.geometry !== null && draft.condition !== null;
      case 3: return true;
    }
  })();

  const onNext = () => {
    if (step < 3) setStep((step + 1) as Step);
    else save();
  };

  const save = () => {
    if (!draft.material || !draft.geometry || !draft.condition) return;
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
    });
    logActivity({
      kind: 'job_created',
      inspectionId: ins.id,
      message: `Created job ${ins.reportId} for ${ins.customerName}`,
    });
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
              name={step === 0 ? 'close' : 'chevron-back'}
              size={26}
              color={colors.navy}
            />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerStep}>Step {step + 1} of 4</Text>
            <Text style={styles.headerTitle}>{STEP_TITLES[step]}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step + 1) * 25}%` }]} />
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
            {step === 0 && <Step1 draft={draft} setDraft={setDraft} />}
            {step === 1 && <Step2 draft={draft} setDraft={setDraft} />}
            {step === 2 && <Step3 draft={draft} setDraft={setDraft} />}
            {step === 3 && <Step4 draft={draft} onEdit={(s) => setStep(s)} />}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, !canAdvance && styles.primaryBtnDisabled]}
              onPress={onNext}
              disabled={!canAdvance}
            >
              <Text style={styles.primaryBtnText}>
                {step === 3 ? 'Save job' : 'Next'}
              </Text>
              {step < 3 && (
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

// ---------- Step 1: Customer & Property ----------

function Step1({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  return (
    <View style={styles.stepBody}>
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

// ---------- Step 2: Insurance carrier grid ----------

function Step2({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const carrierIds = Object.keys(INSURANCE_CARRIER_LABELS) as InsuranceCarrier[];
  const tier1 = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'tier1');
  const insurtech = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'insurtech');
  const regional = carrierIds.filter((c) => INSURANCE_CARRIER_TIER[c] === 'regional');

  return (
    <View style={styles.stepBody}>
      <Text style={styles.helperText}>
        Pick the carrier on the homeowner's policy. We'll match the report format.
      </Text>

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
    </View>
  );
}

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

// ---------- Step 3: Roof System ----------

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

function Step3({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
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
    </View>
  );
}

// ---------- Step 4: Review ----------

function Step4({ draft, onEdit }: { draft: Draft; onEdit: (s: Step) => void }) {
  return (
    <View style={styles.stepBody}>
      <ReviewBlock title="Customer & Property" onEdit={() => onEdit(0)}>
        <ReviewLine label="Name" value={draft.customerName} />
        <ReviewLine label="Phone" value={draft.customerPhone || '—'} />
        <ReviewLine label="Email" value={draft.customerEmail || '—'} />
        <ReviewLine label="Address" value={draft.address} />
      </ReviewBlock>

      <ReviewBlock title="Insurance" onEdit={() => onEdit(1)}>
        <ReviewLine
          label="Carrier"
          value={draft.carrier ? INSURANCE_CARRIER_LABELS[draft.carrier] : '—'}
        />
        <ReviewLine label="Policy #" value={draft.policyNumber || '—'} />
        <ReviewLine label="Claim #" value={draft.claimNumber || '—'} />
        <ReviewLine label="Adjuster" value={draft.adjusterName || '—'} />
      </ReviewBlock>

      <ReviewBlock title="Roof System" onEdit={() => onEdit(2)}>
        <ReviewLine
          label="Material"
          value={draft.material ? ROOF_MATERIAL_LABELS[draft.material] : '—'}
        />
        <ReviewLine label="Age" value={`${draft.ageYears} yr`} />
        <ReviewLine label="Geometry" value={draft.geometry ?? '—'} />
        <ReviewLine label="Condition" value={draft.condition ?? '—'} />
      </ReviewBlock>
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
});
