import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import {
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const ITEMS = [
  { key: 'harness', label: 'Safety harness on' },
  { key: 'access', label: 'Roof access secured' },
  { key: 'conditions', label: 'Conditions safe (no wet, icy, slippery)' },
  { key: 'phone', label: 'Cellular signal confirmed' },
  { key: 'notify', label: 'Notified office of my location' },
  { key: 'emergency', label: 'Emergency contact accessible' },
];

export default function SafetyCheckScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string; redirect?: string }>();
  const confirmSafe = useSafetyStore((s) => s.confirmSafe);
  const setPreFlightEnabled = useSafetyStore((s) => s.setPreFlightEnabled);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const allChecked = ITEMS.every((i) => checked[i.key]);

  const onConfirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    confirmSafe();
    const next = params.redirect ?? '/quick-inspection';
    router.replace({
      pathname: next as any,
      params: params.jobId ? { jobId: params.jobId } : undefined,
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.title}>Safety check</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <Ionicons name="shield-checkmark" size={36} color={colors.orange} />
          <Text style={styles.heroTitle}>Before you climb</Text>
          <Text style={styles.heroBody}>
            Tap each item to confirm. We won't open the camera until all six pass.
          </Text>
        </View>

        <View style={styles.list}>
          {ITEMS.map((item, i) => {
            const on = !!checked[item.key];
            return (
              <Pressable
                key={item.key}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => setChecked((c) => ({ ...c, [item.key]: !c[item.key] }))}
              >
                <Ionicons
                  name={on ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={on ? colors.success : colors.onMesh}
                  style={!on ? styles.itemIconOff : undefined}
                />
                <Text style={[styles.itemText, on && styles.itemTextOn]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={styles.skipBtn}
          accessibilityRole="button"
          accessibilityLabel="Stop showing this before camera"
          onPress={() => {
            setPreFlightEnabled(false);
            router.replace({
              pathname: (params.redirect ?? '/quick-inspection') as any,
              params: params.jobId ? { jobId: params.jobId } : undefined,
            });
          }}
        >
          <Text style={styles.skipText}>Stop showing this before camera</Text>
        </Pressable>
      </ScrollView>

      <Pressable
        style={[styles.confirmBtn, !allChecked && styles.confirmBtnDisabled]}
        disabled={!allChecked}
        onPress={onConfirm}
      >
        <Text style={styles.confirmBtnText}>I'm safe to climb</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Glove-sized back target (Drift #1) — was a 26px icon in 4pt of padding.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.textInverse,
  },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },

  heroCard: {
    backgroundColor: glass.fillLow,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.onMesh,
  },
  heroBody: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
    color: colors.onMesh,
    opacity: 0.82,
    textAlign: 'center',
  },

  list: {
    backgroundColor: glass.fillLow,
    borderRadius: radii.card,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.preferred,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border },
  itemIconOff: { opacity: 0.55 },
  itemText: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    fontFamily: fontFamily.archivo.regular,
    color: colors.onMesh,
    opacity: 0.78,
  },
  itemTextOn: { color: colors.onMesh, opacity: 1, fontWeight: fontWeight.semibold, fontFamily: fontFamily.archivo.semibold },

  // Secondary opt-out still takes a glove-sized target (Drift #1).
  skipBtn: { minHeight: touchTarget.standard, justifyContent: 'center' },
  skipText: {
    color: colors.onMesh,
    opacity: 0.62,
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  confirmBtn: {
    margin: spacing.xl,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },
});
