// The coach drawer — guided capture as a bottom drawer with three detents,
// anchored ABOVE the shutter dock so the shutter is never covered:
//
//   peek  one line: "STEP 3 OF 8 · Rear slope (north) · 0/1"   (tap → half)
//   half  the step card: hint, Prev / Next, All steps
//   full  every step, with its shots, and the switch-off row
//
// Selecting a step tells the camera what to tag (slope, area, mode) — the
// photos then tick the step by existing, never by hand (captureCoach.ts).
//
// Motion: a pan on the header follows the finger (gesture-handler +
// Reanimated) and snaps to the nearest detent on release; the detent is
// remembered by the chrome store. `static` (crash-safety session or Reduce
// Motion) renders a plain View at the detent's height with tap-only
// navigation — no worklet, no gesture. Every worklet body here is wrapped so
// a throw on the UI runtime records to Diagnostics instead of aborting the
// process (PROMPT_LOG #63).

import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { CoachProgress } from '@/lib/services/captureCoach';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import type { CoachDetent } from '@/lib/stores/captureChromeStore';
import { colors, fontSize, fontWeight, glass, motion, radii, spacing, touchTarget } from '@/theme/tokens';
import { HUD_GAP, hudPanel } from './glass';

const DETENTS: CoachDetent[] = ['peek', 'half', 'full'];
const PEEK_H = touchTarget.standard + spacing.sm;
/** Height of the peek detent — the screen stacks the instruments above it. */
export const COACH_PEEK_HEIGHT = PEEK_H;
const HALF_H = 248;
const FULL_MAX_H = 520;
/** A flick faster than this moves one detent regardless of distance. */
const FLICK_VELOCITY = 600;

type Props = {
  progress: CoachProgress[];
  /** Index into `progress` of the step the camera is set up for. */
  activeIndex: number;
  onSelectStep: (index: number) => void;
  /** Turn the coach off for this device (the settings switch does the same). */
  onDismiss: () => void;
  detent: CoachDetent;
  onDetentChange: (d: CoachDetent) => void;
  /** Distance from the screen bottom to the top of the shutter dock. */
  bottomOffset: number;
  /** Room above the dock the full detent may use. */
  maxHeight: number;
  static?: boolean;
};

