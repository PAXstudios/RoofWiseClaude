// A saved knock plan, interactive. Used by app/knock-plan/[id].tsx.
//
// Every area card acts: Storm Tracer, Directions, Add to route, a status the
// roofer sets as the day unfolds (Planned → Knocked / Scheduled / Skipped /
// Done), a live "knocks here" line counted from real door-knocking sessions
// inside the area's 3-mile ring since the plan was made, and the ZIP's
// recently-sold homes — each of which can become a job, a lead, or the
// route target in one tap. Every number is the engine's; the AI brief only
// phrases it.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { IconChip } from '@/components/ui/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion/FadeSlideIn';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { startRoute } from '@/components/knock/sessionTracker';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { usePropertyRecordStore } from '@/lib/stores/propertyRecordStore';
import { AREA_STATUS_LABELS, useKnockFinderStore, type AreaStatus, type KnockDaySchedule, type KnockPlan } from '@/lib/stores/knockFinderStore';
import { ScheduleDaySheet, startClockLabel } from '@/components/knock/ScheduleDaySheet';
import { directionsUrl } from '@/lib/services/knockFinder';
import {
  CELL_MILES,
  CONFIDENCE,
  DOORS_PER_STOP,
  TARGET_FINDS,
  clockFromStart,
  fmtMinutes,
  stormYearOf,
  type ScoredArea,
  type TripDay,
} from '@/lib/services/knockOpportunities';
import { areaPerformance, performanceLine, type PerformanceCounts } from '@/lib/services/knockCalibration';
import { fetchNearbyHomes, recordCardUrl, recordFactsLine, roofYearFromRecord } from '@/lib/services/propertyRecord';
import { KNOCK_ROUTE_RADIUS_MILES } from '@/lib/services/stormWatch';
import { isApillowConfigured } from '@/lib/env';
import type { KnockRouteTarget, PropertyRecord } from '@/lib/models/types';
import { formatRelative } from '@/lib/format/date';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

