import { formatDateShort } from '@/lib/format/date';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import type { LeadStage } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STAGES: { id: LeadStage; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'inspection_scheduled', label: 'Scheduled' },
  { id: 'inspected', label: 'Inspected' },
  { id: 'proposal_sent', label: 'Proposal' },
  { id: 'signed', label: 'Signed' },
  { id: 'lost', label: 'Lost' },
];

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
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyText}>Lead not found.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
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

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{lead.customerName}</Text>
          <Text style={styles.sub}>
            {lead.source ? `${lead.source.replace(/_/g, ' ')} · ` : ''}
            {formatDateShort(lead.createdAt)}
          </Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Contact actions */}
        <View style={styles.actionsRow}>
          <ActionButton
            icon="call"
            label="Call"
            disabled={!lead.customerPhone}
            onPress={onCall}
          />
          <ActionButton
            icon="chatbubble"
            label="Text"
            disabled={!lead.customerPhone}
            onPress={onText}
          />
          <ActionButton
            icon="mail"
            label="Email"
            disabled={!lead.customerEmail}
            onPress={onEmail}
          />
          <ActionButton icon="navigate" label="Directions" onPress={onDirections} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Address</Text>
          <Text style={styles.cardValue}>{lead.address}</Text>
          {lead.customerPhone && (
            <>
              <Text style={[styles.cardLabel, { marginTop: spacing.md }]}>Phone</Text>
              <Text style={styles.cardValue}>{lead.customerPhone}</Text>
            </>
          )}
          {lead.customerEmail && (
            <>
              <Text style={[styles.cardLabel, { marginTop: spacing.md }]}>Email</Text>
              <Text style={styles.cardValue}>{lead.customerEmail}</Text>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>Stage</Text>
        <View style={styles.chipWrap}>
          {STAGES.map((s) => (
            <Pressable
              key={s.id}
              style={[
                styles.chip,
                lead.stage === s.id &&
                  (s.id === 'lost' ? styles.chipLost : styles.chipActive),
              ]}
              onPress={() => setStage(lead.id, s.id)}
            >
              <Text
                style={[
                  styles.chipText,
                  lead.stage === s.id && styles.chipTextActive,
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Follow up</Text>
        {lead.followUpAt && (
          <View style={styles.followUpBanner}>
            <Ionicons name="alarm-outline" size={18} color={colors.orange} />
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
            <Pressable
              key={opt.label}
              style={styles.chip}
              onPress={() => onSetFollowUp(opt.days)}
            >
              <Text style={styles.chipText}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.primaryBtn} onPress={onConvert}>
          <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Convert to inspection</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, disabled && { opacity: 0.35 }]}
      disabled={disabled}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={colors.navy} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2, textTransform: 'capitalize' },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    minHeight: touchTarget.preferred,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadows.card,
  },
  actionLabel: { fontSize: fontSize.caption, color: colors.navy, fontWeight: fontWeight.semibold },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardLabel: {
    fontSize: fontSize.caption,
    color: colors.slate,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: { fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.medium },

  sectionLabel: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
    marginTop: spacing.md,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipLost: { backgroundColor: colors.danger, borderColor: colors.danger },
  chipText: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  followUpBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  followUpText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium },

  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    ...shadows.card,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },
  secondaryBtn: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
