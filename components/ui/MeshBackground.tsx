// Keep this compatibility surface so existing screens retain their routes and data.
// The November mockup replaces the animated dark mesh with a light grouped ground.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';
export type MeshVariant = 'hero' | 'home' | 'cool' | 'night' | 'map';
export function MeshBackground({style}: {variant?: MeshVariant; grain?: boolean; style?: StyleProp<ViewStyle>}) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, style]}/>;
}
