import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/auth/authStore';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import { env } from '@/lib/env';
import { colors } from '@/theme/tokens';

export default function Index() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const onboarded = useOnboardingStore((s) => s.completed);

  if (!initialized) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Drift #12: auth is only enforced when the flag is on. With
  // requireAuth false (dev default) the app is usable signed-out.
  if (!session && env.REQUIRE_AUTH) return <Redirect href="/welcome" />;
  if (!onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
