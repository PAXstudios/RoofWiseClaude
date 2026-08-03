// Onboarding scene illustrations.
//
// Each scene animates the actual product loop rather than decorating the
// screen: a storm lands → you walk the roof and AI reads it → HAAG rules
// return a verdict → you leave with a packet. The motion is the explanation,
// so every scene restarts when it becomes active and holds still when it
// isn't (no animation runs off-screen).

import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { brand, colors, fontSize, fontWeight, glass, motion, radii, spacing } from '@/theme/tokens';

const STAGE = 260;

export type SceneProps = { active: boolean };

/* ─────────────────────────── 1 · Storm lands ─────────────────────────── */

export function StormScene({ active }: SceneProps) {
  const sweep = useSharedValue(0);
  const blips = [useSharedValue(0), useSharedValue(0), useSharedValue(0)];

  useEffect(() => {
    if (!active) {
      cancelAnimation(sweep);
      sweep.value = 0;
      blips.forEach((b) => { cancelAnimation(b); b.value = 0; });
      return;
    }
    sweep.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.linear }),
      -1,
      false,
    );
    blips.forEach((b, i) => {
      b.value = withDelay(
        500 + i * 620,
        withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sweep.value * 360}deg` }],
  }));

  const positions = [
    { x: 0.70, y: 0.30 },
    { x: 0.32, y: 0.66 },
    { x: 0.62, y: 0.72 },
  ];

  return (
    <View style={styles.stage}>
      <Svg width={STAGE} height={STAGE} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={brand.royal} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={brand.royal} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={STAGE / 2} cy={STAGE / 2} r={STAGE / 2} fill="url(#radarGlow)" />
        {[0.28, 0.54, 0.80, 1].map((r) => (
          <Circle
            key={r}
            cx={STAGE / 2}
            cy={STAGE / 2}
            r={(STAGE / 2) * r - 2}
            fill="none"
            stroke={glass.border}
            strokeWidth={1}
          />
        ))}
        <Line x1={6} y1={STAGE / 2} x2={STAGE - 6} y2={STAGE / 2} stroke={glass.border} strokeWidth={1} />
        <Line x1={STAGE / 2} y1={6} x2={STAGE / 2} y2={STAGE - 6} stroke={glass.border} strokeWidth={1} />
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
        <Svg width={STAGE} height={STAGE}>
          <Defs>
            <RadialGradient id="sweepFade" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={brand.royal} stopOpacity={0.5} />
              <Stop offset="100%" stopColor={brand.royal} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Path
            d={`M${STAGE / 2} ${STAGE / 2} L${STAGE / 2} 4 A${STAGE / 2 - 4} ${STAGE / 2 - 4} 0 0 1 ${STAGE - 22} ${STAGE * 0.3} Z`}
            fill="url(#sweepFade)"
          />
        </Svg>
      </Animated.View>

      {positions.map((p, i) => (
        <Blip key={i} progress={blips[i]} x={p.x} y={p.y} />
      ))}
    </View>
  );
}

function Blip({ progress, x, y }: { progress: Animated.SharedValue<number>; x: number; y: number }) {
  const dot = useAnimatedStyle(() => ({
    opacity: progress.value < 0.12 ? progress.value / 0.12 : Math.max(0, 1 - (progress.value - 0.12) / 0.88),
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: Math.max(0, 0.6 - progress.value * 0.6),
    transform: [{ scale: 0.4 + progress.value * 2.6 }],
  }));

  return (
    <View style={[styles.blipWrap, { left: STAGE * x - 14, top: STAGE * y - 14 }]} pointerEvents="none">
      <Animated.View style={[styles.blipRing, ring]} />
      <Animated.View style={[styles.blipDot, dot]} />
    </View>
  );
}

/* ─────────────────────────── 2 · AI reads the roof ───────────────────── */

const DETECTIONS = [
  { left: '12%', top: '16%', w: '26%', h: '24%', label: 'HAIL · 96', delay: 260 },
  { left: '58%', top: '24%', w: '22%', h: '20%', label: 'HAIL · 91', delay: 700 },
  { left: '24%', top: '56%', w: '34%', h: '22%', label: 'GRANULE · 84', delay: 1140 },
  { left: '64%', top: '62%', w: '22%', h: '20%', label: 'BRUISE · 78', delay: 1580 },
];

export function ScanScene({ active }: SceneProps) {
  return (
    <View style={styles.stage}>
      <View style={styles.shingleField}>
        {Array.from({ length: 7 }).map((_, row) => (
          <View
            key={row}
            style={[
              styles.shingleCourse,
              { marginLeft: row % 2 === 0 ? 0 : -18 },
            ]}
          />
        ))}
      </View>
      <View style={styles.scanScrim} />
      {DETECTIONS.map((d) => (
        <DetectionBox key={d.label} {...d} active={active} />
      ))}
    </View>
  );
}

function DetectionBox({
  left, top, w, h, label, delay, active,
}: (typeof DETECTIONS)[number] & { active: boolean }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (!active) { cancelAnimation(p); p.value = 0; return; }
    p.value = withDelay(delay, withSpring(1, { damping: 13, stiffness: 170 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 0.7 + p.value * 0.3 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.detection, { left, top, width: w, height: h } as any, style]}
    >
      <View style={styles.detectionTag}>
        <Text style={styles.detectionTagText}>{label}</Text>
      </View>
    </Animated.View>
  );
}

/* ─────────────────────────── 3 · HAAG verdict ────────────────────────── */

export function VerdictScene({ active }: SceneProps) {
  const fill = useSharedValue(0);
  const stamp = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(fill); cancelAnimation(stamp);
      fill.value = 0; stamp.value = 0;
      return;
    }
    fill.value = withDelay(320, withTiming(1, { duration: 1500, easing: Easing.out(Easing.cubic) }));
    stamp.value = withDelay(1980, withSpring(1, { damping: 9, stiffness: 150 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 12 observed hits against a 10-hit architectural-asphalt threshold.
  const barStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  const countStyle = useAnimatedStyle(() => ({ opacity: fill.value }));
  const stampStyle = useAnimatedStyle(() => ({
    opacity: stamp.value,
    transform: [{ scale: 2.4 - stamp.value * 1.4 }, { rotate: '-7deg' }],
  }));

  return (
    <View style={styles.stage}>
      <View style={styles.verdictCard}>
        <Text style={styles.verdictLabel}>ARCHITECTURAL ASPHALT</Text>
        <Text style={styles.verdictRule}>HAAG threshold · 10 hits / test square</Text>

        <View style={styles.gaugeTrack}>
          <Animated.View style={[styles.gaugeFill, barStyle]} />
          {/* Threshold marker sits at 10/14 of the bar's range. */}
          <View style={[styles.gaugeThreshold, { left: `${(10 / 14) * 100}%` }]} />
        </View>

        <View style={styles.gaugeLegend}>
          <Animated.Text style={[styles.gaugeCount, countStyle]}>12 hits observed</Animated.Text>
          <Text style={styles.gaugeThresholdLabel}>threshold 10</Text>
        </View>
      </View>

      <Animated.View style={[styles.stamp, stampStyle]} pointerEvents="none">
        <Text style={styles.stampText}>CLAIM-WORTHY</Text>
      </Animated.View>
    </View>
  );
}

/* ─────────────────────────── 4 · The packet ──────────────────────────── */

const PACKET_ROWS = [
  { w: '78%', delay: 420 },
  { w: '92%', delay: 560 },
  { w: '64%', delay: 700 },
  { w: '86%', delay: 840 },
];

export function PacketScene({ active }: SceneProps) {
  const back = useSharedValue(0);
  const mid = useSharedValue(0);
  const front = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      [back, mid, front].forEach((s) => { cancelAnimation(s); s.value = 0; });
      return;
    }
    back.value = withDelay(80, withSpring(1, { damping: 15, stiffness: 130 }));
    mid.value = withDelay(200, withSpring(1, { damping: 15, stiffness: 130 }));
    front.value = withDelay(320, withSpring(1, { damping: 15, stiffness: 130 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Written out rather than generated by a helper: useAnimatedStyle is a
  // hook, so it has to be called unconditionally at the top level.
  const backStyle = useAnimatedStyle(() => ({
    opacity: back.value,
    transform: [
      { translateX: (1 - back.value) * -34 },
      { translateY: (1 - back.value) * 26 },
      { rotate: '-8deg' },
      { scale: 0.9 + back.value * 0.1 },
    ],
  }));
  const midStyle = useAnimatedStyle(() => ({
    opacity: mid.value,
    transform: [
      { translateX: (1 - mid.value) * 26 },
      { translateY: (1 - mid.value) * 18 },
      { rotate: '4deg' },
      { scale: 0.9 + mid.value * 0.1 },
    ],
  }));
  const frontStyle = useAnimatedStyle(() => ({
    opacity: front.value,
    transform: [
      { translateY: (1 - front.value) * 30 },
      { scale: 0.9 + front.value * 0.1 },
    ],
  }));

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.sheet, styles.sheetBack, backStyle]} />
      <Animated.View style={[styles.sheet, styles.sheetMid, midStyle]} />
      <Animated.View style={[styles.sheet, styles.sheetFront, frontStyle]}>
        <View style={styles.sheetHeader}>
          <View style={styles.sheetMark} />
          <View style={styles.sheetHeaderBars}>
            <View style={styles.sheetHeaderBar} />
            <View style={[styles.sheetHeaderBar, { width: '52%', opacity: 0.5 }]} />
          </View>
        </View>
        {PACKET_ROWS.map((r) => (
          <PacketRow key={r.w + r.delay} width={r.w} delay={r.delay} active={active} />
        ))}
        <View style={styles.sheetStampRow}>
          <View style={styles.sheetStamp}>
            <Text style={styles.sheetStampText}>HAAG CERTIFIED</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function PacketRow({ width, delay, active }: { width: string; delay: number; active: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active) { cancelAnimation(p); p.value = 0; return; }
    p.value = withDelay(delay, withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: (1 - p.value) * -12 }],
  }));
  return <Animated.View style={[styles.sheetRow, { width } as any, style]} />;
}

/* ─────────────────────────── styles ──────────────────────────────────── */

const styles = StyleSheet.create({
  stage: {
    width: STAGE,
    height: STAGE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Storm
  blipWrap: { position: 'absolute', width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  blipRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: brand.burnt,
  },
  blipDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: brand.burnt,
  },

  // Scan
  shingleField: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.xl,
    overflow: 'hidden',
    justifyContent: 'space-evenly',
    backgroundColor: '#1B2033',
  },
  shingleCourse: {
    height: 26,
    backgroundColor: '#242B44',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.35)',
  },
  scanScrim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.xl,
    backgroundColor: 'rgba(10,12,20,0.28)',
  },
  detection: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: brand.burnt,
    borderRadius: 6,
    backgroundColor: 'rgba(217,84,30,0.14)',
  },
  detectionTag: {
    position: 'absolute',
    top: -20,
    left: -2,
    backgroundColor: brand.burnt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detectionTagText: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.4,
  },

  // Verdict
  verdictCard: {
    width: '92%',
    borderRadius: radii.lg,
    padding: spacing.lg,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.border,
    gap: spacing.sm,
  },
  verdictLabel: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  verdictRule: { color: 'rgba(255,255,255,0.6)', fontSize: fontSize.caption },
  gaugeTrack: {
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
    marginTop: spacing.sm,
    justifyContent: 'center',
  },
  gaugeFill: {
    ...StyleSheet.absoluteFillObject,
    right: undefined,
    borderRadius: 7,
    backgroundColor: brand.burnt,
  },
  gaugeThreshold: {
    position: 'absolute',
    top: -3,
    bottom: -3,
    width: 2,
    backgroundColor: colors.textInverse,
    opacity: 0.85,
  },
  gaugeLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  gaugeCount: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  gaugeThresholdLabel: { color: 'rgba(255,255,255,0.5)', fontSize: fontSize.caption },
  stamp: {
    position: 'absolute',
    bottom: 18,
    borderWidth: 3,
    borderColor: colors.success,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(30,158,98,0.14)',
  },
  stampText: {
    color: colors.success,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.bodyMd,
    letterSpacing: 1.4,
  },

  // Packet
  sheet: {
    position: 'absolute',
    width: '74%',
    height: '84%',
    borderRadius: radii.card,
    borderWidth: 1,
  },
  sheetBack: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: glass.border },
  sheetMid: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: glass.border },
  sheetFront: {
    backgroundColor: '#F7F8FC',
    borderColor: 'rgba(255,255,255,0.6)',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  sheetMark: { width: 22, height: 22, borderRadius: 7, backgroundColor: brand.royal },
  sheetHeaderBars: { flex: 1, gap: 4 },
  sheetHeaderBar: { height: 6, borderRadius: 3, backgroundColor: brand.royalInk, opacity: 0.8, width: '74%' },
  sheetRow: { height: 7, borderRadius: 4, backgroundColor: '#C9CEE0' },
  sheetStampRow: { marginTop: 'auto', alignItems: 'flex-end' },
  sheetStamp: {
    borderWidth: 2,
    borderColor: colors.success,
    borderRadius: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  sheetStampText: { color: colors.success, fontSize: 8, fontWeight: fontWeight.bold, letterSpacing: 0.8 },
});

export const SCENE_STAGE = STAGE;
export { motion as sceneMotion };
