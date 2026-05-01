import { View, ViewProps, StyleSheet } from 'react-native';
import { colors, radii, shadows, spacing } from '@/theme/tokens';

type Props = ViewProps & {
  padded?: boolean;
  elevated?: boolean;
};

export function Card({ style, padded = true, elevated = true, ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        padded && styles.padded,
        elevated && shadows.card,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  padded: {
    padding: spacing.lg,
  },
});
