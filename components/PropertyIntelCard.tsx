import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import type { Inspection, PropertyIntel } from '@/lib/models/types';
import {
  imageryPredatesLoss,
  isMeasured,
  measurementSummary,
  researchProperty,
  roofPlanes,
} from '@/lib/services/propertyIntel';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { RoofOverheadView } from '@/components/RoofOverheadView';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * What the app worked out about the property on its own — the roof's real size
 * and shape, measured from aerial imagery when the job was created.
 *
 * This is the card that makes the rest of the app's numbers legible: the HAAG
 * §5 repair cost, the estimate, and the proposal are all priced against the
 * squares shown here. If it says "not measured", those numbers are placeholders
 * and every one of those surfaces says so too.
 *
 * Failure is a first-class state with its reason printed verbatim. There is no
 * path through this component that shows a square footage it did not measure.
 */
type Props = {
  inspection: Inspection;
  /** Persist a fresh measurement (the store's `setPropertyIntel`). */
  onMeasured: (intel: PropertyIntel) => void;
};

const STATUS_TONE: Record<NonNullable<PropertyIntel['status']>, PillTone> = {
  measured: 'success',
  no_building: 'warn',
  unavailable: 'warn',
  no_location: 'neutral',
};

const STATUS_LABEL: Record<NonNullable<PropertyIntel['status']>, string> = {
  measured: 'Measured',
  no_building: 'No imagery',
  unavailable: 'Unavailable',
  no_location: 'No location',
};

export function PropertyIntelCard({ inspection, onMeasured }: Props) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const intel = inspection.propertyIntel;
  const measured = isMeasured(intel);

  const measure = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onMeasured(
        await researchProperty({
          address: inspection.address,
          lat: inspection.lat,
          lng: inspection.lng,
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  // PLANES, not raw imagery facets. The aerial data segments by pitch as well
  // as direction, so one physical slope arrives in pieces — on a real Plano
  // house the south slope came back as two facets two degrees apart that
  // straddled the S/SW boundary, and showing them raw reported that slope as
  // 2.9 squares instead of 6.9. `roofPlanes` merges them back.
  const planes = measured ? roofPlanes(intel) : [];

  const staleForLoss = imageryPredatesLoss(intel, inspection.dateOfLoss);

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.headerRow}>
        <View style={styles.eyebrowGroup}>
          <Ionicons
            name={measured ? 'home' : 'home-outline'}
            size={16}
            color={measured ? colors.success : colors.textMuted}
          />
          <Text style={styles.eyebrow}>Roof measurement</Text>
        </View>
        {intel ? (
          <Pill label={STATUS_LABEL[intel.status]} tone={STATUS_TONE[intel.status]} size="sm" />
        ) : (
          <Pill label="Not measured" tone="neutral" size="sm" />
        )}
      </View>

      {measured ? (
        <>
          <View style={styles.headlineRow}>
            <Text style={styles.squares}>{intel.totalSquares.toFixed(1)}</Text>
            <View style={styles.headlineMeta}>
              <Text style={styles.unit}>squares</Text>
              <Text style={styles.sub}>
                ~{Math.round(intel.totalSquares * 100).toLocaleString()} sq ft ·{' '}
                {planes.length} roof plane{planes.length === 1 ? '' : 's'}
              </Text>
            </View>
          </View>

          <View style={styles.facesRow}>
            {planes.slice(0, 4).map((p, i) => (
              <View key={`${p.orientation}-${i}`} style={styles.faceCell}>
                <Text style={styles.faceDir}>{p.orientation}</Text>
                <Text style={styles.faceSquares}>{p.squares.toFixed(1)}</Text>
                <Text style={styles.facePitch}>{p.pitchRatio}</Text>
              </View>
            ))}
          </View>

          {/* The property from above with the measured faces drawn on. */}
          <RoofOverheadView
            planes={intel.slopes}
            bounds={intel.bounds}
            center={intel.center}
            height={200}
            legend={false}
          />

          <Text style={styles.caption}>{measurementSummary(intel)}</Text>
          {staleForLoss && (
            <Text style={styles.caption}>
              Imagery predates the reported date of loss. The measurement still holds — a roof
              does not change size — but say so before an adjuster does.
            </Text>
          )}
        </>
      ) : (
        <>
          <Text style={styles.emptyHeadline}>Roof not measured</Text>
          <Text style={styles.caption}>{measurementSummary(intel)}</Text>
          <Text style={styles.caption}>
            Repair cost, the estimate, and the proposal are all priced per square — without a
            measurement they are placeholders.
          </Text>
        </>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={measure}
          disabled={busy}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          accessibilityRole="button"
          accessibilityLabel={measured ? 'Measure the roof again' : 'Measure this roof'}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.brand} />
          ) : (
            <Ionicons name="scan-outline" size={18} color={colors.brand} />
          )}
          <Text style={styles.actionText}>
            {busy ? 'Measuring…' : measured ? 'Measure again' : 'Measure this roof'}
          </Text>
        </Pressable>

        {measured && (
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? 'Hide every roof face' : 'Show every roof face'}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textMuted}
            />
            <Text style={[styles.actionText, styles.actionTextQuiet]}>
              {expanded ? 'Hide faces' : 'All faces'}
            </Text>
          </Pressable>
        )}
      </View>

      {expanded && measured && (
        <Animated.View
          entering={FadeInDown.duration(motion.enterMs)}
          exiting={FadeOutUp.duration(motion.sceneExitMs)}
          style={styles.details}
        >
          {planes
            .map((s, i) => (
              <View key={`${s.orientation}-${i}`} style={styles.detailRow}>
                <Text style={styles.detailDir}>{s.orientation}</Text>
                <Text style={styles.detailSquares}>{s.squares.toFixed(1)} sq</Text>
                <Text style={styles.detailPitch}>
                  {s.pitchRatio} · {Math.round(s.azimuthDegrees)}°
                  {s.faceCount > 1 ? ` · ${s.faceCount} facets` : ''}
                </Text>
              </View>
            ))}
          <Text style={styles.footnote}>
            Measured from aerial imagery, per roof face. Anything you enter by hand on a slope
            wins over this — you were on the roof.
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.raised,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrowGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  eyebrow: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headlineRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  squares: {
    fontSize: 52,
    lineHeight: 52,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  headlineMeta: { flex: 1, paddingBottom: 4, gap: 2 },
  unit: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  sub: { fontSize: fontSize.bodySm, color: colors.textSubtle },
  emptyHeadline: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.textMuted },
  // The four biggest elevations at a glance — what the inspector is about to walk.
  facesRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  faceCell: { flex: 1, gap: 1 },
  faceDir: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
  },
  faceSquares: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  facePitch: { fontSize: fontSize.caption, color: colors.textMuted },
  caption: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // >=56pt: a gloved thumb on a roof (Drift #1).
  action: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionPressed: { opacity: 0.6 },
  actionText: { fontSize: fontSize.bodyMd, color: colors.brand, fontWeight: fontWeight.semibold },
  actionTextQuiet: { color: colors.textMuted },
  details: { gap: spacing.sm, marginTop: -spacing.xs },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailDir: {
    width: 56,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  detailSquares: {
    width: 72,
    fontSize: fontSize.bodySm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailPitch: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted },
  footnote: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
  },
});
