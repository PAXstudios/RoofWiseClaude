import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { RoofWiseBrand } from '@/components/ui/RoofWiseBrand';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import { MeshBackground } from '@/components/ui/MeshBackground';
import { GlassCard } from '@/components/glass/GlassCard';
import { AppleSignInButton } from '@/components/AppleSignInButton';
import { useAuthStore } from '@/lib/auth/authStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { env } from '@/lib/env';
import {
  brand,
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Mode = 'signin' | 'signup';

export default function Welcome() {
  const router = useRouter();
  const complete = useOnboardingStore((s) => s.complete);
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signInWithEmail);
  const signUp = useAuthStore((s) => s.signUpWithEmail);
  const sendReset = useAuthStore((s) => s.sendPasswordReset);
  const loading = useAuthStore((s) => s.loading);
  const toast = useToastStore((s) => s.show);

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (session) {
      complete();
      router.dismissTo('/(tabs)');
    }
  }, [complete, router, session]);

  const enterAsGuest = () => {
    complete();
    router.dismissTo('/(tabs)');
  };

  const isSignUp = mode === 'signup';

  // iOS-17 segmented control — a glass thumb spring-slides between the
  // two options instead of each option repainting its own background.
  const [segWidth, setSegWidth] = useState(0);
  const segThumbX = useSharedValue(0);
  const segThumbW = segWidth > 0 ? (segWidth - spacing.xs * 2) / 2 : 0;

  useEffect(() => {
    if (segWidth > 0) {
      segThumbX.value = withSpring(isSignUp ? 0 : segThumbW, motion.snappy);
    }
  }, [isSignUp, segWidth, segThumbW, segThumbX]);

  const segThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: segThumbX.value }],
  }));

  const passwordChecks = useMemo(
    () => [
      { label: 'At least 8 characters', ok: password.length >= 8 },
      { label: 'A number', ok: /\d/.test(password) },
      { label: 'Upper and lower case', ok: /[a-z]/.test(password) && /[A-Z]/.test(password) },
    ],
    [password],
  );

  const canSubmit =
    email.trim().length > 3 &&
    password.length >= 8 &&
    (!isSignUp || (name.trim().length > 1 && passwordChecks.every((c) => c.ok)));

  const submit = async () => {
    if (!canSubmit || loading) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      if (isSignUp) {
        const signedIn = await signUp(email.trim(), password, name);
        if (!signedIn) {
          toast({ tone: 'info', title: 'Check your email', body: 'Confirm your account, then sign in.' });
          setMode('signin');
        }
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      toast({
        tone: 'danger',
        title: isSignUp ? 'Could not create account' : 'Could not sign in',
        body: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const onForgot = async () => {
    if (email.trim().length < 4) {
      toast({ tone: 'warn', title: 'Enter your email first' });
      return;
    }
    try {
      await sendReset(email.trim());
      toast({ tone: 'success', title: 'Reset link sent', body: `Check ${email.trim()}` });
    } catch (e) {
      toast({
        tone: 'danger',
        title: 'Could not send reset link',
        body: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <View style={styles.root}>
      {/* Fade rather than slide on the way in from onboarding and on the way
          out into the app — a hard slide-cut is what makes a dark/mesh
          screen and a light one read as two different products; a fade lets
          the mesh glow dissolve instead of getting yanked offscreen. Auth
          logic and provider buttons are unchanged — this is presentation
          only, scoped to this screen's own transition. */}
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar style="dark" />
      <MeshBackground variant="hero" />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeIn.duration(motion.enterMs)} style={styles.header}>
              <RoofWiseBrand />
              <Text style={styles.title}>
                {isSignUp ? 'Create an account' : 'Sign in to RoofWise'}
              </Text>
              <Text style={styles.subtitle}>
                {isSignUp
                  ? 'Use your name on the inspection reports you prepare.'
                  : 'Sign in to sync your jobs and inspections.'}
              </Text>
            </Animated.View>

            {!env.REQUIRE_AUTH && (
              <Pressable
                style={styles.explore}
                onPress={enterAsGuest}
                disabled={loading}
                accessibilityRole="button"
                accessibilityHint="Opens the workspace on this device"
              >
                <Text style={styles.exploreText}>Continue as guest</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.tileBlueInk} />
              </Pressable>
            )}

            <Animated.View
              entering={FadeInDown.duration(motion.enterMs).delay(60)}
              onLayout={(e) => setSegWidth(e.nativeEvent.layout.width)}
            >
              {/* Real frosted glass (BlurView on iOS) rather than a flat
                  tint — the segmented control is the first thing a returning
                  user's thumb touches, so it is the one control on this
                  screen worth the literal onboarding surface. */}
              <GlassCard level="base" onLight onArt radius={radii.control + 2} style={styles.segment}>
                {segThumbW > 0 && (
                  <Animated.View
                    style={[styles.segmentThumb, { width: segThumbW }, segThumbStyle]}
                  />
                )}
                {(['signup', 'signin'] as Mode[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    style={styles.segmentItem}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mode === m }}
                  >
                    <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                      {m === 'signup' ? 'Sign up' : 'Sign in'}
                    </Text>
                  </Pressable>
                ))}
              </GlassCard>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(motion.enterMs).delay(120)}
              style={styles.providers}
            >
              <AppleSignInButton />
              <Pressable
                style={styles.provider}
                onPress={() =>
                  toast({
                    tone: 'info',
                    title: 'Google sign-in needs a dev build',
                    body: 'Available once RoofWise runs outside Expo Go. Use email for now.',
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
              >
                <Ionicons name="logo-google" size={18} color={colors.text} />
                <Text style={styles.providerText}>Continue with Google</Text>
              </Pressable>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(motion.enterMs).delay(160)}
              style={styles.dividerRow}
            >
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or use email</Text>
              <View style={styles.divider} />
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(motion.enterMs).delay(200)}
              style={styles.form}
            >
              {isSignUp && (
                <Field
                  icon="person-outline"
                  placeholder="Full name"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  textContentType="name"
                />
              )}
              <Field
                icon="mail-outline"
                placeholder="Email address"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
              />
              <Field
                icon="lock-closed-outline"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                textContentType={isSignUp ? 'newPassword' : 'password'}
                trailing={
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={19}
                      color={colors.textMuted}
                    />
                  </Pressable>
                }
              />

              {isSignUp && password.length > 0 && (
                <Animated.View entering={FadeIn.duration(220)} style={styles.checks}>
                  {passwordChecks.map((c) => (
                    <View key={c.label} style={styles.checkRow}>
                      <Ionicons
                        name={c.ok ? 'checkmark-circle' : 'ellipse-outline'}
                        size={15}
                        color={c.ok ? colors.success : colors.onMesh}
                        style={c.ok ? undefined : styles.checkIconMuted}
                      />
                      <Text style={[styles.checkText, c.ok && styles.checkTextOk]}>{c.label}</Text>
                    </View>
                  ))}
                </Animated.View>
              )}

              <Pressable
                onPress={submit}
                disabled={!canSubmit || loading}
                style={({ pressed }) => [
                  styles.cta,
                  (!canSubmit || loading) && styles.ctaDisabled,
                  pressed && canSubmit && styles.ctaPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={isSignUp ? 'Create account' : 'Sign in'}
              >
                {loading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <>
                    <Text style={[styles.ctaText, (!canSubmit || loading) && { color: colors.textMuted }]}>{isSignUp ? 'Create account' : 'Sign in'}</Text>
                    <Ionicons name="arrow-forward" size={19} color={canSubmit ? colors.textInverse : colors.textMuted} />
                  </>
                )}
              </Pressable>

              {!isSignUp && (
                <Pressable style={styles.link} hitSlop={8} onPress={onForgot}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </Pressable>
              )}
            </Animated.View>

            <Text style={styles.legal}>
              By continuing you agree to the RoofWise Terms of Service and Privacy Policy.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Field({
  icon,
  trailing,
  ...input
}: React.ComponentProps<typeof TextInput> & {
  icon: keyof typeof Ionicons.glyphMap;
  trailing?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <Ionicons name={icon} size={19} color={colors.textMuted} />
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor={colors.textSubtle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  // Dark edge under the mesh — matches the ramp's own 0% stop.
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },

  header: { gap: spacing.sm, marginTop: spacing.md },
  title: {
    color: colors.text,
    fontFamily: fontFamily.archivo.bold,
    fontSize: fontSize.titleLg,
    marginTop: spacing.lg,
  },
  subtitle: {
    color: colors.onMesh,
    opacity: 0.75,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodyMd,
    lineHeight: 21,
  },

  // Background/border/radius now come from the wrapping GlassCard; this
  // style only positions the two segment items inside it.
  segment: {
    flexDirection: 'row',
    padding: spacing.xs,
    minHeight: touchTarget.standard,
  },
  segmentThumb: {
    position: 'absolute',
    top: spacing.xs,
    bottom: spacing.xs,
    left: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: colors.brandSoft,
    ...shadows.thumb,
  },
  segmentItem: {
    flex: 1,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    color: colors.text,
    opacity: 0.6,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },
  segmentTextActive: { color: colors.text, opacity: 1 },

  providers: { gap: spacing.sm },
  // Smoke fill/border — the over-ART glass pair (GlassCard's `onArt`,
  // docs/DESIGN_1A.md) — holds contrast over every part of the ramp, unlike
  // `glass.fill` alone which is tuned for a flat ground.
  provider: {
    minHeight: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  providerText: {
    color: colors.text,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: glass.border },
  dividerText: {
    color: colors.textMuted,
    opacity: 1,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodySm,
  },

  form: { gap: spacing.md },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldFocused: { borderColor: brand.royal, backgroundColor: glass.fill },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodyLg,
    paddingVertical: spacing.md,
  },

  checks: { gap: 6, paddingHorizontal: spacing.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkText: {
    color: colors.onMesh,
    opacity: 0.55,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodySm,
  },
  checkTextOk: { color: colors.onMesh, opacity: 0.95 },
  checkIconMuted: { opacity: 0.4 },

  // touchTarget.sticky (88) kept per Drift #1 / docs §4. shadows.hero is the
  // "coloured shadow" §6 calls for on the sticky pill CTA.
  cta: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: brand.burnt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    ...shadows.hero,
  },
  ctaPressed: { backgroundColor: brand.burntDeep, transform: [{ scale: 0.985 }] },
  ctaDisabled: { backgroundColor: colors.fillDisabled },
  ctaText: {
    color: colors.textInverse,
    fontFamily: fontFamily.archivo.bold,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.bodyLg,
  },

  link: { alignSelf: 'center', minHeight: touchTarget.standard, justifyContent: 'center' },
  linkText: {
    color: colors.onMesh,
    opacity: 0.65,
    fontFamily: fontFamily.archivo.medium,
    fontSize: fontSize.bodyMd,
  },

  explore: {
    backgroundColor: colors.surface,
    borderColor: colors.headerBorder,
    borderWidth: 1,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
  },
  exploreText: {
    color: colors.tileBlueInk,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.medium,
    fontSize: fontSize.bodyMd,
  },

  legal: {
    color: colors.onMesh,
    opacity: 0.4,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.caption,
    textAlign: 'center',
    lineHeight: 16,
  },
});
