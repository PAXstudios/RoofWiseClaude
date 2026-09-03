import { PressableScale } from '@/components/PressableScale';
import { formatDate, formatDateShort, formatRelative } from '@/lib/format/date';
import { useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Alert,
  Share,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { QuickActions } from '@/components/pipeline/QuickActions';
import { FOLLOW_UP_OPTIONS, FollowUpSheet } from '@/components/pipeline/FollowUpSheet';
import { LinkedLeadCard } from '@/components/pipeline/LinkedLeadCard';
import { findLinkedLead, nextStageFor } from '@/components/pipeline/chain';
import * as ImagePicker from 'expo-image-picker';
import { generateHaagReport } from '@/lib/services/haagPdf';
import { generateLongReport } from '@/lib/services/longReport';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import {
  importFromLibrary,
  isUnreadableAssetError,
  type LibraryImportProgress,
} from '@/lib/services/libraryImport';
import {
  deriveAnalysisProgress,
  pendingPhotoCount,
  queueSlopeAnalysis,
} from '@/lib/services/analysisQueue';
import { useCaptureSettingsStore } from '@/lib/stores/captureSettingsStore';
import { DEFAULT_CAPTURE_MODE, defaultAreaTagForSlope } from '@/lib/services/captureSession';
import { SignaturePad } from '@/components/SignaturePad';
import { VoiceNoteRecorder } from '@/components/VoiceNoteRecorder';
import { DamageScoreBar } from '@/components/DamageScoreBar';
import { DamageScoreCard } from '@/components/DamageScoreCard';
import { PropertyIntelCard } from '@/components/PropertyIntelCard';
import { DamageDetailSection, summarizeInspection } from '@/components/DamageDetailSection';
import { documentedCoverage, documentedSummary } from '@/lib/services/documentedSquares';
import { deriveFunctional } from '@/lib/services/functionalDamage';
import { describeMissingDetails, missingJobDetails } from '@/lib/services/placeholderDetails';
import { CustomerDetailsSheet } from '@/components/sheets/CustomerDetailsSheet';
import { SlopePickerSheet } from '@/components/capture/SlopePickerSheet';
import { damageScoreFromEngine } from '@/lib/services/damageScore';
import { AnalysisQueueChip } from '@/components/AnalysisQueueChip';
import { transcribeAudio } from '@/lib/services/transcribeAudio';
import { useToastStore } from '@/lib/stores/toastStore';
import { isGeminiConfigured } from '@/lib/env';
import { carrierBarsRead, thresholdFor } from '@/lib/services/haagThresholds';
import {
  CLAIM_VIABILITY_LABELS,
  ROOFWISE_RECOMMENDATION_LABELS,
  SAFETY_RATING_LABELS,
  type ClaimViabilityBand,
  type RoofwiseRecommendation,
} from '@/lib/services/decisionEngine';
import {
  resolveEngineResult,
  snapshotEngineResult,
  storedEngineFreshness,
} from '@/lib/services/storedEngine';
import { getSafetyForecast } from '@/lib/services/weather';
import {
  CAUSE_OF_LOSS_LABELS,
  COLLATERAL_ZONES,
  COLLATERAL_ZONE_LABELS,
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  POLICY_TYPE_LABELS,
  ROOF_MATERIAL_LABELS,
  type BrittlenessResult,
  type Inspection,
  type Slope,
  type SlopeOrientation,
  type SlopeVerdict,
} from '@/lib/models/types';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Roof-system subtitle. Fields absent on an older persisted inspection are
 * DROPPED, never interpolated — a card reading "undefined · 12 yr · undefined"
 * is worse than one reading "12 yr".
 */
function roofSystemLine(ins: Inspection): string {
  return [ins.geometry, `${ins.ageYears} yr`, ins.condition]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' · ');
}

/** Rates are read by adjusters — print 6.9, never 6.888888888888889. */
function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const COLLATERAL_ITEMS = [
  { key: 'brittleness_observed', label: 'Brittleness observed on test shingles' },
  { key: 'mat_exposed', label: 'Mat exposure visible on damaged slopes' },
  { key: 'multi_layer', label: 'Multi-layer roof system (2+ layers)' },
  { key: 'metal_collateral', label: 'Collateral damage on metal (vents, flashing, AC)' },
  { key: 'window_screens', label: 'Hail damage on window screens / siding' },
  { key: 'gutters_dented', label: 'Dents in gutters or downspouts' },
];

/** Claim-viability band → the Pill tone that carries it on the photo hero. */
const BAND_PILL_TONE: Record<ClaimViabilityBand, PillTone> = {
  HIGH: 'success',
  MEDIUM: 'warn',
  LOW: 'danger',
};

/** Roofwise recommendation → icon chip colour/glyph for the HAAG verdict card. */
const RECOMMENDATION_TONE: Record<RoofwiseRecommendation, ChipTone> = {
  FULL_REPLACEMENT: 'orange',
  PARTIAL_REPLACEMENT: 'orange',
  REPAIR: 'green',
  NO_STORM_DAMAGE: 'quiet',
};
const RECOMMENDATION_ICON: Record<RoofwiseRecommendation, IoniconName> = {
  FULL_REPLACEMENT: 'hammer-outline',
  PARTIAL_REPLACEMENT: 'construct-outline',
  REPAIR: 'checkmark-done-outline',
  NO_STORM_DAMAGE: 'close-circle-outline',
};

/** Per-slope verdict → Pill tone + label. Same semantics the old hand-rolled
 * VerdictPill used (accent/warn/info/neutral), just spoken through the
 * shared `Pill` primitive instead of a bespoke badge. */
