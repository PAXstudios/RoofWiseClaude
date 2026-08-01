import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import type { LeadStage } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STAGES: { id: LeadStage | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'inspection_scheduled', label: 'Scheduled' },
  { id: 'inspected', label: 'Inspected' },
  { id: 'proposal_sent', label: 'Proposal' },
  { id: 'signed', label: 'Signed' },
];

export default function LeadsScreen() {
  const router = useRouter();
  const leads = useLeadStore((s) => s.leads);
  const setStageOnLead = useLeadStore((s) => s.setStage);
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('all');

  const convertToInspection = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    setPrefill({
      source: 'lead',
      sourceId: lead.id,
      customerName: lead.customerName,
      customerPhone: lead.customerPhone,
      customerEmail: lead.customerEmail,
      address: lead.address,
      addressLat: lead.lat,
      addressLng: lead.lng,
    });
    setStageOnLead(lead.id, 'inspection_scheduled');
    router.push('/new-job');
  };

  const filtered = useMemo(
    () => (stage === 'all' ? leads : leads.filter((l) => l.stage === stage)),
    [leads, stage],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Leads"
        subtitle={`${leads.length} total`}
        right={
          <PressableScale
            style={styles.fab}
            pressedScale={0.92}
            onPress={() => router.push('/new-lead')}
            hitSlop={8}
          >
            <Ionicons name="add" size={24} color={colors.textInverse} />
          </PressableScale>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {STAGES.map((s) => (
          <PressableScale
            key={s.id}
            pressedScale={0.94}
            style={[styles.chip, stage === s.id && styles.chipActive]}
            onPress={() => setStage(s.id)}
          >
            <Text style={[styles.chipText, stage === s.id && styles.chipTextActive]}>
              {s.label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.length === 0 ? (
          <FadeSlideIn style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={colors.slate} />
            <Text style={styles.emptyTitle}>
              {leads.length === 0 ? 'No leads yet' : 'No leads in this stage'}
            </Text>
            <Text style={styles.emptyBody}>
              {leads.length === 0
                ? 'Leads from door knocks, inspections, or manual entry will appear here.'
                : 'Try a different stage filter.'}
            </Text>
            {leads.length === 0 && (
              <PressableScale style={styles.cta} onPress={() => router.push('/new-job')}>
                <Text style={styles.ctaText}>Start a new job</Text>
              </PressableScale>
            )}
          </FadeSlideIn>
        ) : (
          filtered.map((lead, i) => (
            <FadeSlideIn key={lead.id} index={Math.min(i, 8)}>
              <PressableScale
                style={styles.leadCard}
                onPress={() => router.push(`/lead/${lead.id}` as any)}
              >
                <View style={styles.leadHeader}>
                  <Text style={styles.leadName}>{lead.customerName}</Text>
                  <View style={[styles.stagePill, stageTone(lead.stage)]}>
                    <Text style={styles.stagePillText}>
                      {lead.stage.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.leadAddress}>{lead.address}</Text>
                {lead.source && (
                  <Text style={styles.leadMeta}>
                    Source: {lead.source.replace(/_/g, ' ')}
                  </Text>
                )}
                <PressableScale
                  pressedScale={0.96}
                  style={styles.convertBtn}
                  onPress={() => convertToInspection(lead.id)}
                >
                  <Ionicons name="arrow-forward" size={16} color={colors.textInverse} />
                  <Text style={styles.convertBtnText}>Convert to inspection</Text>
                </PressableScale>
              </PressableScale>
            </FadeSlideIn>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function stageTone(stage: LeadStage) {
  switch (stage) {
    case 'signed':
      return { backgroundColor: colors.successSoft };
    case 'lost':
      return { backgroundColor: colors.dangerSoft };
    case 'inspection_scheduled':
    case 'inspected':
      return { backgroundColor: colors.brandSoft };
    case 'proposal_sent':
      return { backgroundColor: colors.warnSoft };
    default:
      return { backgroundColor: colors.surfaceMuted };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },

  chipScroll: { maxHeight: 56 },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: fontSize.bodySm, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  leadCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  leadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leadName: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, flex: 1 },
  leadAddress: { fontSize: fontSize.bodyMd, color: colors.slate },
  leadMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: spacing.xs },
  stagePill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill },
  stagePillText: { fontSize: fontSize.caption, color: colors.navy, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },

  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    marginTop: spacing.md,
  },
  convertBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
  cta: {
    marginTop: spacing.lg,
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
});
