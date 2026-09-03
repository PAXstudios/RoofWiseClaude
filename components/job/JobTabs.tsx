// The job page's segmented control — Overview · Measure · Photos · Proposal
// (· Tasks, once the pipeline wave's TasksCard exists — see TasksTab.tsx).
//
// Sits BELOW the compact hero and OUTSIDE every tab's own ScrollView, so it
// reads as sticky chrome without any extra machinery: it simply never
// scrolls, because it isn't inside the thing that scrolls.

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fontSize, fontWeight, radii, shadows, touchTarget } from '@/theme/tokens';
import type { IoniconName } from '@/components/ui/IconChip';

/** Kept as a literal union (not derived from TAB_DEFS) so a screen can type
 *  its own tab state before this module's array shape is in scope. */
export type JobTabKey = 'overview' | 'measure' | 'photos' | 'proposal' | 'tasks';

export type JobTabDef = {
  key: JobTabKey;
  label: string;
  icon: IoniconName;
  /** Small count badge — omit or 0 for none. */
  badge?: number;
};

export const JOB_TAB_DEFS: readonly JobTabDef[] = [
  { key: 'overview', label: 'Overview', icon: 'grid-outline' },
  { key: 'measure', label: 'Measure', icon: 'scan-outline' },
  { key: 'photos', label: 'Photos', icon: 'images-outline' },
  { key: 'proposal', label: 'Proposal', icon: 'document-attach-outline' },
  { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline' },
] as const;

type Props = {
  /** Which tabs to show, in order — the parent screen decides (Tasks is
   *  dropped until its module exists). */
  tabs: readonly JobTabDef[];
  active: JobTabKey;
  onChange: (key: JobTabKey) => void;
  style?: StyleProp<ViewStyle>;
};

export function JobTabs({ tabs, active, onChange, style }: Props) {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.segment,
              isActive && styles.segmentActive,
              pressed && !isActive && styles.segmentPressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.badge ? `${tab.label}, ${tab.badge}` : tab.label}
          >
            <View style={styles.labelRow}>
              <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1} allowFontScaling={false}>
                {tab.label}
              </Text>
              {!!tab.badge && (
                <View style={[styles.badge, isActive && styles.badgeActive]}>
                  <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// No leading icon: at 5 segments on a 390pt phone there isn't room for both
// an icon and a readable label — the wave brief's own reference screenshots
// (JobNimbus/RoofBid) run this exact segmented control as text-only. A
// clipped "Over…" reads worse in sun than a plain word.
const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.button,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button - 3,
    paddingHorizontal: 2,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  segmentPressed: { opacity: 0.6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
  },
  labelActive: { color: colors.brand },
  badge: {
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  badgeActive: { backgroundColor: colors.brandSoft },
  badgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  badgeTextActive: { color: colors.brand },
});
