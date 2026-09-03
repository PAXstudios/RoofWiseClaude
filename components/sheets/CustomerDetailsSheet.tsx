// "Who is this for?" — the sheet that names a job or a lead.
//
// Three places open it: the job screen's Property card (edit a customer,
// address, or roof system after the fact), a standalone Quick Inspection on
// Done (the job was filed as "Quick inspection / Address pending" so the
// photos had somewhere to live; this is where it gets a real name, prefilled
// from a GPS reverse-geocode when one resolved), and the lead screen (a door
// knock creates "Walk-in lead" at a bare coordinate pair).
//
// Honesty rules (Drift #5): the address is prefilled ONLY from a real
// geocoder answer — a fix nobody could name leaves the field empty with a
// note, never a coordinate string dressed as a street — and Save stays off
// until both the name and a street address are real.

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { LocationField } from '@/components/LocationField';
import {
  ROOF_MATERIALS,
  ROOF_MATERIAL_LABELS,
  type RoofCondition,
  type RoofMaterial,
} from '@/lib/models/types';
import {
  isCoordinateAddress,
  isPlaceholderAddress,
  isPlaceholderName,
} from '@/lib/services/placeholderDetails';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type CustomerDetailsResult = {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  lat?: number;
  lng?: number;
  /** Only when the sheet was opened with `roof`. */
  material?: RoofMaterial;
  condition?: RoofCondition;
  /** Only when the sheet was opened with `roof` and the roofer touched the age. */
  ageYears?: number;
};

/** A real place from a geocoder — what the caller's GPS lookup produced. */
export type AutoLocation = { address: string; lat: number; lng: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Current values. Placeholders ("Quick inspection", "Address pending", a lat/lng pair) render as empty. */
  initial: {
    customerName?: string;
    customerPhone?: string;
    customerEmail?: string;
    address?: string;
    lat?: number;
    lng?: number;
    material?: RoofMaterial;
    condition?: RoofCondition;
    ageYears?: number;
  };
  /** Show the roof material + condition pickers (jobs). */
  roof?: boolean;
  /** What the property record suggests for roof age — offered as a chip, never applied silently. */
  ageHint?: { ageYears: number; note: string } | null;
  /** The caller is still resolving a GPS fix into an address. */
  locating?: boolean;
  /** A resolved address to drop into an EMPTY address field — never over one the roofer typed. */
  autoLocation?: AutoLocation | null;
  /** One line under the address when the fix could not be named (shown verbatim). */
  locationNote?: string | null;
  /** Default "Save". */
  saveLabel?: string;
  /** Renders a quiet skip under Save; the caller decides what skipping means. */
  skipLabel?: string;
  onSave: (result: CustomerDetailsResult) => void;
  onSkip?: () => void;
};

