// "Where should I knock?" — one button, a ranked list with the reasons, and
// a trip plan. The roofer should not have to think about where to go.
//
// Reads: service area (default base), the roofer's own knocks and jobs
// (already-canvassed penalty / social proof), the last result (persisted).
// Writes: the knock session's route target ("Add to route" / "Start this
// plan"). Every number on the screen comes from lib/services/
// knockOpportunities.ts; the AI brief only phrases them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { LocationField, type ResolvedLocation } from '@/components/LocationField';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { IconChip } from '@/components/ui/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion/FadeSlideIn';
import { SearchAnimation } from '@/components/knock/SearchAnimation';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useKnockFinderStore } from '@/lib/stores/knockFinderStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { fetchNearbyHomes, recordCardUrl, recordFactsLine } from '@/lib/services/propertyRecord';
import { isApillowConfigured } from '@/lib/env';
import type { PropertyRecord } from '@/lib/models/types';
import {
  FINDER_STEPS,
  directionsUrl,
  findKnockOpportunities,
  type FinderStep,
} from '@/lib/services/knockFinder';
import {
  CONFIDENCE,
  DOORS_PER_STOP,
  LOOKBACK_MONTHS,
  SEARCH_RADIUS_MILES,
  TARGET_FINDS,
  clockFromStart,
  fmtMinutes,
  type BasePoint,
  type ScoredArea,
  type TripDay,
} from '@/lib/services/knockOpportunities';
import { KNOCK_ROUTE_RADIUS_MILES } from '@/lib/services/stormWatch';
import { formatRelative } from '@/lib/format/date';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

