// A slim, non-interactive key over the map: swatch + label per item, wrapped
// into as few rows as the width allows. Storm Tracer shows the hail/wind
// swath ramps and report dots; Knock mode shows every pin colour. Toggled by
// the rail's legend button, so it is never on screen uninvited (a roofer in
// gloves wants the map, not a key to it).
//
// `ramp` draws the 4-step darkening band used by the impacted-area contours;
// `color` draws a dot. Frost glass keeps the caption legible over imagery.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/glass/GlassCard';
import type { IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, radii, shadows, spacing } from '@/theme/tokens';

export type LegendItem = {
  label: string;
  /** Dot swatch. */
  color?: string;
  /** 4-step ramp swatch of this hue (weakest → strongest band). */
  ramp?: string;
  /** Glyph drawn inside the dot (Knock mode's outcome discs). */
  icon?: IoniconName;
};

type Props = {
  title?: string;
  items: LegendItem[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const RAMP_OPACITY = [0.22, 0.42, 0.62, 0.85];

export function LegendStrip({ title, items, testID, style }: Props) {
  return (
    <View style={[styles.shadow, style]} pointerEvents="none" testID={testID} accessibilityRole="summary">
      <GlassCard onLight onArt radius={radii.card} style={styles.card}>
        {title ? (
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        <View style={styles.row}>
          {items.map((it) => (
            <View key={it.label} style={styles.item}>
              {it.ramp ? (
                <View style={styles.ramp}>
                  {RAMP_OPACITY.map((o) => (
                    <View key={o} style={[styles.rampCell, { backgroundColor: it.ramp, opacity: o }]} />
                  ))}
                </View>
              ) : (
                <View style={[styles.dot, { backgroundColor: it.color ?? colors.textSubtle }]}>
                  {it.icon ? <Ionicons name={it.icon} size={9} color={colors.textInverse} /> : null}
                </View>
              )}
              <Text style={styles.label} numberOfLines={1}>
                {it.label}
              </Text>
            </View>
          ))}
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: radii.card, alignSelf: 'flex-start', maxWidth: '100%', ...shadows.float },
  card: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  title: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  ramp: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden' },
  rampCell: { width: 9, height: 10 },
  label: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text },
});
