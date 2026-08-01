import { useEffect } from 'react';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { useBackgroundJobs } from '@/lib/services/lifecycleHooks';
import { ToastHost } from '@/components/ToastHost';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const router = useRouter();
  useBackgroundJobs();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    initialize().then((u) => { unsubscribe = u; });
    return () => { unsubscribe?.(); };
  }, [initialize]);

  // Deep-link from notification taps. Routes Storm Watch alerts to the
  // alert detail sheet and the weekly calibration nudge to the Train tab.
  // Gated on navigator readiness — a cold launch from a notification tap
  // delivers the pending response immediately, which can beat the root
  // navigator's mount and throw "Attempted to navigate before mounting".
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!navReady) return;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as
        | { kind?: string; alertId?: string }
        | undefined;
      if (data?.kind === 'storm_alert' && data.alertId) {
        router.push({ pathname: '/storm-alert/[id]', params: { id: data.alertId } } as any);
      } else if (data?.kind === 'calibration_weekly') {
        router.push('/(tabs)/train');
      }
    });
    return () => sub.remove();
  }, [navReady, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* Wraps the navigator, not the app root, so the crash screen still
            renders inside the safe area and a recovery re-mounts routing. */}
        <ErrorBoundary>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        </ErrorBoundary>
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
