/**
 * LocationField — the one address input for the whole app.
 *
 * Places autocomplete plus the glove-sized "Use my location" button, as one
 * field with one result type. Wire it anywhere an address is asked (New Job,
 * New Lead, Estimator, Service Area, Weather) so "current location" works
 * the same everywhere — the owner's Wave 9 ask.
 *
 * It composes `AddressAutocomplete` (which owns the Places lookup, the
 * `UseMyLocationButton` and the honest key-refused / permission / no-fix
 * copy) and adds the two things a caller otherwise re-implements: a Place
 * Details fallback when a prediction arrives without coordinates, and a
 * single `onResolved` callback for both routes.
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
 *   The address text has already been pushed through `onChangeText` by the
 *   time `onResolved` fires, so a controlled field needs no extra handling.
 *
 *   Also exported, for callers that want the location without the field:
 *     resolveDeviceLocation()  → typed result: ok / permission_denied /
 *                                 no_fix / unsupported. Never throws.
 *
 * ── Honesty (Drift #5) ───────────────────────────────────────────────────
 * Every failure names its cause in one line under the button: location
 * access is off (with the route to the OS setting), no fix yet, a Google key
 * that refuses Geocoding, or a fix that could not be turned into an address
 * — in which case the field shows the coordinates, which are real, rather
 * than an invented street.
 */

import { useCallback, useEffect, useRef } from 'react';
import { View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import {
  AddressAutocomplete,
  resolveMyLocation,
  type ResolvedLocation as AutocompleteResolvedLocation,
} from '@/components/AddressAutocomplete';
import { getPlaceDetails, type PlacePrediction } from '@/lib/services/places';
import { stateFromText } from '@/lib/services/serviceState';

/* ─────────────────────────── types ───────────────────────────────────── */

/**
 * A place with real coordinates. `source` says which service produced the
 * address: `places` (a picked prediction), `google` / `device` (a reverse
 * geocode of the fix), `coords` (a fix nobody could name — `address` is the
 * "lat, lng" string).
 */
export type ResolvedLocation = Omit<AutocompleteResolvedLocation, 'source'> & {
  source: 'places' | AutocompleteResolvedLocation['source'];
  placeId?: string;
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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onPlaceSelected = useCallback(
    async (p: PlacePrediction) => {
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

  const onLocationSelected = useCallback(
    (loc: AutocompleteResolvedLocation) => {
      onResolved?.(loc);
    },
    [onResolved],
  );

  return (
    <View style={style}>
      <AddressAutocomplete
        value={value}
        onChangeText={onChangeText}
        onPlaceSelected={onPlaceSelected}
        onLocationSelected={onLocationSelected}
        useMyLocation={useMyLocation}
        label={label}
        placeholder={placeholder}
        biasLat={biasLat}
        biasLng={biasLng}
        autoFocus={autoFocus}
        returnKeyType={returnKeyType}
      />
    </View>
  );
}

/* ─────────────────────────── device location ─────────────────────────── */

/**
 * Where the phone is, as an address — `resolveMyLocation()` mapped onto a
 * status-shaped result so screens can switch on it. Asks for foreground
 * permission if it has not been decided yet; never throws.
 */
export async function resolveDeviceLocation(): Promise<DeviceLocationResult> {
  const outcome = await resolveMyLocation();
  if (outcome.ok) {
    return {
      status: 'ok',
      addressKnown: outcome.location.source !== 'coords',
      location: outcome.location,
    };
  }
  switch (outcome.reason) {
    case 'permission':
      return { status: 'permission_denied', canAskAgain: outcome.canAskAgain };
    case 'no-fix':
      return { status: 'no_fix' };
    default:
      return { status: 'unsupported' };
  }
}
