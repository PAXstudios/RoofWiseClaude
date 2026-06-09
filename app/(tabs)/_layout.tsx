import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Slot, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import { BottomTabs } from '@/components/shell/BottomTabs';
import { useResponsive } from '@/theme/useResponsive';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';

export default function TabsLayout() {
  const { isWide } = useResponsive();
  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);

  if (!initialized) {
    return (
      <View style={[styles.mobile, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/welcome" />;
  }

  if (isWide) {
    return (
      <View style={styles.desktop}>
        <Sidebar />
        <View style={styles.desktopMain}>
          <TopBar />
          <View style={styles.desktopContent}>
            <Slot />
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.mobile} edges={['top']}>
      <View style={styles.mobileContent}>
        <Slot />
      </View>
      <BottomTabs />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  desktop: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg,
  },
  desktopMain: { flex: 1 },
  desktopContent: { flex: 1, backgroundColor: colors.bg },
  mobile: { flex: 1, backgroundColor: colors.bg },
  mobileContent: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
