import { PressableScale } from '@/components/PressableScale';
import { formatDateShort, formatRelative, isValidDate } from '@/lib/format/date';
import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useTaskStore } from '@/lib/stores/taskStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { FOLLOW_UP_OPTIONS, FollowUpSheet } from '@/components/pipeline/FollowUpSheet';
import { findLinkedLead, daysInStage } from '@/components/pipeline/chain';
import { JOB_STATUS_META } from '@/components/pipeline/JobPipelineCard';
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
import { summarizeInspection } from '@/components/DamageDetailSection';
import { describeMissingDetails, missingJobDetails } from '@/lib/services/placeholderDetails';
import { CustomerDetailsSheet } from '@/components/sheets/CustomerDetailsSheet';
import { CoverPhotoSheet } from '@/components/sheets/CoverPhotoSheet';
import { usePropertyRecordStore } from '@/lib/stores/propertyRecordStore';
import { coverPhotoUri, roofAgePrefill } from '@/lib/services/propertyRecord';
import { SlopePickerSheet } from '@/components/capture/SlopePickerSheet';
import { transcribeAudio } from '@/lib/services/transcribeAudio';
import { useToastStore } from '@/lib/stores/toastStore';
import { isGeminiConfigured } from '@/lib/env';
import {
  CLAIM_VIABILITY_LABELS,
  ROOFWISE_RECOMMENDATION_LABELS,
  type ClaimViabilityBand,
  type RoofwiseRecommendation,
} from '@/lib/services/decisionEngine';
import {
  resolveEngineResult,
  snapshotEngineResult,
  storedEngineFreshness,
} from '@/lib/services/storedEngine';
import { getSafetyForecast } from '@/lib/services/weather';
import { jobAmount, useEstimateForJob, useProposalsForJob } from '@/lib/services/proposals';
import {
  CAUSE_OF_LOSS_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  POLICY_TYPE_LABELS,
  ROOF_MATERIAL_LABELS,
  leadStageColumn,
  type CollateralZone,
  type Inspection,
  type InspectionStatus,
  type LeadStage,
  type SlopeOrientation,
} from '@/lib/models/types';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { ChipTone } from '@/components/ui/IconChip';
import { MeshBackground } from '@/components/ui/MeshBackground';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import { JOB_TAB_DEFS, JobTabs, type JobTabKey } from '@/components/job/JobTabs';
import { StageSheet, type StageRow } from '@/components/job/StageSheet';
import { OverviewTab, type NextAction } from '@/components/job/OverviewTab';
import { MeasureTab } from '@/components/job/MeasureTab';
import { PhotosTab } from '@/components/job/PhotosTab';
import { ProposalTab } from '@/components/job/ProposalTab';
import { TasksTab } from '@/components/job/TasksTab';

/** Every tab renders — components/pipeline/TasksCard.tsx landed during this
 *  integration, so Tasks is no longer conditionally omitted (see
 *  components/job/TasksTab.tsx's header comment). */
const VISIBLE_TABS = JOB_TAB_DEFS;

function isJobTabKey(v: unknown): v is JobTabKey {
  return typeof v === 'string' && VISIBLE_TABS.some((t) => t.key === v);
}

/** Days the job has sat with no linked lead — same read as chain.ts's
 *  `daysInStage`, over the job's own status timestamp instead of a lead's. */
function jobDaysInStage(ins: Pick<Inspection, 'statusChangedAt' | 'createdAt'>, now: number = Date.now()): number | null {
  const raw = ins.statusChangedAt ?? ins.createdAt;
  if (!isValidDate(raw)) return null;
  const ms = now - new Date(raw).getTime();
  return ms < 0 ? null : Math.floor(ms / 86400000);
}

const LEAD_STAGE_LATE = new Set<LeadStage>(['signed', 'install_scheduled', 'in_progress', 'completed', 'invoiced', 'paid']);

/** The hero pill's tone, by how far along the ladder a lead has moved. */
function leadStagePillTone(stage: LeadStage): PillTone {
  if (stage === 'lost') return 'danger';
  if (LEAD_STAGE_LATE.has(stage)) return 'success';
  if (stage === 'estimate_sent' || stage === 'proposal_sent') return 'warn';
  return 'info';
}

/** Same read, for the StageSheet rows' IconChip (a different, 5-value tone family). */
function leadStageChipTone(stage: LeadStage): ChipTone {
  if (stage === 'lost') return 'quiet';
  if (LEAD_STAGE_LATE.has(stage)) return 'green';
  if (stage === 'estimate_sent' || stage === 'proposal_sent') return 'orange';
  return 'blue';
}

