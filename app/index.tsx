import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/auth/authStore';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import { env } from '@/lib/env';
import { colors } from '@/theme/tokens';

// Not a destination screen — a redirect-only route (auth/onboarding gate).
// It renders for a frame at most before <Redirect> fires, so it isn't part
// of the 1A reskin's visual surface; `colors.bg`/`colors.accent` already
// resolve to the 1A palette (paper ground / burnt) with no change needed.

/**
 * True once the persisted onboarding flag has been read back from storage.
 * The store's default is `completed: false`, so rendering the redirect before
 * rehydration sends an onboarded user back to /onboarding. On a cold start
 * the auth store's own init usually outlasts rehydration and hides the race;
 * on a client-side hop to `/` from a deep-linked screen (the Quick
 * Inspection web notice's "Back to dashboard", a notification tap) auth is
 * already initialized and this route renders immediately — so wait here.
 */
function useOnboardingHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useOnboardingStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useOnboardingStore.persist.onFinishHydration(() => setHydrated(true));
    // Rehydration can finish between the initial read and the subscription.
    if (useOnboardingStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);
  return hydrated;
}

export default function Index() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const onboarded = useOnboardingStore((s) => s.completed);
  const onboardingHydrated = useOnboardingHydrated();

  if (!initialized || !onboardingHydrated) {
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
