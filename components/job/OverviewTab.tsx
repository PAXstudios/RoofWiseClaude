// Overview tab — the dense, at-a-glance home the owner's reference apps
// (JobNimbus, RoofBid) call "Overview": the At-a-Glance grid, next action,
// the assessment (verdict + damage score + damage detail), claim details,
// the property record, documentation, and the two report CTAs. Everything
// here lived on the old single-scroll job page; nothing was cut, only
// regrouped — see the wave report's per-section "where it went" table.

import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { QuickActions } from '@/components/pipeline/QuickActions';
import { LinkedLeadCard } from '@/components/pipeline/LinkedLeadCard';
import { DamageScoreCard } from '@/components/DamageScoreCard';
import { DamageScoreBar } from '@/components/DamageScoreBar';
import { DamageDetailSection } from '@/components/DamageDetailSection';
import { VoiceNoteRecorder } from '@/components/VoiceNoteRecorder';
import { SignaturePad } from '@/components/SignaturePad';
import { damageScoreFromEngine } from '@/lib/services/damageScore';
import { formatDate, formatRelative } from '@/lib/format/date';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { usePropertyRecordStore } from '@/lib/stores/propertyRecordStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { openMail, openPhone } from '@/components/pipeline/contact';
import { totalSquares as intelTotalSquares } from '@/lib/services/propertyIntel';
import {
  recordFactsLine,
  recordRoofLine,
  recordStatusBadge,
  roofAgePrefill,
  roofSizePlausibility,
} from '@/lib/services/propertyRecord';
import type { JobAmount } from '@/lib/services/proposals';
import { JOB_AMOUNT_SOURCE_LABELS } from '@/lib/services/proposals';
import type { MissingDetails } from '@/lib/services/placeholderDetails';
import { describeMissingDetails } from '@/lib/services/placeholderDetails';
import type { DecisionEngineResult, HaagEngineResult, RoofwiseRecommendation } from '@/lib/services/decisionEngine';
import { ROOFWISE_RECOMMENDATION_LABELS, SAFETY_RATING_LABELS } from '@/lib/services/decisionEngine';
import {
  COLLATERAL_ZONES,
  COLLATERAL_ZONE_LABELS,
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
  type BrittlenessProtocol,
  type BrittlenessResult,
  type CollateralChecklistItem,
  type CollateralZone,
  type Inspection,
  type Lead,
} from '@/lib/models/types';
import type { JobTabKey } from './JobTabs';
import {
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
 * DROPPED, never interpolated — a card reading "undefined · 12 yr ·
 * undefined" is worse than one reading "12 yr". (Moved verbatim from the old
 * single-scroll job page.)
 */
function roofSystemLine(ins: Inspection): string {
  const age =
    ins.ageSource === 'year_built'
      ? `≤${ins.ageYears} yr (from build year)`
      : ins.ageSource === 'listing'
        ? `${ins.ageYears} yr (listing)`
        : ins.ageSource === 'listing_new_roof'
          ? `${ins.ageYears} yr (new roof per listing)`
          : `${ins.ageYears} yr`;
  return [ins.geometry, age, ins.condition]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' · ');
}

const COLLATERAL_ITEMS = [
  { key: 'brittleness_observed', label: 'Brittleness observed on test shingles' },
  { key: 'mat_exposed', label: 'Mat exposure visible on damaged slopes' },
  { key: 'multi_layer', label: 'Multi-layer roof system (2+ layers)' },
  { key: 'metal_collateral', label: 'Collateral damage on metal (vents, flashing, AC)' },
  { key: 'window_screens', label: 'Hail damage on window screens / siding' },
  { key: 'gutters_dented', label: 'Dents in gutters or downspouts' },
];

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

type Glance = { measurements: number; photos: number; proposals: number; latestTotal: JobAmount | null };

export type NextAction = {
  icon: IoniconName;
  tone: ChipTone;
  title: string;
  sub: string;
  onPress: () => void;
};

