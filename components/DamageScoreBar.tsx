import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  claimWorthiness,
  type ClaimViabilityBand,
  type ClaimWorthiness,
  type DecisionEngineResult,
} from '@/lib/services/decisionEngine';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  spacing,
} from '@/theme/tokens';

/**
 * Claim viability, as a BAND.
 *
 * This component used to render the deprecated 0–100 "damage score". That
 * number is not part of the HAAG spec — its weights were never in any source
 * document — and the claimability protocol is deliberately qualitative
 * (docs/HAAG_DECISION_ENGINE.md §6: HIGH / MEDIUM / LOW). A precise-looking
 * "68 of 100" invites a roofer to argue a number with an adjuster that no
 * standard backs; a band says exactly what the engine is willing to stand on.
 *
 * Pass `band` — the engine's `claim_viability`. The `score` prop is kept for
 * call sites that still hold the deprecated number and is mapped to a band
 * through the engine's own `claimWorthiness()` (see below), never through
 * thresholds restated here.
 */
type Props = {
  /** The §6 claim-viability band from the decision engine. Preferred. */
  band?: ClaimViabilityBand;
  /**
   * @deprecated Deprecated 0–100 damage score. Mapped to a band for display.
   * Pass `band` instead — see `decisionEngine.damageScore()`'s deprecation note.
   */
  score?: number;
};

const BAND_LABEL: Record<ClaimViabilityBand, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** Ordinal position on the LOW → MEDIUM → HIGH scale (fills the meter). */
const BAND_RANK: Record<ClaimViabilityBand, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

const BAND_TONE: Record<ClaimViabilityBand, { fg: string; soft: string }> = {
  HIGH: { fg: colors.success, soft: colors.successSoft },
  MEDIUM: { fg: colors.warn, soft: colors.warnSoft },
  LOW: { fg: colors.danger, soft: colors.dangerSoft },
};

/** Short, plain-language meaning — mirrors the Long Report's §6 wording. */
const BAND_CAPTION: Record<ClaimViabilityBand, string> = {
  HIGH: 'Damage, storm corroboration, and policy posture support approval.',
  MEDIUM: 'Supportable, but a carrier has room to contest it.',
  LOW: 'As documented, this does not support a claim.',
};

/**
 * `claimWorthiness()` reads exactly two things: the roof recommendation and
 * the number. Passing a recommendation-neutral probe means only its NUMERIC
 * branch can fire, so the deprecated score is banded by the engine's own
 * boundaries instead of boundaries copied into this file.
 */
const NUMERIC_PROBE = {
  perSlope: [],
  roofRecommendation: 'repair',
  roofVerdictReasoning: '',
  verifyWithInspector: false,
} as unknown as DecisionEngineResult;

const WORTHINESS_TO_BAND: Record<ClaimWorthiness, ClaimViabilityBand> = {
  urgent: 'HIGH',
  claimable: 'HIGH',
  borderline: 'MEDIUM',
  not_claimable: 'LOW',
};

/**
 * Deprecated 0–100 score → §6 band, via the engine's `claimWorthiness()`.
 *
 * A bare number tops out at MEDIUM by construction: HIGH viability requires
 * weather corroboration and threshold findings the score knows nothing about,
 * so this path never asserts a strong claim on a number alone.
 */
export function bandFromDeprecatedScore(score: number): ClaimViabilityBand {
  const clamped = Math.max(0, Math.min(100, score));
  return WORTHINESS_TO_BAND[claimWorthiness(NUMERIC_PROBE, clamped)];
}

export function DamageScoreBar({ band, score }: Props) {
  const resolved: ClaimViabilityBand | null =
    band ?? (typeof score === 'number' ? bandFromDeprecatedScore(score) : null);

  // Nothing evaluated yet reads as "not assessed" — never as a zero band
  // (Drift #5: an absent determination is stated, never synthesized).
  const tone = resolved
    ? BAND_TONE[resolved]
    : { fg: colors.textMuted, soft: colors.fillQuiet };
  const rank = resolved ? BAND_RANK[resolved] : 0;
  const label = resolved ? BAND_LABEL[resolved] : 'Not assessed';
  const caption = resolved
    ? BAND_CAPTION[resolved]
    : 'Analyze the slopes to get a claim-viability band.';

  // The track springs up to the band's rank — the analysis payoff moment.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(rank, motion.snappy);
  }, [rank, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${(Math.min(3, Math.max(0, progress.value)) / 3) * 100}%`,
  }));

  return (
    <View
      style={styles.wrap}
      accessibilityRole="summary"
      accessibilityLabel={`Claim viability ${label}. ${caption}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.label}>Claim viability</Text>
        <View style={[styles.badge, { backgroundColor: tone.soft }]}>
          <Text style={[styles.badgeText, { color: tone.fg }]}>{label}</Text>
        </View>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: tone.fg }, fillStyle]} />
      </View>

      <View style={styles.legendRow}>
        <Text style={[styles.legend, styles.legendStart]}>Low</Text>
        <Text style={[styles.legend, styles.legendMid]}>Medium</Text>
        <Text style={[styles.legend, styles.legendEnd]}>High</Text>
      </View>

      <Text style={styles.caption}>{caption}</Text>
      <Text style={styles.footnote}>
        {band === undefined && typeof score === 'number'
          ? 'HAAG §6 band, estimated from the legacy damage score.'
          : 'HAAG §6 band — viability is a band, not a score.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // iOS-style band badge: semantic soft ground + semantic text, never a blob.
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
  },
  // Thin iOS progress track; the fill springs to the band's rank on mount.
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: radii.pill },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legend: { flex: 1, fontSize: fontSize.caption, color: colors.textSubtle },
  legendStart: { textAlign: 'left' },
  legendMid: { textAlign: 'center' },
  legendEnd: { textAlign: 'right' },
  caption: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  footnote: { fontSize: fontSize.caption, color: colors.textSubtle },
});
