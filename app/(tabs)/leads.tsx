import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { damageScoreFromEngine, type DamageScoreResult } from '@/lib/services/damageScore';
import { resolveEngineResult } from '@/lib/services/storedEngine';
import { LinearGradient } from 'expo-linear-gradient';
import { Aurora } from '@/components/glass/Aurora';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Image } from 'expo-image';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, CHIP_TONES, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { ProgressBar, type ProgressTone } from '@/components/ui/ProgressBar';
import { SettingsAffordance } from '@/components/ui/SettingsAffordance';
import { QuickActions } from '@/components/pipeline/QuickActions';
import { FOLLOW_UP_OPTIONS, FollowUpSheet } from '@/components/pipeline/FollowUpSheet';
import { JOB_STATUS_META, JobPipelineCard } from '@/components/pipeline/JobPipelineCard';
import { recordCardUrl, recordStatusBadge } from '@/lib/services/propertyRecord';
import { daysInStage, findLinkedLead } from '@/components/pipeline/chain';
import { formatDateShort } from '@/lib/format/date';
import type { Inspection, InspectionStatus, InsuranceCarrier, Lead, LeadStage } from '@/lib/models/types';
import {
  INSURANCE_CARRIER_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  leadStageColumn,
} from '@/lib/models/types';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  gradients,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * List-view filter chips. Built from the same column set the Pipeline board
 * uses so the two views can never disagree about which stages exist — a
 * hand-written subset is how leads in the newer stages became reachable only
 * under "All".
 */
const STAGES: { id: LeadStage | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  ...[...LEAD_STAGE_ORDER, 'lost' as LeadStage].map((id) => ({
    id,
    label: LEAD_STAGE_LABELS[id],
  })),
];

/** Which object the tab is showing. Jobs are pipeline cards too — the home the audit said they never had. */
type Segment = 'leads' | 'jobs';
/** How the Leads segment lays its leads out. */
type ViewMode = 'list' | 'board';

const SEGMENT_OPTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'jobs', label: 'Jobs' },
] as const;

const VIEW_OPTIONS = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
] as const;

/**
 * Board columns, in order. `LEAD_STAGE_ORDER` is the 11 live pipeline stages
 * (Kanban PRD); `lost` is terminal so it rides at the end as a muted trailing
 * column rather than sitting inline in the happy path.
 */
const BOARD_COLUMNS: LeadStage[] = [...LEAD_STAGE_ORDER, 'lost'];

/** Stable identity so an empty column never remounts its page on re-render. */
const EMPTY_COLUMN: Lead[] = [];

