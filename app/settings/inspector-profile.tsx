import { useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function InspectorProfileScreen() {
  const router = useRouter();
  const profile = useInspectorProfileStore((s) => s.profile);
  const update = useInspectorProfileStore((s) => s.update);
  const toast = useToastStore((s) => s.show);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Inspector profile" back />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FadeSlideIn index={0}>
          <Text style={styles.help}>
            Appears on HAAG reports and proposals. Trust-weighted in the recursive
            learning loop when HAAG-certified.
          </Text>
        </FadeSlideIn>

        <Section index={1} title="Identity">
          <Field
            label="Full name"
            value={profile.fullName}
            onChangeText={(t) => update({ fullName: t })}
            placeholder="Derrick Robinson"
          />
          <Sep />
          <Field
            label="Phone"
            value={profile.phone}
            onChangeText={(t) => update({ phone: t })}
            placeholder="(555) 555-0100"
            keyboardType="phone-pad"
          />
          <Sep />
          <Field
            label="State license number"
            value={profile.licenseNumber ?? ''}
            onChangeText={(t) => update({ licenseNumber: t })}
            placeholder="Optional"
            autoCapitalize="characters"
          />
        </Section>

        <Section index={2} title="HAAG certification">
          <PressableScale
            style={styles.toggleRow}
            onPress={() => update({ haagCertified: !profile.haagCertified })}
            accessibilityRole="switch"
            accessibilityState={{ checked: profile.haagCertified }}
            accessibilityLabel="I'm HAAG certified"
          >
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>I'm HAAG certified</Text>
              <Text style={styles.toggleSub}>
                Trust-weighted 5x in retraining. Required for some insurance carriers.
              </Text>
            </View>
            <SwitchVisual on={profile.haagCertified} />
          </PressableScale>

          {profile.haagCertified && (
            <>
              <Sep />
              <Field
                label="HAAG certification number"
                value={profile.haagCertificationNumber ?? ''}
                onChangeText={(t) => update({ haagCertificationNumber: t })}
                placeholder="e.g. HAAG-12345"
                autoCapitalize="characters"
              />
            </>
          )}

          <Sep />
          <Field
            label="Years of experience"
            value={String(profile.yearsExperience)}
            onChangeText={(t) => update({ yearsExperience: Math.max(0, parseInt(t || '0', 10)) })}
            keyboardType="number-pad"
            placeholder="0"
          />
        </Section>

        <Section index={3} title="Safety">
          <Field
            label="Emergency contact name"
            value={profile.emergencyContact ?? ''}
            onChangeText={(t) => update({ emergencyContact: t })}
            placeholder="Optional"
          />
          <Sep />
          <Field
            label="Emergency contact phone"
            value={profile.emergencyPhone ?? ''}
            onChangeText={(t) => update({ emergencyPhone: t })}
            placeholder="Optional"
            keyboardType="phone-pad"
          />
        </Section>

        <FadeSlideIn index={4}>
          <PressableScale
            style={styles.doneBtnShadow}
            onPress={() => {
              toast({ tone: 'success', title: 'Profile saved' });
              router.back();
            }}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <LinearGradient
              colors={gradients.accent}
              style={styles.doneBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </LinearGradient>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  index,
  children,
}: {
  title: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <FadeSlideIn index={index} style={styles.section}>
      <SectionHeader title={title} style={styles.sectionHeaderSpacing} />
      <RichCard padded={false}>{children}</RichCard>
    </FadeSlideIn>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

/** A grouped-list input cell: 13pt label over a borderless 17pt input.
 *  The white cell itself is the field — no heavy outlined box. */
function Field({
  label,
  ...rest
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textSubtle}
        {...rest}
      />
    </View>
  );
}

/** iOS-style switch visual — the enclosing 56pt row is the touch target. */
function SwitchVisual({ on }: { on: boolean }) {
  const x = useSharedValue(on ? 20 : 0);

  useEffect(() => {
    x.value = withSpring(on ? 20 : 0, motion.snappy);
  }, [on, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
      <Animated.View style={[styles.switchThumb, thumbStyle]} />
    </View>
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
  help: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },

  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },

  fieldCell: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  input: {
    fontSize: fontSize.bodyLg,
    color: colors.text,
    paddingVertical: spacing.xs,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  toggleText: { flex: 1 },
  toggleLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  toggleSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },

  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.success },
  switchThumb: {
    width: 27,
    height: 27,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },

  doneBtnShadow: { borderRadius: radii.button, ...shadows.raised },
  doneBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
});