type Props = {
  inspection: Inspection;
  haag: HaagEngineResult;
  decision: DecisionEngineResult;
  hasEvidence: boolean;
  missing: MissingDetails;
  linkedLead?: Lead;
  glance: Glance;
  nextAction: NextAction | null;
  insurancePolicyLine: string | null;
  claimDetailLine: string | null;
  brittlenessGap: string | null;
  generating: boolean;
  generatingLong: boolean;
  engineFreshnessStale: boolean;

  onOpenTab: (tab: JobTabKey) => void;
  onEditDetails: () => void;
  onBook?: () => void;
  onContacted?: () => void;
  onSetNotes: (text: string) => void;
  onSetCollateralItem: (key: string, value: boolean) => void;
  onSetCollateralZone: (zone: CollateralZone, patch: Partial<CollateralChecklistItem>) => void;
  onSetBrittlenessProtocol: (protocol: BrittlenessProtocol) => void;
  onPickZonePhoto: (zone: CollateralZone) => void;
  onPickBrittlenessPhoto: () => void;
  onAddAudioNote: (note: { uri: string; durationSec: number; label?: string }) => void;
  onRemoveAudioNote: (noteId: string) => void;
  onTranscribeAudioNote: (noteId: string) => Promise<void> | void;
  onSignInspector: (svg: string) => void;
  onGenerateHaagReport: () => void;
  onGenerateLongReport: () => void;
};

