import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip } from '@/components/ui/IconChip';
import * as Clipboard from 'expo-clipboard';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useProposalLinkStore } from '@/lib/stores/proposalLinkStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { generateProposalDraft } from '@/lib/services/proposalGenerator';
import { generateProposalPdf } from '@/lib/services/proposalPdf';
import { SignaturePad } from '@/components/SignaturePad';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function ProposalView() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const inspection = useInspectionStore((s) =>
    s.inspections.find((i) => i.id === jobId),
  );
  const existing = useProposalStore((s) => s.getByJob(jobId));
  const upsert = useProposalStore((s) => s.upsert);
  const create = useProposalStore((s) => s.create);
  const setStatus = useProposalStore((s) => s.setStatus);
  const getOrCreateLink = useProposalLinkStore((s) => s.getOrCreate);
  const urlFor = useProposalLinkStore((s) => s.urlFor);
  const allLinks = useProposalLinkStore((s) => s.links);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState(false);

  // Auto-create the draft on first visit — but in an effect, never during
  // render. The old useMemo called create() (a Zustand setter) mid-render,
  // which React flags as "Cannot update a component while rendering a
  // different component" and which can double-create the proposal or drop
  // the write entirely. The guard ref keeps StrictMode's double-invoke from
  // minting two proposals for the same job.
  const creatingRef = useRef(false);
  useEffect(() => {
    if (existing || !inspection || creatingRef.current) return;
    creatingRef.current = true;
    create(generateProposalDraft(inspection));
  }, [existing, inspection, create]);

  // Reset the guard if the user navigates to a different job on the same
  // mounted screen.
  useEffect(() => {
    creatingRef.current = false;
  }, [jobId]);

  const proposal = existing ?? null;

  if (!inspection || !proposal) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <IconChip name="alert-circle-outline" tone="quiet" />
          <Text style={styles.emptyText}>Job not found.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const onRegenerate = () => {
    Alert.alert(
      'Regenerate proposal?',
      'This rebuilds line items from the latest Decision Engine output.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: () => {
            const draft = generateProposalDraft(inspection);
            upsert({ ...proposal, ...draft });
            toast({ tone: 'success', title: 'Proposal regenerated' });
          },
        },
      ],
    );
  };

  const onSend = async () => {
    try {
      setBusy(true);
      const { uri } = await generateProposalPdf(proposal, inspection);
      setStatus(proposal.id, 'sent', { sentAt: new Date().toISOString() });
      logActivity({
        kind: 'proposal_sent',
        inspectionId: inspection.id,
        proposalId: proposal.id,
        message: `Sent proposal for ${inspection.reportId}`,
      });
      await Share.share({
        url: uri,
        message: `RoofWise proposal — ${inspection.customerName}`,
      });
      toast({ tone: 'success', title: 'Proposal sent' });
    } catch (e) {
      Alert.alert('Send failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportId}>{inspection.reportId}</Text>
          <Text style={styles.title}>Proposal</Text>
        </View>
        <View style={[styles.statusPill, statusTone(proposal.status).pill]}>
          <Text style={[styles.statusText, statusTone(proposal.status).text]}>{proposal.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.priceCard}>
          <Text style={styles.priceLabel}>Total</Text>
          <Text style={styles.priceTotal}>${proposal.total.toLocaleString()}</Text>
          <Text style={styles.priceSub}>
            Deposit ${proposal.deposit.toLocaleString()} · {proposal.warrantyYears} yr warranty
          </Text>
        </View>

        <RichCard title="Scope" icon="document-text-outline" iconTone="blue" contentStyle={styles.cardBody}>
          <Text style={styles.body}>{proposal.scopeOfWork}</Text>
        </RichCard>

        <RichCard title="Line items" icon="list-outline" iconTone="green" contentStyle={styles.cardBody}>
          {proposal.lineItems.map((li) => (
            <View key={li.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{li.label}</Text>
                <Text style={styles.rowSub}>
                  {li.quantity.toFixed(1)} {li.unit} × ${li.unitPrice.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.rowValue}>${Math.round(li.subtotal).toLocaleString()}</Text>
            </View>
          ))}
          <View style={styles.totalsRow}>
            <Text style={styles.rowSub}>Subtotal</Text>
            <Text style={styles.rowValue}>${proposal.subtotal.toLocaleString()}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.rowSub}>Tax</Text>
            <Text style={styles.rowValue}>${proposal.tax.toLocaleString()}</Text>
          </View>
          <View style={[styles.totalsRow, styles.grandTotal]}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>${proposal.total.toLocaleString()}</Text>
          </View>
        </RichCard>

        <RichCard title="Terms" icon="shield-checkmark-outline" iconTone="purple" contentStyle={styles.cardBody}>
          <Text style={styles.body}>{proposal.termsText}</Text>
        </RichCard>

        <RichCard title="Share link" icon="link-outline" iconTone="orange" contentStyle={styles.cardBody}>
          {(() => {
            const existing = allLinks.find((l) => l.proposalId === proposal.id);
            if (!existing) {
              return (
                <>
                  <Text style={styles.body}>
                    Generate a tokenized URL the homeowner can open from email or SMS.
                  </Text>
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={() => {
                      const link = getOrCreateLink({
                        proposalId: proposal.id,
                        jobId: inspection.id,
                      });
                      toast({
                        tone: 'success',
                        title: 'Link generated',
                        body: urlFor(link.token),
                      });
                    }}
                  >
                    <Ionicons name="link-outline" size={18} color={colors.navy} />
                    <Text style={styles.secondaryBtnText}>Generate link</Text>
                  </Pressable>
                </>
              );
            }
            const url = urlFor(existing.token);
            return (
              <>
                <Text selectable style={styles.urlText}>{url}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={async () => {
                      await Clipboard.setStringAsync(url);
                      toast({ tone: 'success', title: 'Link copied' });
                    }}
                  >
                    <Ionicons name="copy-outline" size={18} color={colors.navy} />
                    <Text style={styles.secondaryBtnText}>Copy</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryBtn, { flex: 1 }]}
                    onPress={async () => {
                      await Share.share({ message: `Your roofing proposal: ${url}` });
                    }}
                  >
                    <Ionicons name="share-outline" size={18} color={colors.navy} />
                    <Text style={styles.secondaryBtnText}>Share</Text>
                  </Pressable>
                </View>
                <Pressable
                  style={styles.previewBtn}
                  onPress={() =>
                    router.push({ pathname: '/p/[token]', params: { token: existing.token } } as any)
                  }
                >
                  <Ionicons name="eye-outline" size={18} color={colors.navy} />
                  <Text style={styles.secondaryBtnText}>Preview as homeowner</Text>
                </Pressable>
              </>
            );
          })()}
        </RichCard>

        <RichCard title="Homeowner signature" icon="create-outline" iconTone="blue" contentStyle={styles.cardBody}>
          <Text style={styles.body}>
            Have the homeowner sign below before sending the proposal.
          </Text>
          <SignaturePad
            onChange={(svg) => {
              if (svg) {
                upsert({
                  ...proposal,
                  homeownerSignatureSvg: svg,
                  status: 'signed',
                  signedAt: new Date().toISOString(),
                });
              }
            }}
          />
          {proposal.homeownerSignatureSvg && (
            <View style={styles.signedBadge}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={styles.signedText}>Signed</Text>
            </View>
          )}
        </RichCard>

        <Pressable style={styles.secondaryBtn} onPress={onRegenerate}>
          <Ionicons name="refresh-outline" size={18} color={colors.navy} />
          <Text style={styles.secondaryBtnText}>Regenerate from inspection</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.primaryBtn, busy && { opacity: 0.5 }]}
          disabled={busy}
          onPress={onSend}
        >
          <Ionicons name="send-outline" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>
            {busy ? 'Generating PDF…' : 'Generate PDF & share'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function statusTone(status: string) {
  switch (status) {
    case 'signed':
      return { pill: { backgroundColor: colors.success }, text: { color: colors.textInverse } };
    case 'sent':
    case 'viewed':
      return { pill: { backgroundColor: colors.navy }, text: { color: colors.textInverse } };
    case 'declined':
    case 'expired':
      return { pill: { backgroundColor: colors.danger }, text: { color: colors.textInverse } };
    default:
      return { pill: { backgroundColor: colors.surfaceMuted }, text: { color: colors.slate } };
  }
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
  reportId: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold },
  title: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },

  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill },
  statusText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  priceCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadows.card,
  },
  priceLabel: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.bodySm, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceTotal: { color: colors.orange, fontSize: 44, fontWeight: fontWeight.bold, marginTop: spacing.sm },
  priceSub: { color: colors.cream, fontSize: fontSize.bodyMd, marginTop: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  section: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  cardBody: { gap: spacing.sm },
  body: { fontSize: fontSize.bodyMd, color: colors.navy, lineHeight: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  rowSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  rowValue: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.semibold },

  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  grandTotal: { borderTopWidth: 2, borderTopColor: colors.navy, marginTop: spacing.sm, paddingTop: spacing.md },
  grandLabel: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.navy },
  grandValue: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.orange },

  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  signedText: { color: colors.success, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  urlText: {
    fontSize: fontSize.bodyMd,
    color: colors.navy,
    fontFamily: 'Courier',
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radii.md,
    marginVertical: spacing.sm,
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.sm,
  },

  footer: { padding: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },
  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  primaryBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },
});
