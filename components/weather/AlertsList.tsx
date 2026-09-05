/**
 * AlertsList — active NWS alerts for the page's location.
 *
 * Absent entirely when NWS answered and there is nothing active: an empty
 * "No alerts" card would be a placeholder standing where a warning goes, and
 * the roofer would learn to skip the slot. When NWS could NOT be reached the
 * list collapses to one honest line — "not available" is a different fact
 * from "none" (Drift #5) and a roofer deciding whether to climb needs to know
 * which one they are looking at.
 *
 * Severity drives the tone (Extreme/Severe → danger, Moderate → warn,
 * Minor → info). Each card expands on tap (≥56pt) to the full NWS
 * description and instruction text, verbatim.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IconChip, type ChipTone } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { SectionHeader } from '@/components/ui/SectionHeader';
import type { NwsAlert, NwsSeverity } from '@/lib/services/nwsAlerts';
import { colors, dataLabel, fontFamily, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  alerts: readonly NwsAlert[];
  status: 'ok' | 'unavailable' | 'pending';
  reason?: string;
  style?: StyleProp<ViewStyle>;
};

const SEVERITY_TONE: Record<NwsSeverity, { pill: PillTone; chip: ChipTone; edge: string }> = {
  Extreme: { pill: 'danger', chip: 'orange', edge: colors.danger },
  Severe: { pill: 'danger', chip: 'orange', edge: colors.danger },
  Moderate: { pill: 'warn', chip: 'orange', edge: colors.warn },
  Minor: { pill: 'info', chip: 'blue', edge: colors.info },
  Unknown: { pill: 'neutral', chip: 'quiet', edge: colors.borderStrong },
};

export function AlertsList({ alerts, status, reason, style }: Props) {
  if (status === 'pending') return null;

  if (status === 'unavailable') {
    return (
      <View style={[styles.unavailable, style]} accessibilityRole="text">
        <Ionicons name="cloud-offline-outline" size={16} color={colors.textSubtle} />
        <Text style={styles.unavailableText}>
          NWS alerts not available right now{reason ? ` (${reason})` : ''} — none is not confirmed.
        </Text>
      </View>
    );
  }

  if (alerts.length === 0) return null;

  return (
    <View style={[styles.wrap, style]}>
      <SectionHeader title={`${alerts.length} active NWS alert${alerts.length === 1 ? '' : 's'}`} />
      {alerts.map((a) => (
        <AlertCard key={a.id} alert={a} />
      ))}
    </View>
  );
}

function AlertCard({ alert }: { alert: NwsAlert }) {
  const [expanded, setExpanded] = useState(false);
  const tone = SEVERITY_TONE[alert.severity];
  const until = formatUntil(alert.ends ?? alert.expires);

  return (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${alert.event}. ${alert.headline}. ${expanded ? 'Collapse' : 'Expand'} details.`}
      style={({ pressed }) => [styles.card, { borderLeftColor: tone.edge }, pressed && styles.cardPressed]}
    >
      <View style={styles.head}>
        <IconChip name="warning" tone={tone.chip} size="md" />
        <View style={styles.headText}>
          <Text style={styles.event} numberOfLines={2}>
            {alert.event}
          </Text>
          <Text style={styles.area} numberOfLines={expanded ? undefined : 1}>
            {alert.areaDesc}
          </Text>
        </View>
        <Pill label={alert.severity} tone={tone.pill} size="sm" />
      </View>

      <Text style={styles.headline} numberOfLines={expanded ? undefined : 2}>
        {alert.headline}
      </Text>

      <View style={styles.meta}>
        {until && (
          <Text style={styles.metaText} numberOfLines={1}>
            {until}
          </Text>
        )}
        {alert.senderName && (
          <Text style={styles.metaText} numberOfLines={1}>
            {alert.senderName}
          </Text>
        )}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textSubtle}
          style={styles.metaChevron}
        />
      </View>

      {expanded && (
        <View style={styles.body}>
          {alert.description && <Text style={styles.bodyText}>{alert.description.trim()}</Text>}
          {alert.instruction && (
            <View style={styles.instruction}>
              <Text style={styles.instructionLabel}>What NWS says to do</Text>
              <Text style={styles.bodyText}>{alert.instruction.trim()}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

/** "Until 4:45 PM" / "Until Thu 6:00 AM" — in the device's zone, as NWS times carry their own offset. */
function formatUntil(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const sameDay = d.toDateString() === new Date().toDateString();
  try {
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(sameDay ? {} : { weekday: 'short' }),
    }).format(d);
    return `Until ${time}`;
  } catch {
    return `Until ${d.toLocaleTimeString()}`;
  }
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    // The severity edge — a 4pt band on the leading side, the one place a
    // raw semantic colour belongs on a light card.
    borderLeftWidth: 4,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    ...shadows.raised,
  },
  cardPressed: { backgroundColor: colors.surfaceMuted },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1, gap: 2 },
  event: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  area: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },
  headline: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metaText: { ...dataLabel, flexShrink: 1, color: colors.textSubtle },
  metaChevron: { marginLeft: 'auto' },
  body: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  bodyText: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 19 },
  instruction: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warnSoft,
  },
  instructionLabel: {
    ...dataLabel,
    color: colors.warn,
  },

  unavailable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  unavailableText: { flex: 1, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
});