export function OverviewTab({
  inspection,
  haag,
  decision,
  hasEvidence,
  missing,
  linkedLead,
  glance,
  nextAction,
  insurancePolicyLine,
  claimDetailLine,
  brittlenessGap,
  generating,
  generatingLong,
  engineFreshnessStale,
  onOpenTab,
  onEditDetails,
  onBook,
  onContacted,
  onSetNotes,
  onSetCollateralItem,
  onSetCollateralZone,
  onSetBrittlenessProtocol,
  onPickZonePhoto,
  onPickBrittlenessPhoto,
  onAddAudioNote,
  onRemoveAudioNote,
  onTranscribeAudioNote,
  onSignInspector,
  onGenerateHaagReport,
  onGenerateLongReport,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const evidenceCardY = useRef(0);
  const isClaim = inspection.kind === 'insurance_claim';
  const totalFindings = inspection.slopes.reduce(
    (a, sl) => a + (sl.aiFindings ?? []).filter((f) => f.detected).length,
    0,
  );

  const jumpToClaimEvidence = () =>
    scrollRef.current?.scrollTo({ y: Math.max(0, evidenceCardY.current - spacing.xl), animated: true });

  // The brittleness-gap Alert (with a real "Record now" that scrolls THIS
  // tab's own ScrollView to the Claim Evidence card) lives here rather than
  // in app/job/[id].tsx — this is the one place that owns the scroll ref the
  // jump needs. `onGenerateHaagReport` / `onGenerateLongReport` are the raw
  // generators; they still self-gate on `missing.any`.
  const onGenerateHaagPress = () => {
    if (!(isClaim && brittlenessGap)) {
      onGenerateHaagReport();
      return;
    }
    Alert.alert(
      'Claim evidence is incomplete',
      `${brittlenessGap}\n\nThe report discloses the gap either way — the adjuster will see it.`,
      [
        { text: 'Record now', style: 'cancel', onPress: jumpToClaimEvidence },
        { text: 'Generate anyway', onPress: onGenerateHaagReport },
      ],
    );
  };

  const onGenerateLongPress = () => {
    if (!(isClaim && brittlenessGap)) {
      onGenerateLongReport();
      return;
    }
    Alert.alert(
      'Claim evidence is incomplete',
      `${brittlenessGap}\n\nThe Long Report discloses the gap either way — the adjuster will see it.`,
      [
        { text: 'Record now', style: 'cancel', onPress: jumpToClaimEvidence },
        { text: 'Generate anyway', onPress: onGenerateLongReport },
      ],
    );
  };

  return (
    <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      {/* At a Glance — the four stat tiles from the reference apps. Each taps
          through to the tab that has the detail. */}
      <View style={styles.glanceGrid}>
        <GlanceTile
          icon="scan-outline"
          tone="blue"
          label="Measurements"
          value={String(glance.measurements)}
          onPress={() => onOpenTab('measure')}
        />
        <GlanceTile
          icon="images-outline"
          tone="purple"
          label="Photos"
          value={String(glance.photos)}
          onPress={() => onOpenTab('photos')}
        />
        <GlanceTile
          icon="document-attach-outline"
          tone="orange"
          label="Proposals"
          value={String(glance.proposals)}
          onPress={() => onOpenTab('proposal')}
        />
        <GlanceTile
          icon="cash-outline"
          tone="green"
          label="Latest total"
          value={glance.latestTotal ? `$${glance.latestTotal.value.toLocaleString()}` : '—'}
          caption={glance.latestTotal ? JOB_AMOUNT_SOURCE_LABELS[glance.latestTotal.source] : 'Nothing yet'}
          onPress={() => onOpenTab('proposal')}
        />
      </View>

      {nextAction && (
        <RichCard
          onPress={nextAction.onPress}
          icon={nextAction.icon}
          iconTone={nextAction.tone}
          title={nextAction.title}
          subtitle={nextAction.sub}
          chevron
          accessibilityLabel={`Next: ${nextAction.title}. ${nextAction.sub}`}
        />
      )}

      <RichCard
        icon="person-outline"
        iconTone="blue"
        title={missing.name ? 'Customer not set' : inspection.customerName}
        subtitle={missing.address ? 'Address not set' : inspection.address}
        action={{ label: 'Edit', onPress: onEditDetails, icon: 'create-outline' }}
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
        <QuickActions
          name={inspection.customerName}
          phone={inspection.customerPhone}
          email={inspection.customerEmail}
          address={inspection.address}
          coords={{ lat: inspection.lat, lng: inspection.lng }}
          onBook={onBook}
          bookLabel="Follow-up"
          onContacted={onContacted}
        />
      </RichCard>

      {linkedLead && <LinkedLeadCard lead={linkedLead} />}

      {(inspection.carrier || isClaim) && (
        <RichCard
          icon="shield-outline"
          iconTone="purple"
          title={inspection.carrier ? INSURANCE_CARRIER_LABELS[inspection.carrier] : 'Insurance'}
          headerTrailing={isClaim ? <Pill label="Insurance Claim" tone="accent" size="sm" /> : undefined}
          contentStyle={styles.bodyRows}
        >
          {insurancePolicyLine && <Text style={styles.cardSub}>{insurancePolicyLine}</Text>}
          {claimDetailLine && <Text style={styles.cardSub}>{claimDetailLine}</Text>}
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
      <DamageScoreCard result={damageScoreFromEngine(inspection, haag)} />
      <DamageScoreBar
        band={hasEvidence ? haag.claim_viability : undefined}
        stats={[
          { label: 'Slopes', value: String(inspection.slopes.length) },
          { label: 'Photos', value: String(glance.photos) },
          { label: 'Findings', value: String(totalFindings) },
        ]}
      />

      <SectionHeader title="Damage detail" style={styles.sectionSpacing} />
      <DamageDetailSection inspection={inspection} />

      <RichCard
        icon={hasEvidence ? RECOMMENDATION_ICON[haag.roofwise_recommendation] : 'help-circle-outline'}
        iconTone={hasEvidence ? RECOMMENDATION_TONE[haag.roofwise_recommendation] : 'quiet'}
        title="HAAG Verdict"
        subtitle={
          hasEvidence ? ROOFWISE_RECOMMENDATION_LABELS[haag.roofwise_recommendation] : 'Not assessed — analyze photos'
        }
      >
        <Text style={styles.cardSub}>
          {hasEvidence
            ? decision.roofVerdictReasoning
            : 'No analyzed photos yet — a verdict with no evidence behind it would be invented. Capture and analyze photos to get one.'}
        </Text>
        <View style={styles.safetyRow}>
          <Ionicons name="shield-outline" size={15} color={colors.textMuted} />
          <Text style={styles.safetyText}>Roofer safety: {SAFETY_RATING_LABELS[haag.roofer_safety_rating]}</Text>
        </View>
      </RichCard>

      <PropertyRecordCard inspection={inspection} onEditDetails={onEditDetails} />

      <SectionHeader title="Collateral" style={styles.sectionSpacing} />
      <RichCard icon="checkbox-outline" iconTone="blue" title="Collateral Checklist" contentStyle={styles.bodyRows}>
        {COLLATERAL_ITEMS.map((item) => {
          const checked = !!(inspection.collateralChecklist ?? {})[item.key];
          return (
            <PressableScale
              key={item.key}
              style={styles.collateralRow}
              onPress={() => onSetCollateralItem(item.key, !checked)}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={checked ? colors.success : colors.textSubtle}
              />
              <Text style={[styles.collateralLabel, checked && styles.collateralChecked]}>{item.label}</Text>
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
          <RichCard icon="shield-checkmark-outline" iconTone="purple" title="Claim Evidence" contentStyle={styles.bodyRows}>
            {COLLATERAL_ZONES.map((zone) => {
              const item = inspection.collateralEvidence?.[zone] ?? { checked: false, photoIds: [] };
              return (
                <View key={zone} style={styles.zoneRow}>
                  <PressableScale
                    style={[styles.collateralRow, { flex: 1 }]}
                    onPress={() => onSetCollateralZone(zone, { checked: !item.checked })}
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
                    onPress={() => onPickZonePhoto(zone)}
                  >
                    <Ionicons name="camera-outline" size={20} color={colors.text} />
                    {item.photoIds.length > 0 && <Text style={styles.zonePhotoCount}>{item.photoIds.length}</Text>}
                  </PressableScale>
                </View>
              );
            })}

            <Text style={[styles.cardLabel, { marginTop: spacing.md }]}>Brittleness test</Text>
            <Text style={styles.cardSub}>
              Lift shingle corners in an undamaged area and photograph the test — the photo is required evidence
              on an insurance report.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              {(['PASS', 'FAIL', 'BORDERLINE'] as BrittlenessResult[]).map((r) => {
                const active = inspection.brittlenessProtocol?.result === r;
                return (
                  <PressableScale
                    key={r}
                    style={[styles.britChip, active && styles.britChipActive]}
                    onPress={() =>
                      onSetBrittlenessProtocol({
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
            <PressableScale style={styles.analyzeBtn} onPress={onPickBrittlenessPhoto}>
              <Ionicons name="camera-outline" size={18} color={colors.text} />
              <Text style={styles.analyzeBtnText}>
                Add test photo
                {(inspection.brittlenessProtocol?.photoIds.length ?? 0) > 0
                  ? ` (${inspection.brittlenessProtocol?.photoIds.length})`
                  : ''}
              </Text>
            </PressableScale>
            {inspection.brittlenessProtocol && inspection.brittlenessProtocol.photoIds.length === 0 && (
              <Text style={styles.evidenceWarn}>
                Photo of the test process is still required before this result can go to a carrier.
              </Text>
            )}
          </RichCard>
        </View>
      )}

      <SectionHeader title="Documentation" style={styles.sectionSpacing} />
      <RichCard icon="create-outline" iconTone="blue" title="Notes">
        <TextInput
          value={inspection.notes ?? ''}
          onChangeText={onSetNotes}
          placeholder="Anything the AI shouldn't miss?"
          placeholderTextColor={colors.textSubtle}
          style={styles.notesInput}
          multiline
          textAlignVertical="top"
        />
      </RichCard>

      <VoiceNoteRecorder
        notes={inspection.audioNotes ?? []}
        onRecorded={onAddAudioNote}
        onRemove={onRemoveAudioNote}
        onTranscribe={onTranscribeAudioNote}
      />

      <RichCard icon="finger-print-outline" iconTone="purple" title="Inspector Signature" subtitle="Sign below to seal the HAAG report.">
        <View style={{ alignItems: 'center', marginTop: spacing.md }}>
          <SignaturePad
            onChange={(svg, meta) => {
              if (svg && meta.meaningful) onSignInspector(svg);
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

      <PressableScale
        style={[styles.reportCtaShadow, (generating || missing.any) && styles.reportCtaDisabled]}
        disabled={generating || missing.any}
        onPress={onGenerateHaagPress}
        accessibilityRole="button"
        accessibilityLabel={isClaim ? 'Generate HAAG claim packet PDF' : 'Generate HAAG report PDF'}
        accessibilityState={{ disabled: generating || missing.any }}
      >
        <View style={styles.reportCtaClip}>
          <LinearGradient colors={gradients.accent} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={styles.reportCtaContent}>
            <Ionicons name="document-text-outline" size={20} color={colors.textInverse} />
            <Text style={styles.reportCtaText}>
              {generating ? 'Generating…' : isClaim ? 'Generate HAAG claim packet (PDF)' : 'Generate HAAG report (PDF)'}
            </Text>
          </View>
        </View>
      </PressableScale>
      {missing.any && (
        <Text style={styles.gateHint}>
          {describeMissingDetails(missing)} before generating — a packet cannot go to a carrier with placeholder
          details.
        </Text>
      )}
      {isClaim && brittlenessGap && <Text style={styles.gateHint}>Brittleness evidence is incomplete — the packet will disclose it.</Text>}
      {inspection.reportFinalizedAt && (
        <Text style={styles.finalizedHint}>Report last finalized {formatRelative(inspection.reportFinalizedAt)}</Text>
      )}
      {engineFreshnessStale && (
        <Text style={styles.gateHint}>
          This job changed since that report was finalized. The determination above is current; the signed PDF is
          not — regenerate it before sending.
        </Text>
      )}

      <PressableScale
        style={[styles.quietCta, (generatingLong || missing.any) && { opacity: 0.5 }]}
        disabled={generatingLong || missing.any}
        accessibilityState={{ disabled: generatingLong || missing.any }}
        onPress={onGenerateLongPress}
      >
        <Ionicons name="reader-outline" size={20} color={colors.text} />
        <Text style={styles.quietCtaText}>{generatingLong ? 'Generating…' : 'Generate Long Report (PDF)'}</Text>
      </PressableScale>
    </ScrollView>
  );
}

/**
 * The Zillow record card. Every line is attributed; a missing record says
 * why; the button is the only way a lookup is spent (free tier: 50/month).
 * Moved verbatim from the old single-scroll job page — self-contained now
 * (it owns its own lookup call and busy state) rather than threaded through
 * app/job/[id].tsx as a rendered prop.
 */
function PropertyRecordCard({
  inspection,
  onEditDetails,
}: {
  inspection: Inspection;
  /** Address is missing — send the roofer to the details sheet instead of looking up nothing. */
  onEditDetails: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lookupRecord = usePropertyRecordStore((s) => s.lookup);
  const setPropertyRecord = useInspectionStore((s) => s.setPropertyRecord);
  const toast = useToastStore((s) => s.show);

  const onLookup = async (force: boolean) => {
    if (!inspection.address || inspection.address.trim().length === 0) {
      onEditDetails();
      return;
    }
    setBusy(true);
    try {
      const rec = await lookupRecord(inspection.address, { force });
      setPropertyRecord(inspection.id, rec);
      toast(
        rec.status === 'found'
          ? { tone: 'success', title: 'Property record found', body: recordFactsLine(rec) }
          : { tone: 'warn', title: 'No property record', body: rec.reason },
      );
    } finally {
      setBusy(false);
    }
  };

  const rec = inspection.propertyRecord;
  const facts = recordFactsLine(rec);
  const nowYear = new Date().getFullYear();
  const prefill = roofAgePrefill(rec, nowYear);
  const roofLine = recordRoofLine(rec, nowYear);
  const badge = recordStatusBadge(rec);
  const fit = roofSizePlausibility(rec, intelTotalSquares(inspection) ?? undefined);
  if (!rec || rec.status === 'not_configured') {
    return (
      <RichCard
        icon="business-outline"
        iconTone="quiet"
        title="Property record"
        subtitle={rec?.status === 'not_configured' ? rec.reason : 'Not looked up yet'}
        action={rec?.status === 'not_configured' ? undefined : { label: busy ? 'Looking up…' : 'Look up', onPress: () => onLookup(false), icon: 'search-outline' }}
      />
    );
  }
  return (
    <RichCard
      icon="business-outline"
      iconTone={rec.status === 'found' ? 'green' : 'orange'}
      title={rec.status === 'found' ? 'Property record (Zillow)' : 'Property record'}
      subtitle={rec.status === 'found' ? (facts ?? rec.streetAddress) : rec.reason}
      action={{ label: busy ? 'Refreshing…' : 'Refresh', onPress: () => onLookup(true), icon: 'refresh-outline' }}
      headerTrailing={badge ? <Pill label={badge.label} tone={badge.tone} size="sm" /> : undefined}
    >
      {rec.status === 'found' ? (
        <View style={{ gap: spacing.xs }}>
          {badge ? <Text style={styles.recordHint}>{badge.hint}</Text> : null}
          {fit ? <Text style={[styles.recordHint, !fit.ok && { color: colors.warn }]}>{fit.note}</Text> : null}
          {rec.listingAgent ? (
            <View style={styles.agentRow}>
              <Text style={styles.recordLine}>
                Listing agent: {rec.listingAgent.name ?? 'on file'}
                {rec.listingAgent.company ? ` · ${rec.listingAgent.company}` : ''}
              </Text>
              <View style={styles.agentBtns}>
                {rec.listingAgent.phone ? (
                  <PressableScale style={styles.agentBtn} onPress={() => openPhone(rec.listingAgent!.phone!)} accessibilityRole="button" accessibilityLabel="Call the listing agent">
                    <Ionicons name="call-outline" size={18} color={colors.text} />
                    <Text style={styles.agentBtnText}>Call agent</Text>
                  </PressableScale>
                ) : null}
                {rec.listingAgent.email ? (
                  <PressableScale style={styles.agentBtn} onPress={() => openMail(rec.listingAgent!.email!)} accessibilityRole="button" accessibilityLabel="Email the listing agent">
                    <Ionicons name="mail-outline" size={18} color={colors.text} />
                    <Text style={styles.agentBtnText}>Email agent</Text>
                  </PressableScale>
                ) : null}
              </View>
            </View>
          ) : null}
          {rec.lotSizeSqFt ? (
            <Text style={styles.recordLine}>
              Lot {Math.round(rec.lotSizeSqFt).toLocaleString()} sq ft
              {rec.propertyType ? ` · ${rec.propertyType.replace(/_/g, ' ').toLowerCase()}` : ''}
            </Text>
          ) : null}
          {rec.zestimate ? (
            <Text style={styles.recordLine}>
              Zestimate ${rec.zestimate.toLocaleString()}
              {rec.lastSoldPrice ? ` · last sold $${rec.lastSoldPrice.toLocaleString()}` : ''}
            </Text>
          ) : null}
          {roofLine ? <Text style={styles.recordLine}>{roofLine}</Text> : null}
          {rec.roofHints?.length ? <Text style={styles.recordHint}>Listing on the roof: "{rec.roofHints[0].text}"</Text> : null}
          {prefill ? (
            <Text style={styles.recordHint}>
              {inspection.ageSource === 'inspector' || (inspection.ageYears > 0 && !inspection.ageSource)
                ? `Zillow suggests ${prefill.ageYears} yr; the inspector's ${inspection.ageYears} yr stands.`
                : prefill.note}
            </Text>
          ) : null}
          <Text style={styles.recordFoot}>No permit or roof-repair records exist in this data — age from a build year is an upper bound.</Text>
        </View>
      ) : null}
    </RichCard>
  );
}

function GlanceTile({
  icon,
  tone,
  label,
  value,
  caption,
  onPress,
}: {
  icon: IoniconName;
  tone: ChipTone;
  label: string;
  value: string;
  caption?: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={styles.glanceTile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${caption ? `, ${caption}` : ''}`}
    >
      <IconChip name={icon} tone={tone} size="sm" />
      <Text style={styles.glanceValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.glanceLabel} numberOfLines={1}>
        {label}
      </Text>
      {caption ? (
        <Text style={styles.glanceCaption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  sectionSpacing: { marginBottom: spacing.sm },

  glanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  glanceTile: {
    width: '48%',
    minHeight: touchTarget.preferred,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    gap: 2,
    ...shadows.card,
  },
  glanceValue: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  glanceLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted },
  glanceCaption: { fontSize: fontSize.caption, color: colors.textSubtle },

  bodyRows: { gap: spacing.xs },
  roofLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  recordLine: { fontSize: fontSize.bodySm, color: colors.textMuted },
  recordHint: { fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  recordFoot: { fontSize: fontSize.caption, color: colors.textSubtle, lineHeight: 16 },
  agentRow: { gap: spacing.xs, marginTop: spacing.xs },
  agentBtns: { flexDirection: 'row', gap: spacing.sm },
  agentBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  agentBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },

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

  collateralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
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
  zonePhotoCount: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  collateralLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text },
  collateralChecked: { textDecorationLine: 'line-through', color: colors.textMuted },

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
  evidenceWarn: { fontSize: fontSize.bodySm, color: colors.danger, marginTop: spacing.sm },

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

  notesInput: {
    minHeight: 96,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    padding: spacing.md,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    marginTop: spacing.sm,
  },

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

  reportCtaShadow: { borderRadius: radii.button, ...shadows.raised, marginTop: spacing.sm },
  reportCtaDisabled: { opacity: 0.5 },
  reportCtaClip: { height: touchTarget.preferred, borderRadius: radii.button, overflow: 'hidden' },
  reportCtaContent: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  reportCtaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  gateHint: { fontSize: fontSize.bodySm, color: colors.warn, fontWeight: fontWeight.medium, textAlign: 'center', marginTop: spacing.xs },
  finalizedHint: { fontSize: fontSize.bodySm, color: colors.textSubtle, textAlign: 'center', marginTop: spacing.xs },

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
});