export default function KnockFinderScreen() {
  const router = useRouter();
  const areas = useServiceAreaStore((s) => s.areas);
  const inspections = useInspectionStore((s) => s.inspections);
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const archive = useKnockSessionStore((s) => s.archive);
  const startSession = useKnockSessionStore((s) => s.start);
  const setRouteTarget = useKnockSessionStore((s) => s.setRouteTarget);
  const toast = useToastStore((s) => s.show);
  const result = useKnockFinderStore((s) => s.lastResult);
  const setResult = useKnockFinderStore((s) => s.setResult);
  const cachedHousing = useKnockFinderStore((s) => s.cachedHousing);
  const cacheHousing = useKnockFinderStore((s) => s.cacheHousing);

  // Default base: the first service area with a centroid, else the last
  // result's base, else the roofer types or taps "Use my location".
  const defaultBase = useMemo<BasePoint | null>(() => {
    const withCentroid = areas.find((a) => typeof a.centroidLat === 'number' && typeof a.centroidLng === 'number');
    if (withCentroid) return { lat: withCentroid.centroidLat as number, lng: withCentroid.centroidLng as number, label: withCentroid.label };
    return result?.base ?? null;
  }, [areas, result?.base]);

  const [base, setBase] = useState<BasePoint | null>(defaultBase);
  const [baseText, setBaseText] = useState(defaultBase?.label ?? '');
  useEffect(() => {
    if (!base && defaultBase) {
      setBase(defaultBase);
      setBaseText(defaultBase.label);
    }
  }, [base, defaultBase]);

  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<FinderStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noStorms, setNoStorms] = useState<number | null>(null);

  const onResolved = useCallback((loc: ResolvedLocation) => {
    const label = loc.city ? `${loc.city}${loc.stateCode ? `, ${loc.stateCode}` : ''}` : loc.address;
    setBase({ lat: loc.lat, lng: loc.lng, label });
    setBaseText(loc.address);
  }, []);

  const run = useCallback(async () => {
    if (!base || running) return;
    setRunning(true);
    setError(null);
    setNoStorms(null);
    setStep('storms');
    const own = {
      knocks: [...(activeSession ? [activeSession] : []), ...archive].flatMap((s) =>
        s.knocks.map((k) => ({ lat: k.lat, lng: k.lng, at: k.createdAt })),
      ),
      jobs: inspections
        .filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number')
        .map((i) => ({ lat: i.lat as number, lng: i.lng as number })),
    };
    try {
      const outcome = await findKnockOpportunities({
        base,
        own,
        housingCache: { get: cachedHousing, set: cacheHousing },
        onStep: setStep,
      });
      if (outcome.status === 'ok') setResult(outcome.result);
      else if (outcome.status === 'no_storms') setNoStorms(outcome.eventCount);
      else setError(outcome.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setRunning(false);
      setStep(null);
    }
  }, [activeSession, archive, base, cacheHousing, cachedHousing, inspections, running, setResult]);

  // Storm Tracer lands on the cell and draws its canvass ring, labelled.
  const showOnMap = (a: ScoredArea) =>
    router.push({
      pathname: '/(tabs)/map',
      params: {
        filter: 'storms',
        lat: String(a.lat),
        lng: String(a.lng),
        ring: String(KNOCK_ROUTE_RADIUS_MILES),
        ringLabel: `${a.name ?? a.storm.town ?? 'Storm area'} · Knock ${a.knockScore}`,
      },
    } as any);

  const routeTo = (a: ScoredArea, silent = false) => {
    const target = {
      lat: a.lat,
      lng: a.lng,
      radiusMiles: KNOCK_ROUTE_RADIUS_MILES,
      label: a.name ?? a.storm.town ?? 'Storm area',
    };
    if (activeSession) setRouteTarget(target);
    else startSession(undefined, target);
    if (!silent) {
      toast({ tone: 'success', title: 'Added to your knock route', body: `${target.label} · ${KNOCK_ROUTE_RADIUS_MILES} mi canvass radius` });
      router.push('/door-knocking');
    }
  };

  const startPlan = (day: TripDay) => {
    const first = day.stops[0];
    if (!first) return;
    routeTo(first.area, true);
    toast({
      tone: 'success',
      title: `Day ${day.day} started`,
      body: `${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} · first: ${first.area.name ?? first.area.storm.town ?? 'storm area'}`,
    });
    router.push('/door-knocking');
  };

  const openDirections = (day: TripDay) => {
    if (!result) return;
    const url = directionsUrl(result.base, day.stops.map((s) => ({ lat: s.area.lat, lng: s.area.lng })));
    if (url) Linking.openURL(url).catch(() => toast({ tone: 'warn', title: 'Could not open Maps' }));
  };

  const briefFor = (key: string) => result?.brief?.areas.find((b) => b.key === key);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Where should I knock?"
        subtitle={`Storms within ${SEARCH_RADIUS_MILES} mi · last ${LOOKBACK_MONTHS} months · roof age · your footprint`}
        back={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <RichCard icon="navigate-outline" iconTone="blue" title="Search from" subtitle={base ? base.label : 'Your shop, home, or a town you want to work'}>
          <LocationField
            value={baseText}
            onChangeText={setBaseText}
            onResolved={onResolved}
            placeholder="Home base, shop, or a town"
            biasLat={base?.lat}
            biasLng={base?.lng}
          />
        </RichCard>

        {running && step ? <ProgressCard step={step} /> : null}

        {error && !running ? (
          <RichCard icon="cloud-offline-outline" iconTone="orange" title="Storm history not available" subtitle={error}>
            <Text style={styles.body}>Nothing was made up. Try again when you have signal.</Text>
          </RichCard>
        ) : null}

        {noStorms != null && !running ? (
          <RichCard icon="sunny-outline" iconTone="quiet" title="No qualifying storms" subtitle={`${noStorms} NWS reports in ${LOOKBACK_MONTHS} months within ${SEARCH_RADIUS_MILES} mi — none landed in a rankable area.`}>
            <Text style={styles.body}>Try a different base, or widen your service area.</Text>
          </RichCard>
        ) : null}

        {result && !running ? (
          <>
            <FadeSlideIn index={0}>
              <RichCard
                icon="sparkles-outline"
                iconTone="orange"
                title={result.brief?.headline ?? `${result.areas.length} areas worth a day`}
                subtitle={`${result.eventCount} NWS reports (${result.hailCount} hail · ${result.windCount} wind) · ${result.cellCount} areas scored · ${formatRelative(result.generatedAt, 'just now')}`}
                action={{ label: 'Refresh', onPress: run, icon: 'refresh-outline' }}
              >
                <View style={styles.statRow}>
                  <Stat value={String(result.plan.totalDoors)} label="doors planned" />
                  <Stat value={`~${Math.round(result.plan.expected)}`} label="claim-grade roofs" />
                  <Stat value={`≥${result.plan.atLeast}`} label={`at ${Math.round(CONFIDENCE * 100)}%`} />
                </View>
                {result.notes.map((n) => (
                  <Text key={n} style={styles.note}>
                    {n}
                  </Text>
                ))}
                <Text style={styles.note}>
                  {result.briefStatus === 'ai'
                    ? `Rationale written by ${result.brief?.modelUsed ?? 'Gemini'} from the engine's numbers.`
                    : result.briefStatus === 'no_key'
                      ? 'AI brief is not set up on this build — showing the rule-based rationale.'
                      : result.briefStatus === 'unavailable'
                        ? 'AI brief did not answer — showing the rule-based rationale.'
                        : 'Rule-based rationale.'}
                </Text>
              </RichCard>
            </FadeSlideIn>

            <SectionHeader title="Best areas to knock" />
            {result.areas.map((a, i) => (
              <FadeSlideIn key={a.key} index={i + 1}>
                <AreaCard
                  rank={i + 1}
                  area={a}
                  aiRationale={briefFor(a.key)}
                  onMap={() => showOnMap(a)}
                  onRoute={() => routeTo(a)}
                />
              </FadeSlideIn>
            ))}

            <SectionHeader title="Trip plan" />
            {result.brief?.planNarrative ? <Text style={styles.narrative}>{result.brief.planNarrative}</Text> : null}
            {result.plan.days.map((d, i) => (
              <FadeSlideIn key={d.day} index={result.areas.length + 1 + i}>
                <DayCard day={d} onStart={() => startPlan(d)} onDirections={() => openDirections(d)} />
              </FadeSlideIn>
            ))}
            {result.plan.unplanned.length > 0 ? (
              <Text style={styles.note}>
                {result.plan.unplanned.length} more area{result.plan.unplanned.length === 1 ? '' : 's'} did not fit in three days.
              </Text>
            ) : null}

            <RichCard icon="information-circle-outline" iconTone="quiet" title="How this is scored">
              <Text style={styles.body}>
                Each 3-mile area gets a Knock Score from the hail size and wind speed NWS reported there (bigger and more
                recent counts more), the roof age and owner-occupancy of its Census tract, the drive from base, and how
                much of it you have knocked in the last 60 days. "Expect" is the per-roof chance of claim-grade damage
                (8+ functional hits per square) times {DOORS_PER_STOP} doors; "at least" is the {Math.round(CONFIDENCE * 100)}%
                floor. {TARGET_FINDS} claim-grade roofs per stop is the bar a good day clears. Full method: docs/KNOCK_OPPORTUNITIES.md.
              </Text>
            </RichCard>
          </>
        ) : null}

        {!result && !running && !error && noStorms == null ? (
          <RichCard icon="compass-outline" iconTone="orange" title="One tap, a plan for the day">
            <Text style={styles.body}>
              Pulls every NWS hail and wind report within {SEARCH_RADIUS_MILES} miles from the last {LOOKBACK_MONTHS} months,
              scores each neighbourhood by how hard and how recently it was hit, how old its roofs are, and how far it is —
              then tells you where to go, why, and how many claim-grade roofs to expect at the door.
            </Text>
          </RichCard>
        ) : null}
      </ScrollView>

      <View style={styles.dock}>
        <PressableScale
          style={[styles.primaryBtn, (!base || running) && styles.primaryBtnDisabled]}
          onPress={run}
          disabled={!base || running}
          accessibilityRole="button"
          accessibilityLabel="Find damaged-roof areas"
        >
          {running ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="compass" size={22} color={colors.textInverse} />}
          <Text style={styles.primaryBtnText}>
            {running ? 'Finding…' : result ? 'Find again' : `Find damaged-roof areas within ${SEARCH_RADIUS_MILES} mi`}
          </Text>
        </PressableScale>
        {!base ? <Text style={styles.dockHint}>Pick a base first — type a town or use your location.</Text> : null}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function ProgressCard({ step }: { step: FinderStep }) {
  const idx = FINDER_STEPS.findIndex((s) => s.id === step);
  const current = FINDER_STEPS[idx]?.label;
  return (
    <RichCard padded={false}>
      {/* The map being searched — what the finder is doing, not a spinner. */}
      <SearchAnimation caption={current} />
      <View style={[styles.steps, styles.stepsPad]}>
        {FINDER_STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <View key={s.id} style={styles.stepRow}>
              {done ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : active ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.textSubtle} />
              )}
              <Text style={[styles.stepText, done && styles.stepDone, active && styles.stepActive]}>{s.label}</Text>
            </View>
          );
        })}
      </View>
    </RichCard>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function scoreTone(score: number): { ring: string; label: string } {
  if (score >= 70) return { ring: colors.success, label: 'Go' };
  if (score >= 45) return { ring: colors.warn, label: 'Worth it' };
  return { ring: colors.textSubtle, label: 'Maybe' };
}

