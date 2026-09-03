import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import {
  DAMAGE_BAND_RANGES,
  type DamageBand,
  type DamageScoreResult,
  type ScoreConfidence,
} from '@/lib/services/damageScore';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { IoniconName } from '@/components/ui/IconChip';
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
 * The RoofWise Damage Score — 0–100, where 100 is a sound roof and 0 is the
 * worst. Methodology: docs/DAMAGE_SCORE.md, derived from the HAAG decision
 * engine so the number can never disagree with the verdict.
 *
 * THE RULE THIS COMPONENT EXISTS TO ENFORCE: the number NEVER renders without
 * its band label. A bare "45" invites a roofer to argue a figure an adjuster
 * has no context for; "45 — Compromised, partial replacement" says what the
 * engine will stand on. The two are laid out as one unit and there is no prop
 * that separates them.
 *
 * Tap to expand the deduction list. Every point removed cites the HAAG rule
 * that removed it, because a carrier rejects a black-box number.
 *
 * This is NOT the §6 claim-viability band — that is `DamageScoreBar`. Two
 * different determinations: condition severity here, claimability there.
 */
type Props = {
  result: DamageScoreResult;
  /** Start with the deduction breakdown open (report surfaces). Default false. */
  defaultExpanded?: boolean;
};

const BAND_TONE: Record<DamageBand, { fg: string; soft: string; pill: PillTone; icon: IoniconName }> = {
  sound: { fg: colors.success, soft: colors.successSoft, pill: 'success', icon: 'shield-checkmark' },
  serviceable: { fg: colors.info, soft: colors.infoSoft, pill: 'info', icon: 'construct' },
  compromised: { fg: colors.warn, soft: colors.warnSoft, pill: 'warn', icon: 'alert-circle' },
  failed: { fg: colors.danger, soft: colors.dangerSoft, pill: 'danger', icon: 'close-circle' },
};

const CONFIDENCE_TONE: Record<ScoreConfidence, PillTone> = {
  high: 'success',
  moderate: 'warn',
  low: 'danger',
};

const CONFIDENCE_LABEL: Record<ScoreConfidence, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  low: 'Low confidence',
};

/** Left→right worst→best, so the scale reads the way the number does. */
const BAND_ORDER: DamageBand[] = ['failed', 'compromised', 'serviceable', 'sound'];

