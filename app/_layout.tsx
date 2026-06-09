import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { useBackgroundJobs } from '@/lib/services/lifecycleHooks';
import { ToastHost } from '@/components/ToastHost';

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
  useEffect(() => {
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
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
