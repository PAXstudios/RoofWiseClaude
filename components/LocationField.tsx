/**
 * LocationField — the one address input for the whole app.
 *
 * Places autocomplete (the existing `AddressAutocomplete`) plus a glove-sized
 * "Use my location" button that turns the device fix into a street address
 * and hands the caller real coordinates. Wire it anywhere an address is asked
 * (New Job, New Lead, Estimator, Service Area, Weather) so "current location"
 * works the same everywhere — the owner's Wave 9 ask.
 *
 * ── API ──────────────────────────────────────────────────────────────────
 *   <LocationField
 *     value={address}                       // controlled text
 *     onChangeText={setAddress}             // every keystroke, as TextInput
 *     onResolved={(loc) => ...}             // fires ONLY with real coordinates:
 *                                           //   a picked Places prediction, or a
 *                                           //   successful "Use my location"
 *     label="Property address"              // optional caps label
 *     placeholder="123 Main St, Plano TX"
 *     biasLat / biasLng                     // optional Places bias
 *     useMyLocation={true}                  // hide the button with false
 *   />
 *
 *   `onResolved` never fires for free-typed text — the caller geocodes that
 *   itself (`geocodeText` in lib/services/geocoding.ts) when it needs a point.
 *
 *   Also exported, for callers that want the location without the field:
 *     resolveDeviceLocation()  → typed result: ok / permission_denied /
 *                                 no_fix / unsupported. Never throws.
 *     reverseGeocode(coord)    → address for a point, or null. Never throws.
 *
 * ── Honesty (Drift #5) ───────────────────────────────────────────────────
 * Every failure names its cause in one line under the button: location
 * access is off (with the route to the OS setting), no fix yet, or a fix
 * that could not be turned into an address — in which case the field shows
 * the coordinates, which are real, rather than an invented street.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { PressableScale } from '@/components/PressableScale';
import { getPlaceDetails, type PlacePrediction } from '@/lib/services/places';
import { stateFromText } from '@/lib/services/serviceState';
import { env, isGoogleMapsConfigured } from '@/lib/env';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

/* ─────────────────────────── types ───────────────────────────────────── */

export type ResolvedLocation = {
  /** Full address line. Coordinates text when no address could be found. */
  address: string;
  lat: number;
  lng: number;
  /** Where the coordinates came from. */
  source: 'places' | 'device';
  placeId?: string;
  city?: string;
  /** Two-letter US state when it could be read off the address. */
  stateCode?: string;
  postalCode?: string;
};

export type DeviceLocationResult =
  | {
      status: 'ok';
      location: ResolvedLocation;
      /** False when the fix was real but no service could name the street. */
      addressKnown: boolean;
    }
  | { status: 'permission_denied'; canAskAgain: boolean }
  | { status: 'no_fix' }
  /** Location services not available at all (some web contexts). */
  | { status: 'unsupported' };

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onResolved?: (location: ResolvedLocation) => void;
  label?: string;
  placeholder?: string;
  biasLat?: number;
  biasLng?: number;
  /** Show the "Use my location" button. Default true. */
  useMyLocation?: boolean;
  style?: StyleProp<ViewStyle>;
} & Pick<TextInputProps, 'autoFocus' | 'returnKeyType'>;

/** Bound on the GPS fix. Past this, fall back to the last known position. */
const FIX_TIMEOUT_MS = 12_000;
/** A cached fix older than this is not "my location" any more. */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;

type Note = { tone: 'info' | 'warn'; text: string };

/* ─────────────────────────── component ───────────────────────────────── */

