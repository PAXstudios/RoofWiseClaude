// Which slope is this photo of? — the one question the app must never answer
// for the inspector by default.
//
// Every photo is filed under a slope, and per-slope hit counts are what HAAG
// §2/§4 decide replacement on. Filing a north-facing photo under South is not
// a display bug; it is corrupted evidence. This sheet exists so that choice is
// always explicit, large, and one tap — and so the same picker serves the
// camera, the job screen's library import, and any future capture path.

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/glass/GlassCard';
import type { SlopeOrientation } from '@/lib/models/types';
import { colors, fontSize, fontWeight, glass, radii, spacing, touchTarget } from '@/theme/tokens';

/** The eight compass slopes, laid out as a compass rose reads: row by row. */
const ROSE: SlopeOrientation[][] = [
  ['NW', 'N', 'NE'],
  ['W', 'Flat', 'E'],
  ['SW', 'S', 'SE'],
];

export type SlopePickerProps = {
  visible: boolean;
  /** Currently tagged slope, highlighted. */
  selected?: SlopeOrientation;
  /** The compass's read right now, when one exists — shown as a hint, never auto-applied here. */
  compassSuggestion?: SlopeOrientation | null;
  /** Photos already filed per slope on this job, so the roofer sees what is covered. */
  photoCounts?: Partial<Record<SlopeOrientation, number>>;
  title?: string;
  /** Explains WHY the sheet appeared — shutter mismatch, first shot without a compass, import. */
  reason?: string;
  onSelect: (slope: SlopeOrientation) => void;
  onCancel: () => void;
};

export function SlopePickerSheet({
  visible,
  selected,
  compassSuggestion,
  photoCounts,
  title = 'Which slope?',
  reason,
  onSelect,
  onCancel,
}: SlopePickerProps) {
  const insets = useSafeAreaInsets();

  const pick = (s: SlopeOrientation) => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(s);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Dismiss">
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          {/* Stop the scrim's dismiss from firing on taps inside the sheet. */}
          <Pressable onPress={() => {}}>
            <GlassCard level="high" radius={radii.xl} style={styles.sheet}>
              <View style={styles.header}>
                <Text style={styles.title}>{title}</Text>
                {!!reason && <Text style={styles.reason}>{reason}</Text>}
              </View>

              {compassSuggestion && compassSuggestion !== selected && (
                <Pressable
                  onPress={() => pick(compassSuggestion)}
                  style={({ pressed }) => [styles.suggest, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Use compass: ${compassSuggestion}`}
                >
                  <Ionicons name="compass" size={20} color={colors.text} />
                  <Text style={styles.suggestText}>
                    Compass says <Text style={styles.suggestStrong}>{compassSuggestion}</Text> — use it
                  </Text>
                </Pressable>
              )}

              <View style={styles.rose}>
                {ROSE.map((row, r) => (
                  <View key={r} style={styles.roseRow}>
                    {row.map((s) => {
                      const active = s === selected;
                      const n = photoCounts?.[s] ?? 0;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => pick(s)}
                          style={({ pressed }) => [
                            styles.cell,
                            active && styles.cellActive,
                            pressed && styles.pressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${s} slope${n ? `, ${n} photos so far` : ''}`}
                        >
                          <Text style={[styles.cellText, active && styles.cellTextActive]}>{s}</Text>
                          {n > 0 && (
                            <Text style={[styles.cellCount, active && styles.cellCountActive]}>
                              {n} photo{n === 1 ? '' : 's'}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>

              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </GlassCard>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.md },
  sheet: { padding: spacing.lg, gap: spacing.md },
  header: { gap: spacing.xs },
  title: { color: colors.textInverse, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold },
  reason: { color: colors.textInverse, opacity: 0.8, fontSize: fontSize.bodySm, lineHeight: 18 },
  suggest: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  suggestText: { color: colors.text, fontSize: fontSize.bodyMd, flexShrink: 1 },
  suggestStrong: { fontWeight: fontWeight.bold },
  rose: { gap: spacing.sm },
  roseRow: { flexDirection: 'row', gap: spacing.sm },
  // 64pt cells — the "preferred" target for a gloved thumb, and a compass rose
  // reads faster than a row of eight chips.
  cell: {
    flex: 1,
    minHeight: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cellActive: { backgroundColor: colors.surface },
  cellText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  cellTextActive: { color: colors.text },
  cellCount: { color: colors.textInverse, opacity: 0.7, fontSize: fontSize.caption },
  cellCountActive: { color: colors.textMuted, opacity: 1 },
  cancel: { minHeight: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  pressed: { opacity: 0.7 },
});
