// ⚙︎ Capture settings — the glass sheet behind the gear on the Quick
// Inspection camera. Four rows, every one of them ≥56pt for a gloved hand:
//
//   Live overlay      works now (Expo Go) — switch
//   AR damage markers needs the native build — honest explainer + "Notify me"
//   LiDAR measure     needs the native build — honest three-way device copy
//   Guides            works now — switch
//
// "Honest by construction": the two capabilities the runtime cannot deliver
// say so in plain words. No fake depth numbers, no fake AR anchors, no
// "coming soon" that pretends the button does something.

import { useEffect, useState, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { GlassCard } from '@/components/glass/GlassCard';
import type { IoniconName } from '@/components/ui/IconChip';
import { useCaptureSettingsStore } from '@/lib/stores/captureSettingsStore';
import { useCaptureChromeStore } from '@/lib/stores/captureChromeStore';
import { isGeminiConfigured } from '@/lib/env';
import {
  colors,
  fontSize,
  fontWeight,
  glass,
  hudMotion,
  motion,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

// ── LiDAR device check ─────────────────────────────────────────────────────
// expo-device is not a dependency of this app, so the check reads Apple's
// internal model identifier from expo-constants (`iPhone13,3` etc.) and maps
// it against the devices Apple ships a LiDAR scanner in. Identifiers newer
// than the table are reported as UNKNOWN, never guessed.

export type LidarCheck = {
  status: 'has' | 'none' | 'unknown' | 'android';
  /** Apple identifier when one was read, for the explainer's device line. */
  identifier?: string;
};

const LIDAR_IDENTIFIERS = new Set<string>([
  // iPhone 12 Pro / Pro Max … iPhone 16 Pro / Pro Max
  'iPhone13,3', 'iPhone13,4',
  'iPhone14,2', 'iPhone14,3',
  'iPhone15,2', 'iPhone15,3',
  'iPhone16,1', 'iPhone16,2',
  'iPhone17,1', 'iPhone17,2',
  // iPad Pro 2020 (11" / 12.9")
  'iPad8,9', 'iPad8,10', 'iPad8,11', 'iPad8,12',
  // iPad Pro 2021 (M1)
  'iPad13,4', 'iPad13,5', 'iPad13,6', 'iPad13,7',
  'iPad13,8', 'iPad13,9', 'iPad13,10', 'iPad13,11',
  // iPad Pro 2022 (M2)
  'iPad14,3', 'iPad14,4', 'iPad14,5', 'iPad14,6',
  // iPad Pro 2024 (M4)
  'iPad16,3', 'iPad16,4', 'iPad16,5', 'iPad16,6',
]);

/** Highest major number the table above covers per family. Anything newer
 *  is honestly "unknown" rather than assumed either way. */
const TABLE_COVERS_THROUGH: Record<string, number> = { iPhone: 17, iPad: 16 };

export function detectLidar(): LidarCheck {
  if (Platform.OS === 'android') return { status: 'android' };
  if (Platform.OS !== 'ios') return { status: 'unknown' };
  const id = Constants.platform?.ios?.platform;
  if (typeof id !== 'string' || id.length === 0) return { status: 'unknown' };
  const m = /^(iPhone|iPad)(\d+),(\d+)$/.exec(id);
  if (!m) return { status: 'unknown', identifier: id }; // simulator, Mac, unrecognised
  const family = m[1];
  const major = Number(m[2]);
  if (LIDAR_IDENTIFIERS.has(id)) return { status: 'has', identifier: id };
  if (major > (TABLE_COVERS_THROUGH[family] ?? 0)) return { status: 'unknown', identifier: id };
  return { status: 'none', identifier: id };
}

function lidarCopy(check: LidarCheck): { headline: string; body: string } {
  switch (check.status) {
    case 'has':
      return {
        headline: 'This device has a LiDAR sensor',
        body:
          'Measuring with it needs the full RoofWise app build. Expo Go — the test app you are running now — cannot reach the sensor, so RoofWise will not show a depth or distance number it did not actually measure.',
      };
    case 'none':
      return {
        headline: 'This device has no LiDAR sensor',
        body:
          'LiDAR measuring is only on iPhone Pro models (12 Pro and newer) and iPad Pro. On this device the tape measure and the pitch gauge are the honest tools.',
      };
    case 'android':
      return {
        headline: 'LiDAR is an iPhone and iPad sensor',
        body:
          'Android phones do not carry Apple’s LiDAR scanner. On this device the tape measure and the pitch gauge are the honest tools.',
      };
    default:
      return {
        headline: 'Can’t tell on this device',
        body:
          'RoofWise could not read a device model it recognises, so it will not guess whether a LiDAR sensor is there. Either way, measuring with it needs the full RoofWise app build.',
      };
  }
}

// ── Sheet ──────────────────────────────────────────────────────────────────

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Why the live overlay last switched itself off, if it did. */
  livePausedReason?: string | null;
};

type SheetView = 'main' | 'ar' | 'lidar';

export function CaptureSettingsSheet({ visible, onClose, livePausedReason }: Props) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<SheetView>('main');

  const liveOverlay = useCaptureSettingsStore((s) => s.liveOverlay);
  const guides = useCaptureSettingsStore((s) => s.guides);
  const arNotify = useCaptureSettingsStore((s) => s.arNotify);
  const lastLiveModel = useCaptureSettingsStore((s) => s.lastLiveModel);
  const setLiveOverlay = useCaptureSettingsStore((s) => s.setLiveOverlay);
  const setGuides = useCaptureSettingsStore((s) => s.setGuides);
  const setArNotify = useCaptureSettingsStore((s) => s.setArNotify);
  const coachEnabled = useCaptureSettingsStore((s) => s.coachEnabled);
  const setCoachEnabled = useCaptureSettingsStore((s) => s.setCoachEnabled);
  // Chrome preferences — the HUD's own store.
  const squareGuide = useCaptureChromeStore((s) => s.squareGuide);
  const setSquareGuide = useCaptureChromeStore((s) => s.setSquareGuide);
  const keepOpen = useCaptureChromeStore((s) => s.keepOpen);
  const setKeepOpen = useCaptureChromeStore((s) => s.setKeepOpen);
  const staticReason = useCaptureChromeStore((s) => s.staticReason);
  const setStaticReason = useCaptureChromeStore((s) => s.setStaticReason);

  // Always reopen on the main list, not on whichever explainer was last read.
  useEffect(() => {
    if (visible) setView('main');
  }, [visible]);

  const toggle = (setter: (v: boolean) => void, current: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setter(!current);
  };

  const lidar = detectLidar();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable
          style={styles.scrimTap}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close capture settings"
        />
        <GlassCard
          onArt
          radius={radii.xl}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          <View style={styles.grabber} />

          {view === 'main' && (
            <>
              <Text style={styles.title}>Capture settings</Text>
              <Text style={styles.subtitle}>
                What the camera shows you while you shoot. Photos and reports are unchanged.
              </Text>

              <SettingRow
                icon="footsteps-outline"
                title="Guided capture"
                subtitle={
                  coachEnabled
                    ? 'On · walks every slope, then gutters, siding, condenser, vents and flashing'
                    : 'Off · the step strip over the camera is hidden'
                }
                trailing={<SwitchVisual on={coachEnabled} />}
                onPress={() => toggle(setCoachEnabled, coachEnabled)}
                accessibilityState={{ checked: coachEnabled }}
              />
              <SettingRow
                icon="scan-outline"
                title="Live overlay"
                subtitle={
                  !isGeminiConfigured
                    ? 'Needs the AI key — this build has none, so nothing can be drawn.'
                    : liveOverlay
                    ? `On · ${lastLiveModel ?? 'connecting'} · the AI reads a frame every few seconds`
                    : livePausedReason
                    ? `Paused — ${livePausedReason}`
                    : 'Draws what the AI sees over the camera every few seconds. Uses data and battery.'
                }
                trailing={<SwitchVisual on={liveOverlay} />}
                onPress={() => toggle(setLiveOverlay, liveOverlay)}
                accessibilityState={{ checked: liveOverlay }}
              />
              <SettingRow
                icon="cube-outline"
                title="AR damage markers"
                subtitle="Pins markers to the roof in 3D. Needs the full app build."
                trailing={<Chevron badge="Full app" />}
                onPress={() => setView('ar')}
              />
              <SettingRow
                icon="resize-outline"
                title="LiDAR measure"
                subtitle={
                  lidar.status === 'has'
                    ? 'Your device has the sensor. Needs the full app build.'
                    : lidar.status === 'unknown'
                    ? 'Can’t tell on this device. Needs the full app build.'
                    : 'This device has no LiDAR sensor.'
                }
                trailing={<Chevron badge={lidar.status === 'has' || lidar.status === 'unknown' ? 'Full app' : 'No sensor'} />}
                onPress={() => setView('lidar')}
              />
              <SettingRow
                icon="grid-outline"
                title="Guides"
                subtitle="Level bubble and thirds grid over the viewfinder."
                trailing={<SwitchVisual on={guides} />}
                onPress={() => toggle(setGuides, guides)}
                accessibilityState={{ checked: guides }}
              />
              <SettingRow
                icon="scan-circle-outline"
                title="10×10 test-square guide"
                subtitle={
                  squareGuide
                    ? 'On · drawn in Test-square mode once Live overlay finds the shingle scale. An estimate, labelled as one.'
                    : 'Off · the dashed square and course lines stay hidden. Tap the Test-square chip twice to flip it while shooting.'
                }
                trailing={<SwitchVisual on={squareGuide} />}
                onPress={() => toggle(setSquareGuide, squareGuide)}
                accessibilityState={{ checked: squareGuide }}
              />
              <SettingRow
                icon="pin-outline"
                title="Keep controls open"
                subtitle={
                  keepOpen
                    ? 'On · the mode strip and tool rail stay until you tap the viewfinder.'
                    : `Off · controls tuck away after ${Math.round(hudMotion.idleCollapseMs / 1000)}s idle. Holding the chevron does the same.`
                }
                trailing={<SwitchVisual on={keepOpen} />}
                onPress={() => toggle(setKeepOpen, keepOpen)}
                accessibilityState={{ checked: keepOpen }}
                last={staticReason == null}
              />
              {staticReason != null && (
                <SettingRow
                  icon="shield-checkmark-outline"
                  title="Controls are static this session"
                  subtitle="RoofWise closed unexpectedly on the camera last time, so the chrome runs without animation for now. Turn it back on here."
                  trailing={<Chevron badge="Turn on" />}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setStaticReason(null);
                  }}
                  last
                />
              )}
            </>
          )}

          {view === 'ar' && (
            <Explainer title="AR damage markers" onBack={() => setView('main')}>
              <Text style={styles.body}>
                Anchored AR markers pin each hit to the shingle so it stays put while you move the
                phone. That needs Apple’s ARKit, which only runs in the full RoofWise app build —
                Expo Go, the test app you are using now, cannot load it.
              </Text>
              <Text style={styles.body}>
                Until then, <Text style={styles.bodyStrong}>Live overlay</Text> is the working
                version: the AI reads a frame every few seconds and draws boxes over the camera.
                Nothing in RoofWise will draw a marker it did not actually detect.
              </Text>
              <SettingRow
                icon="notifications-outline"
                title="Notify me when it’s ready"
                subtitle="Saved on this phone only."
                trailing={<SwitchVisual on={arNotify} />}
                onPress={() => toggle(setArNotify, arNotify)}
                accessibilityState={{ checked: arNotify }}
                last
              />
              {!liveOverlay && (
                <Pressable
                  style={styles.cta}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setLiveOverlay(true);
                    onClose();
                  }}
                  accessibilityRole="button"
                >
                  <Ionicons name="scan-outline" size={20} color={colors.textInverse} />
                  <Text style={styles.ctaText}>Turn on Live overlay instead</Text>
                </Pressable>
              )}
            </Explainer>
          )}

          {view === 'lidar' && (
            <Explainer title="LiDAR measure" onBack={() => setView('main')}>
              <Text style={styles.headline}>{lidarCopy(lidar).headline}</Text>
              <Text style={styles.body}>{lidarCopy(lidar).body}</Text>
              {lidar.identifier ? (
                <Text style={styles.deviceLine}>Device: {lidar.identifier}</Text>
              ) : null}
            </Explainer>
          )}

          <Pressable style={styles.doneBtn} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </GlassCard>
      </View>
    </Modal>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function SettingRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  accessibilityState,
  last,
}: {
  icon: IoniconName;
  title: string;
  subtitle: string;
  trailing: ReactNode;
  onPress: () => void;
  accessibilityState?: { checked?: boolean };
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={accessibilityState}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={22} color={colors.textInverse} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      {trailing}
    </Pressable>
  );
}