function stormLine(a: ScoredArea): string {
  const s = a.storm;
  const parts: string[] = [];
  if (s.maxHailInches != null) parts.push(`${s.maxHailInches.toFixed(2)}" hail`);
  if (s.maxWindMph != null) parts.push(`${Math.round(s.maxWindMph)} mph wind`);
  if (parts.length === 0) parts.push(s.hailReports > 0 ? 'hail (no size)' : 'wind damage');
  const n = s.hailReports + s.windReports;
  parts.push(`${n} report${n === 1 ? '' : 's'}`);
  if (s.days.length > 1) parts.push(`${s.days.length} storm days`);
  return parts.join(' · ');
}

function AreaCard({
  rank,
  area,
  aiRationale,
  onMap,
  onRoute,
}: {
  rank: number;
  area: ScoredArea;
  aiRationale?: { rationale: string; opener: string };
  onMap: () => void;
  onRoute: () => void;
}) {
  const [open, setOpen] = useState(rank === 1);
  const tone = scoreTone(area.knockScore);
  const hr = area.hitRate;
  const name = area.name ?? area.storm.town ?? `Area ${rank}`;
  const h = area.housing;
  return (
    <RichCard padded={false}>
      <PressableScale style={styles.areaHead} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={`${name}, knock score ${area.knockScore}`}>
        <View style={[styles.ring, { borderColor: tone.ring }]}>
          <Text style={[styles.ringValue, { color: tone.ring }]}>{area.knockScore}</Text>
          <Text style={styles.ringLabel}>{tone.label}</Text>
        </View>
        <View style={styles.areaMain}>
          <View style={styles.areaTitleRow}>
            <Text style={styles.rank}>#{rank}</Text>
            <Text style={styles.areaTitle} numberOfLines={1}>
              {name}
            </Text>
          </View>
          {area.landmark ? <Text style={styles.areaSub}>{area.landmark}</Text> : null}
          <Text style={styles.areaSub}>
            {Math.round(area.distanceMiles)} mi {area.bearing} · {fmtMinutes(area.driveMinutes)} drive
          </Text>
          <View style={styles.pillRow}>
            <Pill label={stormLine(area)} tone={area.storm.maxHailInches != null && area.storm.maxHailInches >= 1 ? 'danger' : 'info'} size="sm" icon="thunderstorm-outline" />
          </View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSubtle} />
      </PressableScale>

      {open ? (
        <View style={styles.areaBody}>
          <View style={styles.expectBox}>
            <Text style={styles.expectTitle}>
              Knock {hr.doors} doors → expect ~{Math.round(hr.expected)} claim-grade roofs
            </Text>
            <Text style={styles.expectSub}>
              At least {hr.atLeast} at {Math.round(hr.confidence * 100)}% confidence · {Math.round(hr.pAtLeastTarget * 100)}% chance of{' '}
              {hr.target}+
              {hr.doorsForTarget != null && hr.doorsForTarget !== hr.doors ? ` · ${hr.doorsForTarget} doors for ${hr.target}` : ''}
            </Text>
          </View>

          <Text style={styles.housingLine}>
            {h.source === 'acs'
              ? `Built ~${h.medianYearBuilt ?? '—'} · ${h.ownerOccupiedShare != null ? Math.round(h.ownerOccupiedShare * 100) : '—'}% owner-occupied · ${
                  h.singleFamilyShare != null ? Math.round(h.singleFamilyShare * 100) : '—'
                }% single-family`
              : `Housing stock unknown${h.priorReason ? ` (${h.priorReason})` : ''}`}
          </Text>

          {aiRationale ? (
            <>
              <Text style={styles.rationale}>{aiRationale.rationale}</Text>
              {aiRationale.opener ? (
                <View style={styles.opener}>
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.brand} />
                  <Text style={styles.openerText}>{aiRationale.opener}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.bullets}>
              {area.reasons.map((r) => (
                <View key={r} style={styles.bullet}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletText}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {area.zip && isApillowConfigured ? <NearbyHomes zip={area.zip} areaName={name} /> : null}

          <View style={styles.actions}>
            <PressableScale style={styles.secondaryBtn} onPress={onMap} accessibilityRole="button" accessibilityLabel="Show on Storm Tracer">
              <Ionicons name="map-outline" size={20} color={colors.navy} />
              <Text style={styles.secondaryBtnText}>Storm Tracer</Text>
            </PressableScale>
            <PressableScale style={styles.routeBtn} onPress={onRoute} accessibilityRole="button" accessibilityLabel="Add to my knock route">
              <Ionicons name="walk-outline" size={20} color={colors.textInverse} />
              <Text style={styles.routeBtnText}>Add to route</Text>
            </PressableScale>
          </View>
        </View>
      ) : null}
    </RichCard>
  );
}

/**
 * The doors behind an area: homes recently sold in its ZIP (Zillow via
 * APIllow). A recent sale is a new owner, a new policy and often an inherited
 * roof — the warmest door on the street. Costs 5 of the month's 50 free
 * lookups, so it is a button that says so, never automatic. Each home can
 * become a lead with the house photo already on it.
 */
function NearbyHomes({ zip, areaName }: { zip: string; areaName: string }) {
  const [state, setState] = useState<{ status: 'idle' } | { status: 'busy' } | { status: 'ok'; homes: PropertyRecord[] } | { status: 'error'; reason: string }>({ status: 'idle' });
  const [added, setAdded] = useState<Record<string, string>>({});
  const createLead = useLeadStore((s) => s.create);
  const setLeadRecord = useLeadStore((s) => s.setPropertyRecord);
  const leads = useLeadStore((s) => s.leads);
  const toast = useToastStore((s) => s.show);

  const run = async () => {
    setState({ status: 'busy' });
    const res = await fetchNearbyHomes({ zip, kind: 'sold', max: 5 });
    if (res.status === 'ok') setState({ status: 'ok', homes: res.homes });
    else setState({ status: 'error', reason: res.reason });
  };

  const addLead = (h: PropertyRecord) => {
    const address = [h.streetAddress, h.city, h.state ? `${h.state} ${h.zipcode ?? ''}`.trim() : undefined].filter(Boolean).join(', ');
    if (!address) return;
    const existing = leads.find((l) => l.address.trim().toLowerCase() === address.toLowerCase());
    if (existing) {
      setAdded((m) => ({ ...m, [address]: existing.id }));
      toast({ tone: 'info', title: 'Already a lead', body: existing.customerName });
      return;
    }
    const lead = createLead({
      customerName: `Homeowner at ${h.streetAddress ?? address}`,
      address,
      lat: h.lat,
      lng: h.lng,
      stage: 'new',
      source: 'zillow',
    });
    setLeadRecord(lead.id, h);
    setAdded((m) => ({ ...m, [address]: lead.id }));
    toast({ tone: 'success', title: 'Lead created', body: `${address} · recently sold` });
  };

  if (state.status === 'idle') {
    return (
      <PressableScale style={styles.nearbyBtn} onPress={run} accessibilityRole="button" accessibilityLabel={`Find 5 recently sold homes in ${zip}`}>
        <Ionicons name="home-outline" size={20} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Text style={styles.nearbyTitle}>Find 5 recently sold homes here</Text>
          <Text style={styles.nearbySub}>ZIP {zip} · new owners, new policies · uses 5 of your 50 monthly property lookups</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </PressableScale>
    );
  }
  if (state.status === 'busy') {
    return (
      <View style={styles.nearbyBtn}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.nearbySub}>Asking Zillow for recent sales in {zip}…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.nearbyBtn}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.warn} />
        <Text style={[styles.nearbySub, { flex: 1 }]}>{state.reason}</Text>
      </View>
    );
  }
  if (state.homes.length === 0) {
    return (
      <View style={styles.nearbyBtn}>
        <Ionicons name="home-outline" size={20} color={colors.textSubtle} />
        <Text style={[styles.nearbySub, { flex: 1 }]}>Zillow shows no recent sales in {zip}.</Text>
      </View>
    );
  }
  return (
    <View style={styles.nearbyList}>
      <Text style={styles.nearbyTitle}>Recently sold in {areaName}</Text>
      {state.homes.map((h, i) => {
        const address = [h.streetAddress, h.city].filter(Boolean).join(', ');
        const key = [h.streetAddress, h.city, h.state ? `${h.state} ${h.zipcode ?? ''}`.trim() : undefined].filter(Boolean).join(', ');
        const leadId = added[key];
        return (
          <View key={h.zpid ?? i} style={styles.nearbyRow}>
            {recordCardUrl(h) ? (
              <Image source={{ uri: recordCardUrl(h) }} style={styles.nearbyThumb} contentFit="cover" transition={120} />
            ) : (
              <View style={[styles.nearbyThumb, { alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="home-outline" size={20} color={colors.textSubtle} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.nearbyAddr} numberOfLines={1}>{address || 'Address withheld'}</Text>
              <Text style={styles.nearbySub} numberOfLines={2}>{recordFactsLine(h) ?? 'Recently sold'}</Text>
            </View>
            <PressableScale
              style={[styles.nearbyAdd, leadId ? styles.nearbyAdded : null]}
              onPress={() => addLead(h)}
              accessibilityRole="button"
              accessibilityLabel={leadId ? 'Lead created' : `Create a lead for ${address}`}
            >
              <Ionicons name={leadId ? 'checkmark' : 'person-add-outline'} size={18} color={leadId ? colors.success : colors.textInverse} />
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

function DayCard({ day, onStart, onDirections }: { day: TripDay; onStart: () => void; onDirections: () => void }) {
  return (
    <RichCard
      icon="calendar-outline"
      iconTone="purple"
      title={`Day ${day.day}`}
      subtitle={`${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} · ${Math.round(day.totalMiles)} mi · ${fmtMinutes(day.totalMinutes)} · expect ~${Math.round(day.expected)}, at least ${day.atLeast}`}
    >
      <View style={styles.stops}>
        {day.stops.map((s, i) => (
          <View key={s.area.key} style={[styles.stopRow, i > 0 && styles.stopBorder]}>
            <IconChip name="location-outline" tone={i === 0 ? 'orange' : 'quiet'} size="sm" />
            <View style={styles.stopMain}>
              <Text style={styles.stopTitle} numberOfLines={1}>
                {clockFromStart(s.startMinute)} · {s.area.name ?? s.area.storm.town ?? 'Storm area'}
              </Text>
              <Text style={styles.stopSub}>
                {Math.round(s.driveMiles)} mi drive · {s.doors} doors · ~{fmtMinutes(s.workMinutes)} · ≥{s.atLeast} claim-grade
              </Text>
            </View>
            <Text style={styles.stopScore}>{s.area.knockScore}</Text>
          </View>
        ))}
      </View>
      <View style={styles.actions}>
        <PressableScale style={styles.secondaryBtn} onPress={onDirections} accessibilityRole="button" accessibilityLabel="Open in Google Maps">
          <Ionicons name="navigate-outline" size={20} color={colors.navy} />
          <Text style={styles.secondaryBtnText}>Directions</Text>
        </PressableScale>
        <PressableScale style={styles.routeBtn} onPress={onStart} accessibilityRole="button" accessibilityLabel={`Start day ${day.day}`}>
          <Ionicons name="play" size={20} color={colors.textInverse} />
          <Text style={styles.routeBtnText}>Start this day</Text>
        </PressableScale>
      </View>
    </RichCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: touchTarget.sticky + spacing.xxxl * 2 },
  body: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 21 },
  note: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
  narrative: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21, marginBottom: spacing.sm },

  statRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  statValue: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.accent },
  statLabel: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center' },

  steps: { gap: spacing.sm },
  stepsPad: { padding: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  stepText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textSubtle },
  stepDone: { color: colors.textMuted },
  stepActive: { color: colors.text, fontWeight: fontWeight.semibold },

  // Area card — the whole header is the disclosure hit target (≥56pt).
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: touchTarget.preferred },
  ring: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ringValue: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, lineHeight: 22 },
  ringLabel: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: -2 },
  areaMain: { flex: 1, gap: 2 },
  areaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.textSubtle },
  areaTitle: { flex: 1, fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  areaSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  areaBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  expectBox: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.accentSoft, gap: 2 },
  expectTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  expectSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  housingLine: { fontSize: fontSize.bodySm, color: colors.textMuted },
  rationale: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21 },
  opener: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  openerText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20, fontStyle: 'italic' },
  bullets: { gap: spacing.xs },
  bullet: { flexDirection: 'row', gap: spacing.sm },
  bulletDot: { color: colors.accent, fontSize: fontSize.bodyMd, lineHeight: 20 },
  bulletText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20 },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  nearbyBtn: { minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  nearbyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  nearbySub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 17 },
  nearbyList: { gap: spacing.sm },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.standard },
  nearbyThumb: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  nearbyAddr: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  nearbyAdd: { width: touchTarget.standard, height: touchTarget.standard, borderRadius: touchTarget.standard / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  nearbyAdded: { backgroundColor: colors.successSoft },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  routeBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyMd },

  stops: { gap: 0, marginBottom: spacing.sm },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: touchTarget.standard },
  stopBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  stopMain: { flex: 1, gap: 2 },
  stopTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  stopSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  stopScore: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.accent },

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
  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  primaryBtnDisabled: { backgroundColor: colors.accentDisabled },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  dockHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
});
