// Knock Planner — one button, and every plan it ever made, by date.
//
// The run is detached from this screen (lib/services/knockPlanRunner.ts):
// tap Find, leave, and the Home bell rings when the plan is ready. While it
// runs, this screen shows the map-search animation, the step list and the
// ranked areas as they land. Each finished run is a saved plan with its own
// page (app/knock-plan/[id].tsx) — statuses, notes, jobs and leads made from
// it all live there.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LocationField, resolveDeviceLocation, type ResolvedLocation } from '@/components/LocationField';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion/FadeSlideIn';
import { SearchAnimation } from '@/components/knock/SearchAnimation';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useKnockFinderStore, type KnockPlan } from '@/lib/stores/knockFinderStore';
import { FINDER_STEPS } from '@/lib/services/knockFinder';
import { startKnockPlan } from '@/lib/services/knockPlanRunner';
import { LOOKBACK_MONTHS, SEARCH_RADIUS_MILES, type BasePoint } from '@/lib/services/knockOpportunities';
import { formatDate, formatRelative } from '@/lib/format/date';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

export default function KnockFinderScreen() {
  const router = useRouter();
  const areas = useServiceAreaStore((s) => s.areas);
  const inspections = useInspectionStore((s) => s.inspections);
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const archive = useKnockSessionStore((s) => s.archive);
  const toast = useToastStore((s) => s.show);
  const plans = useKnockFinderStore((s) => s.plans);
  const activeRun = useKnockFinderStore((s) => s.activeRun);

  // Default base: the first service area with a centroid, else the newest
  // plan's base, else the phone's location (resolved below).
  const defaultBase = useMemo<BasePoint | null>(() => {
    const withCentroid = areas.find((a) => typeof a.centroidLat === 'number' && typeof a.centroidLng === 'number');
    if (withCentroid) return { lat: withCentroid.centroidLat as number, lng: withCentroid.centroidLng as number, label: withCentroid.label };
    return plans[0]?.result.base ?? null;
  }, [areas, plans]);

  const [base, setBase] = useState<BasePoint | null>(defaultBase);
  const [baseText, setBaseText] = useState(defaultBase?.label ?? '');
  useEffect(() => {
    if (!base && defaultBase) {
      setBase(defaultBase);
      setBaseText(defaultBase.label);
    }
  }, [base, defaultBase]);

  // Nothing to go on → find the phone, so the button is never dead.
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (base || defaultBase || locating) return;
    let cancelled = false;
    setLocating(true);
    void resolveDeviceLocation()
      .then((r) => {
        if (cancelled || r.status !== 'ok') return;
        const loc = r.location;
        const label = loc.city ? `${loc.city}${loc.stateCode ? `, ${loc.stateCode}` : ''}` : loc.address;
        setBase({ lat: loc.lat, lng: loc.lng, label });
        setBaseText(loc.address);
      })
      .finally(() => {
        if (!cancelled) setLocating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed seconds while a run is live (the run may have started before
  // this screen mounted — it is the store's clock, not ours).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!activeRun) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeRun]);
  const elapsed = activeRun ? Math.max(0, Math.round((now - new Date(activeRun.startedAt).getTime()) / 1000)) : 0;

  const onResolved = useCallback((loc: ResolvedLocation) => {
    const label = loc.city ? `${loc.city}${loc.stateCode ? `, ${loc.stateCode}` : ''}` : loc.address;
    setBase({ lat: loc.lat, lng: loc.lng, label });
    setBaseText(loc.address);
  }, []);

  const run = useCallback(() => {
    if (!base || activeRun) return;
    const own = {
      knocks: [...(activeSession ? [activeSession] : []), ...archive].flatMap((s) => s.knocks.map((k) => ({ lat: k.lat, lng: k.lng, at: k.createdAt }))),
      jobs: inspections.filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number').map((i) => ({ lat: i.lat as number, lng: i.lng as number })),
    };
    // Fire and forget: the runner owns the run, saves the plan, rings the bell.
    void startKnockPlan({ base, own }).then((outcome) => {
      if (outcome.status === 'ok') {
        toast({ tone: 'success', title: 'Knock plan ready', body: outcome.plan.title });
      } else if (outcome.status === 'no_storms') {
        toast({ tone: 'warn', title: 'No qualifying storms', body: `${outcome.eventCount} reports, none in a rankable area.` });
      } else {
        toast({ tone: 'danger', title: 'Knock Planner could not finish', body: outcome.reason });
      }
    });
    toast({ tone: 'info', title: 'Working on it', body: 'You can leave — the bell rings when the plan is ready.' });
  }, [activeRun, activeSession, archive, base, inspections, toast]);

  const latest = plans[0];
  const byDay = useMemo(() => groupByDay(plans), [plans]);
  const stepIdx = activeRun ? FINDER_STEPS.findIndex((x) => x.id === activeRun.step) : -1;
  const stepLabel = activeRun ? FINDER_STEPS[stepIdx]?.label ?? 'Working' : '';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Knock Planner"
        subtitle={`Storms within ${SEARCH_RADIUS_MILES} mi · last ${LOOKBACK_MONTHS} months · roof age · your footprint`}
        back={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <RichCard icon="navigate-outline" iconTone="blue" title="Search from" subtitle={base ? base.label : locating ? 'Finding your location…' : 'Your shop, home, or a town you want to work'}>
          <LocationField value={baseText} onChangeText={setBaseText} onResolved={onResolved} placeholder="Home base, shop, or a town" biasLat={base?.lat} biasLng={base?.lng} />
        </RichCard>

        {activeRun ? (
          <RichCard padded={false}>
            <SearchAnimation caption={elapsed >= 15 ? `${stepLabel} · ${elapsed}s — still working; leave if you like, the bell will ring` : stepLabel} />
            <View style={styles.steps}>
              {FINDER_STEPS.map((s, i) => {
                const done = i < stepIdx;
                const active = i === stepIdx;
                return (
                  <View key={s.id} style={styles.stepRow}>
                    {done ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : active ? <ActivityIndicator size="small" color={colors.brand} /> : <Ionicons name="ellipse-outline" size={20} color={colors.textSubtle} />}
                    <Text style={[styles.stepText, done && styles.stepDone, active && styles.stepActive]}>{s.label}</Text>
                  </View>
                );
              })}
              {activeRun.partial ? (
                <Text style={styles.partialNote}>
                  {activeRun.partial.areas.length} areas ranked so far — best: {activeRun.partial.areas[0]?.name ?? activeRun.partial.areas[0]?.storm.town ?? '…'} (Knock{' '}
                  {activeRun.partial.areas[0]?.knockScore}). The page opens the moment it is saved.
                </Text>
              ) : null}
            </View>
          </RichCard>
        ) : null}

        {latest && !activeRun ? (
          <FadeSlideIn index={0}>
            <PlanRow plan={latest} latest onPress={() => router.push(`/knock-plan/${latest.id}` as any)} />
          </FadeSlideIn>
        ) : null}

        {plans.length === 0 && !activeRun ? (
          <RichCard icon="compass-outline" iconTone="orange" title="One tap, a plan for the day">
            <Text style={styles.body}>
              Pulls every NWS hail and wind report within {SEARCH_RADIUS_MILES} miles from the last {LOOKBACK_MONTHS} months, scores each
              neighbourhood by how hard and how recently it was hit, how old its roofs are, and how far it is — then saves a plan
              you can act on: where to go, why, how many claim-grade roofs to expect, and a route to start knocking.
            </Text>
          </RichCard>
        ) : null}

        {plans.length > 1 || (plans.length === 1 && activeRun) ? (
          <>
            <SectionHeader title="Past plans" />
            {byDay.map((g) => (
              <View key={g.day} style={styles.dayGroup}>
                <Text style={styles.dayLabel}>{g.label}</Text>
                {g.plans.map((p) =>
                  p.id === latest?.id && !activeRun ? null : <PlanRow key={p.id} plan={p} onPress={() => router.push(`/knock-plan/${p.id}` as any)} />,
                )}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.dock}>
        <PressableScale
          style={[styles.primaryBtn, (!base || !!activeRun) && styles.primaryBtnDisabled]}
          onPress={run}
          disabled={!base || !!activeRun}
          accessibilityRole="button"
          accessibilityLabel="Find storm-hit streets and make a plan"
        >
          {activeRun ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="compass" size={22} color={colors.textInverse} />}
          <Text style={styles.primaryBtnText}>{activeRun ? 'Making your plan…' : plans.length > 0 ? 'Make a new plan' : `Find storm-hit streets within ${SEARCH_RADIUS_MILES} mi`}</Text>
        </PressableScale>
        {!base && !locating ? <Text style={styles.dockHint}>Pick a base first — type a town or use your location.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function groupByDay(plans: KnockPlan[]): { day: string; label: string; plans: KnockPlan[] }[] {
  const groups = new Map<string, KnockPlan[]>();
  for (const p of plans) {
    const d = new Date(p.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()].map(([day, ps]) => ({ day, label: formatDate(ps[0].createdAt, day), plans: ps }));
}

function PlanRow({ plan, latest, onPress }: { plan: KnockPlan; latest?: boolean; onPress: () => void }) {
  const r = plan.result;
  const top = r.areas[0];
  const acted = Object.values(plan.areaStatus).filter((s) => s !== 'planned').length;
  return (
    <PressableScale style={[styles.planRow, latest && styles.planRowLatest]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open plan ${plan.title}`}>
      <View style={styles.planRing}>
        <Text style={styles.planRingValue}>{top?.knockScore ?? '—'}</Text>
      </View>
      <View style={styles.planMain}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planTitle} numberOfLines={1}>
            {plan.title}
          </Text>
          {latest ? <Pill label="Latest" tone="accent" size="sm" /> : null}
        </View>
        <Text style={styles.planSub} numberOfLines={2}>
          {r.areas.length} areas · best {top?.name ?? top?.storm.town ?? '—'} · expect ~{Math.round(r.plan.expected)} claim-grade roofs
          {acted > 0 ? ` · ${acted} acted on` : ''}
        </Text>
        <Text style={styles.planMeta}>{formatRelative(plan.createdAt, 'just now')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: touchTarget.sticky + spacing.xxxl * 2 },
  body: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 21 },
  steps: { gap: spacing.sm, padding: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  stepText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textSubtle },
  stepDone: { color: colors.textMuted },
  stepActive: { color: colors.text, fontWeight: fontWeight.semibold },
  partialNote: { fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18, marginTop: spacing.xs },
  dayGroup: { gap: spacing.sm },
  dayLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  planRow: {
    minHeight: touchTarget.sticky,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  planRowLatest: { borderColor: colors.accent, borderWidth: 1.5, ...shadows.card },
  planRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  planRingValue: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.accent },
  planMain: { flex: 1, gap: 2 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planTitle: { flexShrink: 1, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.navy },
  planSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 17 },
  planMeta: { fontSize: fontSize.caption, color: colors.textSubtle },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  primaryBtn: { flexDirection: 'row', gap: spacing.sm, height: touchTarget.sticky, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  primaryBtnDisabled: { backgroundColor: colors.accentDisabled },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  dockHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
});
