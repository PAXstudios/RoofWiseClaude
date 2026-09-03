import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/glass/GlassCard';
import { useDeviceMotion, useAltitudeFeet } from '@/lib/services/deviceMotion';
import { pitchDegreesToRatio, type Inspection, type Slope } from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  glass,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Where a reading goes. Launched with `inspectionId` + `slopeId` it files
 * straight onto that slope; with `inspectionId` alone it asks which slope;
 * with `target=wizard` it hands the reading to the New Job wizard through
 * the prefill store; standalone (Train tab) it asks which job. A reading is
 * never dropped on the floor — the old CTA only called `router.back()`.
 */
type GaugeParams = { inspectionId?: string; slopeId?: string; target?: string };

/** Above this the number is outside anything a roof can be — clamped. */
const MAX_PITCH_DEGREES = 75;
/**
 * Real residential roofs top out around 12:12 (45°). Past 60° the phone was
 * almost certainly not flat on the shingles, so the reading is labelled
 * implausible and the roofer has to confirm it on purpose before it saves.
 */
const IMPLAUSIBLE_PITCH_DEGREES = 60;

/** Clamp to the physical range and round to half a degree — the sensor's noise floor. */
function normalizePitch(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const clamped = Math.max(0, Math.min(MAX_PITCH_DEGREES, degrees));
  return Math.round(clamped * 2) / 2;
}

export default function PitchGauge() {
  // Pitch measurement needs the phone's motion sensors held flat against
  // the slope — there is no desktop-web equivalent. Branching lives in this
  // wrapper so the native component's hooks stay unconditional.
  if (Platform.OS === 'web') return <PitchGaugeWebNotice />;
  return <PitchGaugeNative />;
}

function PitchGaugeWebNotice() {
  const router = useRouter();
  return (
    <SafeAreaView style={webStyles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={webStyles.wrap}>
        <View style={webStyles.iconWrap}>
          <Ionicons name="compass-outline" size={36} color={colors.brand} />
        </View>
        <Text style={webStyles.title}>Pitch Gauge uses the phone&apos;s motion sensors</Text>
        <Text style={webStyles.body}>
          This tool runs on the RoofWise mobile app — your jobs, leads,
          reports, and map stay in sync here on the web.
        </Text>
        <Pressable style={webStyles.cta} onPress={() => router.replace('/')}>
          <Text style={webStyles.ctaText}>Back to dashboard</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const webStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
    maxWidth: 420,
  },
  body: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
    maxWidth: 420,
  },
  cta: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});

/** A reading frozen at the moment Save was pressed, waiting for a destination. */
type PendingAttach = { degrees: number; inspection: Inspection | null };

