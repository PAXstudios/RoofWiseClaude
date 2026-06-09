import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  searchPlaces,
  type PlacePrediction,
  PlacesNotConfiguredError,
} from '@/lib/services/places';
import { getBiasCoordinate } from '@/lib/services/locationBias';
import { isGooglePlacesConfigured } from '@/lib/env';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onPlaceSelected?: (place: PlacePrediction) => void;
  label?: string;
  placeholder?: string;
  biasLat?: number;
  biasLng?: number;
} & Pick<TextInputProps, 'autoFocus' | 'returnKeyType'>;

export function AddressAutocomplete({
  value,
  onChangeText,
  onPlaceSelected,
  label,
  placeholder = '123 Main St, Plano TX',
  biasLat,
  biasLng,
  autoFocus,
  returnKeyType,
}: Props) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const out = await searchPlaces(value, {
          biasLat: effectiveBias.lat,
          biasLng: effectiveBias.lng,
        });
        setPredictions(out);
      } catch (e) {
        if (e instanceof PlacesNotConfiguredError) {
          setError('Places API key missing');
        } else {
          setError(e instanceof Error ? e.message.slice(0, 80) : 'Lookup failed');
        }
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, effectiveBias.lat, effectiveBias.lng]);

  const showDropdown = focused && (predictions.length > 0 || loading || error);

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
          {error ? (
            <View style={styles.dropdownEmpty}>
              <Ionicons name="warning-outline" size={18} color={colors.warn} />
              <Text style={styles.dropdownEmptyText}>{error}</Text>
            </View>
          ) : predictions.length === 0 ? (
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

      {!isGooglePlacesConfigured && (
        <Text style={styles.hint}>
          Add EXPO_PUBLIC_GOOGLE_PLACES_API_KEY to .env.local for address autocomplete.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.medium },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    color: colors.navy,
    paddingVertical: 4,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
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
  hint: { color: colors.slate, fontSize: fontSize.caption, fontStyle: 'italic' },
});
