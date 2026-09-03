import { StyleSheet, Text, View } from 'react-native';
import { RichCard } from '@/components/ui/RichCard';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { ChipTone, IoniconName } from '@/components/ui/IconChip';
import { formatDateShort, formatRelative } from '@/lib/format/date';
import type { DamageScoreResult } from '@/lib/services/damageScore';
import {
  INSURANCE_CARRIER_LABELS,
  LEAD_STAGE_LABELS,
  ROOF_MATERIAL_LABELS,
  leadStageColumn,
  type Inspection,
  type InspectionStatus,
  type Lead,
} from '@/lib/models/types';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { QuickActions } from './QuickActions';

/**
 * Per-status chrome — icon, chip colour, and pill tone all keyed off the SAME
 * status, so the leading chip and the trailing badge always agree. Mirrors
 * the map `app/inspections.tsx` ships for this exact status set.
 */
export const JOB_STATUS_META: Record<
  InspectionStatus,
  { icon: IoniconName; chipTone: ChipTone; pillTone: PillTone; label: string }
> = {
  lead: { icon: 'flag-outline', chipTone: 'quiet', pillTone: 'neutral', label: 'Lead' },
  scheduled: { icon: 'calendar-outline', chipTone: 'blue', pillTone: 'info', label: 'Scheduled' },
  in_progress: { icon: 'construct-outline', chipTone: 'orange', pillTone: 'warn', label: 'In progress' },
  complete: { icon: 'checkmark-circle-outline', chipTone: 'green', pillTone: 'success', label: 'Complete' },
};

/** Damage-score band → Pill tone. 100 = sound, so LOW scores are the loud ones. */
function scoreTone(score: number): PillTone {
  if (score <= 30) return 'danger';
  if (score <= 60) return 'warn';
  if (score <= 85) return 'info';
  return 'success';
}

type Props = {
  inspection: Inspection;
  /** The lead behind this job, when linked — carries the follow-up and stage. */
  lead?: Lead;
  /** ISO of the newest activity event for this job; falls back to createdAt. */
  lastActivityAt?: string;
  score?: DamageScoreResult;
  onOpen: () => void;
  /** Opens the follow-up sheet for the linked lead. Omit to hide "Book". */
  onBook?: () => void;
  onContacted?: () => void;
};

/**
 * A job as a pipeline card — the home the audit said jobs never had.
 *
 * Status, customer, address, carrier, last activity, damage score when one
 * is assessed, the linked lead's stage + follow-up when there is one, and the
 * quick-action row. Tap the card for the job; tap an action to act on it
 * without leaving the list.
 */
export function JobPipelineCard({
  inspection,
  lead,
  lastActivityAt,
  score,
  onOpen,
  onBook,
  onContacted,
}: Props) {
  const meta = JOB_STATUS_META[inspection.status];
  const metaLine = [
    inspection.reportId,
    inspection.carrier ? INSURANCE_CARRIER_LABELS[inspection.carrier] : null,
    ROOF_MATERIAL_LABELS[inspection.material],
  ]
    .filter((s): s is string => Boolean(s))
    .join(' · ');
  const activity = formatRelative(lastActivityAt ?? inspection.createdAt);

  return (
    <RichCard
      onPress={onOpen}
      icon={meta.icon}
      iconTone={meta.chipTone}
      title={inspection.customerName}
      subtitle={inspection.address}
      headerTrailing={<Pill label={meta.label} tone={meta.pillTone} size="sm" />}
      accessibilityLabel={`${inspection.customerName}, ${inspection.address}, ${meta.label}. ${inspection.reportId}. Last activity ${activity}.`}
      contentStyle={styles.body}
      footer={
        <QuickActions
          name={inspection.customerName}
          phone={inspection.customerPhone}
          email={inspection.customerEmail}
          address={inspection.address}
          coords={{ lat: inspection.lat, lng: inspection.lng }}
          onBook={onBook}
          onContacted={onContacted}
        />
      }
    >
      <Text style={styles.meta} numberOfLines={1}>
        {metaLine}
      </Text>
      <View style={styles.pillRow}>
        <Text style={styles.activity} numberOfLines={1}>
          Last activity {activity}
        </Text>
        {score?.assessed && (
          <Pill label={`Score ${score.score}`} tone={scoreTone(score.score)} size="sm" />
        )}
        {lead && (
          <Pill
            label={LEAD_STAGE_LABELS[leadStageColumn(lead.stage)]}
            tone="neutral"
            size="sm"
            icon="person-outline"
          />
        )}
        {lead?.followUpAt && (
          <Pill
            label={`Follow-up ${formatDateShort(lead.followUpAt)}`}
            tone={new Date(lead.followUpAt).getTime() <= Date.now() ? 'danger' : 'info'}
            size="sm"
            icon="alarm-outline"
          />
        )}
      </View>
    </RichCard>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  meta: { fontSize: fontSize.bodySm, color: colors.textMuted },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  activity: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    marginRight: spacing.xs,
  },
});
