// Proposal tab — every saved proposal for this job (PDF / Sign / Share, a
// watermarked preview, edit, delete), the Acceptance block once one is
// signed, the Budget card, and the work-order / material-list documents.
//
// "Sign" replicates app/proposal/[jobId].tsx's explicit Accept-&-sign
// semantics exactly (same store writes, same activity log entry, same
// forward-only lead advance) — see the header comment there. "Build
// proposal" and each card's "Edit" push to that SAME screen, which already
// knows how to auto-create a draft and edit one in place; `proposalId` is a
// small additive param added there so Edit can open a SPECIFIC saved
// proposal rather than always the newest.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { PressableScale } from '@/components/PressableScale';
import { SignaturePad } from '@/components/SignaturePad';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { formatDateTime, formatRelative } from '@/lib/format/date';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { usePricingStore } from '@/lib/stores/pricingStore';
import { useBudgetStore } from '@/lib/stores/budgetStore';
import { nextStageFor, type ChainEvent } from '@/components/pipeline/chain';
import {
  effectiveStatus,
  proposalCreatedAt,
  PROPOSAL_STATUS_LABELS,
  useEstimateForJob,
  useProposalsForJob,
} from '@/lib/services/proposals';
import { generateProposalPdf } from '@/lib/services/proposalPdf';
import {
  generateMaterialListPdf,
  generateWorkOrderPdf,
  sharePdf,
  type JobDocumentContext,
} from '@/lib/services/workOrderPdf';
import {
  budgetSummary,
  contractPriceFor,
  formatMoney,
  formatPct,
  projectedFromEstimate,
  projectedFromProposal,
} from '@/lib/services/budget';
import { BUDGET_KIND_LABELS, BUDGET_KINDS, type BudgetKind, type Inspection, type Lead, type Proposal } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

const STATUS_TONE: Record<Proposal['status'], PillTone> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  signed: 'success',
  declined: 'danger',
  expired: 'warn',
};

const BAND_COLOR: Record<'green' | 'amber' | 'red' | 'none', { bg: string; fg: string }> = {
  green: { bg: colors.successSoft, fg: colors.success },
  amber: { bg: colors.warnSoft, fg: colors.warn },
  red: { bg: colors.dangerSoft, fg: colors.danger },
  none: { bg: colors.fillQuiet, fg: colors.textMuted },
};

type Props = {
  inspection: Inspection;
  linkedLead?: Lead;
  onBuildProposal: () => void;
  onEditProposal: (proposalId: string) => void;
};