function Explainer({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <View>
      <View style={styles.explainerHeader}>
        <Pressable
          onPress={onBack}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to capture settings"
        >
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.explainerBody}>{children}</View>
    </View>
  );
}

function Chevron({ badge }: { badge: string }) {
  return (
    <View style={styles.chevronWrap}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{badge}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textInverse} />
    </View>
  );
}

const SWITCH_TRAVEL = 20;

/** Presentational switch — the ROW is the tap target (≥56pt), never this. */
function SwitchVisual({ on, style }: { on: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(on ? SWITCH_TRAVEL : 0);
  useEffect(() => {
    x.value = reduced ? (on ? SWITCH_TRAVEL : 0) : withSpring(on ? SWITCH_TRAVEL : 0, motion.snappy);
  }, [on, reduced, x]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={[styles.switchTrack, on && styles.switchTrackOn, style]}>
      <Animated.View style={[styles.switchThumb, thumbStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  scrimTap: { flex: 1 },
  sheet: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: glass.borderStrong,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textInverse,
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textInverse,
    opacity: 0.78,
    fontSize: fontSize.bodySm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.preferred,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border,
  },
  rowPressed: { opacity: 0.7 },
  rowIcon: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  rowSub: {
    color: colors.textInverse,
    opacity: 0.75,
    fontSize: fontSize.bodySm,
  },

  chevronWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.borderStrong,
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },

  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.success },
  switchThumb: {
    width: 27,
    height: 27,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },

  explainerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: -spacing.sm,
  },
  backBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerBody: { gap: spacing.md, paddingTop: spacing.sm },
  headline: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  body: {
    color: colors.textInverse,
    opacity: 0.9,
    fontSize: fontSize.bodyMd,
    lineHeight: fontSize.bodyMd * 1.45,
  },
  bodyStrong: { fontWeight: fontWeight.bold, opacity: 1 },
  deviceLine: {
    color: colors.textInverse,
    opacity: 0.6,
    fontSize: fontSize.caption,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.bold,
  },
  doneBtn: {
    marginTop: spacing.lg,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
});