const CONDITIONS: RoofCondition[] = ['excellent', 'good', 'fair', 'poor'];
const CONDITION_LABELS: Record<RoofCondition, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export function CustomerDetailsSheet({
  visible,
  onClose,
  title,
  subtitle,
  initial,
  roof = false,
  locating = false,
  autoLocation,
  locationNote,
  saveLabel = 'Save',
  skipLabel,
  onSave,
  onSkip,
  ageHint,
}: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [material, setMaterial] = useState<RoofMaterial | undefined>();
  const [condition, setCondition] = useState<RoofCondition | undefined>();
  const [ageYears, setAgeYears] = useState<number | undefined>();
  const [autoFilled, setAutoFilled] = useState(false);

  // Fresh draft every time the sheet opens; placeholders come in as blanks so
  // the roofer types over nothing rather than deleting "Address pending".
  useEffect(() => {
    if (!visible) return;
    setName(isPlaceholderName(initial.customerName) ? '' : (initial.customerName ?? ''));
    setPhone(initial.customerPhone ?? '');
    setEmail(initial.customerEmail ?? '');
    const addressReal = !isPlaceholderAddress(initial.address);
    setAddress(addressReal ? (initial.address ?? '') : '');
    setLat(addressReal ? initial.lat : undefined);
    setLng(addressReal ? initial.lng : undefined);
    setMaterial(initial.material);
    setCondition(initial.condition);
    setAgeYears(initial.ageYears);
    setAutoFilled(false);
    // The initial object is rebuilt each render by callers; keying on its
    // members keeps the reset to the moment the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // A GPS answer that arrives after the sheet opened fills an empty address
  // once. Anything the roofer has typed wins.
  useEffect(() => {
    if (!visible || !autoLocation || autoFilled) return;
    if (address.trim().length > 0) return;
    setAddress(autoLocation.address);
    setLat(autoLocation.lat);
    setLng(autoLocation.lng);
    setAutoFilled(true);
  }, [visible, autoLocation, autoFilled, address]);

  const nameOk = !isPlaceholderName(name);
  const addressOk = !isPlaceholderAddress(address);
  const roofOk = !roof || material !== undefined;
  const canSave = nameOk && addressOk && roofOk;
  const coordinatesOnly = isCoordinateAddress(address);

  const save = () => {
    if (!canSave) return;
    onSave({
      customerName: name.trim(),
      customerPhone: phone.trim() || undefined,
      customerEmail: email.trim() || undefined,
      address: address.trim(),
      lat,
      lng,
      ...(roof ? { material, condition, ageYears } : {}),
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} accessibilityLabel={title}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label="Customer name *"
            icon="person-outline"
            tone="blue"
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            autoCapitalize="words"
          />
          <Field
            label="Phone"
            icon="call-outline"
            tone="green"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="(555) 555-1234"
          />
          <Field
            label="Email"
            icon="mail-outline"
            tone="purple"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Optional"
          />

          <View style={styles.addressBlock}>
            <LocationField
              label="Property address *"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setLat(undefined);
                setLng(undefined);
              }}
              onResolved={(loc) => {
                setAddress(loc.address);
                setLat(loc.lat);
                setLng(loc.lng);
              }}
              biasLat={initial.lat ?? autoLocation?.lat}
              biasLng={initial.lng ?? autoLocation?.lng}
            />
            {locating && (
              <View style={styles.note}>
                <Ionicons name="navigate-outline" size={16} color={colors.textMuted} />
                <Text style={styles.noteText}>Finding this address from your location…</Text>
              </View>
            )}
            {!locating && locationNote ? (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.noteText}>{locationNote}</Text>
              </View>
            ) : null}
            {coordinatesOnly && (
              <View style={styles.note}>
                <Ionicons name="warning-outline" size={16} color={colors.warn} />
                <Text style={styles.noteText}>
                  That is a coordinate pair, not a street. Type the address — a packet cannot carry
                  GPS numbers as the property.
                </Text>
              </View>
            )}
          </View>

          {roof && (
            <>
              <Text style={styles.fieldLabel}>Roof material *</Text>
              <View style={styles.chipWrap}>
                {ROOF_MATERIALS.map((m) => {
                  const active = material === m;
                  return (
                    <PressableScale
                      key={m}
                      pressedScale={0.96}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setMaterial(m)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {ROOF_MATERIAL_LABELS[m]}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Condition</Text>
              <View style={styles.chipWrap}>
                {CONDITIONS.map((c) => {
                  const active = condition === c;
                  return (
                    <PressableScale
                      key={c}
                      pressedScale={0.96}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setCondition(c)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {CONDITION_LABELS[c]}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Roof age</Text>
              <View style={styles.stepperRow}>
                <PressableScale
                  style={styles.stepperBtn}
                  pressedScale={0.94}
                  onPress={() => setAgeYears(Math.max(0, (ageYears ?? 0) - 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Roof age minus one year"
                >
                  <Ionicons name="remove" size={24} color={colors.text} />
                </PressableScale>
                <Text style={styles.stepperValue}>{ageYears == null || ageYears === 0 ? 'Not set' : `${ageYears} yr`}</Text>
                <PressableScale
                  style={styles.stepperBtn}
                  pressedScale={0.94}
                  onPress={() => setAgeYears((ageYears ?? 0) + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Roof age plus one year"
                >
                  <Ionicons name="add" size={24} color={colors.text} />
                </PressableScale>
              </View>
              {ageHint ? (
                <PressableScale
                  style={styles.hintChip}
                  onPress={() => setAgeYears(ageHint.ageYears)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${ageHint.ageYears} years from the property record`}
                >
                  <Ionicons name="sparkles-outline" size={16} color={colors.brand} />
                  <Text style={styles.hintText}>Use {ageHint.ageYears} yr — {ageHint.note}</Text>
                </PressableScale>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* Sticky 88pt Save; a quiet skip beneath it when the caller offers one. */}
        <View style={styles.footer}>
          <PressableScale
            style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
            disabled={!canSave}
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel={saveLabel}
            accessibilityState={{ disabled: !canSave }}
          >
            <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>{saveLabel}</Text>
          </PressableScale>
          {!canSave && (
            <Text style={styles.saveHint}>
              {!nameOk
                ? 'Add the customer name'
                : !addressOk
                  ? 'Add the property address'
                  : 'Pick the roof material'}
              {' '}to save.
            </Text>
          )}
          {skipLabel && onSkip && (
            <PressableScale
              style={styles.skipBtn}
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={skipLabel}
            >
              <Text style={styles.skipText}>{skipLabel}</Text>
            </PressableScale>
          )}
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

/** Same colour-chipped filled row the New Lead form uses. */
function Field({
  label,
  icon,
  tone,
  ...rest
}: { label: string; icon: IoniconName; tone: ChipTone } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <IconChip name={icon} tone={tone} size="sm" />
        <TextInput style={styles.input} placeholderTextColor={colors.textSubtle} {...rest} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flexShrink: 1 },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.lg, paddingBottom: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  input: { flex: 1, fontSize: fontSize.bodyLg, color: colors.text },
  addressBlock: { gap: spacing.sm },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  noteText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fillQuiet,
  },
  stepperValue: { flex: 1, textAlign: 'center', fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text },
  hintChip: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.brandSoft,
  },
  hintText: { flex: 1, fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  // 56pt chips (Drift #1).
  chip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.text },
  chipText: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.textInverse },
  footer: { gap: spacing.sm, paddingTop: spacing.sm },
  saveBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: colors.fillDisabled },
  saveText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  saveTextDisabled: { color: colors.textMuted },
  saveHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
  skipBtn: { minHeight: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textMuted },
});
