// Where the Knock Planner searches from — a map first, because most people
// know regions, not addresses (the owner, 2026-09-03).
//
// A real map (260pt) centred on the base with the search ring drawn on it:
// tap or long-press anywhere to drop the pin there — the map moves the pin,
// never the other way round — and the ring redraws live as the radius dial
// under the card turns; the camera refits so the whole ring stays in view.
// Under the map, three glove-sized chips: My location (a GPS fix), Address
// (opens the address field — the third option, not the first), and Service
// area when one exists.
//
// A dropped pin has no name yet. The label shown is "Pinned spot" and the
// base goes out with `label: ''` — the runner reverse-geocodes blank labels
// once, so the plan's title still reads "Frisco, TX" (Drift #5: never a
// made-up name here). Web without a Google key: the map falls back to its
// own panel and the chips keep working.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type MapView from 'react-native-maps';
import { Map, MapCircle, MapPin, regionForLatLon, type MapCoordinate, type Region } from '@/components/map/Map';
import { LocationField, resolveDeviceLocation, type ResolvedLocation } from '@/components/LocationField';
import { GlassCard } from '@/components/glass/GlassCard';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import type { IoniconName } from '@/components/ui/IconChip';
import type { BasePoint } from '@/lib/services/knockOpportunities';
import { colors, fontFamily, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export const BASE_MAP_HEIGHT = 260;
const METERS_PER_MILE = 1609.344;
/** Degrees of latitude per mile, near enough everywhere. */
const LAT_DEG_PER_MILE = 1 / 69;
/** The camera leaves this much air around the ring. */
const RING_PADDING = 1.35;
/** How long the camera waits for the dial to settle before refitting. */
const REFIT_DEBOUNCE_MS = 140;
/** Nothing to go on: the whole country, so a tap still drops a pin. */
const US_REGION: Region = { latitude: 39.5, longitude: -98.35, latitudeDelta: 40, longitudeDelta: 40 };

/** A region that fits a ring of `miles` about the point. */
export function regionForRing(lat: number, lng: number, miles: number): Region {
  return regionForLatLon(lat, lng, Math.max(0.02, 2 * miles * LAT_DEG_PER_MILE * RING_PADDING));
}

/** What the screen calls the base: its name, or "Pinned spot" for a raw pin. */
export function baseDisplayLabel(base: BasePoint | null | undefined): string {
  const l = base?.label?.trim();
  return l ? l : 'Pinned spot';
}

type Source = 'pin' | 'device' | 'address' | 'area';

type Props = {
  base: BasePoint | null;
  radiusMiles: number;
  onChangeBase: (base: BasePoint) => void;
  /** The screen is already resolving the phone's position (first open, nothing to go on). */
  locating?: boolean;
  /** The first service area with a centroid, when the roofer set one up. */
  serviceArea?: BasePoint | null;
};

export function BasePicker({ base, radiusMiles, onChangeBase, locating = false, serviceArea = null }: Props) {
  const mapRef = useRef<MapView>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [showAddress, setShowAddress] = useState(false);
  const [addressText, setAddressText] = useState('');
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The camera fits the ring — at once when the base moves, after a short
  // settle while the dial is turning.
  const initialRegion = useMemo(() => (base ? regionForRing(base.lat, base.lng, radiusMiles) : US_REGION), []); // eslint-disable-line react-hooks/exhaustive-deps
  const baseKey = base ? `${base.lat.toFixed(5)},${base.lng.toFixed(5)}` : '';
  useEffect(() => {
    if (!base) return;
    mapRef.current?.animateToRegion(regionForRing(base.lat, base.lng, radiusMiles), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);
  useEffect(() => {
    if (!base) return;
    const id = setTimeout(() => mapRef.current?.animateToRegion(regionForRing(base.lat, base.lng, radiusMiles), 300), REFIT_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusMiles]);

  const dropPin = useCallback(
    (c: MapCoordinate) => {
      setNote(null);
      setSource('pin');
      // No name yet — the runner geocodes a blank label once (Drift #5).
      onChangeBase({ lat: c.latitude, lng: c.longitude, label: '' });
    },
    [onChangeBase],
  );

  const useDevice = useCallback(async () => {
    if (finding) return;
    setFinding(true);
    setNote(null);
    const r = await resolveDeviceLocation();
    if (!mounted.current) return;
    setFinding(false);
    if (r.status === 'ok') {
      const loc = r.location;
      const label = loc.city ? `${loc.city}${loc.stateCode ? `, ${loc.stateCode}` : ''}` : r.addressKnown ? loc.address : '';
      setSource('device');
      setNote(loc.note ?? null);
      onChangeBase({ lat: loc.lat, lng: loc.lng, label });
      return;
    }
    setNote(
      r.status === 'permission_denied'
        ? r.canAskAgain
          ? 'Location is off for RoofWise. Allow it, or drop a pin on the map.'
          : 'Location is off for RoofWise — turn it on in Settings, or drop a pin on the map.'
        : r.status === 'no_fix'
          ? "Couldn't get a GPS fix. Step outside and try again, or drop a pin on the map."
          : "Location isn't available here — drop a pin on the map or type an address.",
    );
  }, [finding, onChangeBase]);

  const onAddress = useCallback(
    (loc: ResolvedLocation) => {
      const label = loc.city ? `${loc.city}${loc.stateCode ? `, ${loc.stateCode}` : ''}` : loc.address;
      setSource('address');
      setNote(null);
      onChangeBase({ lat: loc.lat, lng: loc.lng, label });
    },
    [onChangeBase],
  );

  const useArea = useCallback(() => {
    if (!serviceArea) return;
    setSource('area');
    setNote(null);
    onChangeBase(serviceArea);
  }, [onChangeBase, serviceArea]);

  const label = baseDisplayLabel(base);
  const subtitle = base ? `${label} · ${radiusMiles} mi around it` : locating ? 'Finding your location…' : 'Tap the map, use your location, or type an address';

  return (
    <RichCard icon="navigate-outline" iconTone="blue" title="Search from" subtitle={subtitle} padded={false}>
      <View style={styles.mapWrap}>
        <Map
          ref={mapRef}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsCompass={false}
          // The ring IS the information; in Expo Go on iOS the Google tile
          // layer would sit above it (see Map.tsx `googleImagery`).
          googleImagery={false}
          onPress={dropPin}
          onLongPress={dropPin}
          style={styles.map}
        >
          {base ? (
            <>
              <MapCircle
                center={{ latitude: base.lat, longitude: base.lng }}
                radius={radiusMiles * METERS_PER_MILE}
                fillColor={colors.stormHailFill}
                strokeColor={colors.brand}
                strokeWidth={2}
              />
              <MapPin coordinate={{ latitude: base.lat, longitude: base.lng }} tone="orange" title={label} />
            </>
          ) : null}
        </Map>
        <View style={styles.mapHint} pointerEvents="none">
          <GlassCard onLight onArt radius={radii.pill} style={styles.mapHintPill}>
            <Ionicons name={base ? 'locate-outline' : 'hand-left-outline'} size={16} color={colors.text} />
            <Text style={styles.mapHintText} numberOfLines={1}>
              {base ? 'Tap the map to move the pin' : 'Tap anywhere to drop your base'}
            </Text>
          </GlassCard>
        </View>
      </View>

      <View style={styles.chips}>
        <Chip icon="navigate" label="My location" on={source === 'device'} busy={finding} onPress={useDevice} testID="base-chip-device" />
        <Chip icon="search-outline" label="Address" on={source === 'address' || showAddress} onPress={() => setShowAddress((v) => !v)} testID="base-chip-address" />
        {serviceArea ? <Chip icon="map-outline" label="Service area" on={source === 'area'} onPress={useArea} testID="base-chip-area" /> : null}
      </View>

      {showAddress ? (
        <View style={styles.addressWrap}>
          <LocationField
            value={addressText}
            onChangeText={setAddressText}
            onResolved={onAddress}
            useMyLocation={false}
            placeholder="Town, ZIP, or a street address"
            biasLat={base?.lat}
            biasLng={base?.lng}
            autoFocus
          />
        </View>
      ) : null}

      {note ? (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}
    </RichCard>
  );
}

function Chip({ icon, label, on, busy = false, onPress, testID }: { icon: IoniconName; label: string; on: boolean; busy?: boolean; onPress: () => void; testID?: string }) {
  return (
    <PressableScale
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, busy }}
      testID={testID}
    >
      {busy ? <ActivityIndicator size="small" color={on ? colors.textInverse : colors.text} /> : <Ionicons name={icon} size={18} color={on ? colors.textInverse : colors.text} />}
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {busy ? 'Finding…' : label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: BASE_MAP_HEIGHT, backgroundColor: colors.surfaceMuted },
  map: { flex: 1, borderRadius: 0 },
  mapHint: { position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, alignItems: 'flex-start' },
  mapHintPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 36, paddingHorizontal: spacing.md, maxWidth: '100%' },
  mapHintText: { flexShrink: 1, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  chips: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  chip: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  chipOn: { backgroundColor: colors.navy },
  chipText: { flexShrink: 1, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  chipTextOn: { color: colors.textInverse },
  addressWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  noteText: { flex: 1, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
});
