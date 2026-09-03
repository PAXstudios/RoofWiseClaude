// The mode strip — what the next frame is FOR, in one row, with the subject
// tags for that purpose in a second row. Replaces the scattered mode
// segmented control + the 19-chip area row of the old dock.
//
// Nothing new is persisted: a frame mode is a VIEW over the two facts every
// photo already carries (`captureMode` and `areaTag`), so the coach, the
// slope picker and the analysis layer keep working on exactly the data they
// did. Test square is the HAAG denominator and stays the default; the other
// three all file as `single_shingle`, the bucket that is never per-square
// (a gutter close-up must not halve a slope's hit rate — PROMPT_LOG #72).
//
// All 19 tags stay reachable: 4 slope tags under Test square and Close-up,
// 3 under Edges, 12 under Collateral.

import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { IoniconName } from '@/components/ui/IconChip';
import type { AreaTag, CaptureMode } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';
import { HUD_GAP, hudActive, hudInk, hudInkActive, hudPanel } from './glass';

export type FrameMode = 'square' | 'closeup' | 'edges' | 'collateral';

export type FrameModeOption = {
  mode: FrameMode;
  label: string;
  icon: IoniconName;
  /** One line a roofer reads once. */
  hint: string;
  captureMode: CaptureMode;
  tags: readonly AreaTag[];
};

const SLOPE_TAGS: readonly AreaTag[] = ['Front Slope', 'Rear Slope', 'Left Slope', 'Right Slope'];
const EDGE_TAGS: readonly AreaTag[] = ['Ridge / Hip', 'Valley', 'Flashing / Penetrations'];
const COLLATERAL_TAGS: readonly AreaTag[] = [
  'Gutters / Downspouts',
  'Fascia / Soffit',
  'Siding',
  'Windows',
  'Window Screens',
  'Garage Door',
  'Fence / Gate',
  'HVAC Condenser',
  'Roof Vents / Soft Metals',
  'Chimney',
  'Skylight',
  'Other',
];

export const FRAME_MODES: readonly FrameModeOption[] = [
  {
    mode: 'square',
    label: 'Test square',
    icon: 'grid-outline',
    hint: 'A chalked 10×10 shot straight on. Hits count toward the HAAG per-square threshold.',
    captureMode: 'square_10x10',
    tags: SLOPE_TAGS,
  },
  {
    mode: 'closeup',
    label: 'Close-up',
    icon: 'layers-outline',
    hint: 'One shingle or a detail on the slope. Counted separately, never per-square.',
    captureMode: 'single_shingle',
    tags: SLOPE_TAGS,
  },
  {
    mode: 'edges',
    label: 'Edges',
    icon: 'git-branch-outline',
    hint: 'Ridge, hip, valley, flashing — where hail and wind show first.',
    captureMode: 'single_shingle',
    tags: EDGE_TAGS,
  },
  {
    mode: 'collateral',
    label: 'Collateral',
    icon: 'home-outline',
    hint: 'Gutters, siding, screens, condenser, vents — the evidence around the roof.',
    captureMode: 'single_shingle',
    tags: COLLATERAL_TAGS,
  },
];

export function frameModeOption(mode: FrameMode): FrameModeOption {
  return FRAME_MODES.find((m) => m.mode === mode) ?? FRAME_MODES[0];
}

/** Which mode a (captureMode, areaTag) pair reads as. Total: unknown tags land in Collateral. */
export function frameModeFor(captureMode: CaptureMode, areaTag: string): FrameMode {
  if ((SLOPE_TAGS as readonly string[]).includes(areaTag)) {
    return captureMode === 'square_10x10' ? 'square' : 'closeup';
  }
  if ((EDGE_TAGS as readonly string[]).includes(areaTag)) return 'edges';
  return 'collateral';
}

type Props = {
  captureMode: CaptureMode;
  areaTag: string;
  /** The 10×10 guide state, shown on the Test-square chip. */
  squareGuide: boolean;
  onSelectMode: (mode: FrameMode) => void;
  onSelectTag: (tag: AreaTag) => void;
  /** Second tap on the active Test-square chip. */
  onToggleSquareGuide: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
};

export function ModeStrip({
  captureMode,
  areaTag,
  squareGuide,
  onSelectMode,
  onSelectTag,
  onToggleSquareGuide,
  onLayout,
  style,
}: Props) {
  const mode = frameModeFor(captureMode, areaTag);
  const option = frameModeOption(mode);

  // Keep the active tag in view when the coach (or a slope change) picks one
  // that sits off the right edge of the row.
  const tagScroll = useRef<ScrollView>(null);
  const [tagX, setTagX] = useState<Record<string, number>>({});
  useEffect(() => {
    const x = tagX[areaTag];
    if (x == null) return;
    tagScroll.current?.scrollTo({ x: Math.max(0, x - spacing.lg), animated: true });
  }, [areaTag, tagX]);

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="tablist"
      >
        {FRAME_MODES.map((m) => {
          const active = m.mode === mode;
          const isSquare = m.mode === 'square';
          const a11y = active
            ? isSquare
              ? `${m.label}, selected. 10×10 guide ${squareGuide ? 'on' : 'off'}. Tap again to turn it ${squareGuide ? 'off' : 'on'}.`
              : `${m.label}, selected. ${m.hint}`
            : `${m.label}. ${m.hint}`;
          return (
            <Pressable
              key={m.mode}
              onPress={() => (active && isSquare ? onToggleSquareGuide() : onSelectMode(m.mode))}
              style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={a11y}
            >
              <Ionicons
                name={active ? 'checkmark-circle' : m.icon}
                size={20}
                color={active ? hudInkActive : hudInk}
              />
              <View>
                <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                  {m.label}
                </Text>
                {active && isSquare && (
                  <Text style={styles.chipSub} numberOfLines={1}>
                    {squareGuide ? '10×10 guide on' : '10×10 guide off'}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        ref={tagScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {option.tags.map((tag) => {
          const active = tag === areaTag;
          return (
            <Pressable
              key={tag}
              onPress={() => onSelectTag(tag)}
              onLayout={(e) => {
                const x = e.nativeEvent.layout.x;
                setTagX((prev) => (prev[tag] === x ? prev : { ...prev, [tag]: x }));
              }}
              style={({ pressed }) => [styles.tag, active && styles.chipActive, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={active ? `${tag}, selected subject` : `Tag the next photo ${tag}`}
            >
              {active && <Ionicons name="pricetag" size={14} color={hudInkActive} />}
              <Text style={[styles.tagText, active && styles.chipTextActive]} numberOfLines={1}>
                {tag}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: {
    paddingHorizontal: spacing.lg,
    gap: HUD_GAP,
    alignItems: 'center',
  },
  chip: {
    ...hudPanel,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  chipActive: hudActive,
  pressed: { opacity: 0.75 },
  chipText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  chipTextActive: { color: colors.text },
  chipSub: { color: colors.textMuted, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  tag: {
    ...hudPanel,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    minWidth: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
  },
  tagText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
