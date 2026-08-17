// Auth — the terminus of onboarding.
//
// Same black-and-glass world as the onboarding scenes so the handoff is
// seamless; the app itself then opens on white. Three ways in (Apple,
// Google, email) and a name is required on sign-up: it goes on every HAAG
// report and proposal this inspector produces, so we ask once, here.

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
import { Aurora } from '@/components/glass/Aurora';
import { AppleSignInButton } from '@/components/AppleSignInButton';
import { useAuthStore } from '@/lib/auth/authStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { env } from '@/lib/env';
import {
  brand,
  colors,
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
  const signIn = useAuthStore((s) => s.signInWithEmail);
  const signUp = useAuthStore((s) => s.signUpWithEmail);
  const sendReset = useAuthStore((s) => s.sendPasswordReset);
  const loading = useAuthStore((s) => s.loading);
  const toast = useToastStore((s) => s.show);

  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
        await signUp(email.trim(), password, name);
        toast({ tone: 'success', title: `Welcome, ${name.trim().split(/\s+/)[0]}` });
      } else {
        await signIn(email.trim(), password);
      }
      router.replace('/(tabs)');
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
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <Aurora />

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
              <View style={styles.brandMark}>
                <Ionicons name="shield-checkmark" size={20} color={colors.textInverse} />
              </View>
              <Text style={styles.title}>
                {isSignUp ? 'Create your\naccount' : 'Welcome\nback'}
              </Text>
              <Text style={styles.subtitle}>
                {isSignUp
                  ? 'Your name goes on every report you send to a carrier.'
                  : 'Sign in to pick up where you left off.'}
              </Text>
            </Animated.View>

            <Animated.View
              entering={FadeInDown.duration(motion.enterMs).delay(60)}
              style={styles.segment}
              onLayout={(e) => setSegWidth(e.nativeEvent.layout.width)}
            >
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
                <Ionicons name="logo-google" size={18} color={colors.textInverse} />
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
                      color="rgba(255,255,255,0.55)"
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
                        color={c.ok ? colors.success : 'rgba(255,255,255,0.35)'}
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
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <>
                    <Text style={styles.ctaText}>{isSignUp ? 'Create account' : 'Sign in'}</Text>
                    <Ionicons name="arrow-forward" size={19} color={colors.textInverse} />
                  </>
                )}
              </Pressable>

              {!isSignUp && (
                <Pressable style={styles.link} hitSlop={8} onPress={onForgot}>
                  <Text style={styles.linkText}>Forgot password?</Text>
                </Pressable>
              )}
            </Animated.View>

            {/* Drift #12: when auth isn't required, let people look around. */}
            {!env.REQUIRE_AUTH && (
              <Animated.View entering={FadeInDown.duration(motion.enterMs).delay(260)}>
                <Pressable
                  style={styles.explore}
                  onPress={() => router.replace('/(tabs)')}
                  accessibilityRole="button"
                  accessibilityLabel="Explore the app without an account"
                >
                  <Text style={styles.exploreText}>Explore without an account</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.55)" />
                </Pressable>
              </Animated.View>
            )}

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
      <Ionicons name={icon} size={19} color="rgba(255,255,255,0.5)" />
      <TextInput
        {...input}
        style={styles.input}
        placeholderTextColor="rgba(255,255,255,0.38)"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.black },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },

  header: { gap: spacing.sm, marginTop: spacing.md },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: brand.royal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.textInverse,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    lineHeight: 38,
  },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: fontSize.bodyMd, lineHeight: 21 },

  segment: {
    flexDirection: 'row',
    backgroundColor: glass.fill,
    borderRadius: radii.control + 2,
    padding: spacing.xs,
    minHeight: touchTarget.standard,
  },
  segmentThumb: {
    position: 'absolute',
    top: spacing.xs,
    bottom: spacing.xs,
    left: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: glass.fillHigh,
    ...shadows.thumb,
  },
  segmentItem: {
    flex: 1,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },
  segmentTextActive: { color: colors.textInverse },

  providers: { gap: spacing.sm },
  provider: {
    minHeight: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  providerText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: glass.border },
  dividerText: { color: 'rgba(255,255,255,0.42)', fontSize: fontSize.bodySm },

  form: { gap: spacing.md },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: glass.fillLow,
    borderWidth: 1,
    borderColor: glass.border,
  },
  fieldFocused: { borderColor: brand.royal, backgroundColor: glass.fill },
  input: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    paddingVertical: spacing.md,
  },

  checks: { gap: 6, paddingHorizontal: spacing.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkText: { color: 'rgba(255,255,255,0.5)', fontSize: fontSize.bodySm },
  checkTextOk: { color: 'rgba(255,255,255,0.85)' },

  cta: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: brand.burnt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  ctaPressed: { backgroundColor: brand.burntDeep, transform: [{ scale: 0.985 }] },
  ctaDisabled: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  link: { alignSelf: 'center', minHeight: touchTarget.standard, justifyContent: 'center' },
  linkText: { color: 'rgba(255,255,255,0.6)', fontSize: fontSize.bodyMd },

  explore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
  },
  exploreText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
  },

  legal: {
    color: 'rgba(255,255,255,0.32)',
    fontSize: fontSize.caption,
    textAlign: 'center',
    lineHeight: 16,
  },
});
