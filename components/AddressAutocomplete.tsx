import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  searchPlaces,
  type PlacePrediction,
  PlacesNotConfiguredError,
} from '@/lib/services/places';
import { reverseGeocode } from '@/lib/services/geocoding';
import {
  describeGoogleApiError,
  isGoogleApiError,
  isGoogleKeyProblem,
} from '@/lib/services/googleApi';
import { getBiasCoordinate } from '@/lib/services/locationBias';
import { isGooglePlacesConfigured } from '@/lib/env';
import { PressableScale } from '@/components/PressableScale';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

// -----------------------------------------------------------------------------
// "Use my location" — shared by every address field
//
// Foreground permission → one GPS fix → reverse geocode (Google first, the
// phone's own geocoder second) → fill the field. Each leg that can fail has
// an honest state; nothing here invents an address (Drift #5). Exported so
// screens with a plain TextInput (Service Area) get the same button without
// adopting Places autocomplete.
//
// NOTE: the weather-page builder owns `components/LocationField.tsx`. It did
// not exist when this was written, so this file stays self-contained; when it
// lands, `UseMyLocationButton` can delegate to it.
// -----------------------------------------------------------------------------

export type ResolvedLocation = {
  lat: number;
  lng: number;
  /** Street address when a geocoder found one; otherwise "lat, lng". */
  address: string;
  /** Where the address text came from. `coords` = no geocoder answered. */
  source: 'google' | 'device' | 'coords';
  city?: string;
  stateCode?: string;
  postalCode?: string;
  /** A line worth showing under the field — e.g. that Google lookup is off for this key. */
  note?: string;
};

export type LocateFailure = {
  ok: false;
  reason: 'permission' | 'no-fix' | 'unavailable';
  /** Permission only: the OS will still show the prompt. */
  canAskAgain: boolean;
  message: string;
};

export type LocateOutcome = { ok: true; location: ResolvedLocation } | LocateFailure;

const FIX_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Compose a one-line address from the phone's own geocoder result. */
function deviceAddress(a: Location.LocationGeocodedAddress): {
  address: string;
  city?: string;
  stateCode?: string;
  postalCode?: string;
} | null {
  const street = [a.streetNumber, a.street].filter(Boolean).join(' ').trim();
  const cityLine = [a.city, [a.region, a.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const address = a.formattedAddress?.trim() || [street, cityLine].filter(Boolean).join(', ');
  if (!address) return null;
  return {
    address,
    city: a.city ?? undefined,
    stateCode: a.region && a.region.length === 2 ? a.region : undefined,
    postalCode: a.postalCode ?? undefined,
  };
}

/**
 * Where the phone is right now, as an address. Never throws — every failure
 * is a typed outcome with copy a roofer can act on.
 */
export async function resolveMyLocation(): Promise<LocateOutcome> {
  // 1. Permission — ask once, then be honest.
  let canAskAgain = true;
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    canAskAgain = perm.canAskAgain !== false;
    if (perm.status !== 'granted') {
      return {
        ok: false,
        reason: 'permission',
        canAskAgain,
        message: canAskAgain
          ? 'Location is off for RoofWise. Allow it to use your position.'
          : 'Location is off for RoofWise. Turn it on in Settings to use your position.',
      };
    }
  } catch {
    return {
      ok: false,
      reason: 'unavailable',
      canAskAgain,
      message: 'Location isn\'t available on this device.',
    };
  }

  // 2. A fix — fresh first, last-known as the fallback, never a made-up one.
  let coord: { lat: number; lng: number } | null = null;
  try {
    const pos = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      FIX_TIMEOUT_MS,
    );
    coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    try {
      const last = await Location.getLastKnownPositionAsync({});
      if (last) coord = { lat: last.coords.latitude, lng: last.coords.longitude };
    } catch {
      coord = null;
    }
  }
  if (!coord) {
    return {
      ok: false,
      reason: 'no-fix',
      canAskAgain,
      message: 'Couldn\'t get a GPS fix. Step outside or wait a moment, then try again.',
    };
  }

  // 3. Address — Google's geocoder, then the phone's, then honest coordinates.
  let note: string | undefined;
  try {
    const g = await reverseGeocode(coord);
    if (g && g.formattedAddress) {
      return {
        ok: true,
        location: {
          lat: coord.lat,
          lng: coord.lng,
          address: g.formattedAddress,
          source: 'google',
          city: g.city,
          stateCode: g.stateCode,
          postalCode: g.postalCode,
        },
      };
    }
  } catch (e) {
    // The owner asked to be TOLD when the key is the problem. A network blip
    // is not worth a line when the phone's own geocoder is about to answer.
    if (isGoogleKeyProblem(e)) note = describeGoogleApiError(e) ?? undefined;
  }

  try {
    if (Platform.OS !== 'web') {
      const results = await Location.reverseGeocodeAsync({
        latitude: coord.lat,
        longitude: coord.lng,
      });
      const first = results.map(deviceAddress).find((r) => r !== null);
      if (first) {
        return {
          ok: true,
          location: { lat: coord.lat, lng: coord.lng, source: 'device', ...first, note },
        };
      }
    }
  } catch {
    // fall through to coordinates
  }

  return {
    ok: true,
    location: {
      lat: coord.lat,
      lng: coord.lng,
      address: `${coord.lat.toFixed(5)}, ${coord.lng.toFixed(5)}`,
      source: 'coords',
      note: note
        ? `${note} Your position was saved as coordinates.`
        : 'Couldn\'t find a street address here — your position was saved as coordinates.',
    },
  };
}

