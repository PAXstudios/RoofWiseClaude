import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { Avatar } from '@/components/ui/Avatar';
import { leads } from '@/lib/mock/leads';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

const stageTone: Record<string, PillTone> = {
  New: 'brand',
  Contacted: 'accent',
  Proposal: 'success',
  Won: 'success',
  Lost: 'danger',
};

export default function LeadsScreen() {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 96 }}
    >
      <Text style={styles.title}>Leads</Text>
      <Text style={styles.sub}>{leads.length} active records</Text>
      {leads.map((l) => (
        <Card key={l.id} style={styles.row}>
          <Avatar name={l.name} size={42} />
          <View style={{ flex: 1 }}>
            <View style={styles.rowHead}>
              <Text style={styles.name}>{l.name}</Text>
              <Pill label={l.stage} tone={stageTone[l.stage]} />
            </View>
            <Text style={styles.address}>{l.address}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.value}>${l.value.toLocaleString()}</Text>
              {l.storm && (
                <Pill
                  label={l.storm === 'hail' ? 'Hail-impacted' : 'Wind-impacted'}
                  tone={l.storm === 'hail' ? 'info' : 'accent'}
                />
              )}
            </View>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  name: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  address: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 6,
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
