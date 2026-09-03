import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { MeshBackground } from '@/components/ui/MeshBackground';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { formatDateShort } from '@/lib/format/date';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
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
import { TasksCard } from '@/components/pipeline/TasksCard';
import { groupOf, PIPELINE_GROUPS, PIPELINE_GROUP_LABELS, type PipelineGroup } from '@/lib/services/pipeline';
import {
  INSURANCE_CARRIER_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  leadStageColumn,
  type ActivityEventKind,
  type Lead,
  type LeadStage,
} from '@/lib/models/types';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
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

  // The mock's "label left, value right" insurance row (docs/DESIGN_1A.md
  // §6) — sourced from the linked JOB, since carrier/claim/deductible live on
  // `Inspection`, not `Lead` (lib/models/types.ts). Real fields only: a lead
  // never converted yet simply has no row here.
  const insuranceRows: { key: string; label: string; value: string; mono?: boolean }[] = [];
  if (linkedInspection?.carrier) {
    insuranceRows.push({ key: 'carrier', label: 'Carrier', value: INSURANCE_CARRIER_LABELS[linkedInspection.carrier] });
  }
  if (linkedInspection?.claimNumber) {
    insuranceRows.push({ key: 'claim', label: 'Claim #', value: linkedInspection.claimNumber, mono: true });
  }
  if (linkedInspection?.deductible != null) {
    insuranceRows.push({ key: 'deductible', label: 'Deductible', value: `$${linkedInspection.deductible.toLocaleString()}` });
  }
  if (linkedInspection?.adjusterName) {
    insuranceRows.push({ key: 'adjuster', label: 'Adjuster', value: linkedInspection.adjusterName });
  }

  // Stage-progress bar (docs/DESIGN_1A.md §6): the mock's 5 segments, mapped
  // onto the real `PIPELINE_GROUPS` a lead actually moves through — the same
  // grouping the Pipeline board's filter chips use, so this never disagrees
  // with the board. Lost is terminal and off this progression (pipeline.ts).
  const stageGroups: PipelineGroup[] = PIPELINE_GROUPS.filter((g) => g !== 'lost');
  const currentGroup = groupOf(leadStageColumn(lead.stage));
  const currentGroupIndex = stageGroups.indexOf(currentGroup);
  const isLost = leadStageColumn(lead.stage) === 'lost';

  const initials = lead.customerName.trim().charAt(0).toUpperCase() || '?';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* The bluer, no-orange cut of the mesh (docs/DESIGN_1A.md §2/§6) —
          distinct from the Pipeline board's cooler violet and from Home's
          warmer hero. */}
      <View style={styles.hero}>
        <MeshBackground variant="cool" style={styles.heroMesh} />
        <View style={styles.heroTopRow}>
          <PressableScale
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.heroIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.onMesh} />
          </PressableScale>
          <Text style={styles.heroEyebrow} numberOfLines={1}>
            {linkedInspection ? `LEAD · ${linkedInspection.reportId}` : 'LEAD'}
          </Text>
          <PressableScale
            onPress={onDelete}
            hitSlop={8}
            style={styles.heroIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete lead"
          >
            <Ionicons name="trash-outline" size={20} color={colors.onMesh} />
          </PressableScale>
        </View>

        <View style={styles.heroIdentity}>
          <View style={styles.heroAvatar}>
            <Text style={styles.heroAvatarText}>{initials}</Text>
          </View>
          <View style={styles.heroIdentityBody}>
            <Text style={styles.heroName} numberOfLines={1}>
              {lead.customerName}
            </Text>
            <Text style={styles.heroSub} numberOfLines={1}>
              {[lead.address || 'Address pending', lead.source ? sourceLabel(lead.source) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          <HeroAction
            icon="call-outline"
            label="Call"
            disabled={!lead.customerPhone}
            primary
            onPress={onCall}
          />
          <HeroAction icon="chatbubble-outline" label="Text" disabled={!lead.customerPhone} onPress={onText} />
          <HeroAction icon="mail-outline" label="Email" disabled={!lead.customerEmail} onPress={onEmail} />
          <HeroAction icon="navigate-outline" label="Directions" onPress={onDirections} />
        </View>
      </View>

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

        {/* Insurance — the mock's label-left/value-right hairline rows
            (docs/DESIGN_1A.md §6). Carrier/claim/deductible/adjuster live on
            the linked JOB, not the lead, so this reads real data only and is
            simply absent before the lead becomes a job. */}
        {insuranceRows.length > 0 && (
          <FadeSlideIn index={2}>
            <SectionHeader title="Insurance" style={styles.sectionHeaderSpacing} />
            <View style={styles.infoCard}>
              {insuranceRows.map((row, i) => (
                <View key={row.key} style={[styles.infoRow, i > 0 && styles.infoRowBorder]}>
                  <Text style={styles.infoLabel}>{row.label}</Text>
                  <Text style={[styles.infoValue, row.mono && styles.infoValueMono]} numberOfLines={1}>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </FadeSlideIn>
        )}

        {/* Stage-progress bar — the mock's segmented royal→burnt strip
            (docs/DESIGN_1A.md §6), mapped onto the real `PIPELINE_GROUPS` a
            lead moves through. The interactive 12-stage chip picker beneath
            it is the actual control; this is the at-a-glance read. */}
        <FadeSlideIn index={2}>
          <SectionHeader title="Stage" style={styles.sectionHeaderSpacing} />
          {isLost ? (
            <View style={styles.lostBanner}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.lostBannerText}>Marked lost — pick a stage below to bring it back.</Text>
            </View>
          ) : (
            <>
              <View style={styles.progressTrack}>
                {stageGroups.map((g, i) => (
                  <View
                    key={g}
                    style={[
                      styles.progressSegment,
                      i < currentGroupIndex && styles.progressSegmentDone,
                      i === currentGroupIndex && styles.progressSegmentCurrent,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.progressLabelRow}>
                {stageGroups.map((g, i) => (
                  <Text
                    key={g}
                    numberOfLines={1}
                    style={[
                      styles.progressLabel,
                      i === currentGroupIndex && styles.progressLabelCurrent,
                      i > currentGroupIndex && styles.progressLabelAhead,
                    ]}
                  >
                    {PIPELINE_GROUP_LABELS[g]}
                  </Text>
                ))}
              </View>
            </>
          )}
        </FadeSlideIn>

        <FadeSlideIn index={2}>
          <RichCard title="Every stage" icon="git-branch-outline" iconTone="purple">
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

        <FadeSlideIn index={4}>
          <SectionHeader title="Tasks" style={styles.sectionHeaderSpacing} />
          <TasksCard itemIds={[lead.id, linkedInspection?.id]} addToItemId={lead.id} />
        </FadeSlideIn>

        {/* Timeline — real `activityStore` events for this lead (and its
            linked job), never invented event types. */}
        <LeadTimeline leadId={lead.id} inspectionId={linkedInspection?.id} />

        {/* The one accent-gradient moment on this screen. Once the lead has
            become a job, the primary action is that job — not a second one. */}
        <FadeSlideIn index={5}>
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

/**
 * Call/Text/Email/Directions — the mock's mesh-hero action row: the first
 * (primary) tile a solid paper pill, the rest glass-over-art (`theme/tokens.ts`
 * `glass.fill`/`glass.border` — never a flat white chip laid over the mesh).
 */
function HeroAction({
  icon,
  label,
  disabled,
  primary,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.heroAction, primary && styles.heroActionPrimary, disabled && styles.heroActionDisabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={18} color={primary ? colors.text : colors.onMesh} />
      <Text style={[styles.heroActionText, primary && styles.heroActionTextPrimary]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * Vertical dot-and-line activity history — real `activityStore` events for
 * this lead (and the job it became), never a new event type. Absent
 * entirely for a lead nothing has happened to yet.
 */
function LeadTimeline({ leadId, inspectionId }: { leadId: string; inspectionId?: string }) {
  const events = useActivityStore((s) => s.events);
  const items = useMemo(
    () => events.filter((e) => e.leadId === leadId || (inspectionId && e.inspectionId === inspectionId)).slice(0, 8),
    [events, leadId, inspectionId],
  );

  if (items.length === 0) return null;

  return (
    <FadeSlideIn index={5}>
      <SectionHeader title="Timeline" style={styles.sectionHeaderSpacing} />
      <View>
        {items.map((evt, i) => (
          <View key={evt.id} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: timelineDotColor(evt.kind) }]} />
              {i < items.length - 1 && <View style={styles.timelineLine} />}
            </View>
            <View style={styles.timelineBody}>
              <Text style={styles.timelineMsg} numberOfLines={2}>
                {evt.message}
              </Text>
              <Text style={styles.timelineStamp}>{timelineStamp(evt.createdAt)}</Text>
            </View>
          </View>
        ))}
      </View>
    </FadeSlideIn>
  );
}

/** Dot colour per event family — the same groupings `app/activity.tsx` colours, expressed in 1A brand tokens. */
function timelineDotColor(kind: ActivityEventKind): string {
  switch (kind) {
    case 'proposal_signed':
    case 'signature_recorded':
    case 'inspection_completed':
    case 'route_completed':
    case 'task_done':
      return colors.success;
    case 'automation_ran':
    case 'ai_calibration_updated':
      return brand.magenta;
    case 'proposal_sent':
    case 'knock_logged':
    case 'knock_converted_to_lead':
    case 'storm_alert_received':
    case 'lead_created':
    case 'stage_changed':
      return brand.burnt;
    default:
      return brand.royal;
  }
}

/** "TODAY 8:14 AM" / "23 APR 4:10 PM" — the mock's uppercase mono timestamp, via `dataLabel`'s own textTransform. */
function timelineStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
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
  recordHint: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.text, lineHeight: 18 },
  agentRow: { gap: spacing.sm, marginTop: spacing.sm },
  agentBtns: { flexDirection: 'row', gap: spacing.sm },
  agentBtn: { flex: 1, minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radii.button, backgroundColor: colors.fillQuiet },
  agentBtnText: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, color: colors.text },
  root: { flex: 1, backgroundColor: colors.bg },

  // --- Mesh hero — the "cool", no-orange cut (docs/DESIGN_1A.md §2/§6) -----
  hero: {
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    overflow: 'hidden',
    gap: spacing.lg,
  },
  heroMesh: {},
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroIconBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    marginHorizontal: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEyebrow: { ...dataLabel, flex: 1, textAlign: 'center', color: colors.onMesh, opacity: 0.75 },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroAvatar: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: brand.burnt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarText: { fontSize: fontSize.titleSm, fontFamily: fontFamily.archivo.extrabold, color: colors.textInverse },
  heroIdentityBody: { flex: 1, gap: 2 },
  heroName: { fontSize: fontSize.titleSm, fontFamily: fontFamily.archivo.extrabold, color: colors.onMesh, letterSpacing: -0.3 },
  heroSub: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.onMesh, opacity: 0.72 },
  heroActions: { flexDirection: 'row', gap: spacing.sm },
  heroAction: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.control,
    backgroundColor: glass.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border,
  },
  heroActionPrimary: { backgroundColor: colors.onMesh, borderWidth: 0 },
  heroActionDisabled: { opacity: 0.4 },
  heroActionText: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.onMesh,
  },
  heroActionTextPrimary: { color: colors.text },

  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
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
  missingTitle: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold, color: colors.text },
  missingBody: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted, lineHeight: 18, marginTop: 2 },

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
  rowLabel: { ...dataLabel, color: colors.textSubtle },
  rowValue: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.medium, color: colors.text, fontWeight: fontWeight.medium },

  sectionHeaderSpacing: { marginBottom: spacing.sm },

  // --- Insurance — label-left/value-right hairline rows (docs/DESIGN_1A.md §6) ---
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
  },
  infoRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  infoLabel: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
  infoValue: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, color: colors.text },
  infoValueMono: { ...dataLabel, color: colors.text },

  // --- Stage-progress bar — segmented, royal fill behind, burnt at the
  // current segment (docs/DESIGN_1A.md §6). ---
  progressTrack: { flexDirection: 'row', gap: spacing.xs },
  progressSegment: { flex: 1, height: 6, borderRadius: radii.sm, backgroundColor: colors.border },
  progressSegmentDone: { backgroundColor: brand.royal },
  progressSegmentCurrent: { backgroundColor: brand.burnt },
  progressLabelRow: { flexDirection: 'row', marginTop: spacing.sm },
  progressLabel: {
    flex: 1,
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.medium,
    color: colors.textMuted,
    textAlign: 'center',
  },
  progressLabelCurrent: { fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold, color: brand.burnt },
  progressLabelAhead: { color: colors.textSubtle },
  lostBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.dangerSoft,
  },
  lostBannerText: { flex: 1, fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.medium, color: colors.danger },

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
  chipText: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.semibold, color: colors.text, fontWeight: fontWeight.semibold },
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
  followUpText: { color: colors.text, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.medium, fontWeight: fontWeight.medium },

  // --- Timeline — vertical dot-and-line activity history --------------------
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { alignItems: 'center', width: 12 },
  timelineDot: { width: 11, height: 11, borderRadius: radii.pill },
  timelineLine: { flex: 1, width: 2, minHeight: 20, backgroundColor: colors.border, marginTop: 2 },
  timelineBody: { flex: 1, paddingBottom: spacing.md },
  timelineMsg: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, color: colors.text },
  timelineStamp: { ...dataLabel, marginTop: 3, color: colors.textSubtle },

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
    fontFamily: fontFamily.archivo.semibold,
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
    fontFamily: fontFamily.archivo.semibold,
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
  emptyText: { color: colors.textMuted, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular },
  textBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtnLabel: {
    color: colors.text,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },
});