type UseMyLocationButtonProps = {
  onResolved: (location: ResolvedLocation) => void;
  /** Default "Use my location". */
  label?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The ≥56pt "Use my location" control plus its own status line. Drop it under
 * any address input; the parent decides what to do with the result.
 */
export function UseMyLocationButton({ onResolved, label = 'Use my location', style }: UseMyLocationButtonProps) {
  const [locating, setLocating] = useState(false);
  const [failure, setFailure] = useState<LocateFailure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const locate = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    setFailure(null);
    setNote(null);
    const outcome = await resolveMyLocation();
    if (!mounted.current) return;
    setLocating(false);
    if (outcome.ok) {
      setNote(outcome.location.note ?? null);
      onResolved(outcome.location);
    } else {
      setFailure(outcome);
    }
  }, [locating, onResolved]);

  const openSettings = useCallback(() => {
    if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
      Linking.openSettings().catch(() => {});
    }
  }, []);

  const showOpenSettings =
    failure?.reason === 'permission' && !failure.canAskAgain && Platform.OS !== 'web';

  return (
    <View style={[styles.locateWrap, style]}>
      <PressableScale
        style={[styles.locateBtn, locating && styles.locateBtnBusy]}
        onPress={locate}
        disabled={locating}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: locating }}
      >
        {locating ? (
          <ActivityIndicator color={brand.royalDeep} />
        ) : (
          <Ionicons name="navigate" size={20} color={brand.royalDeep} />
        )}
        <Text style={styles.locateText}>{locating ? 'Finding your location…' : label}</Text>
      </PressableScale>

      {failure ? (
        <View style={styles.notice}>
          <Ionicons name="warning-outline" size={18} color={colors.warn} />
          <Text style={styles.noticeText}>{failure.message}</Text>
        </View>
      ) : null}
      {showOpenSettings ? (
        <PressableScale
          style={styles.settingsBtn}
          onPress={openSettings}
          accessibilityRole="button"
          accessibilityLabel="Open Settings to allow location"
        >
          <Ionicons name="settings-outline" size={18} color={colors.navy} />
          <Text style={styles.settingsBtnText}>Open Settings</Text>
        </PressableScale>
      ) : null}
      {note ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.slate} />
          <Text style={styles.noticeText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Address autocomplete
// -----------------------------------------------------------------------------

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onPlaceSelected?: (place: PlacePrediction) => void;
  /**
   * "Use my location" resolved. The address text has already been pushed
   * through `onChangeText`; use this for lat/lng.
   */
  onLocationSelected?: (location: ResolvedLocation) => void;
  /** Show the "Use my location" button. Default true. */
  useMyLocation?: boolean;
  label?: string;
  placeholder?: string;
  biasLat?: number;
  biasLng?: number;
} & Pick<TextInputProps, 'autoFocus' | 'returnKeyType'>;

type FieldError = { text: string; keyProblem: boolean };

