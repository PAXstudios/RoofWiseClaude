import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/lib/auth/authStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { syncCorrections } from '@/lib/services/correctionsSync';
import { isGeminiConfigured } from '@/lib/env';
import { colors, fontSize, fontWeight, radii, spacing, shadows } from '@/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const serviceAreaCount = useServiceAreaStore((s) => s.areas.length);
  const correctionsCount = useCorrectionsStore((s) => s.corrections.length);
  const inspectorProfile = useInspectorProfileStore((s) => s.profile);
  const preFlightEnabled = useSafetyStore((s) => s.preFlightEnabled);
  const setPreFlightEnabled = useSafetyStore((s) => s.setPreFlightEnabled);
  const pendingCorrections = useCorrectionsStore((s) => s.corrections.filter((c) => c.syncStatus === 'pending').length);
  const toast = useToastStore((s) => s.show);
  const [syncing, setSyncing] = useState(false);

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await syncCorrections();
      toast({
        tone: result.failed === 0 ? 'success' : 'warn',
        title:
          result.attempted === 0
            ? 'Nothing to sync'
            : `${result.accepted} accepted · ${result.failed} failed`,
      });
    } catch (e) {
      toast({
        tone: 'danger',
        title: 'Sync failed',
        body: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSyncing(false);
    }
  };

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

      <Text style={styles.sectionLabel}>Integrations</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons
            name={isGeminiConfigured ? 'checkmark-circle' : 'alert-circle-outline'}
            size={22}
            color={isGeminiConfigured ? colors.success : colors.warn}
          />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Gemini Vision (AI damage detection)</Text>
            <Text style={styles.rowValue}>
              {isGeminiConfigured
                ? 'Connected'
                : 'Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local'}
            </Text>
          </View>
        </View>
        <View style={[styles.row, styles.rowBorder]}>
          <Ionicons name="cloud-outline" size={22} color={colors.info} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Supabase</Text>
            <Text style={styles.rowValue}>Connected (auth + storage)</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Field</Text>
      <View style={styles.card}>
        <Pressable style={styles.row} onPress={() => router.push('/settings/inspector-profile')}>
          <Ionicons name="person-outline" size={22} color={colors.accent} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Inspector profile</Text>
            <Text style={styles.rowValue}>
              {inspectorProfile.fullName
                ? `${inspectorProfile.fullName}${inspectorProfile.haagCertified ? ' · HAAG certified' : ''}`
                : 'Not set'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>

        <Pressable style={[styles.row, styles.rowBorder]} onPress={() => router.push('/settings/service-area')}>
          <Ionicons name="map-outline" size={22} color={colors.accent} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Service Area</Text>
            <Text style={styles.rowValue}>
              {serviceAreaCount === 0
                ? 'Not set — Storm Watch is off'
                : `${serviceAreaCount} area${serviceAreaCount === 1 ? '' : 's'} configured`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Safety</Text>
      <View style={styles.card}>
        <Pressable
          style={styles.row}
          onPress={() => setPreFlightEnabled(!preFlightEnabled)}
        >
          <Ionicons
            name={preFlightEnabled ? 'shield-checkmark' : 'shield-outline'}
            size={22}
            color={preFlightEnabled ? colors.success : colors.slate}
          />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Pre-inspection safety check</Text>
            <Text style={styles.rowValue}>
              {preFlightEnabled ? 'On — runs every 4 hours' : 'Off'}
            </Text>
          </View>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>AI calibration</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="sparkles-outline" size={22} color={colors.accent} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Corrections recorded</Text>
            <Text style={styles.rowValue}>{correctionsCount}</Text>
          </View>
        </View>

        <Pressable
          style={[styles.row, styles.rowBorder, syncing && { opacity: 0.5 }]}
          onPress={onSyncNow}
          disabled={syncing}
        >
          <Ionicons name="cloud-upload-outline" size={22} color={colors.accent} />
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Sync now</Text>
            <Text style={styles.rowValue}>
              {pendingCorrections === 0
                ? 'Up to date'
                : `${pendingCorrections} pending`}
            </Text>
          </View>
          {syncing ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Coming soon</Text>
      <View style={styles.card}>
        {[
          'AI thresholds: minimum confidence, auto-approve cutoffs',
          'Team & roles (Adjuster, Crew Lead, Owner)',
          'CRM + accounting integrations (HubSpot, QuickBooks)',
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
