import { formatDateTime } from '@/lib/format/date';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useKnockFinderStore } from '@/lib/stores/knockFinderStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { AREA_ALERT_RADIUS_MILES, KNOCK_ROUTE_RADIUS_MILES, queueStormPlan } from '@/lib/services/stormWatch';
import { pendingStormAlertId, stormLabelFor } from '@/lib/services/knockPlanRunner';
import { FINDER_STEPS } from '@/lib/services/knockFinder';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip } from '@/components/ui/IconChip';
import {
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function StormAlertDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const alert = useStormAlertStore((s) => s.alerts.find((a) => a.id === id));
  const dismiss = useStormAlertStore((s) => s.dismiss);
  const markActedOn = useStormAlertStore((s) => s.markActedOn);
  const inspections = useInspectionStore((s) => s.inspections);
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const startSession = useKnockSessionStore((s) => s.start);
  const setRouteTarget = useKnockSessionStore((s) => s.setRouteTarget);
  const toast = useToastStore((s) => s.show);
  // The knock plan this alert queued (one per alert), or the run making it.
  const alertPlan = useKnockFinderStore((s) => s.plans.find((p) => p.stormAlertId === id));
  const activeRun = useKnockFinderStore((s) => s.activeRun);

  const inAreaInspections = useMemo(() => {
    if (!alert) return [];
    const state = alert.areaLabel.match(/,\s*([A-Z]{2})/)?.[1]?.toLowerCase();
    const city = alert.areaLabel
      .replace(/,\s*[A-Z]{2}.*$/, '')
      .trim()
      .toLowerCase();
    return inspections.filter((ins) => {
      const addr = ins.address.toLowerCase();
      if (state && !addr.includes(state)) return false;
      if (city && !addr.includes(city)) return false;
      return true;
    });
  }, [alert, inspections]);

  if (!alert) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyText}>Alert not found.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const onDismiss = () => {
    dismiss(alert.id);
    router.back();
  };

  const hasCore = typeof alert.coreLat === 'number' && typeof alert.coreLng === 'number';

  const planning = activeRun?.stormAlertId === alert.id;
  const queued = !planning && !alertPlan && pendingStormAlertId() === alert.id;
  const planStep = planning ? FINDER_STEPS.find((s) => s.id === activeRun?.step)?.label ?? 'Working' : '';
  const stormLabel = stormLabelFor({ kind: 'storm_alert', alertId: alert.id, stormDay: alert.firedAt });
  const alertTop = alertPlan?.result.areas[0];

  const onMakePlan = () => {
    const run = queueStormPlan(alert);
    if (!run) {
      toast({ tone: 'warn', title: 'No storm core on this alert', body: 'The planner needs a point to search from.' });
      return;
    }
    toast({ tone: 'info', title: `Planning the ${stormLabel}…`, body: 'You can leave — the bell rings when the plan is ready.' });
  };

  const onPlanRow = () => {
    if (alertPlan) router.push(`/knock-plan/${alertPlan.id}` as any);
    else if (planning || queued) router.push('/knock-finder');
    else onMakePlan();
  };

  const onAct = () => {
    markActedOn(alert.id);
    // dismissTo, not replace: replace stacked a second tab shell (NAV-3).
    // With a core, land Storm Tracer ON it rather than at the service area.
    router.dismissTo(
      hasCore
        ? ({ pathname: '/(tabs)/map', params: { filter: 'storms', lat: String(alert.coreLat), lng: String(alert.coreLng) } } as any)
        : '/(tabs)/map',
    );
  };

  /**
   * "Add the area to my knock route": aim the active session at the storm
   * core (or start one aimed there), then open door-knocking framed on it.
   */
  const onAddToRoute = () => {
    if (!hasCore) {
      router.push('/door-knocking');
      return;
    }
    const target = {
      lat: alert.coreLat as number,
      lng: alert.coreLng as number,
      radiusMiles: KNOCK_ROUTE_RADIUS_MILES,
      label: alert.coreCity ? `${alert.coreCity} storm core` : `${alert.areaLabel} storm core`,
      stormAlertId: alert.id,
    };
    if (activeSession) setRouteTarget(target);
    else startSession(alert.id, target);
    markActedOn(alert.id);
    toast({
      tone: 'success',
      title: 'Added to your knock route',
      body: `${target.label} · ${KNOCK_ROUTE_RADIUS_MILES} mi canvass radius`,
    });
    router.push('/door-knocking');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.headerTitle}>Storm Alert</Text>
        <Pressable onPress={onDismiss} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroChip}>
            <Ionicons name="thunderstorm" size={14} color={colors.textInverse} />
            <Text style={styles.heroChipText}>
              {alert.eventKind === 'hail'
                ? 'Severe Hail'
                : alert.eventKind === 'wind'
                ? 'Severe Wind'
                : 'Severe Storm'}
            </Text>
          </View>
          <Text style={styles.heroArea}>{alert.areaLabel}</Text>
          <Text style={styles.heroSub}>
            {formatDateTime(alert.firedAt, 'Time unavailable')}
          </Text>
        </View>

        <View style={styles.statRow}>
          {alert.hailSizeInches && (
            <Stat label="Hail size" value={`${alert.hailSizeInches.toFixed(2)}"`} />
          )}
          {alert.windSpeedMph && (
            <Stat label="Wind speed" value={`${alert.windSpeedMph} mph`} />
          )}
          <Stat label="In range" value={String(alert.propertyCount)} />
        </View>

        {/* WHERE it hit — the guidance the roofer acts on. Absent fields stay
            absent (older alerts) rather than reading as a guess. */}
        <SectionHeader title="Where it hit" />
        <RichCard
          icon="navigate-outline"
          iconTone={alert.severity === 'damaging' ? 'orange' : 'blue'}
          title={
            alert.coreCity
              ? `Near ${alert.coreCity}`
              : hasCore
                ? 'Strongest report located'
                : 'Location not recorded for this alert'
          }
          subtitle={
            alert.distanceMiles != null && alert.bearing
              ? `${alert.distanceMiles.toFixed(0)} mi ${alert.bearing} of ${alert.areaLabel}` +
                (alert.reportCount ? ` · ${alert.reportCount} report${alert.reportCount === 1 ? '' : 's'}` : '')
              : alert.reportCount
                ? `${alert.reportCount} qualifying report${alert.reportCount === 1 ? '' : 's'} within ${AREA_ALERT_RADIUS_MILES} mi`
                : undefined
          }
        >
          <Text style={styles.rowSub}>
            {alert.severity === 'damaging'
              ? alert.eventKind === 'wind'
                ? 'Damaging wind — expect lifted tabs and shingle loss across the neighbourhood, not just exposed roofs.'
                : 'Damaging hail — at or above the 1 in NWS severe criterion. Expect functional hits on asphalt.'
              : 'Validated storm below the damaging floor — worth a look, not a sprint.'}
          </Text>
        </RichCard>

        {/* The knock plan for this storm: queued by Storm Watch on a damaging
            alert (Settings → Auto-plan damaging storms), or made here. */}
        <SectionHeader title="Knock plan" />
        <RichCard padded={false}>
          <PressableScale
            style={styles.planRow}
            onPress={onPlanRow}
            accessibilityRole="button"
            accessibilityLabel={
              alertPlan
                ? `Plan ready for the ${stormLabel}, open it`
                : planning
                  ? `Planning the ${stormLabel}, ${planStep}`
                  : queued
                    ? `Planning the ${stormLabel} after the current run`
                    : `Make a knock plan for the ${stormLabel}`
            }
          >
            {planning ? (
              <View style={styles.planSpinner}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <IconChip
                name={alertPlan ? 'compass' : queued ? 'time-outline' : 'compass-outline'}
                tone={alertPlan ? 'green' : 'orange'}
                size="sm"
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {alertPlan ? 'Plan ready' : planning ? 'Planning…' : queued ? 'Queued' : 'Make a plan'}
              </Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {alertPlan
                  ? `${alertPlan.result.areas.length} area${alertPlan.result.areas.length === 1 ? '' : 's'}${
                      alertTop ? ` · best: ${alertTop.name ?? alertTop.storm.town ?? 'area'} (Knock ${alertTop.knockScore})` : ''
                    } · ${alertPlan.result.plan.days.length} day${alertPlan.result.plan.days.length === 1 ? '' : 's'}`
                  : planning
                    ? `${planStep}${activeRun?.partial ? ` · ${activeRun.partial.areas.length} areas ranked so far` : ''}`
                    : queued
                      ? 'Starts the moment the current plan finishes.'
                      : hasCore
                        ? 'Rank the streets around the core and plan the days. The bell rings when it is ready.'
                        : 'Not available — this alert has no located core.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
        </RichCard>

        <SectionHeader title="Your properties in the impacted area" />
        {inAreaInspections.length === 0 ? (
          <RichCard>
            <View style={styles.emptyCardInner}>
              <IconChip name="home-outline" tone="quiet" />
              <Text style={styles.emptyCardText}>
                None of your saved properties are in this area yet.
              </Text>
            </View>
          </RichCard>
        ) : (
          <RichCard padded={false}>
            {inAreaInspections.map((ins, i) => (
              <Pressable
                key={ins.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => router.push(`/job/${ins.id}` as any)}
              >
                <IconChip name="home" tone="orange" size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{ins.customerName}</Text>
                  <Text style={styles.rowSub}>{ins.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </Pressable>
            ))}
          </RichCard>
        )}

        <Pressable style={styles.primaryBtn} onPress={onAddToRoute} accessibilityRole="button">
          <Ionicons name="walk-outline" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>
            {activeSession ? 'Add area to my knock route' : 'Start knock route here'}
          </Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={onAct} accessibilityRole="button">
          <Ionicons name="map" size={20} color={colors.navy} />
          <Text style={styles.secondaryBtnText}>{hasCore ? 'See it in Storm Tracer' : 'Open Map'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
    backgroundColor: colors.navy,
  },
  // Glove-sized back / dismiss targets (Drift #1) — were icons in 4pt of padding.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    textAlign: 'center',
  },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },

  hero: { gap: spacing.sm },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  heroChipText: { ...dataLabel, color: colors.textInverse },
  heroArea: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.navy,
    marginTop: spacing.sm,
  },
  heroSub: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.mono, color: colors.slate },

  statRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  statValue: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.orange,
  },
  // "HAIL SIZE" / "IN RANGE" — the mock's stat-label convention (§3).
  statLabel: { ...dataLabel, color: colors.slate, marginTop: spacing.xs },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.navy,
  },
  rowSub: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.slate, marginTop: 2 },
  // Knock-plan row — a 56pt target (Drift #1) with a live spinner while planning.
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.standard,
  },
  planSpinner: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  emptyCardInner: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyCardText: { color: colors.textMuted, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular, textAlign: 'center' },

  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },

  secondaryBtn: {
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
  secondaryBtnText: {
    color: colors.navy,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    fontSize: fontSize.bodyMd,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular },
});
