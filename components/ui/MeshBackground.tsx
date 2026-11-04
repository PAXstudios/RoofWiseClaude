// Flat brand surfaces retain the existing variant API without decorative mesh.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';
export type MeshVariant = 'hero' | 'home' | 'cool' | 'night' | 'map';
const grounds: Record<MeshVariant, string> = {
  hero: colors.brandSoft,
  home: colors.headerBg,
  cool: colors.brandSoft,
  night: colors.headerBg,
  map: colors.bg,
};
export function MeshBackground({variant = 'cool', style}: {variant?: MeshVariant; grain?: boolean; style?: StyleProp<ViewStyle>}) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: grounds[variant] }, style]}/>;
}
