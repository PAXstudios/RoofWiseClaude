import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeviceMotion, useAltitudeFeet } from '@/lib/services/deviceMotion';
import {
  pitchDegreesToRatio,
  yawToOrientation,
  CAPTURE_MODE_LABELS,
  type CaptureMode,
} from '@/lib/models/types';
import { captureModeOption } from '@/lib/services/captureSession';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

/** Fallback clearance under the HUD's bottom-left stack when nothing is measured. */
const DEFAULT_BOTTOM_INSET = 220;

type Props = {
  /** Currently-selected slope (S, N, etc.) so the HUD can hint when the heading drifts. */
  selectedSlope?: string;
  /** Currently-selected capture subject (one of AREA_TAGS). Rides the photo. */
  areaTag?: string;
  /** Which mode the next shutter press records. Changes how hits aggregate. */
  captureMode?: CaptureMode;
  /**
   * Height of whatever chrome sits at the bottom of the screen (the capture
   * dock), so the bottom-left stack clears it. Measured by the host screen —
   * the dock grew when area/mode pickers landed and a hardcoded offset drifts.
   */
  bottomInset?: number;
};

/**
 * Heads-up display overlay for the Quick Inspection camera. Shows
 * - a bullseye level driven by current roll
 * - compass arrow + heading (auto-detected slope orientation)
 * - the active capture subject (area tag) and capture mode
 * - pitch readout in degrees and X/12 ratio
 * - GPS elevation
 */
export function CameraHUD({ selectedSlope, areaTag, captureMode, bottomInset }: Props) {
  const { pitchDegrees, rollDegrees, yawDegrees } = useDeviceMotion();
  const altFeet = useAltitudeFeet();
  const heading = yawToOrientation(yawDegrees);
  const rollOffset = Math.max(-40, Math.min(40, rollDegrees * 1.5));

  const slopeOk = !selectedSlope || selectedSlope === heading;
  const rollOk = Math.abs(rollDegrees) < 5;
  const levelTint = rollOk ? colors.success : Math.abs(rollDegrees) < 15 ? colors.warn : colors.danger;

  const mode = captureModeOption(captureMode ?? 'square_10x10');
  const singleShingle = mode.mode === 'single_shingle';

  return (
    <View style={styles.wrap} pointerEvents="none">
      {/* Top-right: compass + heading */}
      <View style={styles.topRight}>
        <View style={styles.compassWrap}>
          <View
            style={[
              styles.compassNeedle,
              { transform: [{ rotate: `${yawDegrees}deg` }] },
            ]}
          >
            <View style={styles.compassNorth} />
          </View>
        </View>
        <View style={styles.compassChip}>
          <Text style={styles.compassText}>{heading}</Text>
          <Text style={styles.compassSub}>
            {Math.round(yawDegrees)}°
            {selectedSlope && (slopeOk ? ' · matches' : ` · expected ${selectedSlope}`)}
          </Text>
        </View>
      </View>

      {/* Top-left: bullseye level */}
      <View style={styles.topLeft}>
        <View style={[styles.bullseyeOuter, { borderColor: levelTint }]}>
          <View style={styles.bullseyeMid} />
          <View
            style={[
              styles.bullseyeDot,
              {
                backgroundColor: levelTint,
                transform: [{ translateX: rollOffset }],
              },
            ]}
          />
        </View>
        <Text style={styles.hudCaption}>
          Level {rollDegrees > 0 ? '↘' : rollDegrees < 0 ? '↙' : '✓'}
        </Text>
      </View>

      {/* Bottom-left: capture subject + mode, then pitch + elevation */}
      <View
        style={[styles.bottomLeft, { bottom: bottomInset ?? DEFAULT_BOTTOM_INSET }]}
      >
        {!!areaTag && (
          <View style={[styles.dataChip, styles.areaChip]}>
            <Ionicons name="pricetag" size={14} color={colors.textInverse} />
            <Text style={[styles.dataChipText, styles.areaChipText]} numberOfLines={1}>
              {areaTag}
            </Text>
          </View>
        )}
        <View style={[styles.dataChip, singleShingle && styles.modeChipSingle]}>
          <Ionicons
            name={mode.icon}
            size={14}
            color={singleShingle ? colors.textInverse : colors.cream}
          />
          <Text style={styles.dataChipText}>{CAPTURE_MODE_LABELS[mode.mode]}</Text>
        </View>
        <View style={styles.dataChip}>
          <Ionicons name="trending-up" size={14} color={colors.cream} />
          <Text style={styles.dataChipText}>{pitchDegrees.toFixed(1)}° · {pitchDegreesToRatio(pitchDegrees)}</Text>
        </View>
        {altFeet !== null && (
          <View style={styles.dataChip}>
            <Ionicons name="navigate" size={14} color={colors.cream} />
            <Text style={styles.dataChipText}>{altFeet.toFixed(0)} ft</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', padding: spacing.xl },

  topRight: { position: 'absolute', top: spacing.xxxl + 20, right: spacing.xl, alignItems: 'center', gap: spacing.xs },
  topLeft: { position: 'absolute', top: spacing.xxxl + 20, left: spacing.xl, alignItems: 'center', gap: spacing.xs },
  // `bottom` is supplied at render time from the measured dock height.
  bottomLeft: { position: 'absolute', left: spacing.xl, right: spacing.xl, gap: spacing.xs },

  compassWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(12,24,60,0.72)',
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
    backgroundColor: 'rgba(12,24,60,0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  compassText: { color: colors.cream, fontSize: fontSize.bodySm, fontWeight: fontWeight.bold },
  compassSub: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.caption },

  bullseyeOuter: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bullseyeMid: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(240,240,228,0.45)', position: 'absolute' },
  bullseyeDot: { width: 16, height: 16, borderRadius: 8 },
  hudCaption: { color: colors.cream, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  dataChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(12,24,60,0.72)',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  dataChipText: { color: colors.cream, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  // The subject label rides the photo into the report, so it gets the accent.
  areaChip: { backgroundColor: colors.orange, maxWidth: '100%' },
  areaChipText: { color: colors.textInverse, flexShrink: 1 },
  // Single-shingle is the mode that does NOT feed the per-square threshold;
  // it must never be mistaken for the default at a glance.
  modeChipSingle: { backgroundColor: colors.brand },
});
