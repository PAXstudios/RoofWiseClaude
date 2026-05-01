import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { aiReviewQueue } from '@/lib/mock/aiInsights';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function AiInsightsQueue() {
  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader title="AI Insights & Training" action="Review queue" />
      </View>
      <View style={styles.list}>
        {aiReviewQueue.map((it) => {
          const conf = Math.round(it.confidence * 100);
          const lowConf = it.confidence < 0.65;
          return (
            <Card key={it.id} style={styles.row}>
              <Image source={{ uri: it.thumbnail }} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <View style={styles.headRow}>
                  <Text style={styles.property}>{it.property}</Text>
                  <Text style={styles.raised}>{it.raisedAt}</Text>
                </View>
                <Text style={styles.flag}>{it.flag}</Text>
                <View style={styles.metaRow}>
                  <View style={[styles.confPill, { backgroundColor: lowConf ? colors.warnSoft : colors.successSoft }]}>
                    <Ionicons
                      name="sparkles"
                      size={11}
                      color={lowConf ? '#9A7100' : '#1F8F5E'}
                    />
                    <Text
                      style={[
                        styles.confLabel,
                        { color: lowConf ? '#9A7100' : '#1F8F5E' },
                      ]}
                    >
                      {conf}% confidence
                    </Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable style={[styles.actionBtn, styles.actionGhost]}>
                      <Text style={styles.actionGhostLabel}>Reject</Text>
                    </Pressable>
                    <Pressable style={[styles.actionBtn, styles.actionPrimary]}>
                      <Text style={styles.actionPrimaryLabel}>Approve</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Card>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  property: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  raised: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
  },
  flag: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  confLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  actionGhost: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionGhostLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  actionPrimary: {
    backgroundColor: colors.text,
  },
  actionPrimaryLabel: {
    fontSize: fontSize.xs,
    color: colors.textInverse,
    fontWeight: fontWeight.semibold,
  },
});
