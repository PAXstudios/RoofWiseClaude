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
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { isValidDate } from '@/lib/format/date';
import type { Lead, LeadStage } from '@/lib/models/types';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  leadStageColumn,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
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

type ViewMode = 'list' | 'pipeline';

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
  const leads = useLeadStore((s) => s.leads);
  const setStageOnLead = useLeadStore((s) => s.setStage);
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('all');
  const [view, setView] = useState<ViewMode>('list');

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

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Leads"
        subtitle={`${leads.length} total`}
        right={
          <PressableScale
            style={styles.fab}
            pressedScale={0.92}
            onPress={() => router.push('/new-lead')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add lead"
          >
            <Ionicons name="add" size={26} color={colors.textInverse} />
          </PressableScale>
        }
      />

      <ViewSegmented value={view} onChange={switchView} />

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
                  <PressableScale
                    style={styles.emptyBtn}
                    onPress={() => router.push('/new-job')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.emptyBtnText}>Start a new job</Text>
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
                      accessibilityLabel={`${lead.customerName}, ${lead.address}`}
                    >
                      <View style={styles.initialDisc}>
                        <Text style={styles.initialText}>{leadInitial(lead.customerName)}</Text>
                      </View>
                      <View style={styles.leadRowBody}>
                        <Text style={styles.leadName} numberOfLines={1}>
                          {lead.customerName}
                        </Text>
                        <Text style={styles.leadAddress} numberOfLines={1}>
                          {lead.address}
                        </Text>
                      </View>
                      <Text style={styles.leadStage} numberOfLines={1}>
                        {LEAD_STAGE_LABELS[leadStageColumn(lead.stage)]}
                      </Text>
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
    </View>
  );
}

function leadInitial(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

// -----------------------------------------------------------------------------
// iOS-17 segmented control — fillQuiet track, white thumb sliding on the
// snappy spring. The wrapper keeps the ≥56pt glove target; the track itself
// is 40pt inside vertical padding, and segments extend the hit area with
// hitSlop so the effective target never shrinks.
// -----------------------------------------------------------------------------

const SEGMENTS: { id: ViewMode; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'pipeline', label: 'Pipeline' },
];

/** iOS inset between the track edge and the thumb. */
const TRACK_INSET = 2;

function ViewSegmented({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const index = value === 'list' ? 0 : 1;
  const segmentWidth = Math.max(0, (trackWidth - TRACK_INSET * 2) / SEGMENTS.length);
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
        {SEGMENTS.map((s) => {
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
                onOpen={(id) => router.push(`/lead/${id}` as any)}
                onRequestMove={setMoveTarget}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>

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
  onOpen,
  onRequestMove,
}: {
  stage: LeadStage;
  columnLeads: Lead[];
  onOpen: (id: string) => void;
  onRequestMove: (lead: Lead) => void;
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
        <PressableScale
          style={styles.emptyBtn}
          onPress={() => router.push('/new-job')}
          accessibilityRole="button"
        >
          <Text style={styles.emptyBtnText}>Start a new job</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.columnFill, enterStyle]}>
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

/**
 * Whole days the lead has sat in its current stage.
 *
 * Precedence: `stageChangedAt` (the exact answer, written by `setStage`) →
 * `updatedAt` → `createdAt`. The fallbacks exist only for leads that predate
 * the `stageChangedAt` field; they over-report freshness, because any write
 * (a follow-up, a storm match) bumps `updatedAt`. Returns null when the
 * stored date is unparseable rather than guessing.
 */
function daysInStage(lead: Lead): number | null {
  // `stageChangedAt` is the exact answer; it is absent on leads that have not
  // moved since the field was added, so fall back to last-touch, then created.
  const raw = lead.stageChangedAt ?? lead.updatedAt ?? lead.createdAt;
  if (!isValidDate(raw)) return null;
  const ms = Date.now() - new Date(raw).getTime();
  if (ms < 0) return null;
  return Math.floor(ms / 86400000);
}

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

  // --- Lead cells (Instagram-clean rows in one inset group) --------------
  listGroup: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    ...shadows.card,
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
  initialDisc: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  leadRowBody: { flex: 1, gap: 2 },
  leadName: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  leadAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  leadStage: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: colors.textSubtle,
    maxWidth: 96,
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
  emptyBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBtnText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
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
    ...shadows.card,
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
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.sm,
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
