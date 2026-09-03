import { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { PressableScale } from '@/components/PressableScale';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { activityHref } from '@/components/home/activityRoute';
import {
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'job', label: 'Jobs' },
  { id: 'analysis', label: 'AI' },
  { id: 'knock', label: 'Knocks' },
  { id: 'storm', label: 'Storms' },
  { id: 'proposal', label: 'Proposals' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function matchesFilter(kind: string, filter: FilterId): boolean {
  if (filter === 'all') return true;
  if (filter === 'job') return kind === 'job_created' || kind === 'inspection_completed';
  if (filter === 'analysis') return kind === 'analysis_ran' || kind === 'ai_calibration_updated';
  if (filter === 'knock')
    return kind === 'knock_logged' || kind === 'knock_converted_to_lead' || kind === 'route_completed';
  if (filter === 'storm') return kind === 'storm_alert_received';
  if (filter === 'proposal')
    return kind === 'proposal_sent' || kind === 'proposal_signed' || kind === 'pdf_generated';
  return true;
}

export default function ActivityScreen() {
  const router = useRouter();
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const proposals = useProposalStore((s) => s.proposals);
  const [filter, setFilter] = useState<FilterId>('all');
  // Clearing the feed is destructive and irreversible — it asks in a sheet
  // (Drift #1), never fires on the tap.
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => events.filter((e) => matchesFilter(e.kind, filter)), [events, filter]);

  // Rows route to the record they describe (job / proposal / lead) and stay
  // plain text when that record is gone — a feed row is never a dead button.
  const routeCtx = useMemo(
    () => ({
      hasInspection: (id: string) => inspections.some((i) => i.id === id),
      hasLead: (id: string) => leads.some((l) => l.id === id),
      proposalJobId: (id: string) => proposals.find((p) => p.id === id)?.jobId,
    }),
    [inspections, leads, proposals],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>Activity</Text>
        {events.length > 0 && (
          <Pressable
            onPress={() => setConfirmClear(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear activity"
            style={styles.clearBtn}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipActive]}
            onPress={() => setFilter(f.id)}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.length === 0 ? (
          <RichCard>
            <View style={styles.empty}>
              <IconChip name="time-outline" tone="quiet" />
              <Text style={styles.emptyTitle}>
                {events.length === 0 ? 'No activity yet' : 'No activity in this filter'}
              </Text>
              <Text style={styles.emptyBody}>
                {events.length === 0
                  ? 'Inspections, photo captures, knocks, and proposal events will appear here.'
                  : 'Try a different filter chip above.'}
              </Text>
            </View>
          </RichCard>
        ) : (
          <RichCard padded={false}>
            {filtered.map((evt, i) => {
              const href = activityHref(evt, routeCtx);
              const body = (
                <>
                  <IconChip name={iconFor(evt.kind)} tone={toneFor(evt.kind)} size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.msg}>{evt.message}</Text>
                    <Text style={styles.time}>{formatTime(evt.createdAt)}</Text>
                  </View>
                  {href && <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />}
                </>
              );
              return href ? (
                <PressableScale
                  key={evt.id}
                  style={[styles.row, styles.rowPressable, i > 0 && styles.rowBorder]}
                  accessibilityRole="button"
                  accessibilityLabel={`${evt.message}. Open.`}
                  onPress={() => router.push(href as any)}
                >
                  {body}
                </PressableScale>
              ) : (
                <View key={evt.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                  {body}
                </View>
              );
            })}
          </RichCard>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={confirmClear}
        title="Clear activity?"
        body={`${events.length} event${events.length === 1 ? '' : 's'} will be removed from this feed. This cannot be undone.`}
        confirmLabel="Clear"
        onConfirm={clear}
        onClose={() => setConfirmClear(false)}
      />
    </SafeAreaView>
  );
}

/** Colour family per event kind, so the feed groups by meaning at a glance:
 *  green = something completed, blue = capture/analysis, purple = AI,
 *  orange = outbound/field work. */
function toneFor(kind: string): ChipTone {
  switch (kind) {
    case 'inspection_completed':
    case 'proposal_signed':
    case 'route_completed':
      return 'green';
    case 'photo_captured':
    case 'analysis_ran':
    case 'job_created':
      return 'blue';
    case 'ai_calibration_updated':
      return 'purple';
    case 'proposal_sent':
    case 'knock_logged':
    case 'knock_converted_to_lead':
    case 'storm_alert_received':
      return 'orange';
    default:
      return 'quiet';
  }
}

function iconFor(kind: string): IoniconName {
  switch (kind) {
    case 'job_created': return 'briefcase-outline';
    case 'inspection_completed': return 'checkmark-circle-outline';
    case 'photo_captured': return 'camera-outline';
    case 'analysis_ran': return 'analytics-outline';
    case 'ai_calibration_updated': return 'sparkles-outline';
    case 'proposal_sent': return 'send-outline';
    case 'proposal_signed': return 'document-text-outline';
    case 'knock_logged': return 'walk-outline';
    case 'knock_converted_to_lead': return 'person-add-outline';
    case 'route_completed': return 'flag-outline';
    case 'storm_alert_received': return 'thunderstorm-outline';
    case 'pdf_generated': return 'document-attach-outline';
    default: return 'ellipse-outline';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Glove-sized targets (Drift #1) — the back chevron was a 26px icon in 4pt
  // of padding, and Clear (destructive) sat at 44pt.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.navy,
  },
  clearBtn: { minHeight: touchTarget.standard, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  clear: {
    color: colors.orange,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
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
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: {
    fontSize: fontSize.bodySm,
    color: colors.navy,
    fontWeight: fontWeight.medium,
    fontFamily: fontFamily.archivo.medium,
  },
  chipTextActive: { color: colors.textInverse },

  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  // A row that opens something is a target, so it takes the glove floor
  // (Drift #1); the chevron carries the "this goes somewhere" cue.
  rowPressable: { alignItems: 'center', minHeight: touchTarget.standard },
  msg: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular, color: colors.text },
  // "Mar 4, 2:14 PM" — timestamp convention (§3).
  time: { fontSize: fontSize.caption, fontFamily: fontFamily.mono, color: colors.textSubtle, marginTop: 2 },

  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 180,
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.navy,
    marginTop: spacing.sm,
  },
  emptyBody: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular, color: colors.slate, textAlign: 'center' },
});
