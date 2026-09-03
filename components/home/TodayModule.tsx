import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/PressableScale';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import type { Inspection, Lead } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';
import { daysInStage, goingColdLeads } from '@/components/pipeline/chain';
import { followUpsDue, inspectionsToday, dayBounds } from './todayAgenda';

/** How many rows Home shows before handing off to Plan. */
const MAX_ROWS = 6;

type Row = {
  key: string;
  icon: IoniconName;
  tone: ChipTone;
  title: string;
  sub: string;
  pill?: { label: string; tone: PillTone };
  href: string;
};

export type TodayAgenda = {
  inspections: Inspection[];
  followUps: Lead[];
  cold: Lead[];
  rows: Row[];
  /** Rows beyond `MAX_ROWS`, surfaced as "N more in Plan". */
  overflow: number;
  routeLive: boolean;
  hasItems: boolean;
};

/**
 * The day's real next actions, read from the same stores Plan reads.
 * Empty on a quiet day — the caller hides the module rather than rendering
 * "nothing today" between the hero and the map (Drift #4's rule for the
 * storm hero applies: never a stale placeholder in the cockpit).
 */
export function useTodayAgenda(): TodayAgenda {
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const activeRoute = useKnockSessionStore((s) => s.activeSession);

  return useMemo(() => {
    const now = new Date();
    const { start } = dayBounds(now);
    const todays = inspectionsToday(inspections, now);
    const due = followUpsDue(leads, now);
    const cold = goingColdLeads(leads, now.getTime());

    const rows: Row[] = [];
    for (const ins of todays) {
      rows.push({
        key: `ins_${ins.id}`,
        icon: 'briefcase-outline',
        tone: 'blue',
        title: ins.customerName,
        sub: ins.address,
        pill: { label: 'Inspection', tone: 'info' },
        href: `/job/${ins.id}`,
      });
    }
    for (const lead of due) {
      const overdue = new Date(lead.followUpAt!).getTime() < start;
      rows.push({
        key: `fu_${lead.id}`,
        icon: overdue ? 'alert-circle' : 'call-outline',
        tone: overdue ? 'orange' : 'purple',
        title: lead.customerName,
        sub: lead.address,
        pill: { label: overdue ? 'Overdue' : 'Due today', tone: overdue ? 'danger' : 'info' },
        href: `/lead/${lead.id}`,
      });
    }
    for (const lead of cold) {
      const days = daysInStage(lead, now.getTime());
      rows.push({
        key: `cold_${lead.id}`,
        icon: 'snow-outline',
        tone: 'quiet',
        title: lead.customerName,
        sub: lead.address,
        pill: { label: days === null ? 'Going cold' : `${days}d quiet`, tone: 'warn' },
        href: `/lead/${lead.id}`,
      });
    }

    return {
      inspections: todays,
      followUps: due,
      cold,
      rows: rows.slice(0, MAX_ROWS),
      overflow: Math.max(0, rows.length - MAX_ROWS),
      routeLive: !!activeRoute,
      hasItems: rows.length > 0 || !!activeRoute,
    };
  }, [inspections, leads, activeRoute]);
}

/**
 * Home's "Today" module — the audit's single highest-impact IA fix: the
 * roofer's next actions at the top of the cockpit instead of two tabs away.
 * Every row lands on the job or the lead it names. Render it only when
 * `agenda.hasItems` — an empty module has nothing honest to say here.
 */
export function TodayModule({ agenda }: { agenda: TodayAgenda }) {
  const router = useRouter();
  const counts = [
    agenda.inspections.length > 0 &&
      `${agenda.inspections.length} inspection${agenda.inspections.length === 1 ? '' : 's'}`,
    agenda.followUps.length > 0 &&
      `${agenda.followUps.length} follow-up${agenda.followUps.length === 1 ? '' : 's'}`,
    agenda.cold.length > 0 && `${agenda.cold.length} going cold`,
  ]
    .filter((s): s is string => Boolean(s))
    .join(' · ');

  return (
    <View>
      <SectionHeader
        title="Today"
        action={{ label: 'Plan', onPress: () => router.push('/(tabs)/plan' as any) }}
        style={styles.header}
      />
      <View style={styles.card}>
        {agenda.routeLive && (
          <PressableScale
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel="Door-knocking route in progress. Open."
            onPress={() => router.push('/door-knocking')}
          >
            <IconChip name="walk-outline" tone="green" size="sm" />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Door-knocking route</Text>
              <Text style={styles.rowSub}>In progress</Text>
            </View>
            <Pill label="LIVE" tone="success" size="sm" dot pulse />
          </PressableScale>
        )}
        {agenda.rows.map((row, i) => (
          <PressableScale
            key={row.key}
            style={[styles.row, (i > 0 || agenda.routeLive) && styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel={`${row.title}, ${row.sub}${row.pill ? `, ${row.pill.label}` : ''}`}
            onPress={() => router.push(row.href as any)}
          >
            <IconChip name={row.icon} tone={row.tone} size="sm" />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {row.title}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {row.sub}
              </Text>
            </View>
            {row.pill && <Pill label={row.pill.label} tone={row.pill.tone} size="sm" />}
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </PressableScale>
        ))}
        {agenda.overflow > 0 && (
          <PressableScale
            style={[styles.row, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel={`${agenda.overflow} more in Plan`}
            onPress={() => router.push('/(tabs)/plan' as any)}
          >
            <IconChip name="layers-outline" tone="quiet" size="sm" />
            <Text style={styles.moreText}>{agenda.overflow} more in Plan</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </PressableScale>
        )}
      </View>
      {counts.length > 0 && <Text style={styles.counts}>{counts}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.raised,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  moreText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  counts: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
});
