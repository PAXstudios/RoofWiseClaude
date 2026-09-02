import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAltitudeFeet, type MotionSample } from '@/lib/services/deviceMotion';
import {
  pitchDegreesToRatio,
  yawToOrientation,
  CAPTURE_MODE_LABELS,
  type CaptureMode,
} from '@/lib/models/types';
import { captureModeOption } from '@/lib/services/captureSession';
import { colors, fontSize, fontWeight, glass, radii, spacing, touchTarget } from '@/theme/tokens';

/** Fallback clearance under the HUD's bottom-left stack when nothing is measured. */
const DEFAULT_BOTTOM_INSET = 220;
/** Fallback clearance under the top bar when nothing is measured. */
const DEFAULT_TOP_INSET = touchTarget.standard + spacing.xxxl;

type Props = {
  /** Currently-selected slope (S, N, etc.) so the HUD can hint when the heading drifts. */
  selectedSlope?: string;
  /** Currently-selected capture subject (one of AREA_TAGS). Rides the photo. */
  areaTag?: string;
  /** Which mode the next shutter press records. Changes how hits aggregate. */
  captureMode?: CaptureMode;
  /**
   * Motion sample owned by the screen (one throttled DeviceMotion stream is
   * shared by the HUD and the level guide). Null hides the compass and the
   * pitch chip — web, no sensors, or the screen is blurred.
   */
  motion: MotionSample | null;
  /**
   * Height of whatever chrome sits at the bottom of the screen (the capture
   * dock), so the bottom-left stack clears it. Measured by the host screen —
   * the dock grew when area/mode pickers landed and a hardcoded offset drifts.
   */
  bottomInset?: number;
  /** Height of the top bar (plus safe area) so the compass clears it. */
  topInset?: number;
};

/**
 * Heads-up display overlay for the Quick Inspection camera. Shows
 * - compass arrow + heading (auto-detected slope orientation)
 * - the active capture subject (area tag) and capture mode
 * - pitch readout in degrees and X/12 ratio
 * - GPS elevation
 *
 * The level itself lives in `components/capture/LevelGuide.tsx` — it sits in
 * the centre of the viewfinder where the roofer is actually looking.
 */
export function CameraHUD({
  selectedSlope,
  areaTag,
  captureMode,
  motion,
  bottomInset,
  topInset,
}: Props) {
  const altFeet = useAltitudeFeet();
  const heading = motion ? yawToOrientation(motion.yawDegrees) : null;
  const slopeOk = !selectedSlope || !heading || selectedSlope === heading;

  const mode = captureModeOption(captureMode ?? 'square_10x10');
  const singleShingle = mode.mode === 'single_shingle';

  return (
    <View style={styles.wrap} pointerEvents="none">
      {/* Top-right: compass + heading */}
      {motion && heading && (
        <View style={[styles.topRight, { top: topInset ?? DEFAULT_TOP_INSET }]}>
          <View style={styles.compassWrap}>
            <View
              style={[
                styles.compassNeedle,
                { transform: [{ rotate: `${motion.yawDegrees}deg` }] },
              ]}
            >
              <View style={styles.compassNorth} />
            </View>
          </View>
          <View style={[styles.compassChip, !slopeOk && styles.compassChipWarn]}>
            <Text style={styles.compassText}>{heading}</Text>
            <Text style={styles.compassSub}>
              {Math.round(motion.yawDegrees)}°
              {selectedSlope && (slopeOk ? ' · matches' : ` · expected ${selectedSlope}`)}
            </Text>
          </View>
        </View>
      )}

      {/* Bottom-left: capture subject + mode, then pitch + elevation */}
      <View
        style={[styles.bottomLeft, { bottom: bottomInset ?? DEFAULT_BOTTOM_INSET }]}
      >
        {!!areaTag && (
          <View style={[styles.dataChip, styles.areaChip]}>
            <Ionicons name="pricetag" size={14} color={colors.text} />
            <Text style={[styles.dataChipText, styles.areaChipText]} numberOfLines={1}>
              {areaTag}
            </Text>
          </View>
        )}
        <View style={[styles.dataChip, singleShingle && styles.modeChipSingle]}>
          <Ionicons name={mode.icon} size={14} color={colors.textInverse} />
          <Text style={styles.dataChipText}>{CAPTURE_MODE_LABELS[mode.mode]}</Text>
        </View>
        {motion && (
          <View style={styles.dataChip}>
            <Ionicons name="trending-up" size={14} color={colors.textInverse} />
            <Text style={styles.dataChipText}>
              {motion.pitchDegrees.toFixed(1)}° · {pitchDegreesToRatio(motion.pitchDegrees)}
            </Text>
          </View>
        )}
        {altFeet !== null && (
          <View style={styles.dataChip}>
            <Ionicons name="navigate" size={14} color={colors.textInverse} />
            <Text style={styles.dataChipText}>{altFeet.toFixed(0)} ft</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: spacing.xl },

  // `top` / `bottom` are supplied at render time from the measured chrome.
  topRight: { position: 'absolute', right: spacing.xl, alignItems: 'center', gap: spacing.xs },
  bottomLeft: { position: 'absolute', left: spacing.xl, right: spacing.xl, gap: spacing.xs },

  // Glass over photography: the smoke pair, so every chip carries its own
  // contrast regardless of the roof behind it (Drift #1).
  compassWrap: {
    width: 60,
    height: 60,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassNeedle: {
    width: 6,
    height: 50,
    alignItems: 'center',
  },
  compassNorth: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.orange,
  },
  compassChip: {
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  compassChipWarn: { borderColor: colors.warn },
  compassText: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.bold },
  compassSub: { color: colors.textInverse, opacity: 0.78, fontSize: fontSize.caption },

  dataChip: {
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
  dataChipText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  // The subject label rides the photo into the report. White fill + ink text —
  // the camera chrome's "active" language (matches the dock's selected chips).
  areaChip: { backgroundColor: colors.surface, borderColor: colors.surface, maxWidth: '100%' },
  areaChipText: { color: colors.text, flexShrink: 1 },
  // Single-shingle is the mode that does NOT feed the per-square threshold;
  // it must never be mistaken for the default at a glance.
  modeChipSingle: { backgroundColor: colors.brand, borderColor: colors.brand },
});
