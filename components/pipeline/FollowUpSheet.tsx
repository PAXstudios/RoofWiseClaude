import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type WhenOption = { label: string; days: number };

/** The follow-up cadence `lead/[id].tsx` and `new-lead.tsx` already offer. */
export const FOLLOW_UP_OPTIONS: WhenOption[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In 1 week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

/** Install lead times — a crew is booked in weeks, not days. */
export const INSTALL_OPTIONS: WhenOption[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In 1 week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
  { label: 'In 30 days', days: 30 },
];

type Props = {
  visible: boolean;
  title: string;
  /** Usually the customer's name. */
  subtitle?: string;
  options?: WhenOption[];
  icon?: IoniconName;
  tone?: ChipTone;
  /** Present → a "clear" row is offered and `onPick(null)` is possible. */
  clearLabel?: string;
  /** `null` means clear. */
  onPick: (when: Date | null) => void;
  onClose: () => void;
};

/**
 * "When?" as a bottom sheet of big rows — the glove-first date picker.
 *
 * A calendar grid is a precision gesture on a hot roof; the cadence chips
 * the lead screen already uses are the right control, so this is those
 * chips as a sheet any card can open. Same sheet language as the Leads
 * board's "Move to…" (grabber, ink title, 56pt rows, Cancel).
 */
export function FollowUpSheet({
  visible,
  title,
  subtitle,
  options = FOLLOW_UP_OPTIONS,
  icon = 'alarm-outline',
  tone = 'blue',
  clearLabel,
  onPick,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  const pick = (days: number) => {
    onPick(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <PressableScale
          pressedScale={1}
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <IconChip name={icon} tone={tone} size="sm" />
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {options.map((opt) => (
              <PressableScale
                key={opt.label}
                pressedScale={0.97}
                style={styles.row}
                onPress={() => pick(opt.days)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
                <Text style={styles.rowText}>{opt.label}</Text>
                <Text style={styles.rowDate}>
                  {new Date(Date.now() + opt.days * 24 * 60 * 60 * 1000).toLocaleDateString(
                    undefined,
                    { weekday: 'short', month: 'short', day: 'numeric' },
                  )}
                </Text>
              </PressableScale>
            ))}
            {clearLabel && (
              <PressableScale
                pressedScale={0.97}
                style={styles.row}
                onPress={() => onPick(null)}
                accessibilityRole="button"
                accessibilityLabel={clearLabel}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                <Text style={[styles.rowText, styles.rowTextDanger]}>{clearLabel}</Text>
              </PressableScale>
            )}
          </ScrollView>

          <PressableScale
            style={styles.cancel}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    maxHeight: '85%',
  },
  // iOS grabber: 36×5 pill in the hairline tone.
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.hairline,
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleBlock: { flex: 1 },
  title: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  scroll: { marginTop: spacing.md },
  scrollContent: { gap: spacing.sm, paddingBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.fillQuiet,
  },
  rowText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  rowTextDanger: { color: colors.danger },
  rowDate: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  cancel: {
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  cancelText: { color: colors.text, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
});
