// Pipeline — leads and jobs on ONE board (docs/PIPELINE.md). Replaces the old
// Leads | Jobs segmented screen: every `PipelineItem` from
// `lib/services/pipeline.ts` is either a lead, a job, or a linked pair shown
// as a single card, in Board (Kanban) or List form.

import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
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
  withTiming,
  runOnJS,
  useReducedMotion,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useTaskStore } from '@/lib/stores/taskStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { LinearGradient } from 'expo-linear-gradient';
import { Aurora } from '@/components/glass/Aurora';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Image } from 'expo-image';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, CHIP_TONES, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { SettingsAffordance } from '@/components/ui/SettingsAffordance';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { QuickActions } from '@/components/pipeline/QuickActions';
import { FOLLOW_UP_OPTIONS, FollowUpSheet } from '@/components/pipeline/FollowUpSheet';
import { recordStatusBadge } from '@/lib/services/propertyRecord';
import { formatDateShort } from '@/lib/format/date';
import type { LeadStage } from '@/lib/models/types';
import { leadStageColumn } from '@/lib/models/types';
import {
  buildPipeline,
  ensureLeadForInspection,
  columnSummary,
  summarizePipeline,
  matchesFilter,
  sortItems,
  stageLabel,
  stageAgeTone,
  formatMoneyShort,
  BOARD_COLUMNS,
  PIPELINE_GROUPS,
  PIPELINE_GROUP_LABELS,
  PIPELINE_SORT_LABELS,
  type PipelineItem,
  type PipelineFilter,
  type PipelineSort,
} from '@/lib/services/pipeline';
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

/** How far (px) a long-pressed card must travel to commit a column move. */
const DRAG_COMMIT_PX = 96;

type ViewMode = 'board' | 'list';

const VIEW_OPTIONS = [
  { id: 'board', label: 'Board' },
  { id: 'list', label: 'List' },
] as const;

/** List-view filter chips: All, the seven stage groups, Storm. */
const FILTER_CHIPS: { id: PipelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  ...PIPELINE_GROUPS.map((g) => ({ id: g as PipelineFilter, label: PIPELINE_GROUP_LABELS[g] })),
  { id: 'storm', label: 'Storm' },
];

const SORT_CYCLE: PipelineSort[] = ['updated', 'days', 'amount'];

/** Stable identity so an empty column never remounts its page on re-render. */
const EMPTY_COLUMN: PipelineItem[] = [];

