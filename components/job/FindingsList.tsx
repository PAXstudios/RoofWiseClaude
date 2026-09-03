// Findings list — 1A's "coloured left accent bar + title + subcopy +
// confidence" pattern (docs/DESIGN_1A.md §6, the "04 Damage report" mock)
// applied to the job page's real findings.
//
// This is a RESKIN of `components/DamageDetailSection.tsx`'s markup, not a
// new aggregation: it reuses that module's own exported `summarizeInspection`
// pure function verbatim, so the counts, severities, confidences and slope
// chips are exactly what DamageDetailSection would have shown — only the
// card's paint changes. (`components/DamageDetailSection.tsx` sits outside
// this wave's ownership — `app/(tabs)/index.tsx`, `app/job/[id].tsx`,
// `components/job/*` — so the new look lives here instead of editing it.)

import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { IconChip } from '@/components/ui/IconChip';
import { summarizeInspection } from '@/components/DamageDetailSection';
import {
  DAMAGE_CATEGORY_LABELS,
  type Inspection,
  type Severity,
  type Slope,
} from '@/lib/models/types';
import { colors, dataLabel, fontFamily, fontSize, radii, spacing, touchTarget } from '@/theme/tokens';

/** Severity → colour, the same semantic tones the rest of the app reads a
 *  band from (colors.info / warn / danger) — the taxonomy's own mapping,
 *  not a new one invented for this card. */
const SEVERITY_ACCENT: Record<Severity, string> = {
  none: colors.textSubtle,
  minor: colors.info,
  moderate: colors.warn,
  severe: colors.danger,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  none: 'None',
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
};

export function FindingsList({ inspection }: { inspection: Inspection }) {
  const router = useRouter();
  const summary = summarizeInspection(inspection);

  const openPhoto = (slope: Slope, photoIndex: number) =>
    router.push({
      pathname: '/photo-report',
      params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(photoIndex) },
    });

  if (summary.totalPhotos === 0) {
    return (
      <View style={styles.empty}>
        <IconChip name="images-outline" tone="quiet" size="md" />
        <Text style={styles.emptyText}>No photos yet — capture the slopes to see findings here.</Text>
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
        <View key={c.category} style={[styles.card, { borderLeftColor: SEVERITY_ACCENT[c.severity] }]}>
          <View style={styles.cardHead}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{DAMAGE_CATEGORY_LABELS[c.category]}</Text>
              <Text style={styles.cardSub}>
                {c.count} instance{c.count === 1 ? '' : 's'} · {c.slopes.length} slope{c.slopes.length === 1 ? '' : 's'} ·{' '}
                {SEVERITY_LABEL[c.severity]}
              </Text>
            </View>
            <View style={styles.confidenceBlock}>
              <Text style={[styles.confidenceValue, { color: SEVERITY_ACCENT[c.severity] }]}>{c.confidence}%</Text>
              <Text style={[styles.confidenceLabel, dataLabel]}>Conf.</Text>
            </View>
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
        <View style={[styles.card, { borderLeftColor: colors.textSubtle }]}>
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
  // The 1A findings pattern: a coloured left accent bar reads the severity
  // before a word is read, same craft rule as the tile-ground/ink pairing.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderLeftWidth: 4,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardMain: { flex: 1, gap: 2 },
  cardTitle: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.bold, color: colors.text },
  cardSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  rowTitle: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.semibold, color: colors.text },
  confidenceBlock: { alignItems: 'flex-end', gap: 1 },
  confidenceValue: { fontSize: fontSize.titleSm, fontFamily: fontFamily.archivo.bold, fontVariant: ['tabular-nums'] },
  confidenceLabel: { color: colors.textSubtle },
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
  slopeChipDir: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.bold, color: colors.text },
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
