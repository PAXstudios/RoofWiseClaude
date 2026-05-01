import { View, StyleSheet } from 'react-native';
import { Chip } from './Chip';
import { spacing } from '@/theme/tokens';

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  tone = 'brand',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  tone?: 'brand' | 'accent';
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={value === o.value}
          onPress={() => onChange(o.value)}
          tone={tone}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
});
