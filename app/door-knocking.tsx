import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import type MapView from 'react-native-maps';
import { Map, MapPin, regionForLatLon } from '@/components/map/Map';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import type { KnockOutcome } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const OUTCOMES: { id: KnockOutcome; label: string; tone: 'success' | 'info' | 'warn' | 'danger' | 'cream' }[] = [
  { id: 'interested', label: 'Interested', tone: 'success' },
  { id: 'inspection_scheduled', label: 'Inspection', tone: 'success' },
  { id: 'follow_up', label: 'Follow up', tone: 'warn' },
  { id: 'not_home', label: 'Not home', tone: 'cream' },
  { id: 'not_interested', label: 'No interest', tone: 'danger' },
];

const TONE: Record<string, string> = {
  success: colors.success,
  info: colors.info,
  warn: colors.warn,
  danger: colors.danger,
  cream: colors.slate,
};

export default function DoorKnockingScreen() {
  const router = useRouter();
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const start = useKnockSessionStore((s) => s.start);
  const end = useKnockSessionStore((s) => s.end);
  const logKnock = useKnockSessionStore((s) => s.logKnock);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);

  const mapRef = useRef<MapView>(null);
  const [position, setPosition] = useState<Location.LocationObjectCoords | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Live time elapsed for the route timer
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Location updates
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setPermissionError('Location permission denied. Door Knocking needs your location.');
        return;
      }
      const initial = await Location.getCurrentPositionAsync({});
      if (!cancelled) {
        setPosition(initial.coords);
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
        (loc) => {
          if (!cancelled) setPosition(loc.coords);
        },
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  const onStart = () => {
    start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toast({ tone: 'success', title: 'Route started' });
  };

  const onEnd = () => {
    if (!activeSession) return;
    const knocks = activeSession.knocks.length;
    Alert.alert('Wrap route?', `Save ${knocks} knock${knocks === 1 ? '' : 's'} and end the session.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Wrap',
        onPress: () => {
          const ended = end();
          if (!ended) return;
          logActivity({
            kind: 'route_completed',
            message: `Wrapped route with ${ended.knocks.length} knock${ended.knocks.length === 1 ? '' : 's'}`,
          });
          toast({
            tone: 'success',
            title: 'Route complete',
            body: `${ended.knocks.length} knocks · ${Math.round((Date.now() - new Date(ended.startedAt).getTime()) / 60000)} min`,
          });
          router.back();
        },
      },
    ]);
  };

  const onLogKnock = (outcome: KnockOutcome) => {
    if (!activeSession) {
      Alert.alert('Start a route first');
      return;
    }
    if (!position) {
      Alert.alert('Locating…', 'Waiting for a GPS fix.');
      return;
    }
    const k = logKnock({
      lat: position.latitude,
      lng: position.longitude,
      outcome,
    });
    if (!k) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logActivity({
      kind: 'knock_logged',
      message: `Knock logged: ${outcome.replace(/_/g, ' ')}`,
    });
    toast({ tone: 'success', title: 'Knock saved', body: outcome.replace(/_/g, ' ') });
  };

  const stats = useMemo(() => {
    if (!activeSession) return null;
    const knocks = activeSession.knocks;
    const total = knocks.length;
    const interested = knocks.filter((k) => k.outcome === 'interested' || k.outcome === 'inspection_scheduled').length;
    const elapsedMs = now - new Date(activeSession.startedAt).getTime();
    return {
      total,
      interested,
      pct: total === 0 ? 0 : Math.round((interested / total) * 100),
      elapsedMin: Math.floor(elapsedMs / 60000),
    };
  }, [activeSession, now]);

  const initialRegion = position
    ? regionForLatLon(position.latitude, position.longitude, 0.01)
    : regionForLatLon(33.0198, -96.6989, 0.05);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Door Knocking</Text>
          {stats ? (
            <Text style={styles.statsLine}>
              {stats.total} knocks · {stats.pct}% interested · {stats.elapsedMin}m
            </Text>
          ) : (
            <Text style={styles.statsLine}>Tap "Start route" to begin</Text>
          )}
        </View>
      </View>

      <View style={styles.mapWrap}>
        <Map ref={mapRef} initialRegion={initialRegion}>
          {activeSession?.knocks.map((k) => {
            const tone = OUTCOMES.find((o) => o.id === k.outcome)?.tone ?? 'info';
            return (
              <MapPin
                key={k.id}
                coordinate={{ latitude: k.lat, longitude: k.lng }}
                pinColor={TONE[tone]}
                title={k.outcome.replace(/_/g, ' ')}
              />
            );
          })}
        </Map>
        {!position && !permissionError && (
          <View style={styles.locating}>
            <ActivityIndicator color={colors.textInverse} />
          </View>
        )}
        {permissionError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{permissionError}</Text>
          </View>
        )}
      </View>

      <View style={styles.dock}>
        {!activeSession ? (
          <Pressable style={styles.startBtn} onPress={onStart}>
            <Ionicons name="walk-outline" size={22} color={colors.textInverse} />
            <Text style={styles.startBtnText}>Start route</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.outcomeGrid}>
              {OUTCOMES.map((o) => (
                <Pressable
                  key={o.id}
                  style={[styles.outcomeBtn, { backgroundColor: TONE[o.tone] }]}
                  onPress={() => onLogKnock(o.id)}
                >
                  <Text style={styles.outcomeText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.endBtn} onPress={onEnd}>
              <Ionicons name="flag-outline" size={20} color={colors.navy} />
              <Text style={styles.endBtnText}>Wrap route</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  statsLine: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  mapWrap: {
    flex: 1,
    margin: spacing.xl,
    marginTop: 0,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    ...shadows.card,
  },
  locating: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  errorBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm },

  dock: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  startBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  startBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },

  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  outcomeBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outcomeText: { color: colors.textInverse, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  endBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
