// The 1A mesh gradient — the redesign's one signature background, drawn once
// and reused everywhere a hero/header needs it. docs/DESIGN_1A.md §2.
//
// Every screen with a coloured hero (Home, Job, Lead, Pipeline, onboarding,
// the storm map) mounts this instead of a bespoke gradient, so the exact
// angle/stop combination — and the grain overlay that makes it read as
// "colour fields with texture" rather than a flat CSS gradient — never
// drifts screen to screen.

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { gradients } from '@/theme/tokens';

export type MeshVariant = 'hero' | 'home' | 'cool' | 'night' | 'map';

const VARIANT_COLORS: Record<MeshVariant, readonly string[]> = {
  hero: gradients.meshHero,
  home: gradients.meshHome,
  cool: gradients.meshCool,
  night: gradients.meshNight,
  map: gradients.meshMap,
};

// Angle per variant, expressed as LinearGradient start/end (RN has no CSS
// `deg` prop). Matches the mock's observed angles closely enough that the
// stop sequence reads the same; exactness of the angle matters far less than
// the colour ramp itself.
const VARIANT_POINTS: Record<MeshVariant, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
  hero: { start: { x: 0, y: 0 }, end: { x: 0.85, y: 1 } },   // ~115deg
  home: { start: { x: 0.1, y: 0 }, end: { x: 0.9, y: 1 } },  // ~150deg
  cool: { start: { x: 0, y: 0 }, end: { x: 1, y: 0.8 } },    // ~135deg
  night: { start: { x: 0, y: 0 }, end: { x: 0.9, y: 0.9 } }, // ~140deg
  map: { start: { x: 0.2, y: 0 }, end: { x: 0.8, y: 1 } },   // ~160deg
};

// Grain sits low, only in the colour fields — the mock's own words. .16–.26
// across screens; this is the house default (docs/DESIGN_1A.md §1).
const GRAIN_OPACITY = 0.2;

export function MeshBackground({
  variant = 'home',
  grain = true,
  style,
}: {
  variant?: MeshVariant;
  /** Screens with a lot of fine text over the mesh (dense cards) can turn the grain off. */
  grain?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { start, end } = VARIANT_POINTS[variant];
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <LinearGradient
        colors={VARIANT_COLORS[variant] as [string, string, ...string[]]}
        start={start}
        end={end}
        style={StyleSheet.absoluteFill}
      />
      {grain ? (
        <Image
          source={require('@/assets/textures/grain.png')}
          style={[StyleSheet.absoluteFill, { opacity: GRAIN_OPACITY }]}
          contentFit="cover"
          // A tiled repeat would need a native pattern; a single soft-scaled
          // cover reads the same as the mock's 160px tile at typical hero
          // sizes and avoids a platform-specific tiling implementation.
        />
      ) : null}
    </View>
  );
}
