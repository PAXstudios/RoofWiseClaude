// Notifications — the bell. What is queued, what is done, what is due.
//
// Three sections, all from real stores: IN PROGRESS (a knock plan being
// built, slope analyses queued or running), DUE NOW (lead follow-ups whose
// time has come), and RECENT (the durable in-app notification list — plans
// ready, analyses finished or failed, storm alerts). Tapping a row opens the
// thing it is about and marks it read. Nothing here is generated for show.

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { useNotificationStore, type AppNotification, type AppNotificationKind } from '@/lib/stores/notificationStore';
import { useKnockFinderStore } from '@/lib/stores/knockFinderStore';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { FINDER_STEPS } from '@/lib/services/knockFinder';
import { followUpsDue } from '@/components/home/todayAgenda';
import { formatRelative } from '@/lib/format/date';
import { colors, fontSize, fontWeight, spacing, touchTarget } from '@/theme/tokens';

const KIND_META: Record<AppNotificationKind, { icon: IoniconName; tone: ChipTone }> = {
  plan_queued: { icon: 'compass-outline', tone: 'orange' },
  plan_ready: { icon: 'compass', tone: 'orange' },
  plan_failed: { icon: 'alert-circle-outline', tone: 'orange' },
  analysis_done: { icon: 'sparkles-outline', tone: 'green' },
  analysis_failed: { icon: 'alert-circle-outline', tone: 'quiet' },
  storm_alert: { icon: 'thunderstorm-outline', tone: 'blue' },
  follow_up: { icon: 'alarm-outline', tone: 'purple' },
  info: { icon: 'information-circle-outline', tone: 'quiet' },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const items = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clear = useNotificationStore((s) => s.clear);
  const activeRun = useKnockFinderStore((s) => s.activeRun);
  const jobs = useAnalysisQueueStore((s) => s.jobs);
  const leads = useLeadStore((s) => s.leads);
  const [confirmClear, setConfirmClear] = useState(false);

  const inFlight = useMemo(() => jobs.filter((j) => j.status === 'queued' || j.status === 'running'), [jobs]);
  const due = useMemo(() => followUpsDue(leads), [leads]);
  const unread = items.filter((i) => !i.read).length;

  const open = (n: AppNotification) => {
    markRead(n.id);
    if (n.href) router.push(n.href as any);
  };

  const stepLabel = activeRun ? FINDER_STEPS.find((s) => s.id === activeRun.step)?.label ?? 'Working' : '';
  const nothing = !activeRun && inFlight.length === 0 && due.length === 0 && items.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        back={() => router.back()}
        right={
          unread > 0 ? (
            <PressableScale style={styles.headerBtn} onPress={markAllRead} accessibilityRole="button" accessibilityLabel="Mark all as read">
              <Ionicons name="checkmark-done-outline" size={22} color={colors.brand} />
            </PressableScale>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {nothing ? (
          <RichCard icon="notifications-off-outline" iconTone="quiet" title="Nothing yet">
            <Text style={styles.body}>
              Knock plans being built, photo analyses in the queue, storm alerts and follow-ups that come due will show up here.
            </Text>
          </RichCard>
        ) : null}

        {activeRun || inFlight.length > 0 ? (
          <>
            <SectionHeader title="In progress" />
            {activeRun ? (
              <Row
                icon="compass-outline"
                tone="orange"
                title={`Knock Planner · ${activeRun.baseLabel}`}
                sub={`${stepLabel}${activeRun.partial ? ` · ${activeRun.partial.areas.length} areas ranked so far` : ''} · started ${formatRelative(activeRun.startedAt, 'just now')}`}
                live
                onPress={() => router.push('/knock-finder')}
              />
            ) : null}
            {inFlight.map((j) => (
              <Row
                key={j.id}
                icon="sparkles-outline"
                tone="green"
                title={`${j.status === 'running' ? 'Analyzing' : 'Queued'} · ${j.slopeLabel}`}
                sub={`Photo analysis · ${formatRelative(j.enqueuedAt, 'just now')}`}
                live={j.status === 'running'}
                onPress={() => router.push(`/job/${j.inspectionId}` as any)}
              />
            ))}
          </>
        ) : null}

        {due.length > 0 ? (
          <>
            <SectionHeader title="Due now" />
            {due.map((l) => (
              <Row
                key={l.id}
                icon="alarm-outline"
                tone="purple"
                title={`Follow up · ${l.customerName}`}
                sub={`${l.address} · ${l.followUpAt ? formatRelative(l.followUpAt, 'now') : ''}`}
                onPress={() => router.push(`/lead/${l.id}` as any)}
              />
            ))}
          </>
        ) : null}

        {items.length > 0 ? (
          <>
            <SectionHeader title="Recent" action={{ label: 'Clear', onPress: () => setConfirmClear(true), icon: 'trash-outline' }} />
            {items.map((n) => (
              <Row
                key={n.id}
                icon={KIND_META[n.kind].icon}
                tone={KIND_META[n.kind].tone}
                title={n.title}
                sub={`${n.body ? `${n.body} · ` : ''}${formatRelative(n.createdAt, 'just now')}`}
                unread={!n.read}
                onPress={() => open(n)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={confirmClear}
        title="Clear notifications?"
        body="This clears the list. Plans, jobs and leads are not affected."
        confirmLabel="Clear"
        onConfirm={clear}
        onClose={() => setConfirmClear(false)}
      />
    </SafeAreaView>
  );
}

function Row({
  icon,
  tone,
  title,
  sub,
  unread,
  live,
  onPress,
}: {
  icon: IoniconName;
  tone: ChipTone;
  title: string;
  sub?: string;
  unread?: boolean;
  live?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale style={[styles.row, unread && styles.rowUnread]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub ?? ''}`}>
      <IconChip name={icon} tone={tone} size="sm" />
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, unread && styles.rowTitleUnread]} numberOfLines={2}>
          {title}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {live ? <View style={styles.liveDot} /> : unread ? <View style={styles.unreadDot} /> : <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl * 2 },
  headerBtn: { width: touchTarget.standard, height: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 21 },
  row: { minHeight: touchTarget.preferred, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: 16, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  rowUnread: { backgroundColor: colors.brandSoft },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowTitleUnread: { fontWeight: fontWeight.bold },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 17 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
});
