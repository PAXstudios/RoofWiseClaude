import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

export function IconTile({
  name,
  bg = colors.brandSoft,
  fg = colors.brand,
  size = 36,
  iconSize,
}: {
  name: IconName;
  bg?: string;
  fg?: string;
  size?: number;
  iconSize?: number;
}) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radii.md, backgroundColor: bg },
      ]}
    >
      <Ionicons name={name} size={iconSize ?? Math.round(size * 0.5)} color={fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