function PitchGaugeNative() {
  const router = useRouter();
  const params = useLocalSearchParams<GaugeParams>();
  const { pitchDegrees, rollDegrees } = useDeviceMotion();
  const altFeet = useAltitudeFeet();
  const inspections = useInspectionStore((s) => s.inspections);
  const setSlopePitch = useInspectionStore((s) => s.setSlopePitch);
  const setRoofPitch = useInspectionStore((s) => s.setRoofPitch);
  const setWizardPitch = useWizardPrefillStore((s) => s.setPitch);
  const toast = useToastStore((s) => s.show);

  // The live number keeps moving while the roofer's thumb is on the screen;
  // what gets filed is the value at the moment they pressed Save.
  const [attach, setAttach] = useState<PendingAttach | null>(null);

  const ratio = useMemo(() => pitchDegreesToRatio(pitchDegrees), [pitchDegrees]);
  const liveImplausible = pitchDegrees > IMPLAUSIBLE_PITCH_DEGREES;

  const targetInspection = params.inspectionId
    ? inspections.find((i) => i.id === params.inspectionId)
    : undefined;
  const targetSlope =
    targetInspection && params.slopeId
      ? targetInspection.slopes.find((s) => s.id === params.slopeId)
      : undefined;
  const toWizard = params.target === 'wizard';

  const destination = targetSlope && targetInspection
    ? `${targetSlope.orientation} slope · ${targetInspection.customerName}`
    : targetInspection
      ? targetInspection.customerName
      : toWizard
        ? 'New job'
        : null;

  const levelTint = (() => {
    const r = Math.abs(rollDegrees);
    if (r < 2) return colors.success;
    if (r < 8) return colors.warn;
    return colors.danger;
  })();

  const done = (title: string, body?: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({ tone: 'success', title, body });
    setAttach(null);
    router.back();
  };

  const fileOnSlope = (ins: Inspection, slope: Slope, degrees: number) => {
    setSlopePitch(ins.id, slope.id, degrees);
    done(`${degrees}° saved`, `${slope.orientation} slope · ${ins.customerName}`);
  };

  const fileOnRoof = (ins: Inspection, degrees: number) => {
    setRoofPitch(ins.id, degrees);
    done(`${degrees}° saved`, `Whole roof · ${ins.customerName}`);
  };

  const commit = (degrees: number) => {
    if (targetInspection && targetSlope) {
      fileOnSlope(targetInspection, targetSlope, degrees);
      return;
    }
    if (toWizard) {
      setWizardPitch(degrees);
      done(`${degrees}° sent to the new job`);
      return;
    }
    // A job without a slope id (or a slope id that no longer exists) still
    // asks — the reading goes somewhere the roofer chose, or nowhere.
    setAttach({ degrees, inspection: targetInspection ?? null });
  };

  const onSave = () => {
    const degrees = normalizePitch(pitchDegrees);
    if (degrees > IMPLAUSIBLE_PITCH_DEGREES) {
      Alert.alert(
        `${degrees}° is steeper than any roof`,
        'Real slopes top out near 45° (12:12). Hold the phone flat on the shingles with the long edge running downhill and read again.',
        [
          { text: 'Re-measure', style: 'cancel' },
          { text: 'Save anyway', style: 'destructive', onPress: () => commit(degrees) },
        ],
      );
      return;
    }
    commit(degrees);
  };

  const copyReading = async (degrees: number) => {
    await Clipboard.setStringAsync(`${degrees}° (${pitchDegreesToRatio(degrees)})`).catch(
      () => {},
    );
    toast({ tone: 'info', title: 'Reading copied', body: `${degrees}° — paste it into the job notes` });
    setAttach(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.headerTitle}>Pitch Gauge</Text>
      </View>

      <View style={styles.body}>
        {destination ? (
          <View style={styles.destination}>
            <Ionicons name="pin-outline" size={16} color={colors.cream} />
            <Text style={styles.destinationText} numberOfLines={1}>
              Saves to {destination}
            </Text>
          </View>
        ) : null}
        <Text style={styles.hint}>Hold the phone flat against the slope, then tap Save.</Text>

        <View style={styles.readout}>
          <Text style={[styles.degrees, liveImplausible && styles.degreesImplausible]}>
            {pitchDegrees.toFixed(1)}°
          </Text>
          <Text style={styles.ratio}>{ratio}</Text>
          {liveImplausible && (
            <Text style={styles.implausible}>
              Steeper than any roof — re-seat the phone on the shingles.
            </Text>
          )}
        </View>

        <View style={styles.bullseye}>
          <View style={[styles.bullseyeOuter, { borderColor: levelTint }]} />
          <View
            style={[
              styles.bullseyeDot,
              {
                backgroundColor: levelTint,
                transform: [
                  { translateX: clampTransform(rollDegrees) },
                  { translateY: 0 },
                ],
              },
            ]}
          />
        </View>

        <View style={styles.altRow}>
          <Ionicons name="trending-up-outline" size={20} color={colors.cream} />
          <Text style={styles.altText}>
            {altFeet === null ? 'Reading altitude…' : `${altFeet.toFixed(0)} ft elevation`}
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.cta}
        onPress={onSave}
        accessibilityRole="button"
        accessibilityLabel={`Save pitch ${normalizePitch(pitchDegrees)} degrees`}
      >
        <Text style={styles.ctaText}>Save pitch ({normalizePitch(pitchDegrees).toFixed(0)}°)</Text>
      </Pressable>

      <AttachSheet
        pending={attach}
        inspections={inspections}
        onPickInspection={(ins) => {
          if (!attach) return;
          // No slopes yet: nothing to choose between, the roof takes it and
          // hands it to each slope as it is shot.
          if (ins.slopes.length === 0) fileOnRoof(ins, attach.degrees);
          else setAttach({ ...attach, inspection: ins });
        }}
        onBackToJobs={() => attach && setAttach({ ...attach, inspection: null })}
        onPickSlope={(ins, slope) => attach && fileOnSlope(ins, slope, attach.degrees)}
        onPickRoof={(ins) => attach && fileOnRoof(ins, attach.degrees)}
        onCopy={() => attach && copyReading(attach.degrees)}
        onCancel={() => setAttach(null)}
      />
    </SafeAreaView>
  );
}

/**
 * "Where does this go?" — a job list, then that job's slopes. Glove-sized
 * rows, one tap each. Cancel is the roofer's explicit choice to discard.
 */