const SLOPE_VERDICT_PILL_TONE: Record<SlopeVerdict, PillTone> = {
  full_replace: 'accent',
  partial_replace: 'warn',
  verify_with_inspector: 'info',
  repair: 'neutral',
};
const SLOPE_VERDICT_LABEL: Record<SlopeVerdict, string> = {
  full_replace: 'Full replace',
  partial_replace: 'Partial',
  verify_with_inspector: 'Verify',
  repair: 'Repair',
};

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspectionStore((s) => s.inspections.find((i) => i.id === id));
  const remove = useInspectionStore((s) => s.remove);
  const setStatus = useInspectionStore((s) => s.setStatus);
  const setInspectorSignature = useInspectionStore((s) => s.setInspectorSignature);
  const setCollateralItem = useInspectionStore((s) => s.setCollateralItem);
  const setPropertyIntel = useInspectionStore((s) => s.setPropertyIntel);
  const setCollateralZone = useInspectionStore((s) => s.setCollateralZone);
  const setBrittlenessProtocol = useInspectionStore((s) => s.setBrittlenessProtocol);
  const setReportFinalizedAt = useInspectionStore((s) => s.setReportFinalizedAt);
  const setStoredEngineResult = useInspectionStore((s) => s.setStoredEngineResult);
  const setNotes = useInspectionStore((s) => s.setNotes);
  const updateDetails = useInspectionStore((s) => s.updateDetails);
  const addAudioNote = useInspectionStore((s) => s.addAudioNote);
  const removeAudioNote = useInspectionStore((s) => s.removeAudioNote);
  const setAudioNoteLabel = useInspectionStore((s) => s.setAudioNoteLabel);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);
  const proposal = useProposalStore((s) => (id ? s.getByJob(id) : undefined));
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const multiSelectImport = useCaptureSettingsStore((s) => s.multiSelectImport);
  // The lead behind this job — the other half of the Lead → Job chain. Read
  // here so the customer action row and the status toggle can move it.
  const leads = useLeadStore((s) => s.leads);
  const setLeadStage = useLeadStore((s) => s.setStage);
  const setLeadFollowUp = useLeadStore((s) => s.setFollowUp);
  const [followUpSheet, setFollowUpSheet] = useState(false);
  // The customer / address / roof-system editor. A standalone Quick
  // Inspection lands here as "Quick inspection / Address pending"; this is
  // where it gets corrected.
  const [detailsSheet, setDetailsSheet] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingLong, setGeneratingLong] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<LibraryImportProgress | null>(null);
  // Library import asks WHICH slope first — it used to file everything under
  // the last slope (South on an empty job), silently.
  const [importSlopePicker, setImportSlopePicker] = useState(false);
  // "Record now" on the finalize gate has to land the roofer on the card that
  // fixes the problem, not just dismiss a dialog.
  const scrollRef = useRef<ScrollView>(null);
  const evidenceCardY = useRef(0);

  if (!inspection) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSubtle} />
          <Text style={styles.emptyTitle}>Job not found</Text>
          <PressableScale style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  // The same read path the reports use: the STORED engine result when it still
  // speaks for the current inputs, otherwise a fresh evaluation. Reading it
  // here is what keeps this screen and the generated PDF from ever showing two
  // different determinations for one roof.
  //
  // `honorFreeze: false`: this screen describes the roof as it stands right
  // now. When the report was signed and the inputs changed afterwards, the
  // frozen snapshot is a pre-edit determination — restating it here would hide
  // the edit. The banner below says the signed packet is behind; regenerating
  // re-freezes the two together.
  const { haag, decision } = resolveEngineResult(inspection, Date.now(), { honorFreeze: false });
  const engineFreshness = storedEngineFreshness(inspection);
  const isClaim = inspection.kind === 'insurance_claim';

  // A verdict needs evidence. With zero analyzed photos the engine still
  // returns a band and a recommendation (it evaluates whatever it is given),
  // and rendering "Medium · Repair" on a job nobody has photographed is a
  // synthesized determination (Drift #5). Every verdict slot below reads this
  // and shows "Not assessed" until at least one photo has been analyzed —
  // the same rule DamageScoreCard already enforces for the score.
  const analyzedPhotos = summarizeInspection(inspection).analyzedPhotos;
  const hasEvidence = analyzedPhotos > 0;

  // Placeholder customer / address (a standalone Quick Inspection, or a job
  // whose details were never filled). The packet and the proposal CTAs stay
  // off until both are real — "Address pending" must never reach a carrier.
  const missing = missingJobDetails(inspection);

  // Explicit link only (`inspection.leadId` / `lead.inspectionId`) — never a
  // name match, which could hang another customer's follow-ups on this roof.
  const linkedLead = findLinkedLead(inspection, leads);

  /** Follow-ups live on the lead; a job with no lead has nowhere to keep one. */
  const onPickFollowUp = (when: Date | null) => {
    setFollowUpSheet(false);
    if (!linkedLead) return;
    if (!when) {
      setLeadFollowUp(linkedLead.id, undefined);
      toast({ tone: 'info', title: 'Follow-up cleared' });
      return;
    }
    setLeadFollowUp(linkedLead.id, when.toISOString());
    scheduleFollowUpReminder({
      leadId: linkedLead.id,
      customerName: linkedLead.customerName,
      date: when,
    }).catch(() => {});
    toast({ tone: 'success', title: 'Follow-up set', body: formatDateShort(when) });
  };

  // The hero's photo — the job's real first captured photo, across any
  // slope. Never stock imagery: no photo yet means the crafted gradient
  // placeholder below, not a synthesized image.
  const heroPhoto = inspection.slopes.flatMap((sl) => sl.photoPaths)[0];
  const totalPhotos = inspection.slopes.reduce((a, sl) => a + sl.photoPaths.length, 0);
  const totalFindings = inspection.slopes.reduce(
    (a, sl) => a + (sl.aiFindings ?? []).filter((f) => f.detected).length,
    0,
  );
  // Live analysis backlog for THIS job — drives the header status button and
  // is the same real per-photo count the Processing view reads.
  const pendingHere = pendingPhotoCount(deriveAnalysisProgress([inspection]));

  const openCapture = () =>
    router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } });

  /**
   * Import existing photos from the library straight into this job. Each asset
   * rides the shared `importFromLibrary` service (same pipeline + multi-select
   * story as the capture screen), attaches to the slope the inspector picks in
   * the sheet — never a guessed one — then the whole slope is queued for
   * background analysis — so imported photos flow through the exact same
   * analysis queue as captured ones and land back here with per-photo state.
   */
  const runJobLibraryImport = () => {
    if (importing) return;
    setImportSlopePicker(true);
  };

  const runJobLibraryImportFor = async (targetSlope: SlopeOrientation) => {
    setImportSlopePicker(false);
    if (importing) return;
    setImporting(true);
    setImportProgress(null);
    const areaTag = defaultAreaTagForSlope(targetSlope);
    try {
      const result = await importFromLibrary({
        multiSelect: multiSelectImport,
        onProgress: setImportProgress,
        onPhoto: (uri) => {
          // Throwing marks THIS asset failed in the service and the batch
          // continues — a single bad write never loses the rest.
          attachRawPhotos(inspection.id, [
            { uri, slope: targetSlope, areaTag, captureMode: DEFAULT_CAPTURE_MODE },
          ]);
        },
      });

      if (result.permission === 'denied') {
        Alert.alert(
          'Photos access needed',
          result.permissionCanAskAgain
            ? 'RoofWise needs Photos access to import existing roof images.'
            : 'Enable Photos access for RoofWise in Settings to import existing images.',
        );
        return;
      }

      if (result.imported > 0) {
        const slope = useInspectionStore
          .getState()
          .getById(inspection.id)
          ?.slopes.find((s) => s.orientation === targetSlope);
        logActivity({
          kind: 'photo_captured',
          inspectionId: inspection.id,
          message: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'} from library`,
        });
        if (slope && isGeminiConfigured) {
          queueSlopeAnalysis({
            inspectionId: inspection.id,
            slopeId: slope.id,
            slopeLabel: slope.orientation,
          });
          toast({
            tone: 'success',
            title: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'}`,
            body: 'Analyzing in the background — tap the status card to watch.',
          });
        } else {
          toast({
            tone: isGeminiConfigured ? 'success' : 'warn',
            title: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'}`,
            body: isGeminiConfigured
              ? undefined
              : 'AI not connected — photos saved without analysis.',
          });
        }
      }

      if (result.failures.length > 0) {
        const n = result.failures.length;
        const first = result.failures[0].reason;
        Alert.alert(
          result.imported > 0 ? `Imported ${result.imported}, skipped ${n}` : "Couldn't read that photo",
          isUnreadableAssetError(first)
            ? `${first} Try different photos, or run on a real iPhone.`
            : first,
        );
      } else if (result.reachedLimit && result.imported > 0) {
        Alert.alert(
          'Import paused',
          `Added ${result.imported} photos. Tap Import again to keep going.`,
        );
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  // Pre-formatted insurance body lines — computed once so the RichCard below
  // can pass `null` (no body at all) rather than an array of `false`s when
  // there is nothing real to show.
  const insurancePolicyLine =
    inspection.policyNumber || inspection.claimNumber
      ? [
          inspection.policyNumber && `Policy ${inspection.policyNumber}`,
          inspection.claimNumber && `Claim ${inspection.claimNumber}`,
        ]
          .filter(Boolean)
          .join('  ·  ')
      : null;
  const claimDetailLine = isClaim
    ? [
        inspection.causeOfLoss && CAUSE_OF_LOSS_LABELS[inspection.causeOfLoss],
        inspection.policyType && POLICY_TYPE_LABELS[inspection.policyType],
        inspection.deductible != null && `$${inspection.deductible.toLocaleString()} deductible`,
        // Formatted, never raw: the stored value is an ISO timestamp and a
        // raw one reads as broken on a claim screen.
        inspection.dateOfLoss && `DOL ${formatDateShort(inspection.dateOfLoss)}`,
      ]
        .filter(Boolean)
        .join('  ·  ') || 'Claim details not recorded yet'
    : null;

  const onDelete = () => {
    Alert.alert(
      'Delete job?',
      `${inspection.reportId} will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          remove(inspection.id);
          // dismissTo, not replace: replace stacked a second tab shell (NAV-3).
          router.dismissTo('/(tabs)');
        } },
      ],
    );
  };

  // ---------- Finalize gate (insurance claims) ----------
  //
  // The brittleness protocol is the §3 repairability gate: with no result the
  // gate cannot be evaluated at all, and with a result but no photograph it
  // rests on the inspector's word alone (§VII-C requires the process be
  // photographed). Both gaps are DISCLOSED in the generated report, so this is
  // informative friction and never a hard block — a roofer standing next to an
  // adjuster may need the packet now and record the test after.
  const proto = inspection.brittlenessProtocol;
  const brittlenessGap: string | null = !isClaim
    ? null
    : !proto?.result
      ? 'Brittleness test not recorded. The HAAG repairability gate (§3) cannot be evaluated without it.'
      : proto.photoIds.length === 0
        ? `Brittleness test recorded as ${proto.result}, but no photo evidence is attached. The field protocol requires a photo of the test process.`
        : null;

  const jumpToClaimEvidence = () =>
    scrollRef.current?.scrollTo({
      y: Math.max(0, evidenceCardY.current - spacing.xl),
      animated: true,
    });

  /**
   * Freeze the determination the report is about to be signed with, and hand
   * back the inspection the report should render from.
   *
   * Order matters: the snapshot is taken and stored BEFORE the PDF renders, so
   * the document restates exactly the determination that was frozen. Snapshot
   * after rendering and a report generated with no prior snapshot would print
   * one determination while the store froze another.
   *
   * The §7 safety rating needs a real forecast, and the engine is pure, so the
   * fetch happens at this call site. `getSafetyForecast()` returns null when
   * the service is unreachable or location was never granted; that is passed
   * through as `undefined` so the engine records honest uncertainty rather
   * than a rating computed from absent inputs.
   */
  const finalizeWithSnapshot = async (): Promise<Inspection> => {
    const at = new Date().toISOString();
    try {
      const coord =
        inspection.lat != null && inspection.lng != null
          ? { lat: inspection.lat, lng: inspection.lng }
          : undefined;
      const forecast = (await getSafetyForecast(coord)) ?? undefined;
      const { payload } = snapshotEngineResult(inspection, at, forecast);
      // `force`: this IS the deliberate re-finalize path, so it is allowed to
      // replace a previously frozen snapshot — and it re-stamps
      // `reportFinalizedAt` below, so the record and the document stay in step.
      setStoredEngineResult(inspection.id, payload, at, { force: true });
    } catch {
      // A missed snapshot is recoverable — the report falls back to evaluating
      // the same engine at render time.
    }
    setReportFinalizedAt(inspection.id, at);
    // Re-read: `inspection` is this render's snapshot and does not carry the
    // fields just written.
    return (
      useInspectionStore.getState().inspections.find((i) => i.id === inspection.id) ?? inspection
    );
  };

  const runHaagReport = async () => {
    // Belt and braces with the disabled CTA: nothing generates a packet that
    // names "Quick inspection" at "Address pending".
    if (missing.any) {
      setDetailsSheet(true);
      return;
    }
    try {
      setGenerating(true);
      // Freeze first, then render from the frozen record.
      const finalized = await finalizeWithSnapshot();
      const { uri } = await generateHaagReport(finalized);
      logActivity({
        kind: 'pdf_generated',
        inspectionId: inspection.id,
        message: `Generated HAAG report for ${inspection.reportId}`,
      });
      await Share.share({ url: uri, message: `RoofWise HAAG report ${inspection.reportId}` });
    } catch (e) {
      Alert.alert('Report failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  };

  const onGenerateHaagReport = () => {
    if (!brittlenessGap) {
      void runHaagReport();
      return;
    }
    Alert.alert(
      'Claim evidence is incomplete',
      `${brittlenessGap}\n\nThe report discloses the gap either way — the adjuster will see it.`,
      [
        { text: 'Record now', style: 'cancel', onPress: jumpToClaimEvidence },
        { text: 'Generate anyway', onPress: () => void runHaagReport() },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportId}>{inspection.reportId}</Text>
          <Text style={styles.customer}>{inspection.customerName}</Text>
        </View>
        <PressableScale
          onPress={() => {
            const next =
              inspection.status === 'complete'
                ? 'in_progress'
                : inspection.status === 'in_progress'
                ? 'complete'
                : 'in_progress';
            setStatus(inspection.id, next);
            logActivity({
              kind: next === 'complete' ? 'inspection_completed' : 'job_created',
              inspectionId: inspection.id,
              leadId: linkedLead?.id,
              message:
                next === 'complete'
                  ? `Marked ${inspection.reportId} complete`
                  : `Reopened ${inspection.reportId}`,
            });
            // A completed inspection moves its lead to "Inspection Complete"
            // — forward only, so a lead already past it stays where it is.
            if (next === 'complete' && linkedLead) {
              const stage = nextStageFor(linkedLead, 'inspection_complete');
              if (stage) setLeadStage(linkedLead.id, stage);
            }
          }}
          hitSlop={10}
          style={[
            styles.statusToggle,
            inspection.status === 'complete' && styles.statusToggleComplete,
          ]}
        >
          <Ionicons
            name={
              inspection.status === 'complete'
                ? 'checkmark-circle'
                : 'ellipse-outline'
            }
            size={18}
            color={
              inspection.status === 'complete' ? colors.textInverse : colors.text
            }
          />
          <Text
            style={[
              styles.statusToggleText,
              inspection.status === 'complete' && { color: colors.textInverse },
            ]}
          >
            {inspection.status === 'complete' ? 'Complete' : 'Mark complete'}
          </Text>
        </PressableScale>
        {pendingHere > 0 && (
          <PressableScale
            onPress={() => router.push('/processing')}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={`${pendingHere} photo${pendingHere === 1 ? '' : 's'} analyzing. Open processing.`}
          >
            <ActivityIndicator size="small" color={colors.brand} />
          </PressableScale>
        )}
        <PressableScale onPress={onDelete} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </PressableScale>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        {/* A placeholder job announces itself before anything else on the
            page: the hero below would otherwise present "Address pending" as
            the property. One tap opens the editor. */}
        {missing.any && (
          <PressableScale
            style={styles.missingBanner}
            onPress={() => setDetailsSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={`${describeMissingDetails(missing)}. This job still has placeholder details. Tap to add them.`}
          >
            <Ionicons name="person-add-outline" size={22} color={colors.warn} />
            <View style={{ flex: 1 }}>
              <Text style={styles.missingTitle}>{describeMissingDetails(missing)}</Text>
              <Text style={styles.missingBody}>
                This job still has placeholder details. Reports and the proposal are off until the
                customer and address are real.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.warn} />
          </PressableScale>
        )}

        {/* The screen's cinematic moment: the job's own photo, the address,
            the claim-viability call, and the verdict — a document a carrier
            respects, not a settings row. */}
        <JobHero
          photoUri={heroPhoto}
          reportId={inspection.reportId}
          address={missing.address ? 'Address not set' : inspection.address}
          band={hasEvidence ? haag.claim_viability : undefined}
          recommendation={hasEvidence ? haag.roofwise_recommendation : undefined}
        />

        {/* Customer action row — the phone and email were already on the
            record; this surfaces them. Call / Text / Email / Directions open
            the OS; "Follow-up" books on the linked lead and is absent when
            there is no lead to book on (no dead buttons). */}
        <QuickActions
          name={inspection.customerName}
          phone={inspection.customerPhone}
          email={inspection.customerEmail}
          address={inspection.address}
          coords={{ lat: inspection.lat, lng: inspection.lng }}
          onBook={linkedLead ? () => setFollowUpSheet(true) : undefined}
          bookLabel="Follow-up"
          onContacted={
            linkedLead && linkedLead.stage === 'new'
              ? () => setLeadStage(linkedLead.id, 'contacted')
              : undefined
          }
        />

        {/* The lead this job came from — stage and next follow-up, tap → lead. */}
        {linkedLead && <LinkedLeadCard lead={linkedLead} />}

        {/* The owner's ask: from inside a job, take photos to analyse — a big,
            unmissable primary. Opens capture linked to THIS job so every photo
            attaches here and flows through the analysis queue. */}
        <PressableScale
          style={styles.captureCta}
          onPress={openCapture}
          accessibilityRole="button"
          accessibilityLabel="Take photos to analyse for this job"
        >
          <Ionicons name="camera" size={24} color={colors.textInverse} />
          <Text style={styles.captureCtaText}>Take photos to analyse</Text>
        </PressableScale>

        <PressableScale
          style={[styles.importCta, importing && { opacity: 0.6 }]}
          disabled={importing}
          onPress={runJobLibraryImport}
          accessibilityRole="button"
          accessibilityLabel="Import photos from library for this job"
        >
          {importing ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="images-outline" size={22} color={colors.text} />
          )}
          <Text style={styles.importCtaText}>
            {importing
              ? importProgress
                ? importProgress.phase === 'multi'
                  ? `Importing ${importProgress.done} of ${importProgress.total}…`
                  : `Imported ${importProgress.done}…`
                : 'Opening library…'
              : 'Import from library'}
          </Text>
        </PressableScale>

        {pendingHere > 0 && (
          <View style={styles.pendingStrip}>
            <AnalysisQueueChip inspectionId={inspection.id} />
          </View>
        )}

        <SectionHeader title="Property" style={styles.sectionSpacing} />

        {/* What the app worked out on its own. Every per-square number on this
            screen — HAAG §5 repair cost, the estimate, the proposal — is priced
            against this measurement, so it leads the section. */}
        <PropertyIntelCard
          inspection={inspection}
          onMeasured={(intel) => setPropertyIntel(inspection.id, intel)}
        />

        {/* Customer, address, and roof system — editable. Placeholders read as
            what they are ("not set"), never as a name or a street. */}
        <RichCard
          icon="person-outline"
          iconTone="blue"
          title={missing.name ? 'Customer not set' : inspection.customerName}
          subtitle={missing.address ? 'Address not set' : inspection.address}
          action={{ label: 'Edit', onPress: () => setDetailsSheet(true), icon: 'create-outline' }}
          contentStyle={styles.bodyRows}
          accessibilityLabel="Customer and property details"
        >
          {(inspection.customerPhone || inspection.customerEmail) && (
            <Text style={styles.cardSub}>
              {[inspection.customerPhone, inspection.customerEmail].filter(Boolean).join('  ·  ')}
            </Text>
          )}
          <View style={styles.roofLine}>
            <Ionicons name="layers-outline" size={15} color={colors.textMuted} />
            <Text style={styles.cardSub}>
              {ROOF_MATERIAL_LABELS[inspection.material]}
              {roofSystemLine(inspection) ? ` · ${roofSystemLine(inspection)}` : ''}
            </Text>
          </View>
        </RichCard>

        {(inspection.carrier || isClaim) && (
          <RichCard
            icon="shield-outline"
            iconTone="purple"
            title={inspection.carrier ? INSURANCE_CARRIER_LABELS[inspection.carrier] : 'Insurance'}
            headerTrailing={isClaim ? <Pill label="Insurance Claim" tone="accent" size="sm" /> : undefined}
            contentStyle={styles.bodyRows}
          >
            {insurancePolicyLine || claimDetailLine ? (
              <>
                {insurancePolicyLine && <Text style={styles.cardSub}>{insurancePolicyLine}</Text>}
                {claimDetailLine && <Text style={styles.cardSub}>{claimDetailLine}</Text>}
              </>
            ) : null}
          </RichCard>
        )}

        {inspection.event && (
          <RichCard
            icon="thunderstorm"
            iconTone="orange"
            title={
              inspection.event.kind === 'hail'
                ? `${inspection.event.hailSizeInches?.toFixed(2) ?? ''}" hail`
                : `${inspection.event.windSpeedMph ?? ''} mph wind`
            }
            subtitle={`${formatDate(inspection.event.date, 'Date unavailable')}${
              inspection.event.distanceMiles ? ` · ${inspection.event.distanceMiles.toFixed(1)} mi away` : ''
            } · ${inspection.event.source}${
              inspection.event.noaaEventId ? ` · ${inspection.event.noaaEventId}` : ''
            }`}
          />
        )}

        <SectionHeader title="Assessment" style={styles.sectionSpacing} />

        {/* Condition severity (0-100, 100 = sound) derived from the SAME engine
            result the verdict below cites - passing `haag` rather than letting
            the score re-run the engine is what keeps the two in agreement on a
            frozen packet. */}
        <DamageScoreCard result={damageScoreFromEngine(inspection, haag)} />

        <DamageScoreBar
          band={hasEvidence ? haag.claim_viability : undefined}
          stats={[
            { label: 'Slopes', value: String(inspection.slopes.length) },
            { label: 'Photos', value: String(totalPhotos) },
            { label: 'Findings', value: String(totalFindings) },
          ]}
        />

        <SectionHeader title="Damage detail" style={styles.sectionSpacing} />

        {/* Everything the PDF says, readable here: every category found, on
            which slopes, tap → the photo. */}
        <DamageDetailSection inspection={inspection} />

        <RichCard
          icon={hasEvidence ? RECOMMENDATION_ICON[haag.roofwise_recommendation] : 'help-circle-outline'}
          iconTone={hasEvidence ? RECOMMENDATION_TONE[haag.roofwise_recommendation] : 'quiet'}
          title="HAAG Verdict"
          subtitle={
            hasEvidence
              ? ROOFWISE_RECOMMENDATION_LABELS[haag.roofwise_recommendation]
              : 'Not assessed — analyze photos'
          }
        >
          <Text style={styles.cardSub}>
            {hasEvidence
              ? decision.roofVerdictReasoning
              : 'No analyzed photos yet — a verdict with no evidence behind it would be invented. Capture and analyze photos to get one.'}
          </Text>
          <View style={styles.safetyRow}>
            <Ionicons name="shield-outline" size={15} color={colors.textMuted} />
            <Text style={styles.safetyText}>
              Roofer safety: {SAFETY_RATING_LABELS[haag.roofer_safety_rating]}
            </Text>
          </View>
        </RichCard>

        <RichCard
          onPress={() =>
            router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } })
          }
          icon="scan-outline"
          iconTone="blue"
          title="Start Quick Inspection"
          subtitle="Capture more photos for this job"
          chevron
        />

        <SectionHeader title="Roof Slopes" style={styles.sectionSpacing} />

        {inspection.slopes.length === 0 ? (
          <View style={styles.placeholderBox}>
            <IconChip name="camera-outline" tone="quiet" size="md" />
            <Text style={styles.placeholderText}>
              No slopes captured yet. Tap Start Quick Inspection to take photos.
            </Text>
          </View>
        ) : (
          inspection.slopes.map((slope) => {
            const result = decision.perSlope.find((r) => r.slopeId === slope.id);
            return (
              <SlopeBlock
                key={slope.id}
                inspection={inspection}
                slope={slope}
                verdict={result?.verdict ?? 'repair'}
                reasoning={result?.reasoning ?? ''}
                confidenceAvg={result?.confidenceAvg ?? 0}
                // The rate the ENGINE used, not a second derivation — the test
                // square line must state the same number the verdict cites.
                hitsPerSquare={
                  haag.slope_evaluations.find((e) => e.slope === slope.id)?.hail_hits_per_square
                }
              />
            );
          })
        )}

        {/* A proposal names the customer and the property on its cover; with
            placeholders it opens the editor instead of a document that says
            "Quick inspection". */}
        <RichCard
          onPress={() =>
            missing.any
              ? setDetailsSheet(true)
              : router.push(`/proposal/${inspection.id}` as any)
          }
          icon="document-attach-outline"
          iconTone={missing.any ? 'quiet' : proposal ? 'green' : 'blue'}
          title={proposal ? `Proposal · $${proposal.total.toLocaleString()}` : 'Generate proposal'}
          subtitle={
            missing.any
              ? `${describeMissingDetails(missing)} first — the proposal names them`
              : proposal
                ? `${proposal.status} · ${proposal.lineItems.length} line items`
                : 'From Decision Engine + Solar squares + regional pricing'
          }
          chevron
        />

        <SectionHeader title="Collateral" style={styles.sectionSpacing} />

        <RichCard icon="checkbox-outline" iconTone="blue" title="Collateral Checklist" contentStyle={styles.bodyRows}>
          {COLLATERAL_ITEMS.map((item) => {
            // `?? {}`: inspections persisted before this field existed (and
            // records round-tripped through sync) arrive without it, and a
            // bare index here took the whole job screen down.
            const checked = !!(inspection.collateralChecklist ?? {})[item.key];
            return (
              <PressableScale
                key={item.key}
                style={styles.collateralRow}
                onPress={() => setCollateralItem(inspection.id, item.key, !checked)}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.success : colors.textSubtle}
                />
                <Text style={[styles.collateralLabel, checked && styles.collateralChecked]}>
                  {item.label}
                </Text>
              </PressableScale>
            );
          })}
        </RichCard>

        {isClaim && (
          <View
            onLayout={(e) => {
              evidenceCardY.current = e.nativeEvent.layout.y;
            }}
          >
            <RichCard
              icon="shield-checkmark-outline"
              iconTone="purple"
              title="Claim Evidence"
              contentStyle={styles.bodyRows}
            >
              {COLLATERAL_ZONES.map((zone) => {
                const item = inspection.collateralEvidence?.[zone] ?? { checked: false, photoIds: [] };
                return (
                  <View key={zone} style={styles.zoneRow}>
                    <PressableScale
                      style={[styles.collateralRow, { flex: 1 }]}
                      onPress={() =>
                        setCollateralZone(inspection.id, zone, { checked: !item.checked })
                      }
                    >
                      <Ionicons
                        name={item.checked ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={item.checked ? colors.success : colors.textSubtle}
                      />
                      <Text style={styles.collateralLabel}>{COLLATERAL_ZONE_LABELS[zone]}</Text>
                    </PressableScale>
                    <PressableScale
                      style={styles.zonePhotoBtn}
                      accessibilityLabel={`Add photo for ${COLLATERAL_ZONE_LABELS[zone]}`}
                      onPress={() =>
                        void pickEvidencePhoto((uri) => {
                          // Re-read: the picker is async and the record may have
                          // changed while the camera was open.
                          const current = useInspectionStore
                            .getState()
                            .getById(inspection.id)?.collateralEvidence?.[zone];
                          setCollateralZone(inspection.id, zone, {
                            photoIds: [...(current?.photoIds ?? []), uri],
                            // A photographed zone is a checked zone — a clean
                            // photo still proves the zone was worked.
                            checked: true,
                          });
                        })
                      }
                    >
                      <Ionicons name="camera-outline" size={20} color={colors.text} />
                      {item.photoIds.length > 0 && (
                        <Text style={styles.zonePhotoCount}>{item.photoIds.length}</Text>
                      )}
                    </PressableScale>
                  </View>
                );
              })}

              <Text style={[styles.cardLabel, { marginTop: spacing.md }]}>Brittleness test</Text>
              <Text style={styles.cardSub}>
                Lift shingle corners in an undamaged area and photograph the test — the photo is
                required evidence on an insurance report.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {(['PASS', 'FAIL', 'BORDERLINE'] as BrittlenessResult[]).map((r) => {
                  const active = inspection.brittlenessProtocol?.result === r;
                  return (
                    <PressableScale
                      key={r}
                      style={[styles.britChip, active && styles.britChipActive]}
                      onPress={() =>
                        setBrittlenessProtocol(inspection.id, {
                          result: r,
                          photoIds: inspection.brittlenessProtocol?.photoIds ?? [],
                          notes: inspection.brittlenessProtocol?.notes,
                        })
                      }
                    >
                      <Text style={[styles.britChipText, active && styles.britChipTextActive]}>
                        {r === 'PASS' ? 'Pass' : r === 'FAIL' ? 'Fail' : 'Borderline'}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
              <PressableScale
                style={styles.analyzeBtn}
                onPress={() => {
                  if (!inspection.brittlenessProtocol) {
                    Alert.alert(
                      'Pick a result first',
                      'Record the test result (Pass / Fail / Borderline), then attach the photo of the test process.',
                    );
                    return;
                  }
                  void pickEvidencePhoto((uri) => {
                    const current = useInspectionStore
                      .getState()
                      .getById(inspection.id)?.brittlenessProtocol;
                    if (!current) return;
                    setBrittlenessProtocol(inspection.id, {
                      ...current,
                      photoIds: [...current.photoIds, uri],
                    });
                  });
                }}
              >
                <Ionicons name="camera-outline" size={18} color={colors.text} />
                <Text style={styles.analyzeBtnText}>
                  Add test photo
                  {(inspection.brittlenessProtocol?.photoIds.length ?? 0) > 0
                    ? ` (${inspection.brittlenessProtocol?.photoIds.length})`
                    : ''}
                </Text>
              </PressableScale>
              {inspection.brittlenessProtocol &&
                inspection.brittlenessProtocol.photoIds.length === 0 && (
                  <Text style={styles.evidenceWarn}>
                    Photo of the test process is still required before this result can go to a
                    carrier.
                  </Text>
                )}
            </RichCard>
          </View>
        )}

        <SectionHeader title="Documentation" style={styles.sectionSpacing} />

        <RichCard icon="create-outline" iconTone="blue" title="Notes">
          <TextInput
            value={inspection.notes ?? ''}
            onChangeText={(t) => setNotes(inspection.id, t)}
            placeholder="Anything the AI shouldn't miss?"
            placeholderTextColor={colors.textSubtle}
            style={styles.notesInput}
            multiline
            textAlignVertical="top"
          />
        </RichCard>

        <VoiceNoteRecorder
          notes={inspection.audioNotes ?? []}
          onRecorded={(note) => addAudioNote(inspection.id, note)}
          onRemove={(noteId) => removeAudioNote(inspection.id, noteId)}
          onTranscribe={async (noteId) => {
            if (!isGeminiConfigured) {
              toast({
                tone: 'warn',
                title: 'AI not connected',
                body: "AI analysis isn't set up on this build — ask your admin.",
              });
              return;
            }
            const note = (inspection.audioNotes ?? []).find((n) => n.id === noteId);
            if (!note) return;
            try {
              const text = await transcribeAudio(note.uri);
              setAudioNoteLabel(inspection.id, noteId, text || 'Transcription unavailable');
              toast({ tone: 'success', title: 'Note transcribed' });
            } catch (e) {
              toast({
                tone: 'danger',
                title: 'Transcription failed',
                body: e instanceof Error ? e.message.slice(0, 80) : undefined,
              });
            }
          }}
        />

        <RichCard
          icon="finger-print-outline"
          iconTone="purple"
          title="Inspector Signature"
          subtitle="Sign below to seal the HAAG report."
        >
          <View style={{ alignItems: 'center', marginTop: spacing.md }}>
            <SignaturePad
              onChange={(svg, meta) => {
                // A knuckle-brush is not a seal: only a signature's worth of
                // ink is recorded (the pad reports, this screen decides).
                if (svg && meta.meaningful) setInspectorSignature(inspection.id, svg);
              }}
            />
          </View>
          {inspection.inspectorSignatureSvg && (
            <View style={styles.signedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.signedBadgeText}>Signed</Text>
            </View>
          )}
        </RichCard>

        {/* THE one orange moment on this screen: generate the report / claim
            packet. Everything else on the page is quiet by comparison. */}
        <PressableScale
          style={[styles.reportCtaShadow, (generating || missing.any) && styles.reportCtaDisabled]}
          disabled={generating || missing.any}
          onPress={onGenerateHaagReport}
          accessibilityRole="button"
          accessibilityLabel={isClaim ? 'Generate HAAG claim packet PDF' : 'Generate HAAG report PDF'}
          accessibilityState={{ disabled: generating || missing.any }}
        >
          <View style={styles.reportCtaClip}>
            <LinearGradient
              colors={gradients.accent}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <View style={styles.reportCtaContent}>
              <Ionicons name="document-text-outline" size={20} color={colors.textInverse} />
              <Text style={styles.reportCtaText}>
                {generating
                  ? 'Generating…'
                  : isClaim
                    ? 'Generate HAAG claim packet (PDF)'
                    : 'Generate HAAG report (PDF)'}
              </Text>
            </View>
          </View>
        </PressableScale>
        {missing.any && (
          <Text style={styles.gateHint}>
            {describeMissingDetails(missing)} before generating — a packet cannot go to a carrier
            with placeholder details.
          </Text>
        )}
        {isClaim && brittlenessGap && (
          <Text style={styles.gateHint}>
            Brittleness evidence is incomplete — the packet will disclose it.
          </Text>
        )}
        {inspection.reportFinalizedAt && (
          <Text style={styles.finalizedHint}>
            Report last finalized {formatRelative(inspection.reportFinalizedAt)}
          </Text>
        )}
        {engineFreshness.staleFrozen && (
          <Text style={styles.gateHint}>
            This job changed since that report was finalized. The determination above is
            current; the signed PDF is not — regenerate it before sending.
          </Text>
        )}

        <PressableScale
          style={[styles.quietCta, (generatingLong || missing.any) && { opacity: 0.5 }]}
          disabled={generatingLong || missing.any}
          accessibilityState={{ disabled: generatingLong || missing.any }}
          onPress={async () => {
            if (missing.any) {
              setDetailsSheet(true);
              return;
            }
            try {
              setGeneratingLong(true);
              // Freeze first, then render from the frozen record. The Long
              // Report resolves the stored engine result itself and builds its
              // own per-slope cost rows (`perSlopeFromEngine`) — passing a
              // live evaluation here would put the old re-derive-at-render
              // behaviour back.
              const finalized = await finalizeWithSnapshot();
              const { uri } = await generateLongReport({ inspection: finalized });
              logActivity({
                kind: 'pdf_generated',
                inspectionId: inspection.id,
                message: `Generated Long Report for ${inspection.reportId}`,
              });
              await Share.share({ url: uri, message: `RoofWise Long Report ${inspection.reportId}` });
            } catch (e) {
              Alert.alert('Report failed', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setGeneratingLong(false);
            }
          }}
        >
          <Ionicons name="reader-outline" size={20} color={colors.text} />
          <Text style={styles.quietCtaText}>
            {generatingLong ? 'Generating…' : 'Generate Long Report (PDF)'}
          </Text>
        </PressableScale>
      </ScrollView>
    {linkedLead && (
      <FollowUpSheet
        visible={followUpSheet}
        title="Set follow-up"
        subtitle={linkedLead.customerName}
        options={FOLLOW_UP_OPTIONS}
        clearLabel={linkedLead.followUpAt ? 'Clear follow-up' : undefined}
        onPick={onPickFollowUp}
        onClose={() => setFollowUpSheet(false)}
      />
    )}
    <SlopePickerSheet
      visible={importSlopePicker}
      title="Import to which slope?"
      reason="Photos are filed per slope — the per-slope hit count is what the HAAG threshold reads."
      photoCounts={Object.fromEntries(inspection.slopes.map((sl) => [sl.orientation, sl.photoPaths.length]))}
      onSelect={(sl) => {
        runJobLibraryImportFor(sl).catch(() => {});
      }}
      onCancel={() => setImportSlopePicker(false)}
    />
    <CustomerDetailsSheet
      visible={detailsSheet}
      onClose={() => setDetailsSheet(false)}
      title={missing.any ? 'Who is this job for?' : 'Edit customer & property'}
      subtitle={
        missing.any
          ? 'This job was saved from a quick capture. Name the customer and the property so the packet can go out.'
          : inspection.reportId
      }
      initial={{
        customerName: inspection.customerName,
        customerPhone: inspection.customerPhone,
        customerEmail: inspection.customerEmail,
        address: inspection.address,
        lat: inspection.lat,
        lng: inspection.lng,
        material: inspection.material,
        condition: inspection.condition,
      }}
      roof
      onSave={(d) => {
        updateDetails(inspection.id, {
          customerName: d.customerName,
          customerPhone: d.customerPhone,
          customerEmail: d.customerEmail,
          address: d.address,
          lat: d.lat,
          lng: d.lng,
          ...(d.material ? { material: d.material } : {}),
          ...(d.condition ? { condition: d.condition } : {}),
        });
        setDetailsSheet(false);
        toast({ tone: 'success', title: 'Details saved', body: d.customerName });
      }}
    />
    </SafeAreaView>
  );
}

/**
 * Camera-first evidence capture with library fallback — same single-select +
 * Compatible-representation rationale as new-job.tsx / quick-inspection.tsx.
 *
 * Claim-evidence photos (collateral zones, brittleness protocol) go through
 * `prepareCapturedPhoto` exactly like slope photos do: they land in the same
 * carrier packet and are persisted the same way, and the un-piped path stored
 * full-resolution HEIC/JPEG originals — the payloads the capture ladder exists
 * to keep from OOM-crashing Expo Go.
 */
async function pickEvidencePhoto(onPicked: (uri: string) => void) {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
      if (result.canceled || result.assets.length === 0) return;
      onPicked(await prepareCapturedPhoto(result.assets[0].uri));
      return;
    }
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert(
        'Camera access needed',
        'Enable Camera or Photos access in Settings to attach test photos.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || result.assets.length === 0) return;
    onPicked(await prepareCapturedPhoto(result.assets[0].uri));
  } catch (e) {
    Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
  }
}

const HERO_HEIGHT = 300;

/**
 * The job screen's one cinematic moment: the real primary inspection photo
 * (first captured photo across any slope), scrimmed for legibility, carrying
 * the address, the §6 claim-viability call, and the roofwise verdict.
 *
 * No photo yet → a crafted gradient ground with the roof glyph, never stock
 * imagery (Drift #5 extends to imagery: nothing here is synthesized).
 */
function JobHero({
  photoUri,
  reportId,
  address,
  band,
  recommendation,
}: {
  photoUri?: string;
  reportId: string;
  address: string;
  /** Absent until at least one photo has been analyzed — renders "Not assessed". */
  band?: ClaimViabilityBand;
  recommendation?: RoofwiseRecommendation;
}) {
  return (
    <View style={[styles.heroShell, shadows.hero]}>
      <View style={styles.heroCard}>
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <LinearGradient
            colors={gradients.clearDay}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.heroPlaceholder}>
              <Ionicons name="home-outline" size={72} color={colors.textInverse} style={styles.heroPlaceholderIcon} />
            </View>
          </LinearGradient>
        )}
        <LinearGradient
          colors={gradients.scrim}
          start={{ x: 0, y: 0.15 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={styles.heroContent}>
          <Text style={styles.heroEyebrow}>{reportId}</Text>
          <Text style={styles.heroAddress} numberOfLines={2}>
            {address}
          </Text>
          <View style={styles.heroBadgeRow}>
            {band && recommendation ? (
              <>
                <Pill
                  label={CLAIM_VIABILITY_LABELS[band]}
                  tone={BAND_PILL_TONE[band]}
                  solid
                  size="md"
                  icon="shield-checkmark"
                />
                <Text style={styles.heroVerdict} numberOfLines={1}>
                  {ROOFWISE_RECOMMENDATION_LABELS[recommendation]}
                </Text>
              </>
            ) : (
              <>
                <Pill label="Not assessed" tone="neutral" solid size="md" icon="help-circle-outline" />
                <Text style={styles.heroVerdict} numberOfLines={1}>
                  Analyze photos for a verdict
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function SlopeBlock({
  inspection,
  slope,
  verdict,
  reasoning,
  confidenceAvg,
  hitsPerSquare,
}: {
  inspection: Inspection;
  slope: Slope;
  verdict: SlopeVerdict;
  reasoning: string;
  confidenceAvg: number;
  /** The engine's `hail_hits_per_square` for this slope — a RATE, not a total. */
  hitsPerSquare?: number;
}) {
  const router = useRouter();
  const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
  const threshold = thresholdFor(inspection.material);
  const coverage = documentedCoverage(slope);
  const functionalInfo = deriveFunctional(slope);
  // Same "analyzed" read summarizeInspection uses: an explicit done state, or
  // the legacy analyzed-index list. A slope with none has no verdict to show.
  const legacyAnalyzed = new Set(slope.analyzedPhotoIndices ?? []);
  const analyzedHere = slope.photoPaths.filter((uri, i) => {
    const st = slope.photoAnalysis?.[uri];
    return st?.status === 'done' || (!st && legacyAnalyzed.has(i));
  }).length;

  return (
    <RichCard
      icon="home-outline"
      iconTone="blue"
      title={`Slope ${slope.orientation}`}
      headerTrailing={
        analyzedHere > 0 ? (
          <Pill label={SLOPE_VERDICT_LABEL[verdict]} tone={SLOPE_VERDICT_PILL_TONE[verdict]} size="sm" />
        ) : (
          <Pill label="Not assessed" tone="neutral" size="sm" />
        )
      }
    >
      <PressableScale
        style={styles.analyzeBtn}
        onPress={() =>
          router.push({
            pathname: '/analyze',
            params: { inspectionId: inspection.id, slopeId: slope.id },
          })
        }
      >
        <Ionicons name="analytics-outline" size={18} color={colors.text} />
        <Text style={styles.analyzeBtnText}>Analyze photos</Text>
      </PressableScale>

      {slope.photoPaths.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {slope.photoPaths.map((uri, i) => (
              <PressableScale
                key={i}
                // The per-photo REPORT first (what's in this photo); it links
                // on to the marker editor. Reading before editing.
                onPress={() =>
                  router.push({
                    pathname: '/photo-report',
                    params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(i) },
                  })
                }
              >
                <View style={styles.photoTile}>
                  {/* backgroundColor on the wrapper is the loading state: a
                      neutral tile shows until the real photo fades in. */}
                  <Image
                    source={{ uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={150}
                  />
                </View>
                <View style={styles.editBadge}>
                  <Ionicons name="create-outline" size={12} color={colors.textInverse} />
                </View>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
      )}

      {/* HAAG §2 is a RATE — hits per ONE 100 sq ft test square. Printing the
          slope TOTAL against a per-square threshold ("62 hits observed ·
          threshold 6+ per square") is the same unit error that made the engine
          over-call damage: the more photos an inspector took, the worse it
          read. Lead with the rate the engine used; keep the total as context. */}
      <View style={styles.testSquare}>
        <Text style={styles.testSquareLabel}>HAAG test square</Text>
        <Text style={styles.testSquareLine}>
          {hitsPerSquare != null
            ? `${fmtRate(hitsPerSquare)} hits per 10×10' square`
            : `${slope.hailCount} hits observed`}
          {' · threshold '}
          {threshold.hitsPerTestSquare === 0
            ? '(penetration / crack)'
            : `${threshold.hitsPerTestSquare}+ per 10×10' square`}
        </Text>
        {hitsPerSquare != null && (
          <Text style={styles.testSquareLine}>
            {slope.hailCount} hit{slope.hailCount === 1 ? '' : 's'} documented across{' '}
            {slope.photoPaths.length} photo{slope.photoPaths.length === 1 ? '' : 's'} on this slope.
          </Text>
        )}
        {/* Both carrier bars, every time (owner): the 8 most carriers use and
            the 10 some require — so the roofer knows how hard the conversation
            will be before filing. */}
        {hitsPerSquare != null && hitsPerSquare > 0 && threshold.hitsPerTestSquare > 0 && (
          <Text style={[styles.testSquareLine, carrierBarsRead(inspection.material, hitsPerSquare).meetsStandard ? styles.functionalYes : undefined]}>
            {carrierBarsRead(inspection.material, hitsPerSquare).line}
          </Text>
        )}
        {/* What the photos themselves document — a different number from the
            aerial figure and never confused with it. */}
        {coverage.photos > 0 && (
          <Text style={styles.testSquareLine}>{documentedSummary(coverage)}</Text>
        )}
        {/* §1: the functional determination and WHY, derived from evidence. */}
        <Text style={[styles.testSquareLine, functionalInfo.functional ? styles.functionalYes : undefined]}>
          {functionalInfo.functional ? 'Functional damage: yes — ' : 'Functional damage: not established — '}
          {functionalInfo.reason}
        </Text>
        <Text style={styles.testSquareRule}>{threshold.rule}</Text>
      </View>

      {detected.length > 0 && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          {detected.map((f) => (
            <Text key={f.label} style={styles.cardSub}>
              • {DAMAGE_CATEGORY_LABELS[f.label]} × {f.count} ({f.confidence}%)
            </Text>
          ))}
        </View>
      )}

      {analyzedHere > 0 ? (
        reasoning ? (
          <Text style={styles.reasoning}>
            {reasoning}
            {confidenceAvg > 0 ? ` (avg confidence ${Math.round(confidenceAvg)}%)` : ''}
          </Text>
        ) : null
      ) : (
        <Text style={styles.reasoning}>
          Not assessed — analyze photos on this slope to get a per-slope verdict.
        </Text>
      )}
    </RichCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Sub-screen inline bar: plain chevron, 17/semibold, hairline underline.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.barFill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportId: { fontSize: fontSize.caption, color: colors.textSubtle, fontWeight: fontWeight.semibold },
  customer: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    minHeight: touchTarget.small,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  statusToggleComplete: { backgroundColor: colors.success },
  statusToggleText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  sectionSpacing: { marginBottom: spacing.sm },

  // Prominent capture entry from a job — the owner must never lose "take
  // photos to analyse". Brand-blue so it's distinct from the one orange
  // report CTA further down. 64pt primary (Drift #1).
  captureCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    ...shadows.raised,
  },
  captureCtaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  importCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  importCtaText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  pendingStrip: { marginTop: spacing.xs },

  // Placeholder-details banner — warn-toned, ≥56pt, sits above the hero so
  // it is the first thing on the page (Drift #5: a placeholder is stated).
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warn,
  },
  missingTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  missingBody: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18, marginTop: 2 },
  roofLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  // ── Hero ──────────────────────────────────────────────────────────────
  heroShell: { borderRadius: radii.xl },
  heroCard: {
    height: HERO_HEIGHT,
    borderRadius: radii.xl,
    overflow: 'hidden',
    // Painted under the gradient/photo so the card is never briefly
    // transparent while the image loads.
    backgroundColor: brand.royalInk,
  },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroPlaceholderIcon: { opacity: 0.4 },
  heroContent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  heroEyebrow: {
    color: colors.textInverse,
    opacity: 0.72,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroAddress: {
    color: colors.textInverse,
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  heroVerdict: {
    color: colors.textInverse,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    opacity: 0.92,
    flexShrink: 1,
  },

  // Uniform child spacing inside a multi-row RichCard body — mirrors the old
  // flat `card` style's `gap: spacing.xs`, which used to space every direct
  // child (label, rows, footnotes) the same way.
  bodyRows: { gap: spacing.xs },

  cardLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.textMuted },

  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  safetyText: { fontSize: fontSize.bodySm, color: colors.textMuted },

  // Honest, compact empty module — real state, thin icon, no tinted circle.
  placeholderBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  placeholderText: { color: colors.textMuted, fontSize: fontSize.bodyMd, textAlign: 'center' },

  // THE one orange moment on this screen: generate the report/claim packet.
  // Shadow lives on the outer (unclipped) layer so the brand-tinted lift
  // isn't clipped by the gradient's rounded corners.
  reportCtaShadow: { borderRadius: radii.button, ...shadows.raised, marginTop: spacing.sm },
  reportCtaDisabled: { opacity: 0.5 },
  reportCtaClip: { height: touchTarget.preferred, borderRadius: radii.button, overflow: 'hidden' },
  reportCtaContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  reportCtaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  quietCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.sm,
  },
  quietCtaText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  signedBadgeText: { color: colors.success, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  britChip: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.fillQuiet,
  },
  britChipActive: { backgroundColor: colors.brand },
  britChipText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  britChipTextActive: { color: colors.textInverse },
  evidenceWarn: {
    fontSize: fontSize.bodySm,
    color: colors.danger,
    marginTop: spacing.sm,
  },

  collateralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    // Drift #1: gloved-roofer persona — interactive rows meet the 56pt minimum.
    minHeight: touchTarget.standard,
  },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  zonePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.fillQuiet,
  },
  zonePhotoCount: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  gateHint: {
    fontSize: fontSize.bodySm,
    color: colors.warn,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  finalizedHint: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  collateralLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text },
  collateralChecked: { textDecorationLine: 'line-through', color: colors.textMuted },

  notesInput: {
    minHeight: 96,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    padding: spacing.md,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    marginTop: spacing.sm,
  },

  // The wrapper carries the loading-state ground colour + clip; expo-image
  // fades the real photo in over it via `transition`.
  photoTile: {
    width: 140,
    height: 100,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    backgroundColor: colors.fillQuiet,
  },
  editBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.scrim,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  testSquare: {
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    padding: spacing.md,
    gap: 2,
    marginTop: spacing.md,
  },
  testSquareLabel: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  testSquareLine: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.medium },
  functionalYes: { color: colors.danger, fontWeight: fontWeight.semibold },
  testSquareRule: { fontSize: fontSize.bodySm, color: colors.textMuted },

  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.md,
  },
  analyzeBtnText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  reasoning: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.text },
  secondaryBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
