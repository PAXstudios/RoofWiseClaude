import { ScrollView, View, Text, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { LEADS_SQL } from '@/lib/services/leadSync';
import { INSPECTIONS_SQL } from '@/lib/services/inspectionSync';
import { PHOTOS_SQL } from '@/lib/services/photoSync';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const CLOUD_SQL = `${LEADS_SQL}\n${INSPECTIONS_SQL}\n${PHOTOS_SQL}`;

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
  const toast = useToastStore((s) => s.show);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="About RoofWise" back />

      <ScrollView contentContainerStyle={styles.scroll}>
        <FadeSlideIn index={0}>
          {/* The one cinematic moment on this screen: the same royal-black
              wash the onboarding sky runs on, so "About" reads as the same
              product as the pitch a contractor saw on day one. */}
          <LinearGradient
            colors={gradients.stormNight}
            style={styles.brandCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={styles.brandMark}>
              <Text style={styles.brandInitials}>RW</Text>
            </View>
            <Text style={styles.brandName}>RoofWise</Text>
            <Text style={styles.brandTag}>The objective layer between roofing contractors and insurance carriers.</Text>
            <Text style={styles.version}>Version {VERSION}</Text>
          </LinearGradient>
        </FadeSlideIn>

        <FadeSlideIn index={1} style={styles.section}>
          <SectionHeader title="Features" style={styles.sectionHeaderSpacing} />
          <RichCard padded={false}>
            {FEATURES.map((f, i) => (
              <View key={f.title}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <View style={styles.featureRow}>
                  <IconChip name="checkmark-circle" tone="green" size="sm" />
                  <View style={styles.featureText}>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                    <Text style={styles.featureDesc}>{f.desc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={2} style={styles.section}>
          <SectionHeader title="References" style={styles.sectionHeaderSpacing} />
          <RichCard padded={false}>
            {LINKS.map((l, i) => (
              <View key={l.url}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <PressableScale
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(l.url)}
                  accessibilityRole="link"
                  accessibilityLabel={l.label}
                >
                  <IconChip name="link-outline" tone="blue" size="sm" />
                  <Text style={styles.linkText}>{l.label}</Text>
                  <Ionicons name="open-outline" size={16} color={colors.textSubtle} />
                </PressableScale>
              </View>
            ))}
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={3} style={styles.section}>
          <SectionHeader title="Cloud sync setup" style={styles.sectionHeaderSpacing} />
          <RichCard icon="cloud-outline" iconTone="purple" title="Supabase provisioning">
            <Text style={styles.featureDesc}>
              Run the following once in your Supabase SQL editor to provision the
              leads table with row-level security. Copy → paste → Run.
            </Text>
            <LinearGradient
              colors={gradients.stormNight}
              style={styles.sqlBox}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.sqlText} selectable>{CLOUD_SQL}</Text>
            </LinearGradient>
            <PressableScale
              style={styles.sqlBtnShadow}
              onPress={async () => {
                await Clipboard.setStringAsync(CLOUD_SQL);
                toast({ tone: 'success', title: 'SQL copied' });
              }}
              accessibilityRole="button"
              accessibilityLabel="Copy SQL"
            >
              <LinearGradient
                colors={gradients.accent}
                style={styles.sqlBtn}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Ionicons name="copy-outline" size={18} color={colors.textInverse} />
                <Text style={styles.sqlBtnText}>Copy SQL</Text>
              </LinearGradient>
            </PressableScale>
          </RichCard>
        </FadeSlideIn>

        <Text style={styles.tag}>
          Built for the roofer in gloves on a hot roof.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },

  brandCard: {
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.hero,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandInitials: {
    color: colors.textInverse,
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
  },
  brandName: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
  },
  brandTag: {
    fontSize: fontSize.bodyMd,
    color: colors.textInverse,
    opacity: 0.8,
    textAlign: 'center',
    lineHeight: 22,
  },
  version: {
    fontSize: fontSize.caption,
    color: colors.textInverse,
    opacity: 0.6,
    marginTop: spacing.sm,
  },

  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },

  featureRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'flex-start',
  },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  featureDesc: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
  },
  linkText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },

  tag: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  sqlBox: {
    borderRadius: radii.control,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  sqlText: {
    fontSize: fontSize.caption,
    color: colors.textInverse,
    fontFamily: 'Courier',
    lineHeight: 16,
  },
  sqlBtnShadow: { borderRadius: radii.button, marginTop: spacing.xs },
  sqlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  sqlBtnText: {
    color: colors.textInverse,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },
});
