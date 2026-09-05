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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MeshBackground } from '@/components/ui/MeshBackground';
import { Image } from 'expo-image';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, CHIP_TONES, type ChipTone } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { QuickActions } from '@/components/pipeline/QuickActions';
import { FOLLOW_UP_OPTIONS, FollowUpSheet } from '@/components/pipeline/FollowUpSheet';
import { recordStatusBadge } from '@/lib/services/propertyRecord';
import { formatDateShort } from '@/lib/format/date';
import type { LeadStage } from '@/lib/models/types';
import { LEAD_SOURCE_LABELS, leadStageColumn } from '@/lib/models/types';
import {
  buildPipeline,
  ensureLeadForInspection,
  columnSummary,
  summarizePipeline,
  matchesFilter,
  sortItems,
  stageLabel,
  stageAgeTone,
  groupOf,
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
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/** How far (px) a long-pressed card must travel to commit a column move. */
const DRAG_COMMIT_PX = 96;

type ViewMode = 'board' | 'list';
type BoardFilter = 'all' | 'storm' | 'stale';

const VIEW_OPTIONS = [
  { id: 'board', label: 'Board' },
  { id: 'list', label: 'List' },
] as const;

/** Shared stage scopes; Storm/Stale are separate masthead refinements. */
const FILTER_CHIPS: { id: PipelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'jobs', label: 'Jobs' },
  ...PIPELINE_GROUPS.map((g) => ({ id: g as PipelineFilter, label: PIPELINE_GROUP_LABELS[g] })),
];

const SORT_CYCLE: PipelineSort[] = ['updated', 'days', 'amount'];

/** Stable identity so an empty column never remounts its page on re-render. */
const EMPTY_COLUMN: PipelineItem[] = [];
const BOARD_FILTERS: { id: BoardFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'storm', label: 'Storm' },
  { id: 'stale', label: 'Stale' },
];

