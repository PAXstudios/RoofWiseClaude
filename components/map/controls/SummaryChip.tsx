// The one-line echo of everything the layers sheet has set — "Storms · 36 mo
// · Hail + wind · All days" — floating top-left over the map. It is the
// answer to "what am I looking at?" and, tapped, the door back into the sheet
// that changes it. Stays on screen when the rail is tucked, so the roofer is
// never looking at a filtered map with no sign that it is filtered.
//
// Frosted glass (ink on frost ≥13:1 over any imagery); 56pt target around a
// 48pt pill, the header-button pattern (Drift #1).

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/glass/GlassCard';
import { PressableScale } from '@/components/PressableScale';
import type { IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  text: string;
  icon?: IoniconName;
  onPress: () => void;
  /** Spoken name. Defaults to "Layers and filters: {text}". */
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function SummaryChip({ text, icon = 'options-outline', onPress, label, testID, style }: Props) {
  return (
    <PressableScale
      style={[styles.hit, style]}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label ?? `Layers and filters: ${text}`}
      accessibilityHint="Opens the layers and filters sheet"
    >
      <View style={styles.shadow}>
        <GlassCard onLight onArt radius={radii.pill} style={styles.pill}>
          <Ionicons name={icon} size={16} color={colors.text} />
          <Text style={styles.text} numberOfLines={1}>
            {text}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </GlassCard>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hit: {
    minHeight: touchTarget.standard,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  shadow: { borderRadius: radii.pill, ...shadows.float },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm + spacing.xs,
  },
  text: {
    flexShrink: 1,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
