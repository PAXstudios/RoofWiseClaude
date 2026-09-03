import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import type { IoniconName } from '@/components/ui/IconChip';
import { colors, fontFamily, fontSize, fontWeight, glass, radii, spacing, touchTarget } from '@/theme/tokens';
import { openDirections, openMail, openPhone, openSms } from './contact';

type Props = {
  /** The customer's name, for the accessibility labels only. */
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  coords?: { lat?: number; lng?: number };
  /** Opens the follow-up sheet. Omit to hide the action. */
  onBook?: () => void;
  /** Label for the book action. Default "Book". */
  bookLabel?: string;
  /** Fired after a call or text is launched — lets the owner mark the lead contacted. */
  onContacted?: () => void;
  /**
   * `light` (default) sits on a white/paper card. `dark` sits on a solid
   * brand-ink ground (the Pipeline board's Signed cards, docs/DESIGN_1A.md
   * §6) — the glass-over-art pair from `theme/tokens.ts`, never a raw white.
   */
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
};

type Action = { key: string; icon: IoniconName; label: string; a11y: string; onPress: () => void };

/**
 * Call / Text / Email / Directions / Book — the one-tap row on every pipeline
 * card and at the top of a job.
 *
 * An action renders ONLY when its field exists: a "Call" button on a lead with
 * no phone is a dead button, and a gloved thumb learns not to trust the row.
 * Every target is a full 56pt tile (Drift #1) with 12pt between tiles.
 */
export function QuickActions({
  name,
  phone,
  email,
  address,
  coords,
  onBook,
  bookLabel = 'Book',
  onContacted,
  tone = 'light',
  style,
}: Props) {
  const dark = tone === 'dark';
  const actions: Action[] = [];
  const phoneTrim = phone?.trim();
  const emailTrim = email?.trim();
  const addressTrim = address?.trim();

  if (phoneTrim) {
    actions.push({
      key: 'call',
      icon: 'call-outline',
      label: 'Call',
      a11y: `Call ${name}`,
      onPress: () => {
        openPhone(phoneTrim);
        onContacted?.();
      },
    });
    actions.push({
      key: 'text',
      icon: 'chatbubble-outline',
      label: 'Text',
      a11y: `Text ${name}`,
      onPress: () => {
        openSms(phoneTrim);
        onContacted?.();
      },
    });
  }
  if (emailTrim) {
    actions.push({
      key: 'email',
      icon: 'mail-outline',
      label: 'Email',
      a11y: `Email ${name}`,
      onPress: () => openMail(emailTrim),
    });
  }
  if (addressTrim) {
    actions.push({
      key: 'directions',
      icon: 'navigate-outline',
      label: 'Directions',
      a11y: `Directions to ${addressTrim}`,
      onPress: () => openDirections(addressTrim, coords),
    });
  }
  if (onBook) {
    actions.push({
      key: 'book',
      icon: 'calendar-outline',
      label: bookLabel,
      a11y: `${bookLabel} for ${name}`,
      onPress: onBook,
    });
  }

  if (actions.length === 0) return null;

  return (
    <View style={[styles.row, style]}>
      {actions.map((a) => (
        <PressableScale
          key={a.key}
          pressedScale={0.95}
          style={[styles.action, dark && styles.actionDark]}
          accessibilityRole="button"
          accessibilityLabel={a.a11y}
          onPress={a.onPress}
        >
          <Ionicons name={a.icon} size={20} color={dark ? colors.onMesh : colors.text} />
          <Text style={[styles.label, dark && styles.labelDark]} numberOfLines={1}>
            {a.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  action: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: colors.fillQuiet,
  },
  // Glass-over-art pair (theme/tokens.ts `glass`) — never a flat white chip
  // laid over the mesh, so the tile still reads as glass rather than paper.
  actionDark: { backgroundColor: glass.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border },
  label: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  labelDark: { color: colors.onMesh },
});
