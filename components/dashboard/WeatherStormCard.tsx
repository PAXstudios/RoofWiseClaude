import { View, Text, ImageBackground, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

const STORM_IMG =
  'https://images.unsplash.com/photo-1561484930-998b6a7b22e8?w=1200&q=80&auto=format&fit=crop';

export function WeatherStormCard({ onPress }: { onPress?: () => void }) {
  return (
    <View style={styles.outer}>
      <ImageBackground
        source={{ uri: STORM_IMG }}
        style={styles.bg}
        imageStyle={styles.bgImg}
      >
        <LinearGradient
          colors={['rgba(14,17,22,0.0)', 'rgba(14,17,22,0.5)', 'rgba(14,17,22,0.85)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.topRow}>
          <View style={styles.alertPill}>
            <Ionicons name="warning" size={12} color={colors.surface} />
            <Text style={styles.alertLabel}>STORM ALERT</Text>
          </View>
          <View style={styles.tempCol}>
            <Text style={styles.temp}>72°</Text>
            <Text style={styles.tempLabel}>Rain & Hail Expected</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>Severe Hail Warning</Text>
          <Text style={styles.subtitle}>
            4 properties in your lead list are in the high-impact zone.
          </Text>
          <Pressable style={styles.cta} onPress={onPress}>
            <Text style={styles.ctaLabel}>View Impacted Properties</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.brand} />
          </Pressable>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  bg: {
    minHeight: 280,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  bgImg: {
    borderRadius: radii.lg,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  alertPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  alertLabel: {
    color: colors.surface,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
  },
  tempCol: { alignItems: 'flex-end' },
  temp: {
    color: colors.surface,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  tempLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  body: { gap: spacing.sm },
  title: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  ctaLabel: {
    color: colors.brand,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
});
