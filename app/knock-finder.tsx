// Knock Planner — one button, and every plan it ever made, by date.
//
// The run is detached from this screen (lib/services/knockPlanRunner.ts):
// tap Find, leave, and the Home bell rings when the plan is ready. While it
// runs, this screen shows RunProgress (search animation, step list, an
// estimated time left, the ranked areas as they land) plus a plain way out —
// leave, or cancel. Each finished run is a saved plan with its own page
// (app/knock-plan/[id].tsx) — statuses, notes, jobs and leads made from it
// all live there.
//
// Two modes: storm-hit streets (the default) and the neighbours of the
// roofer's own jobs. The base is a map pin, device location, address, or a
// service area (BasePicker); the radius is a 3–50 mi arc dial (RadiusDial),
// remembered. The "Your calibration" card shows how the roofer's own doors
// have bent the base-rate table (docs/KNOCK_OPPORTUNITIES.md §8).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { resolveDeviceLocation } from '@/components/LocationField';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion/FadeSlideIn';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { BasePicker, baseDisplayLabel } from '@/components/knock/BasePicker';
import { RadiusDial } from '@/components/knock/RadiusDial';
import { RunProgress } from '@/components/knock/RunProgress';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useKnockFinderStore, type KnockPlan } from '@/lib/stores/knockFinderStore';
import { useCalibration, useKnockCalibrationStore } from '@/lib/stores/knockCalibrationStore';
import type { FinderMode } from '@/lib/services/knockFinder';
import { ownActivityNow, startKnockPlan, cancelKnockPlan } from '@/lib/services/knockPlanRunner';
import { LOOKBACK_MONTHS, type BasePoint } from '@/lib/services/knockOpportunities';
import { formatDate, formatRelative } from '@/lib/format/date';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const MODES: { id: FinderMode; label: string; icon: 'thunderstorm-outline' | 'home-outline' }[] = [
  { id: 'storm', label: 'Storm-hit streets', icon: 'thunderstorm-outline' },
  { id: 'neighbours', label: 'Neighbours of my jobs', icon: 'home-outline' },
];

