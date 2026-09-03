import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/PressableScale';
import { colors, glass, radii, touchTarget } from '@/theme/tokens';

type Props = {
  /** Render on the dark hero ground (Home) instead of the light grouped ground. */
  onDark?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The person-icon that opens Settings — the same affordance on every tab
 * root, so Settings is one tap away from anywhere (it used to be reachable
 * only from Home). Settings stays a route, never a tab (Drift #2).
 *
 * 56pt hit area around a 44pt fill, matching Home's header icon buttons.
 */
export function SettingsAffordance({ onDark = false, style }: Props) {
  const router = useRouter();
  return (
    <PressableScale
      style={[styles.hit, style]}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      onPress={() => router.push('/settings')}
    >
      <View style={[styles.fill, onDark ? styles.fillDark : styles.fillLight]}>
        <Ionicons
          name="person-circle-outline"
          size={24}
          color={onDark ? colors.textInverse : colors.text}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  fillLight: { backgroundColor: colors.fillQuiet, borderColor: colors.hairline },
  fillDark: { backgroundColor: glass.fillHigh, borderColor: glass.border },
});
