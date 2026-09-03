import { PressableScale } from '@/components/PressableScale';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { formatDateShort } from '@/lib/format/date';
import { useState, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import {
  describeMissingDetails,
  isCoordinateAddress,
  isPlaceholderAddress,
  missingLeadDetails,
} from '@/lib/services/placeholderDetails';
import { CustomerDetailsSheet } from '@/components/sheets/CustomerDetailsSheet';
import { usePropertyRecordStore } from '@/lib/stores/propertyRecordStore';
import { recordFactsLine, recordHeroUrl, recordRoofLine, recordStatusBadge } from '@/lib/services/propertyRecord';
import { openMail, openPhone } from '@/components/pipeline/contact';
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
  const updateDetails = useLeadStore((s) => s.updateDetails);
  const setLeadRecord = useLeadStore((s) => s.setPropertyRecord);
  const lookupRecord = usePropertyRecordStore((s) => s.lookup);
  const remove = useLeadStore((s) => s.remove);
  // The house's own photo and facts (cache-first). Older leads and knock
  // leads that just got a street address pick it up here.
  useEffect(() => {
    if (!lead || lead.propertyRecord || isPlaceholderAddress(lead.address) || lead.address.trim().length < 8) return;
    let cancelled = false;
    void lookupRecord(lead.address).then((rec) => {
      if (!cancelled) setLeadRecord(lead.id, rec);
    });
    return () => {
      cancelled = true;
    };
  }, [lead?.id, lead?.address, lead?.propertyRecord, lookupRecord, setLeadRecord, lead]);
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const toast = useToastStore((s) => s.show);
  // Name / phone / email / address editor — the way a door-knock lead
  // ("Walk-in lead" at a GPS pair) becomes a customer.
  const [editSheet, setEditSheet] = useState(false);
  // The job this lead already became, when it is on this device. A link to
  // a job that was deleted (or lives only on another device) reads as none —
  // the CTA then offers a fresh conversion rather than a dead button.
  const linkedId = lead?.inspectionId;
  const linkedInspection = useInspectionStore((s) =>
    linkedId ? s.inspections.find((i) => i.id === linkedId) : undefined,
  );

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

  // Hands the lead to the New Job wizard. The wizard's save() links BOTH
  // ends — `Inspection.leadId` on create and `Lead.inspectionId` via
  // `leadStore.linkInspection` — because the inspection id does not exist
  // until then.
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
    // The stage moves when the wizard SAVES (new-job.tsx), not here — a
    // cancelled wizard must leave the lead exactly as it was. The id rides
    // the route as well as the prefill store, so the wizard can hydrate
    // synchronously from the lead record whatever the mount timing.
    router.push({ pathname: '/new-job', params: { leadId: lead.id } } as any);
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

  // Placeholder name / coordinate-only address (a door knock, or a lead
  // saved before the homeowner was asked). Stated, never dressed as real.
  const missing = missingLeadDetails(lead);
  const gpsOnly = isCoordinateAddress(lead.address);

  // Detail rows for the Contact card — built as a list (not four separate
  // conditionals) so the hairline separators between them are never guessed.
  const detailRows: { key: string; icon: IoniconName; tone: ChipTone; label: string; value: string }[] = [
    {
      key: 'address',
      icon: 'location-outline',
      tone: 'blue',
      label: gpsOnly ? 'GPS only — add the address' : 'Address',
      value: lead.address,
    },
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
  if (linkedInspection) {
    detailRows.push({
      key: 'inspection',
      icon: 'clipboard-outline',
      tone: 'orange',
      label: 'Inspection',
      value: `${linkedInspection.reportId} · ${linkedInspection.status.replace(/_/g, ' ')}`,
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
        {/* A knock-created lead announces what it is missing before anything
            else — one tap opens the editor. */}
        {missing.any && (
          <FadeSlideIn index={0}>
            <PressableScale
              style={styles.missingBanner}
              onPress={() => setEditSheet(true)}
              accessibilityRole="button"
              accessibilityLabel={`${describeMissingDetails(missing)}. Tap to edit this lead.`}
            >
              <Ionicons name="person-add-outline" size={22} color={colors.warn} />
              <View style={{ flex: 1 }}>
                <Text style={styles.missingTitle}>{describeMissingDetails(missing)}</Text>
                <Text style={styles.missingBody}>
                  {gpsOnly
                    ? 'This lead was saved from a GPS fix with no street address.'
                    : 'This lead still has placeholder details.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.warn} />
            </PressableScale>
          </FadeSlideIn>
        )}

        {/* The house — the Zillow photo and what the market says about it.
            Every line attributed; absent when there is no record. */}
        {recordHeroUrl(lead.propertyRecord) ? (
          <FadeSlideIn index={0}>
            <Image
              source={{ uri: recordHeroUrl(lead.propertyRecord) }}
              style={styles.housePhoto}
              contentFit="cover"
              transition={200}
              accessibilityLabel="Property photo from the Zillow listing"
            />
          </FadeSlideIn>
        ) : null}
        {lead.propertyRecord?.status === 'found' ? (
          <FadeSlideIn index={0}>
            <RichCard
              icon="business-outline"
              iconTone="green"
              title="Property record (Zillow)"
              subtitle={recordFactsLine(lead.propertyRecord) ?? lead.propertyRecord.streetAddress}
              headerTrailing={
                recordStatusBadge(lead.propertyRecord) ? (
                  <Pill label={recordStatusBadge(lead.propertyRecord)!.label} tone={recordStatusBadge(lead.propertyRecord)!.tone} size="sm" />
                ) : undefined
              }
            >
              {recordStatusBadge(lead.propertyRecord) ? (
                <Text style={styles.recordHint}>{recordStatusBadge(lead.propertyRecord)!.hint}</Text>
              ) : null}
              {recordRoofLine(lead.propertyRecord, new Date().getFullYear()) ? (
                <Text style={styles.recordHint}>{recordRoofLine(lead.propertyRecord, new Date().getFullYear())} — confirm on the roof.</Text>
              ) : null}
              {lead.propertyRecord.listingAgent ? (
                <View style={styles.agentRow}>
                  <Text style={styles.recordHint}>
                    Listing agent: {lead.propertyRecord.listingAgent.name ?? 'on file'}
                    {lead.propertyRecord.listingAgent.company ? ` · ${lead.propertyRecord.listingAgent.company}` : ''}
                  </Text>
                  <View style={styles.agentBtns}>
                    {lead.propertyRecord.listingAgent.phone ? (
                      <PressableScale style={styles.agentBtn} onPress={() => openPhone(lead.propertyRecord!.listingAgent!.phone!)} accessibilityRole="button" accessibilityLabel="Call the listing agent">
                        <Ionicons name="call-outline" size={18} color={colors.text} />
                        <Text style={styles.agentBtnText}>Call agent</Text>
                      </PressableScale>
                    ) : null}
                    {lead.propertyRecord.listingAgent.email ? (
                      <PressableScale style={styles.agentBtn} onPress={() => openMail(lead.propertyRecord!.listingAgent!.email!)} accessibilityRole="button" accessibilityLabel="Email the listing agent">
                        <Ionicons name="mail-outline" size={18} color={colors.text} />
                        <Text style={styles.agentBtnText}>Email agent</Text>
                      </PressableScale>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </RichCard>
          </FadeSlideIn>
        ) : null}

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
          <RichCard
            title="Contact"
            icon="person-outline"
            iconTone="blue"
            action={{ label: 'Edit', onPress: () => setEditSheet(true), icon: 'create-outline' }}
          >
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

        {/* The one accent-gradient moment on this screen. Once the lead has
            become a job, the primary action is that job — not a second one. */}
        <FadeSlideIn index={4}>
          <PressableScale
            style={styles.primaryBtn}
            onPress={
              linkedInspection
                ? () => router.push(`/job/${linkedInspection.id}` as any)
                : onConvert
            }
            accessibilityRole="button"
            accessibilityLabel={linkedInspection ? 'Open inspection' : 'Convert to inspection'}
          >
            <View style={styles.primaryBtnClip}>
              <LinearGradient
                colors={gradients.accent}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
              <Ionicons
                name={linkedInspection ? 'clipboard-outline' : 'arrow-forward'}
                size={20}
                color={colors.textInverse}
              />
              <Text style={styles.primaryBtnText}>
                {linkedInspection
                  ? `Open inspection ${linkedInspection.reportId}`
                  : 'Convert to inspection'}
              </Text>
            </View>
          </PressableScale>
          {linkedInspection && (
            <PressableScale
              style={styles.secondaryBtn}
              onPress={onConvert}
              accessibilityRole="button"
              accessibilityLabel="Start another inspection from this lead"
            >
              <Text style={styles.secondaryBtnText}>Start another inspection</Text>
            </PressableScale>
          )}
        </FadeSlideIn>
      </ScrollView>

      <CustomerDetailsSheet
        visible={editSheet}
        onClose={() => setEditSheet(false)}
        title={missing.any ? 'Who did you talk to?' : 'Edit lead'}
        subtitle={
          missing.any
            ? 'Name the homeowner and the property so this lead can be worked.'
            : undefined
        }
        initial={{
          customerName: lead.customerName,
          customerPhone: lead.customerPhone,
          customerEmail: lead.customerEmail,
          address: lead.address,
          lat: lead.lat,
          lng: lead.lng,
        }}
        onSave={(d) => {
          // A new street address is a new house: fetch its record (cache-first).
          if (d.address.trim().length >= 8 && d.address.trim() !== lead.address.trim()) {
            void lookupRecord(d.address).then((rec) => setLeadRecord(lead.id, rec));
          }
          updateDetails(lead.id, {
            customerName: d.customerName,
            customerPhone: d.customerPhone,
            customerEmail: d.customerEmail,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
          });
          setEditSheet(false);
          toast({ tone: 'success', title: 'Lead updated', body: d.customerName });
        }}
      />
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
  housePhoto: { width: '100%', height: 190, borderRadius: radii.card, backgroundColor: colors.surfaceMuted },
  recordHint: { fontSize: fontSize.bodySm, color: colors.text, lineHeight: 18 },
  agentRow: { gap: spacing.sm, marginTop: spacing.sm },
  agentBtns: { flexDirection: 'row', gap: spacing.sm },
  agentBtn: { flex: 1, minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.button, backgroundColor: colors.fillQuiet },
  agentBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
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

  // Placeholder-details banner — warn-toned, ≥56pt, first thing on the page.
  missingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.warnSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warn,
  },
  missingTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  missingBody: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18, marginTop: 2 },

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
  secondaryBtn: {
    minHeight: touchTarget.standard,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: colors.textMuted,
    fontSize: fontSize.bodyMd,
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
