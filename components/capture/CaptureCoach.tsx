// The guided-capture strip — one step at a time, over the camera.
//
// Sits above the dock, glass on the viewfinder. Shows where the inspector is
// in the walk, what to shoot now, and how many shots that step has. Prev /
// Next are 56pt; the step title is a tap target that opens the full list.
// Selecting a step tells the camera what to tag (slope, area, mode) — the
// photos then tick the step by existing, never by hand.

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/glass/GlassCard';
import type { CoachProgress } from '@/lib/services/captureCoach';
import { colors, fontSize, fontWeight, glass, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  progress: CoachProgress[];
  /** Index into `progress` of the step the camera is set up for. */
  activeIndex: number;
  onSelectStep: (index: number) => void;
  /** Turn the coach off for this device (the settings switch does the same). */
  onDismiss: () => void;
};

export function CaptureCoach({ progress, activeIndex, onSelectStep, onDismiss }: Props) {
  const [listOpen, setListOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const active = progress[activeIndex];
  if (!active) return null;

  const doneCount = progress.filter((p) => p.done).length;
  const go = (i: number) => {
    if (i < 0 || i >= progress.length) return;
    Haptics.selectionAsync().catch(() => {});
    onSelectStep(i);
  };

  return (
    <>
      <View style={styles.wrap} pointerEvents="box-none">
        <GlassCard radius={radii.lg} style={styles.strip}>
          <Pressable
            onPress={() => go(activeIndex - 1)}
            disabled={activeIndex === 0}
            style={[styles.navBtn, activeIndex === 0 && styles.navBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textInverse} />
          </Pressable>

          <Pressable
            onPress={() => setListOpen(true)}
            style={styles.body}
            accessibilityRole="button"
            accessibilityLabel={`Step ${activeIndex + 1} of ${progress.length}: ${active.step.title}. ${active.shots} shot${active.shots === 1 ? '' : 's'}${active.done ? ', done' : ''}. Tap for all steps.`}
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
            <Text style={styles.hint} numberOfLines={2}>
              {active.step.hint}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => go(activeIndex + 1)}
            disabled={activeIndex >= progress.length - 1}
            style={[styles.navBtn, activeIndex >= progress.length - 1 && styles.navBtnOff]}
            accessibilityRole="button"
            accessibilityLabel="Next step"
          >
            <Ionicons name="chevron-forward" size={22} color={colors.textInverse} />
          </Pressable>
        </GlassCard>
      </View>

      <Modal visible={listOpen} transparent animationType="fade" onRequestClose={() => setListOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setListOpen(false)} accessibilityLabel="Dismiss">
          <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Pressable onPress={() => {}}>
              <GlassCard level="high" radius={radii.xl} style={styles.sheet}>
                <View style={styles.sheetHead}>
                  <Text style={styles.sheetTitle}>The walk</Text>
                  <Text style={styles.sheetSub}>
                    {doneCount} of {progress.length} done · photos tick the steps, not taps
                  </Text>
                </View>
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                  {progress.map((p, i) => (
                    <Pressable
                      key={p.step.id}
                      onPress={() => {
                        setListOpen(false);
                        go(i);
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        i === activeIndex && styles.rowActive,
                        pressed && styles.pressed,
                      ]}
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
                        <Text style={[styles.rowTitle, i === activeIndex && styles.rowTitleActive]}>
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
                </ScrollView>
                <Pressable
                  onPress={() => {
                    setListOpen(false);
                    onDismiss();
                  }}
                  style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Turn guided capture off"
                >
                  <Ionicons name="eye-off-outline" size={18} color={colors.textInverse} />
                  <Text style={styles.dismissText}>Turn guided capture off</Text>
                </Pressable>
              </GlassCard>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  strip: { flexDirection: 'row', alignItems: 'center', padding: spacing.xs, gap: spacing.xs },
  navBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
  },
  navBtnOff: { opacity: 0.35 },
  body: { flex: 1, minHeight: touchTarget.standard, justifyContent: 'center', gap: 2, paddingHorizontal: spacing.xs },
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
  hint: { color: colors.textInverse, opacity: 0.8, fontSize: fontSize.caption, lineHeight: 15 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.md },
  sheet: { padding: spacing.lg, gap: spacing.md, maxHeight: 560 },
  sheetHead: { gap: 2 },
  sheetTitle: { color: colors.textInverse, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold },
  sheetSub: { color: colors.textInverse, opacity: 0.8, fontSize: fontSize.bodySm },
  list: { flexGrow: 0 },
  listContent: { gap: spacing.xs },
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
