import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/auth/authStore';
import { AppleSignInButton } from '@/components/AppleSignInButton';
import { colors, radii, spacing, fontSize, fontWeight, shadows } from '@/theme/tokens';

type Mode = 'sign-in' | 'sign-up' | 'reset';

export default function WelcomeScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signInWithEmail);
  const signUp = useAuthStore((s) => s.signUpWithEmail);
  const sendReset = useAuthStore((s) => s.sendPasswordReset);
  const clearError = useAuthStore((s) => s.clearError);

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  const switchMode = (next: Mode) => {
    clearError();
    setResetSent(false);
    setMode(next);
  };

  const onSubmit = async () => {
    try {
      if (mode === 'sign-in') await signIn(email.trim(), password);
      else if (mode === 'sign-up') await signUp(email.trim(), password);
      else {
        await sendReset(email.trim());
        setResetSent(true);
      }
    } catch {
      // error already in the store
    }
  };

  const canSubmit =
    email.trim().length > 0 && (mode === 'reset' || password.length >= 6) && !loading;

  return (
    <LinearGradient
      colors={[colors.navy, '#16275f']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <StatusBar style="light" />
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
            <View style={styles.brand}>
              <View style={styles.logoMark}>
                <Text style={styles.logoText}>RW</Text>
              </View>
              <Text style={styles.title}>RoofWise</Text>
              <Text style={styles.subtitle}>
                Forensic roof inspections & HAAG claim packets, in your pocket.
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {mode === 'sign-in' && 'Welcome back'}
                {mode === 'sign-up' && 'Create your account'}
                {mode === 'reset' && 'Reset password'}
              </Text>

              {mode !== 'reset' && (
                <>
                  <AppleSignInButton />
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>
                </>
              )}

              {error ? (
                <View style={styles.banner}>
                  <Text style={styles.bannerText}>{error}</Text>
                </View>
              ) : null}

              {resetSent ? (
                <View style={styles.bannerSuccess}>
                  <Text style={styles.bannerSuccessText}>
                    Check your email for a reset link.
                  </Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@company.com"
                  placeholderTextColor={colors.textSubtle}
                />
              </View>

              {mode !== 'reset' && (
                <View style={styles.field}>
                  <Text style={styles.label}>Password</Text>
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    secureTextEntry
                    placeholder="At least 6 characters"
                    placeholderTextColor={colors.textSubtle}
                  />
                </View>
              )}

              <Pressable
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                onPress={onSubmit}
                disabled={!canSubmit}
              >
                {loading ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {mode === 'sign-in' && 'Sign in'}
                    {mode === 'sign-up' && 'Create account'}
                    {mode === 'reset' && 'Send reset link'}
                  </Text>
                )}
              </Pressable>

              <View style={styles.footer}>
                {mode === 'sign-in' && (
                  <>
                    <Pressable onPress={() => switchMode('sign-up')}>
                      <Text style={styles.link}>Create account</Text>
                    </Pressable>
                    <Pressable onPress={() => switchMode('reset')}>
                      <Text style={styles.link}>Forgot password?</Text>
                    </Pressable>
                  </>
                )}
                {mode === 'sign-up' && (
                  <Pressable onPress={() => switchMode('sign-in')}>
                    <Text style={styles.link}>Already have an account? Sign in</Text>
                  </Pressable>
                )}
                {mode === 'reset' && (
                  <Pressable onPress={() => switchMode('sign-in')}>
                    <Text style={styles.link}>Back to sign in</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  brand: { alignItems: 'center', marginTop: spacing.xxxl },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.pressed,
  },
  logoText: {
    color: colors.textInverse,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  title: {
    color: colors.textInverse,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: fontSize.md,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xl,
    marginTop: spacing.xxxl,
    ...shadows.card,
  },
  cardTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  banner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { color: colors.danger, fontSize: fontSize.sm },
  bannerSuccess: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerSuccessText: { color: colors.success, fontSize: fontSize.sm },
  field: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    height: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  primaryBtn: {
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  footer: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  link: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
});
