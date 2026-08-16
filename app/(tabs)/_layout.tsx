import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Slot, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabs } from '@/components/shell/BottomTabs';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { useResponsive } from '@/theme/useResponsive';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { env } from '@/lib/env';

export default function TabsLayout() {
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const { isDesktop } = useResponsive();

  if (!initialized) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Drift #12: redirect only when auth is actually required.
  if (!session && env.REQUIRE_AUTH) {
    return <Redirect href="/welcome" />;
  }

  // Desktop web (>= breakpoints.lg): Sidebar + TopBar shell, tab bar hidden.
  // Same 5 destinations (Drift #2) — only the chrome changes with width.
  if (isDesktop) {
    return (
      <View style={styles.desktopRoot}>
        <Sidebar />
        <View style={styles.desktopMain}>
          <TopBar />
          <View style={styles.content}>
            <Slot />
          </View>
        </View>
      </View>
    );
  }

  // Phones and tablets keep the native glove-first shell unchanged.
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Slot />
      </View>
      <BottomTabs />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  desktopRoot: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  desktopMain: { flex: 1 },
});
