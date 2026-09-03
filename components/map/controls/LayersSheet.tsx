// Layers & filters — the one sheet behind the rail's layers button and the
// summary chip. Everything that used to be a row of chips floating over the
// map lives here in titled sections (Google Maps' layers sheet, done for a
// glove): choice grids, toggle rows, link rows, all ≥56pt.
//
// Generic on purpose: Storm Tracer and Knock mode describe their sections as
// data and this renders them, so the two screens' sheets are one component
// and move the same way (it is the app's BottomSheet underneath).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { colors, dataLabel, fontFamily, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type LayersOption = {
  id: string;
  label: string;
  icon?: IoniconName;
  /** Swatch drawn before the label (Knock mode's outcome colours). */
  color?: string;
  /** Spoken name when the label alone is terse ("All" → "Show every storm day"). */
  a11yLabel?: string;
};

export type LayersRow =
  | {
      kind: 'choice';
      key: string;
      options: LayersOption[];
      value: string;
      onChange: (id: string) => void;
      /** `wrap` (default) — chips in a wrapping grid; `list` — full-width rows with a check. */
      layout?: 'wrap' | 'list';
    }
  | {
      kind: 'toggle';
      key: string;
      label: string;
      hint?: string;
      icon?: IoniconName;
      value: boolean;
      onChange: (next: boolean) => void;
      /** Spoken names for each direction. Default "Turn on/off {label}". */
      a11yOn?: string;
      a11yOff?: string;
    }
  | {
      kind: 'link';
      key: string;
      label: string;
      hint?: string;
      icon?: IoniconName;
      onPress: () => void;
      a11yLabel?: string;
    }
  | { kind: 'custom'; key: string; node: ReactNode };

export type LayersSection = {
  key: string;
  title: string;
  hint?: string;
  rows: LayersRow[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  sections: LayersSection[];
  /** Shown as a quiet "Reset" beside Done when given. */
  onReset?: () => void;
  accessibilityLabel?: string;
};

export function LayersSheet({
  visible,
  onClose,
  title = 'Layers & filters',
  subtitle,
  sections,
  onReset,
  accessibilityLabel,
}: Props) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      cancel={false}
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {sections.map((section) => (
        <View key={section.key} style={styles.section} testID={`layers-section-${section.key}`}>
          <View style={styles.sectionHead}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {section.title}
            </Text>
            {section.hint ? <Text style={styles.sectionHint}>{section.hint}</Text> : null}
          </View>
          {section.rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </View>
      ))}
      <View style={styles.footer}>
        {onReset ? (
          <PressableScale
            style={styles.resetBtn}
            onPress={onReset}
            accessibilityRole="button"
            accessibilityLabel="Reset filters to their defaults"
          >
            <Text style={styles.resetText}>Reset</Text>
          </PressableScale>
        ) : null}
        <PressableScale
          style={styles.doneBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

function Row({ row }: { row: LayersRow }) {
  switch (row.kind) {
    case 'choice':
      return row.layout === 'list' ? <ChoiceList row={row} /> : <ChoiceWrap row={row} />;
    case 'toggle':
      return <ToggleRow row={row} />;
    case 'link':
      return <LinkRow row={row} />;
    case 'custom':
      return <>{row.node}</>;
  }
}

function ChoiceWrap({ row }: { row: Extract<LayersRow, { kind: 'choice' }> }) {
  return (
    <View style={styles.wrap}>
      {row.options.map((o) => {
        const active = o.id === row.value;
        return (
          <PressableScale
            key={o.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => row.onChange(o.id)}
            accessibilityRole="button"
            accessibilityLabel={o.a11yLabel ?? o.label}
            accessibilityState={{ selected: active }}
          >
            {o.color ? <View style={[styles.swatch, { backgroundColor: o.color }]} /> : null}
            {o.icon ? (
              <Ionicons name={o.icon} size={18} color={active ? colors.textInverse : colors.text} />
            ) : null}
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function ChoiceList({ row }: { row: Extract<LayersRow, { kind: 'choice' }> }) {
  return (
    <View style={styles.list}>
      {row.options.map((o, i) => {
        const active = o.id === row.value;
        return (
          <Pressable
            key={o.id}
            style={({ pressed }) => [styles.listRow, i > 0 && styles.listRowDivider, pressed && styles.rowPressed]}
            onPress={() => row.onChange(o.id)}
            accessibilityRole="button"
            accessibilityLabel={o.a11yLabel ?? o.label}
            accessibilityState={{ selected: active }}
          >
            {o.icon ? <Ionicons name={o.icon} size={20} color={active ? colors.brand : colors.textMuted} /> : null}
            <Text style={[styles.listText, active && styles.listTextActive]} numberOfLines={2}>
              {o.label}
            </Text>
            {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({ row }: { row: Extract<LayersRow, { kind: 'toggle' }> }) {
  const label = row.value ? row.a11yOff ?? `Turn off ${row.label}` : row.a11yOn ?? `Turn on ${row.label}`;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => row.onChange(!row.value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: row.value }}
    >
      {row.icon ? <IconChip name={row.icon} tone={row.value ? 'blue' : 'quiet'} size="sm" /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        {row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}
      </View>
      {/* Drawn switch: the ROW is the 56pt target, the track is a picture. */}
      <View style={[styles.track, row.value && styles.trackOn]} pointerEvents="none">
        <View style={[styles.thumb, row.value && styles.thumbOn]} />
      </View>
    </Pressable>
  );
}

function LinkRow({ row }: { row: Extract<LayersRow, { kind: 'link' }> }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={row.a11yLabel ?? row.label}
    >
      {row.icon ? <IconChip name={row.icon} tone="orange" size="sm" /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        {row.hint ? <Text style={styles.rowHint}>{row.hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionHead: { gap: 2 },
  // "SHOW ON THE MAP" / "TIME RANGE" — the mock's mono eyebrow convention.
  sectionTitle: { ...dataLabel, color: colors.textSubtle },
  sectionHint: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  chipActive: { backgroundColor: colors.brand },
  chipText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  chipTextActive: { color: colors.textInverse },
  swatch: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.surface },

  list: { borderRadius: radii.card, backgroundColor: colors.fillQuiet, overflow: 'hidden' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  listRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  listText: { flex: 1, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.text },
  listTextActive: { fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, color: colors.brand },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.fillQuiet,
  },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowHint: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },
  track: {
    width: 44,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
    padding: 2,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.brand },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface },
  thumbOn: { alignSelf: 'flex-end' },

  footer: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  resetBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  doneBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.textInverse },
});
