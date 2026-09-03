// One knock on the map: a colour-coded disc with the outcome's glyph, the
// SalesRabbit-style "every house has a designation" pin. Tapping it opens the
// pin sheet directly — no callout to aim at first (Drift #1: one tap, no
// precision). The web map ignores children and draws its teardrop in
// `pinColor`, so the colour survives there too.

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapPin } from '@/components/map/Map';
import type { Knock } from '@/lib/models/types';
import { outcomeLabel } from '@/lib/services/knockOutcomes';
import { colors, shadows } from '@/theme/tokens';
import { outcomeColor, outcomeIcon } from './outcomeStyle';

type Props = {
  knock: Knock;
  selected?: boolean;
  /** An earlier session's knock — drawn smaller and lighter. */
  muted?: boolean;
  onPress: (knock: Knock) => void;
};

/**
 * iOS snapshots a custom marker view once when `tracksViewChanges` is false;
 * if that happens before layout the pin is blank. Track for a beat after
 * every visual change, then freeze — the usual react-native-maps pattern.
 */
const TRACK_MS = 600;

export function KnockPinMarker({ knock, selected = false, muted = false, onPress }: Props) {
  const color = outcomeColor(knock.outcome);
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(() => setTracking(false), TRACK_MS);
    return () => clearTimeout(t);
  }, [color, selected, muted]);

  const size = selected ? 36 : muted ? 22 : 28;
  return (
    <MapPin
      coordinate={{ latitude: knock.lat, longitude: knock.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 20 : muted ? 1 : 10}
      pinColor={color}
      tracksViewChanges={tracking}
      onPress={() => onPress(knock)}
      accessibilityLabel={`${outcomeLabel(knock.outcome)}${knock.address ? `, ${knock.address}` : ''}`}
    >
      <View
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          selected && styles.discSelected,
          muted && styles.discMuted,
        ]}
      >
        <Ionicons name={outcomeIcon(knock.outcome)} size={selected ? 18 : muted ? 11 : 14} color={colors.textInverse} />
      </View>
    </MapPin>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.float,
  },
  discSelected: { borderWidth: 3 },
  discMuted: { opacity: 0.75, borderWidth: 1.5 },
});