export function LocationField({
  value,
  onChangeText,
  onResolved,
  label,
  placeholder,
  biasLat,
  biasLng,
  useMyLocation = true,
  style,
  autoFocus,
  returnKeyType,
}: Props) {
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [settingsRoute, setSettingsRoute] = useState(false);
  const mounted = useRef(true);
  const runRef = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runRef.current += 1;
    };
  }, []);

  const onPlaceSelected = useCallback(
    async (p: PlacePrediction) => {
      setNote(null);
      const base = {
        address: p.description,
        placeId: p.placeId || undefined,
        stateCode: stateFromText(p.description) ?? undefined,
        source: 'places' as const,
      };
      if (typeof p.lat === 'number' && typeof p.lng === 'number') {
        onResolved?.({ ...base, lat: p.lat, lng: p.lng });
        return;
      }
      if (!p.placeId) return;
      try {
        const details = await getPlaceDetails(p.placeId);
        if (!mounted.current) return;
        if (Number.isFinite(details.lat) && Number.isFinite(details.lng)) {
          onResolved?.({
            ...base,
            address: details.formattedAddress || p.description,
            lat: details.lat,
            lng: details.lng,
          });
        }
      } catch {
        // The text is already in the field; the caller can geocode it later.
      }
    },
    [onResolved],
  );

  const useLocation = useCallback(async () => {
    if (settingsRoute) {
      if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
        Linking.openSettings().catch(() => {});
      }
      return;
    }
    const run = ++runRef.current;
    setLocating(true);
    setNote(null);
    const result = await resolveDeviceLocation();
    if (!mounted.current || runRef.current !== run) return;
    setLocating(false);

    switch (result.status) {
      case 'ok':
        onChangeText(result.location.address);
        onResolved?.(result.location);
        setNote(
          result.addressKnown
            ? { tone: 'info', text: 'Filled from your current location' }
            : {
                tone: 'warn',
                text: 'Got your position, but no street address came back — the coordinates are real and usable.',
              },
        );
        return;
      case 'permission_denied':
        setSettingsRoute(!result.canAskAgain && Platform.OS !== 'web');
        setNote({
          tone: 'warn',
          text: result.canAskAgain
            ? 'Location access is off. Allow it to fill the address from where you are.'
            : 'Location access is off for RoofWise. Turn it on in Settings to use your location.',
        });
        return;
      case 'no_fix':
        setNote({ tone: 'warn', text: 'No location fix yet — try again with a clearer view of the sky.' });
        return;
      case 'unsupported':
        setNote({ tone: 'warn', text: 'Location is not available on this device.' });
        return;
    }
  }, [onChangeText, onResolved, settingsRoute]);

  const buttonLabel = locating
    ? 'Finding your location…'
    : settingsRoute
    ? 'Turn on location access'
    : 'Use my location';

  return (
    <View style={[styles.wrap, style]}>
      <AddressAutocomplete
        value={value}
        onChangeText={(t) => {
          if (note) setNote(null);
          onChangeText(t);
        }}
        onPlaceSelected={onPlaceSelected}
        label={label}
        placeholder={placeholder}
        biasLat={biasLat}
        biasLng={biasLng}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
      />

      {useMyLocation && (
        <PressableScale
          style={[styles.locBtn, locating && styles.locBtnBusy]}
          onPress={useLocation}
          disabled={locating}
          accessibilityRole="button"
          accessibilityState={{ busy: locating, disabled: locating }}
          accessibilityLabel={buttonLabel}
        >
          {locating ? (
            <ActivityIndicator color={colors.tileBlueInk} />
          ) : (
            <Ionicons
              name={settingsRoute ? 'settings-outline' : 'navigate'}
              size={20}
              color={colors.tileBlueInk}
            />
          )}
          <Text style={styles.locBtnText}>{buttonLabel}</Text>
        </PressableScale>
      )}

      {note && (
        <View style={styles.noteRow} accessibilityLiveRegion="polite">
          <Ionicons
            name={note.tone === 'warn' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={16}
            color={note.tone === 'warn' ? colors.warn : colors.success}
          />
          <Text style={[styles.noteText, note.tone === 'warn' && styles.noteWarn]}>{note.text}</Text>
        </View>
      )}
    </View>
  );
}

/* ─────────────────────────── device location ─────────────────────────── */

/**
 * Where the phone is, as an address. Asks for foreground permission if it
 * has not been decided yet; never throws — every outcome is a typed result.
 */