export function CoachDrawer({
  progress,
  activeIndex,
  onSelectStep,
  onDismiss,
  detent,
  onDetentChange,
  bottomOffset,
  maxHeight,
  static: isStatic = false,
}: Props) {
  const fullH = Math.max(HALF_H, Math.min(FULL_MAX_H, maxHeight));
  const heights: Record<CoachDetent, number> = { peek: PEEK_H, half: HALF_H, full: fullH };
  const target = heights[detent];

  const h = useSharedValue(target);
  const startH = useSharedValue(target);

  useEffect(() => {
    if (isStatic) {
      h.value = target;
      return;
    }
    h.value = withSpring(target, motion.snappy);
  }, [target, isStatic, h]);

  const snapTo = (d: CoachDetent) => {
    if (d !== detent) {
      Haptics.selectionAsync().catch(() => {});
      onDetentChange(d);
    }
  };

  // Pan on the header only — the step list scrolls on its own.
  const pan = Gesture.Pan()
    .onStart(() => {
      try {
        startH.value = h.value;
      } catch (error) {
        reportWorkletError(error, 'capture.CoachDrawer.onStart');
      }
    })
    .onUpdate((e) => {
      try {
        const next = startH.value - e.translationY;
        h.value = Math.max(PEEK_H, Math.min(fullH, next));
      } catch (error) {
        reportWorkletError(error, 'capture.CoachDrawer.onUpdate');
      }
    })
    .onEnd((e) => {
      try {
        const current = h.value;
        const idx = DETENTS.indexOf(detent);
        let next: CoachDetent;
        if (e.velocityY < -FLICK_VELOCITY) next = DETENTS[Math.min(2, idx + 1)];
        else if (e.velocityY > FLICK_VELOCITY) next = DETENTS[Math.max(0, idx - 1)];
        else {
          const dPeek = Math.abs(current - PEEK_H);
          const dHalf = Math.abs(current - HALF_H);
          const dFull = Math.abs(current - fullH);
          next = dPeek <= dHalf && dPeek <= dFull ? 'peek' : dHalf <= dFull ? 'half' : 'full';
        }
        h.value = withSpring(heights[next], motion.snappy);
        runOnJS(snapTo)(next);
      } catch (error) {
        reportWorkletError(error, 'capture.CoachDrawer.onEnd');
      }
    });

  const anim = useAnimatedStyle(() => {
    try {
      const raw = h.value;
      const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : PEEK_H;
      return { height: v };
    } catch (error) {
      reportWorkletError(error, 'capture.CoachDrawer.style');
      return { height: PEEK_H };
    }
  });

  const active = progress[activeIndex];
  if (!active) return null;

  const doneCount = progress.filter((p) => p.done).length;
  const go = (i: number) => {
    if (i < 0 || i >= progress.length) return;
    Haptics.selectionAsync().catch(() => {});
    onSelectStep(i);
  };
  const cycle = () => snapTo(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'peek');

  const header = (
    <View style={styles.header}>
      <View style={styles.grabberRow}>
        <View style={styles.grabber} />
      </View>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => snapTo(detent === 'peek' ? 'half' : 'peek')}
          style={styles.headerBody}
          accessibilityRole="button"
          accessibilityLabel={`Guided capture. Step ${activeIndex + 1} of ${progress.length}: ${active.step.title}. ${active.shots} of ${active.step.minShots} shot${active.step.minShots === 1 ? '' : 's'}${active.done ? ', done' : ''}. ${detent === 'peek' ? 'Tap to open the step.' : 'Tap to tuck the drawer.'}`}
        >
          <Text style={styles.eyebrow} numberOfLines={1}>
            STEP {activeIndex + 1} OF {progress.length} · {doneCount} DONE
          </Text>
          <View style={styles.titleRow}>
            <Ionicons
              name={active.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={active.done ? colors.success : colors.textInverse}
            />
            <Text style={styles.title} numberOfLines={1}>
              {active.step.title}
            </Text>
            <Text style={styles.shots}>
              {active.shots}/{active.step.minShots}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={cycle}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={
            detent === 'peek'
              ? 'Open the step'
              : detent === 'half'
              ? 'Show every step'
              : 'Tuck the coach away'
          }
        >
          <Ionicons
            name={detent === 'full' ? 'chevron-down' : 'chevron-up'}
            size={24}
            color={colors.textInverse}
          />
        </Pressable>
      </View>
    </View>
  );

  const body = (
    <>
      {detent !== 'peek' && (
        <View style={styles.card}>
          <Text style={styles.hint} numberOfLines={3}>
            {active.step.hint}
          </Text>
          <View style={styles.navRow}>
            <Pressable
              onPress={() => go(activeIndex - 1)}
              disabled={activeIndex === 0}
              style={[styles.navBtn, activeIndex === 0 && styles.navBtnOff]}
              accessibilityRole="button"
              accessibilityLabel="Previous step"
            >
              <Ionicons name="chevron-back" size={22} color={colors.textInverse} />
              <Text style={styles.navText}>Prev</Text>
            </Pressable>
            <Pressable
              onPress={() => go(activeIndex + 1)}
              disabled={activeIndex >= progress.length - 1}
              style={[styles.navBtn, styles.navBtnNext, activeIndex >= progress.length - 1 && styles.navBtnOff]}
              accessibilityRole="button"
              accessibilityLabel="Next step"
            >
              <Text style={styles.navTextStrong}>Next</Text>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
            {detent === 'half' && (
              <Pressable
                onPress={() => snapTo('full')}
                style={styles.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Show every step"
              >
                <Ionicons name="list" size={22} color={colors.textInverse} />
                <Text style={styles.navText}>All</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {detent === 'full' && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} nestedScrollEnabled>
          {progress.map((p, i) => (
            <Pressable
              key={p.step.id}
              onPress={() => go(i)}
              style={({ pressed }) => [styles.row, i === activeIndex && styles.rowActive, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: i === activeIndex }}
              accessibilityLabel={`${p.step.title}, ${p.shots} of ${p.step.minShots} shots${p.done ? ', done' : ''}`}
            >
              <Ionicons
                name={p.done ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={p.done ? colors.success : colors.textInverse}
              />
              <View style={styles.rowMain}>
                <Text style={[styles.rowTitle, i === activeIndex && styles.rowTitleActive]} numberOfLines={1}>
                  {p.step.title}
                </Text>
                <Text style={styles.rowHint} numberOfLines={2}>
                  {p.step.hint}
                </Text>
              </View>
              <Text style={styles.rowShots}>
                {p.shots}/{p.step.minShots}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onDismiss}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Turn guided capture off"
          >
            <Ionicons name="eye-off-outline" size={18} color={colors.textInverse} />
            <Text style={styles.dismissText}>Turn guided capture off</Text>
          </Pressable>
        </ScrollView>
      )}
    </>
  );

  if (isStatic) {
    return (
      <View style={[styles.drawer, { bottom: bottomOffset, height: target }]} accessibilityLabel="Guided capture">
        {header}
        {body}
      </View>
    );
  }

  return (
    <Animated.View style={[styles.drawer, { bottom: bottomOffset }, anim]} accessibilityLabel="Guided capture">
      <GestureDetector gesture={pan}>{header}</GestureDetector>
      {body}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    ...hudPanel,
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  header: { paddingHorizontal: spacing.sm },
  grabberRow: { alignItems: 'center', paddingTop: spacing.xs },
  grabber: { width: 36, height: 4, borderRadius: radii.pill, backgroundColor: glass.borderStrong },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: HUD_GAP },
  headerBody: { flex: 1, minHeight: touchTarget.standard, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.xs },
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
  },
  eyebrow: {
    color: colors.textInverse,
    opacity: 0.7,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { flex: 1, color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  shots: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, opacity: 0.85 },

  card: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md },
  hint: { color: colors.textInverse, opacity: 0.9, fontSize: fontSize.bodyMd, lineHeight: 21 },
  navRow: { flexDirection: 'row', gap: HUD_GAP },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
  },
  // Next is the step the roofer is most likely to want — it takes the white
  // "chosen" fill and the room.
  navBtnNext: { flex: 1, backgroundColor: colors.surface },
  navBtnOff: { opacity: 0.35 },
  navText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  navTextStrong: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },

  list: { flex: 1, marginTop: spacing.sm },
  listContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs },
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
  },
  rowActive: { backgroundColor: glass.fillHigh },
  rowMain: { flex: 1, gap: 1 },
  rowTitle: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  rowTitleActive: { fontWeight: fontWeight.bold },
  rowHint: { color: colors.textInverse, opacity: 0.75, fontSize: fontSize.caption, lineHeight: 15 },
  rowShots: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  dismiss: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dismissText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.7 },
});
