import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/lib/auth/authStore';
import { colors, fontSize, fontWeight, radii, spacing, shadows } from '@/theme/tokens';

export default function SettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.sectionLabel}>Account</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="mail-outline" size={20} color={colors.textMuted} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Email</Text>
            <Text style={styles.rowValue}>{user?.email ?? 'Not signed in'}</Text>
          </View>
        </View>

        {joined ? (
          <View style={[styles.row, styles.rowBorder]}>
            <Ionicons name="calendar-outline" size={20} color={colors.textMuted} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Joined</Text>
              <Text style={styles.rowValue}>{joined}</Text>
            </View>
          </View>
        ) : null}

        <Pressable onPress={confirmSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Coming soon</Text>
      <View style={styles.card}>
        {[
          'Team & roles (Adjuster, Crew Lead, Owner)',
          'CRM + accounting integrations (HubSpot, QuickBooks)',
          'AI thresholds: minimum confidence, auto-approve cutoffs',
          'Storm watch radius and notification channels',
        ].map((line) => (
          <Text key={line} style={styles.bullet}>
            • {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1 },
  rowLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  rowValue: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  signOutBtn: {
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: colors.danger, fontWeight: fontWeight.semibold, fontSize: fontSize.md },
  bullet: { fontSize: fontSize.md, color: colors.text, paddingVertical: spacing.sm },
});
