import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function NewLead() {
  const router = useRouter();
  const createLead = useLeadStore((s) => s.create);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [followUpDays, setFollowUpDays] = useState<number | null>(null);

  const canSave =
    customerName.trim().length > 0 && address.trim().length > 0;

  const onSave = () => {
    const followUpAt =
      followUpDays !== null
        ? new Date(Date.now() + followUpDays * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

    const lead = createLead({
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      address: address.trim(),
      lat,
      lng,
      stage: 'new',
      source: 'manual',
      followUpAt,
    });
    logActivity({
      kind: 'lead_created',
      leadId: lead.id,
      message: `New lead — ${lead.customerName}`,
    });
    if (followUpAt) {
      scheduleFollowUpReminder({
        leadId: lead.id,
        customerName: lead.customerName,
        date: new Date(followUpAt),
      }).catch(() => {});
    }
    toast({
      tone: 'success',
      title: 'Lead saved',
      body: followUpAt
        ? `Follow-up reminder set for ${new Date(followUpAt).toLocaleDateString()}`
        : undefined,
    });
    // dismissTo (POP_TO), not replace: replace('/(tabs)/…') from a pushed
    // screen swapped it for a NEW tab shell on top of the old one. This pops
    // back to the existing shell (or behaves like replace if none exists).
    router.dismissTo('/(tabs)/leads');
  };

  const onCancel = () => {
    if (customerName || address) {
      Alert.alert('Discard lead?', 'Your draft will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <View style={styles.header}>
        <PressableScale
          onPress={onCancel}
          hitSlop={8}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </PressableScale>
        <Text style={styles.title}>New lead</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <FadeSlideIn index={0}>
            <RichCard title="Contact" icon="person-add-outline" iconTone="blue">
              <View style={styles.fieldGroup}>
                <Field
                  label="Customer name *"
                  icon="person-outline"
                  tone="blue"
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder="Jane Doe"
                />
                <Field
                  label="Phone"
                  icon="call-outline"
                  tone="green"
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                  placeholder="(555) 555-1234"
                />
                <Field
                  label="Email"
                  icon="mail-outline"
                  tone="purple"
                  value={customerEmail}
                  onChangeText={setCustomerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="Optional"
                />
              </View>
            </RichCard>
          </FadeSlideIn>

          <FadeSlideIn index={1}>
            <AddressAutocomplete
              label="Address *"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setLat(undefined);
                setLng(undefined);
              }}
              onPlaceSelected={(p) => {
                setAddress(p.description);
                setLat(p.lat);
                setLng(p.lng);
              }}
              useMyLocation
              onLocationSelected={(loc) => {
                setAddress(loc.address);
                setLat(loc.lat);
                setLng(loc.lng);
              }}
            />
          </FadeSlideIn>

          <FadeSlideIn index={2}>
            <SectionHeader title="Follow up" style={styles.sectionHeaderSpacing} />
            <View style={styles.chipRow}>
              {([
                { label: 'None', days: null },
                { label: 'Tomorrow', days: 1 },
                { label: '3 days', days: 3 },
                { label: '1 week', days: 7 },
              ] as const).map((opt) => (
                <PressableScale
                  key={opt.label}
                  pressedScale={0.96}
                  style={[styles.chip, followUpDays === opt.days && styles.chipActive]}
                  onPress={() => setFollowUpDays(opt.days)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: followUpDays === opt.days }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      followUpDays === opt.days && styles.chipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </FadeSlideIn>
        </ScrollView>

        <View style={styles.footer}>
          <PressableScale
            style={styles.primaryBtn}
            disabled={!canSave}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
          >
            <View style={styles.primaryBtnClip}>
              {canSave && (
                <LinearGradient
                  colors={gradients.accent}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              )}
              <Text style={[styles.primaryBtnText, !canSave && styles.primaryBtnTextDisabled]}>
                Save lead
              </Text>
            </View>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Crafted field — a colour-chipped icon inside a soft filled row, not a
 * hairline-outlined box. Sits inside the Contact `RichCard`, so the row
 * itself stays flat (`colors.surfaceMuted`, no shadow) — the card above it
 * already owns the one rung of lift this section gets.
 */
function Field({
  label,
  icon,
  tone,
  ...rest
}: { label: string; icon: IoniconName; tone: ChipTone } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <IconChip name={icon} tone={tone} size="sm" />
        <TextInput style={styles.input} placeholderTextColor={colors.textSubtle} {...rest} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },

  // Modal header — inline 17/semibold title, ≥56pt close target.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.standard,
    paddingLeft: spacing.xs,
    paddingRight: spacing.xl,
    gap: spacing.xs,
  },
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },

  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  fieldGroup: { gap: spacing.lg },
  field: { gap: spacing.sm },
  // iOS grouped-list section header language for field labels.
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  input: {
    flex: 1,
    fontSize: fontSize.bodyLg,
    color: colors.text,
  },

  sectionHeaderSpacing: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.text },
  chipText: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.textInverse },

  footer: {
    padding: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // Sticky primary CTA — the one accent-gradient moment on this screen. The
  // gradient is withheld while disabled so the flat neutral `fillDisabled`
  // wash (painted into `primaryBtnClip`'s background) shows through instead —
  // one flat surface, not a gradient dimmed by opacity. Neutral rather than
  // washed-burnt: a tinted accent at 88pt full width still reads as live, and
  // white on it lands near 1.9:1 (Drift #1).
  primaryBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    ...shadows.raised,
  },
  primaryBtnClip: {
    flex: 1,
    borderRadius: radii.button,
    overflow: 'hidden',
    backgroundColor: colors.fillDisabled,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.bodyLg,
  },
  primaryBtnTextDisabled: { color: colors.textMuted },
});
