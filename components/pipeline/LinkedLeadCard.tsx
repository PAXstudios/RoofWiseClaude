import { useRouter } from 'expo-router';
import { RichCard } from '@/components/ui/RichCard';
import { Pill } from '@/components/ui/Pill';
import { formatDateShort } from '@/lib/format/date';
import { LEAD_STAGE_LABELS, leadStageColumn, type Lead } from '@/lib/models/types';

/**
 * The lead behind a job, on the job screen — the other half of the chain,
 * so a roofer standing on the roof can see where this customer sits on the
 * board and what the next follow-up is without hunting through Leads.
 */
export function LinkedLeadCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const column = leadStageColumn(lead.stage);
  const followUp = lead.followUpAt ? formatDateShort(lead.followUpAt) : null;
  const overdue = lead.followUpAt ? new Date(lead.followUpAt).getTime() <= Date.now() : false;

  return (
    <RichCard
      onPress={() => router.push(`/lead/${lead.id}` as any)}
      icon="person-outline"
      iconTone="purple"
      title={`Lead · ${lead.customerName}`}
      subtitle={
        followUp
          ? `${overdue ? 'Follow-up overdue' : 'Follow-up'} ${followUp}${
              lead.source ? ` · ${lead.source}` : ''
            }`
          : lead.source
            ? `Source ${lead.source} · no follow-up set`
            : 'No follow-up set'
      }
      headerTrailing={
        <Pill
          label={LEAD_STAGE_LABELS[column]}
          tone={column === 'lost' ? 'danger' : column === 'signed' ? 'success' : 'info'}
          size="sm"
        />
      }
      chevron
      accessibilityLabel={`Open lead ${lead.customerName}, ${LEAD_STAGE_LABELS[column]}`}
    />
  );
}
