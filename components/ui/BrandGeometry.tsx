import { StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { brand, colors } from "@/theme/tokens";

/** Courtside's roof-like cuts. Decorative only; never evidence or data. */
export function BrandGeometry({ muted = false }: { muted?: boolean }) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      style={s.art}
    >
      <Svg width="100%" height="100%" viewBox="0 0 120 180">
        <Polygon
          points="120,0 120,66 13,124"
          fill={muted ? colors.brandSoft : brand.royal}
        />
        <Polygon
          points="120,79 120,180 25,180 58,146 32,132"
          fill={muted ? colors.accentSoft : brand.burntLight}
        />
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  art: { position: "absolute", right: 0, top: 0, width: 100, height: 154 },
});