export default function LeadsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ segment?: string; at?: string }>();
  const leads = useLeadStore((s) => s.leads);
  const inspections = useInspectionStore((s) => s.inspections);
  const setStageOnLead = useLeadStore((s) => s.setStage);
  const [segment, setSegment] = useState<Segment>(params.segment === 'jobs' ? 'jobs' : 'leads');
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('all');
  const [view, setView] = useState<ViewMode>('list');

  // Deep link from Plan / Home: `?segment=jobs` lands on the Jobs segment.
  // `at` is a nonce so a second push with the same segment still fires —
  // tab params persist, and a bare `segment` dependency would go stale after
  // the roofer flipped back to Leads by hand.
  useEffect(() => {
    if (params.segment === 'jobs' || params.segment === 'leads') setSegment(params.segment);
  }, [params.segment, params.at]);

  // Compared through `leadStageColumn` for the same reason the board buckets
  // that way: a lead persisted under the legacy `proposal_sent` spelling has
  // to answer to the `estimate_sent` chip, not vanish from both.
  const filtered = useMemo(
    () => (stage === 'all' ? leads : leads.filter((l) => leadStageColumn(l.stage) === stage)),
    [leads, stage],
  );

  // Real counts per chip — chip language everywhere shows honest tabular-nums
  // counts sourced from the store, never a placeholder.
  const stageCounts = useMemo(() => {
    const map = new Map<LeadStage, number>();
    for (const l of leads) {
      const col = leadStageColumn(l.stage);
      map.set(col, (map.get(col) ?? 0) + 1);
    }
    return map;
  }, [leads]);

  const switchView = (next: ViewMode) => {
    if (next === view) return;
    Haptics.selectionAsync().catch(() => {});
    setView(next);
  };

  const switchSegment = (next: Segment) => {
    if (next === segment) return;
    Haptics.selectionAsync().catch(() => {});
    setSegment(next);
  };

  const openJobs = inspections.filter((i) => i.status !== 'complete').length;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={segment === 'jobs' ? 'Jobs' : 'Leads'}
        subtitle={
          segment === 'jobs'
            ? `${inspections.length} total · ${openJobs} open`
            : `${leads.length} total`
        }
        right={
          <View style={styles.headerActions}>
            <SettingsAffordance />
            <PressableScale
              style={styles.fab}
              pressedScale={0.92}
              onPress={() => router.push(segment === 'jobs' ? '/new-job' : '/new-lead')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={segment === 'jobs' ? 'New job' : 'Add lead'}
            >
              <Ionicons name="add" size={26} color={colors.textInverse} />
            </PressableScale>
          </View>
        }
      />

      {/* Leads | Jobs — the pipeline's two objects, one tab. */}
      <Segmented options={SEGMENT_OPTIONS} value={segment} onChange={switchSegment} />

      {segment === 'jobs' ? (
        <JobsPipeline inspections={inspections} leads={leads} />
      ) : (
        <>
          {/* Always mounted, including at zero. Gating the header on
              `leads.length > 0` meant the screen's designated cinematic moment
              was missing in exactly the state a new user opens it in, leaving a
              grey void under the filter chips. Real zeros in the branded frame
              are honest AND give the screen a top. */}
          <PipelineSummary leads={leads} />

          <Segmented options={VIEW_OPTIONS} value={view} onChange={switchView} />

          {view === 'list' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {STAGES.map((s) => {
              const active = stage === s.id;
              const count = s.id === 'all' ? leads.length : stageCounts.get(s.id) ?? 0;
              return (
                <PressableScale
                  key={s.id}
                  pressedScale={0.96}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setStage(s.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${s.label}, ${count} ${count === 1 ? 'lead' : 'leads'}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {s.label}
                  </Text>
                  <Text style={[styles.chipCount, active && styles.chipCountActive]}>
                    {count}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.content}>
            {filtered.length === 0 ? (
              <FadeSlideIn style={styles.empty}>
                <Ionicons name="people-outline" size={28} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>
                  {leads.length === 0 ? 'No leads yet' : 'No leads in this stage'}
                </Text>
                <Text style={styles.emptyBody}>
                  {leads.length === 0
                    ? 'Leads from door knocks, inspections, or manual entry will appear here.'
                    : 'Try a different stage filter.'}
                </Text>
                {leads.length === 0 && (
                  // Matches the segment's FAB: the Leads segment adds a LEAD.
                  <PressableScale
                    style={styles.emptyBtn}
                    onPress={() => router.push('/new-lead')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyBtnText}>Add a lead</Text>
                  </PressableScale>
                )}
              </FadeSlideIn>
            ) : (
              <FadeSlideIn style={styles.listGroup}>
                {filtered.map((lead, i) => (
                  <View key={lead.id}>
                    {i > 0 && <View style={styles.rowSeparator} />}
                    <PressableScale
                      style={styles.leadRow}
                      pressedScale={0.98}
                      onPress={() => router.push(`/lead/${lead.id}` as any)}
                      accessibilityRole="button"
                      accessibilityLabel={`${lead.customerName}, ${lead.address}, ${
                        LEAD_STAGE_LABELS[leadStageColumn(lead.stage)]
                      }${lead.lastStormMatch ? ', storm matched' : ''}`}
                    >
                      {recordCardUrl(lead.propertyRecord) ? (
                        <Image
                          source={{ uri: recordCardUrl(lead.propertyRecord) }}
                          style={styles.leadThumb}
                          contentFit="cover"
                          transition={120}
                          accessibilityLabel="Property photo"
                        />
                      ) : (
                        <View
                          style={[
                            styles.initialDisc,
                            { backgroundColor: CHIP_TONES[avatarTone(lead.id)].bg },
                          ]}
                        >
                          <Text
                            style={[
                              styles.initialText,
                              { color: CHIP_TONES[avatarTone(lead.id)].fg },
                            ]}
                          >
                            {leadInitial(lead.customerName)}
                          </Text>
                        </View>
                      )}
                      <View style={styles.leadRowBody}>
                        <View style={styles.leadNameRow}>
                          <Text style={styles.leadName} numberOfLines={1}>
                            {lead.customerName}
                          </Text>
                          {lead.lastStormMatch && (
                            <Pill label="Storm" tone="accent" size="sm" icon="thunderstorm-outline" />
                          )}
                          {recordStatusBadge(lead.propertyRecord) && (
                            <Pill label={recordStatusBadge(lead.propertyRecord)!.label} tone={recordStatusBadge(lead.propertyRecord)!.tone} size="sm" />
                          )}
                        </View>
                        <View style={styles.leadMetaRow}>
                          <Text style={styles.leadAddress} numberOfLines={1}>
                            {lead.address}
                          </Text>
                          {stageAgeLabel(lead) && (
                            <>
                              <Text style={styles.metaDot}>·</Text>
                              <Text style={styles.metaDays} numberOfLines={1}>
                                {stageAgeLabel(lead)}
                              </Text>
                            </>
                          )}
                        </View>
                      </View>
                      <Pill
                        label={LEAD_STAGE_LABELS[leadStageColumn(lead.stage)]}
                        tone={stagePillTone(leadStageColumn(lead.stage))}
                        size="sm"
                      />
                      <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                    </PressableScale>
                  </View>
                ))}
              </FadeSlideIn>
            )}
          </ScrollView>
        </>
      ) : (
        <PipelineBoard leads={leads} onMove={setStageOnLead} />
      )}
        </>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Book — the follow-up sheet any card can open
// -----------------------------------------------------------------------------

/**
 * One follow-up flow for every card on this tab. Writes `followUpAt` through
 * the lead store, schedules the local reminder the lead screen schedules,
 * and says what it did. `null` clears.
 */
function useBookFollowUp() {
  const setFollowUp = useLeadStore((s) => s.setFollowUp);
  const toast = useToastStore((s) => s.show);
  const [target, setTarget] = useState<Lead | null>(null);

  const commit = useCallback(
    (lead: Lead, when: Date | null) => {
      setTarget(null);
      if (!when) {
        setFollowUp(lead.id, undefined);
        toast({ tone: 'info', title: 'Follow-up cleared', body: lead.customerName });
        return;
      }
      setFollowUp(lead.id, when.toISOString());
      scheduleFollowUpReminder({ leadId: lead.id, customerName: lead.customerName, date: when }).catch(
        () => {},
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast({
        tone: 'success',
        title: 'Follow-up set',
        body: `${formatDateShort(when)} · ${lead.customerName}`,
      });
    },
    [setFollowUp, toast],
  );

  return { target, open: setTarget, close: () => setTarget(null), commit };
}

// -----------------------------------------------------------------------------
// Jobs segment — every inspection as a pipeline card
// -----------------------------------------------------------------------------

type JobStageFilter = 'all' | InspectionStatus;
type JobSort = 'newest' | 'followup' | 'score';

const JOB_STAGE_CHIPS: { id: JobStageFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...(['in_progress', 'scheduled', 'complete', 'lead'] as InspectionStatus[]).map((id) => ({
    id,
    label: JOB_STATUS_META[id].label,
  })),
];

const SORT_CYCLE: JobSort[] = ['newest', 'followup', 'score'];
const SORT_LABEL: Record<JobSort, string> = {
  newest: 'Newest',
  followup: 'Follow-up due',
  score: 'Most damage',
};

/** Parse-safe epoch — unparseable dates sort to the bottom rather than throwing the order. */
function epoch(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function JobsPipeline({ inspections, leads }: { inspections: Inspection[]; leads: Lead[] }) {
  const router = useRouter();
  const events = useActivityStore((s) => s.events);
  const setStageOnLead = useLeadStore((s) => s.setStage);
  const book = useBookFollowUp();
  const [stage, setStage] = useState<JobStageFilter>('all');
  const [carrier, setCarrier] = useState<InsuranceCarrier | 'all'>('all');
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [sort, setSort] = useState<JobSort>('newest');

  // The lead behind each job, by explicit link only (see `findLinkedLead`).
  const leadByJob = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const ins of inspections) {
      const lead = findLinkedLead(ins, leads);
      if (lead) map.set(ins.id, lead);
    }
    return map;
  }, [inspections, leads]);

  // Newest event per job. The feed is stored newest-first, so the first hit wins.
  const lastActivityByJob = useMemo(() => {
    const map = new Map<string, string>();
    for (const evt of events) {
      if (evt.inspectionId && !map.has(evt.inspectionId)) map.set(evt.inspectionId, evt.createdAt);
    }
    return map;
  }, [events]);

  // Same read path as the job screen: the stored determination when it still
  // speaks for the current inputs, `honorFreeze: false` because a list
  // describes jobs as they stand.
  const scoreByJob = useMemo(() => {
    const map = new Map<string, DamageScoreResult>();
    const now = Date.now();
    for (const ins of inspections) {
      const { haag } = resolveEngineResult(ins, now, { honorFreeze: false });
      map.set(ins.id, damageScoreFromEngine(ins, haag));
    }
    return map;
  }, [inspections]);

  // Only carriers that actually appear on a job get a chip (Drift #5).
  const carriers = useMemo(() => {
    const seen = new Set<InsuranceCarrier>();
    for (const ins of inspections) if (ins.carrier) seen.add(ins.carrier);
    return [...seen];
  }, [inspections]);

  const stageCounts = useMemo(() => {
    const map = new Map<InspectionStatus, number>();
    for (const ins of inspections) map.set(ins.status, (map.get(ins.status) ?? 0) + 1);
    return map;
  }, [inspections]);

  const filtered = useMemo(() => {
    let out = inspections;
    if (stage !== 'all') out = out.filter((i) => i.status === stage);
    if (carrier !== 'all') out = out.filter((i) => i.carrier === carrier);
    if (withFollowUp) out = out.filter((i) => Boolean(leadByJob.get(i.id)?.followUpAt));
    const sorted = [...out];
    if (sort === 'newest') {
      sorted.sort((a, b) => epoch(b.createdAt) - epoch(a.createdAt));
    } else if (sort === 'followup') {
      // Soonest follow-up first; jobs with none sink.
      sorted.sort(
        (a, b) => epoch(leadByJob.get(a.id)?.followUpAt) - epoch(leadByJob.get(b.id)?.followUpAt),
      );
    } else {
      // 100 = sound, so the LOWEST score is the most damage — the job worth
      // the most to a carrier conversation. Unassessed roofs sink.
      const scoreOf = (ins: Inspection) => {
        const s = scoreByJob.get(ins.id);
        return s?.assessed ? s.score : Number.POSITIVE_INFINITY;
      };
      sorted.sort((a, b) => scoreOf(a) - scoreOf(b));
    }
    return sorted;
  }, [inspections, stage, carrier, withFollowUp, sort, leadByJob, scoreByJob]);

  const filtersActive = stage !== 'all' || carrier !== 'all' || withFollowUp;

  const cycleSort = () => {
    Haptics.selectionAsync().catch(() => {});
    setSort((s) => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length]);
  };

  return (
    <View style={styles.boardRoot}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {JOB_STAGE_CHIPS.map((s) => {
          const active = stage === s.id;
          const count = s.id === 'all' ? inspections.length : stageCounts.get(s.id) ?? 0;
          return (
            <PressableScale
              key={s.id}
              pressedScale={0.96}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setStage(s.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${s.label}, ${count} ${count === 1 ? 'job' : 'jobs'}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
              <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* Sort + the two secondary filters. Sort is a cycling chip rather
          than a menu — one thumb, no precision. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        <PressableScale
          pressedScale={0.96}
          style={styles.chip}
          onPress={cycleSort}
          accessibilityRole="button"
          accessibilityLabel={`Sorted by ${SORT_LABEL[sort]}. Tap to change.`}
        >
          <Ionicons name="swap-vertical-outline" size={16} color={colors.text} />
          <Text style={styles.chipText}>{SORT_LABEL[sort]}</Text>
        </PressableScale>
        <PressableScale
          pressedScale={0.96}
          style={[styles.chip, withFollowUp && styles.chipActive]}
          onPress={() => setWithFollowUp((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: withFollowUp }}
          accessibilityLabel="Only jobs with a follow-up set"
        >
          <Ionicons
            name="alarm-outline"
            size={16}
            color={withFollowUp ? colors.textInverse : colors.text}
          />
          <Text style={[styles.chipText, withFollowUp && styles.chipTextActive]}>Follow-up set</Text>
        </PressableScale>
        {carriers.map((c) => {
          const active = carrier === c;
          return (
            <PressableScale
              key={c}
              pressedScale={0.96}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setCarrier(active ? 'all' : c)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Carrier ${INSURANCE_CARRIER_LABELS[c]}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {INSURANCE_CARRIER_LABELS[c]}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.length === 0 ? (
          <FadeSlideIn style={styles.empty}>
            <Ionicons name="briefcase-outline" size={28} color={colors.textSubtle} />
            <Text style={styles.emptyTitle}>
              {inspections.length === 0 ? 'No jobs yet' : 'No jobs match these filters'}
            </Text>
            <Text style={styles.emptyBody}>
              {inspections.length === 0
                ? 'A job is created by New Job or by a Quick Inspection. Each one shows up here as a pipeline card.'
                : 'Clear a filter to see the rest.'}
            </Text>
            {inspections.length === 0 ? (
              <PressableScale
                style={styles.emptyBtn}
                onPress={() => router.push('/new-job')}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>Start a new job</Text>
              </PressableScale>
            ) : filtersActive ? (
              <PressableScale
                style={styles.emptyBtn}
                onPress={() => {
                  setStage('all');
                  setCarrier('all');
                  setWithFollowUp(false);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.emptyBtnText}>Clear filters</Text>
              </PressableScale>
            ) : null}
          </FadeSlideIn>
        ) : (
          filtered.map((ins, i) => {
            const lead = leadByJob.get(ins.id);
            return (
              <FadeSlideIn key={ins.id} index={Math.min(i, 6)}>
                <JobPipelineCard
                  inspection={ins}
                  lead={lead}
                  lastActivityAt={lastActivityByJob.get(ins.id)}
                  score={scoreByJob.get(ins.id)}
                  onOpen={() => router.push(`/job/${ins.id}` as any)}
                  onBook={lead ? () => book.open(lead) : undefined}
                  onContacted={
                    lead && lead.stage === 'new'
                      ? () => setStageOnLead(lead.id, 'contacted')
                      : undefined
                  }
                />
              </FadeSlideIn>
            );
          })
        )}
      </ScrollView>

      <FollowUpSheet
        visible={book.target !== null}
        title="Set follow-up"
        subtitle={book.target?.customerName}
        options={FOLLOW_UP_OPTIONS}
        clearLabel={book.target?.followUpAt ? 'Clear follow-up' : undefined}
        onPick={(when) => book.target && book.commit(book.target, when)}
        onClose={book.close}
      />
    </View>
  );
}

function leadInitial(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

/** Rotation of tile hues for the avatar disc — deterministic, not random. */
const AVATAR_TONES: ChipTone[] = ['blue', 'green', 'orange', 'purple'];

/**
 * Picks one of the four tile tones from the lead's id, so every disc has a
 * stable colour across renders/sessions without a `color` field in the model.
 * A simple string hash, not `Math.random()` — the same lead is always the
 * same colour.
 */
function avatarTone(id: string): ChipTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** Stage → Pill tone, grouped the same way `stageAccent` groups colours. */
function stagePillTone(stage: LeadStage): PillTone {
  switch (stage) {
    case 'inspection_scheduled':
    case 'inspected':
      return 'info';
    case 'proposal_sent':
    case 'estimate_sent':
    case 'invoiced':
      return 'warn';
    case 'install_scheduled':
    case 'in_progress':
      return 'accent';
    case 'signed':
    case 'completed':
    case 'paid':
      return 'success';
    case 'lost':
      return 'danger';
    case 'new':
    case 'contacted':
    default:
      return 'neutral';
  }
}

/** Stage → ProgressBar tone, for the pipeline board's per-column strip. */
function stageProgressTone(stage: LeadStage): ProgressTone {
  switch (stage) {
    case 'inspection_scheduled':
    case 'inspected':
      return 'brand';
    case 'proposal_sent':
    case 'estimate_sent':
    case 'invoiced':
      return 'warn';
    case 'install_scheduled':
    case 'in_progress':
      return 'accent';
    case 'signed':
    case 'completed':
    case 'paid':
      return 'success';
    case 'lost':
      return 'danger';
    case 'new':
    case 'contacted':
    default:
      return 'quiet';
  }
}

/** "$128.4K" / "$950" — compact, tabular-friendly currency for tight rows. */
function formatShort(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return String(Math.round(amount));
}

/** "4d in stage" / "New today" — null when the stage-change date is unknown. */
function stageAgeLabel(lead: Lead): string | null {
  const days = daysInStage(lead);
  if (days === null) return null;
  return days === 0 ? 'New today' : `${days}d in stage`;
}

/**
 * Compact pipeline header — the screen's one cinematic moment. Real
 * aggregate counts only: pipeline value is entirely omitted (not shown as
 * $0) when no lead in the pipeline carries a `value` (Drift #5).
 */
function PipelineSummary({ leads }: { leads: Lead[] }) {
  const active = useMemo(
    () => leads.filter((l) => leadStageColumn(l.stage) !== 'lost'),
    [leads],
  );
  const totalValue = useMemo(
    () => active.reduce((sum, l) => sum + (l.value ?? 0), 0),
    [active],
  );
  const dueFollowUps = useMemo(() => {
    const now = Date.now();
    return leads.filter((l) => l.followUpAt && new Date(l.followUpAt).getTime() <= now).length;
  }, [leads]);

  return (
    <FadeSlideIn style={styles.summaryWrap}>
      {/* The screen's one cinematic moment, in the onboarding's language:
          the brand sky (`gradients.stormNight`) with the same drifting
          `Aurora` the welcome flow uses, rather than another white cell on
          grey. One per screen — the list below stays light and quiet. */}
      <View style={styles.summaryHero}>
        <LinearGradient
          colors={gradients.stormNight}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Aurora transparent />
        <View style={styles.summaryRow}>
          <SummaryStat
            icon="people-outline"
            tone="blue"
            value={String(active.length)}
            label="Active leads"
          />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="alarm-outline"
            tone="orange"
            value={String(dueFollowUps)}
            label="Follow-ups due"
          />
          {totalValue > 0 && (
            <>
              <View style={styles.summaryDivider} />
              <SummaryStat
                icon="cash-outline"
                tone="green"
                value={`$${formatShort(totalValue)}`}
                label="Pipeline value"
              />
            </>
          )}
        </View>
      </View>
    </FadeSlideIn>
  );
}

function SummaryStat({
  icon,
  tone,
  value,
  label,
}: {
  icon: IoniconName;
  tone: ChipTone;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.summaryStat} accessibilityLabel={`${label}: ${value}`}>
      <IconChip name={icon} tone={tone} size="sm" />
      <View style={styles.summaryStatBody}>
        <Text style={styles.summaryValue} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.summaryLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// iOS-17 segmented control — fillQuiet track, white thumb sliding on the
// snappy spring. The wrapper keeps the ≥56pt glove target; the track itself
// is 40pt inside vertical padding, and segments extend the hit area with
// hitSlop so the effective target never shrinks.
// -----------------------------------------------------------------------------

/** iOS inset between the track edge and the thumb. */
const TRACK_INSET = 2;

/** Generic over the option id so Leads|Jobs and List|Board share one control. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const segmentWidth = Math.max(0, (trackWidth - TRACK_INSET * 2) / options.length);
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = withSpring(index * segmentWidth, motion.snappy);
  }, [index, segmentWidth, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={styles.segmentedWrap}>
      <View
        style={styles.segmentedTrack}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {trackWidth > 0 && (
          <Animated.View
            style={[styles.segmentedThumb, { width: segmentWidth }, thumbStyle]}
          />
        )}
        {options.map((s) => {
          const active = value === s.id;
          return (
            <Pressable
              key={s.id}
              style={styles.segment}
              hitSlop={{ top: 10, bottom: 10 }}
              onPress={() => onChange(s.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${s.label} view`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Pipeline board — glove-first column picker
//
// The Kanban PRD's desktop board (drag-to-change-status, hover states, 12px
// type) is unusable in gloves on a roof, so this is the PRD's own mobile
// section: ONE column on screen at a time, a chip strip to pick the column,
// horizontal swipe between columns, and an explicit "Move to…" sheet in place
// of drag-and-drop. No precision gestures anywhere.
// -----------------------------------------------------------------------------

function PipelineBoard({
  leads,
  onMove,
}: {
  leads: Lead[];
  onMove: (id: string, stage: LeadStage) => void;
}) {
  const router = useRouter();
  const toast = useToastStore((s) => s.show);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const pagerRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<(number | undefined)[]>([]);
  const [columnIndex, setColumnIndex] = useState(0);
  const [moveTarget, setMoveTarget] = useState<Lead | null>(null);
  const book = useBookFollowUp();

  /**
   * Leads bucketed by board column. `leadStageColumn` folds the legacy
   * `proposal_sent` spelling into `estimate_sent` so no lead falls off the
   * board after the stage-set was extended.
   */
  const byColumn = useMemo(() => {
    const map = new Map<LeadStage, Lead[]>();
    for (const c of BOARD_COLUMNS) map.set(c, []);
    // `?.push` drops any lead whose persisted stage is not a board column —
    // better a missing card than a card filed under a stage it isn't in.
    for (const l of leads) map.get(leadStageColumn(l.stage))?.push(l);
    // Stalest first: the lead that has sat longest is the one that needs a
    // call today. Unparseable dates sink to the bottom.
    map.forEach((bucket) => {
      bucket.sort((a, b) => (daysInStage(b) ?? -1) - (daysInStage(a) ?? -1));
    });
    return map;
  }, [leads]);

  const goToColumn = useCallback(
    (i: number) => {
      if (i < 0 || i >= BOARD_COLUMNS.length) return;
      // Adjacent taps animate natively (the neighbour page is mounted); far
      // jumps land instantly and let the fresh column's slide+fade entrance
      // carry the transition — animating through unmounted pages would flash
      // blank. Swipes still animate natively.
      const adjacent = Math.abs(i - columnIndex) === 1;
      setColumnIndex(i);
      pagerRef.current?.scrollTo({ x: i * width, animated: adjacent });
    },
    [width, columnIndex],
  );

  // Keep the active chip on screen as the column changes (tap or swipe).
  useEffect(() => {
    const x = chipOffsets.current[columnIndex];
    if (x === undefined) return;
    chipsRef.current?.scrollTo({ x: Math.max(0, x - spacing.xl), animated: true });
  }, [columnIndex]);

  // Rotation / split-view: re-anchor the pager on the current column.
  useEffect(() => {
    pagerRef.current?.scrollTo({ x: columnIndex * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onPagerSettled = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== columnIndex && next >= 0 && next < BOARD_COLUMNS.length) {
      setColumnIndex(next);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const commitMove = (lead: Lead, next: LeadStage) => {
    setMoveTarget(null);
    if (leadStageColumn(lead.stage) === next) return;
    onMove(lead.id, next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({
      tone: next === 'lost' ? 'info' : 'success',
      title: `Moved to ${LEAD_STAGE_LABELS[next]}`,
      body: lead.customerName,
    });
  };

  return (
    <View style={styles.boardRoot}>
      <ScrollView
        ref={chipsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stageStrip}
        contentContainerStyle={styles.stageStripContent}
      >
        {BOARD_COLUMNS.map((col, i) => {
          const active = i === columnIndex;
          const muted = col === 'lost';
          const count = (byColumn.get(col) ?? EMPTY_COLUMN).length;
          return (
            <PressableScale
              key={col}
              pressedScale={0.96}
              onLayout={(e) => {
                chipOffsets.current[i] = e.nativeEvent.layout.x;
              }}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => goToColumn(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${LEAD_STAGE_LABELS[col]}, ${count} ${
                count === 1 ? 'lead' : 'leads'
              }`}
            >
              <View
                style={[styles.stageChipDot, { backgroundColor: stageAccent(col) }]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.chipText,
                  muted && !active && styles.chipTextMuted,
                  active && styles.chipTextActive,
                ]}
              >
                {LEAD_STAGE_LABELS[col]}
              </Text>
              <Text style={[styles.chipCount, active && styles.chipCountActive]}>
                {count}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerSettled}
        style={styles.pager}
      >
        {BOARD_COLUMNS.map((col, i) => (
          <View key={col} style={{ width }}>
            {Math.abs(i - columnIndex) <= 1 ? (
              <ColumnPage
                stage={col}
                columnLeads={byColumn.get(col) ?? EMPTY_COLUMN}
                totalLeads={leads.length}
                onOpen={(id) => router.push(`/lead/${id}` as any)}
                onRequestMove={setMoveTarget}
                onBook={book.open}
                // A call or text from the board is contact — the same
                // new→contacted move the lead screen makes.
                onContacted={(lead) => {
                  if (lead.stage === 'new') onMove(lead.id, 'contacted');
                }}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

      <FollowUpSheet
        visible={book.target !== null}
        title="Set follow-up"
        subtitle={book.target?.customerName}
        options={FOLLOW_UP_OPTIONS}
        clearLabel={book.target?.followUpAt ? 'Clear follow-up' : undefined}
        onPick={(when) => book.target && book.commit(book.target, when)}
        onClose={book.close}
      />

      <Modal
        visible={moveTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMoveTarget(null)}
      >
        <View style={styles.sheetRoot}>
          <PressableScale
            pressedScale={1}
            style={styles.sheetBackdrop}
            onPress={() => setMoveTarget(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Move to…</Text>
            {moveTarget && (
              <Text style={styles.sheetSubtitle} numberOfLines={1}>
                {moveTarget.customerName}
              </Text>
            )}
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
            >
              {BOARD_COLUMNS.map((col) => {
                const current =
                  moveTarget !== null && leadStageColumn(moveTarget.stage) === col;
                const muted = col === 'lost';
                return (
                  <PressableScale
                    key={col}
                    pressedScale={current ? 1 : 0.97}
                    disabled={current}
                    style={[styles.sheetRow, current && styles.sheetRowCurrent]}
                    onPress={() => moveTarget && commitMove(moveTarget, col)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: current, selected: current }}
                    accessibilityLabel={
                      current
                        ? `${LEAD_STAGE_LABELS[col]}, current stage`
                        : `Move to ${LEAD_STAGE_LABELS[col]}`
                    }
                  >
                    <View
                      style={[styles.sheetRowDot, { backgroundColor: stageAccent(col) }]}
                    />
                    <Text
                      style={[
                        styles.sheetRowText,
                        muted && styles.sheetRowTextMuted,
                        current && styles.sheetRowTextCurrent,
                      ]}
                      numberOfLines={1}
                    >
                      {LEAD_STAGE_LABELS[col]}
                    </Text>
                    {current && <Text style={styles.sheetRowTag}>Current</Text>}
                  </PressableScale>
                );
              })}
            </ScrollView>
            <PressableScale
              style={styles.sheetCancel}
              onPress={() => setMoveTarget(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ColumnPage({
  stage,
  columnLeads,
  totalLeads,
  onOpen,
  onRequestMove,
  onBook,
  onContacted,
}: {
  stage: LeadStage;
  columnLeads: Lead[];
  totalLeads: number;
  onOpen: (id: string) => void;
  onRequestMove: (lead: Lead) => void;
  onBook: (lead: Lead) => void;
  onContacted: (lead: Lead) => void;
}) {
  const router = useRouter();

  // Column-change transition: pages mount fresh when the window shifts (chip
  // tap across the board), so a mount-time slide+fade on the snappy spring
  // reads as the column sliding into place. Adjacent moves animate natively
  // in the pager, so this only fires where the pager can't help.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withSpring(1, motion.snappy);
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateX: (1 - enter.value) * spacing.lg }],
  }));

  if (columnLeads.length === 0) {
    // Density: an empty column hugs its content right under the chip strip —
    // never a full-height blank page. Same compact panel language as the List
    // empty state (thin icon, ink message, one quiet action) so the two views
    // of this tab speak one empty-state dialect.
    return (
      <Animated.View style={[styles.columnEmpty, enterStyle]}>
        <Ionicons name="people-outline" size={28} color={colors.textSubtle} />
        <Text style={styles.columnEmptyText}>
          Nothing in {LEAD_STAGE_LABELS[stage]}.
        </Text>
        <Text style={styles.columnEmptyHint}>Swipe for the next stage.</Text>
        {/* A board column holds leads, so its empty action adds a lead —
            the same thing the segment's FAB does. */}
        <PressableScale
          style={styles.emptyBtn}
          onPress={() => router.push('/new-lead')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyBtnText}>Add a lead</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  // Per-stage summary strip — real count + value for this column, plus a
  // progress bar showing this stage's share of the whole pipeline.
  const columnValue = columnLeads.reduce((sum, l) => sum + (l.value ?? 0), 0);
  const columnProgress = totalLeads > 0 ? columnLeads.length / totalLeads : 0;

  return (
    <Animated.View style={[styles.columnFill, enterStyle]}>
      <View style={styles.stageSummary}>
        <View style={styles.stageSummaryRow}>
          <Text style={styles.stageSummaryCount}>
            {columnLeads.length} {columnLeads.length === 1 ? 'lead' : 'leads'}
          </Text>
          {columnValue > 0 && (
            <Text style={styles.stageSummaryValue}>${formatShort(columnValue)}</Text>
          )}
        </View>
        <ProgressBar
          progress={columnProgress}
          tone={stageProgressTone(stage)}
          height={6}
          accessibilityLabel={`${LEAD_STAGE_LABELS[stage]}, ${columnLeads.length} of ${totalLeads} leads in the pipeline`}
        />
      </View>
      <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent}>
        {columnLeads.map((lead, i) => (
          <FadeSlideIn key={lead.id} index={Math.min(i, 6)}>
            <PressableScale
              style={styles.boardCard}
              onPress={() => onOpen(lead.id)}
              accessibilityRole="button"
              accessibilityLabel={`${lead.customerName}, ${lead.address}`}
            >
              <View
                style={[styles.boardCardAccent, { backgroundColor: stageAccent(stage) }]}
              />
              <View style={styles.boardCardBody}>
                {recordCardUrl(lead.propertyRecord) ? (
                  <Image
                    source={{ uri: recordCardUrl(lead.propertyRecord) }}
                    style={styles.boardCardPhoto}
                    contentFit="cover"
                    transition={120}
                    accessibilityLabel="Property photo"
                  />
                ) : null}
                <View style={styles.boardCardTop}>
                  <Text style={styles.boardCardName} numberOfLines={1}>
                    {lead.customerName}
                  </Text>
                  <View style={styles.agePill}>
                    <Text style={styles.agePillText}>{formatAge(lead)}</Text>
                  </View>
                </View>
                <Text style={styles.boardCardAddress} numberOfLines={2}>
                  {lead.address}
                </Text>
                {recordStatusBadge(lead.propertyRecord) && (
                  <Pill
                    label={recordStatusBadge(lead.propertyRecord)!.label}
                    tone={recordStatusBadge(lead.propertyRecord)!.tone}
                    size="sm"
                    style={styles.boardCardFollowUp}
                  />
                )}
                {lead.followUpAt && (
                  <Pill
                    label={`Follow-up ${formatDateShort(lead.followUpAt)}`}
                    tone={new Date(lead.followUpAt).getTime() <= Date.now() ? 'danger' : 'info'}
                    size="sm"
                    icon="alarm-outline"
                    style={styles.boardCardFollowUp}
                  />
                )}
                {/* One-tap contact from the board — Call / Text / Email /
                    Directions / Book, each only when the lead has the field. */}
                <QuickActions
                  name={lead.customerName}
                  phone={lead.customerPhone}
                  email={lead.customerEmail}
                  address={lead.address}
                  coords={{ lat: lead.lat, lng: lead.lng }}
                  onBook={() => onBook(lead)}
                  onContacted={() => onContacted(lead)}
                  style={styles.boardCardActions}
                />
                <PressableScale
                  pressedScale={0.96}
                  style={styles.moveBtn}
                  onPress={() => onRequestMove(lead)}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${lead.customerName} to another stage`}
                >
                  <Ionicons name="swap-horizontal" size={18} color={colors.text} />
                  <Text style={styles.moveBtnText}>Move to…</Text>
                </PressableScale>
              </View>
            </PressableScale>
          </FadeSlideIn>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// `daysInStage` (stageChangedAt → updatedAt → createdAt, null when
// unparseable) moved to `components/pipeline/chain.ts` so Plan's "Going
// cold" and Home's Today module measure stage age exactly as the board does.

function formatAge(lead: Lead): string {
  const d = daysInStage(lead);
  if (d === null) return '—';
  return d === 0 ? 'today' : `${d}d`;
}

/** Board accent per column. Tokens only — never a raw hex. */
function stageAccent(stage: LeadStage): string {
  switch (stage) {
    case 'new':
      return colors.textSubtle;
    case 'contacted':
      return colors.slate;
    case 'inspection_scheduled':
    case 'inspected':
      return colors.brand;
    case 'proposal_sent':
    case 'estimate_sent':
    case 'invoiced':
      return colors.warn;
    case 'install_scheduled':
    case 'in_progress':
      return colors.accent;
    case 'signed':
    case 'completed':
    case 'paid':
      return colors.success;
    case 'lost':
      return colors.danger;
    default:
      return colors.borderStrong;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Settings affordance + FAB, 12pt apart (Drift #1 spacing between targets).
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  // 56pt royal-ink FAB with a thin white plus — orange stays reserved for the
  // screen's real primary CTA.
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },

  // --- Pipeline summary (the screen's one cinematic moment) -------------
  summaryWrap: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  summaryHero: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    padding: spacing.lg,
    // Painted under the gradient so the card is never briefly transparent.
    backgroundColor: brand.royalInk,
    ...shadows.hero,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryStatBody: { flexShrink: 1, gap: 1 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth * 2,
    height: 32,
    backgroundColor: glass.border,
    marginHorizontal: spacing.sm,
  },
  summaryValue: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.brandSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // --- iOS-17 segmented control ----------------------------------------
  segmentedWrap: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  segmentedTrack: {
    flexDirection: 'row',
    height: 40,
    borderRadius: radii.control + 2,
    backgroundColor: colors.fillQuiet,
    padding: TRACK_INSET,
  },
  segmentedThumb: {
    position: 'absolute',
    top: TRACK_INSET,
    left: TRACK_INSET,
    bottom: TRACK_INSET,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  segmentTextActive: { color: colors.text },

  // --- Chip language (shared by list filters + board strip) -------------
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipScrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  chipActive: { backgroundColor: colors.text },
  chipText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  chipTextMuted: { color: colors.textMuted },
  chipTextActive: { color: colors.textInverse },
  chipCount: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },
  chipCountActive: { color: colors.textInverse, opacity: 0.7 },
  stageChipDot: { width: 8, height: 8, borderRadius: radii.pill },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },

  // --- Lead cells (crafted rows in one inset group) ----------------------
  listGroup: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    ...shadows.raised,
  },
  leadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // Separator inset aligns with the text column: 16 padding + 40 disc + 12 gap.
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg + 40 + spacing.md,
  },
  // Tone comes from `avatarTone(lead.id)` — deterministic, not a flat grey disc.
  leadThumb: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  boardCardPhoto: { width: '100%', height: 96, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: colors.surfaceMuted },
  initialDisc: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  leadRowBody: { flex: 1, gap: 3 },
  leadNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  leadName: {
    flexShrink: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  leadMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  leadAddress: { flexShrink: 1, fontSize: fontSize.bodySm, color: colors.textMuted },
  metaDot: { fontSize: fontSize.bodySm, color: colors.textSubtle },
  metaDays: {
    flexShrink: 0,
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },

  // --- Empty state: compact, top-anchored, no tinted circle, no card -----
  empty: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  emptyBody: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Royal fill, per the spec's `brand.royal = primary interactive` rule. The
  // previous 5%-ink wash was all but invisible against the grey ground, so
  // the empty state's only action read as decoration.
  emptyBtn: {
    minHeight: touchTarget.standard,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.raised,
  },
  emptyBtnText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },

  // --- Pipeline board ---------------------------------------------------
  boardRoot: { flex: 1 },

  stageStrip: { flexGrow: 0, flexShrink: 0 },
  stageStripContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },

  pager: { flex: 1 },
  columnFill: { flex: 1 },

  // Per-stage summary strip — static header above the scrolling card list,
  // so a column's count/value/share is visible without scrolling.
  stageSummary: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  stageSummaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  stageSummaryCount: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  stageSummaryValue: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  columnScroll: { flex: 1 },
  columnContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },

  // No `overflow: hidden` here — it would clip the iOS shadow. The accent
  // bar carries its own left-side radii instead.
  boardCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    ...shadows.raised,
  },
  boardCardAccent: {
    width: 4,
    borderTopLeftRadius: radii.card,
    borderBottomLeftRadius: radii.card,
  },
  boardCardBody: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  boardCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  boardCardName: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  boardCardAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  agePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  agePillText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  boardCardFollowUp: { marginTop: spacing.xs },
  boardCardActions: { marginTop: spacing.sm },
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.md,
  },
  moveBtnText: {
    color: colors.text,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },

  // Mirrors `empty` (List view) — one empty-state language for the tab, and
  // copy dark enough to survive sunlight (no textSubtle body text).
  columnEmpty: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  columnEmptyText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  columnEmptyHint: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },

  // --- Move sheet -------------------------------------------------------
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    maxHeight: '85%',
  },
  // iOS grabber: 36×5 pill in the hairline tone.
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.hairline,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  sheetSubtitle: { fontSize: fontSize.bodySm, color: colors.textMuted },
  sheetScroll: { marginTop: spacing.md },
  sheetScrollContent: { gap: spacing.sm, paddingBottom: spacing.md },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.fillQuiet,
  },
  sheetRowCurrent: { opacity: 0.5 },
  sheetRowDot: { width: 10, height: 10, borderRadius: radii.pill },
  sheetRowText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  sheetRowTextMuted: { color: colors.textMuted },
  sheetRowTextCurrent: { color: colors.textMuted },
  sheetRowTag: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sheetCancel: {
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  sheetCancelText: {
    color: colors.text,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});
