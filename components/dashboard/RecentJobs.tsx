import { View, Text, ScrollView, ImageBackground, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Pill } from '@/components/ui/Pill';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { recentJobs, statusTone } from '@/lib/mock/recentJobs';
import { colors, fontSize, fontWeight, radii, spacing, shadows } from '@/theme/tokens';

export function RecentJobs() {
  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader title="Recent Jobs" action="See All" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {recentJobs.map((job) => (
          <Pressable key={job.id} style={[styles.card, shadows.card]}>
            <ImageBackground
              source={{ uri: job.photoUrl }}
              style={styles.image}
              imageStyle={styles.imageRadius}
            >
              <LinearGradient
                colors={['rgba(14,17,22,0.0)', 'rgba(14,17,22,0.85)']}
                locations={[0.45, 1]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.statusRow}>
                <Pill label={job.status} tone={statusTone[job.status]} solid />
              </View>
              <View style={styles.body}>
                <Text style={styles.property}>{job.property}</Text>
                <View style={styles.addressRow}>
                  <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.85)" />
                  <Text style={styles.address} numberOfLines={1}>
                    {job.address}
                  </Text>
                </View>
                <Text style={styles.subtitle}>{job.subtitle}</Text>
              </View>
            </ImageBackground>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  scroller: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    width: 240,
    height: 180,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  image: { flex: 1, justifyContent: 'flex-end' },
  imageRadius: { borderRadius: radii.lg },
  statusRow: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    alignItems: 'flex-end',
  },
  body: { padding: spacing.lg, gap: 2 },
  property: {
    color: colors.surface,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  address: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  subtitle: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.7)',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
});
