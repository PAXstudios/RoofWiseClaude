import {
  ScrollView,
  View,
  Text,
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
import { useLeadStore } from '@/lib/stores/leadStore';
import { useWizardPrefillStore } from '@/lib/stores/wizardPrefillStore';
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
  const setPrefill = useWizardPrefillStore((s) => s.set);
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('all');
  const [view, setView] = useState<ViewMode>('list');

  const convertToInspection = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
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
    setStageOnLead(lead.id, 'inspection_scheduled');
    router.push('/new-job');
  };

  // Compared through `leadStageColumn` for the same reason the board buckets
  // that way: a lead persisted under the legacy `proposal_sent` spelling has
  // to answer to the `estimate_sent` chip, not vanish from both.
  const filtered = useMemo(
    () => (stage === 'all' ? leads : leads.filter((l) => leadStageColumn(l.stage) === stage)),
    [leads, stage],
  );

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
            <Ionicons name="add" size={24} color={colors.textInverse} />
          </PressableScale>
        }
      />

      <View style={styles.viewToggle}>
        {(
          [
            { id: 'list' as const, label: 'List', icon: 'list-outline' as const },
            { id: 'pipeline' as const, label: 'Pipeline', icon: 'albums-outline' as const },
          ]
        ).map((v) => {
          const active = view === v.id;
          return (
            <PressableScale
              key={v.id}
              pressedScale={0.96}
              style={[styles.viewToggleBtn, active && styles.viewToggleBtnActive]}
              onPress={() => switchView(v.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${v.label} view`}
            >
              <Ionicons
                name={v.icon}
                size={18}
                color={active ? colors.textInverse : colors.navy}
              />
              <Text
                style={[styles.viewToggleText, active && styles.viewToggleTextActive]}
              >
                {v.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {view === 'list' ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {STAGES.map((s) => (
              <PressableScale
                key={s.id}
                pressedScale={0.94}
                style={[styles.chip, stage === s.id && styles.chipActive]}
                onPress={() => setStage(s.id)}
              >
                <Text style={[styles.chipText, stage === s.id && styles.chipTextActive]}>
                  {s.label}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>

          <ScrollView contentContainerStyle={styles.content}>
            {filtered.length === 0 ? (
              <FadeSlideIn style={styles.empty}>
                <Ionicons name="people-outline" size={40} color={colors.slate} />
                <Text style={styles.emptyTitle}>
                  {leads.length === 0 ? 'No leads yet' : 'No leads in this stage'}
                </Text>
                <Text style={styles.emptyBody}>
                  {leads.length === 0
                    ? 'Leads from door knocks, inspections, or manual entry will appear here.'
                    : 'Try a different stage filter.'}
                </Text>
                {leads.length === 0 && (
                  <PressableScale style={styles.cta} onPress={() => router.push('/new-job')}>
                    <Text style={styles.ctaText}>Start a new job</Text>
                  </PressableScale>
                )}
              </FadeSlideIn>
            ) : (
              filtered.map((lead, i) => (
                <FadeSlideIn key={lead.id} index={Math.min(i, 8)}>
                  <PressableScale
                    style={styles.leadCard}
                    onPress={() => router.push(`/lead/${lead.id}` as any)}
                  >
                    <View style={styles.leadHeader}>
                      <Text style={styles.leadName}>{lead.customerName}</Text>
                      <View style={[styles.stagePill, stageTone(lead.stage)]}>
                        <Text style={styles.stagePillText}>
                          {lead.stage.replace(/_/g, ' ')}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.leadAddress}>{lead.address}</Text>
                    {lead.source && (
                      <Text style={styles.leadMeta}>
                        Source: {lead.source.replace(/_/g, ' ')}
                      </Text>
                    )}
                    <PressableScale
                      pressedScale={0.96}
                      style={styles.convertBtn}
                      onPress={() => convertToInspection(lead.id)}
                    >
                      <Ionicons name="arrow-forward" size={16} color={colors.textInverse} />
                      <Text style={styles.convertBtnText}>Convert to inspection</Text>
                    </PressableScale>
                  </PressableScale>
                </FadeSlideIn>
              ))
            )}
          </ScrollView>
        </>
      ) : (
        <PipelineBoard leads={leads} onMove={setStageOnLead} />
      )}
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
      setColumnIndex(i);
      // Instant jump: a chip tap can cross ten columns, and animating through
      // unmounted pages would flash blank. Swipes still animate natively.
      pagerRef.current?.scrollTo({ x: i * width, animated: false });
    },
    [width],
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
              pressedScale={0.95}
              onLayout={(e) => {
                chipOffsets.current[i] = e.nativeEvent.layout.x;
              }}
              style={[
                styles.stageChip,
                muted && styles.stageChipMuted,
                active && styles.stageChipActive,
                active && muted && styles.stageChipActiveMuted,
              ]}
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
                  styles.stageChipText,
                  muted && styles.stageChipTextMuted,
                  active && styles.stageChipTextActive,
                ]}
              >
                {LEAD_STAGE_LABELS[col]}
              </Text>
              <View style={[styles.stageChipCount, active && styles.stageChipCountActive]}>
                <Text
                  style={[
                    styles.stageChipCountText,
                    active && styles.stageChipCountTextActive,
                  ]}
                >
                  {count}
                </Text>
              </View>
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
                    style={[
                      styles.sheetRow,
                      muted && styles.sheetRowMuted,
                      current && styles.sheetRowCurrent,
                    ]}
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
  if (columnLeads.length === 0) {
    return (
      <View style={styles.columnEmpty}>
        <Text style={styles.columnEmptyText}>
          Nothing in {LEAD_STAGE_LABELS[stage]}.
        </Text>
        <Text style={styles.columnEmptyHint}>Swipe for the next stage.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent}>
      {columnLeads.map((lead, i) => (
        <FadeSlideIn key={lead.id} index={Math.min(i, 6)}>
          <PressableScale
            style={styles.boardCard}
            onPress={() => onOpen(lead.id)}
            accessibilityRole="button"
            accessibilityLabel={`${lead.customerName}, ${lead.address}`}
          >
            <View style={[styles.boardCardAccent, { backgroundColor: stageAccent(stage) }]} />
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
                <Ionicons name="swap-horizontal" size={18} color={colors.navy} />
                <Text style={styles.moveBtnText}>Move to…</Text>
              </PressableScale>
            </View>
          </PressableScale>
        </FadeSlideIn>
      ))}
    </ScrollView>
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

function stageTone(stage: LeadStage) {
  switch (stage) {
    case 'signed':
      return { backgroundColor: colors.successSoft };
    case 'lost':
      return { backgroundColor: colors.dangerSoft };
    case 'inspection_scheduled':
    case 'inspected':
      return { backgroundColor: colors.brandSoft };
    case 'proposal_sent':
      return { backgroundColor: colors.warnSoft };
    default:
      return { backgroundColor: colors.surfaceMuted };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },

  viewToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  viewToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewToggleBtnActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  viewToggleText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  viewToggleTextActive: { color: colors.textInverse },

  chipScroll: { maxHeight: 56 },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: fontSize.bodySm, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  leadCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  leadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leadName: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, flex: 1 },
  leadAddress: { fontSize: fontSize.bodyMd, color: colors.slate },
  leadMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: spacing.xs },
  stagePill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill },
  stagePillText: { fontSize: fontSize.caption, color: colors.navy, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },

  convertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    marginTop: spacing.md,
  },
  convertBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
  cta: {
    marginTop: spacing.lg,
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  // --- Pipeline board ---------------------------------------------------
  boardRoot: { flex: 1 },

  stageStrip: { flexGrow: 0, flexShrink: 0 },
  stageStripContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  stageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageChipMuted: { backgroundColor: colors.surfaceMuted, opacity: 0.7 },
  stageChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  stageChipActiveMuted: { opacity: 1 },
  stageChipDot: { width: 10, height: 10, borderRadius: radii.pill },
  stageChipText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  stageChipTextMuted: { color: colors.textMuted },
  stageChipTextActive: { color: colors.textInverse },
  stageChipCount: {
    minWidth: 26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  stageChipCountActive: { backgroundColor: colors.brand },
  stageChipCountText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  stageChipCountTextActive: { color: colors.textInverse },

  pager: { flex: 1 },
  columnScroll: { flex: 1 },
  columnContent: {
    padding: spacing.xl,
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
    width: 6,
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
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  boardCardAddress: { fontSize: fontSize.bodyMd, color: colors.slate },
  agePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  agePillText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  moveBtnText: {
    color: colors.navy,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },

  columnEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.xs,
  },
  columnEmptyText: {
    fontSize: fontSize.bodyMd,
    color: colors.textMuted,
    textAlign: 'center',
  },
  columnEmptyHint: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
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
    paddingTop: spacing.md,
    gap: spacing.xs,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  sheetSubtitle: { fontSize: fontSize.bodyMd, color: colors.slate },
  sheetScroll: { marginTop: spacing.md },
  sheetScrollContent: { gap: spacing.sm, paddingBottom: spacing.md },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetRowMuted: { backgroundColor: colors.surface },
  sheetRowCurrent: { opacity: 0.5, borderColor: colors.borderStrong },
  sheetRowDot: { width: 12, height: 12, borderRadius: radii.pill },
  sheetRowText: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  sheetRowTextMuted: { color: colors.textMuted },
  sheetRowTextCurrent: { color: colors.textMuted },
  sheetRowTag: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
  },
  sheetCancel: {
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  sheetCancelText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});