const STATUS_ORDER: AreaStatus[] = ['planned', 'knocked', 'scheduled', 'skipped', 'done'];
const STATUS_TONE: Record<AreaStatus, 'neutral' | 'info' | 'success' | 'warn'> = {
  planned: 'neutral',
  knocked: 'info',
  scheduled: 'warn',
  skipped: 'neutral',
  done: 'success',
};
export function PlanView({ plan }: { plan: KnockPlan }) {
  const router = useRouter();
  const result = plan.result;
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const archive = useKnockSessionStore((s) => s.archive);
  const startSession = useKnockSessionStore((s) => s.start);
  const setRouteTarget = useKnockSessionStore((s) => s.setRouteTarget);
  const setRouteStops = useKnockSessionStore((s) => s.setRouteStops);
  const setAreaStatus = useKnockFinderStore((s) => s.setAreaStatus);
  // The trip day being put on the calendar (ScheduleDaySheet); null = closed.
  const [scheduling, setScheduling] = useState<TripDay | null>(null);
  const toast = useToastStore((s) => s.show);

  // Real knocks inside each area's ring since this plan was made — the same
  // counter the calibration feeds on (lib/services/knockCalibration.ts).
  const knocksByArea = useMemo(() => {
    const knocks = [...(activeSession ? [activeSession] : []), ...archive].flatMap((s) => s.knocks);
    const out: Record<string, PerformanceCounts> = {};
    for (const a of result.areas) out[a.key] = areaPerformance(knocks, a, plan.createdAt, CELL_MILES);
    return out;
  }, [activeSession, archive, plan.createdAt, result.areas]);
  const neighbours = result.mode === 'neighbours';

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

  const toTarget = (a: ScoredArea): KnockRouteTarget => ({
    lat: a.lat,
    lng: a.lng,
    label: a.name ?? a.storm.town ?? 'Storm area',
    radiusMiles: KNOCK_ROUTE_RADIUS_MILES,
  });

  // Start a route the proper way — permission → GPS watcher → mileage trip →
  // session (sessionTracker.startRoute). When location is refused the
  // session is still created with the plan on it, so nothing the roofer
  // chose is lost: Knock mode shows the permission card and the tracker
  // starts the trip on the first fix once it is granted.
  const beginRoute = async (opts: { routeTarget?: KnockRouteTarget; routeStops?: KnockRouteTarget[] }) => {
    const r = await startRoute(opts);
    if (r.ok) return true;
    startSession(undefined, opts.routeTarget ?? opts.routeStops?.[0], { routeStops: opts.routeStops });
    toast({ tone: 'warn', title: 'Location is off', body: 'The route is set. Turn location on in Knock mode to place pins and count miles.' });
    return false;
  };

  const routeTo = async (target: { lat: number; lng: number; label: string }) => {
    const t = { ...target, radiusMiles: KNOCK_ROUTE_RADIUS_MILES };
    if (activeSession) {
      setRouteTarget(t);
      toast({ tone: 'success', title: 'Added to your knock route', body: `${t.label} · ${KNOCK_ROUTE_RADIUS_MILES} mi canvass radius` });
    } else if (await beginRoute({ routeTarget: t })) {
      toast({ tone: 'success', title: 'Knock route started', body: `${t.label} · ${KNOCK_ROUTE_RADIUS_MILES} mi canvass radius` });
    }
    router.push('/door-knocking');
  };

  // The whole day rides the session as ordered stops — Knock mode draws a
  // ring per stop, accents the current one and steps through them with
  // "Next stop". A route already running takes the stops in place.
  const startDay = async (day: TripDay) => {
    const first = day.stops[0];
    if (!first) return;
    const stops = day.stops.map((s) => toTarget(s.area));
    let ok = true;
    if (activeSession) setRouteStops(stops);
    else ok = await beginRoute({ routeStops: stops });
    for (const s of day.stops) if (!plan.areaStatus[s.area.key]) setAreaStatus(plan.id, s.area.key, 'scheduled');
    if (ok) {
      toast({
        tone: 'success',
        title: `Day ${day.day} started`,
        body: `${stops.length} stop${stops.length === 1 ? '' : 's'} on your route · first: ${stops[0].label}`,
      });
    }
    router.push('/door-knocking');
  };

  const openDirections = (stops: { lat: number; lng: number }[]) => {
    const url = directionsUrl(result.base, stops);
    if (url) Linking.openURL(url).catch(() => toast({ tone: 'warn', title: 'Could not open Maps' }));
  };

  const briefFor = (key: string) => result.brief?.areas.find((b) => b.key === key);

  return (
    <>
      <FadeSlideIn index={0}>
        <RichCard
          icon={neighbours ? 'home-outline' : 'sparkles-outline'}
          iconTone="orange"
          title={result.brief?.headline ?? (neighbours ? `${result.areas.length} streets around your jobs` : `${result.areas.length} areas worth a day`)}
          subtitle={`${neighbours ? `${result.cellCount} streets with your jobs · ` : ''}${result.eventCount} NWS reports (${result.hailCount} hail · ${result.windCount} wind) within ${result.radiusMiles} mi${
            neighbours ? '' : ` · ${result.cellCount} areas scored`
          } · ${formatRelative(result.generatedAt, 'just now')}`}
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

      <SectionHeader title={neighbours ? 'Streets around your jobs' : 'Best areas to knock'} />
      {result.areas.map((a, i) => (
        <FadeSlideIn key={a.key} index={i + 1}>
          <AreaCard
            rank={i + 1}
            area={a}
            status={plan.areaStatus[a.key] ?? 'planned'}
            knocks={knocksByArea[a.key]}
            aiRationale={briefFor(a.key)}
            onStatus={(st) => setAreaStatus(plan.id, a.key, st)}
            onMap={() => showOnMap(a)}
            onDirections={() => openDirections([{ lat: a.lat, lng: a.lng }])}
            onRoute={() => void routeTo({ lat: a.lat, lng: a.lng, label: a.name ?? a.storm.town ?? 'Storm area' })}
            onRouteHome={(h, label) => void routeTo({ lat: h.lat ?? a.lat, lng: h.lng ?? a.lng, label })}
          />
        </FadeSlideIn>
      ))}

      <SectionHeader title="Trip plan" />
      {result.brief?.planNarrative ? <Text style={styles.narrative}>{result.brief.planNarrative}</Text> : null}
      {result.plan.days.map((d, i) => (
        <FadeSlideIn key={d.day} index={result.areas.length + 1 + i}>
          <DayCard
            day={d}
            scheduled={plan.schedule?.find((s) => s.day === d.day)}
            onStart={() => void startDay(d)}
            onDirections={() => openDirections(d.stops.map((s) => ({ lat: s.area.lat, lng: s.area.lng })))}
            onSchedule={() => setScheduling(d)}
          />
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
          recent counts more), the roof age and owner-occupancy of its Census tract, the drive from base, and how much
          of it you have knocked in the last 60 days.{neighbours ? ' In this mode the streets are the ones your own jobs sit on — a signed job counts ×1.6, any job ×1.25.' : ''}{' '}
          "Expect" is the per-roof chance of claim-grade damage (8+ functional hits per square) times {DOORS_PER_STOP} doors; "at least" is the{' '}
          {Math.round(CONFIDENCE * 100)}% floor. {TARGET_FINDS} claim-grade roofs per stop is the bar a good day clears. The per-roof chance starts from a
          base-rate table by hail size that your own knocked doors recalibrate over time, and homes Zillow says have a roof newer than the storm lower it.
          Full method: docs/KNOCK_OPPORTUNITIES.md.
        </Text>
      </RichCard>

      {scheduling ? (
        <ScheduleDaySheet visible plan={plan} day={scheduling} onClose={() => setScheduling(null)} />
      ) : null}
    </>
  );
}

/** "Thu 5" from a YYYY-MM-DD date, in the phone's locale; the raw string if it does not parse. */
function scheduledDayLabel(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------

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
  status,
  knocks,
  aiRationale,
  onStatus,
  onMap,
  onDirections,
  onRoute,
  onRouteHome,
}: {
  rank: number;
  area: ScoredArea;
  status: AreaStatus;
  knocks?: PerformanceCounts;
  aiRationale?: { rationale: string; opener: string };
  onStatus: (s: AreaStatus) => void;
  onMap: () => void;
  onDirections: () => void;
  onRoute: () => void;
  onRouteHome: (h: PropertyRecord, label: string) => void;
}) {
  const [open, setOpen] = useState(rank === 1);
  const tone = scoreTone(area.knockScore);
  const hr = area.hitRate;
  const name = area.name ?? area.storm.town ?? `Area ${rank}`;
  const h = area.housing;
  return (
    <RichCard padded={false}>
      <PressableScale style={styles.areaHead} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={`${name}, knock score ${area.knockScore}, ${AREA_STATUS_LABELS[status]}`}>
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
            {status !== 'planned' ? <Pill label={AREA_STATUS_LABELS[status]} tone={STATUS_TONE[status]} size="sm" /> : null}
          </View>
          {area.landmark ? <Text style={styles.areaSub}>{area.landmark}</Text> : null}
          <Text style={styles.areaSub}>
            {Math.round(area.distanceMiles)} mi {area.bearing} · {fmtMinutes(area.driveMinutes)} drive
          </Text>
          {knocks && knocks.doors > 0 ? <Text style={styles.performance}>Performance: {performanceLine(knocks)}</Text> : null}
          <View style={styles.pillRow}>
            {area.mode === 'neighbours' && area.anchorJob ? (
              <Pill
                label={area.anchorJob.signed ? `Signed job here${(area.ownSignedJobs ?? 0) > 1 ? ` · ${area.ownSignedJobs}` : ''}` : `Your job here${area.ownJobs > 1 ? ` · ${area.ownJobs}` : ''}`}
                tone={area.anchorJob.signed ? 'success' : 'brand'}
                size="sm"
                icon="ribbon-outline"
              />
            ) : null}
            {area.storm.strongest || area.mode !== 'neighbours' ? (
              <Pill label={stormLine(area)} tone={area.storm.maxHailInches != null && area.storm.maxHailInches >= 1 ? 'danger' : 'info'} size="sm" icon="thunderstorm-outline" />
            ) : (
              <Pill label="No storm on file" tone="neutral" size="sm" icon="thunderstorm-outline" />
            )}
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
              At least {hr.atLeast} at {Math.round(hr.confidence * 100)}% confidence · {Math.round(hr.pAtLeastTarget * 100)}% chance of {hr.target}+
              {hr.doorsForTarget != null && hr.doorsForTarget !== hr.doors ? ` · ${hr.doorsForTarget} doors for ${hr.target}` : ''}
            </Text>
            {area.calibration && area.calibration.method !== 'table' ? <Text style={styles.calNote}>{area.calibration.note}</Text> : null}
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

          {/* What you did here — set as the day unfolds. */}
          <Text style={styles.groupLabel}>Status</Text>
          <View style={styles.statusRow}>
            {STATUS_ORDER.map((st) => (
              <PressableScale
                key={st}
                style={[styles.statusChip, status === st && styles.statusChipOn]}
                onPress={() => onStatus(st)}
                accessibilityRole="button"
                accessibilityState={{ selected: status === st }}
                accessibilityLabel={`Mark ${AREA_STATUS_LABELS[st]}`}
              >
                <Text style={[styles.statusText, status === st && styles.statusTextOn]}>{AREA_STATUS_LABELS[st]}</Text>
              </PressableScale>
            ))}
          </View>

          {area.zip && isApillowConfigured ? <NearbyHomes zip={area.zip} areaName={name} stormYear={stormYearOf(area.storm)} onRouteHome={onRouteHome} /> : null}

          <View style={styles.actions}>
            <PressableScale style={styles.secondaryBtn} onPress={onMap} accessibilityRole="button" accessibilityLabel="Show on Storm Tracer">
              <Ionicons name="map-outline" size={20} color={colors.navy} />
              <Text style={styles.secondaryBtnText}>Storm Tracer</Text>
            </PressableScale>
            <PressableScale style={styles.secondaryBtn} onPress={onDirections} accessibilityRole="button" accessibilityLabel="Directions to this area">
              <Ionicons name="navigate-outline" size={20} color={colors.navy} />
              <Text style={styles.secondaryBtnText}>Directions</Text>
            </PressableScale>
            <PressableScale style={styles.routeBtn} onPress={onRoute} accessibilityRole="button" accessibilityLabel="Add to my knock route">
              <Ionicons name="walk-outline" size={20} color={colors.textInverse} />
              <Text style={styles.routeBtnText}>Route</Text>
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
 * roof. Costs 5 of the month's 50 free lookups — a button that says so.
 * Every home can become a lead, a job, or the route target in one tap. A
 * home whose roof is at least as new as the storm (a listing that said "new
 * roof", a stated roof year, a build after the storm) is not a claim
 * candidate: it is marked, muted and sorted last.
 */
function NearbyHomes({
  zip,
  areaName,
  stormYear,
  onRouteHome,
}: {
  zip: string;
  areaName: string;
  /** Year of the area's strongest storm day; null when there is none. */
  stormYear: number | null;
  onRouteHome: (h: PropertyRecord, label: string) => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ status: 'idle' } | { status: 'busy' } | { status: 'ok'; homes: PropertyRecord[] } | { status: 'error'; reason: string }>({ status: 'idle' });
  const nowYear = new Date().getFullYear();
  // Roof year per home, and the ones newer than the storm.
  const roofs = useMemo(() => {
    if (state.status !== 'ok') return [];
    return state.homes.map((h) => {
      const roof = roofYearFromRecord(h, nowYear);
      const newSinceStorm = roof != null && stormYear != null && roof.year >= stormYear;
      return { home: h, roof, newSinceStorm };
    });
  }, [state, stormYear, nowYear]);
  const ordered = useMemo(() => [...roofs].sort((a, b) => Number(a.newSinceStorm) - Number(b.newSinceStorm)), [roofs]);
  const newCount = roofs.filter((r) => r.newSinceStorm).length;
  const [leadFor, setLeadFor] = useState<Record<string, string>>({});
  const createLead = useLeadStore((s) => s.create);
  const setLeadRecord = useLeadStore((s) => s.setPropertyRecord);
  const leads = useLeadStore((s) => s.leads);
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const remember = usePropertyRecordStore((s) => s.remember);
  const toast = useToastStore((s) => s.show);

  const run = async () => {
    setState({ status: 'busy' });
    const res = await fetchNearbyHomes({ zip, kind: 'sold', max: 5 });
    if (res.status === 'ok') setState({ status: 'ok', homes: res.homes });
    else setState({ status: 'error', reason: res.reason });
  };

  const fullAddress = (h: PropertyRecord) =>
    [h.streetAddress, h.city, h.state ? `${h.state} ${h.zipcode ?? ''}`.trim() : undefined].filter(Boolean).join(', ');

  const addLead = (h: PropertyRecord) => {
    const address = fullAddress(h);
    if (!address) return;
    const existing = leads.find((l) => l.address.trim().toLowerCase() === address.toLowerCase());
    if (existing) {
      setLeadFor((m) => ({ ...m, [address]: existing.id }));
      toast({ tone: 'info', title: 'Already a lead', body: existing.customerName });
      return;
    }
    const lead = createLead({ customerName: `Homeowner at ${h.streetAddress ?? address}`, address, lat: h.lat, lng: h.lng, stage: 'new', source: 'zillow' });
    setLeadRecord(lead.id, h);
    setLeadFor((m) => ({ ...m, [address]: lead.id }));
    toast({ tone: 'success', title: 'Lead created', body: `${address} · recently sold` });
  };

  const newJob = (h: PropertyRecord) => {
    const address = fullAddress(h);
    if (!address) return;
    // The wizard looks the address up on save — hand it the record now so it
    // costs nothing and the job fronts with the house from the first second.
    remember(address, h);
    setPrefill({ source: 'other', address, addressLat: h.lat, addressLng: h.lng });
    router.push('/new-job');
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
      {newCount > 0 ? (
        <Text style={styles.nearbySub}>
          {newCount} of {roofs.length} {newCount === 1 ? 'has' : 'have'} a new roof since the storm{stormYear ? ` (${stormYear})` : ''} — not claim candidates, listed last.
        </Text>
      ) : null}
      {ordered.map(({ home: h, roof, newSinceStorm }, i) => {
        const address = [h.streetAddress, h.city].filter(Boolean).join(', ');
        const key = fullAddress(h);
        const leadId = leadFor[key];
        return (
          <View key={h.zpid ?? i} style={[styles.homeCard, newSinceStorm && styles.homeCardMuted]}>
            <View style={styles.nearbyRow}>
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
                {roof ? (
                  <Pill
                    label={roof.source === 'year_built' ? `New build · ${roof.year}` : `New roof · ${roof.year}`}
                    tone={newSinceStorm ? 'neutral' : 'info'}
                    size="sm"
                    icon="home-outline"
                  />
                ) : null}
              </View>
            </View>
            <View style={styles.homeActions}>
              <PressableScale style={styles.homeBtn} onPress={() => newJob(h)} accessibilityRole="button" accessibilityLabel={`New job at ${address}`}>
                <Ionicons name="hammer-outline" size={18} color={colors.text} />
                <Text style={styles.homeBtnText}>New job</Text>
              </PressableScale>
              <PressableScale
                style={[styles.homeBtn, leadId ? styles.homeBtnDone : null]}
                onPress={() => (leadId ? router.push(`/lead/${leadId}` as any) : addLead(h))}
                accessibilityRole="button"
                accessibilityLabel={leadId ? `Open the lead for ${address}` : `New lead at ${address}`}
              >
                <Ionicons name={leadId ? 'checkmark' : 'person-add-outline'} size={18} color={leadId ? colors.success : colors.text} />
                <Text style={styles.homeBtnText}>{leadId ? 'Lead' : 'New lead'}</Text>
              </PressableScale>
              <PressableScale style={styles.homeBtn} onPress={() => onRouteHome(h, address || areaName)} accessibilityRole="button" accessibilityLabel={`Route to ${address}`}>
                <Ionicons name="walk-outline" size={18} color={colors.text} />
                <Text style={styles.homeBtnText}>Route</Text>
              </PressableScale>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DayCard({
  day,
  scheduled,
  onStart,
  onDirections,
  onSchedule,
}: {
  day: TripDay;
  /** The day's slot on the calendar, when the roofer has booked one. */
  scheduled?: KnockDaySchedule;
  onStart: () => void;
  onDirections: () => void;
  onSchedule: () => void;
}) {
  return (
    <RichCard
      icon="calendar-outline"
      iconTone="purple"
      title={`Day ${day.day}`}
      subtitle={`${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} · ${Math.round(day.totalMiles)} mi · ${fmtMinutes(day.totalMinutes)} · expect ~${Math.round(day.expected)}, at least ${day.atLeast}`}
      action={{
        label: scheduled ? `${scheduledDayLabel(scheduled.date)} · ${startClockLabel(scheduled.startTime)}` : 'Schedule',
        onPress: onSchedule,
        icon: scheduled ? 'calendar' : 'calendar-outline',
      }}
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
  body: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 21 },
  note: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs },
  narrative: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21, marginBottom: spacing.sm },
  statRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  statValue: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.accent },
  statLabel: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, minHeight: touchTarget.preferred },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  ringValue: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, lineHeight: 22 },
  ringLabel: { fontSize: fontSize.caption, color: colors.textMuted, marginTop: -2 },
  areaMain: { flex: 1, gap: 2 },
  areaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.textSubtle },
  areaTitle: { flexShrink: 1, fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  areaSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  performance: { fontSize: fontSize.bodySm, color: colors.text, fontWeight: fontWeight.semibold },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  areaBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  expectBox: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.accentSoft, gap: 2 },
  expectTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  expectSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  calNote: { fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18, marginTop: spacing.xs },
  housingLine: { fontSize: fontSize.bodySm, color: colors.textMuted },
  rationale: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21 },
  opener: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  openerText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20, fontStyle: 'italic' },
  bullets: { gap: spacing.xs },
  bullet: { flexDirection: 'row', gap: spacing.sm },
  bulletDot: { color: colors.accent, fontSize: fontSize.bodyMd, lineHeight: 20 },
  bulletText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20 },
  groupLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusChip: { minHeight: touchTarget.standard, paddingHorizontal: spacing.md, borderRadius: radii.button, justifyContent: 'center', backgroundColor: colors.fillQuiet },
  statusChipOn: { backgroundColor: colors.navy },
  statusText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  statusTextOn: { color: colors.textInverse },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: spacing.xs, minHeight: touchTarget.standard, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  routeBtn: { flex: 1, flexDirection: 'row', gap: spacing.xs, minHeight: touchTarget.standard, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  routeBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyMd },
  nearbyBtn: { minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  nearbyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  nearbySub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 17 },
  nearbyList: { gap: spacing.sm },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.standard },
  nearbyThumb: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  nearbyAddr: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  homeCard: { gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  homeCardMuted: { opacity: 0.62 },
  homeActions: { flexDirection: 'row', gap: spacing.sm },
  homeBtn: { flex: 1, minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.button, backgroundColor: colors.surface },
  homeBtnDone: { backgroundColor: colors.successSoft },
  homeBtnText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  stops: { gap: 0, marginBottom: spacing.sm },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: touchTarget.standard },
  stopBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  stopMain: { flex: 1, gap: 2 },
  stopTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  stopSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  stopScore: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.accent },
});
