import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeviceMotion, useAltitudeFeet } from '@/lib/services/deviceMotion';
import { pitchDegreesToRatio, yawToOrientation } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

type Props = {
  /** Currently-selected slope (S, N, etc.) so the HUD can hint when the heading drifts. */
  selectedSlope?: string;
};

/**
 * Heads-up display overlay for the Quick Inspection camera. Shows
 * - a bullseye level driven by current roll
 * - compass arrow + heading (auto-detected slope orientation)
 * - pitch readout in degrees and X/12 ratio
 * - GPS elevation
 */
export function CameraHUD({ selectedSlope }: Props) {
  const { pitchDegrees, rollDegrees, yawDegrees } = useDeviceMotion();
  const altFeet = useAltitudeFeet();
  const heading = yawToOrientation(yawDegrees);
  const rollOffset = Math.max(-40, Math.min(40, rollDegrees * 1.5));

  const slopeOk = !selectedSlope || selectedSlope === heading;
  const rollOk = Math.abs(rollDegrees) < 5;
  const levelTint = rollOk ? colors.success : Math.abs(rollDegrees) < 15 ? colors.warn : colors.danger;

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

      {/* Bottom-left: pitch + elevation */}
      <View style={styles.bottomLeft}>
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
  bottomLeft: { position: 'absolute', bottom: 220, left: spacing.xl, gap: spacing.xs },

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
});