function AttachSheet({
  pending,
  inspections,
  onPickInspection,
  onBackToJobs,
  onPickSlope,
  onPickRoof,
  onCopy,
  onCancel,
}: {
  pending: PendingAttach | null;
  inspections: Inspection[];
  onPickInspection: (ins: Inspection) => void;
  onBackToJobs: () => void;
  onPickSlope: (ins: Inspection, slope: Slope) => void;
  onPickRoof: (ins: Inspection) => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const ins = pending?.inspection ?? null;
  const degrees = pending?.degrees ?? 0;

  return (
    <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Dismiss">
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          {/* Stop the scrim's dismiss from firing on taps inside the sheet. */}
          <Pressable onPress={() => {}}>
            <GlassCard level="high" radius={radii.xl} style={styles.sheet}>
              {ins === null ? (
                <>
                  <Text style={styles.sheetTitle}>Attach {degrees}° to a job</Text>
                  {inspections.length === 0 ? (
                    <>
                      <Text style={styles.sheetBody}>
                        No jobs on this device yet. The reading is not stored anywhere until it
                        has a job — copy it, then start one from Home.
                      </Text>
                      <SheetButton icon="copy-outline" label={`Copy ${degrees}°`} onPress={onCopy} />
                    </>
                  ) : (
                    <FlatList
                      data={inspections}
                      keyExtractor={(i) => i.id}
                      style={styles.list}
                      keyboardShouldPersistTaps="handled"
                      ItemSeparatorComponent={() => <View style={styles.rowSep} />}
                      renderItem={({ item }) => (
                        <Pressable
                          onPress={() => onPickInspection(item)}
                          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.customerName}, ${item.reportId}`}
                        >
                          <View style={styles.rowBody}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {item.customerName}
                            </Text>
                            <Text style={styles.rowSub} numberOfLines={1}>
                              {item.reportId} · {item.address}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={20} color={colors.textInverse} />
                        </Pressable>
                      )}
                    />
                  )}
                </>
              ) : (
                <>
                  <Pressable
                    onPress={onBackToJobs}
                    style={({ pressed }) => [styles.sheetBack, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Back to jobs"
                  >
                    <Ionicons name="chevron-back" size={20} color={colors.textInverse} />
                    <Text style={styles.sheetBackText}>Jobs</Text>
                  </Pressable>
                  <Text style={styles.sheetTitle}>
                    {degrees}° · which slope? · {ins.customerName}
                  </Text>
                  <Text style={styles.sheetBody}>
                    Whole roof also fills any slope that has no pitch yet.
                  </Text>
                  <View style={styles.chipWrap}>
                    {ins.slopes.map((sl) => (
                      <Pressable
                        key={sl.id}
                        onPress={() => onPickSlope(ins, sl)}
                        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`${sl.orientation} slope`}
                      >
                        <Text style={styles.chipText}>{sl.orientation}</Text>
                        <Text style={styles.chipSub}>
                          {sl.pitchDegrees != null
                            ? `${sl.pitchDegrees}° now`
                            : `${sl.photoPaths.length} photo${sl.photoPaths.length === 1 ? '' : 's'}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <SheetButton icon="home-outline" label="Whole roof" onPress={() => onPickRoof(ins)} />
                </>
              )}

              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </GlassCard>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function SheetButton({
  icon,
  label,
  onPress,
}: {
  icon: 'copy-outline' | 'home-outline';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.sheetBtnText}>{label}</Text>
    </Pressable>
  );
}

function clampTransform(rollDegrees: number): number {
  // Move the bullseye dot horizontally based on roll, capped at ±60px.
  const x = rollDegrees * 2;
  return Math.max(-60, Math.min(60, x));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.textInverse },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: glass.fill,
    maxWidth: '90%',
  },
  destinationText: { color: colors.cream, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  hint: { fontSize: fontSize.bodyMd, color: 'rgba(255,255,255,0.78)', textAlign: 'center', paddingHorizontal: spacing.xxl },

  readout: { alignItems: 'center', gap: spacing.xs },
  degrees: { fontSize: 96, fontWeight: fontWeight.bold, color: colors.cream, letterSpacing: -2 },
  degreesImplausible: { color: colors.warn },
  ratio: { fontSize: fontSize.titleLg, fontWeight: fontWeight.semibold, color: colors.orange, marginTop: -spacing.sm },
  implausible: {
    color: colors.warn,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },

  bullseye: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bullseyeOuter: { ...StyleSheet.absoluteFill, borderWidth: 2, borderRadius: 70 },
  bullseyeDot: { width: 24, height: 24, borderRadius: 12 },

  altRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  altText: { color: colors.cream, fontSize: fontSize.bodyMd },

  cta: {
    margin: spacing.xl,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  // Attach sheet — same glass sheet the capture flow's slope picker uses.
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.md },
  sheet: { padding: spacing.lg, gap: spacing.md },
  sheetTitle: { color: colors.textInverse, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold },
  sheetBody: { color: colors.textInverse, opacity: 0.8, fontSize: fontSize.bodySm, lineHeight: 18 },
  sheetBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.small,
    alignSelf: 'flex-start',
  },
  sheetBackText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  list: { maxHeight: 360 },
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
  },
  rowSep: { height: spacing.sm },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  rowSub: { color: colors.textInverse, opacity: 0.7, fontSize: fontSize.bodySm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 64pt chips — the "preferred" target for a gloved thumb.
  chip: {
    minWidth: touchTarget.preferred * 1.5,
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  chipText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  chipSub: { color: colors.textInverse, opacity: 0.7, fontSize: fontSize.caption },
  sheetBtn: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  sheetBtnText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  cancel: { minHeight: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.7 },
});
