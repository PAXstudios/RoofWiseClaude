// Per-photo damage report — the short, readable answer for ONE photo.
//
// Owner: "Each photo, after being analyzed should be able to be selected and
// have a page that shows a short damage report. Like how many hits and type of
// damage. Type of shingle/roof. What side. And if it's not a roof it should be
// able to identify what has been captured and the type of damage."
//
// Everything on this page is already on the inspection: the photo's markers
// (category / severity / confidence / box), its capture metadata (slope, area
// tag, test square vs single shingle), the analysis state (model, timing, the
// shingle type read from this photo, the non-roof subject and its collateral
// damage), and the shingle-scale estimate. Nothing is fabricated; every empty
// state says why (Drift #5). Editing markers stays in edit-detection — this
// page reads, and links there.

import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AnnotatedPhoto } from '@/components/photo/AnnotatedPhoto';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { IconChip } from '@/components/ui/IconChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  CAPTURE_MODE_LABELS,
  COLLATERAL_DAMAGE_LABELS,
  COLLATERAL_ZONE_LABELS,
  DAMAGE_CATEGORY_LABELS,
  PHOTO_SUBJECT_LABELS,
  PHOTO_SUBJECT_ZONE,
  ROOF_MATERIAL_LABELS,
  SEVERITY_LABELS,
  type DamageCategory,
  type DamageMarker,
  type Severity,
} from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { analyzeSlope, getPhotoAnalysisState } from '@/lib/services/analyzeSlope';
import { carrierBarsRead, thresholdFor } from '@/lib/services/haagThresholds';
import { resolvePhotoReportTarget } from '@/lib/services/photoReportTarget';
import { isGeminiConfigured } from '@/lib/env';
import { colors, dataLabel, fontFamily, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const SEVERITY_TONE: Record<Severity, PillTone> = {
  none: 'neutral',
  minor: 'info',
  moderate: 'warn',
  severe: 'danger',
};

const SEVERITY_RANK: Record<Severity, number> = { none: 0, minor: 1, moderate: 2, severe: 3 };

type CategoryRow = {
  category: DamageCategory;
  count: number;
  /** Worst severity among this category's markers. */
  severity: Severity;
  /** Mean confidence, rounded. */
  confidence: number;
};

/** Markers → one row per category, worst-first. Pure. */
function summarize(markers: DamageMarker[]): CategoryRow[] {
  const by = new Map<DamageCategory, { count: number; severity: Severity; conf: number }>();
  for (const m of markers) {
    const cur = by.get(m.category) ?? { count: 0, severity: 'none' as Severity, conf: 0 };
    cur.count += 1;
    cur.conf += m.confidence;
    if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[cur.severity]) cur.severity = m.severity;
    by.set(m.category, cur);
  }
  return [...by.entries()]
    .map(([category, v]) => ({
      category,
      count: v.count,
      severity: v.severity,
      confidence: Math.round(v.conf / v.count),
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);
}

export default function PhotoReportScreen() {
  const router = useRouter();
  const toast = useToastStore((s) => s.show);
  const { inspectionId, slopeId, attachmentId, photoPath } = useLocalSearchParams<{
    inspectionId: string;
    slopeId: string;
    attachmentId?: string;
    photoPath?: string;
  }>();
  const inspection = useInspectionStore((s) => s.inspections.find((i) => i.id === inspectionId));
  const target = resolvePhotoReportTarget(inspection, slopeId, attachmentId, photoPath);
  const slope = target?.slope;
  const index = target?.index ?? -1;
  const uri = target?.uri;
  const [reanalyzing, setReanalyzing] = useState(false);

  const markers = useMemo(
    () => (slope ? slope.damage.filter((m) => m.photoIndex === index) : []),
    [slope, index],
  );
  const rows = useMemo(() => summarize(markers), [markers]);

  // Honest not-found: junk params, a deleted photo, a renumbered index.
  if (!inspection || !slope || !uri) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Photo report" back={() => router.back()} />
        <View style={styles.empty}>
          <IconChip name="image-outline" tone="quiet" size="md" />
          <Text style={styles.emptyTitle}>This photo isn't here any more</Text>
          <Text style={styles.emptyText}>
            It may have been deleted, or the link is stale. Open the job to see its current photos.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const state = getPhotoAnalysisState(slope, index);
  const meta = slope.photoMeta?.find((m) => m.photoIndex === index);
  const captureMode = meta?.captureMode ?? 'square_10x10';
  const isSquare = captureMode === 'square_10x10';
  const scale = slope.scaleEstimates?.find((e) => e.photoIndex === index);
  const threshold = thresholdFor(inspection.material);
  const hailHere = rows.find((r) => r.category === 'hail_hits')?.count ?? 0;
  const nonRoof = state?.noRoofDetected === true;
  const subject = state?.subject ?? (nonRoof ? 'unidentifiable' : 'roof_field');
  const zone = PHOTO_SUBJECT_ZONE[subject];
  const analyzed = state?.status === 'done';
  const manuallyReviewed = state?.reviewSource === 'inspector';

  const reanalyze = async () => {
    if (reanalyzing) return;
    if (!isGeminiConfigured) {
      Alert.alert('AI not connected', "AI analysis isn't set up on this build — ask your admin.");
      return;
    }
    setReanalyzing(true);
    try {
      const current = resolvePhotoReportTarget(useInspectionStore.getState().getById(inspection.id), slopeId, attachmentId, photoPath);
      if (!current) throw new Error('This attachment is no longer available.');
      await analyzeSlope(inspection.id, current.slope.id, { photoIndexes: [current.index] });
      toast({ tone: 'success', title: 'Photo re-analyzed' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Re-analyze failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setReanalyzing(false);
    }
  };

  const sideLine = [meta?.areaTag, `${slope.orientation} slope`].filter(Boolean).join(' · ');

  // HAAG §1 tally for this photo's hail marks: how many show mat fracture /
  // exposed substrate (functional) vs granule loss only. Absent on markers
  // analyzed before evidence classification existed.
  const evidenceLine = (() => {
    const hail = markers.filter((m) => m.category === 'hail_hits' || m.category === 'bruising');
    if (hail.length === 0 || !hail.some((m) => m.evidence)) return null;
    const functional = hail.filter((m) => m.evidence === 'mat_fracture' || m.evidence === 'exposed_substrate').length;
    const granule = hail.filter((m) => m.evidence === 'granule_loss_only').length;
    const unclear = hail.length - functional - granule;
    return (
      `HAAG §1: ${functional} of ${hail.length} hail mark${hail.length === 1 ? '' : 's'} show mat fracture or exposed substrate` +
      (granule > 0 ? ` · ${granule} granule loss only` : '') +
      (unclear > 0 ? ` · ${unclear} unclear / cosmetic` : '')
    );
  })();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Photo report"
        subtitle={`${inspection.reportId} · photo ${index + 1} of ${slope.photoPaths.length}`}
        back={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* The photo with its AI markers and any freehand annotation, both
            read-only — editing markers is a deliberate step, one card down.
            Tapping the photo opens the annotator, RoofBid-style: draw on
            it, add a label, straight from the report. */}
        <View style={styles.photoCard}>
          <AnnotatedPhoto
            uri={uri}
            attachmentId={slope.photoAttachmentIds?.[index]}
            style={styles.photoFill}
            contentFit="contain"
            zoomable
            markers={markers}
            onPress={() =>
              router.push({
                pathname: '/annotate',
                params: { inspectionId: inspection.id, slopeId: slope.id, index: String(index), uri, attachmentId: slope.photoAttachmentIds?.[index] },
              })
            }
            accessibilityLabel="Photo. Tap to draw on it or add a label."
          />
        </View>

        {/* Where, what, how it was shot. */}
        <View style={styles.headline}>
          <View style={styles.headlineRow}>
            <Text style={styles.headlineTitle} numberOfLines={2}>
              {nonRoof ? PHOTO_SUBJECT_LABELS[subject] : sideLine}
            </Text>
            <Pill
              label={
                state?.status === 'failed'
                  ? 'Failed'
                  : state?.status === 'analyzing' || reanalyzing
                    ? 'Analyzing'
                    : state?.status === 'queued'
                      ? 'Queued'
                      : analyzed
                        ? manuallyReviewed ? 'Reviewed by inspector' : 'Analyzed'
                        : 'Not analyzed'
              }
              tone={
                state?.status === 'failed'
                  ? 'danger'
                  : analyzed
                    ? 'success'
                    : 'neutral'
              }
              size="sm"
            />
          </View>
          <View style={styles.chipRow}>
            {nonRoof && <Pill label={sideLine} tone="neutral" size="sm" />}
            <Pill label={CAPTURE_MODE_LABELS[captureMode]} tone="brand" size="sm" />
            {state?.shingleType?.type && !nonRoof ? (
              <Pill
                label={`${state.shingleType.type} · ${Math.round(state.shingleType.confidence)}%`}
                tone="info"
                size="sm"
              />
            ) : (
              !nonRoof && (
                <Pill label={`${ROOF_MATERIAL_LABELS[inspection.material]} (job)`} tone="neutral" size="sm" />
              )
            )}
          </View>
          {nonRoof && state?.subjectDetail ? (
            <Text style={styles.subjectDetail}>{state.subjectDetail}</Text>
          ) : null}
        </View>

        {/* Failed / analyzing / not-yet states, in words. */}
        {state?.status === 'failed' && (
          <View style={styles.notice}>
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.noticeText}>{state.error ?? 'Analysis failed.'}</Text>
          </View>
        )}
        {!analyzed && state?.status !== 'failed' && (
          <View style={styles.notice}>
            <Ionicons name="time-outline" size={18} color={colors.textMuted} />
            <Text style={styles.noticeTextQuiet}>
              {state?.status === 'analyzing' || state?.status === 'queued'
                ? 'This photo is still being analyzed — the report fills in when it finishes.'
                : 'This photo has not been analyzed yet.'}
            </Text>
          </View>
        )}

        {/* Roof photo: damage summary by category + the per-square read. */}
        {!nonRoof && analyzed && (
          <>
            <SectionHeader title="Damage in this photo" />
            {rows.length === 0 ? (
              <RichCard icon="checkmark-circle-outline" iconTone="green" title="No damage detected">
                <Text style={styles.cardSub}>
                  {manuallyReviewed ? 'The inspector review has no remaining damage markers in this frame.' : 'The model found no damage instances in this frame.'} If you can see damage, tap
                  Edit markers and add it — your correction trains the model.
                </Text>
              </RichCard>
            ) : (
              <View style={styles.rows}>
                {rows.map((r) => (
                  <View key={r.category} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{DAMAGE_CATEGORY_LABELS[r.category]}</Text>
                      <Text style={styles.rowSub}>
                        {r.count} instance{r.count === 1 ? '' : 's'} · {r.confidence}% confidence
                      </Text>
                    </View>
                    <Pill label={SEVERITY_LABELS[r.severity]} tone={SEVERITY_TONE[r.severity]} size="sm" />
                  </View>
                ))}
              </View>
            )}

            {/* The per-square read — only meaningful for a 10x10 test square.
                A single-shingle close-up is several bruises on ONE shingle, not
                hits in a square (HAAG §2), so it gets a different sentence. */}
            <RichCard
              icon="grid-outline"
              iconTone={isSquare && hailHere >= threshold.hitsPerTestSquare && threshold.hitsPerTestSquare > 0 ? 'orange' : 'blue'}
              title={isSquare ? 'Test square read' : 'Single-shingle close-up'}
            >
              <Text style={styles.cardSub}>
                {isSquare
                  ? threshold.hitsPerTestSquare > 0
                    ? `${hailHere} hail hit${hailHere === 1 ? '' : 's'} in this test square — ${
                        hailHere >= threshold.hitsPerTestSquare ? 'meets' : 'below'
                      } the ${ROOF_MATERIAL_LABELS[inspection.material]} threshold of ${threshold.hitsPerTestSquare} or more per 100 sq ft.`
                    : `${hailHere} hail hit${hailHere === 1 ? '' : 's'} in this test square. ${threshold.rule}`
                  : `${hailHere} hit${hailHere === 1 ? '' : 's'} on this shingle. Close-ups document individual bruises and mat fractures; they are not counted toward the per-square threshold.`}
              </Text>
              {isSquare && hailHere > 0 && threshold.hitsPerTestSquare > 0 && (
                <Text style={styles.cardFoot}>{carrierBarsRead(inspection.material, hailHere).line}</Text>
              )}
              {state?.squareCoverage && (
                <Text style={styles.cardFoot}>
                  {state.squareCoverage.visible ? 'Chalk square visible · ' : 'No chalk lines seen · '}
                  this frame documents {(state.squareCoverage.fraction * 100).toFixed(0)}% of one square
                  {' · '}{Math.round(state.squareCoverage.confidence)}% confidence
                </Text>
              )}
              {typeof state?.shingleCount === 'number' && (
                <Text style={styles.cardFoot}>
                  {state.shingleCount} whole shingle{state.shingleCount === 1 ? '' : 's'} visible in frame
                </Text>
              )}
              {evidenceLine && <Text style={styles.cardFoot}>{evidenceLine}</Text>}
              {scale?.pixelsPerInch != null && (
                <Text style={styles.cardFoot}>
                  Scale: {Math.round(scale.pixelsPerInch)} px/in from the {scale.reference ?? 'shingle geometry'} ·{' '}
                  {Math.round(scale.confidence)}% confidence
                </Text>
              )}
            </RichCard>
          </>
        )}

        {/* Non-roof photo: what it is and the collateral damage on it. */}
        {nonRoof && analyzed && (
          <>
            <SectionHeader title="Collateral evidence" />
            <RichCard
              icon="shield-checkmark-outline"
              iconTone="purple"
              title={PHOTO_SUBJECT_LABELS[subject]}
              subtitle={zone ? `Corroborates: ${COLLATERAL_ZONE_LABELS[zone]}` : 'Not a roof surface'}
            >
              <Text style={styles.cardSub}>
                Damage on a non-roof surface is HAAG corroboration of the hail's size, hardness and
                direction. It strengthens the claim — it is never counted as a roof hit.
              </Text>
            </RichCard>
            {(state?.collateralDamage ?? []).length === 0 ? (
              <RichCard icon="checkmark-circle-outline" iconTone="green" title="No damage identified">
                <Text style={styles.cardSub}>
                  The model saw {PHOTO_SUBJECT_LABELS[subject].toLowerCase()} with no visible storm damage.
                </Text>
              </RichCard>
            ) : (
              <View style={styles.rows}>
                {(state?.collateralDamage ?? []).map((c, i) => (
                  <View key={`${c.kind}-${i}`} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{COLLATERAL_DAMAGE_LABELS[c.kind]}</Text>
                      <Text style={styles.rowSub}>
                        {Math.round(c.confidence)}% confidence{c.note ? ` · ${c.note}` : ''}
                      </Text>
                    </View>
                    <Pill label={SEVERITY_LABELS[c.severity]} tone={SEVERITY_TONE[c.severity]} size="sm" />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Provenance — which model, how long. */}
        {state?.modelUsed && (
          <Text style={styles.provenance}>
            {manuallyReviewed ? 'Original AI analysis by ' : 'Analyzed by '}{state.modelUsed}
            {state.latencyMs != null ? ` in ${(state.latencyMs / 1000).toFixed(1)}s` : ''}
            {state.attempts && state.attempts > 1 ? ` · attempt ${state.attempts}` : ''}
          </Text>
        )}

        <SectionHeader title="Actions" />
        <View style={styles.actions}>
          <PressableScale
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel="Edit the markers on this photo"
            onPress={() =>
              router.push({
                pathname: '/edit-detection',
                params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(index),
                  attachmentId: slope.photoAttachmentIds?.[index], photoPath: uri },
              })
            }
          >
            <Ionicons name="create-outline" size={20} color={colors.text} />
            <Text style={styles.actionText}>Edit markers</Text>
          </PressableScale>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed, reanalyzing && styles.actionBusy]}
            disabled={reanalyzing}
            accessibilityRole="button"
            accessibilityLabel="Re-analyze this photo"
            onPress={reanalyze}
          >
            <Ionicons name="refresh-outline" size={20} color={colors.text} />
            <Text style={styles.actionText}>{reanalyzing ? 'Re-analyzing…' : 'Re-analyze'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  photoCard: {
    height: 340,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    ...shadows.raised,
  },
  photoFill: { flex: 1 },
  headline: { gap: spacing.sm },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headlineTitle: {
    flex: 1,
    fontFamily: fontFamily.archivo.bold,
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  subjectDetail: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  noticeText: { flex: 1, fontSize: fontSize.bodySm, color: colors.danger, lineHeight: 18 },
  noticeTextQuiet: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  rows: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },
  cardSub: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  cardFoot: { ...dataLabel, marginTop: spacing.xs, color: colors.textSubtle },
  provenance: { ...dataLabel, color: colors.textSubtle, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md },
  // 56pt actions for a gloved thumb (Drift #1).
  action: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  actionPressed: { opacity: 0.7 },
  actionBusy: { opacity: 0.5 },
  actionText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  emptyText: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
