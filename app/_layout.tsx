import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { ToastHost } from '@/components/ToastHost';

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    initialize().then((u) => { unsubscribe = u; });
    return () => { unsubscribe?.(); };
  }, [initialize]);

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
