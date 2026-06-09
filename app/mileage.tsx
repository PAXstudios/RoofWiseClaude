import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const PURPOSES = ['Inspection', 'Door knocking', 'Supply run', 'Office'];
const IRS_RATE_PER_MILE = 0.67; // 2026 estimated business mileage rate

export default function MileageScreen() {
  const router = useRouter();
  const active = useMileageStore((s) => s.active);
  const trips = useMileageStore((s) => s.trips);
  const start = useMileageStore((s) => s.start);
  const stop = useMileageStore((s) => s.stop);
  const recordSample = useMileageStore((s) => s.recordSample);
  const remove = useMileageStore((s) => s.remove);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);

  const [position, setPosition] = useState<Location.LocationObjectCoords | null>(null);
  const [purpose, setPurpose] = useState<string>('Inspection');
  const [permError, setPermError] = useState<string | null>(null);

  // Track location while active
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setPermError('Location permission denied.');
        return;
      }
      const initial = await Location.getCurrentPositionAsync({});
      if (!cancelled) setPosition(initial.coords);
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
        (loc) => {
          if (cancelled) return;
          setPosition(loc.coords);
          recordSample({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        },
      );
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [recordSample]);

  const ytdMiles = useMemo(() => {
    const year = new Date().getFullYear();
    return trips
      .filter((t) => new Date(t.startedAt).getFullYear() === year)
      .reduce((s, t) => s + t.miles, 0);
  }, [trips]);

  const onStart = () => {
    if (!position) {
      toast({ tone: 'warn', title: 'Locating…', body: 'Waiting for GPS fix.' });
      return;
    }
    start({ lat: position.latitude, lng: position.longitude, purpose });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    toast({ tone: 'success', title: 'Trip started' });
  };

  const onStop = () => {
    if (!position || !active) return;
    const trip = stop({ lat: position.latitude, lng: position.longitude });
    if (!trip) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logActivity({
      kind: 'route_completed',
      message: `Logged ${trip.miles.toFixed(1)} mi · ${trip.purpose ?? 'business'}`,
    });
    toast({
      tone: 'success',
      title: `${trip.miles.toFixed(1)} mi logged`,
      body: `${trip.purpose ?? 'Business'} · $${(trip.miles * IRS_RATE_PER_MILE).toFixed(2)} deductible`,
    });
  };

  const liveMiles = useMemo(() => {
    if (!active) return 0;
    let miles = 0;
    for (let i = 1; i < active.samples.length; i++) {
      const a = active.samples[i - 1];
      const b = active.samples[i];
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      miles += 2 * 3958.8 * Math.asin(Math.sqrt(h));
    }
    return miles;
  }, [active]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mileage</Text>
          <Text style={styles.sub}>
            {ytdMiles.toFixed(1)} mi YTD · ${(ytdMiles * IRS_RATE_PER_MILE).toFixed(0)} deductible
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {active ? (
          <View style={styles.activeCard}>
            <Text style={styles.activeLabel}>Trip in progress</Text>
            <Text style={styles.activeMiles}>{liveMiles.toFixed(2)} mi</Text>
            <Text style={styles.activePurpose}>{active.purpose ?? 'Business'}</Text>
            <Pressable style={styles.stopBtn} onPress={onStop}>
              <Ionicons name="stop-circle" size={22} color={colors.textInverse} />
              <Text style={styles.stopBtnText}>End trip</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Start a trip</Text>
            <Text style={styles.cardSub}>Pick the purpose, then start tracking.</Text>
            <View style={styles.purposeRow}>
              {PURPOSES.map((p) => (
                <Pressable
                  key={p}
                  style={[styles.purposeChip, purpose === p && styles.purposeChipActive]}
                  onPress={() => setPurpose(p)}
                >
                  <Text style={[styles.purposeText, purpose === p && styles.purposeTextActive]}>
                    {p}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.startBtn} onPress={onStart}>
              {position ? (
                <>
                  <Ionicons name="car-outline" size={22} color={colors.textInverse} />
                  <Text style={styles.startBtnText}>Start trip</Text>
                </>
              ) : (
                <ActivityIndicator color={colors.textInverse} />
              )}
            </Pressable>
            {permError && <Text style={styles.errorText}>{permError}</Text>}
          </View>
        )}

        <Text style={styles.section}>Recent trips</Text>
        {trips.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={28} color={colors.slate} />
            <Text style={styles.emptyText}>No trips logged yet.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {trips.slice(0, 10).map((t, i) => (
              <View key={t.id} style={[styles.tripRow, i > 0 && styles.tripRowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripMiles}>
                    {t.miles.toFixed(1)} mi · {t.purpose ?? 'Business'}
                  </Text>
                  <Text style={styles.tripDate}>
                    {new Date(t.startedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={styles.tripDeduct}>
                  ${(t.miles * IRS_RATE_PER_MILE).toFixed(2)}
                </Text>
                <Pressable onPress={() => remove(t.id)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  activeCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  activeLabel: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.bodySm, textTransform: 'uppercase', letterSpacing: 0.5 },
  activeMiles: { color: colors.orange, fontSize: 56, fontWeight: fontWeight.bold },
  activePurpose: { color: colors.cream, fontSize: fontSize.bodyMd },
  stopBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  stopBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.slate },

  purposeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  purposeChip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purposeChipActive: { backgroundColor: colors.navy },
  purposeText: { color: colors.navy, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  purposeTextActive: { color: colors.textInverse },

  startBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  startBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  section: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.md },

  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  tripRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tripMiles: { fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.semibold },
  tripDate: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  tripDeduct: { fontSize: fontSize.bodyMd, color: colors.success, fontWeight: fontWeight.semibold },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },

  errorText: { color: colors.danger, fontSize: fontSize.bodySm },
});
