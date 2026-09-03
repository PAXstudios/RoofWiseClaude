// Door knocking — the mini-app. A SalesRabbit-class canvass map:
//
//   • tap any house (or "Pin here" at the phone) → the pin sheet: address,
//     one-tap house lookup, a colour-coded outcome, follow-up, contact, note;
//   • every knock is a coloured pin; a legend strip filters by group; the
//     last 30 days of earlier routes can be shown alongside; a second visit
//     upgrades the pin and keeps the first visit in its history;
//   • a live mileage trip runs with the route (foreground — the native build
//     is what unlocks background tracking), drawn as the walked path, with
//     doors / answered / miles / time pinned above the controls;
//   • multi-stop routes from the knock planner: each stop is a ring, the
//     current one accented, "Next stop" recentres and advances.
//
// Everything is a sheet, nothing is an Alert (Drift #1). Nothing here invents
// a position, a street, or a house (Drift #5): no fix → "waiting", no
// geocoder → "GPS only", no record → the reason.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type MapView from 'react-native-maps';
import {
  Map,
  MapCircle,
  MapPolyline,
  regionForLatLon,
  type MapCoordinate,
  type MapImageryType,
  type Region,
} from '@/components/map/Map';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { Pill } from '@/components/ui/Pill';
import { PressableScale } from '@/components/PressableScale';
import { EndSessionSheet } from '@/components/knock/EndSessionSheet';
import { KnockPinMarker } from '@/components/knock/KnockPinMarker';
import { PinSheet, type PinSheetMode } from '@/components/knock/PinSheet';
import { SessionStatsBar } from '@/components/knock/SessionStatsBar';
import type { SaveKnockResult } from '@/components/knock/saveKnock';
import {
  endRoute,
  liveRouteMiles,
  requestLocationAccess,
  setScreenMounted,
  startRoute,
  startWatching,
  useLiveFix,
  useLocationGate,
} from '@/components/knock/sessionTracker';
import type { Knock, KnockRouteTarget } from '@/lib/models/types';
import {
  OUTCOME_FILTERS,
  knocksSince,
  matchesFilter,
  nextActionFor,
  outcomeLabel,
  sessionStats,
  type OutcomeFilter,
} from '@/lib/services/knockOutcomes';
import { formatMiles } from '@/lib/services/knockTrip';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_WINDOW_MS = 30 * DAY_MS;
/** A region change inside this many ms of our own animateToRegion is ours, not a pan. */
const AUTO_MOVE_GRACE_MS = 1500;
const MILES_TO_METERS = 1609.34;

