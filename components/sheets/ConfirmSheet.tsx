// A destructive action's "are you sure?" — as the app's bottom sheet, never a
// system Alert (Drift #1: confirm sheets on destructive actions, with targets
// a gloved thumb can hit). Same Keep / Delete pair PhotoActionsSheet draws
// inside itself, lifted out so any screen can ask the question the same way.

import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  visible: boolean;
  /** "Delete this voice note?" */
  title: string;
  /** One or two lines on what is lost. */
  body?: string;
  /** Label of the action button. Default "Delete". */
  confirmLabel?: string;
  /** Label of the safe button. Default "Keep". */
  cancelLabel?: string;
  /** Paints the action button danger-red. Default true. */
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Keep',
  destructive = true,
  onConfirm,
  onClose,
}: Props) {
  const confirm = () => {
    onClose();
    // Let the sheet start its exit before the record disappears under it.
    setTimeout(onConfirm, 120);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} cancel={false} accessibilityLabel={title}>
      <View style={[styles.panel, destructive && styles.panelDanger]}>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        <View style={styles.row}>
          <PressableScale
            style={styles.btn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
          >
            <Text style={styles.keepText}>{cancelLabel}</Text>
          </PressableScale>
          <PressableScale
            style={[styles.btn, destructive ? styles.btnDanger : styles.btnPrimary]}
            onPress={confirm}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </PressableScale>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, padding: spacing.md, borderRadius: radii.card, backgroundColor: colors.fillQuiet },
  panelDanger: { backgroundColor: colors.dangerSoft },
  body: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20 },
  row: { flexDirection: 'row', gap: spacing.sm },
  // 56pt each (Drift #1).
  btn: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  btnDanger: { backgroundColor: colors.danger },
  btnPrimary: { backgroundColor: colors.brand },
  keepText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  confirmText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.textInverse },
});
