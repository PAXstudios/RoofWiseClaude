import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { formatDateShort } from '@/lib/format/date';
import { LEAD_STAGE_LABELS, leadStageColumn, type Inspection } from '@/lib/models/types';
import { colors, fontSize, fontWeight, spacing, touchTarget } from '@/theme/tokens';
import { findLinkedLead, nextStageFor } from './chain';
import { FOLLOW_UP_OPTIONS, FollowUpSheet, INSTALL_OPTIONS } from './FollowUpSheet';

type Props = {
  inspection: Inspection;
  /** Optional heading override — the homeowner link labels it for the contractor. */
  title?: string;
  subtitle?: string;
};

type SheetKind = 'install' | 'followup' | null;

/**
 * What happens after the signature — so the money chain never terminates at
 * "signed". Schedule install, mark the deal won, set the next follow-up:
 * each one moves the LINKED LEAD on the pipeline, which is the record the
 * board, Home's Today module and Plan all read.
 *
 * Every write here goes through `leadStore.setStage` / `setFollowUp`. The
 * install date lives on the lead's follow-up slot (`followUpAt`) because the
 * job model has no install field and this wave adds none — see the note on
 * `onScheduleInstall`.
 */
export function PostSignatureActions({ inspection, title = "What's next", subtitle }: Props) {
  const router = useRouter();
  const leads = useLeadStore((s) => s.leads);
  const setStage = useLeadStore((s) => s.setStage);
  const setFollowUp = useLeadStore((s) => s.setFollowUp);
  const toast = useToastStore((s) => s.show);
  const [sheet, setSheet] = useState<SheetKind>(null);

  const lead = findLinkedLead(inspection, leads);

  if (!lead) {
    // Honest, not a void: the actions need a lead to write to, and this job
    // has none on record. Jobs converted from a lead are linked automatically.
    return (
      <RichCard icon="flag-outline" iconTone="quiet" title={title} subtitle={subtitle}>
        <Text style={styles.note}>
          This job isn't linked to a lead, so it can't move on the pipeline from here. Jobs
          started from a lead are linked automatically; open the lead to move it by hand.
        </Text>
      </RichCard>
    );
  }

  const column = leadStageColumn(lead.stage);
  const wonStage = nextStageFor(lead, 'won');

  const onScheduleInstall = (when: Date | null) => {
    setSheet(null);
    if (!when) return;
    // TODO(store): the job model carries no install date and no store action
    // writes one, so the install lands on the lead's follow-up slot — it
    // surfaces in Plan and Home the same morning. Replace with an
    // `installStartAt` write once the inspection store exposes one.
    setFollowUp(lead.id, when.toISOString());
    const stage = nextStageFor(lead, 'install_scheduled');
    if (stage) setStage(lead.id, stage);
    scheduleFollowUpReminder({ leadId: lead.id, customerName: lead.customerName, date: when }).catch(
      () => {},
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({
      tone: 'success',
      title: 'Install scheduled',
      body: `${formatDateShort(when)} · ${lead.customerName}`,
    });
  };

  const onMarkWon = () => {
    if (!wonStage) return;
    setStage(lead.id, wonStage);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({ tone: 'success', title: 'Marked won', body: lead.customerName });
  };

  const onSetFollowUp = (when: Date | null) => {
    setSheet(null);
    if (!when) {
      setFollowUp(lead.id, undefined);
      toast({ tone: 'info', title: 'Follow-up cleared' });
      return;
    }
    setFollowUp(lead.id, when.toISOString());
    scheduleFollowUpReminder({ leadId: lead.id, customerName: lead.customerName, date: when }).catch(
      () => {},
    );
    toast({ tone: 'success', title: 'Follow-up set', body: formatDateShort(when) });
  };

  return (
    <>
      <RichCard
        icon="flag-outline"
        iconTone="green"
        title={title}
        subtitle={subtitle}
        headerTrailing={<Pill label={LEAD_STAGE_LABELS[column]} tone="success" size="sm" />}
        padded={false}
      >
        <ActionRow
          icon="hammer-outline"
          tone="orange"
          label="Schedule install"
          sub={lead.followUpAt ? `Next date on file ${formatDateShort(lead.followUpAt)}` : 'Book the crew'}
          onPress={() => setSheet('install')}
        />
        {wonStage ? (
          <ActionRow
            icon="trophy-outline"
            tone="green"
            label="Mark won"
            sub={`Moves the lead to ${LEAD_STAGE_LABELS[wonStage]}`}
            onPress={onMarkWon}
            bordered
          />
        ) : (
          <ActionRow
            icon="checkmark-circle-outline"
            tone="green"
            label="In the pipeline"
            sub={`${lead.customerName} · ${LEAD_STAGE_LABELS[column]}`}
            onPress={() => router.push(`/lead/${lead.id}` as any)}
            bordered
            chevron
          />
        )}
        <ActionRow
          icon="alarm-outline"
          tone="blue"
          label="Set follow-up"
          sub={lead.followUpAt ? `Currently ${formatDateShort(lead.followUpAt)}` : 'Nothing scheduled'}
          onPress={() => setSheet('followup')}
          bordered
        />
      </RichCard>

      <FollowUpSheet
        visible={sheet === 'install'}
        title="Schedule install"
        subtitle={lead.customerName}
        icon="hammer-outline"
        tone="orange"
        options={INSTALL_OPTIONS}
        onPick={onScheduleInstall}
        onClose={() => setSheet(null)}
      />
      <FollowUpSheet
        visible={sheet === 'followup'}
        title="Set follow-up"
        subtitle={lead.customerName}
        options={FOLLOW_UP_OPTIONS}
        clearLabel={lead.followUpAt ? 'Clear follow-up' : undefined}
        onPick={onSetFollowUp}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

function ActionRow({
  icon,
  tone,
  label,
  sub,
  onPress,
  bordered = false,
  chevron = false,
}: {
  icon: IoniconName;
  tone: ChipTone;
  label: string;
  sub: string;
  onPress: () => void;
  bordered?: boolean;
  chevron?: boolean;
}) {
  return (
    <PressableScale
      style={[styles.row, bordered && styles.rowBorder]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      onPress={onPress}
    >
      <IconChip name={icon} tone={tone} size="sm" />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Ionicons
        name={chevron ? 'chevron-forward' : 'arrow-forward-circle-outline'}
        size={chevron ? 18 : 22}
        color={chevron ? colors.textSubtle : colors.brand}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
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
  rowLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
});