export function DamageScoreCard({ result, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Nothing documented reads as "not assessed" — never as a score of 100
  // (Drift #5: an absent determination is stated, never synthesized).
  if (!result.assessed) {
    return (
      <View style={styles.card} accessibilityRole="summary">
        <View style={styles.headerRow}>
          <View style={styles.eyebrowGroup}>
            <Ionicons name="help-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.eyebrow}>Damage score</Text>
          </View>
          <Pill label="Not assessed" tone="neutral" size="sm" />
        </View>
        <Text style={styles.emptyHeadline}>Not assessed</Text>
        <Text style={styles.caption}>{result.reason}</Text>
      </View>
    );
  }

  const tone = BAND_TONE[result.band];
  const detailCount = result.deductions.length + result.missing.length + result.notes.length;

  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`Damage score ${result.score} of 100. ${result.bandLabel}. ${result.bandCaption} ${CONFIDENCE_LABEL[result.confidence]}.`}
    >
      <View style={styles.headerRow}>
        <View style={styles.eyebrowGroup}>
          <Ionicons name={tone.icon} size={16} color={tone.fg} />
          <Text style={styles.eyebrow}>Damage score</Text>
        </View>
        <Pill label={CONFIDENCE_LABEL[result.confidence]} tone={CONFIDENCE_TONE[result.confidence]} size="sm" />
      </View>

      {/* The number and its band label are ONE block — never separable. */}
      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color: tone.fg }]}>{result.score}</Text>
        <View style={styles.scoreMeta}>
          <Text style={styles.outOf}>of 100</Text>
          <Text style={[styles.bandLabel, { color: tone.fg }]} numberOfLines={2}>
            {result.bandLabel}
          </Text>
        </View>
      </View>

      {/* Four-zone scale: worst on the left, sound on the right, marker at the
          score. Shows WHERE in the band the number sits, which is the whole
          point of the within-band severity math. */}
      <View style={styles.scale}>
        {BAND_ORDER.map((b) => {
          const [lo, hi] = DAMAGE_BAND_RANGES[b];
          const active = b === result.band;
          const width = hi - lo + 1;
          return (
            <View key={b} style={[styles.zone, { flex: width }]}>
              <View
                style={[
                  styles.zoneTrack,
                  { backgroundColor: active ? BAND_TONE[b].fg : BAND_TONE[b].soft },
                ]}
              />
            </View>
          );
        })}
        <View style={[styles.marker, { left: `${result.score}%`, borderColor: tone.fg }]} />
      </View>
      <View style={styles.scaleLegend}>
        <Text style={styles.legend}>0 — worst</Text>
        <Text style={[styles.legend, styles.legendEnd]}>100 — sound</Text>
      </View>

      <Text style={styles.caption}>{result.bandCaption}</Text>

      {detailCount > 0 && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => [styles.discloseRow, pressed && styles.discloseRowPressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? 'Hide how this score was calculated' : 'Show how this score was calculated'}
          hitSlop={8}
        >
          <Text style={styles.discloseText}>
            {expanded ? 'Hide the breakdown' : 'How this score was calculated'}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textMuted}
          />
        </Pressable>
      )}

      {expanded && (
        // Reanimated entrance, matching the house rhythm (motion.enterMs).
        // Deliberately NOT LayoutAnimation: that is a Paper-era API and the
        // New Architecture is on (Drift: newArchEnabled stays true).
        <Animated.View
          entering={FadeInDown.duration(motion.enterMs)}
          exiting={FadeOutUp.duration(motion.sceneExitMs)}
          style={styles.details}
        >
          {result.deductions.length > 0 ? (
            <>
              <Text style={styles.detailHeading}>Points removed from 100</Text>
              {result.deductions.map((d, i) => (
                <View key={`${d.rule}-${i}`} style={styles.deductionRow}>
                  <Text style={[styles.deductionPoints, { color: tone.fg }]}>−{d.points}</Text>
                  <View style={styles.deductionBody}>
                    <Text style={styles.deductionRule}>HAAG {d.rule}</Text>
                    <Text style={styles.deductionReason}>{d.reason}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : (
            <Text style={styles.detailHeading}>
              No points removed — no qualifying storm damage was documented.
            </Text>
          )}

          {result.missing.length > 0 && (
            <View style={styles.subsection}>
              <Text style={styles.detailHeading}>What would raise the confidence</Text>
              {result.missing.map((m) => (
                <View key={m} style={styles.bulletRow}>
                  <Ionicons name="ellipse-outline" size={10} color={colors.textSubtle} style={styles.bullet} />
                  <Text style={styles.bulletText}>{m}</Text>
                </View>
              ))}
            </View>
          )}

          {result.notes.length > 0 && (
            <View style={styles.subsection}>
              <Text style={styles.detailHeading}>Context — recorded, not scored</Text>
              {result.notes.map((n) => (
                <View key={n} style={styles.bulletRow}>
                  <Ionicons name="information-circle-outline" size={12} color={colors.textSubtle} style={styles.bullet} />
                  <Text style={styles.bulletText}>{n}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.footnote}>
            Derived from the HAAG decision-engine result — the score cannot disagree with the
            recommendation. Methodology: docs/DAMAGE_SCORE.md.
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
  // The number carries the weight; the band label sits against it so the two
  // are read as one statement.
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  score: {
    fontSize: 64,
    lineHeight: 64,
    fontWeight: fontWeight.bold,
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  scoreMeta: { flex: 1, paddingBottom: 4, gap: 2 },
  outOf: { fontSize: fontSize.bodySm, color: colors.textSubtle },
  bandLabel: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, lineHeight: 21 },
  scale: { flexDirection: 'row', gap: 3, height: 10, alignItems: 'center' },
  zone: { justifyContent: 'center' },
  zoneTrack: { height: 8, borderRadius: radii.pill },
  // Sits on the 0–100 axis, so `left` is literally the score.
  marker: {
    position: 'absolute',
    top: -2,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: radii.pill,
    borderWidth: 3,
    backgroundColor: colors.surface,
  },
  scaleLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.sm },
  legend: { fontSize: fontSize.caption, color: colors.textSubtle },
  legendEnd: { textAlign: 'right' },
  caption: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  emptyHeadline: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.textMuted },
  // >=56pt: a gloved thumb has to hit this on a roof (Drift #1).
  discloseRow: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    marginTop: -spacing.xs,
  },
  discloseRowPressed: { opacity: 0.6 },
  discloseText: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.semibold },
  details: { gap: spacing.md, marginTop: -spacing.xs },
  detailHeading: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deductionRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  deductionPoints: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  deductionBody: { flex: 1, gap: 2 },
  deductionRule: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
  },
  deductionReason: { fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  subsection: { gap: spacing.sm },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bullet: { marginTop: 4 },
  bulletText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  footnote: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.sm,
  },
});
