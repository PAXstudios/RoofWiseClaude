// The whole inspection's damage, readable on the phone — no PDF needed.
//
// Owner: "I sent screenshots showing that you're able to see damage details
// without having to download the report. I want that in each job/inspection.
// It should be comprehensive."
//
// One card per damage category found anywhere on the roof, worst-first, with
// the count, worst severity, mean confidence, and which slopes carry it. Each
// slope chip opens the first photo on that slope that shows the category —
// the per-photo report — so the path from "the roof has 62 hail hits" to
// "here is the photo with the hit" is two taps. Non-roof (collateral) photos
// get their own block, because they corroborate the storm and never count as
// roof hits (Drift #7). Everything here is the inspection's real data; an
// inspection with no analyzed photo says so instead of showing zeros.

import { readPhotoAnalysis } from '@/lib/services/photoAnalysisState';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { IconChip } from '@/components/ui/IconChip';
import {
  COLLATERAL_DAMAGE_LABELS,
  DAMAGE_CATEGORY_LABELS,
  PHOTO_SUBJECT_LABELS,
  SEVERITY_LABELS,
  type DamageCategory,
  type Inspection,
  type Severity,
  type Slope,
} from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

const SEVERITY_TONE: Record<Severity, PillTone> = {
  none: 'neutral',
  minor: 'info',
  moderate: 'warn',
  severe: 'danger',
};
const SEVERITY_RANK: Record<Severity, number> = { none: 0, minor: 1, moderate: 2, severe: 3 };

type SlopeHit = { slope: Slope; count: number; firstPhotoIndex: number };

type CategoryDetail = {
  category: DamageCategory;
  count: number;
  severity: Severity;
  confidence: number;
  slopes: SlopeHit[];
};

type CollateralPhoto = {
  slope: Slope;
  photoIndex: number;
  subject: string;
  detail?: string;
  damage: string[];
};

