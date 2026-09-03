// The wait, made legible — what the Knock Planner is doing right now, how
// long is left, and every way out.
//
// The owner's report (2026-09-03): while the planner searched, "the user is
// currently unable to get out of the page without exiting the entire app".
// The engine no longer blocks the JS thread; this card's job is to make
// leaving OBVIOUS and safe. So, under the search animation: a time line
// from the run estimate ("About 40 s left · based on your last 3 runs"), a
// step list (done → tick and its seconds, running → spinner and the count so
// far, pending → hollow), the partial line as areas land, a 56pt row that
// says the run keeps working after you leave and the bell rings when it is
// done, a "Leave — I'll get a notification" button, and a quiet Cancel that
// asks for a second tap rather than opening anything modal. Nothing here
// ever traps the screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip } from '@/components/ui/IconChip';
import { SearchAnimation } from '@/components/knock/SearchAnimation';
import type { ActiveRun } from '@/lib/stores/knockFinderStore';
import { FINDER_STEPS, finderStepLabel, type FinderMode } from '@/lib/services/knockFinder';
import { estimateRemainingSeconds, remainingLabel, type RunHistoryEntry } from '@/lib/services/knockRunEstimate';
import { brand, colors, fontFamily, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

/** After this long the animation's caption says out loud that leaving is fine. */
const REASSURE_AFTER_S = 15;
/** A first tap on Cancel arms it for this long; a second tap inside it cancels. */
const CANCEL_ARM_MS = 4000;

type Props = {
  run: ActiveRun;
  runHistory: readonly RunHistoryEntry[];
  /** The dial's radius — for a run begun before runs carried one. */
  fallbackRadiusMiles: number;
  fallbackMode: FinderMode;
  onLeave: () => void;
  onCancel: () => void;
};

export function RunProgress({ run, runHistory, fallbackRadiusMiles, fallbackMode, onLeave, onCancel }: Props) {
  // The store's clock, not ours: the run may have begun before this mounted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const radiusMiles = run.radiusMiles ?? fallbackRadiusMiles;
  const mode = run.partial?.mode ?? fallbackMode;
  const elapsed = Math.max(0, Math.round((now - new Date(run.startedAt).getTime()) / 1000));
  const stepStartedMs = new Date(run.stepStartedAt ?? run.startedAt).getTime();
  const inStep = Number.isNaN(stepStartedMs) ? 0 : Math.max(0, Math.round((now - stepStartedMs) / 1000));
  const estimate = estimateRemainingSeconds(
    { step: run.step, startedAt: run.startedAt, stepStartedAt: run.stepStartedAt, stepSeconds: run.stepSeconds },
    runHistory,
    radiusMiles,
    new Date(now),
    run.partial?.areas.length,
  );
  const learnedFrom = runHistory.filter((h) => h.ok).length;
  const basis = estimate.basis === 'history' ? `based on your last ${learnedFrom} run${learnedFrom === 1 ? '' : 's'}` : 'first run, a guess';
  const fraction = Math.min(0.97, Math.max(0.03, elapsed / Math.max(1, elapsed + estimate.seconds)));

  const stepIdx = FINDER_STEPS.findIndex((s) => s.id === run.step);
  const stepLabel = finderStepLabel(run.step, radiusMiles, mode);
  const top = run.partial?.areas[0];

  // Cancel: two taps, no modal. The first arms it; a second inside four
  // seconds cancels; otherwise it disarms on its own.
  const [armed, setArmed] = useState(false);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (disarm.current) clearTimeout(disarm.current);
    },
    [],
  );
  const cancelPress = useCallback(() => {
    if (armed) {
      if (disarm.current) clearTimeout(disarm.current);
      setArmed(false);
      onCancel();
      return;
    }
    setArmed(true);
    disarm.current = setTimeout(() => setArmed(false), CANCEL_ARM_MS);
  }, [armed, onCancel]);

  return (
    <View testID="run-progress">
      <RichCard padded={false}>
      <SearchAnimation caption={elapsed >= REASSURE_AFTER_S ? `${stepLabel} · ${elapsed}s — still working; leaving is safe` : stepLabel} />

      <View style={styles.body}>
        {/* Time left, and where the number comes from. */}
        <View style={styles.timeBlock} accessibilityLiveRegion="polite">
          <Text style={styles.eta} testID="run-eta">
            {remainingLabel(estimate)}
            <Text style={styles.etaBasis}> · {basis}</Text>
          </Text>
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
            <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
          </View>
          <Text style={styles.elapsed}>
            {elapsed}s so far · about {estimate.totalSeconds}s for {radiusMiles} mi
          </Text>
        </View>

        {/* Every step, with what it took or how long it has been going. */}
        <View style={styles.steps}>
          {FINDER_STEPS.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            const took = run.stepSeconds?.[s.id];
            return (
              <View key={s.id} style={styles.stepRow}>
                {done ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.brand} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={colors.textSubtle} />
                )}
                <Text style={[styles.stepText, done && styles.stepDone, active && styles.stepActive]} numberOfLines={2}>
                  {finderStepLabel(s.id, radiusMiles, mode)}
                </Text>
                <Text style={[styles.stepTime, active && styles.stepTimeActive]}>{done && took != null ? `${Math.round(took)} s` : active ? `${inStep} s` : ''}</Text>
              </View>
            );
          })}
        </View>

        {run.partial ? (
          <Text style={styles.partial} testID="run-partial">
            {run.partial.areas.length} area{run.partial.areas.length === 1 ? '' : 's'} ranked so far
            {top ? ` — best: ${top.name ?? top.storm.town ?? 'area'} (Knock ${top.knockScore})` : ''}. The plan page opens the moment it is saved.
          </Text>
        ) : null}

        {/* The way out — said plainly, then offered as a button. */}
        <View style={styles.background} accessible accessibilityLabel="This keeps working in the background. Leave the screen, use another tool, and the bell rings when the plan is ready.">
          <IconChip name="notifications-outline" tone="orange" size="md" />
          <View style={styles.backgroundText}>
            <Text style={styles.backgroundTitle}>Keeps working in the background</Text>
            <Text style={styles.backgroundBody}>Leave this screen or open another tool — the run carries on, and the bell rings the moment the plan is ready.</Text>
          </View>
        </View>

        <PressableScale style={styles.leaveBtn} onPress={onLeave} accessibilityRole="button" accessibilityLabel="Leave this screen — you will get a notification when the plan is ready" testID="run-leave">
          <Ionicons name="exit-outline" size={22} color={brand.royalDeep} />
          <Text style={styles.leaveText}>Leave — I'll get a notification</Text>
        </PressableScale>

        <PressableScale
          style={[styles.cancelBtn, armed && styles.cancelBtnArmed]}
          onPress={cancelPress}
          accessibilityRole="button"
          accessibilityLabel={armed ? 'Tap again to cancel the run' : 'Cancel this run'}
          testID="run-cancel"
        >
          <Ionicons name={armed ? 'close-circle' : 'close-circle-outline'} size={20} color={armed ? colors.danger : colors.textMuted} />
          <Text style={[styles.cancelText, armed && styles.cancelTextArmed]}>{armed ? 'Tap again to cancel — nothing is saved' : 'Cancel run'}</Text>
        </PressableScale>
      </View>
      </RichCard>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg, padding: spacing.lg },
  timeBlock: { gap: spacing.sm },
  eta: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.text },
  etaBasis: { fontFamily: fontFamily.archivo.medium, fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium, color: colors.textMuted },
  bar: { height: 8, borderRadius: radii.pill, backgroundColor: colors.fillQuiet, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.brand },
  elapsed: { fontFamily: fontFamily.mono, fontSize: fontSize.bodySm, color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  steps: { gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  stepText: { flex: 1, fontFamily: fontFamily.archivo.medium, fontSize: fontSize.bodyMd, color: colors.textSubtle, lineHeight: 20 },
  stepDone: { color: colors.textMuted },
  stepActive: { color: colors.text, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold },
  stepTime: { minWidth: 40, textAlign: 'right', fontFamily: fontFamily.mono, fontSize: fontSize.bodySm, color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  stepTimeActive: { color: colors.text, fontWeight: fontWeight.semibold },
  partial: { fontFamily: fontFamily.archivo.medium, fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  background: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
  },
  backgroundText: { flex: 1, gap: 2 },
  backgroundTitle: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.text },
  backgroundBody: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.lg,
  },
  leaveText: { flexShrink: 1, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: brand.royalDeep },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
  },
  cancelBtnArmed: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  cancelText: { flexShrink: 1, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textMuted },
  cancelTextArmed: { color: colors.danger },
});
