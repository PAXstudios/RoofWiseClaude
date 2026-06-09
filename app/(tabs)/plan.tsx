import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type PlanView = 'today' | 'week';

export default function PlanScreen() {
  const router = useRouter();
  const [view, setView] = useState<PlanView>('today');
  const inspections = useInspectionStore((s) => s.inspections);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const leads = useLeadStore((s) => s.leads);

  const followUpsDue = useMemo(() => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return leads
      .filter(
        (l) =>
          l.followUpAt &&
          l.stage !== 'signed' &&
          l.stage !== 'lost' &&
          new Date(l.followUpAt).getTime() <= endOfDay.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime(),
      );
  }, [leads]);

  const todayInspections = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    const endOfWeek = startOfDay + 7 * 24 * 60 * 60 * 1000;
    return inspections.filter((ins) => {
      const t = new Date(ins.createdAt).getTime();
      return view === 'today' ? t >= startOfDay && t < endOfDay : t >= startOfDay && t < endOfWeek;
    });
  }, [inspections, view]);

  const todayKnocks = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const k = archive.reduce(
      (sum, s) =>
        sum +
        (new Date(s.startedAt).getTime() >= startOfDay.getTime() ? s.knocks.length : 0),
      0,
    );
    return k + (active?.knocks.length ?? 0);
  }, [archive, active]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Plan</Text>
        <Text style={styles.sub}>{today}</Text>
      </View>

      <View style={styles.statsRow}>
        <StatTile label="Inspections" value={String(todayInspections.length)} />
        <StatTile label="Knocks today" value={String(todayKnocks)} />
        <StatTile
          label="Active route"
          value={active ? `${active.knocks.length}` : '—'}
        />
      </View>

      <View style={styles.segmented}>
        {(['today', 'week'] as const).map((v) => (
          <Pressable
            key={v}
            style={[styles.seg, view === v && styles.segActive]}
            onPress={() => setView(v)}
          >
            <Text style={[styles.segText, view === v && styles.segTextActive]}>
              {v === 'today' ? 'Today' : 'This week'}
            </Text>
          </Pressable>
        ))}
      </View>

      {todayInspections.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={40} color={colors.slate} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.emptyBody}>
            Inspections, installs, and meetings will appear here once you add jobs.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {todayInspections.map((ins, i) => (
            <Pressable
              key={ins.id}
              style={[styles.row, i > 0 && styles.rowBorder]}
              onPress={() => router.push(`/job/${ins.id}` as any)}
            >
              <Ionicons name="briefcase-outline" size={20} color={colors.orange} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{ins.customerName}</Text>
                <Text style={styles.rowSub}>{ins.address}</Text>
                <Text style={styles.rowMeta}>{ins.reportId}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.slate} />
            </Pressable>
          ))}
        </View>
      )}

      {followUpsDue.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Follow-ups due</Text>
          <View style={styles.card}>
            {followUpsDue.map((lead, i) => {
              const overdue =
                new Date(lead.followUpAt!).getTime() <
                new Date(new Date().setHours(0, 0, 0, 0)).getTime();
              return (
                <Pressable
                  key={lead.id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  onPress={() => router.push(`/lead/${lead.id}` as any)}
                >
                  <Ionicons
                    name={overdue ? 'alert-circle' : 'call-outline'}
                    size={20}
                    color={overdue ? colors.danger : colors.orange}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{lead.customerName}</Text>
                    <Text style={styles.rowSub}>{lead.address}</Text>
                    <Text style={[styles.rowMeta, overdue && { color: colors.danger }]}>
                      {overdue
                        ? `Overdue — ${new Date(lead.followUpAt!).toLocaleDateString()}`
                        : 'Due today'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.slate} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.card}>
        <Pressable style={styles.actionRow} onPress={() => router.push('/door-knocking')}>
          <Ionicons name="walk-outline" size={20} color={colors.orange} />
          <Text style={styles.actionText}>Start door-knocking route</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        </Pressable>
        <Pressable style={[styles.actionRow, styles.rowBorder]} onPress={() => router.push('/mileage')}>
          <Ionicons name="car-outline" size={20} color={colors.orange} />
          <Text style={styles.actionText}>Start mileage tracking</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        </Pressable>
        <Pressable style={[styles.actionRow, styles.rowBorder]} onPress={() => router.push('/new-job')}>
          <Ionicons name="add-circle-outline" size={20} color={colors.orange} />
          <Text style={styles.actionText}>New job</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        </Pressable>
      </View>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  header: {},
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodyMd, color: colors.slate, marginTop: spacing.xs },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  statValue: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.orange },
  statLabel: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs, textAlign: 'center' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    padding: 4,
  },
  seg: {
    flex: 1,
    minHeight: touchTarget.small,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segActive: { backgroundColor: colors.surface, ...shadows.card },
  segText: { fontSize: fontSize.bodyMd, color: colors.slate, fontWeight: fontWeight.medium },
  segTextActive: { color: colors.navy, fontWeight: fontWeight.semibold },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.navy },
  rowSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  rowMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2 },

  sectionLabel: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touchTarget.standard,
  },
  actionText: { flex: 1, fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.medium },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  emptyBody: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
  },
});
