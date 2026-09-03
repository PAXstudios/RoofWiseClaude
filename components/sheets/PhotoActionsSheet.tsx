// Long-press a photo → this sheet, not a system Alert. The photo itself is
// at the top so the roofer sees what they are about to rotate or delete;
// Delete asks once more inside the sheet rather than firing on a mis-tap.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import type { IoniconName } from '@/components/ui/IconChip';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  visible: boolean;
  uri?: string;
  /** "Photo 3 of 16 · Front Slope" */
  caption?: string;
  onClose: () => void;
  onOpenReport: () => void;
  onRotate: () => void;
  onReanalyze?: () => void;
  onDelete: () => void;
};

export function PhotoActionsSheet({
  visible,
  uri,
  caption,
  onClose,
  onOpenReport,
  onRotate,
  onReanalyze,
  onDelete,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!visible) setConfirmDelete(false);
  }, [visible]);

  const run = (fn: () => void) => {
    onClose();
    setTimeout(fn, 120);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Photo actions">
      <View style={styles.preview}>
        {uri ? <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={120} /> : <View style={styles.thumb} />}
        <View style={styles.previewMain}>
          <Text style={styles.title}>Photo</Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
      </View>

      <Row icon="document-text-outline" label="Open damage report" onPress={() => run(onOpenReport)} />
      <Row icon="refresh-outline" label="Rotate 90°" onPress={() => run(onRotate)} />
      {onReanalyze && <Row icon="sparkles-outline" label="Re-analyze this photo" onPress={() => run(onReanalyze)} />}

      {confirmDelete ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmText}>Delete this photo and its findings? This cannot be undone.</Text>
          <View style={styles.confirmRow}>
            <PressableScale style={styles.confirmBtn} onPress={() => setConfirmDelete(false)} accessibilityRole="button">
              <Text style={styles.confirmKeep}>Keep</Text>
            </PressableScale>
            <PressableScale
              style={[styles.confirmBtn, styles.confirmDelete]}
              onPress={() => run(onDelete)}
              accessibilityRole="button"
              accessibilityLabel="Delete photo"
            >
              <Text style={styles.confirmDeleteText}>Delete</Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <Row icon="trash-outline" label="Delete photo" danger onPress={() => setConfirmDelete(true)} />
      )}
    </BottomSheet>
  );
}

function Row({ icon, label, danger, onPress }: { icon: IoniconName; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <PressableScale style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.rowText, danger && styles.rowDanger]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  previewMain: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.brand },
  caption: { fontSize: fontSize.bodySm, color: colors.textMuted },
  // 56pt rows (Drift #1).
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  rowText: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  rowDanger: { color: colors.danger },
  confirm: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.card, backgroundColor: colors.dangerSoft },
  confirmText: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20 },
  confirmRow: { flexDirection: 'row', gap: spacing.sm },
  confirmBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  confirmKeep: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  confirmDelete: { backgroundColor: colors.danger },
  confirmDeleteText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.textInverse },
});