export function ProposalTab({ inspection, linkedLead, onBuildProposal, onEditProposal }: Props) {
  const proposals = useProposalsForJob(inspection.id);
  const estimate = useEstimateForJob(inspection);
  const upsert = useProposalStore((s) => s.upsert);
  const removeProposal = useProposalStore((s) => s.remove);
  const setLeadStage = useLeadStore((s) => s.setStage);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const priceBook = usePricingStore((s) => s.book);

  const [signTarget, setSignTarget] = useState<Proposal | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Proposal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDoc, setBusyDoc] = useState<'material' | 'workorder' | null>(null);

  const advanceLead = (event: ChainEvent) => {
    if (!linkedLead) return;
    const stage = nextStageFor(linkedLead, event);
    if (stage) setLeadStage(linkedLead.id, stage);
  };

  const newestSigned = proposals.find((p) => p.status === 'signed');

  // ── PDF (neutral) / Share (advances draft → sent) ────────────────────────
  const onPdf = async (p: Proposal) => {
    setBusyId(p.id);
    try {
      const { uri } = await generateProposalPdf(p, inspection);
      await Share.share({ url: uri, message: `RoofWise proposal — ${inspection.customerName}` });
    } catch (e) {
      Alert.alert('Could not generate the PDF', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const onSharePdf = async (p: Proposal) => {
    setBusyId(p.id);
    try {
      const { uri } = await generateProposalPdf(p, inspection);
      const result = await Share.share({ url: uri, message: `RoofWise proposal — ${inspection.customerName}` });
      if (result.action === Share.dismissedAction) return;
      if (p.status === 'signed') {
        toast({ tone: 'success', title: 'Signed proposal shared' });
        return;
      }
      upsert({ ...p, status: 'sent', sentAt: new Date().toISOString() });
      logActivity({ kind: 'proposal_sent', inspectionId: inspection.id, proposalId: p.id, message: `Sent proposal for ${inspection.reportId}` });
      advanceLead('proposal_sent');
      toast({ tone: 'success', title: 'Proposal sent' });
    } catch (e) {
      Alert.alert('Share failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const onPreviewWatermarked = async (p: Proposal) => {
    setBusyId(p.id);
    try {
      const { uri } = await generateProposalPdf(p, inspection, { watermark: 'DRAFT' });
      await Share.share({ url: uri, message: `RoofWise proposal preview — ${inspection.customerName}` });
    } catch (e) {
      Alert.alert('Could not generate the preview', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyId(null);
    }
  };

  const onSigned = (p: Proposal, svg: string) => {
    if (!svg) return;
    const firstSignature = p.status !== 'signed';
    upsert({ ...p, homeownerSignatureSvg: svg, status: 'signed', signedAt: new Date().toISOString() });
    if (firstSignature) {
      logActivity({
        kind: 'proposal_signed',
        inspectionId: inspection.id,
        proposalId: p.id,
        message: `${inspection.customerName} signed the proposal for ${inspection.reportId}`,
      });
      advanceLead('proposal_signed');
    }
    setSignTarget(null);
    toast({ tone: 'success', title: 'Proposal signed' });
  };

  const onConfirmDelete = () => {
    if (!deleteTarget) return;
    removeProposal(deleteTarget.id);
    toast({ tone: 'info', title: 'Proposal deleted' });
    setDeleteTarget(null);
  };

  // ── Work order + material list ───────────────────────────────────────────
  const docCtx = useMemo<JobDocumentContext>(
    () => ({
      inspection,
      estimate,
      proposal: newestSigned ?? proposals[0],
      lead: linkedLead,
      installStartAt: inspection.installStartAt,
      installEndAt: inspection.installEndAt,
    }),
    [inspection, estimate, newestSigned, proposals, linkedLead],
  );

  const onMaterialList = async () => {
    setBusyDoc('material');
    try {
      const { uri } = await generateMaterialListPdf(docCtx);
      await sharePdf(uri, 'Material list');
    } catch (e) {
      Alert.alert("Couldn't build the material list", e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyDoc(null);
    }
  };

  const onWorkOrder = async () => {
    setBusyDoc('workorder');
    try {
      const { uri } = await generateWorkOrderPdf(docCtx);
      await sharePdf(uri, 'Work order');
    } catch (e) {
      Alert.alert("Couldn't build the work order", e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyDoc(null);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
      <Text style={styles.intro}>
        Every saved proposal below is a SNAPSHOT of its own line items — editing your price book
        later never rewrites what a homeowner already signed.
      </Text>

      <PressableScale style={styles.buildCta} onPress={onBuildProposal} accessibilityRole="button" accessibilityLabel="Build proposal">
        <Ionicons name="document-attach-outline" size={22} color={colors.textInverse} />
        <Text style={styles.buildCtaText}>Build proposal</Text>
      </PressableScale>

      <SectionHeader title="Saved proposals" style={styles.sectionSpacing} />
      {proposals.length === 0 ? (
        <View style={styles.placeholderBox}>
          <IconChip name="document-attach-outline" tone="quiet" size="md" />
          <Text style={styles.placeholderText}>No proposals yet. Build one above.</Text>
        </View>
      ) : (
        proposals.map((p) => {
          const status = effectiveStatus(p);
          const created = proposalCreatedAt(p);
          return (
            <RichCard
              key={p.id}
              icon="document-attach-outline"
              iconTone={status === 'signed' ? 'green' : 'blue'}
              title={`$${p.total.toLocaleString()}`}
              subtitle={created ? `Created ${formatRelative(created)}` : undefined}
              headerTrailing={<Pill label={PROPOSAL_STATUS_LABELS[status]} tone={STATUS_TONE[status]} size="sm" />}
              contentStyle={styles.cardBody}
            >
              <View style={styles.cardTopRow}>
                <PressableScale
                  style={styles.iconBtn}
                  onPress={() => onEditProposal(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit proposal"
                >
                  <Ionicons name="create-outline" size={18} color={colors.text} />
                </PressableScale>
                <PressableScale
                  style={styles.iconBtn}
                  onPress={() => setDeleteTarget(p)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete proposal"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </PressableScale>
              </View>

              <View style={styles.actionRow}>
                <ProposalAction icon="document-text-outline" label="PDF" busy={busyId === p.id} onPress={() => onPdf(p)} />
                <ProposalAction icon="finger-print-outline" label="Sign" onPress={() => setSignTarget(p)} />
                <ProposalAction icon="share-outline" label="Share" busy={busyId === p.id} onPress={() => onSharePdf(p)} />
              </View>

              <PressableScale style={styles.previewRow} onPress={() => onPreviewWatermarked(p)} accessibilityRole="button" accessibilityLabel="Preview watermarked PDF">
                <Ionicons name="eye-outline" size={16} color={colors.brand} />
                <Text style={styles.previewText}>Preview watermarked PDF</Text>
              </PressableScale>
            </RichCard>
          );
        })
      )}

      {newestSigned && (
        <>
          <SectionHeader title="Acceptance" style={styles.sectionSpacing} />
          <RichCard icon="checkmark-done-circle-outline" iconTone="green" title="Signed" subtitle={inspection.customerName}>
            {newestSigned.homeownerSignatureSvg ? (
              <View style={styles.sigBox}>
                <Svg width="100%" height={72} viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet">
                  <Path d={newestSigned.homeownerSignatureSvg} stroke={colors.text} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                </Svg>
              </View>
            ) : null}
            <Text style={styles.cardSub}>
              {inspection.customerName}
              {newestSigned.signedAt ? ` · ${formatDateTime(newestSigned.signedAt)}` : ''}
            </Text>
          </RichCard>
        </>
      )}

      <SectionHeader title="Budget" style={styles.sectionSpacing} />
      <BudgetCard jobId={inspection.id} proposals={proposals} estimate={estimate} priceBook={priceBook} />

      <SectionHeader title="Job documents" style={styles.sectionSpacing} />
      <RichCard icon="cube-outline" iconTone="orange" title="Work order & material list" subtitle="Quantities only — no prices, same branding as your proposals">
        <View style={styles.docRow}>
          <PressableScale style={styles.docBtn} onPress={onMaterialList} disabled={busyDoc === 'material'} accessibilityRole="button" accessibilityLabel="Generate material list PDF">
            {busyDoc === 'material' ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="list-outline" size={18} color={colors.text} />}
            <Text style={styles.docBtnText}>Material list</Text>
          </PressableScale>
          <PressableScale style={styles.docBtn} onPress={onWorkOrder} disabled={busyDoc === 'workorder'} accessibilityRole="button" accessibilityLabel="Generate work order PDF">
            {busyDoc === 'workorder' ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="clipboard-outline" size={18} color={colors.text} />}
            <Text style={styles.docBtnText}>Work order</Text>
          </PressableScale>
        </View>
        <Text style={styles.docNote}>
          Crew assignment is parked — there are no team roles yet, so the work order has a blank
          signature line to fill in by hand.
        </Text>
      </RichCard>

      <SignSheet proposal={signTarget} onClose={() => setSignTarget(null)} onSigned={onSigned} />
      <ConfirmSheet
        visible={!!deleteTarget}
        title="Delete this proposal?"
        body={deleteTarget ? `$${deleteTarget.total.toLocaleString()} · ${PROPOSAL_STATUS_LABELS[effectiveStatus(deleteTarget)]}. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        onConfirm={onConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </ScrollView>
  );
}

function ProposalAction({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={[styles.actionBtn, busy && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name={icon} size={18} color={colors.text} />}
      <Text style={styles.actionBtnText}>{label}</Text>
    </PressableScale>
  );
}

function SignSheet({
  proposal,
  onClose,
  onSigned,
}: {
  proposal: Proposal | null;
  onClose: () => void;
  onSigned: (p: Proposal, svg: string) => void;
}) {
  return (
    <BottomSheet visible={!!proposal} onClose={onClose} title="Homeowner signature" subtitle={proposal ? `$${proposal.total.toLocaleString()}` : undefined} accessibilityLabel="Sign proposal">
      <Text style={styles.signBody}>Have the homeowner sign below, then tap Accept & sign. Nothing is signed until that tap.</Text>
      <View style={{ alignItems: 'center' }}>
        <SignaturePad onAccept={(svg) => proposal && onSigned(proposal, svg)} acceptLabel="Accept & sign" />
      </View>
    </BottomSheet>
  );
}

// -----------------------------------------------------------------------------
// Budget
// -----------------------------------------------------------------------------

function BudgetCard({
  jobId,
  proposals,
  estimate,
  priceBook,
}: {
  jobId: string;
  proposals: readonly Proposal[];
  estimate: ReturnType<typeof useEstimateForJob>;
  priceBook: ReturnType<typeof usePricingStore.getState>['book'];
}) {
  const budget = useBudgetStore((s) => s.budgets[jobId]);
  const setProjected = useBudgetStore((s) => s.setProjected);
  const addActual = useBudgetStore((s) => s.addActual);
  const removeActual = useBudgetStore((s) => s.removeActual);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const contract = contractPriceFor(proposals);

  // Seed the projection once, from whichever real source exists — a signed
  // proposal's own line items when there is one, else the saved estimate.
  // Never re-derives after that: a later price-book edit must not rewrite
  // what the job was budgeted at (see BudgetProjected's own doc comment).
  useEffect(() => {
    if (budget?.projected) return;
    const signed = proposals.find((p) => p.status === 'signed');
    if (signed) {
      setProjected(jobId, projectedFromProposal(signed));
      return;
    }
    if (estimate) {
      setProjected(jobId, projectedFromEstimate(estimate, priceBook));
    }
  }, [budget?.projected, proposals, estimate, priceBook, jobId, setProjected]);

  const summary = budgetSummary({
    contractPrice: budget?.contractPriceOverride ?? contract?.price,
    projected: budget?.projected,
    actuals: budget?.actuals ?? [],
  });
  const band = BAND_COLOR[summary.band];

  return (
    <RichCard icon="wallet-outline" iconTone="purple" title="Budget" subtitle="Projected vs. actual, against the contract price" contentStyle={styles.budgetBody}>
      <View style={[styles.bandStrip, { backgroundColor: band.bg }]}>
        <Text style={[styles.bandValue, { color: band.fg }]}>
          {summary.basis === 'none' ? '—' : formatMoney(summary.basis === 'actual' ? summary.actualMargin ?? 0 : summary.projectedMargin ?? 0)}
        </Text>
        <Text style={[styles.bandLabel, { color: band.fg }]}>
          {summary.basis === 'none'
            ? 'Add a contract price and actual costs to see margin'
            : `Margin (${summary.basis}) · ${formatPct(summary.marginPct)}`}
        </Text>
      </View>

      <View style={styles.budgetRow}>
        <BudgetStat label="Contract" value={contract || budget?.contractPriceOverride ? formatMoney(budget?.contractPriceOverride ?? contract?.price ?? 0) : '—'} />
        <BudgetStat label="Projected" value={summary.projectedTotal !== undefined ? formatMoney(summary.projectedTotal) : '—'} />
        <BudgetStat label="Actual" value={formatMoney(summary.actualTotal)} />
      </View>

      {budget?.actuals && budget.actuals.length > 0 && (
        <View style={styles.actualsList}>
          {budget.actuals.map((entry) => (
            <View key={entry.id} style={styles.actualRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actualLabel}>
                  {entry.label} · {BUDGET_KIND_LABELS[entry.kind]}
                </Text>
                <Text style={styles.actualSub}>{formatRelative(entry.at)}</Text>
              </View>
              <Text style={styles.actualAmount}>{formatMoney(entry.amount)}</Text>
              <PressableScale style={styles.removeBtn} onPress={() => setRemoveTarget(entry.id)} accessibilityRole="button" accessibilityLabel={`Remove ${entry.label}`}>
                <Ionicons name="close-circle-outline" size={20} color={colors.textSubtle} />
              </PressableScale>
            </View>
          ))}
        </View>
      )}

      <PressableScale style={styles.addActualBtn} onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel="Add actual cost">
        <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
        <Text style={styles.addActualText}>Add actual cost</Text>
      </PressableScale>

      <AddActualSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={(entry) => {
          addActual(jobId, entry);
          setAddOpen(false);
        }}
      />
      <ConfirmSheet
        visible={!!removeTarget}
        title="Remove this cost?"
        confirmLabel="Remove"
        onConfirm={() => {
          if (removeTarget) removeActual(jobId, removeTarget);
          setRemoveTarget(null);
        }}
        onClose={() => setRemoveTarget(null)}
      />
    </RichCard>
  );
}

function BudgetStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AddActualSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (entry: { kind: BudgetKind; label: string; amount: number }) => void;
}) {
  const [kind, setKind] = useState<BudgetKind>('material');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');

  const reset = () => {
    setKind('material');
    setLabel('');
    setAmount('');
  };

  const save = () => {
    const n = Number(amount.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return;
    onSave({ kind, label: label.trim() || BUDGET_KIND_LABELS[kind], amount: n });
    reset();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add actual cost"
      accessibilityLabel="Add actual cost"
    >
      <View style={styles.kindRow}>
        {BUDGET_KINDS.map((k) => (
          <PressableScale
            key={k}
            style={[styles.kindChip, kind === k && styles.kindChipActive]}
            onPress={() => setKind(k)}
            accessibilityRole="button"
            accessibilityLabel={BUDGET_KIND_LABELS[k]}
            accessibilityState={{ selected: kind === k }}
          >
            <Text style={[styles.kindChipText, kind === k && styles.kindChipTextActive]}>{BUDGET_KIND_LABELS[k]}</Text>
          </PressableScale>
        ))}
      </View>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        placeholder="Amount"
        placeholderTextColor={colors.textSubtle}
        keyboardType="decimal-pad"
        style={styles.amountInput}
      />
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="What was this for? (optional)"
        placeholderTextColor={colors.textSubtle}
        style={styles.labelInput}
      />
      <PressableScale style={styles.saveActualBtn} onPress={save} accessibilityRole="button" accessibilityLabel="Save cost">
        <Ionicons name="checkmark" size={20} color={colors.textInverse} />
        <Text style={styles.saveActualText}>Save cost</Text>
      </PressableScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  intro: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  sectionSpacing: { marginBottom: spacing.sm },

  buildCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    ...shadows.raised,
  },
  buildCtaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  placeholderBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  placeholderText: { color: colors.textMuted, fontSize: fontSize.bodyMd, textAlign: 'center' },

  cardBody: { gap: spacing.sm },
  cardTopRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  iconBtn: { width: touchTarget.small, height: touchTarget.small, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, backgroundColor: colors.fillQuiet },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: touchTarget.standard,
    borderRadius: radii.control,
    backgroundColor: colors.fillQuiet,
  },
  actionBtnText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: touchTarget.small },
  previewText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.brand },

  sigBox: { backgroundColor: colors.fillQuiet, borderRadius: radii.control, padding: spacing.sm },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.textMuted },

  signBody: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },

  budgetBody: { gap: spacing.md },
  bandStrip: { borderRadius: radii.control, padding: spacing.md, gap: 2 },
  bandValue: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  bandLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  budgetRow: { flexDirection: 'row', gap: spacing.md },
  statCell: { flex: 1, gap: 1 },
  statValue: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: fontSize.caption, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.4 },

  actualsList: { gap: spacing.xs },
  actualRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  actualLabel: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  actualSub: { fontSize: fontSize.caption, color: colors.textSubtle },
  actualAmount: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  removeBtn: { width: touchTarget.small, height: touchTarget.small, alignItems: 'center', justifyContent: 'center' },

  addActualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: touchTarget.standard, borderRadius: radii.button, backgroundColor: colors.fillQuiet },
  addActualText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.brand },

  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindChip: { minHeight: touchTarget.small, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.fillQuiet, alignItems: 'center', justifyContent: 'center' },
  kindChipActive: { backgroundColor: colors.brand },
  kindChipText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  kindChipTextActive: { color: colors.textInverse },
  amountInput: { minHeight: touchTarget.standard, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text, padding: spacing.md, backgroundColor: colors.fillQuiet, borderRadius: radii.control },
  labelInput: { minHeight: touchTarget.standard, fontSize: fontSize.bodyMd, color: colors.text, padding: spacing.md, backgroundColor: colors.fillQuiet, borderRadius: radii.control },
  saveActualBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: touchTarget.standard, borderRadius: radii.button, backgroundColor: colors.brand },
  saveActualText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  docRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  docBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: touchTarget.standard, borderRadius: radii.button, backgroundColor: colors.fillQuiet },
  docBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  docNote: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: spacing.sm, lineHeight: 15 },
});