/** "Architectural Asphalt · 2-story" — material always known; stories only
 *  when the Zillow record has one. "Access" is not modeled anywhere in
 *  RoofWise yet, so it is never invented here (Drift #5). */
function propertyOneLiner(ins: Inspection): string {
  const stories = ins.propertyRecord?.status === 'found' ? ins.propertyRecord.stories : undefined;
  return [ROOF_MATERIAL_LABELS[ins.material], stories ? `${stories}-story` : undefined]
    .filter((s): s is string => Boolean(s))
    .join(' · ');
}

export default function JobDetail() {
  const router = useRouter();
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
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
  const setPropertyRecord = useInspectionStore((s) => s.setPropertyRecord);
  const setCoverPhoto = useInspectionStore((s) => s.setCoverPhoto);
  const lookupRecord = usePropertyRecordStore((s) => s.lookup);
  const [coverSheet, setCoverSheet] = useState(false);
  const addAudioNote = useInspectionStore((s) => s.addAudioNote);
  const removeAudioNote = useInspectionStore((s) => s.removeAudioNote);
  const setAudioNoteLabel = useInspectionStore((s) => s.setAudioNoteLabel);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const multiSelectImport = useCaptureSettingsStore((s) => s.multiSelectImport);
  // The lead behind this job — the other half of the Lead → Job chain.
  const leads = useLeadStore((s) => s.leads);
  const setLeadStage = useLeadStore((s) => s.setStage);
  const setLeadFollowUp = useLeadStore((s) => s.setFollowUp);
  const [followUpSheet, setFollowUpSheet] = useState(false);
  const [stageSheet, setStageSheet] = useState(false);
  const [detailsSheet, setDetailsSheet] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingLong, setGeneratingLong] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<LibraryImportProgress | null>(null);
  const [importSlopePicker, setImportSlopePicker] = useState(false);

  // Deep-link `?tab=` on first mount only — a per-mount instance then keeps
  // whatever tab the roofer is on across a back-navigation return, per the
  // wave brief's "component state only, not persisted".
  const [tab, setTab] = useState<JobTabKey>(() => (isJobTabKey(tabParam) ? tabParam : 'overview'));

  // findLinkedLead needs a real Inspection; guarded here (not below) because
  // every hook that reads it must itself be called before the `!inspection`
  // return — same reason `proposalsForJob` / `estimateForThisJob` /
  // `taskCounts` sit up here rather than by the rest of their kin below.
  const linkedLead = inspection ? findLinkedLead(inspection, leads) : undefined;
  const proposalsForJob = useProposalsForJob(inspection?.id);
  const estimateForThisJob = useEstimateForJob(inspection);
  const taskCounts = useTaskStore((s) => s.counts([linkedLead?.id, inspection?.id]));

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

  // The same read path the reports use — see the long comment this used to
  // carry in the single-scroll job page; unchanged.
  const { haag, decision } = resolveEngineResult(inspection, Date.now(), { honorFreeze: false });
  const engineFreshness = storedEngineFreshness(inspection);
  const isClaim = inspection.kind === 'insurance_claim';

  const analyzedPhotos = summarizeInspection(inspection).analyzedPhotos;
  const hasEvidence = analyzedPhotos > 0;
  const missing = missingJobDetails(inspection);

  const totalPhotos = inspection.slopes.reduce((a, sl) => a + sl.photoPaths.length, 0);
  const pendingHere = pendingPhotoCount(deriveAnalysisProgress([inspection]));

  // ── Money chain for the hero + At-a-Glance (hooks live above the
  // `!inspection` return; this just combines their already-read values) ────
  const amount = jobAmount({ proposals: proposalsForJob, estimate: estimateForThisJob, lead: linkedLead });
  const openTaskCount = taskCounts.total - taskCounts.done;

  const onPickFollowUp = (when: Date | null) => {
    setFollowUpSheet(false);
    if (!linkedLead) return;
    if (!when) {
      setLeadFollowUp(linkedLead.id, undefined);
      toast({ tone: 'info', title: 'Follow-up cleared' });
      return;
    }
    setLeadFollowUp(linkedLead.id, when.toISOString());
    scheduleFollowUpReminder({ leadId: linkedLead.id, customerName: linkedLead.customerName, date: when }).catch(() => {});
    toast({ tone: 'success', title: 'Follow-up set', body: formatDateShort(when) });
  };

  const heroPhoto = coverPhotoUri(inspection);

  const openCapture = () => router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } });

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
          attachRawPhotos(inspection.id, [{ uri, slope: targetSlope, areaTag, captureMode: DEFAULT_CAPTURE_MODE }]);
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
        const slope = useInspectionStore.getState().getById(inspection.id)?.slopes.find((s) => s.orientation === targetSlope);
        logActivity({
          kind: 'photo_captured',
          inspectionId: inspection.id,
          message: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'} from library`,
        });
        if (slope && isGeminiConfigured) {
          queueSlopeAnalysis({ inspectionId: inspection.id, slopeId: slope.id, slopeLabel: slope.orientation });
          toast({
            tone: 'success',
            title: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'}`,
            body: 'Analyzing in the background — tap the status card to watch.',
          });
        } else {
          toast({
            tone: isGeminiConfigured ? 'success' : 'warn',
            title: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'}`,
            body: isGeminiConfigured ? undefined : 'AI not connected — photos saved without analysis.',
          });
        }
      }

      if (result.failures.length > 0) {
        const n = result.failures.length;
        const first = result.failures[0].reason;
        Alert.alert(
          result.imported > 0 ? `Imported ${result.imported}, skipped ${n}` : "Couldn't read that photo",
          isUnreadableAssetError(first) ? `${first} Try different photos, or run on a real iPhone.` : first,
        );
      } else if (result.reachedLimit && result.imported > 0) {
        Alert.alert('Import paused', `Added ${result.imported} photos. Tap Import again to keep going.`);
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const insurancePolicyLine =
    inspection.policyNumber || inspection.claimNumber
      ? [inspection.policyNumber && `Policy ${inspection.policyNumber}`, inspection.claimNumber && `Claim ${inspection.claimNumber}`]
          .filter(Boolean)
          .join('  ·  ')
      : null;
  const claimDetailLine = isClaim
    ? [
        inspection.causeOfLoss && CAUSE_OF_LOSS_LABELS[inspection.causeOfLoss],
        inspection.policyType && POLICY_TYPE_LABELS[inspection.policyType],
        inspection.deductible != null && `$${inspection.deductible.toLocaleString()} deductible`,
        inspection.dateOfLoss && `DOL ${formatDateShort(inspection.dateOfLoss)}`,
      ]
        .filter(Boolean)
        .join('  ·  ') || 'Claim details not recorded yet'
    : null;

  const onDelete = () => {
    Alert.alert('Delete job?', `${inspection.reportId} will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove(inspection.id);
          router.dismissTo('/(tabs)');
        },
      },
    ]);
  };

  // ---------- Finalize gate (insurance claims) ----------
  const proto = inspection.brittlenessProtocol;
  const brittlenessGap: string | null = !isClaim
    ? null
    : !proto?.result
      ? 'Brittleness test not recorded. The HAAG repairability gate (§3) cannot be evaluated without it.'
      : proto.photoIds.length === 0
        ? `Brittleness test recorded as ${proto.result}, but no photo evidence is attached. The field protocol requires a photo of the test process.`
        : null;

  const finalizeWithSnapshot = async (): Promise<Inspection> => {
    const at = new Date().toISOString();
    try {
      const coord = inspection.lat != null && inspection.lng != null ? { lat: inspection.lat, lng: inspection.lng } : undefined;
      const forecast = (await getSafetyForecast(coord)) ?? undefined;
      const { payload } = snapshotEngineResult(inspection, at, forecast);
      setStoredEngineResult(inspection.id, payload, at, { force: true });
    } catch {
      // A missed snapshot is recoverable — the report falls back to evaluating the same engine at render time.
    }
    setReportFinalizedAt(inspection.id, at);
    return useInspectionStore.getState().inspections.find((i) => i.id === inspection.id) ?? inspection;
  };

  // Both raw generators self-gate on `missing.any` (the belt-and-braces the
  // disabled CTA already carries) and otherwise generate unconditionally —
  // the brittleness-gap Alert (with its "Record now" → scroll-to-evidence)
  // now lives in OverviewTab, the one place that owns the scroll ref the
  // jump needs. See OverviewTab's `onGenerateHaagPress` / `onGenerateLongPress`.
  const runHaagReport = async () => {
    if (missing.any) {
      setDetailsSheet(true);
      return;
    }
    try {
      setGenerating(true);
      const finalized = await finalizeWithSnapshot();
      const { uri } = await generateHaagReport(finalized);
      logActivity({ kind: 'pdf_generated', inspectionId: inspection.id, message: `Generated HAAG report for ${inspection.reportId}` });
      await Share.share({ url: uri, message: `RoofWise HAAG report ${inspection.reportId}` });
    } catch (e) {
      Alert.alert('Report failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  };

  const runLongReport = async () => {
    if (missing.any) {
      setDetailsSheet(true);
      return;
    }
    try {
      setGeneratingLong(true);
      const finalized = await finalizeWithSnapshot();
      const { uri } = await generateLongReport({ inspection: finalized });
      logActivity({ kind: 'pdf_generated', inspectionId: inspection.id, message: `Generated Long Report for ${inspection.reportId}` });
      await Share.share({ url: uri, message: `RoofWise Long Report ${inspection.reportId}` });
    } catch (e) {
      Alert.alert('Report failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setGeneratingLong(false);
    }
  };

  // ---------- Claim-evidence photo pickers (shared by zones + brittleness) ----------
  const onPickZonePhoto = (zone: CollateralZone) => {
    void pickEvidencePhoto((uri) => {
      const current = useInspectionStore.getState().getById(inspection.id)?.collateralEvidence?.[zone];
      setCollateralZone(inspection.id, zone, { photoIds: [...(current?.photoIds ?? []), uri], checked: true });
    });
  };
  const onPickBrittlenessPhoto = () => {
    if (!inspection.brittlenessProtocol) {
      Alert.alert('Pick a result first', 'Record the test result (Pass / Fail / Borderline), then attach the photo of the test process.');
      return;
    }
    void pickEvidencePhoto((uri) => {
      const current = useInspectionStore.getState().getById(inspection.id)?.brittlenessProtocol;
      if (!current) return;
      setBrittlenessProtocol(inspection.id, { ...current, photoIds: [...current.photoIds, uri] });
    });
  };

  // ---------- Stage sheet (the hero pill) ----------
  const stageRows: StageRow[] = linkedLead
    ? [
        ...LEAD_STAGE_ORDER.map(
          (s): StageRow => ({ key: s, label: LEAD_STAGE_LABELS[s], icon: 'flag-outline', tone: leadStageChipTone(s) }),
        ),
        { key: 'lost', label: LEAD_STAGE_LABELS.lost, icon: 'close-circle-outline', tone: 'quiet' },
      ]
    : (['lead', 'scheduled', 'in_progress', 'complete'] as InspectionStatus[]).map(
        (s): StageRow => ({ key: s, label: JOB_STATUS_META[s].label, icon: JOB_STATUS_META[s].icon, tone: JOB_STATUS_META[s].chipTone }),
      );
  const currentStageKey = linkedLead ? leadStageColumn(linkedLead.stage) : inspection.status;
  const stagePillLabel = linkedLead ? LEAD_STAGE_LABELS[leadStageColumn(linkedLead.stage)] : JOB_STATUS_META[inspection.status].label;
  const stagePillTone: PillTone = linkedLead ? leadStagePillTone(leadStageColumn(linkedLead.stage)) : JOB_STATUS_META[inspection.status].pillTone;

  const onPickStage = (key: string) => {
    if (linkedLead) {
      const stage = key as LeadStage;
      setLeadStage(linkedLead.id, stage);
      logActivity({
        kind: 'stage_changed',
        inspectionId: inspection.id,
        leadId: linkedLead.id,
        message: `Moved ${linkedLead.customerName} to ${LEAD_STAGE_LABELS[stage]}`,
      });
      // Keep the job's own completion state honest too — a pipeline stage at
      // or past "Inspection Complete" means the inspection itself is done,
      // the same fact "Mark complete" used to record by hand.
      if (stage !== 'lost') {
        const idx = LEAD_STAGE_ORDER.indexOf(leadStageColumn(stage));
        const inspectedIdx = LEAD_STAGE_ORDER.indexOf('inspected');
        setStatus(inspection.id, idx >= inspectedIdx ? 'complete' : 'in_progress');
      }
    } else {
      const status = key as InspectionStatus;
      setStatus(inspection.id, status);
      logActivity({
        kind: status === 'complete' ? 'inspection_completed' : 'job_created',
        inspectionId: inspection.id,
        message: status === 'complete' ? `Marked ${inspection.reportId} complete` : `Set ${inspection.reportId} to ${JOB_STATUS_META[status].label}`,
      });
    }
  };

  // ---------- Hero meta strip ----------
  const heroUpdatedAt = linkedLead ? (linkedLead.updatedAt ?? linkedLead.stageChangedAt ?? linkedLead.createdAt) : (inspection.statusChangedAt ?? inspection.createdAt);
  const updatedLabel = isValidDate(heroUpdatedAt) ? `Updated ${formatRelative(heroUpdatedAt)}` : undefined;
  const stageDays = linkedLead ? daysInStage(linkedLead) : jobDaysInStage(inspection);
  const daysLabel = stageDays != null ? `${stageDays}d in stage` : undefined;

  // ---------- Next action (Overview) ----------
  const nextAction: NextAction | null = missing.any
    ? { icon: 'person-add-outline', tone: 'orange', title: 'Add customer & address', sub: 'Reports and the proposal are off until these are real', onPress: () => setDetailsSheet(true) }
    : totalPhotos === 0
      ? { icon: 'camera', tone: 'blue', title: 'Capture photos', sub: 'Take photos to analyze this roof', onPress: () => setTab('photos') }
      : pendingHere > 0
        ? { icon: 'hourglass-outline', tone: 'blue', title: 'Analysis in progress', sub: `${pendingHere} photo${pendingHere === 1 ? '' : 's'} analyzing`, onPress: () => setTab('photos') }
        : !hasEvidence
          ? { icon: 'analytics-outline', tone: 'blue', title: 'Analyze captured photos', sub: 'Get a verdict for this roof', onPress: () => setTab('photos') }
          : proposalsForJob.length === 0
            ? { icon: 'document-attach-outline', tone: 'orange', title: 'Build a proposal', sub: 'Turn the assessment into a price', onPress: () => setTab('proposal') }
            : proposalsForJob[0].status === 'draft'
              ? { icon: 'send-outline', tone: 'orange', title: 'Send the proposal', sub: `$${proposalsForJob[0].total.toLocaleString()} — ready to go out`, onPress: () => setTab('proposal') }
              : proposalsForJob[0].status === 'sent' || proposalsForJob[0].status === 'viewed'
                ? { icon: 'alarm-outline', tone: 'blue', title: 'Follow up on the proposal', sub: `Sent — ${LEAD_STAGE_LABELS[currentStageKeyForFollowUp(linkedLead)]}`, onPress: linkedLead ? () => setFollowUpSheet(true) : () => setTab('proposal') }
                : null;

  const onOpenTab = (t: JobTabKey) => setTab(t);

  const onEstimateThisRoof = () => {
    useWizardPrefillStore.getState().set({
      source: 'estimate',
      address: inspection.address,
      addressLat: inspection.lat,
      addressLng: inspection.lng,
      material: inspection.material,
    });
    router.push('/estimator');
  };

  const onOpenPitchGauge = () => router.push({ pathname: '/pitch-gauge', params: { inspectionId: inspection.id } });

  const onBuildProposal = () => router.push(`/proposal/${inspection.id}` as any);
  const onEditProposal = (proposalId: string) => router.push(`/proposal/${inspection.id}?proposalId=${encodeURIComponent(proposalId)}` as any);

  // Genuinely async (not a fire-and-forget wrapper): VoiceNoteRecorder awaits
  // this to drive its own per-note spinner, so a sync wrapper that returned
  // immediately would clear that spinner before the transcription actually
  // finished.
  const onTranscribeAudioNote = async (noteId: string) => {
    if (!isGeminiConfigured) {
      toast({ tone: 'warn', title: 'AI not connected', body: "AI analysis isn't set up on this build — ask your admin." });
      return;
    }
    const note = (inspection.audioNotes ?? []).find((n) => n.id === noteId);
    if (!note) return;
    try {
      const text = await transcribeAudio(note.uri);
      setAudioNoteLabel(inspection.id, noteId, text || 'Transcription unavailable');
      toast({ tone: 'success', title: 'Note transcribed' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Transcription failed', body: e instanceof Error ? e.message.slice(0, 80) : undefined });
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Mesh header — back / report-id / download / share, per the mock's
          "04 · Damage report" template (docs/DESIGN_1A.md §6). "Download"
          is the SAME `runHaagReport` the Overview tab's own PDF button
          calls (generate + open the share sheet in one action) — a quick
          access point, not a second code path. */}
      <View style={styles.header}>
        <MeshBackground variant="cool" />
        <PressableScale onPress={() => router.back()} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.onMesh} />
        </PressableScale>
        <Text style={styles.headerReportId} numberOfLines={1}>
          {inspection.reportId}
        </Text>
        <View style={{ flex: 1 }} />
        {pendingHere > 0 && (
          <PressableScale
            onPress={() => router.push('/processing')}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={`${pendingHere} photo${pendingHere === 1 ? '' : 's'} analyzing. Open processing.`}
          >
            <ActivityIndicator size="small" color={colors.onMesh} />
          </PressableScale>
        )}
        <PressableScale
          onPress={() => void runHaagReport()}
          disabled={generating}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={isClaim ? 'Download HAAG claim packet PDF' : 'Download HAAG report PDF'}
        >
          {generating ? (
            <ActivityIndicator size="small" color={colors.onMesh} />
          ) : (
            <Ionicons name="download-outline" size={22} color={colors.onMesh} />
          )}
        </PressableScale>
        <PressableScale onPress={onDelete} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Delete job">
          <Ionicons name="trash-outline" size={22} color={colors.onMesh} />
        </PressableScale>
      </View>

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
              This job still has placeholder details. Reports and the proposal are off until the customer and
              address are real.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.warn} />
        </PressableScale>
      )}

      <CompactHero
        photoUri={heroPhoto}
        onChangePhoto={() => setCoverSheet(true)}
        reportId={inspection.reportId}
        customerName={missing.name ? 'Customer not set' : inspection.customerName}
        address={missing.address ? 'Address not set' : inspection.address}
        oneLiner={propertyOneLiner(inspection)}
        band={hasEvidence ? haag.claim_viability : undefined}
        recommendation={hasEvidence ? haag.roofwise_recommendation : undefined}
        stageLabel={stagePillLabel}
        stageTone={stagePillTone}
        onOpenStage={() => setStageSheet(true)}
        updatedLabel={updatedLabel}
        daysLabel={daysLabel}
        amount={amount}
      />

      <JobTabs
        tabs={VISIBLE_TABS.map((t) =>
          t.key === 'photos'
            ? { ...t, badge: totalPhotos }
            : t.key === 'proposal'
              ? { ...t, badge: proposalsForJob.length }
              : t.key === 'tasks'
                ? { ...t, badge: openTaskCount }
                : t,
        )}
        active={tab}
        onChange={onOpenTab}
        style={styles.tabsBar}
      />

      <View style={styles.tabBody}>
        {tab === 'overview' && (
          <OverviewTab
            inspection={inspection}
            haag={haag}
            decision={decision}
            hasEvidence={hasEvidence}
            missing={missing}
            linkedLead={linkedLead}
            glance={{ measurements: inspection.slopes.length, photos: totalPhotos, proposals: proposalsForJob.length, latestTotal: amount }}
            nextAction={nextAction}
            insurancePolicyLine={insurancePolicyLine}
            claimDetailLine={claimDetailLine}
            brittlenessGap={brittlenessGap}
            generating={generating}
            generatingLong={generatingLong}
            engineFreshnessStale={engineFreshness.staleFrozen}
            onOpenTab={onOpenTab}
            onEditDetails={() => setDetailsSheet(true)}
            onBook={linkedLead ? () => setFollowUpSheet(true) : undefined}
            onContacted={linkedLead && linkedLead.stage === 'new' ? () => setLeadStage(linkedLead.id, 'contacted') : undefined}
            onSetNotes={(t) => setNotes(inspection.id, t)}
            onSetCollateralItem={(key, value) => setCollateralItem(inspection.id, key, value)}
            onSetCollateralZone={(zone, patch) => setCollateralZone(inspection.id, zone, patch)}
            onSetBrittlenessProtocol={(protocol) => setBrittlenessProtocol(inspection.id, protocol)}
            onPickZonePhoto={onPickZonePhoto}
            onPickBrittlenessPhoto={onPickBrittlenessPhoto}
            onAddAudioNote={(note) => addAudioNote(inspection.id, note)}
            onRemoveAudioNote={(noteId) => removeAudioNote(inspection.id, noteId)}
            onTranscribeAudioNote={onTranscribeAudioNote}
            onSignInspector={(svg) => setInspectorSignature(inspection.id, svg)}
            onGenerateHaagReport={() => void runHaagReport()}
            onGenerateLongReport={() => void runLongReport()}
          />
        )}
        {tab === 'measure' && (
          <MeasureTab
            inspection={inspection}
            onMeasured={(intel) => setPropertyIntel(inspection.id, intel)}
            onEstimateThisRoof={onEstimateThisRoof}
            onOpenPitchGauge={onOpenPitchGauge}
          />
        )}
        {tab === 'photos' && (
          <PhotosTab
            inspection={inspection}
            decision={decision}
            haag={haag}
            pendingHere={pendingHere}
            importing={importing}
            importProgress={importProgress}
            onOpenCapture={openCapture}
            onImportFromLibrary={runJobLibraryImport}
          />
        )}
        {tab === 'proposal' && (
          <ProposalTab inspection={inspection} linkedLead={linkedLead} onBuildProposal={onBuildProposal} onEditProposal={onEditProposal} />
        )}
        {tab === 'tasks' && <TasksTab inspection={inspection} linkedLead={linkedLead} />}
      </View>

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
      <StageSheet
        visible={stageSheet}
        onClose={() => setStageSheet(false)}
        title="Move to…"
        subtitle={linkedLead ? linkedLead.customerName : inspection.reportId}
        rows={stageRows}
        current={currentStageKey}
        onPick={onPickStage}
      />
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
          ageYears: inspection.ageYears,
        }}
        roof
        ageHint={roofAgePrefill(inspection.propertyRecord, new Date().getFullYear())}
        onSave={(d) => {
          const addressChanged = d.address.trim() !== inspection.address.trim();
          updateDetails(inspection.id, {
            customerName: d.customerName,
            customerPhone: d.customerPhone,
            customerEmail: d.customerEmail,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
            ...(d.material ? { material: d.material } : {}),
            ...(d.condition ? { condition: d.condition } : {}),
            ...(d.ageYears != null && d.ageYears !== inspection.ageYears ? { ageYears: d.ageYears, ageSource: d.ageSource ?? ('inspector' as const) } : {}),
          });
          setDetailsSheet(false);
          toast({ tone: 'success', title: 'Details saved', body: d.customerName });
          if (addressChanged && d.address.trim().length >= 8) {
            void lookupRecord(d.address).then((rec) => setPropertyRecord(inspection.id, rec));
          }
        }}
      />
      <CoverPhotoSheet
        visible={coverSheet}
        inspection={inspection}
        onClose={() => setCoverSheet(false)}
        onChoose={(cover) => {
          setCoverPhoto(inspection.id, cover);
          toast({ tone: 'success', title: cover ? 'Job photo updated' : 'Back to the automatic photo' });
        }}
      />
    </SafeAreaView>
  );
}

/** The follow-up sheet's subtitle line reads the lead's own column label —
 *  falls back to 'estimate_sent' when there is no lead (never reachable in
 *  practice, since the nextAction branch that uses this only fires with a
 *  proposal, and a job with no lead still gets the label for its own sake). */
function currentStageKeyForFollowUp(lead: { stage: LeadStage } | undefined): LeadStage {
  return lead ? leadStageColumn(lead.stage) : 'estimate_sent';
}

/**
 * Camera-first evidence capture with library fallback — same rationale as
 * new-job.tsx / quick-inspection.tsx. Claim-evidence photos (collateral
 * zones, brittleness protocol) go through `prepareCapturedPhoto` exactly
 * like slope photos do.
 */
async function pickEvidencePhoto(onPicked: (uri: string) => void) {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (result.canceled || result.assets.length === 0) return;
      onPicked(await prepareCapturedPhoto(result.assets[0].uri));
      return;
    }
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert('Camera access needed', 'Enable Camera or Photos access in Settings to attach test photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || result.assets.length === 0) return;
    onPicked(await prepareCapturedPhoto(result.assets[0].uri));
  } catch (e) {
    Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
  }
}

const HERO_PHOTO_SIZE = 76;

/**
 * The job page's compact hero: cover photo, customer + address, a one-line
 * property summary, the stage pill (tap → StageSheet), when it was last
 * updated, how long it has sat in that stage, and the job's amount by the
 * signed → sent → estimate → lead precedence (`lib/services/proposals.ts`
 * `jobAmount`). Replaces the old JobHero's big cinematic photo — the full
 * claim-viability verdict now lives in the Overview tab's HAAG Verdict card;
 * this keeps only a small band pill so the hero stays scannable.
 */
function CompactHero({
  photoUri,
  onChangePhoto,
  reportId,
  customerName,
  address,
  oneLiner,
  band,
  recommendation,
  stageLabel,
  stageTone,
  onOpenStage,
  updatedLabel,
  daysLabel,
  amount,
}: {
  photoUri?: string;
  onChangePhoto: () => void;
  reportId: string;
  customerName: string;
  address: string;
  oneLiner: string;
  band?: ClaimViabilityBand;
  recommendation?: RoofwiseRecommendation;
  stageLabel: string;
  stageTone: PillTone;
  onOpenStage: () => void;
  updatedLabel?: string;
  daysLabel?: string;
  amount: { value: number } | null;
}) {
  return (
    <View style={[styles.heroCard, shadows.card]}>
      <View style={styles.heroTopRow}>
        <PressableScale style={styles.heroPhotoWrap} onPress={onChangePhoto} accessibilityRole="button" accessibilityLabel="Change the job photo">
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : (
            <LinearGradient colors={gradients.clearDay} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <View style={styles.heroPhotoPlaceholder}>
                <Ionicons name="home-outline" size={28} color={colors.textInverse} style={{ opacity: 0.5 }} />
              </View>
            </LinearGradient>
          )}
          <View style={styles.heroPhotoBadge}>
            <Ionicons name="camera-outline" size={12} color={colors.textInverse} />
          </View>
        </PressableScale>

        <View style={styles.heroInfo}>
          <Text style={styles.heroEyebrow} numberOfLines={1}>
            {reportId}
          </Text>
          <Text style={styles.heroCustomer} numberOfLines={1}>
            {customerName}
          </Text>
          <Text style={styles.heroAddress} numberOfLines={1}>
            {address}
          </Text>
          {(oneLiner || (band && recommendation)) && (
            <Text style={styles.heroOneLiner} numberOfLines={1}>
              {[oneLiner, band && recommendation ? ROOFWISE_RECOMMENDATION_LABELS[recommendation] : undefined]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </View>

        {band ? <Pill label={CLAIM_VIABILITY_LABELS[band]} tone={band === 'HIGH' ? 'success' : band === 'MEDIUM' ? 'warn' : 'danger'} size="sm" /> : null}
      </View>

      <View style={styles.heroFooter}>
        <PressableScale
          style={styles.stagePillBtn}
          onPress={onOpenStage}
          accessibilityRole="button"
          accessibilityLabel={`Stage: ${stageLabel}. Tap to change.`}
        >
          <Pill label={stageLabel} tone={stageTone} size="sm" />
          <Ionicons name="chevron-down" size={13} color={colors.textSubtle} />
        </PressableScale>
        <Text style={styles.heroMeta} numberOfLines={1}>
          {[updatedLabel, daysLabel].filter(Boolean).join(' · ')}
        </Text>
        {amount ? (
          <Text style={styles.heroAmount} numberOfLines={1}>
            ${amount.value.toLocaleString()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  headerBtn: { width: touchTarget.small, height: touchTarget.small, alignItems: 'center', justifyContent: 'center' },
  // "RW-2841" — the mock's report-id convention (docs/DESIGN_1A.md §3).
  headerReportId: { ...dataLabel, color: colors.onMesh },

  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    padding: spacing.md,
    margin: spacing.lg,
    marginBottom: 0,
    borderRadius: radii.card,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warn,
  },
  missingTitle: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.bold, color: colors.text },
  missingBody: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18, marginTop: 2 },

  // ── Compact hero ──────────────────────────────────────────────────────────
  heroCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: spacing.sm,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroPhotoWrap: {
    width: HERO_PHOTO_SIZE,
    height: HERO_PHOTO_SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: brand.royalInk,
  },
  heroPhotoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroPhotoBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  heroInfo: { flex: 1, gap: 1 },
  heroEyebrow: { ...dataLabel, color: colors.textSubtle },
  heroCustomer: { fontSize: fontSize.titleSm, fontFamily: fontFamily.archivo.bold, color: colors.text, letterSpacing: -0.2 },
  heroAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  heroOneLiner: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 1 },

  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
  },
  stagePillBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: touchTarget.small },
  heroMeta: { flex: 1, fontSize: fontSize.caption, color: colors.textSubtle },
  heroAmount: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.bold, color: colors.text, fontVariant: ['tabular-nums'] },

  tabsBar: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  tabBody: { flex: 1 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleMd, fontFamily: fontFamily.archivo.semibold, color: colors.text },
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