export default function KnockFinderScreen() {
  const router = useRouter();
  const areas = useServiceAreaStore((s) => s.areas);
  const inspections = useInspectionStore((s) => s.inspections);
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const archive = useKnockSessionStore((s) => s.archive);
  const toast = useToastStore((s) => s.show);
  const plans = useKnockFinderStore((s) => s.plans);
  const activeRun = useKnockFinderStore((s) => s.activeRun);
  const storeRadiusMiles = useKnockFinderStore((s) => s.radiusMiles);
  const setStoreRadiusMiles = useKnockFinderStore((s) => s.setRadiusMiles);
  const runHistory = useKnockFinderStore((s) => s.runHistory);
  const calibration = useCalibration();
  const calibrationRecords = useKnockCalibrationStore((s) => s.records);
  const refreshCalibration = useKnockCalibrationStore((s) => s.refreshFromStores);
  const resetCalibration = useKnockCalibrationStore((s) => s.reset);

  const [mode, setMode] = useState<FinderMode>('storm');
  const [confirmReset, setConfirmReset] = useState(false);
  const jobsWithCoords = useMemo(() => inspections.filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number').length, [inspections]);
  const neighboursOff = jobsWithCoords === 0;
  useEffect(() => {
    if (neighboursOff && mode === 'neighbours') setMode('storm');
  }, [neighboursOff, mode]);

  // The calibration is a computation over plans × knocks; refresh it when
  // either side changes while this screen is open.
  useEffect(() => {
    refreshCalibration();
  }, [refreshCalibration, plans.length, archive.length, activeSession?.knocks.length]);

  // The radius dial: a local "draft" that follows every mile of the drag
  // live (so the map ring above it redraws with no round trip), committed
  // to the store — and persisted — only when the finger lifts or a ± button
  // is pressed. Re-synced whenever the store changes from elsewhere (the
  // persisted value hydrating after mount, a run committing its own radius).
  const [radiusMiles, setRadiusMiles] = useState(storeRadiusMiles);
  useEffect(() => setRadiusMiles(storeRadiusMiles), [storeRadiusMiles]);

  // The first service area with a centroid — offered as its own chip on the
  // base picker, and the top of the default-base chain below.
  const serviceAreaBase = useMemo<BasePoint | null>(() => {
    const withCentroid = areas.find((a) => typeof a.centroidLat === 'number' && typeof a.centroidLng === 'number');
    return withCentroid ? { lat: withCentroid.centroidLat as number, lng: withCentroid.centroidLng as number, label: withCentroid.label } : null;
  }, [areas]);

  // Default base: the service area above, else the newest plan's base, else
  // the phone's location (resolved below) — "most people don't know
  // addresses" (the owner), so the map and My-location come before typing.
  const defaultBase = useMemo<BasePoint | null>(() => serviceAreaBase ?? plans[0]?.result.base ?? null, [serviceAreaBase, plans]);

  const [base, setBase] = useState<BasePoint | null>(defaultBase);
  useEffect(() => {
    if (!base && defaultBase) setBase(defaultBase);
  }, [base, defaultBase]);

  // Nothing to go on → find the phone, so the map and the button are never dead.
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
      })
      .finally(() => {
        if (!cancelled) setLocating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(() => {
    if (!base || activeRun) return;
    // Fire and forget: the runner owns the run, saves the plan, rings the bell.
    void startKnockPlan({ base, own: ownActivityNow(), mode, radiusMiles }).then((outcome) => {
      if (outcome.status === 'ok') {
        toast({ tone: 'success', title: 'Knock plan ready', body: outcome.plan.title });
      } else if (outcome.status === 'no_storms') {
        toast({ tone: 'warn', title: 'No qualifying storms', body: `${outcome.eventCount} reports, none in a rankable area. Try a wider radius.` });
      } else if (!outcome.cancelled) {
        toast({ tone: 'danger', title: 'Knock Planner could not finish', body: outcome.reason });
      }
    });
    toast({ tone: 'info', title: 'Working on it', body: 'You can leave — the bell rings when the plan is ready.' });
  }, [activeRun, base, mode, radiusMiles, toast]);

  const latest = plans[0];
  const byDay = useMemo(() => groupByDay(plans), [plans]);
  const calibrationLines = useMemo(() => (calibration ? calibration.lines.filter((l) => l.doors > 0) : []), [calibration]);

  const baseLabel = base ? baseDisplayLabel(base) : '';
  const findLabel =
    mode === 'neighbours'
      ? `Find neighbours of my jobs within ${radiusMiles} mi`
      : baseLabel
        ? `Find storm-hit streets within ${radiusMiles} mi of ${baseLabel}`
        : `Find storm-hit streets within ${radiusMiles} mi`;
  const runSummaryLabel = activeRun ? `${activeRun.baseLabel || baseLabel || 'Pinned spot'} · ${activeRun.radiusMiles ?? radiusMiles} mi` : '';

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Knock Planner"
        subtitle={`Storms within ${radiusMiles} mi · last ${LOOKBACK_MONTHS} months · roof age · your footprint`}
        back={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {activeRun ? (
          <>
            <View style={styles.runSummaryWrap}>
              <View style={styles.runSummaryPill}>
                <Ionicons name={mode === 'neighbours' ? 'home' : 'compass'} size={16} color={colors.textInverse} />
                <Text style={styles.runSummaryText} numberOfLines={1}>
                  {runSummaryLabel}
                </Text>
              </View>
            </View>
            <RunProgress
              run={activeRun}
              runHistory={runHistory}
              fallbackRadiusMiles={radiusMiles}
              fallbackMode={mode}
              onLeave={() => router.back()}
              onCancel={() => cancelKnockPlan()}
            />
          </>
        ) : (
          <>
            <BasePicker base={base} radiusMiles={radiusMiles} onChangeBase={setBase} locating={locating} serviceArea={serviceAreaBase} />
            <RadiusDial value={radiusMiles} onChange={setRadiusMiles} onCommit={setStoreRadiusMiles} />
          </>
        )}

        {latest && !activeRun ? (
          <FadeSlideIn index={0}>
            <PlanRow plan={latest} latest onPress={() => router.push(`/knock-plan/${latest.id}` as any)} />
          </FadeSlideIn>
        ) : null}

        {plans.length === 0 && !activeRun ? (
          <RichCard icon="compass-outline" iconTone="orange" title="One tap, a plan for the day">
            <Text style={styles.body}>
              Pulls every NWS hail and wind report within your radius (up to 50 mi) from the last {LOOKBACK_MONTHS} months, scores each
              neighbourhood by how hard and how recently it was hit, how old its roofs are, and how far it is — then saves a plan you can act
              on: where to go, why, how many claim-grade roofs to expect, and a route to start knocking. Or rank the streets around your own
              jobs and lead with the yard sign.
            </Text>
          </RichCard>
        ) : null}

        {calibrationRecords.length > 0 && calibration ? (
          <RichCard
            icon="analytics-outline"
            iconTone="green"
            title="Your calibration"
            subtitle={`${calibration.totalDoors} doors on ${calibration.plans} plan${calibration.plans === 1 ? '' : 's'} · ${calibration.totalFinds} claim-grade finds · your market runs ${calibration.marketRatio.toFixed(1)}× the table`}
            action={{ label: 'Reset', onPress: () => setConfirmReset(true), icon: null }}
          >
            <View style={styles.calRows}>
              {calibrationLines.map((l) => (
                <View key={l.hailClass} style={styles.calRow}>
                  <Text style={styles.calLabel} numberOfLines={1}>
                    {l.label}
                  </Text>
                  <Text style={styles.calRates}>
                    {l.tableRate.toFixed(2)} → <Text style={styles.calYours}>{l.rate.toFixed(2)}</Text>
                  </Text>
                  <Text style={styles.calDoors}>
                    {l.doors} door{l.doors === 1 ? '' : 's'}
                    {l.method === 'posterior' ? '' : ' · market'}
                  </Text>
                </View>
              ))}
              <Text style={styles.calFoot}>
                Table rate → your rate per roof, from the doors you knocked inside planned areas. A class needs 20 doors before its own number is used;
                until then it takes the market ratio. Every new plan starts from these.
              </Text>
            </View>
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

      {!activeRun ? (
        <View style={styles.dock}>
          <View style={styles.modeRow}>
            {MODES.map((m) => {
              const on = mode === m.id;
              const disabled = m.id === 'neighbours' && neighboursOff;
              return (
                <PressableScale
                  key={m.id}
                  style={[styles.modeChip, on && styles.modeChipOn, disabled && styles.modeChipOff]}
                  onPress={() => !disabled && setMode(m.id)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled }}
                  accessibilityLabel={m.label}
                >
                  <Ionicons name={m.icon} size={18} color={on ? colors.textInverse : disabled ? colors.textSubtle : colors.text} />
                  <Text style={[styles.modeText, on && styles.modeTextOn, disabled && styles.modeTextOff]} numberOfLines={1}>
                    {m.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          {neighboursOff ? <Text style={styles.dockHint}>Neighbours needs a job with an address — none on this phone yet.</Text> : null}
          <PressableScale
            style={[styles.primaryBtn, !base && styles.primaryBtnDisabled]}
            onPress={run}
            disabled={!base}
            accessibilityRole="button"
            accessibilityLabel={findLabel}
          >
            <Ionicons name={mode === 'neighbours' ? 'home' : 'compass'} size={22} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>{findLabel}</Text>
          </PressableScale>
          {!base && !locating ? <Text style={styles.dockHint}>Pick a base first — drop a pin, use your location, or type an address.</Text> : null}
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirmReset}
        title="Reset your calibration?"
        body="The base rates go back to the table and the count starts over from now — doors you knocked before today no longer feed it. Your plans and knocks stay."
        confirmLabel="Reset"
        onConfirm={() => {
          resetCalibration();
          toast({ tone: 'info', title: 'Calibration reset', body: 'Base rates are the table again; the count starts from your next door.' });
        }}
        onClose={() => setConfirmReset(false)}
      />
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
          {r.mode === 'neighbours' ? <Pill label="Neighbours" tone="info" size="sm" /> : null}
        </View>
        <Text style={styles.planSub} numberOfLines={2}>
          {r.areas.length} areas · {r.radiusMiles} mi · best {top?.name ?? top?.storm.town ?? '—'} · expect ~{Math.round(r.plan.expected)} claim-grade roofs
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
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: touchTarget.sticky * 2 + spacing.xxxl * 2 },
  body: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 21 },
  runSummaryWrap: { alignItems: 'center' },
  runSummaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
  },
  runSummaryText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textInverse },
  dayGroup: { gap: spacing.sm },
  dayLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  calRows: { gap: spacing.sm },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  calLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text },
  calRates: { fontSize: fontSize.bodyMd, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  calYours: { fontWeight: fontWeight.bold, color: colors.text },
  calDoors: { fontSize: fontSize.bodySm, color: colors.textSubtle, minWidth: 72, textAlign: 'right' },
  calFoot: { fontSize: fontSize.caption, color: colors.textSubtle, lineHeight: 16, marginTop: spacing.xs },
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
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
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
    gap: spacing.sm,
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  modeChip: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  modeChipOn: { backgroundColor: colors.navy },
  modeChipOff: { backgroundColor: colors.fillDisabled },
  modeText: { flexShrink: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  modeTextOn: { color: colors.textInverse },
  modeTextOff: { color: colors.textSubtle },
  primaryBtn: { flexDirection: 'row', gap: spacing.sm, height: touchTarget.sticky, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, ...shadows.card },
  primaryBtnDisabled: { backgroundColor: colors.accentDisabled },
  primaryBtnText: { flexShrink: 1, color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, textAlign: 'center' },
  dockHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
});
