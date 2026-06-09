import { ScrollView, View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const VERSION = Constants.expoConfig?.version ?? '0.1.0';

const FEATURES = [
  { title: 'Forensic Quick Inspection', desc: 'Camera → Gemini Vision → HAAG-protocol verdicts.' },
  { title: 'Auto storm match', desc: 'NOAA ≥0.75" hail / ≥58 mph wind within 5 mi / ±30 d stamped on every inspection.' },
  { title: 'Recursive learning', desc: 'Every correction calibrates Gemini per inspector; trust-weighted server retraining.' },
  { title: 'HAAG PDF + Proposal PDF', desc: 'Signatures, line items, branded covers.' },
  { title: 'Storm Watch + push', desc: 'Background polling for your service area; local push when severe events hit.' },
  { title: 'Door knocking + Mileage', desc: 'Live route stats, lead auto-creation, IRS deductible.' },
];

const LINKS = [
  { label: 'HAAG protocol overview', url: 'https://haageducation.com' },
  { label: 'NOAA Storm Events', url: 'https://www.ncdc.noaa.gov/stormevents/' },
  { label: 'Google AI Studio (Gemini)', url: 'https://aistudio.google.com' },
];

export default function AboutScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>About RoofWise</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brandCard}>
          <View style={styles.brandMark}>
            <Text style={styles.brandInitials}>RW</Text>
          </View>
          <Text style={styles.brandName}>RoofWise</Text>
          <Text style={styles.brandTag}>The objective layer between roofing contractors and insurance carriers.</Text>
          <Text style={styles.version}>Version {VERSION}</Text>
        </View>

        <Text style={styles.sectionLabel}>Features</Text>
        <View style={styles.card}>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={[styles.featureRow, i > 0 && styles.rowBorder]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>References</Text>
        <View style={styles.card}>
          {LINKS.map((l, i) => (
            <Pressable
              key={l.url}
              style={[styles.linkRow, i > 0 && styles.rowBorder]}
              onPress={() => Linking.openURL(l.url)}
            >
              <Ionicons name="link-outline" size={18} color={colors.accent} />
              <Text style={styles.linkText}>{l.label}</Text>
              <Ionicons name="open-outline" size={16} color={colors.slate} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.tag}>
          Built for the roofer in gloves on a hot roof.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },

  brandCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  brandMark: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: colors.textInverse, fontSize: fontSize.titleLg, fontWeight: fontWeight.bold },
  brandName: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.cream },
  brandTag: { fontSize: fontSize.bodyMd, color: 'rgba(240,240,228,0.82)', textAlign: 'center', lineHeight: 22 },
  version: { fontSize: fontSize.caption, color: 'rgba(240,240,228,0.62)', marginTop: spacing.sm },

  sectionLabel: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  featureRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'flex-start',
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  featureTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  featureDesc: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2, lineHeight: 18 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  linkText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },

  tag: { fontSize: fontSize.bodySm, color: colors.slate, textAlign: 'center', fontStyle: 'italic', marginTop: spacing.xl },
});
