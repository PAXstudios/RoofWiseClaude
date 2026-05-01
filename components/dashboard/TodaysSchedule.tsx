import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Avatar } from '@/components/ui/Avatar';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { schedule } from '@/lib/mock/schedule';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function TodaysSchedule() {
  const [view, setView] = useState<'list' | 'map'>('list');

  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader
          title="Today's Schedule"
          right={
            <ChipGroup<'list' | 'map'>
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: 'List' },
                { value: 'map', label: 'Map' },
              ]}
            />
          }
        />
      </View>

      <View style={styles.list}>
        {schedule.map((item, idx) => {
          const last = idx === schedule.length - 1;
          return (
            <View key={item.id} style={styles.row}>
              <View style={styles.timeCol}>
                <Text style={styles.time}>{item.time}</Text>
                <Text style={styles.meridiem}>{item.meridiem}</Text>
                <View
                  style={[
                    styles.dot,
                    item.active && { backgroundColor: colors.brand, borderColor: colors.brandSoft },
                  ]}
                />
                {!last && <View style={styles.line} />}
              </View>
              <Card
                style={[styles.card, item.active && styles.cardActive]}
                elevated={item.active}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.priority && (
                    <Pill
                      label={item.priority}
                      tone={
                        item.priority === 'High Priority'
                          ? 'brand'
                          : item.priority === 'Follow-up'
                          ? 'accent'
                          : 'neutral'
                      }
                    />
                  )}
                </View>
                <View style={styles.addressRow}>
                  <Ionicons name="location-outline" size={14} color={colors.textMuted} />
                  <Text style={styles.address}>{item.address}</Text>
                </View>
                <View style={styles.contactRow}>
                  <View style={styles.contactLeft}>
                    <Avatar
                      name={item.contactName}
                      size={26}
                      tone={item.active ? colors.accentSoft : colors.surfaceMuted}
                    />
                    <Text style={styles.contactName}>{item.contactName}</Text>
                  </View>
                  <Pressable style={styles.callBtn}>
                    <Ionicons name="call-outline" size={16} color={colors.success} />
                  </Pressable>
                </View>
              </Card>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md },
  timeCol: { width: 56, alignItems: 'center', paddingTop: 6 },
  time: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  meridiem: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.border,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  card: { flex: 1 },
  cardActive: {
    borderColor: colors.brand,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: spacing.md,
  },
  address: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contactLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  contactName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  callBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
