import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';

/** The roof and lightning bolt from the app icon, drawn on the underlying surface. */
export function RoofWiseBrand({ inverse = false }: { inverse?: boolean }) {
  const ink = inverse ? colors.textInverse : colors.navy;
  return (
    <View accessible accessibilityLabel="RoofWise" style={styles.lockup}>
      <Svg width={36} height={24} viewBox="44 218 938 586" accessible={false}>
        <Path fill={ink} fillRule="evenodd" d="M49 695 502 231 Q512 222 523 232 L675 386 597 532 512 443 270 695 Z M512 254 A14 14 0 1 0 512 282 A14 14 0 1 0 512 254 Z" />
        <Path fill={ink} d="M769 481 977 695 752 695 687 628 Z" />
        <Path fill={colors.accent} d="M688 399 769 481 708 553 782 553 529 798 653 598 582 598 Z" />
      </Svg>
      <Text style={[styles.name, { color: ink }]}>RoofWise</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  name: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleMd, letterSpacing: -0.6 },
});
