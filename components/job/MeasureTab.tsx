// Measure tab — the aerial roof measurement (Solar API): squares, roof
// planes, pitch, and the bridge into the cost estimator. Everything here was
// on the old single-scroll job page's "Property" section; nothing new was
// invented, one CTA was added (a direct line into the estimator — see below).

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import { PropertyIntelCard } from '@/components/PropertyIntelCard';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { pitchDegreesToRatio, type Inspection, type PropertyIntel } from '@/lib/models/types';
import { totalSquares } from '@/lib/services/propertyIntel';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  inspection: Inspection;
  onMeasured: (intel: PropertyIntel) => void;
  /** Prefills the estimator with this job's address/material and opens it. */
  onEstimateThisRoof: () => void;
  /** Opens the Pitch Gauge for this job's whole-roof reading. */
  onOpenPitchGauge: () => void;
};

export function MeasureTab({ inspection, onMeasured, onEstimateThisRoof, onOpenPitchGauge }: Props) {
  const squares = totalSquares(inspection);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
      <SectionHeader title="Roof measurement" />
      <PropertyIntelCard inspection={inspection} onMeasured={onMeasured} />

      <PressableScale
        style={styles.pitchRow}
        onPress={onOpenPitchGauge}
        accessibilityRole="button"
        accessibilityLabel={
          inspection.pitchDegrees != null
            ? `Whole-roof pitch ${pitchDegreesToRatio(inspection.pitchDegrees)}. Open the pitch gauge.`
            : 'Whole-roof pitch not set. Open the pitch gauge.'
        }
      >
        <Ionicons name="triangle-outline" size={20} color={colors.brand} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pitchLabel}>Whole-roof pitch</Text>
          <Text style={styles.pitchSub}>
            {inspection.pitchDegrees != null
              ? `${pitchDegreesToRatio(inspection.pitchDegrees)} · ${Math.round(inspection.pitchDegrees)}° — measured with the Pitch Gauge`
              : 'Not measured — the aerial per-plane pitch above stands in until you do'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </PressableScale>

      <RichCard
        icon="calculator-outline"
        iconTone="green"
        title="Cost estimator"
        subtitle={
          squares !== undefined
            ? `${squares.toFixed(1)} squares measured — price it against your material and price book`
            : 'Measure the roof above first — the estimator prices per square'
        }
      >
        <Text style={styles.body2}>
          Opens the estimator with this job's address and material already filled in. Save the
          result there and it links back to this job automatically.
        </Text>
        <PressableScale
          style={styles.estimateBtn}
          onPress={onEstimateThisRoof}
          accessibilityRole="button"
          accessibilityLabel="Estimate cost for this roof"
        >
          <Ionicons name="cash-outline" size={18} color={colors.textInverse} />
          <Text style={styles.estimateBtnText}>Estimate cost for this roof</Text>
        </PressableScale>
      </RichCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  pitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  pitchLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  pitchSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 1 },
  body2: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
  estimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.success,
    marginTop: spacing.md,
  },
  estimateBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