export default function DoorKnockingScreen() {
  const router = useRouter();
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const archive = useKnockSessionStore((s) => s.archive);
  const knockNear = useKnockSessionStore((s) => s.knockNear);
  const advanceStop = useKnockSessionStore((s) => s.advanceStop);
  const removeKnock = useKnockSessionStore((s) => s.removeKnock);
  // Subscribed so the stats bar re-renders on every accepted fix.
  const tripMiles = useMileageStore((s) => s.active?.miles);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const areaCentroid = useServiceAreaStore((s) =>
    s.areas.find((a) => a.centroidLat != null && a.centroidLng != null),
  );

  const fix = useLiveFix();
  const gate = useLocationGate();

  const mapRef = useRef<MapView>(null);
  const lastAutoMoveAt = useRef(0);
  const deltaRef = useRef(0.008);

  const [mapType, setMapType] = useState<MapImageryType>('standard');
  // A session aimed at a storm core opens on the TARGET (the whole point of
  // "add the area to my route" is to look at where the hail fell before
  // driving there); following the phone is one tap away. Otherwise the map
  // rides along from the first fix.
  const [follow, setFollow] = useState(() => !useKnockSessionStore.getState().activeSession?.routeTarget);
  const [showArchive, setShowArchive] = useState(false);
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [sheetMode, setSheetMode] = useState<PinSheetMode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Knock | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // The tracker outlives this screen while a route runs; it stops on unmount
  // only when no route is active.
  useEffect(() => {
    setScreenMounted(true);
    startWatching().catch(() => {});
    return () => setScreenMounted(false);
  }, []);

  // Route timer — ticks only while a route runs.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!activeSession) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeSession]);

  // Follow mode: the map rides along with the fix at the zoom the roofer set.
  useEffect(() => {
    if (!follow || !fix || !mapRef.current) return;
    lastAutoMoveAt.current = Date.now();
    mapRef.current.animateToRegion(regionForLatLon(fix.lat, fix.lng, deltaRef.current), 400);
  }, [fix, follow]);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      deltaRef.current = region.latitudeDelta;
      // A pan the roofer made (not one we animated) turns follow off.
      if (follow && Date.now() - lastAutoMoveAt.current > AUTO_MOVE_GRACE_MS) setFollow(false);
    },
    [follow],
  );

  const flyTo = useCallback((lat: number, lng: number, delta?: number) => {
    lastAutoMoveAt.current = Date.now();
    mapRef.current?.animateToRegion(regionForLatLon(lat, lng, delta ?? deltaRef.current), 450);
  }, []);

  // ---- data -----------------------------------------------------------

  const stops: KnockRouteTarget[] = useMemo(() => {
    if (activeSession?.routeStops && activeSession.routeStops.length > 0) return activeSession.routeStops;
    return activeSession?.routeTarget ? [activeSession.routeTarget] : [];
  }, [activeSession]);
  const stopIndex = activeSession?.currentStopIndex ?? 0;
  const currentStop = stops[stopIndex] ?? null;
  const hasPlan = (activeSession?.routeStops?.length ?? 0) > 1;

  const activeKnocks = useMemo(
    () => (activeSession?.knocks ?? []).filter((k) => matchesFilter(k.outcome, filter)),
    [activeSession, filter],
  );
  const archivedKnocks = useMemo(() => {
    if (!showArchive) return [];
    return knocksSince(archive, Date.now() - ARCHIVE_WINDOW_MS).filter((k) => matchesFilter(k.outcome, filter));
  }, [archive, showArchive, filter]);

  const stats = useMemo(() => (activeSession ? sessionStats(activeSession, now) : null), [activeSession, now]);
  // `tripMiles` is only read to subscribe; the helper reads the store itself.
  const liveMiles = useMemo(() => liveRouteMiles(activeSession), [activeSession, tripMiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const elapsedMs = activeSession ? now - new Date(activeSession.startedAt).getTime() : 0;
  const track = activeSession?.track ?? [];

  // Frame the target first, then the phone, then the roofer's own service
  // area. No target, no fix, no area → the honest "waiting" state, never a
  // hard-coded city (Drift #5).
  const initialRegion = currentStop
    ? regionForLatLon(currentStop.lat, currentStop.lng, Math.max(0.02, currentStop.radiusMiles / 30))
    : fix
      ? regionForLatLon(fix.lat, fix.lng, 0.008)
      : areaCentroid?.centroidLat != null && areaCentroid.centroidLng != null
        ? regionForLatLon(areaCentroid.centroidLat, areaCentroid.centroidLng, 0.05)
        : undefined;

  // ---- actions --------------------------------------------------------

  const openSheet = (mode: PinSheetMode) => {
    setSheetMode(mode);
    setSheetOpen(true);
    setSelectedId(mode.kind === 'new' ? (mode.nearby?.id ?? null) : mode.knock.id);
  };

  const onStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const result = await startRoute();
      if (!result.ok) {
        toast({
          tone: 'warn',
          title: 'Location is off',
          body: 'Door knocking needs your location to place pins and count miles.',
        });
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setFollow(true);
      toast({ tone: 'success', title: 'Route started', body: 'Tap a house to drop a pin, or use Pin here.' });
    } finally {
      setStarting(false);
    }
  };

  const onEndConfirm = () => {
    const ended = endRoute();
    if (!ended) return;
    const s = sessionStats(ended);
    logActivity({
      kind: 'route_completed',
      message: `Wrapped route — ${s.doors} door${s.doors === 1 ? '' : 's'}, ${s.contacts} answered, ${s.leads} lead${s.leads === 1 ? '' : 's'}, ${formatMiles(s.miles)} mi`,
      payload: { sessionId: ended.id, ...s },
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({
      tone: 'success',
      title: 'Route complete',
      body: `${s.doors} doors · ${s.contactRate}% answered · ${formatMiles(s.miles)} mi · ${s.minutes} min`,
    });
    router.back();
  };

  const dropPin = (lat: number, lng: number, placedBy: 'gps' | 'map_tap') => {
    if (!activeSession) {
      toast({ tone: 'warn', title: 'Start a route first', body: 'Pins are logged against a route.' });
      return;
    }
    const nearby = knockNear(lat, lng);
    Haptics.selectionAsync().catch(() => {});
    openSheet({ kind: 'new', point: { lat, lng, placedBy }, nearby });
  };

  const onMapPress = useCallback(
    (c: MapCoordinate) => dropPin(c.latitude, c.longitude, 'map_tap'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSession, knockNear],
  );

  const onPinHere = () => {
    if (!fix) {
      toast({ tone: 'warn', title: 'Waiting for GPS', body: 'Tap the house on the map instead.' });
      return;
    }
    dropPin(fix.lat, fix.lng, 'gps');
  };

  const onActivePinPress = useCallback((k: Knock) => openSheet({ kind: 'edit', knock: k }), []);
  const onArchivedPinPress = useCallback(
    (k: Knock) => openSheet({ kind: 'archived', knock: k, canKnockAgain: !!activeSession }),
    [activeSession],
  );

  const onSaved = (result: SaveKnockResult) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSelectedId(result.knock.id);
    const label = outcomeLabel(result.knock.outcome);
    if (result.leadCreated && result.gpsOnly) {
      toast({
        tone: 'warn',
        title: `${label} · lead created`,
        body: 'GPS only — add the address and name on the lead.',
      });
      return;
    }
    toast({
      tone: 'success',
      title: result.leadCreated ? `${label} · lead created` : result.leadUpdated ? `${label} · lead updated` : `${label} saved`,
      body: nextActionFor(result.knock.outcome),
    });
  };

  const onNextStop = () => {
    const next = advanceStop();
    if (!next) return;
    setFollow(false);
    flyTo(next.lat, next.lng, Math.max(0.02, next.radiusMiles / 30));
    toast({ tone: 'info', title: `Stop ${(activeSession?.currentStopIndex ?? 0) + 2} of ${stops.length}`, body: next.label });
  };

  const recentreRoute = () => {
    if (!currentStop) return;
    setFollow(false);
    flyTo(currentStop.lat, currentStop.lng, Math.max(0.02, currentStop.radiusMiles / 30));
  };

  const toggleFollow = () => {
    const next = !follow;
    setFollow(next);
    if (next && fix) flyTo(fix.lat, fix.lng);
  };

  const openSettings = () => {
    if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
      Linking.openSettings().catch(() => {});
    }
  };

  const locationDenied = gate === 'denied' || gate === 'denied_forever' || gate === 'unavailable';
  const pinCount = activeKnocks.length + archivedKnocks.length;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Door Knocking</Text>
          <Text style={styles.statsLine} numberOfLines={1}>
            {activeSession
              ? currentStop
                ? `Aimed at ${currentStop.label}`
                : 'Tap a house to drop a pin'
              : 'Start a route, then tap any house'}
          </Text>
        </View>
        {activeSession ? (
          <PressableScale
            style={styles.endBtn}
            onPress={() => setEndOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Wrap the route"
          >
            <Ionicons name="flag-outline" size={18} color={colors.navy} />
            <Text style={styles.endBtnText}>End</Text>
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.mapWrap}>
        {initialRegion ? (
          <Map
            ref={mapRef}
            initialRegion={initialRegion}
            mapType={mapType}
            // The walked path and the stop rings ARE the information here;
            // in Expo Go on iOS the Google tile layer would sit above them.
            googleImagery={false}
            onPress={onMapPress}
            onRegionChangeComplete={onRegionChangeComplete}
            attributionInset={{ bottom: spacing.xxxl + spacing.md }}
          >
            {stops.map((s, i) => {
              const current = i === stopIndex;
              return (
                <MapCircle
                  key={`${s.lat},${s.lng},${i}`}
                  center={{ latitude: s.lat, longitude: s.lng }}
                  radius={s.radiusMiles * MILES_TO_METERS}
                  strokeColor={current ? colors.stormHail : colors.slate}
                  strokeWidth={current ? 2 : 1}
                  fillColor={current ? colors.stormHailFill : colors.fillQuiet}
                />
              );
            })}
            {track.length >= 2 ? (
              <MapPolyline
                coordinates={track.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                strokeColor={colors.brand}
                strokeWidth={4}
              />
            ) : null}
            {archivedKnocks.map((k) => (
              <KnockPinMarker key={`a_${k.id}`} knock={k} muted selected={k.id === selectedId} onPress={onArchivedPinPress} />
            ))}
            {activeKnocks.map((k) => (
              <KnockPinMarker key={k.id} knock={k} selected={k.id === selectedId} onPress={onActivePinPress} />
            ))}
          </Map>
        ) : (
          <View style={styles.waiting}>
            {!locationDenied && <ActivityIndicator color={colors.textMuted} />}
            <Text style={styles.waitingTitle}>{locationDenied ? 'Location is off' : 'Waiting for location'}</Text>
            <Text style={styles.waitingBody}>
              {locationDenied
                ? 'Allow location for RoofWise to see the route map.'
                : 'The map frames your position as soon as the phone has a fix.'}
            </Text>
          </View>
        )}

        {initialRegion ? (
          <>
            {/* Legend / filter strip — 56pt chips (Drift #1). */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.legend}
              contentContainerStyle={styles.legendContent}
              keyboardShouldPersistTaps="handled"
            >
              {OUTCOME_FILTERS.map((f) => {
                const active = filter === f.id;
                return (
                  <PressableScale
                    key={f.id}
                    pressedScale={0.96}
                    style={[styles.legendChip, active && styles.legendChipActive]}
                    onPress={() => setFilter(f.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${f.label}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.legendText, active && styles.legendTextActive]}>{f.label}</Text>
                  </PressableScale>
                );
              })}
              <PressableScale
                pressedScale={0.96}
                style={[styles.legendChip, showArchive && styles.legendChipActive]}
                onPress={() => setShowArchive((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel="Show knocks from the last 30 days"
                accessibilityState={{ selected: showArchive }}
              >
                <Ionicons name="time-outline" size={16} color={showArchive ? colors.textInverse : colors.text} />
                <Text style={[styles.legendText, showArchive && styles.legendTextActive]}>30 days</Text>
              </PressableScale>
            </ScrollView>

            {/* Map controls — 56pt each. */}
            <View style={styles.controls}>
              <MapControl
                icon={follow ? 'navigate' : 'navigate-outline'}
                label={follow ? 'Stop following my location' : 'Follow my location'}
                active={follow}
                onPress={toggleFollow}
              />
              {currentStop ? (
                <MapControl icon="flag-outline" label="Recentre on the route" onPress={recentreRoute} />
              ) : null}
              <MapControl
                icon={mapType === 'satellite' ? 'map-outline' : 'earth-outline'}
                label={mapType === 'satellite' ? 'Switch to the road map' : 'Switch to satellite'}
                onPress={() => setMapType((m) => (m === 'satellite' ? 'standard' : 'satellite'))}
              />
            </View>

            <View style={styles.badgeRow} pointerEvents="none">
              <Pill label={`${pinCount} pin${pinCount === 1 ? '' : 's'}`} tone="neutral" size="sm" icon="location-outline" />
              {!fix && !locationDenied ? (
                <View style={styles.locating}>
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={styles.locatingText}>Locating…</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.dock}>
        {!activeSession ? (
          locationDenied ? (
            <View style={styles.deniedCard}>
              <View style={styles.deniedHead}>
                <Ionicons name="location-outline" size={22} color={colors.danger} />
                <Text style={styles.deniedTitle}>Location is off</Text>
              </View>
              <Text style={styles.deniedBody}>
                Door knocking needs your location to place pins where you stand and to count the miles you
                walk.
              </Text>
              <View style={styles.deniedRow}>
                {gate === 'denied' ? (
                  <PressableScale
                    style={styles.deniedBtn}
                    onPress={() => {
                      requestLocationAccess()
                        .then((g) => {
                          if (g === 'granted') startWatching().catch(() => {});
                        })
                        .catch(() => {});
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Ask for location again"
                  >
                    <Text style={styles.deniedBtnText}>Try again</Text>
                  </PressableScale>
                ) : null}
                {Platform.OS !== 'web' ? (
                  <PressableScale
                    style={[styles.deniedBtn, styles.deniedBtnPrimary]}
                    onPress={openSettings}
                    accessibilityRole="button"
                    accessibilityLabel="Open Settings"
                  >
                    <Text style={[styles.deniedBtnText, styles.deniedBtnPrimaryText]}>Open Settings</Text>
                  </PressableScale>
                ) : null}
              </View>
            </View>
          ) : (
            <PressableScale
              style={[styles.startBtn, starting && styles.btnBusy]}
              onPress={onStart}
              disabled={starting}
              accessibilityRole="button"
              accessibilityLabel="Start route"
            >
              {starting ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <Ionicons name="walk-outline" size={22} color={colors.textInverse} />
                  <Text style={styles.startBtnText}>Start route</Text>
                </>
              )}
            </PressableScale>
          )
        ) : (
          <>
            {stats ? (
              <SessionStatsBar
                stats={stats}
                miles={liveMiles}
                elapsedMs={elapsedMs}
                stop={hasPlan && currentStop ? { index: stopIndex, total: stops.length, label: currentStop.label } : null}
              />
            ) : null}
            {hasPlan ? (
              <PressableScale
                style={[styles.nextStopBtn, stopIndex >= stops.length - 1 && styles.btnBusy]}
                onPress={onNextStop}
                disabled={stopIndex >= stops.length - 1}
                accessibilityRole="button"
                accessibilityLabel="Next stop"
              >
                <Text style={styles.nextStopText}>
                  {stopIndex >= stops.length - 1 ? 'Last stop' : `Next stop → ${stops[stopIndex + 1].label}`}
                </Text>
                <Ionicons name="arrow-forward" size={20} color={colors.brand} />
              </PressableScale>
            ) : null}
            <PressableScale
              style={styles.startBtn}
              onPress={onPinHere}
              accessibilityRole="button"
              accessibilityLabel="Drop a pin at my location"
            >
              <Ionicons name="location" size={22} color={colors.textInverse} />
              <Text style={styles.startBtnText}>Pin here</Text>
            </PressableScale>
          </>
        )}
      </View>

      <PinSheet
        visible={sheetOpen}
        mode={sheetMode}
        onClose={() => setSheetOpen(false)}
        onSaved={onSaved}
        onRemove={(k) => setPendingRemove(k)}
        onOpenLead={(id) => router.push(`/lead/${id}` as any)}
      />
      <EndSessionSheet
        visible={endOpen}
        session={activeSession}
        miles={liveMiles}
        onKeepGoing={() => setEndOpen(false)}
        onConfirm={onEndConfirm}
      />
      <ConfirmSheet
        visible={pendingRemove != null}
        title="Remove this pin?"
        body={
          pendingRemove?.createdLeadId
            ? 'The knock leaves this route. The lead it created stays in your pipeline.'
            : 'The knock leaves this route. This cannot be undone.'
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingRemove) {
            removeKnock(pendingRemove.id);
            setSelectedId(null);
            toast({ tone: 'info', title: 'Pin removed' });
          }
        }}
        onClose={() => setPendingRemove(null)}
      />
    </SafeAreaView>
  );
}

function MapControl({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.control, active && styles.controlActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={24} color={active ? colors.textInverse : colors.navy} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Glove-sized back target (Drift #1).
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  statsLine: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  endBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },

  mapWrap: {
    flex: 1,
    marginHorizontal: spacing.xl,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    ...shadows.card,
  },
  legend: { position: 'absolute', top: spacing.sm, left: 0, right: 0, flexGrow: 0 },
  legendContent: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.barFill,
    ...shadows.float,
  },
  legendChipActive: { backgroundColor: colors.text },
  legendText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  legendTextActive: { color: colors.textInverse },
  controls: {
    position: 'absolute',
    right: spacing.sm,
    top: touchTarget.standard + spacing.sm * 3,
    gap: spacing.sm,
  },
  control: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.barFill,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },
  controlActive: { backgroundColor: colors.brand },
  badgeRow: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  locating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  locatingText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  // Honest no-fix state in the map's own frame (Drift #5: never a stand-in city).
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
  },
  waitingTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.text },
  waitingBody: { fontSize: fontSize.bodyMd, color: colors.textMuted, textAlign: 'center' },

  dock: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  startBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  startBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },
  btnBusy: { opacity: 0.6 },
  nextStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.brandSoft,
  },
  nextStopText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.brand },

  deniedCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
  },
  deniedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deniedTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.text },
  deniedBody: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
  deniedRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  deniedBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedBtnPrimary: { backgroundColor: colors.brand },
  deniedBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  deniedBtnPrimaryText: { color: colors.textInverse },
});
