import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Alert,
  Platform,
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
// SDK 54: string-based read/write lives under `/legacy` — same convention as
// lib/services/backup.ts.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useMileageStore } from '@/lib/stores/mileageStore';
import type { MileageTrip } from '@/lib/models/types';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip } from '@/components/ui/IconChip';
import { useToastStore } from '@/lib/stores/toastStore';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
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
// The last published IRS business rate ($0.70 for 2025). Labelled as such on
// screen; a guessed "2026 estimated" figure was printed as a tax number.
const IRS_RATE_PER_MILE = 0.7;
const IRS_RATE_YEAR = 2025;

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** date, purpose, start, end, miles, rate, deduction — the columns an
 *  accountant needs to take the mileage deduction at tax time. */
function tripsToCsv(trips: MileageTrip[]): string {
  const header = ['Date', 'Purpose', 'Start', 'End', 'Miles', 'Rate', 'Deduction'];
  const rows = trips.map((t) => [
    new Date(t.startedAt).toLocaleDateString('en-US'),
    t.purpose ?? 'Business',
    t.startAddress ?? `${t.startLat.toFixed(5)}, ${t.startLng.toFixed(5)}`,
    t.endAddress ?? `${t.endLat.toFixed(5)}, ${t.endLng.toFixed(5)}`,
    t.miles.toFixed(1),
    `$${IRS_RATE_PER_MILE.toFixed(2)}`,
    `$${(t.miles * IRS_RATE_PER_MILE).toFixed(2)}`,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

async function exportTripsCsv(trips: MileageTrip[]): Promise<void> {
  const csv = tripsToCsv(trips);
  const filename = `roofwise-mileage-${new Date().toISOString().slice(0, 10)}.csv`;
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'RoofWise mileage log', UTI: 'public.comma-separated-values-text' });
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** IRS-style dated log as a printable PDF — same seven columns as the CSV. */
async function exportTripsPdf(trips: MileageTrip[]): Promise<void> {
  const total = trips.reduce((s, t) => s + t.miles, 0);
  const rows = trips
    .map(
      (t) => `<tr>
        <td>${escHtml(new Date(t.startedAt).toLocaleDateString('en-US'))}</td>
        <td>${escHtml(t.purpose ?? 'Business')}</td>
        <td>${escHtml(t.startAddress ?? `${t.startLat.toFixed(5)}, ${t.startLng.toFixed(5)}`)}</td>
        <td>${escHtml(t.endAddress ?? `${t.endLat.toFixed(5)}, ${t.endLng.toFixed(5)}`)}</td>
        <td class="num">${t.miles.toFixed(1)}</td>
        <td class="num">$${IRS_RATE_PER_MILE.toFixed(2)}</td>
        <td class="num">$${(t.miles * IRS_RATE_PER_MILE).toFixed(2)}</td>
      </tr>`,
    )
    .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>RoofWise Mileage Log</title>
  <style>
    body { font-family: -apple-system, sans-serif; color: #0E1330; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 2px; }
    .sub { color: #5A6180; font-size: 12px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #E6E8F0; }
    th { background: #F5F6FA; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.5px; }
    td.num, th.num { text-align: right; }
    tfoot td { font-weight: 700; border-top: 2px solid #0E1330; border-bottom: none; }
  </style></head><body>
  <h1>RoofWise Mileage Log</h1>
  <div class="sub">Generated ${escHtml(new Date().toLocaleString('en-US'))} · IRS business-mileage rate $${IRS_RATE_PER_MILE.toFixed(2)}/mi (${IRS_RATE_YEAR} published rate — confirm the current year's)</div>
  <table>
    <thead><tr><th>Date</th><th>Purpose</th><th>Start</th><th>End</th><th class="num">Miles</th><th class="num">Rate</th><th class="num">Deduction</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4">Total</td><td class="num">${total.toFixed(1)}</td><td></td><td class="num">$${(total * IRS_RATE_PER_MILE).toFixed(2)}</td></tr></tfoot>
  </table>
  </body></html>`;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'RoofWise mileage log', UTI: 'com.adobe.pdf' });
  }
}

export default function MileageScreen() {
  // Trip tracking needs continuous GPS sampling from a phone in a moving
  // vehicle — a desktop browser can't do that. On web, show a friendly
  // notice instead of half-rendering a tracker that never gets a fix.
  // Branching lives in this wrapper so the native hooks stay unconditional.
  if (Platform.OS === 'web') return <MileageWebNotice />;
  return <MileageNative />;
}

function MileageWebNotice() {
  const router = useRouter();
  return (
    <SafeAreaView style={webStyles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={webStyles.wrap}>
        <View style={webStyles.iconWrap}>
          <Ionicons name="car-outline" size={36} color={colors.brand} />
        </View>
        <Text style={webStyles.title}>Mileage tracking uses the phone&apos;s GPS</Text>
        <Text style={webStyles.body}>
          This tool runs on the RoofWise mobile app — your jobs, leads,
          reports, and map stay in sync here on the web.
        </Text>
        <Pressable style={webStyles.cta} onPress={() => router.replace('/')}>
          <Text style={webStyles.ctaText}>Back to dashboard</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const webStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
    maxWidth: 420,
  },
  body: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
    maxWidth: 420,
  },
  cta: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});

function MileageNative() {
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
  // Delete asks first (Drift #1) — the trip id waiting on the confirm sheet.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const runExport = async (format: 'csv' | 'pdf') => {
    if (trips.length === 0 || exporting) return;
    setExporting(true);
    try {
      // Oldest first — an accountant reads a mileage log chronologically.
      const ordered = [...trips].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );
      if (format === 'csv') await exportTripsCsv(ordered);
      else await exportTripsPdf(ordered);
    } catch (e) {
      toast({ tone: 'danger', title: 'Export failed', body: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const onExportPress = () => {
    if (trips.length === 0) {
      toast({ tone: 'warn', title: 'No trips to export yet' });
      return;
    }
    Alert.alert('Export mileage log', `${trips.length} trip${trips.length === 1 ? '' : 's'} · dated, with rate and deduction`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'CSV', onPress: () => runExport('csv') },
      { text: 'PDF', onPress: () => runExport('pdf') },
    ]);
  };

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
        <Pressable
          onPress={onExportPress}
          disabled={exporting}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Export mileage log"
        >
          {exporting ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <Ionicons name="share-outline" size={22} color={colors.navy} />
          )}
        </Pressable>
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

        <SectionHeader title="Recent trips" />
        {trips.length === 0 ? (
          <RichCard>
            <View style={styles.empty}>
              <IconChip name="car-outline" tone="quiet" />
              <Text style={styles.emptyText}>No trips logged yet.</Text>
            </View>
          </RichCard>
        ) : (
          <RichCard padded={false}>
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
                <Pressable
                  onPress={() => setPendingDelete(t.id)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Delete trip"
                  style={styles.tripDelete}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </RichCard>
        )}
      </ScrollView>
      <ConfirmSheet
        visible={pendingDelete != null}
        title="Delete this trip?"
        body="Its miles and deduction leave the log. This cannot be undone."
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete);
        }}
        onClose={() => setPendingDelete(null)}
      />
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
  headerBtn: { minWidth: touchTarget.standard, minHeight: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
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
  purposeChipActive: { backgroundColor: colors.brand },
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
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.standard,
  },
  tripDelete: {
    minWidth: touchTarget.small,
    minHeight: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tripMiles: { fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.semibold },
  tripDate: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  tripDeduct: { fontSize: fontSize.bodyMd, color: colors.success, fontWeight: fontWeight.semibold },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },

  errorText: { color: colors.danger, fontSize: fontSize.bodySm },
});