export default function PipelineScreen() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Reserve room for real column content, even on SE-sized phones. Search
  // stays mounted when the available height changes (including a keyboard).
  const compact = height - insets.top - insets.bottom <= 700;
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
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all');
  const [filter, setFilter] = useState<PipelineFilter>('all');
  const [sort, setSort] = useState<PipelineSort>('updated');
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<PipelineItem | null>(null);
  const [confirmLost, setConfirmLost] = useState<{ item: PipelineItem; stage: LeadStage } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const book = useBookFollowUp();

  // Deep link presets: `?filter=` wins outright; `?segment=jobs|leads` maps
  // onto the closest group. `at` is a nonce so a second push with the same
  // value still fires (tab params persist across visits).
  useEffect(() => {
    const preset = params.filter ?? params.segment;
    if (!preset) return;
    setBoardFilter(preset === 'storm' ? 'storm' : 'all');
    setFilter(FILTER_CHIPS.find((option) => option.id === preset)?.id ?? 'all');
    setQuery('');
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
    let out = items.filter((it) => matchesFilter(it, filter)
      && (boardFilter !== 'storm' || !!it.storm)
      && (boardFilter !== 'stale' || stageAgeTone(it) !== 'quiet'));
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((it) => `${it.customerName} ${it.address}`.toLowerCase().includes(q));
    return sortItems(out, sort);
  }, [items, filter, boardFilter, query, sort]);

  const summary = useMemo(() => summarizePipeline(items), [items]);
  const activeFilterCount = Number(filter !== 'all') + Number(boardFilter !== 'all');
  const resetFilters = () => { setFilter('all'); setBoardFilter('all'); setQuery(''); };

  const cycleSort = useCallback(() => {
    setSort((current) => SORT_CYCLE[(SORT_CYCLE.indexOf(current) + 1) % SORT_CYCLE.length]);
  }, []);

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
      <PipelineMasthead
        compact={compact}
        total={items.length}
        summary={summary}
        filter={boardFilter}
        onFilter={setBoardFilter}
        sort={sort}
        onSort={cycleSort}
        onSettings={() => router.push('/settings')}
        onAdd={() => setNewMenuOpen(true)}
      />

      <View style={compact && styles.compactToolbar}>
        <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} compact={compact} />
        {compact && (
          <PressableScale
            style={[styles.filterTrigger, activeFilterCount > 0 && styles.chipActive]}
            onPress={() => setFiltersOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Pipeline filters and sort${activeFilterCount ? `, ${activeFilterCount} active filters` : ''}`}
            accessibilityState={{ expanded: filtersOpen }}
          >
            <Ionicons name="options-outline" size={18} color={activeFilterCount ? colors.textInverse : colors.text} />
            <Text style={[styles.filterTriggerText, activeFilterCount > 0 && styles.chipTextActive]}>
              {activeFilterCount ? `Filters ${activeFilterCount}` : 'Filters'}
            </Text>
          </PressableScale>
        )}
      </View>
      <PipelineFilters
        hideStages={compact}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        canReset={filter !== 'all' || boardFilter !== 'all' || !!query}
        onReset={resetFilters}
      />

      {view === 'board' ? (
        <BoardView
          items={filtered}
          filtering={filter !== 'all' || boardFilter !== 'all' || !!query.trim()}
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
          onOpen={openItem}
          onRequestMove={setMoveTarget}
          onBook={book.open}
          onContacted={onContacted}
          highlightId={highlightId}
        />
      )}

      <BottomSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Pipeline filters"
        subtitle={`${filtered.length} results · ${PIPELINE_SORT_LABELS[sort]}`}
        footer={(
          <PressableScale style={styles.emptyBtn} onPress={() => setFiltersOpen(false)} accessibilityRole="button" accessibilityLabel="Show pipeline results">
            <Text style={styles.emptyBtnText}>Show results</Text>
          </PressableScale>
        )}
      >
        <Text style={styles.filterSectionLabel}>Focus</Text>
        <View style={styles.sheetFilterChoices}>
          {BOARD_FILTERS.map((option) => (
            <PressableScale key={option.id} style={[styles.chip, boardFilter === option.id && styles.chipActive]} onPress={() => setBoardFilter(option.id)} accessibilityRole="button" accessibilityState={{ selected: boardFilter === option.id }}>
              <Text style={[styles.chipText, boardFilter === option.id && styles.chipTextActive]}>{option.label}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={styles.filterSectionLabel}>Stage</Text>
        <View style={styles.sheetFilterChoices}>
          {FILTER_CHIPS.map((option) => (
            <PressableScale key={option.id} style={[styles.chip, filter === option.id && styles.chipActive]} onPress={() => setFilter(option.id)} accessibilityRole="button" accessibilityState={{ selected: filter === option.id }}>
              <Text style={[styles.chipText, filter === option.id && styles.chipTextActive]}>{option.label}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={styles.filterSectionLabel}>Sort</Text>
        <View style={styles.sheetFilterChoices}>
          {SORT_CYCLE.map((option) => (
            <PressableScale key={option} style={[styles.chip, sort === option && styles.chipActive]} onPress={() => setSort(option)} accessibilityRole="button" accessibilityState={{ selected: sort === option }}>
              <Text style={[styles.chipText, sort === option && styles.chipTextActive]}>{PIPELINE_SORT_LABELS[option]}</Text>
            </PressableScale>
          ))}
        </View>
        <PressableScale style={styles.sortChip} onPress={resetFilters} accessibilityRole="button" accessibilityLabel="Clear search and all pipeline filters">
          <Text style={styles.chipText}>Reset filters and search</Text>
        </PressableScale>
      </BottomSheet>

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
// Reference-matched Pipeline masthead
// -----------------------------------------------------------------------------

function PipelineMasthead({
  compact,
  total,
  summary,
  filter,
  onFilter,
  sort,
  onSort,
  onSettings,
  onAdd,
}: {
  compact: boolean;
  total: number;
  summary: ReturnType<typeof summarizePipeline>;
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
  sort: PipelineSort;
  onSort: () => void;
  onSettings: () => void;
  onAdd: () => void;
}) {
  return (
    <View style={[styles.pipelineMasthead, compact && styles.compactMasthead]} testID="pipeline-masthead">
      <MeshBackground variant="night" />
      <View style={styles.mastheadTopRow}>
        <View style={styles.mastheadHeading}>
          <Text style={styles.summaryEyebrow}>CRM · PIPELINE</Text>
          {compact && <Text style={[styles.mastheadTitle, styles.compactTitle]}>Pipeline</Text>}
        </View>
        <View style={styles.mastheadActions}>
          <PressableScale style={styles.mastheadIconBtn} onPress={onSettings} accessibilityRole="button" accessibilityLabel="Settings">
            <Ionicons name="settings-outline" size={19} color={colors.onMesh} />
          </PressableScale>
          <PressableScale style={styles.mastheadIconBtn} onPress={onAdd} accessibilityRole="button" accessibilityLabel="New lead or job">
            <Ionicons name="add" size={22} color={colors.onMesh} />
          </PressableScale>
        </View>
      </View>
      {!compact && <Text style={styles.mastheadTitle}>Pipeline</Text>}
      <Text style={styles.mastheadSubtitle}>
        {total} total · {summary.activeCount} active
        {summary.pipelineValue > 0 ? ` · ${formatMoneyShort(summary.pipelineValue)} pipeline value` : ''}
      </Text>
      {!compact && <View style={styles.mastheadControls}>
        <View style={styles.mastheadFilters}>
          {BOARD_FILTERS.map((option) => {
            const active = filter === option.id;
            return (
              <PressableScale
                key={option.id}
                style={[styles.mastheadFilter, active && styles.mastheadFilterActive]}
                onPress={() => onFilter(option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.mastheadFilterText, active && styles.mastheadFilterTextActive]}>{option.label}</Text>
              </PressableScale>
            );
          })}
        </View>
        <PressableScale style={styles.mastheadSort} onPress={onSort} accessibilityRole="button" accessibilityLabel={`Sort: ${PIPELINE_SORT_LABELS[sort]}`}>
          <Ionicons name="swap-vertical-outline" size={15} color={colors.onMesh} />
          <Text style={styles.mastheadSortText}>{sort === 'updated' ? 'Updated' : sort === 'days' ? 'Age' : 'Amount'}</Text>
        </PressableScale>
      </View>}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Shared filters — changing view never changes the selected work
// -----------------------------------------------------------------------------

function PipelineFilters({
  hideStages = false,
  filter,
  onFilter,
  query,
  onQuery,
  canReset,
  onReset,
}: {
  hideStages?: boolean;
  filter: PipelineFilter;
  onFilter: (f: PipelineFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  canReset: boolean;
  onReset: () => void;
}) {
  return (
    <View>
      {!hideStages && <ScrollView
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
      </ScrollView>}

      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textSubtle} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Name or address"
            accessibilityLabel="Search pipeline by name or address"
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        {canReset && <PressableScale
          pressedScale={0.96}
          style={styles.sortChip}
          onPress={onReset}
          accessibilityRole="button"
          accessibilityLabel="Clear search and all pipeline filters"
        >
          <Text style={styles.chipText}>Reset</Text>
        </PressableScale>}
      </View>
    </View>
  );
}

function ListView({
  items,
  total,
  onOpen,
  onRequestMove,
  onBook,
  onContacted,
  highlightId,
}: {
  items: PipelineItem[];
  total: number;
  onOpen: (item: PipelineItem) => void;
  onRequestMove: (item: PipelineItem) => void;
  onBook: (item: PipelineItem) => void;
  onContacted: (item: PipelineItem) => void;
  highlightId: string | null;
}) {
  const router = useRouter();
  return (
      <ScrollView style={styles.boardRoot} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
  );
}

// -----------------------------------------------------------------------------
// Board view — a column per stage, swipe or chip to move between them
// -----------------------------------------------------------------------------

function BoardView({
  items,
  filtering,
  onOpen,
  onRequestMove,
  onDragMove,
  onBook,
  onContacted,
  highlightId,
}: {
  items: PipelineItem[];
  filtering: boolean;
  onOpen: (item: PipelineItem) => void;
  onRequestMove: (item: PipelineItem) => void;
  onDragMove: (item: PipelineItem, stage: LeadStage) => void;
  onBook: (item: PipelineItem) => void;
  onContacted: (item: PipelineItem) => void;
  highlightId: string | null;
}) {
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(286, Math.max(252, width * 0.74));

  const byColumn = useMemo(() => {
    const map = new Map<LeadStage, PipelineItem[]>();
    for (const c of BOARD_COLUMNS) map.set(c, []);
    for (const it of items) map.get(leadStageColumn(it.stage))?.push(it);
    return map;
  }, [items]);

  const summaries = useMemo(() => columnSummary(items), [items]);
  // A scoped board should open on its matching work, not on empty New columns.
  // Hidden stages make drag destinations ambiguous; scoped cards use Move stage.
  const columns = filtering ? BOARD_COLUMNS.filter((col) => byColumn.get(col)?.length) : BOARD_COLUMNS;

  return (
    <View style={styles.boardRoot}>
      {filtering && columns.length > 0 && (
        <Text style={styles.columnEmptyHint}>Filtered view · use Move stage to move cards.</Text>
      )}
      {columns.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing matches</Text>
          <Text style={styles.emptyBody}>Try a different filter or clear the search.</Text>
        </View>
      )}
      <ScrollView
        key={columns.join('|')}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.kanbanScroll}
        contentContainerStyle={styles.kanbanColumns}
        snapToInterval={columnWidth + spacing.md}
        snapToAlignment="start"
        decelerationRate="fast"
        directionalLockEnabled
        testID="pipeline-kanban"
        keyboardShouldPersistTaps="handled"
      >
        {columns.map((col) => (
          <View key={col} style={[styles.kanbanColumn, { width: columnWidth }] }>
            <ColumnPage
              stage={col}
              columnIndex={BOARD_COLUMNS.indexOf(col)}
              dragEnabled={!filtering}
              columnItems={byColumn.get(col) ?? EMPTY_COLUMN}
              summary={summaries.get(col)!}
              onOpen={onOpen}
              onRequestMove={onRequestMove}
              onDragMove={onDragMove}
              onBook={onBook}
              onContacted={onContacted}
              highlightId={highlightId}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function ColumnPage({
  stage,
  columnIndex,
  dragEnabled,
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
  dragEnabled: boolean;
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
      if (!dragEnabled) return;
      const nextIdx = columnIndex + dir;
      if (nextIdx < 0 || nextIdx >= BOARD_COLUMNS.length) return;
      onDragMove(item, BOARD_COLUMNS[nextIdx]);
    },
    [columnIndex, dragEnabled, onDragMove],
  );

  return (
    <Animated.View style={[styles.columnFill, enterStyle]}>
      <View style={styles.stageSummary}>
        <View style={styles.stageSummaryRow}>
          <View style={[styles.stageHeadingDot, { backgroundColor: stageAccent(stage) }]} />
          <Text style={styles.stageHeading} numberOfLines={1}>{stageLabel(stage)}</Text>
          <View style={styles.stageCountBadge}><Text style={styles.stageCountText}>{summary.count}</Text></View>
          <View style={{ flex: 1 }} />
          {summary.total > 0 && <Text style={styles.stageSummaryValue}>{formatMoneyShort(summary.total)}</Text>}
        </View>
      </View>
      <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent} testID={`pipeline-column-${stage}`} keyboardShouldPersistTaps="handled">
        {columnItems.length === 0 && (
          <View style={styles.columnEmpty}>
            <Text style={styles.columnEmptyText}>Nothing in {stageLabel(stage)}.</Text>
            <Text style={styles.columnEmptyHint}>Swipe for the next stage.</Text>
            <PressableScale style={styles.emptyBtn} onPress={() => router.push('/new-lead')} accessibilityRole="button">
              <Text style={styles.emptyBtnText}>Add a lead</Text>
            </PressableScale>
          </View>
        )}
        {columnItems.map((item, i) => (
          <FadeSlideIn key={item.id} index={Math.min(i, 6)}>
            <BoardCard
              item={item}
              dragEnabled={dragEnabled}
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
  dragEnabled,
  accent,
  onOpen,
  onRequestMove,
  onDragCommit,
  onBook,
  onContacted,
  highlighted,
}: {
  item: PipelineItem;
  dragEnabled: boolean;
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
    .enabled(dragEnabled && !reducedMotion)
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

  if (!dragEnabled || reducedMotion) return card;
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
  // The mock's 07 · Pipeline board Signed column: cards go solid ink-fill,
  // amount picked out in burnt-light — the one place the board celebrates
  // instead of nagging (docs/DESIGN_1A.md §6). Board only, so the dense List
  // view keeps its flat white-card language.
  const dark = variant === 'board' && leadStageColumn(item.stage) === 'signed';
  const topBadge = cardTopBadge(item, tone);
  const origin = pipelineOrigin(item);

  return (
    <Animated.View style={[styles.card, dark && styles.cardDark, glowStyle]}>
      {variant === 'board' && accent && !dark ? <View style={[styles.cardAccent, { backgroundColor: accent }]} /> : null}
      <View style={styles.cardBody}>
      <PressableScale
        style={styles.cardOpen}
        pressedScale={0.98}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${item.customerName}, ${item.address}`}
      >
        {/* Top-left status chip — the mock's "78 SEVERE" / report-id language,
            mapped onto the board's own real signals (age, a viewed proposal)
            rather than a fabricated score. */}
        {(topBadge || item.reportId) && (
          <View style={styles.cardTopBadgeRow}>
            {topBadge ? (
              <View style={[styles.topBadge, { backgroundColor: topBadge.bg }]}>
                <Text style={[styles.topBadgeText, { color: topBadge.fg }]}>{topBadge.label}</Text>
              </View>
            ) : null}
            {item.reportId ? (
              <Text style={[styles.topBadgeId, dark && styles.topBadgeIdDark]}>{item.reportId}</Text>
            ) : null}
          </View>
        )}

        <View style={styles.cardTopRow}>
          {item.coverUri ? (
            <Image source={{ uri: item.coverUri }} style={styles.cardThumb} contentFit="cover" transition={120} />
          ) : (
            <View
              style={[
                styles.initialDisc,
                dark ? styles.initialDiscDark : { backgroundColor: CHIP_TONES[avatarTone(item.id)].bg },
              ]}
            >
              <Text
                style={[
                  styles.initialText,
                  dark ? styles.initialTextDark : { color: CHIP_TONES[avatarTone(item.id)].fg },
                ]}
              >
                {item.customerName.trim().charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.cardMain}>
            <View style={styles.cardNameRow}>
              <Text style={[styles.cardName, dark && styles.cardNameDark]} numberOfLines={1}>
                {item.customerName}
              </Text>
              {item.amount != null && (
                <Text style={[styles.cardAmount, dark && styles.cardAmountDark]}>{formatMoneyShort(item.amount)}</Text>
              )}
            </View>
            <Text style={[styles.cardAddress, dark && styles.cardAddressDark]} numberOfLines={1}>
              {item.address || 'Address pending'}
            </Text>
            <Text style={[styles.cardNextAction, dark && styles.cardNextActionDark]} numberOfLines={1}>
              {item.nextAction}
            </Text>
          </View>
        </View>

        <View style={styles.cardBadgeRow}>
          <View style={[styles.metaChip, dark && styles.metaChipDark]}>
            <Ionicons name={origin.icon} size={13} color={dark ? colors.onMesh : colors.textMuted} />
            <Text style={[styles.metaChipText, dark && styles.metaChipTextDark]}>{origin.label}</Text>
          </View>
          {item.daysInStage != null && (
            <Pill
              label={item.daysInStage === 0 ? 'New today' : `${item.daysInStage}d in stage`}
              tone={tone === 'red' ? 'danger' : tone === 'amber' ? 'warn' : 'neutral'}
              size="sm"
            />
          )}
          {item.tasks.total > 0 && (
            <View style={[styles.metaChip, dark && styles.metaChipDark]}>
              <Ionicons name="checkbox-outline" size={13} color={dark ? colors.onMesh : colors.textMuted} />
              <Text style={[styles.metaChipText, dark && styles.metaChipTextDark]}>
                {item.tasks.done}/{item.tasks.total}
              </Text>
            </View>
          )}
          {item.photoCount > 0 && (
            <View style={[styles.metaChip, dark && styles.metaChipDark]}>
              <Ionicons name="camera-outline" size={13} color={dark ? colors.onMesh : colors.textMuted} />
              <Text style={[styles.metaChipText, dark && styles.metaChipTextDark]}>{item.photoCount}</Text>
            </View>
          )}
          {item.storm && <Pill label="Storm" tone="accent" size="sm" icon="thunderstorm-outline" />}
          {badge && <Pill label={badge.label} tone={badge.tone} size="sm" />}
        </View>
      </PressableScale>

        {variant === 'list' ? (
          <QuickActions
            name={item.customerName}
            phone={item.phone}
            email={item.email}
            address={item.address}
            coords={{ lat: item.lat, lng: item.lng }}
            onBook={onBook}
            onContacted={onContacted}
            tone={dark ? 'dark' : 'light'}
            style={styles.cardActions}
          />
        ) : null}

        <PressableScale
          pressedScale={0.96}
          style={[styles.moveBtn, dark && styles.moveBtnDark]}
          onPress={onRequestMove}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.customerName} to another stage`}
        >
          <Text style={[styles.moveBtnText, dark && styles.moveBtnTextDark]}>
            {variant === 'board' ? 'Move stage' : 'Move'}
          </Text>
          <Ionicons name="arrow-forward" size={16} color={dark ? colors.onMesh : colors.text} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

/**
 * The card's top-left status chip. Mapped onto signals the board already
 * computes — a cooling lead's age (`stageAgeTone`, the board's own urgency
 * clock) takes priority, then a proposal the homeowner has actually opened —
 * never a fabricated severity score the pipeline has no data for.
 */
function cardTopBadge(
  item: PipelineItem,
  tone: ReturnType<typeof stageAgeTone>,
): { label: string; bg: string; fg: string } | undefined {
  if (tone === 'red' && item.daysInStage != null) {
    return { label: `${item.daysInStage}D STALE`, bg: colors.dangerSoft, fg: colors.danger };
  }
  if (tone === 'amber' && item.daysInStage != null) {
    return { label: `${item.daysInStage}D IN STAGE`, bg: colors.warnSoft, fg: colors.warn };
  }
  if (item.proposalStatus === 'viewed') {
    return { label: 'Viewed', bg: colors.infoSoft, fg: brand.royalDeep };
  }
  return undefined;
}

/** Make the source of every pipeline record explicit without inventing data. */
function pipelineOrigin(item: PipelineItem): { label: string; icon: keyof typeof Ionicons.glyphMap } {
  if (!item.leadId && item.inspectionId) return { label: 'Job', icon: 'briefcase-outline' };
  if (item.source === 'knock') return { label: 'Door knock', icon: 'footsteps-outline' };
  if (item.source) return { label: LEAD_SOURCE_LABELS[item.source], icon: 'person-outline' };
  return { label: item.inspectionId ? 'Lead + job' : 'Lead', icon: 'person-outline' };
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
  compact = false,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  compact?: boolean;
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
    <View style={[styles.segmentedWrap, compact && styles.compactSegmentedWrap]}>
      <View style={styles.segmentedTrack} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        {trackWidth > 0 && <Animated.View style={[styles.segmentedThumb, { width: segmentWidth }, thumbStyle]} />}
        {options.map((s) => {
          const active = value === s.id;
          return (
            <Pressable
              key={s.id}
              style={styles.segment}
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

/**
 * Board accent per stage — tokens only, never a raw hex. Follows the mock's
 * 07 · Pipeline board dot colours (docs/DESIGN_1A.md §6): New/Contacted and
 * everything still pre-estimate reads royal, the estimate/proposal columns
 * read burnt, and every won-or-later column (through Lost, which keeps its
 * own semantic red) reads success green. Derived from `groupOf()` — the same
 * grouping the filter chips and the summary hero already use — so the board
 * and the chips never disagree about which family a stage belongs to.
 */
function stageAccent(stage: LeadStage): string {
  if (stage === 'lost') return colors.danger;
  switch (groupOf(stage)) {
    case 'leads':
    case 'inspecting':
      return brand.royal;
    case 'estimating':
      return brand.burnt;
    case 'sold':
    case 'production':
    case 'done':
      return colors.success;
    default:
      return colors.borderStrong;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // --- Full-width reference masthead --------------------------------------
  pipelineMasthead: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    overflow: 'hidden',
    backgroundColor: brand.royalInk,
  },
  mastheadTopRow: { flexDirection: 'row', alignItems: 'center' },
  mastheadHeading: { flex: 1 },
  summaryEyebrow: { ...dataLabel, color: colors.onMesh, opacity: 0.68 },
  compactMasthead: { paddingTop: spacing.md, paddingBottom: spacing.md },
  compactTitle: { fontSize: fontSize.titleXl },
  compactToolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  compactSegmentedWrap: { flex: 1, paddingHorizontal: 0, paddingVertical: 0 },
  filterTrigger: { minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.button, backgroundColor: colors.fillQuiet },
  filterTriggerText: { color: colors.text, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm },
  filterSectionLabel: { ...dataLabel, marginTop: spacing.sm, marginBottom: spacing.sm },
  sheetFilterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  mastheadActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mastheadIconBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.borderStrong,
  },
  mastheadTitle: {
    marginTop: spacing.xs,
    fontSize: fontSize.display,
    fontFamily: fontFamily.archivo.extrabold,
    fontWeight: fontWeight.extrabold,
    color: colors.onMesh,
    letterSpacing: -0.8,
  },
  mastheadSubtitle: {
    marginTop: 2,
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.onMesh,
    opacity: 0.72,
    fontVariant: ['tabular-nums'],
  },
  mastheadControls: { marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mastheadFilters: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  mastheadFilter: {
    minHeight: touchTarget.standard,
    minWidth: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.fillHigh,
  },
  mastheadFilterActive: { backgroundColor: colors.surface },
  mastheadFilterText: { color: colors.onMesh, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.caption },
  mastheadFilterTextActive: { color: colors.text },
  mastheadSort: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: glass.fillHigh,
  },
  mastheadSortText: { color: colors.onMesh, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.caption },

  // --- Segmented control ---------------------------------------------------
  segmentedWrap: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  segmentedTrack: {
    flexDirection: 'row',
    height: touchTarget.standard + TRACK_INSET * 2,
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
  segmentText: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
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
  chipText: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  chipTextMuted: { color: colors.textMuted },
  chipTextActive: { color: colors.textInverse },
  chipCount: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.semibold,
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
  searchInput: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
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
  emptyTitle: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  emptyBody: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
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
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },

  // --- Board ---------------------------------------------------------------
  boardRoot: { flex: 1 },
  kanbanScroll: { flex: 1 },
  kanbanColumns: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  kanbanColumn: {
    borderRadius: radii.card,
    backgroundColor: colors.surfaceMuted,
  },
  columnFill: { flex: 1 },

  stageSummary: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  stageSummaryRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stageHeadingDot: { width: 8, height: 8, borderRadius: radii.pill },
  stageHeading: {
    maxWidth: 148,
    color: colors.text,
    fontFamily: fontFamily.archivo.bold,
    fontSize: fontSize.bodySm,
    textTransform: 'uppercase',
    letterSpacing: 0.25,
  },
  stageCountBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fillQuiet,
  },
  stageCountText: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: fontSize.caption },
  stageSummaryCount: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  stageSummaryValue: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.bold,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  columnScroll: { flex: 1 },
  columnContent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },

  columnEmpty: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.xxl, gap: spacing.sm },
  columnEmptyText: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  columnEmptyHint: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },

  // --- The card --------------------------------------------------------
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.raised,
  },
  // Signed column, board view only — solid ink fill, the one card on the
  // board that celebrates instead of nagging (docs/DESIGN_1A.md §6).
  cardDark: { backgroundColor: brand.royalInk, borderColor: brand.royalInk },
  cardAccent: { width: 4, borderTopLeftRadius: radii.card, borderBottomLeftRadius: radii.card },
  cardBody: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  cardOpen: { gap: spacing.sm },

  // Top-left status chip row — the mock's "78 SEVERE · RW-2841" language.
  cardTopBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.control },
  topBadgeText: { ...dataLabel },
  topBadgeId: { ...dataLabel, color: colors.textSubtle },
  topBadgeIdDark: { color: colors.onMesh, opacity: 0.6 },

  cardTopRow: { flexDirection: 'row', gap: spacing.md },
  cardThumb: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  initialDisc: { width: 52, height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  // Dark-card avatar picks up the brand-burnt fill the mock uses for the
  // Lead Detail header chip — the one warm accent against the ink ground.
  initialDiscDark: { backgroundColor: brand.burnt },
  initialText: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold },
  initialTextDark: { color: colors.textInverse },
  cardMain: { flex: 1, gap: 2, justifyContent: 'center' },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardName: {
    flexShrink: 1,
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  cardNameDark: { color: colors.onMesh },
  cardAmount: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.bold,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // "…the amount in brand.burntLight" (docs/DESIGN_1A.md §6).
  cardAmountDark: { color: brand.burntLight },
  cardAddress: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
  cardAddressDark: { color: colors.onMesh, opacity: 0.7 },
  cardNextAction: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.medium,
    color: colors.brand,
    fontWeight: fontWeight.medium,
  },
  cardNextActionDark: { color: colors.onMesh, opacity: 0.7 },
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
  metaChipDark: { backgroundColor: glass.fill },
  metaChipText: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  metaChipTextDark: { color: colors.onMesh },
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
  moveBtnDark: { backgroundColor: glass.fill },
  moveBtnText: {
    color: colors.text,
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
  },
  moveBtnTextDark: { color: colors.onMesh },

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
  sheetTitle: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold, color: colors.text },
  sheetSubtitle: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
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
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  sheetRowTextMuted: { color: colors.textMuted },
  sheetRowTextCurrent: { color: colors.textMuted },
  sheetRowTag: { ...dataLabel, color: colors.textSubtle },
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
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
  },

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
  newMenuOptionTitle: { fontSize: fontSize.bodyLg, fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold, color: colors.text },
  newMenuOptionSub: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
});
