// Do not knock — the homes and zones the roofer never canvasses.
//
// Three ways in: one home by address (or "Use my location", or a pasted
// coordinate pair), a zone drawn on the map by tapping its corners (fewer
// than three corners → a centre + radius), and a pasted HOA / city
// no-solicit list geocoded three at a time with an honest "12 of 30 placed ·
// 2 not found" line and the misses listed so they can be fixed by hand.
// Every entry is read by the knock planner (zones drop or discount an area),
// Knock mode (a pin on a listed door warns) and the map layer. Removal sits
// behind a confirm sheet (Drift #1).

import { useEffect, useMemo, useRef, useState, type ElementRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { Map, MapCircle, MapPin, MapPolygon, regionForLatLon } from '@/components/map/Map';
import { useDoNotKnockStore, type DoNotKnockInput } from '@/lib/stores/doNotKnockStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { parseAddressList, parseLatLng } from '@/lib/services/doNotKnock';
import { geocodeText } from '@/lib/services/geocoding';
import { getPlaceDetails, type PlacePrediction } from '@/lib/services/places';
import { describeGoogleApiError } from '@/lib/services/googleApi';
import { getBiasCoordinate } from '@/lib/services/locationBias';
import type { DoNotKnockEntry, DoNotKnockSource } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Mode = 'home' | 'zone' | 'list';
type Point = { lat: number; lng: number };

const SOURCE_LABEL: Record<DoNotKnockSource, string> = {
  roofer: 'Added by you',
  outcome: 'From a knock',
  hoa_list: 'From a pasted list',
};

/** Radius chips for a zone entered as a centre. */
const ZONE_RADII: { label: string; meters: number }[] = [
  { label: '100 m', meters: 100 },
  { label: '250 m', meters: 250 },
  { label: '500 m', meters: 500 },
  { label: '1 km', meters: 1000 },
];
const DEFAULT_ZONE_RADIUS_METERS = 250;
/** Geocoder concurrency for a pasted list — polite to the quota, still quick. */
const GEOCODE_CONCURRENCY = 3;
/** Map viewport around a point when drawing a zone (degrees). */
const ZONE_MAP_DELTA = 0.02;
/** Continental-US viewport when nothing better is known. */
const US_CENTER = { lat: 39.5, lng: -98.35 };
const US_DELTA = 40;

const COORD_HINT = 'or paste coordinates like "33.15, -96.82"';

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/** A typed address → a point. Coordinates skip the geocoder; null = Google found nothing. */
async function placeText(text: string): Promise<{ lat: number; lng: number; address: string } | null> {
  const t = text.trim();
  const pair = parseLatLng(t);
  if (pair) return { ...pair, address: t };
  const g = await geocodeText(t);
  if (!g) return null;
  return { lat: g.lat, lng: g.lng, address: g.formattedAddress || t };
}

function errorCopy(e: unknown, fallback: string): string {
  return describeGoogleApiError(e) ?? (e instanceof Error && e.message ? e.message.slice(0, 160) : fallback);
}

/** The short name for a list row: the street part of an address, or the whole coordinate pair. */
function labelFor(address: string): string {
  if (parseLatLng(address)) return address.trim();
  return address.split(',')[0]?.trim() || address;
}

function radiusLabel(meters: number): string {
  return meters >= 1000 ? `${Math.round(meters / 100) / 10} km` : `${Math.round(meters)} m`;
}

function kindLine(e: DoNotKnockEntry): string {
  if (e.kind === 'home') return 'Home';
  if (e.polygon && e.polygon.length >= 3) return `Zone · ${e.polygon.length} corners`;
  if (e.radiusMeters) return `Zone · ${radiusLabel(e.radiusMeters)} around the centre`;
  return 'Zone';
}

export default function DoNotKnockScreen() {
  const router = useRouter();
  const entries = useDoNotKnockStore((s) => s.entries);
  const remove = useDoNotKnockStore((s) => s.remove);
  const toast = useToastStore((s) => s.show);
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirm, setConfirm] = useState<DoNotKnockEntry | null>(null);
  // A not-found line from a pasted list, handed to the Add-a-home field.
  const [homePrefill, setHomePrefill] = useState('');

  const homes = entries.filter((e) => e.kind === 'home').length;
  const zones = entries.length - homes;
  const subtitle =
    entries.length === 0
      ? 'Homes and zones you never canvass'
      : `${homes} home${homes === 1 ? '' : 's'} · ${zones} zone${zones === 1 ? '' : 's'}`;

  const toggle = (m: Mode) => setMode((cur) => (cur === m ? null : m));

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Do not knock" subtitle={subtitle} back={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.modeRow}>
          <ModeButton icon="home-outline" label="Add a home" on={mode === 'home'} onPress={() => toggle('home')} />
          <ModeButton icon="shapes-outline" label="Add a zone" on={mode === 'zone'} onPress={() => toggle('zone')} />
          <ModeButton icon="clipboard-outline" label="Paste a list" on={mode === 'list'} onPress={() => toggle('list')} />
        </View>

        {mode === 'home' ? (
          <AddHomePanel
            prefill={homePrefill}
            onAdded={() => {
              setHomePrefill('');
              setMode(null);
            }}
          />
        ) : null}
        {mode === 'zone' ? <AddZonePanel onAdded={() => setMode(null)} /> : null}
        {mode === 'list' ? (
          <PasteListPanel
            onFix={(line) => {
              setHomePrefill(line);
              setMode('home');
            }}
          />
        ) : null}

        <SectionHeader title="Your list" />
        {entries.length === 0 ? (
          <RichCard>
            <View style={styles.empty}>
              <IconChip name="ban-outline" tone="quiet" />
              <Text style={styles.emptyTitle}>Nothing on the list</Text>
              <Text style={styles.emptyBody}>
                Add a home, draw a zone, or paste an HOA no-solicit list. A "Do not knock" outcome on a pin lands here too.
              </Text>
            </View>
          </RichCard>
        ) : (
          <RichCard padded={false}>
            {entries.map((e, i) => (
              <View key={e.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                <IconChip name={e.kind === 'zone' ? 'shapes-outline' : 'ban-outline'} tone={e.kind === 'zone' ? 'orange' : 'quiet'} size="sm" />
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {e.label}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {[kindLine(e), SOURCE_LABEL[e.source], e.note].filter(Boolean).join(' · ')}
                  </Text>
                  {e.address && e.address !== e.label ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {e.address}
                    </Text>
                  ) : null}
                </View>
                <PressableScale style={styles.removeBtn} onPress={() => setConfirm(e)} accessibilityRole="button" accessibilityLabel={`Remove ${e.label}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </PressableScale>
              </View>
            ))}
          </RichCard>
        )}
        <Text style={styles.footer}>
          Zones lower an area's Knock Score by the share they cover and drop it when they cover most of it. Homes stay
          off every route and warn you if a pin lands on one.
        </Text>
      </ScrollView>

      <ConfirmSheet
        visible={confirm !== null}
        title={confirm ? `Remove ${confirm.label}?` : 'Remove?'}
        body={
          confirm?.kind === 'zone'
            ? 'The planner will rank streets inside it again and Knock mode will stop drawing it.'
            : 'Knock mode will stop warning you about this door.'
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirm) {
            remove(confirm.id);
            toast({ tone: 'info', title: 'Removed from do-not-knock', body: confirm.label });
          }
        }}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function ModeButton({ icon, label, on, onPress }: { icon: IoniconName; label: string; on: boolean; onPress: () => void }) {
  return (
    <PressableScale
      style={[styles.modeBtn, on && styles.modeBtnOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={on ? colors.textInverse : colors.navy} />
      <Text style={[styles.modeBtnText, on && styles.modeBtnTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function Notice({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <View style={[styles.notice, warn && styles.noticeWarn]}>
      <Ionicons name={warn ? 'warning-outline' : 'information-circle-outline'} size={18} color={warn ? colors.warn : colors.slate} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

/** Resolve a Places prediction to a point: its own lat/lng, else one details call. */
async function pointForPrediction(p: PlacePrediction): Promise<Point | null> {
  if (typeof p.lat === 'number' && typeof p.lng === 'number') return { lat: p.lat, lng: p.lng };
  try {
    const d = await getPlaceDetails(p.placeId);
    return Number.isFinite(d.lat) && Number.isFinite(d.lng) && (d.lat !== 0 || d.lng !== 0) ? { lat: d.lat, lng: d.lng } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Add a home

function AddHomePanel({ prefill, onAdded }: { prefill: string; onAdded: () => void }) {
  const add = useDoNotKnockStore((s) => s.add);
  const toast = useToastStore((s) => s.show);
  const [text, setText] = useState(prefill);
  const [point, setPoint] = useState<Point | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) {
      setText(prefill);
      setPoint(null);
    }
  }, [prefill]);

  const onAdd = async () => {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const placed = point ? { ...point, address: t } : await placeText(t);
      if (!placed) {
        setError(`Google could not find that address. Check the street and city, ${COORD_HINT}.`);
        return;
      }
      const label = labelFor(placed.address);
      add({
        kind: 'home',
        source: 'roofer',
        lat: placed.lat,
        lng: placed.lng,
        address: placed.address,
        label,
        note: note.trim() || undefined,
      });
      toast({ tone: 'success', title: 'Added to do-not-knock', body: label });
      setText('');
      setPoint(null);
      setNote('');
      onAdded();
    } catch (e) {
      setError(errorCopy(e, 'Could not place that address.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RichCard icon="home-outline" iconTone="orange" title="Add a home" subtitle="One door that stays off every route.">
      <View style={styles.panel}>
        <AddressAutocomplete
          value={text}
          onChangeText={(t) => {
            setText(t);
            setPoint(null);
          }}
          onPlaceSelected={(p) => {
            void pointForPrediction(p).then((pt) => setPoint(pt));
          }}
          onLocationSelected={(l) => setPoint({ lat: l.lat, lng: l.lng })}
          useMyLocation
          placeholder={`1420 Oak St, Plano TX — ${COORD_HINT}`}
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional) — “asked us not to return”"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
        />
        {error ? <Notice text={error} warn /> : null}
        <PressableScale
          style={[styles.primaryBtn, (busy || text.trim().length < 3) && styles.primaryBtnDisabled]}
          onPress={() => void onAdd()}
          disabled={busy || text.trim().length < 3}
          accessibilityRole="button"
          accessibilityLabel="Add home to do-not-knock"
        >
          {busy ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="ban" size={20} color={colors.textInverse} />}
          <Text style={styles.primaryBtnText}>{busy ? 'Placing…' : 'Add home'}</Text>
        </PressableScale>
      </View>
    </RichCard>
  );
}

// ---------------------------------------------------------------------------
// Add a zone

function AddZonePanel({ onAdded }: { onAdded: () => void }) {
  const add = useDoNotKnockStore((s) => s.add);
  const toast = useToastStore((s) => s.show);
  const areas = useServiceAreaStore((s) => s.areas);
  const mapRef = useRef<ElementRef<typeof Map>>(null);
  const [name, setName] = useState('');
  const [points, setPoints] = useState<Point[]>([]);
  const [centreText, setCentreText] = useState('');
  const [centre, setCentre] = useState<Point | null>(null);
  const [radius, setRadius] = useState(DEFAULT_ZONE_RADIUS_METERS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open the map on the service area, else the phone's last-known spot, else
  // the country — never a guessed neighbourhood.
  const areaCentroid = useMemo(() => {
    const a = areas.find((x) => typeof x.centroidLat === 'number' && typeof x.centroidLng === 'number');
    return a ? { lat: a.centroidLat as number, lng: a.centroidLng as number } : null;
  }, [areas]);
  const initialRegion = useMemo(
    () => (areaCentroid ? regionForLatLon(areaCentroid.lat, areaCentroid.lng, 0.2) : regionForLatLon(US_CENTER.lat, US_CENTER.lng, US_DELTA)),
    // The seed viewport is captured once by the native map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    if (areaCentroid) return;
    let cancelled = false;
    getBiasCoordinate()
      .then((c) => {
        if (!cancelled && c) mapRef.current?.animateToRegion(regionForLatLon(c.lat, c.lng, 0.2), 300);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [areaCentroid]);

  const polygonReady = points.length >= 3;
  const circleCentre = points[0] ?? centre;

  const focusOn = (p: Point) => mapRef.current?.animateToRegion(regionForLatLon(p.lat, p.lng, ZONE_MAP_DELTA), 300);

  const resolveCentre = async (): Promise<Point | null> => {
    if (centre) return centre;
    const t = centreText.trim();
    if (t.length < 3) return null;
    const placed = await placeText(t);
    return placed ? { lat: placed.lat, lng: placed.lng } : null;
  };

  const onDone = async () => {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (polygonReady) {
        const c = {
          lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
          lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
        };
        add({ kind: 'zone', source: 'roofer', label, polygon: points, lat: c.lat, lng: c.lng });
        toast({ tone: 'success', title: 'Zone added', body: `${label} · ${points.length} corners` });
      } else {
        const c = points[0] ?? (await resolveCentre());
        if (!c) {
          setError(`Tap the map at the zone's centre, type its address, ${COORD_HINT}.`);
          return;
        }
        add({ kind: 'zone', source: 'roofer', label, lat: c.lat, lng: c.lng, radiusMeters: radius, address: centreText.trim() || undefined });
        toast({ tone: 'success', title: 'Zone added', body: `${label} · ${radiusLabel(radius)} around the centre` });
      }
      setName('');
      setPoints([]);
      setCentreText('');
      setCentre(null);
      onAdded();
    } catch (e) {
      setError(errorCopy(e, 'Could not place that centre.'));
    } finally {
      setBusy(false);
    }
  };

  const hint = polygonReady
    ? `${points.length} corners — Done saves the shape.`
    : points.length > 0
      ? `${points.length} of 3 corners · fewer than 3 = a ${radiusLabel(radius)} circle around your first tap`
      : 'Tap 3 or more corners for a shape — or one tap (or an address below) for a centre + radius.';

  return (
    <RichCard icon="shapes-outline" iconTone="orange" title="Add a zone" subtitle="An HOA, a gated street, a whole neighbourhood.">
      <View style={styles.panel}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Zone name — “Willow Bend HOA”"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
          autoCapitalize="words"
        />
        <View style={styles.mapWrap}>
          <Map
            ref={mapRef}
            initialRegion={initialRegion}
            showsUserLocation={false}
            showsCompass={false}
            googleImagery={false}
            style={styles.map}
            onPress={(c) => {
              setError(null);
              setPoints((p) => [...p, { lat: c.latitude, lng: c.longitude }]);
            }}
          >
            {points.map((p, i) => (
              <MapPin key={`${p.lat},${p.lng},${i}`} coordinate={{ latitude: p.lat, longitude: p.lng }} tone="danger" title={`Corner ${i + 1}`} />
            ))}
            {polygonReady ? (
              <MapPolygon
                coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                fillColor={colors.stormSevereFill}
                strokeColor={colors.danger}
                strokeWidth={1.5}
              />
            ) : circleCentre ? (
              <MapCircle
                center={{ latitude: circleCentre.lat, longitude: circleCentre.lng }}
                radius={radius}
                fillColor={colors.stormSevereFill}
                strokeColor={colors.danger}
                strokeWidth={1.5}
              />
            ) : null}
          </Map>
        </View>
        <Text style={styles.hint}>{hint}</Text>
        <View style={styles.btnRow}>
          <PressableScale
            style={[styles.secondaryBtn, points.length === 0 && styles.btnDisabled]}
            onPress={() => setPoints((p) => p.slice(0, -1))}
            disabled={points.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Undo the last corner"
          >
            <Ionicons name="arrow-undo-outline" size={18} color={colors.navy} />
            <Text style={styles.secondaryBtnText}>Undo</Text>
          </PressableScale>
          <PressableScale
            style={[styles.secondaryBtn, points.length === 0 && styles.btnDisabled]}
            onPress={() => setPoints([])}
            disabled={points.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Clear all corners"
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.navy} />
            <Text style={styles.secondaryBtnText}>Clear</Text>
          </PressableScale>
          <PressableScale
            style={[styles.primaryBtnHalf, (busy || !name.trim()) && styles.primaryBtnDisabled]}
            onPress={() => void onDone()}
            disabled={busy || !name.trim()}
            accessibilityRole="button"
            accessibilityLabel="Save the zone"
          >
            {busy ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="checkmark" size={20} color={colors.textInverse} />}
            <Text style={styles.primaryBtnText}>Done</Text>
          </PressableScale>
        </View>

        {!polygonReady ? (
          <>
            <Text style={styles.groupLabel}>Centre + radius</Text>
            <AddressAutocomplete
              value={centreText}
              onChangeText={(t) => {
                setCentreText(t);
                setCentre(null);
              }}
              onPlaceSelected={(p) => {
                void pointForPrediction(p).then((pt) => {
                  setCentre(pt);
                  if (pt) focusOn(pt);
                });
              }}
              onLocationSelected={(l) => {
                const pt = { lat: l.lat, lng: l.lng };
                setCentre(pt);
                focusOn(pt);
              }}
              useMyLocation
              placeholder={`Gate or clubhouse address — ${COORD_HINT}`}
            />
            <View style={styles.chipRow}>
              {ZONE_RADII.map((r) => {
                const on = r.meters === radius;
                return (
                  <PressableScale
                    key={r.meters}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => setRadius(r.meters)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Radius ${r.label}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </>
        ) : null}
        {error ? <Notice text={error} warn /> : null}
      </View>
    </RichCard>
  );
}

// ---------------------------------------------------------------------------
// Paste a list

type PasteState =
  | { status: 'idle' }
  | { status: 'busy'; placed: number; notFound: number; total: number }
  | { status: 'done'; placed: number; notFound: string[]; total: number; error?: string };

function PasteListPanel({ onFix }: { onFix: (line: string) => void }) {
  const addMany = useDoNotKnockStore((s) => s.addMany);
  const toast = useToastStore((s) => s.show);
  const [listName, setListName] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState<PasteState>({ status: 'idle' });
  const lines = useMemo(() => parseAddressList(text), [text]);

  const run = async () => {
    if (lines.length === 0 || state.status === 'busy') return;
    const total = lines.length;
    setState({ status: 'busy', placed: 0, notFound: 0, total });
    const label = listName.trim() || 'Pasted list';
    const inputs: DoNotKnockInput[] = [];
    const notFound: string[] = [];
    let placed = 0;
    let lastError: string | undefined;
    await mapLimit(lines, GEOCODE_CONCURRENCY, async (line) => {
      try {
        const g = await placeText(line);
        if (!g) notFound.push(line);
        else {
          placed += 1;
          inputs.push({
            kind: 'home',
            source: 'hoa_list',
            lat: g.lat,
            lng: g.lng,
            address: g.address,
            label: labelFor(line),
            note: label,
          });
        }
      } catch (e) {
        notFound.push(line);
        lastError = errorCopy(e, 'The geocoder did not answer.');
      }
      setState({ status: 'busy', placed, notFound: notFound.length, total });
    });
    if (inputs.length > 0) addMany(inputs);
    setState({ status: 'done', placed, notFound, total, error: lastError });
    toast({
      tone: notFound.length === 0 ? 'success' : 'warn',
      title: `${placed} of ${total} placed`,
      body: notFound.length > 0 ? `${notFound.length} not found — listed below to fix by hand.` : label,
    });
  };

  const busy = state.status === 'busy';

  return (
    <RichCard icon="clipboard-outline" iconTone="orange" title="Paste a list" subtitle="An HOA no-solicit list or a city register — one address per line.">
      <View style={styles.panel}>
        <TextInput
          value={listName}
          onChangeText={setListName}
          placeholder="List name — “Willow Bend HOA”"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
          autoCapitalize="words"
        />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'1420 Oak St, Plano TX\n1424 Oak St, Plano TX\n…'}
          placeholderTextColor={colors.textSubtle}
          style={[styles.input, styles.inputMultiline]}
          multiline
          autoCapitalize="words"
          autoCorrect={false}
        />
        <Text style={styles.hint}>
          {lines.length === 0 ? 'Nothing to place yet — lines need a street number.' : `${lines.length} address${lines.length === 1 ? '' : 'es'} found in the paste.`}
        </Text>
        {state.status === 'busy' ? (
          <View style={styles.progressRow}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.progressText}>
              {state.placed} of {state.total} placed · {state.notFound} not found
            </Text>
          </View>
        ) : null}
        {state.status === 'done' ? (
          <>
            <Text style={styles.progressText}>
              {state.placed} of {state.total} placed · {state.notFound.length} not found
            </Text>
            {state.error ? <Notice text={state.error} warn /> : null}
            {state.notFound.length > 0 ? (
              <View style={styles.notFoundList}>
                <Text style={styles.groupLabel}>Not found — tap to fix</Text>
                {state.notFound.map((line) => (
                  <PressableScale key={line} style={styles.notFoundRow} onPress={() => onFix(line)} accessibilityRole="button" accessibilityLabel={`Fix ${line}`}>
                    <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
                    <Text style={styles.notFoundText} numberOfLines={2}>
                      {line}
                    </Text>
                    <Ionicons name="create-outline" size={18} color={colors.navy} />
                  </PressableScale>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        <PressableScale
          style={[styles.primaryBtn, (busy || lines.length === 0) && styles.primaryBtnDisabled]}
          onPress={() => void run()}
          disabled={busy || lines.length === 0}
          accessibilityRole="button"
          accessibilityLabel={`Place ${lines.length} addresses on the do-not-knock list`}
        >
          {busy ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="ban" size={20} color={colors.textInverse} />}
          <Text style={styles.primaryBtnText}>{busy ? 'Placing…' : lines.length > 0 ? `Place ${lines.length} address${lines.length === 1 ? '' : 'es'}` : 'Place addresses'}</Text>
        </PressableScale>
      </View>
    </RichCard>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl * 2 },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  modeBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  modeBtnOn: { backgroundColor: colors.navy },
  modeBtnText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.navy, flexShrink: 1 },
  modeBtnTextOn: { color: colors.textInverse },
  panel: { gap: spacing.md },
  input: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    fontSize: fontSize.bodyLg,
    color: colors.text,
  },
  inputMultiline: { minHeight: 140, textAlignVertical: 'top', fontSize: fontSize.bodyMd, lineHeight: 21 },
  hint: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  groupLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  mapWrap: { height: 260, borderRadius: radii.lg, overflow: 'hidden' },
  map: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  secondaryBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  btnDisabled: { opacity: 0.5 },
  primaryBtn: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  primaryBtnHalf: {
    flex: 1.2,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  primaryBtnDisabled: { backgroundColor: colors.accentDisabled },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  chipOn: { backgroundColor: colors.navy },
  chipText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  chipTextOn: { color: colors.textInverse },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  noticeWarn: { backgroundColor: colors.warnSoft },
  noticeText: { flex: 1, color: colors.text, fontSize: fontSize.bodySm, lineHeight: 18 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.small },
  progressText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  notFoundList: { gap: spacing.xs },
  notFoundRow: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.warnSoft,
  },
  notFoundText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.preferred, paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 17 },
  rowMeta: { fontSize: fontSize.caption, color: colors.textSubtle },
  removeBtn: { width: touchTarget.standard, height: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  emptyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, marginTop: spacing.xs },
  emptyBody: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  footer: { fontSize: fontSize.bodySm, color: colors.textSubtle, lineHeight: 18, paddingHorizontal: spacing.xs },
});
