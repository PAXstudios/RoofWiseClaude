import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Tabs, Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabs } from '@/components/shell/BottomTabs';
import { Sidebar } from '@/components/shell/Sidebar';
import { TopBar } from '@/components/shell/TopBar';
import type { TabBarProps, TabHeaderProps } from '@/components/shell/navItems';
import { useResponsive } from '@/theme/useResponsive';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { env } from '@/lib/env';

// A REAL tab navigator. This layout used to render <Slot/>, which expo-router
// 6 backs with a StackRouter: every tab tap was a stack action, so the current
// tab UNMOUNTED and the destination MOUNTED fresh (Map re-fetched NOAA on
// every visit, Home replayed its entrance animation, a deep Slot history
// accumulated, MapView teardown/create raced on quick switches). <Tabs> uses
// the TabRouter: each of the 5 roots mounts once (lazily, on first visit) and
// is then kept alive and re-focused — a tap is a JUMP_TO, never a push.
//
// The chrome stays ours. `tabBar` renders BottomTabs (phone/tablet) or the
// Sidebar (desktop web, tabBarPosition 'left'), and on desktop the TopBar
// rides in as the per-screen header. Same 5 destinations either way (Drift #2).

function ShellTabBar(props: TabBarProps) {
  // The bar decides which chrome to draw from the shared breakpoint hook —
  // the same signal the layout uses to place it (left rail vs bottom edge).
  const { isDesktop } = useResponsive();
  return isDesktop ? <Sidebar {...props} /> : <BottomTabs {...props} />;
}

const renderTabBar = (props: TabBarProps) => <ShellTabBar {...props} />;
const renderHeader = (props: TabHeaderProps) => <TopBar {...props} />;

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

  // Top inset is applied here for every width (zero on web). Bottom inset is
  // owned by BottomTabs itself (nested SafeAreaView) so the bar renders
  // edge-to-edge under the home indicator.
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Tabs
        tabBar={renderTabBar}
        // 'history': Android back / router.back() from a tab returns to the
        // tab you came from (Settings → back lands where you opened it), the
        // closest match to the stack behaviour the Slot shell had.
        backBehavior="history"
        screenOptions={{
          // Desktop web (>= breakpoints.lg): Sidebar rail on the left plus the
          // TopBar header above the scene. Phones and tablets keep the native
          // glove-first bottom bar and no navigator header.
          headerShown: isDesktop,
          header: renderHeader,
          tabBarPosition: isDesktop ? 'left' : 'bottom',
          // Mount each tab on first focus, then keep it.
          lazy: true,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        {/* Drift #2 order: Home / Leads / Map / Plan / Train. */}
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        {/* Leads tab renamed Pipeline — leads and jobs on one board (docs/PIPELINE.md). */}
        <Tabs.Screen name="leads" options={{ title: 'Pipeline' }} />
        <Tabs.Screen name="map" options={{ title: 'Map' }} />
        <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
        <Tabs.Screen name="train" options={{ title: 'Train' }} />
        {/* Settings is a route inside the group (router.push('/settings')
            from Home), never a tab: href null keeps it off every bar. */}
        <Tabs.Screen name="settings" options={{ title: 'Settings', href: null }} />
      </Tabs>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
});