/** Aggregate every marker on every slope by category. Pure. */
export function summarizeInspection(inspection: Inspection): {
  categories: CategoryDetail[];
  collateral: CollateralPhoto[];
  analyzedPhotos: number;
  totalPhotos: number;
} {
  const cats = new Map<
    DamageCategory,
    { count: number; severity: Severity; conf: number; slopes: Map<string, SlopeHit> }
  >();
  const collateral: CollateralPhoto[] = [];
  let analyzedPhotos = 0;
  let totalPhotos = 0;

  for (const slope of inspection.slopes) {
    totalPhotos += slope.photoPaths.length;
    // Analyzed = explicit done state, or the legacy analyzed-index list.
    const legacy = new Set(slope.analyzedPhotoIndices ?? []);
    slope.photoPaths.forEach((uri, i) => {
      const st = readPhotoAnalysis(slope, i);
      if (st?.status === 'done' || (!st && legacy.has(i))) analyzedPhotos += 1;
      if (st?.status === 'done' && st.noRoofDetected && st.subject && st.subject !== 'roof_field') {
        collateral.push({
          slope,
          photoIndex: i,
          subject: PHOTO_SUBJECT_LABELS[st.subject],
          detail: st.subjectDetail,
          damage: (st.collateralDamage ?? []).map(
            (c) => `${COLLATERAL_DAMAGE_LABELS[c.kind]} (${SEVERITY_LABELS[c.severity].toLowerCase()})`,
          ),
        });
      }
    });

    for (const m of slope.damage) {
      const cur = cats.get(m.category) ?? {
        count: 0,
        severity: 'none' as Severity,
        conf: 0,
        slopes: new Map<string, SlopeHit>(),
      };
      cur.count += 1;
      cur.conf += m.confidence;
      if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[cur.severity]) cur.severity = m.severity;
      const sh = cur.slopes.get(slope.id) ?? { slope, count: 0, firstPhotoIndex: m.photoIndex ?? 0 };
      sh.count += 1;
      if (m.photoIndex != null && m.photoIndex < sh.firstPhotoIndex) sh.firstPhotoIndex = m.photoIndex;
      cur.slopes.set(slope.id, sh);
      cats.set(m.category, cur);
    }
  }

  const categories = [...cats.entries()]
    .map(([category, v]) => ({
      category,
      count: v.count,
      severity: v.severity,
      confidence: Math.round(v.conf / v.count),
      slopes: [...v.slopes.values()].sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);

  return { categories, collateral, analyzedPhotos, totalPhotos };
}

export function DamageDetailSection({ inspection }: { inspection: Inspection }) {
  const router = useRouter();
  const summary = useMemo(() => summarizeInspection(inspection), [inspection]);

  const openPhoto = (slope: Slope, photoIndex: number) =>
    router.push({
      pathname: '/photo-report',
      params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(photoIndex) },
    });

  if (summary.totalPhotos === 0) {
    return (
      <View style={styles.empty}>
        <IconChip name="images-outline" tone="quiet" size="md" />
        <Text style={styles.emptyText}>No photos yet — capture the slopes to see damage detail here.</Text>
      </View>
    );
  }
  if (summary.analyzedPhotos === 0) {
    return (
      <View style={styles.empty}>
        <IconChip name="hourglass-outline" tone="quiet" size="md" />
        <Text style={styles.emptyText}>
          {summary.totalPhotos} photo{summary.totalPhotos === 1 ? '' : 's'} captured, none analyzed yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.coverage}>
        {summary.analyzedPhotos} of {summary.totalPhotos} photo{summary.totalPhotos === 1 ? '' : 's'} analyzed
        {summary.categories.length === 0 ? ' · no damage detected' : ''}
      </Text>

      {summary.categories.map((c) => (
        <View key={c.category} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{DAMAGE_CATEGORY_LABELS[c.category]}</Text>
              <Text style={styles.cardSub}>
                {c.count} instance{c.count === 1 ? '' : 's'} · {c.confidence}% avg confidence ·{' '}
                {c.slopes.length} slope{c.slopes.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Pill label={SEVERITY_LABELS[c.severity]} tone={SEVERITY_TONE[c.severity]} size="sm" />
          </View>
          {/* Per-slope chips: which side, how many, tap → the photo. */}
          <View style={styles.slopeRow}>
            {c.slopes.map((sh) => (
              <PressableScale
                key={sh.slope.id}
                style={styles.slopeChip}
                accessibilityRole="button"
                accessibilityLabel={`${sh.slope.orientation} slope, ${sh.count} ${DAMAGE_CATEGORY_LABELS[c.category]}. Open photo.`}
                onPress={() => openPhoto(sh.slope, sh.firstPhotoIndex)}
              >
                <Text style={styles.slopeChipDir}>{sh.slope.orientation}</Text>
                <Text style={styles.slopeChipCount}>×{sh.count}</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSubtle} />
              </PressableScale>
            ))}
          </View>
        </View>
      ))}

      {summary.collateral.length > 0 && (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>Collateral evidence</Text>
              <Text style={styles.cardSub}>
                {summary.collateral.length} non-roof photo{summary.collateral.length === 1 ? '' : 's'} — corroborates the
                storm, never counted as roof hits
              </Text>
            </View>
          </View>
          {summary.collateral.map((c) => (
            <PressableScale
              key={`${c.slope.id}-${c.photoIndex}`}
              style={styles.collateralRow}
              accessibilityRole="button"
              accessibilityLabel={`${c.subject}. Open photo.`}
              onPress={() => openPhoto(c.slope, c.photoIndex)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.rowTitle}>{c.subject}</Text>
                <Text style={styles.cardSub} numberOfLines={2}>
                  {c.damage.length > 0 ? c.damage.join(' · ') : 'No damage identified'}
                  {c.detail ? ` — ${c.detail}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  coverage: { fontSize: fontSize.bodySm, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  cardSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  slopeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 56pt chips — a gloved thumb opens the photo (Drift #1).
  slopeChip: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  slopeChipDir: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.text },
  slopeChipCount: { fontSize: fontSize.bodySm, color: colors.textMuted },
  collateralRow: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
  },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyText: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