export async function resolveDeviceLocation(): Promise<DeviceLocationResult> {
  let perm: Location.LocationPermissionResponse;
  try {
    perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      if (perm.canAskAgain === false) return { status: 'permission_denied', canAskAgain: false };
      perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        return { status: 'permission_denied', canAskAgain: perm.canAskAgain !== false };
      }
    }
  } catch {
    return { status: 'unsupported' };
  }

  const fix = await currentFix();
  if (!fix) return { status: 'no_fix' };

  const geo = await reverseGeocode(fix);
  if (geo) {
    return {
      status: 'ok',
      addressKnown: true,
      location: { ...geo, lat: fix.lat, lng: fix.lng, source: 'device' },
    };
  }
  return {
    status: 'ok',
    addressKnown: false,
    location: {
      address: `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`,
      lat: fix.lat,
      lng: fix.lng,
      source: 'device',
    },
  };
}

async function currentFix(): Promise<{ lat: number; lng: number } | null> {
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (fresh) return { lat: fresh.coords.latitude, lng: fresh.coords.longitude };
  } catch {
    // fall through to the cached position
  }
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    // no cached fix either
  }
  return null;
}

export type ReverseGeocoded = {
  address: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
};

/**
 * Street address for a point. The OS geocoder first (free, works in Expo Go
 * without any Google key), then Google Geocoding when a key is configured.
 * `null` when neither could name the place — never a made-up street.
 */
export async function reverseGeocode(coord: {
  lat: number;
  lng: number;
}): Promise<ReverseGeocoded | null> {
  const native = await reverseGeocodeNative(coord);
  if (native) return native;
  return reverseGeocodeGoogle(coord);
}

async function reverseGeocodeNative(coord: {
  lat: number;
  lng: number;
}): Promise<ReverseGeocoded | null> {
  // expo-location's web build throws here by design; the Google path covers it.
  if (Platform.OS === 'web') return null;
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: coord.lat,
      longitude: coord.lng,
    });
    const r = results[0];
    if (!r) return null;
    const street = [r.streetNumber, r.street].filter(Boolean).join(' ');
    const region = r.region ?? undefined;
    const stateCode =
      region && region.length === 2 ? region.toUpperCase() : stateFromText(region) ?? undefined;
    const cityLine = [r.city, [stateCode ?? region, r.postalCode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    const composed = [street, cityLine].filter((s) => s && s.length > 0).join(', ');
    const address = composed || r.formattedAddress || r.name || '';
    if (!address) return null;
    return {
      address,
      city: r.city ?? undefined,
      stateCode,
      postalCode: r.postalCode ?? undefined,
    };
  } catch {
    return null;
  }
}

const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

async function reverseGeocodeGoogle(coord: {
  lat: number;
  lng: number;
}): Promise<ReverseGeocoded | null> {
  if (!isGoogleMapsConfigured) return null;
  try {
    const url =
      `${GEOCODE_ENDPOINT}?latlng=${coord.lat},${coord.lng}` +
      `&result_type=street_address|premise|route|locality` +
      `&key=${env.GOOGLE_GEOCODING_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: {
        formatted_address?: string;
        address_components?: { long_name?: string; short_name?: string; types?: string[] }[];
      }[];
    };
    const first = data.results?.[0];
    if (data.status !== 'OK' || !first?.formatted_address) return null;
    const comp = (type: string) =>
      first.address_components?.find((c) => c.types?.includes(type));
    const state = comp('administrative_area_level_1')?.short_name;
    return {
      address: first.formatted_address.replace(/, USA$/, ''),
      city: comp('locality')?.long_name,
      stateCode: state && state.length === 2 ? state.toUpperCase() : undefined,
      postalCode: comp('postal_code')?.long_name,
    };
  } catch {
    return null;
  }
}

/* ─────────────────────────── styles ──────────────────────────────────── */

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  // Secondary control on the royal tile pair (8.4:1) — clearly a button, not
  // the primary CTA of whichever form hosts it.
  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.tileBlue,
  },
  locBtnBusy: { opacity: 0.8 },
  locBtnText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.tileBlueInk,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  noteText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  noteWarn: { color: colors.warn },
});
