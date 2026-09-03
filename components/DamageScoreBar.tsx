import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type ClaimViabilityBand } from '@/lib/services/decisionEngine';
import { ProgressBar, type ProgressTone } from '@/components/ui/ProgressBar';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { IoniconName } from '@/components/ui/IconChip';
import {
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

/**
 * Claim viability, as a BAND — rendered as the screen's authoritative verdict
 * block: a big band word, a semantic-toned progress track, and (optionally)
 * the evidence counts that back it up.
 *
 * This component used to render the deprecated 0–100 "damage score". That
 * number is not part of the HAAG spec — its weights were never in any source
 * document — and the claimability protocol is deliberately qualitative
 * (docs/HAAG_DECISION_ENGINE.md §6: HIGH / MEDIUM / LOW). A precise-looking
 * "68 of 100" invites a roofer to argue a number with an adjuster that no
 * standard backs; a band says exactly what the engine is willing to stand on.
 *
 * Pass `band` — the engine's `claim_viability`. `stats` is a purely
 * presentational, optional addendum — pre-formatted counts (slopes, photos,
 * findings…) that give the verdict evidentiary weight without this component
 * knowing what they mean.
 *
 * Condition SEVERITY is a different determination and a different component:
 * `DamageScoreCard` renders the 0–100 RoofWise Damage Score
 * (docs/DAMAGE_SCORE.md). Claimability is a band; severity is a score.
 */
type Props = {
  /** The §6 claim-viability band from the decision engine. */
  band?: ClaimViabilityBand;
  /**
   * Supporting evidence counts — e.g. slopes evaluated, photos captured,
   * findings documented. Pre-formatted by the caller and rendered in tabular
   * figures under the verdict. Omit entirely when there is nothing real to
   * show (Drift #5: never invent a count).
   */
  stats?: { label: string; value: string }[];
};

const BAND_LABEL: Record<ClaimViabilityBand, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** Ordinal position on the LOW → MEDIUM → HIGH scale (fills the meter). */
const BAND_RANK: Record<ClaimViabilityBand, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Short, plain-language meaning — mirrors the Long Report's §6 wording. */
const BAND_CAPTION: Record<ClaimViabilityBand, string> = {
  HIGH: 'Damage, storm corroboration, and policy posture support approval.',
  MEDIUM: 'Supportable, but a carrier has room to contest it.',
  LOW: 'As documented, this does not support a claim.',
};

const BAND_TONE: Record<
  ClaimViabilityBand,
  { fg: string; pill: PillTone; progress: ProgressTone; icon: IoniconName }
> = {
  HIGH: { fg: colors.success, pill: 'success', progress: 'success', icon: 'shield-checkmark' },
  MEDIUM: { fg: colors.warn, pill: 'warn', progress: 'warn', icon: 'alert-circle' },
  LOW: { fg: colors.danger, pill: 'danger', progress: 'danger', icon: 'close-circle' },
};

const UNASSESSED_TONE = {
  fg: colors.textMuted,
  pill: 'neutral' as PillTone,
  progress: 'quiet' as ProgressTone,
  icon: 'help-circle-outline' as IoniconName,
};

export function DamageScoreBar({ band, stats }: Props) {
  const resolved: ClaimViabilityBand | null = band ?? null;

  // Nothing evaluated yet reads as "not assessed" — never as a zero band
  // (Drift #5: an absent determination is stated, never synthesized).
  const tone = resolved ? BAND_TONE[resolved] : UNASSESSED_TONE;
  const rank = resolved ? BAND_RANK[resolved] : 0;
  const label = resolved ? BAND_LABEL[resolved] : 'Not assessed';
  const caption = resolved
    ? BAND_CAPTION[resolved]
    : 'Analyze the slopes to get a claim-viability band.';

  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`Claim viability ${label}. ${caption}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.eyebrowGroup}>
          <Ionicons name={tone.icon} size={16} color={tone.fg} />
          <Text style={styles.eyebrow}>Claim viability</Text>
        </View>
        <Pill label={label} tone={tone.pill} solid size="sm" />
      </View>

      <Text style={[styles.headline, { color: tone.fg }]}>{label}</Text>

      <ProgressBar
        progress={rank / 3}
        tone={tone.progress}
        height={10}
        style={styles.track}
        accessibilityLabel={`Claim viability ${label} of Low, Medium, High`}
      />

      <View style={styles.legendRow}>
        <Text style={[styles.legend, styles.legendStart]}>Low</Text>
        <Text style={[styles.legend, styles.legendMid]}>Medium</Text>
        <Text style={[styles.legend, styles.legendEnd]}>High</Text>
      </View>

      <Text style={styles.caption}>{caption}</Text>

      {stats && stats.length > 0 && (
        <View style={styles.statsRow}>
          {stats.map((s) => (
            <View key={s.label} style={styles.statCell}>
              <Text style={styles.statValue} numberOfLines={1}>
                {s.value}
              </Text>
              <Text style={styles.statLabel} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.footnote}>HAAG §6 band — viability is a band, not a score.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The authoritative verdict block — a document a carrier respects, so it
  // carries the `raised` rung rather than a flat cell.
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
  // "CLAIM VIABILITY" — the mock's small-caps eyebrow (§3).
  eyebrow: { ...dataLabel, color: colors.textSubtle, letterSpacing: 0.6 },
  // The big band word — the typographic contrast the design calls for: a
  // huge, confident label carrying the semantic colour, not a plain number.
  headline: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.extrabold,
    letterSpacing: -1,
  },
  track: { marginTop: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legend: { flex: 1, ...dataLabel, fontWeight: fontWeight.medium, color: colors.textSubtle, letterSpacing: 0.4 },
  legendStart: { textAlign: 'left' },
  legendMid: { textAlign: 'center' },
  legendEnd: { textAlign: 'right' },
  caption: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    lineHeight: 18,
  },
  // Supporting counts — the evidence behind the verdict, tabular so the
  // figures line up the way a carrier's own exhibits would.
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
  },
  statCell: { flex: 1, gap: 2 },
  statValue: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // "SLOPES" / "PHOTOS" / "FINDINGS" — the mock's stat-label convention (§3).
  statLabel: { ...dataLabel, color: colors.textSubtle, letterSpacing: 0.4 },
  footnote: { fontSize: fontSize.caption, fontFamily: fontFamily.archivo.regular, color: colors.textSubtle },
});
