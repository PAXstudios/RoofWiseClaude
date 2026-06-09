import { useEffect, useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useProposalLinkStore } from '@/lib/stores/proposalLinkStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useToastStore } from '@/lib/stores/toastStore';
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

export default function HomeownerProposalView() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const link = useProposalLinkStore((s) => s.links.find((l) => l.token === token));
  const markViewed = useProposalLinkStore((s) => s.markViewed);
  const proposal = useProposalStore((s) =>
    link ? s.proposals.find((p) => p.id === link.proposalId) : undefined,
  );
  const upsertProposal = useProposalStore((s) => s.upsert);
  const inspection = useInspectionStore((s) =>
    link ? s.inspections.find((i) => i.id === link.jobId) : undefined,
  );
  const inspector = useInspectorProfileStore((s) => s.profile);
  const toast = useToastStore((s) => s.show);

  useEffect(() => {
    if (token && link && !link.viewedAt) {
      markViewed(token);
    }
  }, [token, link, markViewed]);

  const firstPhoto = useMemo(() => {
    if (!inspection) return null;
    for (const slope of inspection.slopes) {
      if (slope.photoPaths.length > 0) return slope.photoPaths[0];
    }
    return null;
  }, [inspection]);

  if (!link || !proposal || !inspection) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyTitle}>Link expired</Text>
          <Text style={styles.emptyBody}>
            This proposal link is no longer valid. Reach out to your contractor for a fresh one.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const onSign = (svg: string) => {
    if (!svg) return;
    upsertProposal({
      ...proposal,
      homeownerSignatureSvg: svg,
      status: 'signed',
      signedAt: new Date().toISOString(),
    });
    toast({
      tone: 'success',
      title: 'Proposal signed',
      body: "Thank you — we'll be in touch.",
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {firstPhoto ? (
          <Image source={{ uri: firstPhoto }} style={styles.hero} />
        ) : (
          <LinearGradient
            colors={[colors.navy, '#1a2a52']}
            style={styles.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        )}

        <View style={styles.contentCard}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandInitials}>RW</Text>
            </View>
            <Text style={styles.brandName}>RoofWise</Text>
          </View>

          <Text style={styles.heading}>
            Your roofing proposal
          </Text>
          <Text style={styles.address}>{inspection.address}</Text>
          <Text style={styles.metaLine}>Report {inspection.reportId}</Text>

          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>${proposal.total.toLocaleString()}</Text>
            <Text style={styles.totalSub}>
              Deposit ${proposal.deposit.toLocaleString()} · {proposal.warrantyYears} yr warranty
            </Text>
          </View>

          <Text style={styles.section}>What we're doing</Text>
          <Text style={styles.body}>{proposal.coverNarrative}</Text>

          <Text style={styles.section}>Scope of work</Text>
          <Text style={styles.body}>{proposal.scopeOfWork}</Text>

          <Text style={styles.section}>Itemized</Text>
          <View style={styles.lineItems}>
            {proposal.lineItems.map((li, i) => (
              <View key={li.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel}>{li.label}</Text>
                  <Text style={styles.itemSub}>
                    {li.quantity.toFixed(1)} {li.unit} × ${li.unitPrice.toFixed(2)}
                  </Text>
                </View>
                <Text style={styles.itemValue}>
                  ${Math.round(li.subtotal).toLocaleString()}
                </Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalRowLabel}>Total</Text>
              <Text style={styles.totalRowValue}>${proposal.total.toLocaleString()}</Text>
            </View>
          </View>

          <Text style={styles.section}>Terms</Text>
          <Text style={styles.terms}>{proposal.termsText}</Text>

          {inspector.fullName && (
            <View style={styles.inspectorCard}>
              <Ionicons name="person-circle-outline" size={28} color={colors.orange} />
              <View style={{ flex: 1 }}>
                <Text style={styles.inspectorName}>{inspector.fullName}</Text>
                <Text style={styles.inspectorMeta}>
                  {inspector.haagCertified ? 'HAAG certified · ' : ''}
                  {inspector.yearsExperience} yr{inspector.yearsExperience === 1 ? '' : 's'} experience
                </Text>
              </View>
            </View>
          )}

          {proposal.status === 'signed' ? (
            <View style={styles.signedCard}>
              <Ionicons name="checkmark-circle" size={28} color={colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.signedTitle}>Signed</Text>
                <Text style={styles.signedBody}>
                  Thanks — your contractor will reach out shortly.
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.section}>Sign to accept</Text>
              <Text style={styles.body}>
                By signing below you're approving the scope and total above. We'll follow up with a deposit invoice.
              </Text>
              <View style={{ alignItems: 'center', marginTop: spacing.md }}>
                <SignaturePad onChange={onSign} />
              </View>
            </>
          )}

          <View style={{ height: spacing.xxxl }} />
          <Text style={styles.footer}>
            Powered by RoofWise · Proposal {proposal.id.slice(-8)}
          </Text>
        </View>
      </ScrollView>

      <Pressable
        style={styles.exitFab}
        onPress={() => router.back()}
      >
        <Ionicons name="close" size={22} color={colors.textInverse} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xxxl },

  hero: { width: '100%', height: 220 },

  contentCard: {
    margin: spacing.lg,
    marginTop: -spacing.xxxl,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.xxl,
    gap: spacing.md,
    ...shadows.card,
  },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  brandInitials: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  brandName: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.navy },

  heading: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy, marginTop: spacing.md },
  address: { fontSize: fontSize.bodyLg, color: colors.slate },
  metaLine: { fontSize: fontSize.bodySm, color: colors.slate },

  totalCard: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  totalLabel: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.bodySm, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalAmount: { color: colors.orange, fontSize: 44, fontWeight: fontWeight.bold, marginTop: spacing.sm },
  totalSub: { color: colors.cream, fontSize: fontSize.bodyMd, marginTop: spacing.sm },

  section: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.lg },
  body: { fontSize: fontSize.bodyMd, color: colors.navy, lineHeight: 22 },

  lineItems: { backgroundColor: colors.surfaceMuted, borderRadius: radii.card, padding: spacing.lg, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  itemLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.medium, color: colors.navy },
  itemSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  itemValue: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderTopColor: colors.navy, marginTop: spacing.md, paddingTop: spacing.md },
  totalRowLabel: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.navy },
  totalRowValue: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.orange },

  terms: { fontSize: fontSize.bodySm, color: colors.slate, lineHeight: 20, fontStyle: 'italic' },

  inspectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.md,
  },
  inspectorName: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  inspectorMeta: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  signedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.successSoft,
    padding: spacing.lg,
    borderRadius: radii.card,
    marginTop: spacing.lg,
  },
  signedTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.success },
  signedBody: { fontSize: fontSize.bodyMd, color: colors.navy, marginTop: 2 },

  footer: { fontSize: fontSize.caption, color: colors.slate, textAlign: 'center', marginTop: spacing.lg },

  exitFab: {
    position: 'absolute',
    top: spacing.xxxl,
    right: spacing.lg,
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(12,24,60,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
});
