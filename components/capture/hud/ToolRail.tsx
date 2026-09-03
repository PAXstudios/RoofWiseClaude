// The tool rail — a vertical column of round glass buttons on the right edge
// of the viewfinder (the Snapchat/Instagram pattern: tools live on a rail
// that collapses to one chevron). Part of the secondary chrome: `HudChrome`
// shows and hides it; this component only lays the tools out.
//
// Order is by how often a roofer reaches for it on a roof: torch, Live, the
// guides, the coach, then the library import, the pitch gauge, and settings.
// The rail scrolls when the screen is short (an SE fits five discs between
// the mode strip and the dock) — a coarse vertical drag, never a precision
// gesture. Every disc is 56pt with a 12pt gap (Drift #1).

import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from '@/theme/tokens';
import { HUD_GAP } from './glass';
import { RailButton } from './RailButton';

type Props = {
  torch: boolean;
  onTorch: () => void;

  live: boolean;
  /** False when the AI key is missing — the disc still explains itself. */
  liveAvailable: boolean;
  /** Live switched itself off with a reason (shown as a dot). */
  livePaused: boolean;
  onLive: () => void;

  guides: boolean;
  onGuides: () => void;

  coach: boolean;
  onCoach: () => void;

  importing: boolean;
  onImport: () => void;

  onPitchGauge: () => void;
  onSettings: () => void;

  /** Vertical room between the mode strip and the dock. */
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
};

export function ToolRail({
  torch,
  onTorch,
  live,
  liveAvailable,
  livePaused,
  onLive,
  guides,
  onGuides,
  coach,
  onCoach,
  importing,
  onImport,
  onPitchGauge,
  onSettings,
  maxHeight,
  style,
}: Props) {
  return (
    <ScrollView
      style={[styles.rail, maxHeight != null && { maxHeight }, style]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      // The ScrollView must own its touches to scroll — so a tap on a gap
      // between discs lands on the rail, not on the viewfinder toggle.
      accessibilityRole="toolbar"
      accessibilityLabel="Camera tools"
    >
      <RailButton
        icon={torch ? 'flashlight' : 'flashlight-outline'}
        caption="Torch"
        active={torch}
        onPress={onTorch}
        accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
      />
      <RailButton
        icon="scan-outline"
        caption="Live"
        active={live}
        dot={livePaused && !live}
        onPress={onLive}
        accessibilityLabel={
          !liveAvailable
            ? 'Live overlay. Needs the AI key — not set up on this build. Opens capture settings.'
            : live
            ? 'Turn Live overlay off'
            : livePaused
            ? 'Turn Live overlay on. It paused itself — the reason is in capture settings.'
            : 'Turn Live overlay on. The AI reads a frame every few seconds and draws what it sees.'
        }
      />
      <RailButton
        icon="grid-outline"
        caption="Level"
        active={guides}
        onPress={onGuides}
        accessibilityLabel={guides ? 'Hide the level bubble and thirds grid' : 'Show the level bubble and thirds grid'}
      />
      <RailButton
        icon="footsteps-outline"
        caption="Coach"
        active={coach}
        onPress={onCoach}
        accessibilityLabel={coach ? 'Turn guided capture off' : 'Turn guided capture on'}
      />
      <RailButton
        icon="images-outline"
        caption="Import"
        disabled={importing}
        onPress={onImport}
        accessibilityLabel="Import photos from library. Keep picking, then tap Cancel when done."
      />
      <RailButton
        icon="compass-outline"
        caption="Pitch"
        onPress={onPitchGauge}
        accessibilityLabel="Open pitch gauge"
      />
      <RailButton
        icon="settings-outline"
        caption="More"
        onPress={onSettings}
        accessibilityLabel="Capture settings"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { flexGrow: 0 },
  content: {
    gap: HUD_GAP,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
});