export function AddressAutocomplete({
  value,
  onChangeText,
  onPlaceSelected,
  onLocationSelected,
  useMyLocation = true,
  label,
  placeholder = '123 Main St, Plano TX',
  biasLat,
  biasLng,
  autoFocus,
  returnKeyType,
}: Props) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [focused, setFocused] = useState(false);
  const [autoBias, setAutoBias] = useState<{ lat: number; lng: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<string | null>(null);

  // Fire-and-forget: warm up a current-location bias on mount.
  useEffect(() => {
    let cancelled = false;
    if (biasLat === undefined && biasLng === undefined) {
      getBiasCoordinate().then((c) => {
        if (!cancelled && c) setAutoBias(c);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [biasLat, biasLng]);

  const effectiveBias = useMemo(
    () => ({
      lat: biasLat ?? autoBias?.lat,
      lng: biasLng ?? autoBias?.lng,
    }),
    [biasLat, biasLng, autoBias],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value === selectedRef.current) {
      // User accepted a suggestion — don't immediately re-query for the same string.
      return;
    }
    if (value.trim().length < 3) {
      setPredictions([]);
      return;
    }
    if (!isGooglePlacesConfigured) {
      // The not-configured line is rendered statically below; no request to make.
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const out = await searchPlaces(value, {
          biasLat: effectiveBias.lat,
          biasLng: effectiveBias.lng,
        });
        setPredictions(out);
        setError(null);
      } catch (e) {
        // A refused key is remembered by the service, so this lands without a
        // network round-trip on every keystroke after the first.
        const copy = describeGoogleApiError(e);
        setError({
          text: copy ?? (e instanceof Error ? e.message.slice(0, 120) : 'Address search didn\'t work.'),
          keyProblem: isGoogleApiError(e) && isGoogleKeyProblem(e),
        });
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, effectiveBias.lat, effectiveBias.lng]);

  const onLocation = useCallback(
    (loc: ResolvedLocation) => {
      selectedRef.current = loc.address;
      setPredictions([]);
      setFocused(false);
      onChangeText(loc.address);
      onLocationSelected?.(loc);
    },
    [onChangeText, onLocationSelected],
  );

  const showDropdown = focused && !error && (predictions.length > 0 || loading);
  const notConfiguredCopy = !isGooglePlacesConfigured
    ? describeGoogleApiError(new PlacesNotConfiguredError())
    : null;

  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        <Ionicons name="location-outline" size={20} color={colors.slate} />
        <TextInput
          value={value}
          onChangeText={(t) => {
            selectedRef.current = null;
            onChangeText(t);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType={returnKeyType}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          multiline
        />
        {loading && <ActivityIndicator color={colors.slate} />}
      </View>

      {showDropdown && (
        <View style={styles.dropdown}>
          {predictions.length === 0 ? (
            <View style={styles.dropdownEmpty}>
              <Ionicons name="search-outline" size={18} color={colors.slate} />
              <Text style={styles.dropdownEmptyText}>Keep typing…</Text>
            </View>
          ) : (
            predictions.map((p, i) => (
              <Pressable
                key={p.placeId || `${p.description}-${i}`}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => {
                  selectedRef.current = p.description;
                  onChangeText(p.description);
                  setPredictions([]);
                  setFocused(false);
                  onPlaceSelected?.(p);
                }}
              >
                <Ionicons name="navigate-outline" size={18} color={colors.orange} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primary} numberOfLines={1}>
                    {p.primaryText}
                  </Text>
                  {p.secondaryText && p.secondaryText !== p.primaryText && (
                    <Text style={styles.secondary} numberOfLines={1}>
                      {p.secondaryText}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* Inline, not focus-gated: a refused key must be SAID, not hidden in an
          empty dropdown. Typing by hand keeps working either way. */}
      {error ? (
        <View style={[styles.notice, error.keyProblem && styles.noticeWarn]}>
          <Ionicons name="warning-outline" size={18} color={colors.warn} />
          <Text style={styles.noticeText}>
            {error.text}
            {error.keyProblem ? ' You can still type the address by hand.' : ''}
          </Text>
        </View>
      ) : notConfiguredCopy ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.slate} />
          <Text style={styles.noticeText}>{notConfiguredCopy}</Text>
        </View>
      ) : null}

      {useMyLocation ? <UseMyLocationButton onResolved={onLocation} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    color: colors.text,
    paddingVertical: 4,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  primary: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  secondary: { fontSize: fontSize.bodySm, color: colors.slate },
  dropdownEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  dropdownEmptyText: { color: colors.slate, fontSize: fontSize.bodySm },

  // Status lines — sun-readable, never a whisper of italic caption.
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.xs,
  },
  noticeWarn: { backgroundColor: colors.warnSoft },
  noticeText: { flex: 1, color: colors.text, fontSize: fontSize.bodySm, lineHeight: 18 },

  // "Use my location" — a real 56pt control, not a caption-sized link.
  locateWrap: { gap: spacing.xs, marginTop: spacing.xs },
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.control,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.lg,
  },
  locateBtnBusy: { opacity: 0.7 },
  locateText: { color: brand.royalDeep, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  settingsBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
