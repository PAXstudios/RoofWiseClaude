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
import { useLeadStore } from '@/lib/stores/leadStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { scheduleFollowUpReminder } from '@/lib/services/pushNotifications';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { PressableScale } from '@/components/PressableScale';
import {
  colors,
  fontSize,
  fontWeight,
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
    router.replace('/(tabs)/leads');
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
          <Field
            label="Customer name *"
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Jane Doe"
          />
          <Field
            label="Phone"
            value={customerPhone}
            onChangeText={setCustomerPhone}
            keyboardType="phone-pad"
            placeholder="(555) 555-1234"
          />
          <Field
            label="Email"
            value={customerEmail}
            onChangeText={setCustomerEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder="Optional"
          />
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
          />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Follow up</Text>
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
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PressableScale
            style={[styles.primaryBtn, !canSave && styles.primaryBtnDisabled]}
            disabled={!canSave}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
          >
            <Text style={styles.primaryBtnText}>Save lead</Text>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  ...rest
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textSubtle} {...rest} />
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

  field: { gap: spacing.sm },
  // iOS grouped-list section header language for field labels.
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: spacing.xs,
  },
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
  input: {
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.bodyLg,
    color: colors.text,
  },

  footer: {
    padding: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // Sticky primary CTA — the one orange moment on this screen.
  primaryBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.bodyLg,
  },
});
