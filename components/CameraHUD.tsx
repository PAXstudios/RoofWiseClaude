// The instrument cluster — the camera's sensor readouts, as one compact
// stack: compass rose + heading, pitch (degrees and X/12), GPS elevation,
// and the live shingle count when Live overlay has one.
//
// This used to be the whole HUD (it also drew the area tag and capture mode
// chips). Those are the mode strip's job now (`components/capture/hud/
// ModeStrip.tsx`); the composition root is `HudChrome`, and this cluster is
// part of the SECONDARY chrome it fades in and out. Non-interactive: the
// host positions it, nothing here takes a touch.
//
// The level itself lives in `components/capture/LevelGuide.tsx` — it sits in
// the centre of the viewfinder where the roofer is actually looking.

import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  COMPASS_USABLE_ACCURACY,
  useAltitudeFeet,
  type CompassHeading,
  type MotionSample,
} from '@/lib/services/deviceMotion';
import { pitchDegreesToRatio, yawToOrientation } from '@/lib/models/types';
import { colors, dataLabel, fontSize, glass, radii, spacing } from '@/theme/tokens';

type Props = {
  /** Currently-selected slope (S, N, etc.) so the cluster can flag a heading that drifts. */
  selectedSlope?: string;
  /**
   * Motion sample owned by the screen (one throttled DeviceMotion stream is
   * shared by the cluster and the level guide). Null hides the pitch chip.
   * NOT used for the compass: its yaw is relative to an arbitrary start
   * frame, not to north.
   */
  motion: MotionSample | null;
  /** Real compass heading (Location.watchHeadingAsync). Null hides the compass. */
  heading?: CompassHeading | null;
  /** How the current slope tag was chosen — shown so a wrong auto-tag is visible. */
  slopeSource?: 'auto' | 'pinned';
  /** Live overlay's last shingle count, when it has one. */
  liveShingleCount?: number | null;
  style?: StyleProp<ViewStyle>;
};

export function CameraHUD({
  selectedSlope,
  motion,
  heading: compass,
  slopeSource,
  liveShingleCount,
  style,
}: Props) {
  const altFeet = useAltitudeFeet();
  const heading = compass ? yawToOrientation(compass.degrees) : null;
  const usable = !!compass && compass.accuracy >= COMPASS_USABLE_ACCURACY;
  const slopeOk = !selectedSlope || !heading || selectedSlope === heading;

  return (
    <View style={[styles.wrap, style]} pointerEvents="none" accessibilityRole="summary">
      {compass && heading && (
        <View style={styles.compassRow}>
          <View style={styles.compassWrap}>
            {/* The needle points at north; rotating by -heading keeps it
                there as the phone turns, like a real compass. */}
            <View style={[styles.compassNeedle, { transform: [{ rotate: `${-compass.degrees}deg` }] }]}>
              <View style={styles.compassNorth} />
            </View>
          </View>
          <View style={[styles.chip, usable && !slopeOk && styles.chipWarn]}>
            <Text style={styles.chipStrong}>
              {heading}
              {!usable ? ' ?' : ''}
            </Text>
            <Text style={styles.chipText}>
              {Math.round(compass.degrees)}°{compass.reference === 'magnetic' ? ' mag' : ''}
              {!usable
                ? ' · low accuracy'
                : selectedSlope
                ? slopeOk
                  ? slopeSource === 'auto'
                    ? ' · auto'
                    : ' · matches'
                  : ` · tagged ${selectedSlope}`
                : ''}
            </Text>
          </View>
        </View>
      )}
      {motion && (
        <View style={styles.chip}>
          <Ionicons name="trending-up" size={14} color={colors.textInverse} />
          <Text style={styles.chipText}>
            {motion.pitchDegrees.toFixed(1)}° · {pitchDegreesToRatio(motion.pitchDegrees)}
          </Text>
        </View>
      )}
      {altFeet !== null && (
        <View style={styles.chip}>
          <Ionicons name="navigate" size={14} color={colors.textInverse} />
          <Text style={styles.chipText}>{altFeet.toFixed(0)} ft</Text>
        </View>
      )}
      {liveShingleCount != null && (
        <View style={styles.chip}>
          <Ionicons name="scan-outline" size={14} color={colors.textInverse} />
          <Text style={styles.chipText}>~{liveShingleCount} shingles in frame</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, alignItems: 'flex-start' },
  compassRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },

  // Glass over photography: the smoke pair, so every chip carries its own
  // contrast regardless of the roof behind it (Drift #1).
  compassWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassNeedle: { width: 6, height: 36, alignItems: 'center' },
  compassNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.orange,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  chipWarn: { borderColor: colors.warn },
  // Instrument readouts (heading, pitch, altitude, live count) read as the
  // mock's mono/uppercase data-label convention (docs/DESIGN_1A.md §3) — an
  // instrument cluster, not prose.
  chipStrong: { ...dataLabel, color: colors.textInverse, fontSize: fontSize.bodySm, letterSpacing: 0.6 },
  chipText: { ...dataLabel, color: colors.textInverse, opacity: 0.88 },
});
