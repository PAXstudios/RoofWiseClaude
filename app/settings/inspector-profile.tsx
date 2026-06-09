import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function InspectorProfileScreen() {
  const router = useRouter();
  const profile = useInspectorProfileStore((s) => s.profile);
  const update = useInspectorProfileStore((s) => s.update);
  const toast = useToastStore((s) => s.show);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>Inspector profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>
          Appears on HAAG reports and proposals. Trust-weighted in the recursive
          learning loop when HAAG-certified.
        </Text>

        <Section title="Identity">
          <Field
            label="Full name"
            value={profile.fullName}
            onChangeText={(t) => update({ fullName: t })}
            placeholder="Derrick Robinson"
          />
          <Field
            label="Phone"
            value={profile.phone}
            onChangeText={(t) => update({ phone: t })}
            placeholder="(555) 555-0100"
            keyboardType="phone-pad"
          />
          <Field
            label="State license number"
            value={profile.licenseNumber ?? ''}
            onChangeText={(t) => update({ licenseNumber: t })}
            placeholder="Optional"
            autoCapitalize="characters"
          />
        </Section>

        <Section title="HAAG certification">
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>I'm HAAG certified</Text>
              <Text style={styles.toggleSub}>
                Trust-weighted 5x in retraining. Required for some insurance carriers.
              </Text>
            </View>
            <Pressable
              style={[
                styles.toggle,
                profile.haagCertified && styles.toggleOn,
              ]}
              onPress={() => update({ haagCertified: !profile.haagCertified })}
            >
              <View
                style={[
                  styles.toggleThumb,
                  profile.haagCertified && styles.toggleThumbOn,
                ]}
              />
            </Pressable>
          </View>

          {profile.haagCertified && (
            <Field
              label="HAAG certification number"
              value={profile.haagCertificationNumber ?? ''}
              onChangeText={(t) => update({ haagCertificationNumber: t })}
              placeholder="e.g. HAAG-12345"
              autoCapitalize="characters"
            />
          )}

          <Field
            label="Years of experience"
            value={String(profile.yearsExperience)}
            onChangeText={(t) => update({ yearsExperience: Math.max(0, parseInt(t || '0', 10)) })}
            keyboardType="number-pad"
            placeholder="0"
          />
        </Section>

        <Section title="Safety">
          <Field
            label="Emergency contact name"
            value={profile.emergencyContact ?? ''}
            onChangeText={(t) => update({ emergencyContact: t })}
            placeholder="Optional"
          />
          <Field
            label="Emergency contact phone"
            value={profile.emergencyPhone ?? ''}
            onChangeText={(t) => update({ emergencyPhone: t })}
            placeholder="Optional"
            keyboardType="phone-pad"
          />
        </Section>

        <Pressable
          style={styles.doneBtn}
          onPress={() => {
            toast({ tone: 'success', title: 'Profile saved' });
            router.back();
          }}
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Field({
  label,
  ...rest
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textSubtle}
        {...rest}
      />
    </View>
  );
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
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  help: { fontSize: fontSize.bodyMd, color: colors.slate, lineHeight: 20 },

  sectionTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },

  field: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.medium },
  input: {
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.bodyLg,
    color: colors.navy,
  },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleLabel: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  toggleSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  toggle: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.success },
  toggleThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  toggleThumbOn: { transform: [{ translateX: 20 }] },

  doneBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  doneBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
});
