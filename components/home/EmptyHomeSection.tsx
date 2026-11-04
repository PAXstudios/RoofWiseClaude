import { StyleSheet, Text, View } from 'react-native';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, fontFamily, fontSize, radii, spacing } from '@/theme/tokens';

type Props = {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyHomeSection({ title, message, action }: Props) {
  return (
    <View>
      <SectionHeader title={title} action={action} style={styles.header} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.sm },
  message: {
    overflow: 'hidden',
    borderRadius: radii.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    padding: spacing.lg,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodySm,
  },
});
