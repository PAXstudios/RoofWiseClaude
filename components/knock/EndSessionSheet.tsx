// "Wrap this route?" — the end-of-session summary as the app's bottom sheet
// (same Keep / Confirm pair as ConfirmSheet, with the route's numbers in
// front of the decision). Ending is not destructive — nothing is lost — but
// it is final for the trip, so it asks. Reached from the drawer header's
// Wrap button in Knock mode.

import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { PressableScale } from '@/components/PressableScale';
import type { KnockSession } from '@/lib/models/types';
import { sessionStats } from '@/lib/services/knockOutcomes';
import { formatElapsed, formatMiles } from '@/lib/services/knockTrip';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  visible: boolean;
  session: KnockSession | null;
  /** Live miles from the tracker. */
  miles: number;
  onKeepGoing: () => void;
  onConfirm: () => void;
};

export function EndSessionSheet({ visible, session, miles, onKeepGoing, onConfirm }: Props) {
  const stats = session ? sessionStats(session) : null;
  const elapsed = session ? Date.now() - new Date(session.startedAt).getTime() : 0;

  const confirm = () => {
    onKeepGoing();
    // Let the sheet start its exit before the session disappears under it.
    setTimeout(onConfirm, 120);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onKeepGoing}
      title="Wrap this route?"
      subtitle="The knocks, leads and miles are saved. The mileage trip closes with it."
      cancel={false}
      accessibilityLabel="Wrap this route"
    >
      {stats ? (
        <View style={styles.grid}>
          <Tile icon="home-outline" tone="blue" value={String(stats.doors)} label="Doors" />
          <Tile
            icon="chatbubble-ellipses-outline"
            tone="green"
            value={`${stats.contactRate}%`}
            label={`Answered · ${stats.contacts}`}
          />
          <Tile
            icon="person-add-outline"
            tone="purple"
            value={String(stats.leads)}
            label={stats.leads === 1 ? 'Lead' : 'Leads'}
          />
          <Tile icon="car-outline" tone="orange" value={formatMiles(miles)} label="Miles" />
          <Tile icon="time-outline" tone="quiet" value={formatElapsed(elapsed)} label="On route" />
          <Tile
            icon="alarm-outline"
            tone="orange"
            value={String(stats.followUps + stats.appointments)}
            label="Follow-ups"
          />
        </View>
      ) : null}
      <View style={styles.note}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
        <Text style={styles.noteText}>
          Miles count while RoofWise is open. Tracking with the app in the background needs the native build.
        </Text>
      </View>
      <View style={styles.row}>
        <PressableScale style={styles.btn} onPress={onKeepGoing} accessibilityRole="button" accessibilityLabel="Keep going">
          <Text style={styles.keepText}>Keep going</Text>
        </PressableScale>
        <PressableScale
          style={[styles.btn, styles.btnPrimary]}
          onPress={confirm}
          accessibilityRole="button"
          accessibilityLabel="Save and end the route"
        >
          <Text style={styles.confirmText}>Save & end</Text>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

function Tile({ icon, tone, value, label }: { icon: IoniconName; tone: ChipTone; value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <IconChip name={icon} tone={tone} size="sm" />
      <View style={styles.tileText}>
        <Text style={styles.tileValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: touchTarget.preferred,
    borderRadius: radii.card,
    backgroundColor: colors.fillQuiet,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tileText: { flex: 1, gap: 1 },
  tileValue: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  tileLabel: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: fontWeight.semibold },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  noteText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  row: { flexDirection: 'row', gap: spacing.sm },
  // 56pt each (Drift #1).
  btn: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  btnPrimary: { backgroundColor: colors.brand },
  keepText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  confirmText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.textInverse },
});
