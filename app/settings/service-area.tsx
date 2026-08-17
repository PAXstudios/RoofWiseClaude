import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { requestPushPermission, scheduleWeeklyCalibrationPush } from '@/lib/services/pushNotifications';
import { checkStormWatch } from '@/lib/services/stormWatch';
import { geocodeText } from '@/lib/services/geocoding';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STATE_HINT_PATTERN = /[A-Z]{2}/;

export default function ServiceAreaScreen() {
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
      // Drift #5: a failed area must read as "not available", never as a
      // clean scan.
      const unavailableNote =
        result.unavailableAreas.length > 0
          ? ` ${result.unavailableAreas.length} area${
              result.unavailableAreas.length === 1 ? '' : 's'
            } not available — storm data could not be fetched.`
          : '';
      toast({
        tone: result.newAlerts.length > 0 || result.unavailableAreas.length > 0 ? 'warn' : 'info',
        title:
          result.newAlerts.length > 0
            ? `${result.newAlerts.length} new storm alert${result.newAlerts.length === 1 ? '' : 's'}`
            : 'No qualifying storms in the last 24 hours',
        body: `Scanned ${result.scanned} NOAA report${result.scanned === 1 ? '' : 's'}.${unavailableNote}`,
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
      <ScreenHeader title="Service Area" back />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FadeSlideIn index={0} style={styles.section}>
          <RichCard
            icon="location-outline"
            iconTone="blue"
            title="Add area"
            footer={
              <Text style={styles.footerCaption}>
                Add the cities or ZIPs you cover. Storm Watch will scan NOAA every 30
                minutes while the app is open and alert you when hail ≥0.75" or wind
                ≥58mph hits your areas.
              </Text>
            }
          >
            <View style={styles.inputRow}>
              <View style={styles.inputPill}>
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
              </View>
              <PressableScale
                style={styles.addBtn}
                onPress={onAdd}
                accessibilityRole="button"
                accessibilityLabel="Add area"
              >
                <Ionicons name="add" size={24} color={colors.textInverse} />
              </PressableScale>
            </View>
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={1} style={styles.section}>
          <SectionHeader title="Your areas" style={styles.sectionHeaderSpacing} />
          <RichCard padded={areas.length === 0}>
            {areas.length === 0 ? (
              <View style={styles.empty}>
                <IconChip name="map-outline" tone="blue" size="md" />
                <Text style={styles.emptyTitle}>No areas yet</Text>
                <Text style={styles.emptyBody}>
                  Add the cities you cover to arm Storm Watch.
                </Text>
              </View>
            ) : (
              areas.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <View style={styles.sep} /> : null}
                  <View style={styles.row}>
                    <IconChip
                      name={a.kind === 'zip' ? 'mail-outline' : 'business-outline'}
                      tone={a.kind === 'zip' ? 'blue' : 'green'}
                      size="sm"
                    />
                    <Text style={styles.rowLabel}>{a.label}</Text>
                    <PressableScale
                      style={styles.removeBtn}
                      onPress={() => onRemove(a.id, a.label)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${a.label}`}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </PressableScale>
                  </View>
                </View>
              ))
            )}
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={2}>
          <PressableScale
            style={styles.scanBtnShadow}
            disabled={scanning || areas.length === 0}
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel="Scan storms now"
          >
            <LinearGradient
              colors={gradients.accent}
              style={[styles.scanBtn, (scanning || areas.length === 0) && styles.scanBtnDisabled]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {scanning ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="radio-outline" size={20} color={colors.textInverse} />
                  <Text style={styles.scanBtnText}>Scan storms now</Text>
                </>
              )}
            </LinearGradient>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.standard,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  addBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerCaption: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },
  rowLabel: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  removeBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Compact, top-anchored — structure, not a void (density rule).
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  emptyBody: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },

  scanBtnShadow: { borderRadius: radii.button, ...shadows.raised },
  scanBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanBtnDisabled: { opacity: 0.5 },
  scanBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});
