import { PressableScale } from '@/components/PressableScale';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { formatDateShort } from '@/lib/format/date';
import { ScrollView, View, Text, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  leadStageColumn,
  type Lead,
  type LeadStage,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Same 12 chips the Pipeline board shows: the 11 live columns plus terminal
 * `lost`. Selection compares through `leadStageColumn()` so a lead persisted
 * under the legacy `proposal_sent` still lights up the Estimate Sent chip.
 */
const STAGES: { id: LeadStage; label: string }[] = ([...LEAD_STAGE_ORDER, 'lost'] as LeadStage[]).map(
  (id) => ({ id, label: LEAD_STAGE_LABELS[id] }),
);

export default function LeadDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lead = useLeadStore((s) => s.leads.find((l) => l.id === id));
  const setStage = useLeadStore((s) => s.setStage);
  const setFollowUp = useLeadStore((s) => s.setFollowUp);
  const remove = useLeadStore((s) => s.remove);
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const toast = useToastStore((s) => s.show);

  if (!lead) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.textSubtle} />
          <Text style={styles.emptyText}>Lead not found.</Text>
          <PressableScale style={styles.textBtn} onPress={() => router.back()}>
            <Text style={styles.textBtnLabel}>Back</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  const onCall = () => {
    if (!lead.customerPhone) return;
    Linking.openURL(`tel:${lead.customerPhone.replace(/[^\d+]/g, '')}`).catch(() => {});
    setStage(lead.id, lead.stage === 'new' ? 'contacted' : lead.stage);
  };

  const onText = () => {
    if (!lead.customerPhone) return;
    Linking.openURL(`sms:${lead.customerPhone.replace(/[^\d+]/g, '')}`).catch(() => {});
    setStage(lead.id, lead.stage === 'new' ? 'contacted' : lead.stage);
  };

  const onEmail = () => {
    if (!lead.customerEmail) return;
    Linking.openURL(`mailto:${lead.customerEmail}`).catch(() => {});
  };

  const onDirections = () => {
    const q = encodeURIComponent(lead.address);
    const url = Platform.OS === 'ios' ? `maps://?q=${q}` : `geo:0,0?q=${q}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://maps.google.com/?q=${q}`).catch(() => {}),
    );
  };

  const onSetFollowUp = (days: number | null) => {
    if (days === null) {
      setFollowUp(lead.id, undefined);
      toast({ tone: 'info', title: 'Follow-up cleared' });
      return;
    }
    const when = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    setFollowUp(lead.id, when.toISOString());
    scheduleFollowUpReminder({
      leadId: lead.id,
      customerName: lead.customerName,
      date: when,
    }).catch(() => {});
    toast({
      tone: 'success',
      title: 'Follow-up set',
      body: when.toLocaleDateString(),
    });
  };

  const onConvert = () => {
    setPrefill({
      source: 'lead',
      sourceId: lead.id,
      customerName: lead.customerName,
      customerPhone: lead.customerPhone,
      customerEmail: lead.customerEmail,
      address: lead.address,
      addressLat: lead.lat,
      addressLng: lead.lng,
    });
    setStage(lead.id, 'inspection_scheduled');
    router.push('/new-job');
  };

  const onDelete = () => {
    Alert.alert('Delete lead?', `${lead.customerName} will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove(lead.id);
          router.back();
        },
      },
    ]);
  };

  // Detail rows for the Contact card — built as a list (not four separate
  // conditionals) so the hairline separators between them are never guessed.
  const detailRows: { key: string; icon: IoniconName; tone: ChipTone; label: string; value: string }[] = [
    { key: 'address', icon: 'location-outline', tone: 'blue', label: 'Address', value: lead.address },
  ];
  if (lead.customerPhone) {
    detailRows.push({ key: 'phone', icon: 'call-outline', tone: 'green', label: 'Phone', value: lead.customerPhone });
  }
  if (lead.customerEmail) {
    detailRows.push({ key: 'email', icon: 'mail-outline', tone: 'purple', label: 'Email', value: lead.customerEmail });
  }
  if (lead.lastStormMatch) {
    detailRows.push({
      key: 'storm',
      icon: 'thunderstorm-outline',
      tone: 'orange',
      label: 'Storm match',
      value: formatStormMatch(lead.lastStormMatch),
    });
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={lead.customerName}
        subtitle={`${lead.source ? `${sourceLabel(lead.source)} · ` : ''}${formatDateShort(
          lead.createdAt,
        )}`}
        back
        right={
          <PressableScale
            onPress={onDelete}
            hitSlop={8}
            style={styles.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete lead"
          >
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </PressableScale>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Contact actions — colour-chipped so each action reads before the label does. */}
        <FadeSlideIn index={0} style={styles.actionsRow}>
          <ActionButton
            icon="call-outline"
            tone="green"
            label="Call"
            disabled={!lead.customerPhone}
            onPress={onCall}
          />
          <ActionButton
            icon="chatbubble-outline"
            tone="blue"
            label="Text"
            disabled={!lead.customerPhone}
            onPress={onText}
          />
          <ActionButton
            icon="mail-outline"
            tone="purple"
            label="Email"
            disabled={!lead.customerEmail}
            onPress={onEmail}
          />
          <ActionButton icon="navigate-outline" tone="orange" label="Directions" onPress={onDirections} />
        </FadeSlideIn>

        {/* Contact card — icon-chipped detail rows, hairline-separated. */}
        <FadeSlideIn index={1}>
          <RichCard title="Contact" icon="person-outline" iconTone="blue">
            {detailRows.map((row, i) => (
              <View key={row.key}>
                {i > 0 && <View style={styles.detailSeparator} />}
                <DetailRow icon={row.icon} tone={row.tone} label={row.label} value={row.value} />
              </View>
            ))}
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={2}>
          <RichCard title="Stage" icon="git-branch-outline" iconTone="purple">
            <View style={styles.chipWrap}>
              {STAGES.map((s) => {
                const active = leadStageColumn(lead.stage) === s.id;
                return (
                  <PressableScale
                    key={s.id}
                    pressedScale={0.96}
                    style={[
                      styles.chip,
                      active && (s.id === 'lost' ? styles.chipLost : styles.chipActive),
                    ]}
                    onPress={() => setStage(lead.id, s.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={3}>
          <SectionHeader title="Follow up" style={styles.sectionHeaderSpacing} />
          {lead.followUpAt && (
            <View style={styles.followUpBanner}>
              <IconChip name="alarm-outline" tone="blue" size="sm" />
              <Text style={styles.followUpText}>
                Scheduled for {formatDateShort(lead.followUpAt)}
              </Text>
            </View>
          )}
          <View style={styles.chipWrap}>
            {([
              { label: 'Clear', days: null },
              { label: 'Tomorrow', days: 1 },
              { label: '3 days', days: 3 },
              { label: '1 week', days: 7 },
            ] as const).map((opt) => (
              <PressableScale
                key={opt.label}
                pressedScale={0.96}
                style={styles.chip}
                onPress={() => onSetFollowUp(opt.days)}
                accessibilityRole="button"
              >
                <Text style={styles.chipText}>{opt.label}</Text>
              </PressableScale>
            ))}
          </View>
        </FadeSlideIn>

        {/* The one accent-gradient moment on this screen. */}
        <FadeSlideIn index={4}>
          <PressableScale
            style={styles.primaryBtn}
            onPress={onConvert}
            accessibilityRole="button"
            accessibilityLabel="Convert to inspection"
          >
            <View style={styles.primaryBtnClip}>
              <LinearGradient
                colors={gradients.accent}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
              <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
              <Text style={styles.primaryBtnText}>Convert to inspection</Text>
            </View>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

/** "door_knock" → "Door knock" so the subtitle reads like a sentence. */
function sourceLabel(source: string): string {
  const s = source.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "1.2 mi from storm core, 1.50" hail · Mar 3" — only the fields that exist. */
function formatStormMatch(match: NonNullable<Lead['lastStormMatch']>): string {
  const miles = `${match.distanceMiles.toFixed(1)} mi from storm core`;
  const hail = match.hailInches ? `, ${match.hailInches.toFixed(2)}" hail` : '';
  return `${miles}${hail} · ${formatDateShort(match.eventDate)}`;
}

function ActionButton({
  icon,
  tone,
  label,
  disabled,
  onPress,
}: {
  icon: IoniconName;
  tone: ChipTone;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.actionBtn, disabled && styles.actionBtnDisabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <IconChip name={icon} tone={tone} size="md" />
      <Text style={styles.actionLabel}>{label}</Text>
    </PressableScale>
  );
}

function DetailRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: IoniconName;
  tone: ChipTone;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <IconChip name={icon} tone={tone} size="sm" />
      <View style={styles.detailRowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  deleteBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: touchTarget.preferred,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    ...shadows.raised,
  },
  actionBtnDisabled: { opacity: 0.35 },
  actionLabel: {
    fontSize: fontSize.bodySm,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },

  // Contact card — icon-chipped rows, hairline separators inset past the chip.
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
  },
  detailRowBody: { flex: 1, gap: 2 },
  detailSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: 32 + spacing.md,
  },
  rowLabel: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.medium },

  sectionHeaderSpacing: { marginBottom: spacing.sm },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.text },
  chipLost: { backgroundColor: colors.danger },
  chipText: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.textInverse },

  followUpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.infoSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  followUpText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium },

  // Convert CTA — outer view carries the (unclipped) lift, inner clip carries
  // the gradient, same split `heroPrimaryShadow`/`heroPrimaryClip` use on Home:
  // a clipping layer can't also cast a shadow on iOS.
  primaryBtn: {
    height: touchTarget.preferred,
    borderRadius: radii.button,
    marginTop: spacing.xs,
    ...shadows.raised,
  },
  primaryBtnClip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },

  // Sub-screen empty state — centered is correct here (not a tab root).
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: { color: colors.textMuted, fontSize: fontSize.bodyMd },
  textBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtnLabel: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },
});
