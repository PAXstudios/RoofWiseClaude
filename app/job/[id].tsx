import { PressableScale } from '@/components/PressableScale';
import { formatDate, formatDateShort, formatRelative } from '@/lib/format/date';
import { useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Image, Share, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import * as ImagePicker from 'expo-image-picker';
import { generateHaagReport } from '@/lib/services/haagPdf';
import { generateLongReport } from '@/lib/services/longReport';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import { SignaturePad } from '@/components/SignaturePad';
import { VoiceNoteRecorder } from '@/components/VoiceNoteRecorder';
import { DamageScoreBar } from '@/components/DamageScoreBar';
import { transcribeAudio } from '@/lib/services/transcribeAudio';
import { useToastStore } from '@/lib/stores/toastStore';
import { isGeminiConfigured } from '@/lib/env';
import { thresholdFor } from '@/lib/services/haagThresholds';
import {
  CLAIM_VIABILITY_LABELS,
  ROOFWISE_RECOMMENDATION_LABELS,
  SAFETY_RATING_LABELS,
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
  type SlopeVerdict,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const COLLATERAL_ITEMS = [
  { key: 'brittleness_observed', label: 'Brittleness observed on test shingles' },
  { key: 'mat_exposed', label: 'Mat exposure visible on damaged slopes' },
  { key: 'multi_layer', label: 'Multi-layer roof system (2+ layers)' },
  { key: 'metal_collateral', label: 'Collateral damage on metal (vents, flashing, AC)' },
  { key: 'window_screens', label: 'Hail damage on window screens / siding' },
  { key: 'gutters_dented', label: 'Dents in gutters or downspouts' },
];

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspectionStore((s) => s.inspections.find((i) => i.id === id));
  const remove = useInspectionStore((s) => s.remove);
  const setStatus = useInspectionStore((s) => s.setStatus);
  const setInspectorSignature = useInspectionStore((s) => s.setInspectorSignature);
  const setCollateralItem = useInspectionStore((s) => s.setCollateralItem);
  const setCollateralZone = useInspectionStore((s) => s.setCollateralZone);
  const setBrittlenessProtocol = useInspectionStore((s) => s.setBrittlenessProtocol);
  const setReportFinalizedAt = useInspectionStore((s) => s.setReportFinalizedAt);
  const setStoredEngineResult = useInspectionStore((s) => s.setStoredEngineResult);
  const setNotes = useInspectionStore((s) => s.setNotes);
  const addAudioNote = useInspectionStore((s) => s.addAudioNote);
  const removeAudioNote = useInspectionStore((s) => s.removeAudioNote);
  const setAudioNoteLabel = useInspectionStore((s) => s.setAudioNoteLabel);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);
  const proposal = useProposalStore((s) => (id ? s.getByJob(id) : undefined));
  const [generating, setGenerating] = useState(false);
  const [generatingLong, setGeneratingLong] = useState(false);
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

  const onDelete = () => {
    Alert.alert(
      'Delete job?',
      `${inspection.reportId} will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          remove(inspection.id);
          router.replace('/(tabs)');
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
              message:
                next === 'complete'
                  ? `Marked ${inspection.reportId} complete`
                  : `Reopened ${inspection.reportId}`,
            });
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
        <PressableScale onPress={onDelete} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </PressableScale>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Address</Text>
          <Text style={styles.cardValue}>{inspection.address}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Roof System</Text>
          <Text style={styles.cardValue}>{ROOF_MATERIAL_LABELS[inspection.material]}</Text>
          <Text style={styles.cardSub}>
            {inspection.geometry} · {inspection.ageYears} yr · {inspection.condition}
          </Text>
        </View>

        {(inspection.carrier || isClaim) && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={styles.cardLabel}>Insurance</Text>
              {isClaim && (
                <View style={styles.claimBadge}>
                  <Text style={styles.claimBadgeText}>Insurance Claim</Text>
                </View>
              )}
            </View>
            {inspection.carrier && (
              <Text style={styles.cardValue}>{INSURANCE_CARRIER_LABELS[inspection.carrier]}</Text>
            )}
            {(inspection.policyNumber || inspection.claimNumber) && (
              <Text style={styles.cardSub}>
                {inspection.policyNumber && `Policy ${inspection.policyNumber}`}
                {inspection.policyNumber && inspection.claimNumber && '  ·  '}
                {inspection.claimNumber && `Claim ${inspection.claimNumber}`}
              </Text>
            )}
            {isClaim && (
              <Text style={styles.cardSub}>
                {[
                  inspection.causeOfLoss && CAUSE_OF_LOSS_LABELS[inspection.causeOfLoss],
                  inspection.policyType && POLICY_TYPE_LABELS[inspection.policyType],
                  inspection.deductible != null &&
                    `$${inspection.deductible.toLocaleString()} deductible`,
                  // Formatted, never raw: the stored value is an ISO
                  // timestamp and a raw one reads as broken on a claim screen.
                  inspection.dateOfLoss && `DOL ${formatDateShort(inspection.dateOfLoss)}`,
                ]
                  .filter(Boolean)
                  .join('  ·  ') || 'Claim details not recorded yet'}
              </Text>
            )}
          </View>
        )}

        {inspection.event && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="thunderstorm" size={20} color={colors.accent} />
              <Text style={styles.cardLabel}>Storm match</Text>
            </View>
            <Text style={styles.cardValue}>
              {inspection.event.kind === 'hail'
                ? `${inspection.event.hailSizeInches?.toFixed(2) ?? ''}" hail`
                : `${inspection.event.windSpeedMph ?? ''} mph wind`}
            </Text>
            <Text style={styles.cardSub}>
              {formatDate(inspection.event.date, 'Date unavailable')}
              {inspection.event.distanceMiles
                ? ` · ${inspection.event.distanceMiles.toFixed(1)} mi away`
                : ''}
              {' · '}
              {inspection.event.source}
              {inspection.event.noaaEventId ? ` · ${inspection.event.noaaEventId}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <DamageScoreBar band={haag.claim_viability} />
        </View>

        <View style={styles.statsRow}>
          <Stat label="Slopes" value={String(inspection.slopes.length)} />
          <Stat label="Photos" value={String(inspection.slopes.reduce((a, sl) => a + sl.photoPaths.length, 0))} />
          <Stat label="Claim" value={CLAIM_VIABILITY_LABELS[haag.claim_viability]} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>HAAG verdict</Text>
          <Text style={styles.cardValue}>
            {ROOFWISE_RECOMMENDATION_LABELS[haag.roofwise_recommendation]}
          </Text>
          <Text style={styles.cardSub}>{decision.roofVerdictReasoning}</Text>
          <Text style={styles.cardSub}>
            Roofer safety: {SAFETY_RATING_LABELS[haag.roofer_safety_rating]}
          </Text>
        </View>

        <PressableScale
          style={styles.primaryBtn}
          onPress={() =>
            router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } })
          }
        >
          <Ionicons name="scan-outline" size={20} color={colors.text} />
          <Text style={styles.primaryBtnText}>Start Quick Inspection</Text>
        </PressableScale>

        {inspection.slopes.length === 0 ? (
          <View style={styles.placeholderBox}>
            <Ionicons name="camera-outline" size={28} color={colors.textSubtle} />
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
              />
            );
          })
        )}

        <PressableScale
          style={styles.proposalCard}
          onPress={() => router.push(`/proposal/${inspection.id}` as any)}
        >
          <Ionicons name="document-attach-outline" size={22} color={colors.text} />
          <View style={{ flex: 1 }}>
            <Text style={styles.proposalTitle}>
              {proposal ? `Proposal · $${proposal.total.toLocaleString()}` : 'Generate proposal'}
            </Text>
            <Text style={styles.proposalSub}>
              {proposal ? `${proposal.status} · ${proposal.lineItems.length} line items` : 'From Decision Engine + Solar squares + regional pricing'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
        </PressableScale>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Collateral checklist</Text>
          {COLLATERAL_ITEMS.map((item) => {
            const checked = !!inspection.collateralChecklist[item.key];
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
        </View>

        {isClaim && (
          <View
            style={styles.card}
            onLayout={(e) => {
              evidenceCardY.current = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.cardLabel}>Claim evidence</Text>
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
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Notes</Text>
          <TextInput
            value={inspection.notes ?? ''}
            onChangeText={(t) => setNotes(inspection.id, t)}
            placeholder="Anything the AI shouldn't miss?"
            placeholderTextColor={colors.textSubtle}
            style={styles.notesInput}
            multiline
            textAlignVertical="top"
          />
        </View>

        <VoiceNoteRecorder
          notes={inspection.audioNotes ?? []}
          onRecorded={(note) => addAudioNote(inspection.id, note)}
          onRemove={(noteId) => removeAudioNote(inspection.id, noteId)}
          onTranscribe={async (noteId) => {
            if (!isGeminiConfigured) {
              toast({
                tone: 'warn',
                title: 'AI not connected',
                body: 'Add EXPO_PUBLIC_GEMINI_API_KEY in .env.local to transcribe.',
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

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Inspector signature</Text>
          <Text style={styles.cardSub}>Sign below to seal the HAAG report.</Text>
          <View style={{ alignItems: 'center', marginTop: spacing.md }}>
            <SignaturePad
              onChange={(svg) => {
                if (svg) setInspectorSignature(inspection.id, svg);
              }}
            />
          </View>
          {inspection.inspectorSignatureSvg && (
            <View style={styles.signedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.signedBadgeText}>Signed</Text>
            </View>
          )}
        </View>

        <PressableScale
          style={[styles.reportCta, generating && { opacity: 0.5 }]}
          disabled={generating}
          onPress={onGenerateHaagReport}
        >
          <Ionicons name="document-text-outline" size={20} color={colors.textInverse} />
          <Text style={styles.reportCtaText}>
            {generating
              ? 'Generating…'
              : isClaim
                ? 'Generate HAAG claim packet (PDF)'
                : 'Generate HAAG report (PDF)'}
          </Text>
        </PressableScale>
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
          style={[styles.quietCta, generatingLong && { opacity: 0.5 }]}
          disabled={generatingLong}
          onPress={async () => {
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

function SlopeBlock({
  inspection,
  slope,
  verdict,
  reasoning,
  confidenceAvg,
}: {
  inspection: Inspection;
  slope: Slope;
  verdict: SlopeVerdict;
  reasoning: string;
  confidenceAvg: number;
}) {
  const router = useRouter();
  const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
  const threshold = thresholdFor(inspection.material);

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.cardValue}>Slope {slope.orientation}</Text>
        <VerdictPill verdict={verdict} />
      </View>

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
                onPress={() =>
                  router.push({
                    pathname: '/edit-detection',
                    params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(i) },
                  })
                }
              >
                <Image source={{ uri }} style={styles.photoTile} />
                <View style={styles.editBadge}>
                  <Ionicons name="create-outline" size={12} color={colors.textInverse} />
                </View>
              </PressableScale>
            ))}
          </View>
        </ScrollView>
      )}

      <View style={styles.testSquare}>
        <Text style={styles.testSquareLabel}>HAAG test square</Text>
        <Text style={styles.testSquareLine}>
          {slope.hailCount} hits observed · threshold {threshold.hitsPerTestSquare === 0
            ? '(penetration / crack)'
            : `${threshold.hitsPerTestSquare}+ per 10×10' square`}
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

      {reasoning && (
        <Text style={styles.reasoning}>
          {reasoning}
          {confidenceAvg > 0 ? ` (avg confidence ${Math.round(confidenceAvg)}%)` : ''}
        </Text>
      )}
    </View>
  );
}

function VerdictPill({ verdict }: { verdict: SlopeVerdict }) {
  const tone = (() => {
    switch (verdict) {
      // iOS badge language: semantic soft ground + semantic text, never a blob.
      case 'full_replace': return { bg: colors.accentSoft, fg: colors.accent, label: 'Full replace' };
      case 'partial_replace': return { bg: colors.warnSoft, fg: colors.warn, label: 'Partial' };
      case 'verify_with_inspector': return { bg: colors.infoSoft, fg: colors.info, label: 'Verify' };
      default: return { bg: colors.fillQuiet, fg: colors.textMuted, label: 'Repair' };
    }
  })();
  return (
    <View style={[styles.verdictPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.verdictText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  // White inset cards on the grouped ground: hairline + near-zero shadow.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text, textTransform: 'capitalize' },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.textMuted },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  // Quiet iOS stat cells: ink tabular numbers, 13 muted labels — never orange.
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    alignItems: 'center',
    ...shadows.card,
  },
  statValue: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // Quiet capture action — orange is reserved for the report-generation CTA.
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.xs,
  },
  primaryBtnText: { color: colors.text, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

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
  reportCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
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

  proposalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  proposalTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  proposalSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },

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

  // Soft-ground badge, not an orange blob — same claim-mode language as bands.
  claimBadge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  claimBadgeText: {
    color: colors.accentPressed,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  britChip: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.fillQuiet,
  },
  britChipActive: { backgroundColor: colors.navy },
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

  photoTile: {
    width: 140,
    height: 100,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
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
  testSquareRule: { fontSize: fontSize.bodySm, color: colors.textMuted },

  verdictPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  verdictText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },

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
