// Door knocking — the mini-app. A SalesRabbit-class canvass map on the shared
// map control system (components/map/controls):
//
//   • tap any house (or "Pin here" at the phone) → the pin sheet: address,
//     one-tap house lookup, a colour-coded outcome, follow-up, contact, note;
//   • every knock is a coloured pin; the Layers & filters sheet (rail button
//     or the top-left summary chip) filters by group and shows the last 30
//     days of earlier routes alongside; a second visit upgrades the pin and
//     keeps the first visit in its history;
//   • a live mileage trip runs with the route (foreground — the native build
//     is what unlocks background tracking), drawn as the walked path, with
//     doors / answered / miles / time in the drawer's header;
//   • the drawer lists every pin on this route (tap → its sheet) — the list
//     SalesRabbit users expect — and, raised, the earlier routes' pins;
//   • multi-stop routes from the knock planner: each stop is a ring, the
//     current one accented, "Next" in the drawer header recentres and
//     advances; the rail's flag recentres on the stop.
//   • ONE primary CTA in the thumb zone at every detent: Start route → Pin
//     here. Wrapping the route is a quiet button in the drawer header.
//
// Everything is a sheet, nothing is an Alert (Drift #1). Nothing here invents
// a position, a street, or a house (Drift #5): no fix → "waiting", no
// geocoder → "GPS only", no record → the reason.

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  type Region,
} from '@/components/map/Map';
import {
  ControlRail,
  LayersSheet,
  LegendStrip,
  MapDrawer,
  SummaryChip,
  useMapPanTuck,
  type LayersSection,
  type LegendItem,
  type RailItem,
} from '@/components/map/controls';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { Pill } from '@/components/ui/Pill';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PressableScale } from '@/components/PressableScale';
import { DoNotKnockLayer } from '@/components/knock/DoNotKnockLayer';
import { EndSessionSheet } from '@/components/knock/EndSessionSheet';
import { KnockPinMarker } from '@/components/knock/KnockPinMarker';
import { syncKnocksSoon } from '@/lib/services/knockSync';
import { outcomeColor, outcomeIcon } from '@/components/knock/outcomeStyle';
import { PinSheet, type PinSheetMode } from '@/components/knock/PinSheet';
import { SessionStatsBar } from '@/components/knock/SessionStatsBar';
import type { SaveKnockResult } from '@/components/knock/saveKnock';
import {
  endRoute,
  liveRouteMiles,
  setScreenMounted,
  startRoute,
  startWatching,
  useLiveFix,
  useLocationGate,
} from '@/components/knock/sessionTracker';
import type { Knock, KnockRouteTarget } from '@/lib/models/types';
import {
  KNOCK_OUTCOMES,
  OUTCOME_FILTERS,
  knocksSince,
  matchesFilter,
  nextActionFor,
  outcomeLabel,
  sessionStats,
  type OutcomeFilter,
} from '@/lib/services/knockOutcomes';
import { formatMiles, isFreshKnockFix } from '@/lib/services/knockTrip';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useMapChrome } from '@/lib/stores/mapChromeStore';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { MeshBackground } from '@/components/ui/MeshBackground';
import { colors, fontFamily, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_WINDOW_MS = 30 * DAY_MS;
const MILES_TO_METERS = 1609.34;

/** Every outcome in its pin colour — the key the rail's legend button shows. */
const KNOCK_LEGEND: LegendItem[] = KNOCK_OUTCOMES.map((m) => ({
  label: m.short,
  color: outcomeColor(m.id),
  icon: outcomeIcon(m.id),
}));

export default function DoorKnockingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const deltaRef = useRef(0.008);

  // Chrome memory: rail tucked, drawer detent, satellite — per screen.
  const chrome = useMapChrome('knock');
  const panTuck = useMapPanTuck(chrome.tucked, chrome.setTucked);

  // A session aimed at a storm core opens on the TARGET (the whole point of
  // "add the area to my route" is to look at where the hail fell before
  // driving there); following the phone is one hold away. Otherwise the map
  // rides along from the first fix.
  const [follow, setFollow] = useState(() => !useKnockSessionStore.getState().activeSession?.routeTarget);
  const [showArchive, setShowArchive] = useState(false);
  const [filter, setFilter] = useState<OutcomeFilter>('all');
  const [legendOpen, setLegendOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<PinSheetMode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Knock | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mapHeight, setMapHeight] = useState(0);
  const [drawerHeight, setDrawerHeight] = useState(0);

  // The tracker outlives this screen while a route runs; it stops on unmount
  // only when no route is active.
  useEffect(() => {
    setScreenMounted(true);
    startWatching().catch(() => {});
    return () => setScreenMounted(false);
  }, []);

  // Route timer — ticks only while a route runs.
  const [now, setNow] = useState(Date.now());
  const fixFresh = gate === 'granted' && isFreshKnockFix(fix);
  useEffect(() => {
    if (!activeSession) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeSession]);

  // Follow mode: the map rides along with the fix at the zoom the roofer set.
  useEffect(() => {
    if (!follow || !fix || !mapRef.current) return;
    panTuck.markAutoMove();
    mapRef.current.animateToRegion(regionForLatLon(fix.lat, fix.lng, deltaRef.current), 400);
  }, [fix, follow, panTuck]);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      deltaRef.current = region.latitudeDelta;
      // A pan the roofer made (not one we animated) turns follow off and
      // tucks the rail out of the way.
      if (!panTuck.isAutoMove()) {
        if (follow) setFollow(false);
        panTuck.onUserRegionSettled();
      }
    },
    [follow, panTuck],
  );

  const markAutoMove = panTuck.markAutoMove;
  const flyTo = useCallback(
    (lat: number, lng: number, delta?: number) => {
      markAutoMove();
      mapRef.current?.animateToRegion(regionForLatLon(lat, lng, delta ?? deltaRef.current), 450);
    },
    [markAutoMove],
  );

  // ---- data -----------------------------------------------------------

  const stops: KnockRouteTarget[] = useMemo(() => {
    if (activeSession?.routeStops && activeSession.routeStops.length > 0) return activeSession.routeStops;
    return activeSession?.routeTarget ? [activeSession.routeTarget] : [];
  }, [activeSession]);
  const stopIndex = activeSession?.currentStopIndex ?? 0;
  const currentStop = stops[stopIndex] ?? null;
  const hasPlan = (activeSession?.routeStops?.length ?? 0) > 1;

  // Route additions also work while this screen is already mounted beneath
  // a plan page. initialRegion alone only positions a newly mounted map.
  useEffect(() => {
    if (!currentStop) return;
    setFollow(false);
    flyTo(currentStop.lat, currentStop.lng, Math.max(0.02, currentStop.radiusMiles / 30));
  }, [currentStop, flyTo]);

  const activeKnocks = useMemo(
    () => (activeSession?.knocks ?? []).filter((k) => matchesFilter(k.outcome, filter)),
    [activeSession, filter],
  );
  const archivedKnocks = useMemo(() => {
    if (!showArchive) return [];
    return knocksSince(archive, Date.now() - ARCHIVE_WINDOW_MS).filter((k) => matchesFilter(k.outcome, filter));
  }, [archive, showArchive, filter]);
  // The drawer's list: newest first, so the door just knocked is at the top.
  const listedKnocks = useMemo(
    () => [...activeKnocks].sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt)),
    [activeKnocks],
  );

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
    // A finished route is worth backing up now, not at the next 5-minute tick.
    syncKnocksSoon('route_end');
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
    // Recheck at the tap: a label rendered before suspension is not evidence
    // that this retained fix still describes the roofer's current door.
    if (gate !== 'granted' || !fix || !isFreshKnockFix(fix)) {
      toast({ tone: 'warn', title: 'Waiting for fresh GPS', body: 'Tap the house on the map, or wait for a current location fix.' });
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
    if (result.bookingSkipped) {
      toast({
        tone: 'warn',
        title: 'Knock saved · appointment not changed',
        body: 'This customer’s inspection has already started or finished. Open the lead to arrange another inspection.',
      });
      return;
    }
    if (result.blockedBy) {
      // Saved anyway — the roofer decides — but said out loud.
      toast({
        tone: 'warn',
        title: `${label} saved · on your do-not-knock list`,
        body: `${result.blockedBy.label}${result.blockedBy.kind === 'zone' ? ' (zone)' : ''}. Skip this door next time unless they asked you back.`,
      });
      return;
    }
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setFollow(next);
    if (next && fix) flyTo(fix.lat, fix.lng);
  };

  const goToMyLocation = () => {
    if (!fix) {
      toast({ tone: 'warn', title: 'Waiting for GPS', body: 'The map frames your position as soon as the phone has a fix.' });
      return;
    }
    flyTo(fix.lat, fix.lng);
  };

  const openSettings = () => {
    if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
      Linking.openSettings().catch(() => toast({ tone: 'warn', title: 'Could not open Settings', body: 'Open your device Settings, allow location for RoofWise, then tap Retry location.' }));
    }
  };

  const retryLocation = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const ok = await startWatching();
      toast(ok
        ? { tone: 'success', title: 'Location restored', body: 'Your route and pins are kept. Mileage resumes from the next GPS fix.' }
        : { tone: 'warn', title: 'Location still unavailable', body: 'Check location access and device location services, then retry. Your route is kept.' });
    } finally {
      setStarting(false);
    }
  };

  const locationDenied = gate === 'denied' || gate === 'denied_forever' || gate === 'unavailable';
  const pinCount = activeKnocks.length + archivedKnocks.length;
  const lastStop = hasPlan && stopIndex >= stops.length - 1;

  // ---- chrome: summary, rail, sheet ------------------------------------

  const filterLabel = OUTCOME_FILTERS.find((f) => f.id === filter)?.label ?? 'All';
  const summary =
    `${filter === 'all' ? 'All pins' : filterLabel}` +
    (showArchive ? ' · 30 days' : '') +
    (follow ? ' · Following' : '');
  const activeFilterCount = (filter !== 'all' ? 1 : 0) + (showArchive ? 1 : 0) + (chrome.satellite ? 1 : 0);

  const rail: RailItem[] = [
    {
      key: 'locate',
      icon: follow ? 'navigate' : 'locate',
      label: 'Go to my location',
      longPressHint: follow ? 'Hold to stop following your location' : 'Hold to follow your location',
      onPress: goToMyLocation,
      onLongPress: toggleFollow,
      active: follow,
    },
  ];
  if (currentStop) {
    rail.push({ key: 'route', icon: 'flag-outline', label: 'Recentre on the route', onPress: recentreRoute });
  }
  rail.push(
    {
      key: 'layers',
      icon: 'layers-outline',
      label: 'Layers and filters',
      badge: activeFilterCount,
      onPress: () => setLayersOpen(true),
    },
    {
      key: 'legend',
      icon: 'information-circle-outline',
      label: legendOpen ? 'Hide the legend' : 'Show the legend',
      active: legendOpen,
      onPress: () => setLegendOpen((v) => !v),
    },
    {
      key: 'satellite',
      icon: chrome.satellite ? 'map-outline' : 'earth-outline',
      label: chrome.satellite ? 'Switch to the road map' : 'Switch to satellite',
      active: chrome.satellite,
      onPress: () => chrome.setSatellite(!chrome.satellite),
    },
  );

  const sections: LayersSection[] = [
    {
      key: 'pins',
      title: 'Pins',
      rows: [
        {
          kind: 'choice',
          key: 'filter',
          options: OUTCOME_FILTERS.map((f) => ({ id: f.id, label: f.label, a11yLabel: `Show ${f.label}` })),
          value: filter,
          onChange: (id) => setFilter(id as OutcomeFilter),
        },
      ],
    },
    {
      key: 'history',
      title: 'History',
      rows: [
        {
          kind: 'toggle',
          key: 'archive',
          label: 'Earlier routes',
          hint: 'Knocks from the last 30 days, muted',
          icon: 'time-outline',
          value: showArchive,
          onChange: setShowArchive,
          a11yOn: 'Show knocks from the last 30 days',
          a11yOff: 'Hide knocks from the last 30 days',
        },
      ],
    },
    {
      key: 'map',
      title: 'Map',
      rows: [
        {
          kind: 'toggle',
          key: 'follow',
          label: 'Follow my location',
          hint: 'The map rides along with you',
          icon: 'navigate-outline',
          value: follow,
          onChange: () => toggleFollow(),
          a11yOn: 'Follow my location',
          a11yOff: 'Stop following my location',
        },
        {
          kind: 'toggle',
          key: 'satellite',
          label: 'Satellite imagery',
          hint: 'Aerial photos — see the roofs',
          icon: 'earth-outline',
          value: chrome.satellite,
          onChange: chrome.setSatellite,
          a11yOn: 'Switch to satellite',
          a11yOff: 'Switch to the road map',
        },
        {
          kind: 'toggle',
          key: 'legend',
          label: 'Legend',
          hint: 'Every pin colour',
          icon: 'information-circle-outline',
          value: legendOpen,
          onChange: setLegendOpen,
          a11yOn: 'Show the legend',
          a11yOff: 'Hide the legend',
        },
      ],
    },
    {
      key: 'zones',
      title: 'Zones',
      rows: [
        {
          // INTEGRATION: the do-not-knock wave owns the /do-not-knock screen.
          kind: 'link',
          key: 'do-not-knock',
          label: 'Do-not-knock zones',
          hint: 'Homes and areas kept off every route',
          icon: 'ban-outline',
          onPress: () => {
            setLayersOpen(false);
            router.push('/do-not-knock');
          },
        },
      ],
    },
  ];

  const metaLine =
    `${pinCount} pin${pinCount === 1 ? '' : 's'}` +
    (archivedKnocks.length > 0 ? ` · ${archivedKnocks.length} earlier` : '') +
    (currentStop && !hasPlan ? ` · Aimed at ${currentStop.label}` : '');

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
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
      </View>

      <View style={styles.mapWrap} onLayout={(e) => setMapHeight(Math.round(e.nativeEvent.layout.height))}>
        {initialRegion ? (
          <View
            style={StyleSheet.absoluteFill}
            onTouchStart={panTuck.onTouchStart}
            onTouchMove={panTuck.onTouchMove}
            onTouchEnd={panTuck.onTouchEnd}
            onTouchCancel={panTuck.onTouchEnd}
          >
            <Map
              ref={mapRef}
              initialRegion={initialRegion}
              mapType={chrome.satellite ? 'satellite' : 'standard'}
              // The walked path and the stop rings ARE the information here;
              // in Expo Go on iOS the Google tile layer would sit above them.
              googleImagery={false}
              onPress={onMapPress}
              onRegionChangeComplete={onRegionChangeComplete}
              attributionInset={{ bottom: drawerHeight + spacing.sm }}
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
              {/* Do-not-knock zones and homes, under the pins so the outcome
                  discs stay on top. */}
              <DoNotKnockLayer />
              {archivedKnocks.map((k) => (
                <KnockPinMarker key={`a_${k.id}`} knock={k} muted selected={k.id === selectedId} onPress={onArchivedPinPress} />
              ))}
              {activeKnocks.map((k) => (
                <KnockPinMarker key={k.id} knock={k} selected={k.id === selectedId} onPress={onActivePinPress} />
              ))}
            </Map>
          </View>
        ) : (
          <View style={styles.waiting}>
            {/* The 1A "dark map ground" for the knock-map family
                (docs/DESIGN_1A.md §2/§6) — desaturated, no orange stop, so
                the honest "waiting" state reads as part of the map system
                rather than a blank grey box (Drift #5: never a stand-in city). */}
            <MeshBackground variant="map" style={StyleSheet.absoluteFill} />
            {!locationDenied && <ActivityIndicator color={colors.onMesh} />}
            <Text style={styles.waitingTitle}>{locationDenied ? 'Location is off' : 'Waiting for location'}</Text>
            <Text style={styles.waitingBody}>
              {locationDenied
                ? 'Allow location for RoofWise to see the route map.'
                : 'The map frames your position as soon as the phone has a fix.'}
            </Text>
          </View>
        )}

        {initialRegion ? (
          <View style={styles.overlayTop} pointerEvents="box-none">
            <View style={styles.overlayLeft} pointerEvents="box-none">
              <SummaryChip
                icon="color-filter-outline"
                text={summary}
                onPress={() => setLayersOpen(true)}
                testID="knock-summary"
              />
              {!fix && !locationDenied ? (
                <View style={styles.locating} pointerEvents="none">
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={styles.locatingText}>Locating…</Text>
                </View>
              ) : null}
              {legendOpen ? <LegendStrip title="Knock pins" items={KNOCK_LEGEND} testID="knock-legend" /> : null}
            </View>
            <ControlRail
              items={rail}
              tucked={chrome.tucked}
              onTuckedChange={chrome.setTucked}
              hidden={chrome.detent !== 'peek'}
              testID="knock-rail"
            />
          </View>
        ) : null}

        <MapDrawer
          detent={chrome.detent}
          onDetentChange={chrome.setDetent}
          containerHeight={mapHeight}
          bottomInset={insets.bottom}
          onHeightChange={setDrawerHeight}
          accessibilityLabel="Route panel"
          testID="knock-drawer"
          header={
            <View style={styles.drawerHead}>
              {activeSession && stats ? (
                <SessionStatsBar
                  stats={stats}
                  miles={liveMiles}
                  elapsedMs={elapsedMs}
                  stop={hasPlan && currentStop ? { index: stopIndex, total: stops.length, label: currentStop.label } : null}
                />
              ) : (
                <Text style={styles.headHint}>
                  {locationDenied ? 'Location is off' : 'Start a route, then tap any house'}
                </Text>
              )}
              {activeSession ? (
                <View style={styles.headRow}>
                  <Text style={styles.headMeta} numberOfLines={1} testID="knock-meta">
                    {metaLine}
                  </Text>
                  {hasPlan ? (
                    <PressableScale
                      style={[styles.headBtn, styles.headBtnNext, lastStop && styles.btnBusy]}
                      onPress={onNextStop}
                      disabled={lastStop}
                      accessibilityRole="button"
                      accessibilityLabel="Next stop"
                      accessibilityHint={lastStop ? 'This is the last stop' : `Recentres on ${stops[stopIndex + 1]?.label ?? 'the next stop'}`}
                    >
                      <Text style={styles.headBtnNextText}>{lastStop ? 'Last stop' : 'Next'}</Text>
                      <Ionicons name="arrow-forward" size={18} color={colors.brand} />
                    </PressableScale>
                  ) : null}
                  <PressableScale
                    style={styles.headBtn}
                    onPress={() => setEndOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Wrap the route"
                  >
                    <Ionicons name="flag-outline" size={18} color={colors.navy} />
                    <Text style={styles.headBtnText}>Wrap</Text>
                  </PressableScale>
                </View>
              ) : null}
            </View>
          }
          footer={
            locationDenied ? (
                <View style={styles.deniedCard}>
                  <View style={styles.deniedHead}>
                    <Ionicons name="location-outline" size={22} color={colors.danger} />
                    <Text style={styles.deniedTitle}>Location is off</Text>
                  </View>
                  <Text style={styles.deniedBody}>
                    {activeSession ? 'Your route and pins are kept. ' : ''}
                    GPS pins and mileage need location. {activeSession && initialRegion ? 'You can still tap a house on the map to log a manual pin.' : 'Choose a storm or saved area on Map to plan a route without GPS.'}
                  </Text>
                  {Platform.OS === 'web' ? (
                    <Text style={styles.deniedBody}>Allow location in this browser’s site settings, then retry.</Text>
                  ) : null}
                  <View style={styles.deniedRow}>
                      <PressableScale
                        style={styles.deniedBtn}
                        onPress={() => void retryLocation()}
                        disabled={starting}
                        accessibilityRole="button"
                        accessibilityLabel="Retry location"
                        accessibilityState={{ disabled: starting, busy: starting }}
                      >
                        <Text style={styles.deniedBtnText}>{starting ? 'Retrying…' : 'Retry location'}</Text>
                      </PressableScale>
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
                  <PressableScale
                    style={[styles.deniedBtn, styles.deniedManualBtn]}
                    onPress={activeSession && initialRegion ? () => {
                      chrome.setDetent('peek');
                      recentreRoute();
                      toast({ tone: 'info', title: 'Tap the house on the map', body: 'Manual pins keep the point you choose. GPS mileage is unavailable until location returns.' });
                    } : () => router.push('/(tabs)/map')}
                    accessibilityRole="button"
                    accessibilityLabel={activeSession && initialRegion ? 'Continue with map taps' : 'Choose a route area on Map'}
                  >
                    <Text style={styles.deniedBtnText}>{activeSession && initialRegion ? 'Continue with map taps' : 'Choose an area on Map'}</Text>
                  </PressableScale>
                </View>
            ) : !activeSession ? (
                <PressableScale
                  style={[styles.cta, starting && styles.btnBusy]}
                  onPress={onStart}
                  disabled={starting}
                  accessibilityRole="button"
                  accessibilityLabel="Start route"
                >
                  {starting ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <>
                      <Ionicons name="walk-outline" size={24} color={colors.textInverse} />
                      <Text style={styles.ctaText}>Start route</Text>
                    </>
                  )}
                </PressableScale>
            ) : (
              <View>
              {!fixFresh ? <Text style={styles.emptyText}>Waiting for a current GPS fix. You can still tap a house on the map.</Text> : null}
              <PressableScale
                style={styles.cta}
                onPress={onPinHere}
                accessibilityRole="button"
                accessibilityLabel={fixFresh ? 'Drop a pin at my location' : 'Waiting for fresh GPS; tap a house on the map'}
              >
                <Ionicons name="location" size={24} color={colors.textInverse} />
                <Text style={styles.ctaText}>{fixFresh ? 'Pin here' : 'Waiting for fresh GPS'}</Text>
              </PressableScale>
              </View>
            )
          }
        >
          {activeSession ? (
            <>
              <SectionHeader title={`This route · ${listedKnocks.length}`} />
              {listedKnocks.length === 0 ? (
                <Text style={styles.emptyText}>
                  {filter === 'all'
                    ? 'No pins yet — tap a house on the map, or Pin here.'
                    : `No ${filterLabel.toLowerCase()} pins on this route yet.`}
                </Text>
              ) : (
                <View style={styles.pinList}>
                  {listedKnocks.map((k, i) => (
                    <PinRow key={k.id} knock={k} first={i === 0} selected={k.id === selectedId} onPress={onActivePinPress} />
                  ))}
                </View>
              )}
              {showArchive ? (
                <>
                  <SectionHeader title={`Earlier routes · ${archivedKnocks.length}`} style={styles.archiveHead} />
                  {archivedKnocks.length === 0 ? (
                    <Text style={styles.emptyText}>Nothing knocked here in the last 30 days.</Text>
                  ) : (
                    <View style={styles.pinList}>
                      {archivedKnocks.map((k, i) => (
                        <PinRow key={`a_${k.id}`} knock={k} first={i === 0} muted selected={k.id === selectedId} onPress={onArchivedPinPress} />
                      ))}
                    </View>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.emptyText}>
              Pins are logged against a route. Start one, then every house you tap gets a colour-coded pin and
              the miles count as you walk.
            </Text>
          )}
        </MapDrawer>
      </View>

      <LayersSheet
        visible={layersOpen}
        onClose={() => setLayersOpen(false)}
        subtitle={summary}
        sections={sections}
        onReset={() => {
          setFilter('all');
          setShowArchive(false);
        }}
      />

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

/**
 * One knock in the drawer's list — the same disc as the map pin, the
 * outcome, where/when, and the follow-up if one is set. Tap → the pin's
 * sheet, exactly as tapping the pin would.
 */
function PinRow({
  knock,
  first,
  muted = false,
  selected = false,
  onPress,
}: {
  knock: Knock;
  first: boolean;
  muted?: boolean;
  selected?: boolean;
  onPress: (knock: Knock) => void;
}) {
  const color = outcomeColor(knock.outcome);
  const when = new Date(knock.updatedAt ?? knock.createdAt);
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const where = knock.address ?? (knock.placedBy === 'gps' ? 'Pinned at your location' : 'Pinned on the map');
  const sub = muted ? `${where} · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : `${where} · ${time}`;
  return (
    <Pressable
      style={({ pressed }) => [styles.pinRow, !first && styles.pinRowDivider, pressed && styles.rowPressed]}
      onPress={() => onPress(knock)}
      accessibilityRole="button"
      accessibilityLabel={`${outcomeLabel(knock.outcome)}${knock.address ? `, ${knock.address}` : ''}. Opens the pin.`}
      accessibilityState={{ selected }}
      testID="knock-pin-row"
    >
      <View style={[styles.pinDisc, { backgroundColor: color }, muted && styles.pinDiscMuted]}>
        <Ionicons name={outcomeIcon(knock.outcome)} size={14} color={colors.textInverse} />
      </View>
      <View style={styles.pinText}>
        <Text style={[styles.pinTitle, muted && styles.pinTitleMuted]} numberOfLines={1}>
          {outcomeLabel(knock.outcome)}
          {knock.contactName ? ` · ${knock.contactName}` : ''}
        </Text>
        <Text style={styles.pinSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {knock.followUpAt ? (
        <Pill
          label={new Date(knock.followUpAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          tone="warn"
          size="sm"
          icon="alarm-outline"
        />
      ) : knock.createdLeadId ? (
        <Pill label="Lead" tone="success" size="sm" />
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </Pressable>
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
  title: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  statsLine: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  // Full-bleed map under a hairline — the route IS the screen.
  mapWrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },

  overlayTop: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  overlayLeft: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },
  locating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  locatingText: { color: colors.textInverse, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  // Honest no-fix state in the map's own frame (Drift #5: never a stand-in
  // city) — over the 1A dark map mesh, so it reads as the map system loading
  // rather than an error.
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xxl,
    paddingBottom: touchTarget.sticky * 2,
  },
  waitingTitle: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.onMesh },
  waitingBody: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.onMesh, opacity: 0.78, textAlign: 'center' },

  // Drawer header: stats, then the meta line with Next / Wrap (56pt each).
  drawerHead: { gap: spacing.sm },
  headHint: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, paddingVertical: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headMeta: { flex: 1, fontFamily: fontFamily.mono, fontSize: fontSize.bodySm, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  headBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  headBtnText: { color: colors.navy, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, fontSize: fontSize.bodySm },
  headBtnNext: { backgroundColor: colors.brandSoft },
  headBtnNextText: { color: colors.brand, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, fontSize: fontSize.bodySm },

  // The one primary CTA — 88pt, burnt, in the thumb zone at every detent.
  // Full-pill radius: the same floating-pill family as the tab bar and every
  // other 1A primary action (docs/DESIGN_1A.md §4).
  cta: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  ctaText: { color: colors.textInverse, fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },
  btnBusy: { opacity: 0.6 },

  // The pins list.
  pinList: { borderRadius: radii.card, backgroundColor: colors.fillQuiet, overflow: 'hidden' },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pinRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowPressed: { opacity: 0.7 },
  pinDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  pinDiscMuted: { opacity: 0.75 },
  pinText: { flex: 1, gap: 1 },
  pinTitle: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  pinTitleMuted: { color: colors.textMuted },
  pinSub: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },
  archiveHead: { marginTop: spacing.sm },
  emptyText: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 19, paddingVertical: spacing.xs },

  deniedCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
  },
  deniedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deniedTitle: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.text },
  deniedBody: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
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
  deniedManualBtn: { flex: 0 },
  deniedBtnText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  deniedBtnPrimaryText: { color: colors.textInverse },
});
