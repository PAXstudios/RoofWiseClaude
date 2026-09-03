import {
  View,
  Text,
  TextInput,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePricingStore, priceBookProvenance, type PricingAccessoryKey } from '@/lib/stores/pricingStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import { ROOF_MATERIAL_LABELS, type RoofMaterial } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const MATERIAL_ORDER: RoofMaterial[] = Object.keys(ROOF_MATERIAL_LABELS) as RoofMaterial[];

export default function PricingSettingsScreen() {
  const router = useRouter();
  const book = usePricingStore((s) => s.book);
  const updateRates = usePricingStore((s) => s.updateRates);
  const updateMaterialPrice = usePricingStore((s) => s.updateMaterialPrice);
  const updateAccessory = usePricingStore((s) => s.updateAccessory);
  const reset = usePricingStore((s) => s.reset);
  const toast = useToastStore((s) => s.show);

  const confirmReset = () => {
    Alert.alert(
      'Reset to starting numbers?',
      'This replaces every price you\'ve set with RoofWise\'s starting numbers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            reset();
            toast({ tone: 'success', title: 'Price book reset' });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Pricing" back />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FadeSlideIn index={0} style={{ gap: spacing.sm }}>
          <Text style={styles.help}>
            Every estimate and proposal is built from these numbers, and every generated
            document states which price book it used.
          </Text>
          <View style={styles.statusRow}>
            <Pill
              label={book.customized ? 'Your numbers' : 'Starting numbers — set yours'}
              tone={book.customized ? 'success' : 'warn'}
              icon={book.customized ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            />
          </View>
          <Text style={styles.provenance}>{priceBookProvenance(book)}</Text>
        </FadeSlideIn>

        <Section index={1} title="Rates per square">
          <RateField
            label="Tear-off & disposal"
            suffix="/ sq"
            value={book.tearOffPerSquare}
            onChangeValue={(v) => updateRates({ tearOffPerSquare: v })}
          />
          <Sep />
          <RateField
            label="Labor"
            suffix="/ sq"
            hint="Leave at $0 if your material price already includes labor."
            value={book.laborPerSquare}
            onChangeValue={(v) => updateRates({ laborPerSquare: v })}
          />
        </Section>

        <Section index={2} title="Markup, tax & deposit">
          <RateField
            label="Markup"
            suffix="%"
            value={book.markupPercent}
            onChangeValue={(v) => updateRates({ markupPercent: v })}
          />
          <Sep />
          <RateField
            label="Sales tax"
            suffix="%"
            value={book.taxPercent}
            onChangeValue={(v) => updateRates({ taxPercent: v })}
          />
          <Sep />
          <RateField
            label="Deposit"
            suffix="%"
            value={book.depositPercent}
            onChangeValue={(v) => updateRates({ depositPercent: v })}
          />
        </Section>

        <Section
          index={3}
          title="Material — price per square"
          footer="Installed price, before markup. Applies when you pick this material on an estimate or proposal."
        >
          {MATERIAL_ORDER.map((m, i) => (
            <View key={m}>
              {i > 0 && <Sep />}
              <RateField
                label={ROOF_MATERIAL_LABELS[m]}
                suffix="/ sq"
                value={book.materialPricePerSquare[m]}
                onChangeValue={(v) => updateMaterialPrice(m, v)}
              />
            </View>
          ))}
        </Section>

        <Section
          index={4}
          title="Accessory catalog"
          footer="Linear-foot and each-unit quantities are estimated from squares (no ridge-length or vent-count measurement yet) — every estimate says so."
        >
          {book.accessories.map((a, i) => (
            <View key={a.key}>
              {i > 0 && <Sep />}
              <RateField
                label={a.label}
                suffix={`/ ${a.unit}`}
                value={a.unitPrice}
                onChangeValue={(v) => updateAccessory(a.key as PricingAccessoryKey, { unitPrice: v })}
              />
            </View>
          ))}
        </Section>

        <FadeSlideIn index={5}>
          <PressableScale
            style={styles.resetRow}
            onPress={confirmReset}
            accessibilityRole="button"
            accessibilityLabel="Reset to starting numbers"
          >
            <Ionicons name="refresh-outline" size={18} color={colors.danger} />
            <Text style={styles.resetText}>Reset to starting numbers</Text>
          </PressableScale>
        </FadeSlideIn>

        <FadeSlideIn index={6}>
          <PressableScale
            style={styles.doneBtnShadow}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <LinearGradient
              colors={gradients.accent}
              style={styles.doneBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </LinearGradient>
          </PressableScale>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  footer,
  index,
  children,
}: {
  title: string;
  footer?: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <FadeSlideIn index={index} style={styles.section}>
      <SectionHeader title={title} style={styles.sectionHeaderSpacing} />
      <RichCard padded={false}>{children}</RichCard>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </FadeSlideIn>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

/** A grouped-list rate cell: label + hint over a "$"-prefixed / unit-suffixed
 *  numeric field. Typing behaves like every other numeric Field in the app
 *  (inspector-profile.tsx) — parses on each keystroke, tolerant of a
 *  mid-edit partial number. */
function RateField({
  label,
  suffix,
  hint,
  value,
  onChangeValue,
}: {
  label: string;
  suffix: string;
  hint?: string;
  value: number;
  onChangeValue: (v: number) => void;
}) {
  const isPercent = suffix === '%';

  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      <View style={styles.rateRow}>
        {!isPercent && <Text style={styles.rateAffix}>$</Text>}
        <TextInput
          style={styles.rateInput}
          value={String(value)}
          onChangeText={(t) => {
            const n = parseFloat(t.replace(/[^0-9.]/g, ''));
            onChangeValue(Number.isFinite(n) ? Math.max(0, n) : 0);
          }}
          selectTextOnFocus
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textSubtle}
        />
        <Text style={styles.rateAffix}>{suffix}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  help: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },
  statusRow: { paddingHorizontal: spacing.lg },
  provenance: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
  },

  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  footer: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 16,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },

  fieldCell: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    gap: 2,
  },
  fieldLabel: {
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  fieldHint: { fontSize: fontSize.caption, color: colors.textSubtle },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rateAffix: { fontSize: fontSize.bodyLg, color: colors.textMuted },
  rateInput: {
    minWidth: 70,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    paddingVertical: spacing.xs,
  },

  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
  },
  resetText: { color: colors.danger, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  doneBtnShadow: { borderRadius: radii.button },
  doneBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
});
