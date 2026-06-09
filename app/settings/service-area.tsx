import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { requestPushPermission, scheduleWeeklyCalibrationPush } from '@/lib/services/pushNotifications';
import { checkStormWatch } from '@/lib/services/stormWatch';
import { geocodeText } from '@/lib/services/geocoding';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STATE_HINT_PATTERN = /[A-Z]{2}/;

export default function ServiceAreaScreen() {
  const router = useRouter();
  const areas = useServiceAreaStore((s) => s.areas);
  const add = useServiceAreaStore((s) => s.add);
  const setCentroid = useServiceAreaStore((s) => s.setCentroid);
  const remove = useServiceAreaStore((s) => s.remove);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);
  const [draft, setDraft] = useState('');
  const [scanning, setScanning] = useState(false);

  const onAdd = async () => {
    const text = draft.trim();
    if (text.length === 0) return;
    if (!STATE_HINT_PATTERN.test(text)) {
      Alert.alert(
        'Format hint',
        'Please include a 2-letter state code, e.g. "Plano, TX" or "75024, TX".',
      );
      return;
    }
    const isZip = /^\d{5}/.test(text);
    const area = add({ label: text, kind: isZip ? 'zip' : 'city' });
    setDraft('');
    toast({ tone: 'success', title: 'Added to service area', body: area.label });

    // Background geocode so the Map can render the area as a circle.
    geocodeText(text)
      .then((g) => {
        if (g) setCentroid(area.id, g.lat, g.lng);
      })
      .catch(() => {});

    // First-add: ask for push permission + schedule the weekly calibration push.
    if (areas.length === 0) {
      const granted = await requestPushPermission();
      if (granted) {
        scheduleWeeklyCalibrationPush().catch(() => {});
      }
    }
  };

  const onRemove = (id: string, label: string) => {
    Alert.alert(`Remove ${label}?`, 'Storm Watch will stop scanning this area.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(id) },
    ]);
  };

  const onScan = async () => {
    setScanning(true);
    try {
      const result = await checkStormWatch();
      logActivity({
        kind: 'storm_alert_received',
        message: `Storm Watch scanned ${areas.length} area${areas.length === 1 ? '' : 's'} — ${result.newAlerts.length} new alert${result.newAlerts.length === 1 ? '' : 's'}`,
      });
      toast({
        tone: result.newAlerts.length > 0 ? 'warn' : 'info',
        title:
          result.newAlerts.length > 0
            ? `${result.newAlerts.length} new storm alert${result.newAlerts.length === 1 ? '' : 's'}`
            : 'No qualifying storms in the last 24 hours',
        body: `Scanned ${result.scanned} NOAA report${result.scanned === 1 ? '' : 's'}.`,
      });
    } catch (e) {
      toast({
        tone: 'danger',
        title: 'Scan failed',
        body: e instanceof Error ? e.message : 'NOAA request failed',
      });
    } finally {
      setScanning(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>Service Area</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.helperCard}>
          <Ionicons name="thunderstorm-outline" size={24} color={colors.orange} />
          <Text style={styles.helper}>
            Add the cities or ZIPs you cover. Storm Watch will scan NOAA every 30
            minutes while the app is open and alert you when hail ≥0.75" or wind
            ≥58mph hits your areas.
          </Text>
        </View>

        <View style={styles.inputRow}>
          <Ionicons name="location-outline" size={18} color={colors.slate} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Plano, TX or 75024, TX"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={onAdd}
          />
          <Pressable style={styles.addBtn} onPress={onAdd}>
            <Ionicons name="add" size={22} color={colors.textInverse} />
          </Pressable>
        </View>

        {areas.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="map-outline" size={36} color={colors.slate} />
            <Text style={styles.emptyTitle}>No areas yet</Text>
            <Text style={styles.emptyBody}>
              Add the cities you cover to arm Storm Watch.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {areas.map((a, i) => (
              <View
                key={a.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <Ionicons
                  name={a.kind === 'zip' ? 'mail-outline' : 'business-outline'}
                  size={20}
                  color={colors.slate}
                />
                <Text style={styles.rowLabel}>{a.label}</Text>
                <Pressable onPress={() => onRemove(a.id, a.label)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Pressable
          style={[styles.scanBtn, scanning && { opacity: 0.5 }]}
          disabled={scanning || areas.length === 0}
          onPress={onScan}
        >
          {scanning ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <>
              <Ionicons name="radio-outline" size={20} color={colors.textInverse} />
              <Text style={styles.scanBtnText}>Scan storms now</Text>
            </>
          )}
        </Pressable>
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

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  helperCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  helper: { flex: 1, fontSize: fontSize.bodyMd, color: colors.slate, lineHeight: 20 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: touchTarget.standard,
  },
  input: { flex: 1, fontSize: fontSize.bodyLg, color: colors.navy, paddingVertical: 8 },
  addBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { flex: 1, fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.medium },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },

  scanBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  scanBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