export default function PipelineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    segment?: string;
    at?: string;
    filter?: string;
    focus?: string;
  }>();

  const leads = useLeadStore((s) => s.leads);
  const inspections = useInspectionStore((s) => s.inspections);
  const proposals = useProposalStore((s) => s.proposals);
  const estimates = useEstimateStore((s) => s.estimates);
  const tasks = useTaskStore((s) => s.tasks);
  const setStageOnLead = useLeadStore((s) => s.setStage);
  const toast = useToastStore((s) => s.show);

  const items = useMemo(
    () => buildPipeline({ leads, inspections, proposals, estimates, tasks }),
    [leads, inspections, proposals, estimates, tasks],
  );

  const [view, setView] = useState<ViewMode>('board');
  const [filter, setFilter] = useState<PipelineFilter>('all');
  const [sort, setSort] = useState<PipelineSort>('updated');
  const [query, setQuery] = useState('');
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<PipelineItem | null>(null);
  const [confirmLost, setConfirmLost] = useState<{ item: PipelineItem; stage: LeadStage } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const book = useBookFollowUp();

  // Deep link presets: `?filter=` wins outright; `?segment=jobs|leads` maps
  // onto the closest group. `at` is a nonce so a second push with the same
  // value still fires (tab params persist across visits).
  useEffect(() => {
    if (params.filter) {
      setFilter(params.filter as PipelineFilter);
    } else if (params.segment === 'jobs') {
      setFilter('jobs');
    } else if (params.segment === 'leads') {
      setFilter('leads');
    }
  }, [params.filter, params.segment, params.at]);

  // `?focus=<itemId>` (a storm-cluster tap, a notification) briefly rings the
  // matching card so the roofer's eye lands on the right one.
  useEffect(() => {
    if (!params.focus) return;
    setHighlightId(params.focus);
    const t = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(t);
  }, [params.focus, params.at]);

  const filtered = useMemo(() => {
    let out = items.filter((it) => matchesFilter(it, filter));
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((it) => `${it.customerName} ${it.address}`.toLowerCase().includes(q));
    return sortItems(out, sort);
  }, [items, filter, query, sort]);

  const summary = useMemo(() => summarizePipeline(items), [items]);

  const openItem = useCallback(
    (item: PipelineItem) => {
      if (item.leadId) router.push(`/lead/${item.leadId}` as any);
      else if (item.inspectionId) router.push(`/job/${item.inspectionId}` as any);
    },
    [router],
  );

  const applyMove = useCallback(
    (item: PipelineItem, stage: LeadStage) => {
      if (leadStageColumn(item.stage) === stage) return;
      let leadId = item.leadId;
      if (!leadId && item.inspectionId) {
        leadId = ensureLeadForInspection(item.inspectionId, stage)?.id;
      }
      if (!leadId) return;
      setStageOnLead(leadId, stage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast({
        tone: stage === 'lost' ? 'info' : 'success',
        title: `Moved to ${stageLabel(stage)}`,
        body: item.customerName,
      });
    },
    [setStageOnLead, toast],
  );

  const requestMove = useCallback(
    (item: PipelineItem, stage: LeadStage) => {
      setMoveTarget(null);
      if (leadStageColumn(item.stage) === stage) return;
      // The one destructive move on the board — asks first (Drift #1).
      if (stage === 'lost') {
        setConfirmLost({ item, stage });
        return;
      }
      applyMove(item, stage);
    },
    [applyMove],
  );

  const onContacted = useCallback(
    (item: PipelineItem) => {
      if (item.leadId && leadStageColumn(item.stage) === 'new') {
        setStageOnLead(item.leadId, 'contacted');
      }
    },
    [setStageOnLead],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Pipeline"
        subtitle={`${items.length} total · ${summary.activeCount} active`}
        right={
          <View style={styles.headerActions}>
            <SettingsAffordance />
            <PressableScale
              style={styles.fab}
              pressedScale={0.92}
              onPress={() => setNewMenuOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New lead or job"
            >
              <Ionicons name="add" size={26} color={colors.textInverse} />
            </PressableScale>
          </View>
        }
      />

      <PipelineSummaryHero summary={summary} />

      <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} />

      {view === 'board' ? (
        <BoardView
          items={items}
          onOpen={openItem}
          onRequestMove={setMoveTarget}
          onDragMove={requestMove}
          onBook={book.open}
          onContacted={onContacted}
          highlightId={highlightId}
        />
      ) : (
        <ListView
          items={filtered}
          total={items.length}
          filter={filter}
          onFilter={setFilter}
          sort={sort}
          onSort={setSort}
          query={query}
          onQuery={setQuery}
          onOpen={openItem}
          onRequestMove={setMoveTarget}
          onBook={book.open}
          onContacted={onContacted}
          highlightId={highlightId}
        />
      )}

      <FollowUpSheet
        visible={book.target !== null}
        title="Set follow-up"
        subtitle={book.target?.customerName}
        options={FOLLOW_UP_OPTIONS}
        clearLabel={book.target?.followUpAt ? 'Clear follow-up' : undefined}
        onPick={(when) => book.target && book.commit(book.target, when)}
        onClose={book.close}
      />

      <MoveSheet item={moveTarget} onPick={requestMove} onClose={() => setMoveTarget(null)} />

      <ConfirmSheet
        visible={confirmLost !== null}
        title="Mark this lost?"
        body={confirmLost ? `${confirmLost.item.customerName} moves to Lost. You can bring it back any time.` : undefined}
        confirmLabel="Mark lost"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => confirmLost && applyMove(confirmLost.item, confirmLost.stage)}
        onClose={() => setConfirmLost(null)}
      />

      <NewMenu visible={newMenuOpen} onClose={() => setNewMenuOpen(false)} />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Follow-up sheet — one flow for every card
// -----------------------------------------------------------------------------

function useBookFollowUp() {
  const setFollowUp = useLeadStore((s) => s.setFollowUp);
  const toast = useToastStore((s) => s.show);
  const [target, setTarget] = useState<PipelineItem | null>(null);

  const commit = useCallback(
    (item: PipelineItem, when: Date | null) => {
      setTarget(null);
      if (!item.leadId) return;
      if (!when) {
        setFollowUp(item.leadId, undefined);
        toast({ tone: 'info', title: 'Follow-up cleared', body: item.customerName });
        return;
      }
      setFollowUp(item.leadId, when.toISOString());
      scheduleFollowUpReminder({ leadId: item.leadId, customerName: item.customerName, date: when }).catch(
        () => {},
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast({
        tone: 'success',
        title: 'Follow-up set',
        body: `${formatDateShort(when)} · ${item.customerName}`,
      });
    },
    [setFollowUp, toast],
  );

  return { target, open: setTarget, close: () => setTarget(null), commit };
}

// -----------------------------------------------------------------------------
// Summary hero
// -----------------------------------------------------------------------------

function PipelineSummaryHero({ summary }: { summary: ReturnType<typeof summarizePipeline> }) {
  const groupLine = PIPELINE_GROUPS.filter((g) => g !== 'lost')
    .map((g) => `${summary.counts[g]} ${PIPELINE_GROUP_LABELS[g]}`)
    .join(' · ');

  return (
    <FadeSlideIn style={styles.summaryWrap}>
      <View style={styles.summaryHero}>
        <LinearGradient
          colors={gradients.stormNight}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Aurora transparent />
        <View style={styles.summaryRow}>
          <SummaryStat icon="layers-outline" tone="blue" value={String(summary.activeCount)} label="Active" />
          <View style={styles.summaryDivider} />
          <SummaryStat
            icon="trophy-outline"
            tone="green"
            value={String(summary.signedThisMonth.count)}
            label="Signed this month"
          />
          {summary.pipelineValue > 0 && (
            <>
              <View style={styles.summaryDivider} />
              <SummaryStat
                icon="cash-outline"
                tone="orange"
                value={`$${formatMoneyShort(summary.pipelineValue).replace('$', '')}`}
                label="Pipeline value"
              />
            </>
          )}
        </View>
        {groupLine.length > 0 && (
          <Text style={styles.summaryGroupLine} numberOfLines={1}>
            {groupLine}
          </Text>
        )}
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
// List view
// -----------------------------------------------------------------------------

function ListView({
  items,
  total,
  filter,
  onFilter,
  sort,
  onSort,
  query,
  onQuery,
  onOpen,
  onRequestMove,
  onBook,
  onContacted,
  highlightId,
}: {
  items: PipelineItem[];
  total: number;
  filter: PipelineFilter;
  onFilter: (f: PipelineFilter) => void;
  sort: PipelineSort;
  onSort: (s: PipelineSort) => void;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (item: PipelineItem) => void;
  onRequestMove: (item: PipelineItem) => void;
  onBook: (item: PipelineItem) => void;
  onContacted: (item: PipelineItem) => void;
  highlightId: string | null;
}) {
  const router = useRouter();

  const cycleSort = () => {
    Haptics.selectionAsync().catch(() => {});
    onSort(SORT_CYCLE[(SORT_CYCLE.indexOf(sort) + 1) % SORT_CYCLE.length]);
  };

  return (
    <View style={styles.boardRoot}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {FILTER_CHIPS.map((f) => {
          const active = filter === f.id;
          return (
            <PressableScale
              key={f.id}
              pressedScale={0.96}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onFilter(f.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={f.label}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textSubtle} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Name or address"
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>
        <PressableScale
          pressedScale={0.96}
          style={styles.sortChip}
          onPress={cycleSort}
          accessibilityRole="button"
          accessibilityLabel={`Sorted by ${PIPELINE_SORT_LABELS[sort]}. Tap to change.`}
        >
          <Ionicons name="swap-vertical-outline" size={16} color={colors.text} />
          <Text style={styles.chipText}>{PIPELINE_SORT_LABELS[sort]}</Text>
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {items.length === 0 ? (
          <FadeSlideIn style={styles.empty}>
            <Ionicons name="people-outline" size={28} color={colors.textSubtle} />
            <Text style={styles.emptyTitle}>{total === 0 ? 'Nothing in the pipeline yet' : 'Nothing matches'}</Text>
            <Text style={styles.emptyBody}>
              {total === 0
                ? 'Leads from door knocks, storms, or manual entry — and jobs from New Job — will appear here.'
                : 'Try a different filter or clear the search.'}
            </Text>
            {total === 0 && (
              <PressableScale style={styles.emptyBtn} onPress={() => router.push('/new-lead')} accessibilityRole="button">
                <Text style={styles.emptyBtnText}>Add a lead</Text>
              </PressableScale>
            )}
          </FadeSlideIn>
        ) : (
          <FadeSlideIn style={styles.listGap}>
            {items.map((item, i) => (
              <PipelineCard
                key={item.id}
                item={item}
                index={i}
                onOpen={() => onOpen(item)}
                onRequestMove={() => onRequestMove(item)}
                onBook={item.leadId ? () => onBook(item) : undefined}
                onContacted={() => onContacted(item)}
                highlighted={highlightId === item.id}
              />
            ))}
          </FadeSlideIn>
        )}
      </ScrollView>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Board view — a column per stage, swipe or chip to move between them
// -----------------------------------------------------------------------------

function BoardView({
  items,
  onOpen,
  onRequestMove,
  onDragMove,
  onBook,
  onContacted,
  highlightId,
}: {
  items: PipelineItem[];
  onOpen: (item: PipelineItem) => void;
  onRequestMove: (item: PipelineItem) => void;
  onDragMove: (item: PipelineItem, stage: LeadStage) => void;
  onBook: (item: PipelineItem) => void;
  onContacted: (item: PipelineItem) => void;
  highlightId: string | null;
}) {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const chipsRef = useRef<ScrollView>(null);
  const chipOffsets = useRef<(number | undefined)[]>([]);
  const [columnIndex, setColumnIndex] = useState(0);

  const byColumn = useMemo(() => {
    const map = new Map<LeadStage, PipelineItem[]>();
    for (const c of BOARD_COLUMNS) map.set(c, []);
    for (const it of items) map.get(leadStageColumn(it.stage))?.push(it);
    return map;
  }, [items]);

  const summaries = useMemo(() => columnSummary(items), [items]);

  // Jump to the highlighted item's column, if any.
  useEffect(() => {
    if (!highlightId) return;
    const hit = items.find((it) => it.id === highlightId);
    if (!hit) return;
    const idx = BOARD_COLUMNS.indexOf(leadStageColumn(hit.stage));
    if (idx >= 0) {
      setColumnIndex(idx);
      pagerRef.current?.scrollTo({ x: idx * width, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);

  const goToColumn = useCallback(
    (i: number) => {
      if (i < 0 || i >= BOARD_COLUMNS.length) return;
      const adjacent = Math.abs(i - columnIndex) === 1;
      setColumnIndex(i);
      pagerRef.current?.scrollTo({ x: i * width, animated: adjacent });
    },
    [width, columnIndex],
  );

  useEffect(() => {
    const x = chipOffsets.current[columnIndex];
    if (x === undefined) return;
    chipsRef.current?.scrollTo({ x: Math.max(0, x - spacing.xl), animated: true });
  }, [columnIndex]);

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
          const s = summaries.get(col)!;
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
              accessibilityLabel={`${stageLabel(col)}, ${s.count} ${s.count === 1 ? 'item' : 'items'}`}
            >
              <View style={[styles.stageChipDot, { backgroundColor: stageAccent(col) }]} />
              <Text
                numberOfLines={1}
                style={[styles.chipText, muted && !active && styles.chipTextMuted, active && styles.chipTextActive]}
              >
                {stageLabel(col)}
              </Text>
              <Text style={[styles.chipCount, active && styles.chipCountActive]}>{s.count}</Text>
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
                columnIndex={i}
                columnItems={byColumn.get(col) ?? EMPTY_COLUMN}
                summary={summaries.get(col)!}
                onOpen={onOpen}
                onRequestMove={onRequestMove}
                onDragMove={onDragMove}
                onBook={onBook}
                onContacted={onContacted}
                highlightId={highlightId}
              />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function ColumnPage({
  stage,
  columnIndex,
  columnItems,
  summary,
  onOpen,
  onRequestMove,
  onDragMove,
  onBook,
  onContacted,
  highlightId,
}: {
  stage: LeadStage;
  columnIndex: number;
  columnItems: PipelineItem[];
  summary: { count: number; total: number };
  onOpen: (item: PipelineItem) => void;
  onRequestMove: (item: PipelineItem) => void;
  onDragMove: (item: PipelineItem, stage: LeadStage) => void;
  onBook: (item: PipelineItem) => void;
  onContacted: (item: PipelineItem) => void;
  highlightId: string | null;
}) {
  const router = useRouter();

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withSpring(1, motion.snappy);
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateX: (1 - enter.value) * spacing.lg }],
  }));

  const commitDrag = useCallback(
    (item: PipelineItem, dir: 1 | -1) => {
      const nextIdx = columnIndex + dir;
      if (nextIdx < 0 || nextIdx >= BOARD_COLUMNS.length) return;
      onDragMove(item, BOARD_COLUMNS[nextIdx]);
    },
    [columnIndex, onDragMove],
  );

  if (columnItems.length === 0) {
    return (
      <Animated.View style={[styles.columnEmpty, enterStyle]}>
        <Ionicons name="people-outline" size={28} color={colors.textSubtle} />
        <Text style={styles.columnEmptyText}>Nothing in {stageLabel(stage)}.</Text>
        <Text style={styles.columnEmptyHint}>Swipe for the next stage.</Text>
        <PressableScale style={styles.emptyBtn} onPress={() => router.push('/new-lead')} accessibilityRole="button">
          <Text style={styles.emptyBtnText}>Add a lead</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.columnFill, enterStyle]}>
      <View style={styles.stageSummary}>
        <View style={styles.stageSummaryRow}>
          <Text style={styles.stageSummaryCount}>
            {summary.count} {summary.count === 1 ? 'item' : 'items'}
          </Text>
          {summary.total > 0 && <Text style={styles.stageSummaryValue}>{formatMoneyShort(summary.total)}</Text>}
        </View>
      </View>
      <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent}>
        {columnItems.map((item, i) => (
          <FadeSlideIn key={item.id} index={Math.min(i, 6)}>
            <BoardCard
              item={item}
              accent={stageAccent(stage)}
              onOpen={() => onOpen(item)}
              onRequestMove={() => onRequestMove(item)}
              onDragCommit={(dir) => commitDrag(item, dir)}
              onBook={item.leadId ? () => onBook(item) : undefined}
              onContacted={() => onContacted(item)}
              highlighted={highlightId === item.id}
            />
          </FadeSlideIn>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// -----------------------------------------------------------------------------
// Board card — draggable between adjacent columns, or the "Move →" button
// -----------------------------------------------------------------------------

function BoardCard({
  item,
  accent,
  onOpen,
  onRequestMove,
  onDragCommit,
  onBook,
  onContacted,
  highlighted,
}: {
  item: PipelineItem;
  accent: string;
  onOpen: () => void;
  onRequestMove: () => void;
  onDragCommit: (dir: 1 | -1) => void;
  onBook?: () => void;
  onContacted: () => void;
  highlighted: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const dragX = useSharedValue(0);
  const lift = useSharedValue(0);

  const fireHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const pan = Gesture.Pan()
    .enabled(!reducedMotion)
    .activateAfterLongPress(350)
    .onStart(() => {
      'worklet';
      lift.value = withSpring(1, motion.snappy);
      runOnJS(fireHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationX > DRAG_COMMIT_PX) runOnJS(onDragCommit)(1);
      else if (e.translationX < -DRAG_COMMIT_PX) runOnJS(onDragCommit)(-1);
      dragX.value = withSpring(0, motion.snappy);
      lift.value = withSpring(0, motion.snappy);
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { scale: 1 + lift.value * 0.03 }],
    zIndex: lift.value > 0.05 ? 10 : 0,
  }));

  const card = (
    <Animated.View style={dragStyle}>
      <PipelineCard
        item={item}
        variant="board"
        accent={accent}
        onOpen={onOpen}
        onRequestMove={onRequestMove}
        onBook={onBook}
        onContacted={onContacted}
        highlighted={highlighted}
      />
    </Animated.View>
  );

  if (reducedMotion) return card;
  return <GestureDetector gesture={pan}>{card}</GestureDetector>;
}

// -----------------------------------------------------------------------------
// The card — one design for board and list
// -----------------------------------------------------------------------------

function PipelineCard({
  item,
  index,
  variant = 'list',
  accent,
  onOpen,
  onRequestMove,
  onBook,
  onContacted,
  highlighted,
}: {
  item: PipelineItem;
  index?: number;
  variant?: 'board' | 'list';
  accent?: string;
  onOpen: () => void;
  onRequestMove: () => void;
  onBook?: () => void;
  onContacted: () => void;
  highlighted?: boolean;
}) {
  const glow = useSharedValue(0);
  useEffect(() => {
    if (highlighted) {
      glow.value = withTiming(1, { duration: 200 });
      const t = setTimeout(() => {
        glow.value = withTiming(0, { duration: 400 });
      }, 1400);
      return () => clearTimeout(t);
    }
    glow.value = withTiming(0, { duration: 200 });
  }, [highlighted, glow]);
  const glowStyle = useAnimatedStyle(() => ({
    borderColor: glow.value > 0.5 ? colors.brand : colors.hairline,
    borderWidth: glow.value > 0.5 ? 2 : StyleSheet.hairlineWidth,
  }));

  const tone = stageAgeTone(item);
  const badge = recordStatusBadge(item.propertyRecord);

  return (
    <Animated.View style={[styles.card, glowStyle]}>
      {variant === 'board' && accent ? <View style={[styles.cardAccent, { backgroundColor: accent }]} /> : null}
      <PressableScale
        style={styles.cardBody}
        pressedScale={0.98}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${item.customerName}, ${item.address}`}
      >
        <View style={styles.cardTopRow}>
          {item.coverUri ? (
            <Image source={{ uri: item.coverUri }} style={styles.cardThumb} contentFit="cover" transition={120} />
          ) : (
            <View style={[styles.initialDisc, { backgroundColor: CHIP_TONES[avatarTone(item.id)].bg }]}>
              <Text style={[styles.initialText, { color: CHIP_TONES[avatarTone(item.id)].fg }]}>
                {item.customerName.trim().charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.cardMain}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.customerName}
              </Text>
              {item.amount != null && <Text style={styles.cardAmount}>{formatMoneyShort(item.amount)}</Text>}
            </View>
            <Text style={styles.cardAddress} numberOfLines={1}>
              {item.address || 'Address pending'}
            </Text>
            <Text style={styles.cardNextAction} numberOfLines={1}>
              {item.nextAction}
            </Text>
          </View>
        </View>

        <View style={styles.cardBadgeRow}>
          {item.daysInStage != null && (
            <Pill
              label={item.daysInStage === 0 ? 'New today' : `${item.daysInStage}d in stage`}
              tone={tone === 'red' ? 'danger' : tone === 'amber' ? 'warn' : 'neutral'}
              size="sm"
            />
          )}
          {item.tasks.total > 0 && (
            <View style={styles.metaChip}>
              <Ionicons name="checkbox-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaChipText}>
                {item.tasks.done}/{item.tasks.total}
              </Text>
            </View>
          )}
          {item.photoCount > 0 && (
            <View style={styles.metaChip}>
              <Ionicons name="camera-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaChipText}>{item.photoCount}</Text>
            </View>
          )}
          {item.storm && <Pill label="Storm" tone="accent" size="sm" icon="thunderstorm-outline" />}
          {badge && <Pill label={badge.label} tone={badge.tone} size="sm" />}
        </View>

        <QuickActions
          name={item.customerName}
          phone={item.phone}
          email={item.email}
          address={item.address}
          coords={{ lat: item.lat, lng: item.lng }}
          onBook={onBook}
          onContacted={onContacted}
          style={styles.cardActions}
        />

        <PressableScale
          pressedScale={0.96}
          style={styles.moveBtn}
          onPress={onRequestMove}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.customerName} to another stage`}
        >
          <Text style={styles.moveBtnText}>Move</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.text} />
        </PressableScale>
      </PressableScale>
    </Animated.View>
  );
}

// -----------------------------------------------------------------------------
// Move sheet — every board column, reachable with one thumb
// -----------------------------------------------------------------------------

function MoveSheet({
  item,
  onPick,
  onClose,
}: {
  item: PipelineItem | null;
  onPick: (item: PipelineItem, stage: LeadStage) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <PressableScale
          pressedScale={1}
          style={styles.sheetBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Move to…</Text>
          {item && (
            <Text style={styles.sheetSubtitle} numberOfLines={1}>
              {item.customerName}
            </Text>
          )}
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            {BOARD_COLUMNS.map((col) => {
              const current = item !== null && leadStageColumn(item.stage) === col;
              const muted = col === 'lost';
              return (
                <PressableScale
                  key={col}
                  pressedScale={current ? 1 : 0.97}
                  disabled={current}
                  style={[styles.sheetRow, current && styles.sheetRowCurrent]}
                  onPress={() => item && onPick(item, col)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: current, selected: current }}
                  accessibilityLabel={current ? `${stageLabel(col)}, current stage` : `Move to ${stageLabel(col)}`}
                >
                  <View style={[styles.sheetRowDot, { backgroundColor: stageAccent(col) }]} />
                  <Text
                    style={[styles.sheetRowText, muted && styles.sheetRowTextMuted, current && styles.sheetRowTextCurrent]}
                    numberOfLines={1}
                  >
                    {stageLabel(col)}
                  </Text>
                  {current && <Text style={styles.sheetRowTag}>Current</Text>}
                </PressableScale>
              );
            })}
          </ScrollView>
          <PressableScale style={styles.sheetCancel} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// New lead / New job menu
// -----------------------------------------------------------------------------

function NewMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const go = (href: '/new-lead' | '/new-job') => {
    onClose();
    router.push(href);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <PressableScale
          pressedScale={1}
          style={styles.sheetBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Add to the pipeline</Text>
          <View style={styles.newMenuOptions}>
            <PressableScale style={styles.newMenuOption} onPress={() => go('/new-lead')} accessibilityRole="button">
              <IconChip name="person-add-outline" tone="blue" size="md" />
              <View style={styles.newMenuOptionBody}>
                <Text style={styles.newMenuOptionTitle}>New lead</Text>
                <Text style={styles.newMenuOptionSub}>A prospect to contact and follow up on.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
            </PressableScale>
            <PressableScale style={styles.newMenuOption} onPress={() => go('/new-job')} accessibilityRole="button">
              <IconChip name="briefcase-outline" tone="green" size="md" />
              <View style={styles.newMenuOptionBody}>
                <Text style={styles.newMenuOptionTitle}>New job</Text>
                <Text style={styles.newMenuOptionSub}>Start an inspection right away.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
            </PressableScale>
          </View>
          <PressableScale style={styles.sheetCancel} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </PressableScale>
        </View>
      </View>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// iOS-17 segmented control (Board | List)
// -----------------------------------------------------------------------------

const TRACK_INSET = 2;

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

  const change = (v: T) => {
    if (v === value) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(v);
  };

  return (
    <View style={styles.segmentedWrap}>
      <View style={styles.segmentedTrack} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        {trackWidth > 0 && <Animated.View style={[styles.segmentedThumb, { width: segmentWidth }, thumbStyle]} />}
        {options.map((s) => {
          const active = value === s.id;
          return (
            <Pressable
              key={s.id}
              style={styles.segment}
              hitSlop={{ top: 10, bottom: 10 }}
              onPress={() => change(s.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${s.label} view`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

const AVATAR_TONES: ChipTone[] = ['blue', 'green', 'orange', 'purple'];

function avatarTone(id: string): ChipTone {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** Board accent per stage. Tokens only — never a raw hex. */
function stageAccent(stage: LeadStage): string {
  switch (stage) {
    case 'new':
      return colors.textSubtle;
    case 'contacted':
      return colors.slate;
    case 'inspection_scheduled':
    case 'inspected':
      return colors.brand;
    case 'inspecting':
      return colors.accent;
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

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },

  // --- Summary hero -------------------------------------------------------
  summaryWrap: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  summaryHero: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    padding: spacing.lg,
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
  summaryGroupLine: {
    marginTop: spacing.md,
    fontSize: fontSize.caption,
    color: colors.brandSoft,
    fontVariant: ['tabular-nums'],
  },

  // --- Segmented control ---------------------------------------------------
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
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textMuted },
  segmentTextActive: { color: colors.text },

  // --- Chip language ---------------------------------------------------
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
  chipText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
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

  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  search: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  searchInput: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text, paddingVertical: spacing.sm },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },

  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxxl,
  },
  listGap: { gap: spacing.md },

  empty: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  emptyBody: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
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
  emptyBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textInverse },

  // --- Board ---------------------------------------------------------------
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

  stageSummary: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  stageSummaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
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

  columnEmpty: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.xxl, gap: spacing.sm },
  columnEmptyText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, textAlign: 'center' },
  columnEmptyHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },

  // --- The card --------------------------------------------------------
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.raised,
  },
  cardAccent: { width: 4, borderTopLeftRadius: radii.card, borderBottomLeftRadius: radii.card },
  cardBody: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  cardTopRow: { flexDirection: 'row', gap: spacing.md },
  cardThumb: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  initialDisc: { width: 52, height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  initialText: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  cardMain: { flex: 1, gap: 2, justifyContent: 'center' },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardName: { flexShrink: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  cardAmount: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  cardAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  cardNextAction: { fontSize: fontSize.bodySm, color: colors.brand, fontWeight: fontWeight.medium },
  cardBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  metaChipText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  cardActions: { marginTop: spacing.xs },
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  moveBtnText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  // --- Sheets ------------------------------------------------------------
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.xs,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.hairline,
    marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
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
  sheetRowText: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
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
  sheetCancelText: { color: colors.text, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  newMenuOptions: { gap: spacing.md, marginTop: spacing.md },
  newMenuOption: {
    minHeight: touchTarget.sticky,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.fillQuiet,
  },
  newMenuOptionBody: { flex: 1, gap: 2 },
  newMenuOptionTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  newMenuOptionSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
});
