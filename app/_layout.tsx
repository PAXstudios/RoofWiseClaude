import { useCallback, useEffect } from 'react';
import { Stack, useRootNavigationState, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { colors } from '@/theme/tokens';
import { useAuthStore } from '@/lib/auth/authStore';
import { useBackgroundJobs } from '@/lib/services/lifecycleHooks';
import { useAutomationTicks } from '@/lib/services/automationHooks';
import { ToastHost } from '@/components/ToastHost';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { install as installDiagnostics, DiagnosticsGate } from '@/lib/services/diagnostics';
import { installUiRuntimeGuard } from '@/lib/services/uiRuntimeGuard';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { startWatching as resumeKnockTracking } from '@/components/knock/sessionTracker';

// Module-level, not inside RootLayout: the global JS-error / promise-rejection
// / console.error hooks must exist BEFORE the root layout's first render, or a
// throw during that render (the "keeps crashing" boot case) is the one crash
// diagnostics can never record. Idempotent, and it never throws.
installDiagnostics();
// A JS exception thrown inside a Reanimated worklet on the UI thread escapes as
// a C++ exception and aborts the process (the owner's Expo Go SIGABRT via
// worklets::UIScheduler::triggerUI). This installs the UI-runtime error handler
// so such a throw is recorded to Diagnostics instead of killing the app.
installUiRuntimeGuard();

// Archivo (docs/DESIGN_1A.md §3) is load-bearing to the whole identity — the
// splash screen stays up until it's ready rather than letting the system
// font flash for a frame. Idempotent; a second call is a no-op.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const initialize = useAuthStore((s) => s.initialize);
  const router = useRouter();
  useBackgroundJobs();
  const [fontsReady, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
  });
  // A font-load failure (offline first launch, corrupt cache) must never
  // brick the app — fall through to the system font rather than hang on
  // the splash screen forever.
  const ready = fontsReady || !!fontError;
  const onLayout = useCallback(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  // The pipeline automation engine's daily ticks (idle-7d, follow-up-due) —
  // the event-driven rules fire from the stores themselves; this drives the
  // time-based ones. Mounted once, at the root.
  useAutomationTicks();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    // If cleanup ran before initialize() settled (React 19 StrictMode / Fast
    // Refresh), release the auth listener as soon as it arrives instead of
    // leaking it.
    initialize().then((u) => {
      if (cancelled) u();
      else unsubscribe = u;
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [initialize]);

  // A knock route left running (the roofer closed the app mid-street) gets
  // its GPS watcher back on the next launch, so miles and the walked path
  // resume before Knock mode is even opened. Waits for the persisted session
  // to hydrate; does nothing when no route is active (no location prompt).
  useEffect(() => {
    const resume = () => {
      if (useKnockSessionStore.getState().activeSession) resumeKnockTracking().catch(() => {});
    };
    if (useKnockSessionStore.persist.hasHydrated()) {
      resume();
      return;
    }
    return useKnockSessionStore.persist.onFinishHydration(resume);
  }, []);

  // Deep-link from notification taps. Routes Storm Watch alerts to the
  // alert detail sheet, a lead follow-up reminder to that lead, and the
  // weekly calibration nudge to the Train tab.
  // Gated on navigator readiness — a cold launch from a notification tap
  // delivers the pending response immediately, which can beat the root
  // navigator's mount and throw "Attempted to navigate before mounting".
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!navReady) return;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as
        | { kind?: string; alertId?: string; leadId?: string; planId?: string }
        | undefined;
      if (data?.kind === 'storm_alert' && data.alertId) {
        router.push({ pathname: '/storm-alert/[id]', params: { id: data.alertId } } as any);
      } else if (data?.kind === 'lead_follow_up' && data.leadId) {
        // `scheduleFollowUpReminder` (pushNotifications.ts) stamps the lead
        // id; the tap lands on the lead the reminder is about.
        router.push({ pathname: '/lead/[id]', params: { id: data.leadId } } as any);
      } else if (data?.kind === 'knock_plan' && data.planId) {
        router.push({ pathname: '/knock-plan/[id]', params: { id: data.planId } } as any);
      } else if (data?.kind === 'calibration_weekly') {
        // navigate, not push: a push while a detail screen is open stacks a
        // second tab shell on the root stack instead of switching the one
        // that exists.
        router.navigate('/(tabs)/train');
      }
    });
    return () => sub.remove();
  }, [navReady, router]);

  // Every hook above must run every render (rules-of-hooks) — only the paint
  // waits on the fonts. Returning null here keeps `SplashScreen` up instead
  // of flashing an unstyled frame.
  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayout}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* Wraps the navigator, not the app root, so the crash screen still
            renders inside the safe area and a recovery re-mounts routing. */}
        <ErrorBoundary>
          {/* First child, inside the boundary and the router tree: keeps the
              diagnostics "last known route" current from the very first
              pathname so a crash on any screen is tagged with where it hit. */}
          <DiagnosticsGate />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        </ErrorBoundary>
        <ToastHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
