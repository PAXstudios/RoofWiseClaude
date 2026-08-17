import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip } from '@/components/ui/IconChip';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Hit =
  | { kind: 'inspection'; id: string; primary: string; secondary: string; meta: string }
  | { kind: 'lead'; id: string; primary: string; secondary: string; meta: string }
  | { kind: 'proposal'; jobId: string; id: string; primary: string; secondary: string; meta: string };

export default function SearchScreen() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const proposals = useProposalStore((s) => s.proposals);
  const [query, setQuery] = useState('');

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Hit[] = [];

    for (const ins of inspections) {
      if (
        ins.customerName.toLowerCase().includes(q) ||
        ins.address.toLowerCase().includes(q) ||
        ins.reportId.toLowerCase().includes(q) ||
        (ins.claimNumber ?? '').toLowerCase().includes(q) ||
        (ins.policyNumber ?? '').toLowerCase().includes(q)
      ) {
        out.push({
          kind: 'inspection',
          id: ins.id,
          primary: ins.customerName,
          secondary: ins.address,
          meta: `${ins.reportId} · ${ins.status.replace('_', ' ')}`,
        });
      }
    }

    for (const lead of leads) {
      if (
        lead.customerName.toLowerCase().includes(q) ||
        lead.address.toLowerCase().includes(q)
      ) {
        out.push({
          kind: 'lead',
          id: lead.id,
          primary: lead.customerName,
          secondary: lead.address,
          meta: `Lead · ${lead.stage.replace(/_/g, ' ')}`,
        });
      }
    }

    for (const p of proposals) {
      const job = inspections.find((i) => i.id === p.jobId);
      const haystack = [
        job?.customerName,
        job?.address,
        job?.reportId,
        `$${p.total}`,
        p.status,
      ]
        .join(' ')
        .toLowerCase();
      if (haystack.includes(q)) {
        out.push({
          kind: 'proposal',
          jobId: p.jobId,
          id: p.id,
          primary: job?.customerName ?? 'Proposal',
          secondary: `$${p.total.toLocaleString()} · ${p.status}`,
          meta: job?.reportId ?? p.id.slice(-6),
        });
      }
    }

    return out.slice(0, 50);
  }, [query, inspections, leads, proposals]);

  const openHit = (hit: Hit) => {
    if (hit.kind === 'inspection' || hit.kind === 'proposal') {
      const jobId = hit.kind === 'inspection' ? hit.id : hit.jobId;
      router.push(`/job/${jobId}` as any);
    } else {
      router.push('/(tabs)/leads');
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.slate} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Name, address, report, claim #…"
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            autoCorrect={false}
            autoFocus
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.slate} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {hits.length === 0 ? (
          <RichCard>
            <View style={styles.empty}>
              <IconChip name="search-outline" tone="quiet" />
              <Text style={styles.emptyTitle}>
                {query.trim().length < 2 ? 'Start typing' : 'No matches'}
              </Text>
              <Text style={styles.emptyBody}>
                Search inspections, leads, and proposals. Try a customer name, claim #, address, or report ID.
              </Text>
            </View>
          </RichCard>
        ) : (
          <RichCard padded={false}>
            {hits.map((hit, i) => (
              <Pressable
                key={`${hit.kind}:${'id' in hit ? hit.id : ''}`}
                style={[styles.row, i > 0 && styles.rowBorder]}
                onPress={() => openHit(hit)}
              >
                {/* One hue per result kind, so a mixed result list is
                    scannable by colour before it is read. */}
                <IconChip
                  name={
                    hit.kind === 'inspection'
                      ? 'briefcase-outline'
                      : hit.kind === 'lead'
                      ? 'person-outline'
                      : 'document-attach-outline'
                  }
                  tone={
                    hit.kind === 'inspection' ? 'blue' : hit.kind === 'lead' ? 'green' : 'purple'
                  }
                  size="sm"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primary}>{hit.primary}</Text>
                  <Text style={styles.secondary}>{hit.secondary}</Text>
                  <Text style={styles.meta}>{hit.meta}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </Pressable>
            ))}
          </RichCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  searchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: touchTarget.standard,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: fontSize.bodyMd, color: colors.navy },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  primary: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  secondary: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  meta: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2, textTransform: 'capitalize' },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
});
