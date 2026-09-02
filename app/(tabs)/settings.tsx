import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useAuthStore } from '@/lib/auth/authStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import { syncLeads } from '@/lib/services/leadSync';
import { syncInspections } from '@/lib/services/inspectionSync';
import { syncInspectionPhotos } from '@/lib/services/photoSync';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useInspectionSyncStore } from '@/lib/stores/inspectionSyncStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { syncCorrections } from '@/lib/services/correctionsSync';
import { isGeminiConfigured, isSupabaseConfigured } from '@/lib/env';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill } from '@/components/ui/Pill';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Sync-pending rows read green when caught up, orange while work is queued —
 * the same "this needs attention" cue the reference's colour chips carry.
 *
 * With no cloud target configured there is nothing to be caught up WITH, so
 * the row goes neutral. A green "Up to date" chip for a backend that does not
 * exist is exactly the reassuring-but-untrue status Drift #5 forbids — and it
 * directly contradicted the Integrations group two sections above, which
 * correctly says "Not configured — data stays on this device".
 */
function pendingTone(count: number): ChipTone {
  if (!isSupabaseConfigured) return 'quiet';
  return count === 0 ? 'green' : 'orange';
}

/** Sync-row subtitle. Never claims a sync state without a sync target. */
function syncSub(count: number): string {
  if (!isSupabaseConfigured) return 'Not configured — nothing to sync to';
  return count === 0 ? 'Up to date' : `${count} pending`;
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useAuthStore((s) => s.signOut);
  const serviceAreaCount = useServiceAreaStore((s) => s.areas.length);
  const correctionsCount = useCorrectionsStore((s) => s.corrections.length);
  const inspectorProfile = useInspectorProfileStore((s) => s.profile);
  const preFlightEnabled = useSafetyStore((s) => s.preFlightEnabled);
  const setPreFlightEnabled = useSafetyStore((s) => s.setPreFlightEnabled);
  const pendingLeads = useLeadStore((s) => s.leads.filter((l) => l.syncStatus !== 'synced').length);
  const [leadsSyncing, setLeadsSyncing] = useState(false);
  const pendingInspections = useInspectionSyncStore(
    (s) => Object.keys(s.dirty).length + s.deleted.length,
  );
  const [inspectionsSyncing, setInspectionsSyncing] = useState(false);
  const pendingPhotos = useInspectionStore((s) =>
    s.inspections.reduce(
      (sum, i) =>
        sum +
        i.slopes.reduce(
          (s2, sl) => s2 + sl.photoPaths.filter((p) => !(sl.photoUploads?.[p])).length,
          0,
        ),
      0,
    ),
  );
  const [photosSyncing, setPhotosSyncing] = useState(false);
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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.container,
        // Clears the tab bar + home indicator so the last group is never
        // clipped behind chrome (same clearance formula as the Home root).
        { paddingBottom: insets.bottom + touchTarget.preferred + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Settings</Text>

      <ProfileHeader index={0} />

      <Group index={1} label="Integrations">
        <Row
          icon={isGeminiConfigured ? 'checkmark-circle' : 'alert-circle-outline'}
          tone={isGeminiConfigured ? 'green' : 'orange'}
          title="Gemini Vision (AI damage detection)"
          sub={
            isGeminiConfigured
              ? 'Connected'
              : 'Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local'
          }
        />
        <Sep />
        <Row
          icon={isSupabaseConfigured ? 'cloud-outline' : 'cloud-offline-outline'}
          tone={isSupabaseConfigured ? 'blue' : 'orange'}
          title="Cloud sync"
          sub={
            isSupabaseConfigured
              ? 'Connected (auth + storage)'
              : 'Not configured — data stays on this device'
          }
        />
      </Group>

      <Group
        index={2}
        label="Field"
        footer="Storm Watch only scans the areas you add under Service Area."
      >
        <Row
          icon="person-outline"
          tone="purple"
          title="Inspector profile"
          sub={
            inspectorProfile.fullName
              ? `${inspectorProfile.fullName}${inspectorProfile.haagCertified ? ' · HAAG certified' : ''}`
              : 'Not set'
          }
          chevron
          onPress={() => router.push('/settings/inspector-profile')}
        />
        <Sep />
        <Row
          icon="map-outline"
          tone="blue"
          title="Service Area"
          sub={
            serviceAreaCount === 0
              ? 'Not set — Storm Watch is off'
              : `${serviceAreaCount} area${serviceAreaCount === 1 ? '' : 's'} configured`
          }
          chevron
          onPress={() => router.push('/settings/service-area')}
        />
      </Group>

      <Group index={3} label="Business">
        <Row
          icon="bar-chart-outline"
          tone="purple"
          title="Reports"
          sub="Revenue, funnel, mileage, AI calibration"
          chevron
          onPress={() => router.push('/reports')}
        />
        <Sep />
        <Row
          icon="archive-outline"
          tone="blue"
          title="Backup & Restore"
          sub="Export everything as JSON, restore on a new device"
          chevron
          onPress={() => router.push('/settings/backup')}
        />
        <Sep />
        <Row
          icon="information-circle-outline"
          tone="quiet"
          title="About RoofWise"
          sub="Features, references, version"
          chevron
          onPress={() => router.push('/settings/about')}
        />
        <Sep />
        <Row
          icon="bug-outline"
          tone="quiet"
          title="Diagnostics"
          sub="Crash log for this device"
          chevron
          onPress={() => router.push('/settings/diagnostics')}
        />
      </Group>

      <Group index={4} label="Safety">
        <Row
          icon={preFlightEnabled ? 'shield-checkmark' : 'shield-outline'}
          tone={preFlightEnabled ? 'green' : 'quiet'}
          title="Pre-inspection safety check"
          sub={preFlightEnabled ? 'On — runs every 4 hours' : 'Off'}
          trailing={<MiniSwitch on={preFlightEnabled} />}
          onPress={() => setPreFlightEnabled(!preFlightEnabled)}
        />
      </Group>

      <Group
        index={5}
        label="AI calibration"
        footer="Corrections you make on-device calibrate the AI to your judgment."
      >
        <Row
          icon="sparkles-outline"
          tone="purple"
          title="Corrections recorded"
          trailing={<Text style={styles.detail}>{correctionsCount}</Text>}
        />
        <Sep />
        <Row
          icon="cloud-upload-outline"
          tone={pendingTone(pendingCorrections)}
          title="Sync corrections"
          sub={syncSub(pendingCorrections)}
          chevron={isSupabaseConfigured && !syncing}
          trailing={syncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          onPress={onSyncNow}
          disabled={syncing || !isSupabaseConfigured}
        />
        <Sep />
        <Row
          icon="people-outline"
          tone={pendingTone(pendingLeads)}
          title="Sync leads to cloud"
          sub={syncSub(pendingLeads)}
          chevron={isSupabaseConfigured && !leadsSyncing}
          trailing={leadsSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={leadsSyncing || !isSupabaseConfigured}
          onPress={async () => {
            setLeadsSyncing(true);
            try {
              const r = await syncLeads();
              toast({
                tone: r.error ? 'warn' : 'success',
                title: r.error
                  ? 'Cloud sync issue'
                  : `${r.pushed} pushed · ${r.pulled} pulled`,
                body: r.error,
              });
            } finally {
              setLeadsSyncing(false);
            }
          }}
        />
        <Sep />
        <Row
          icon="briefcase-outline"
          tone={pendingTone(pendingInspections)}
          title="Sync inspections to cloud"
          sub={syncSub(pendingInspections)}
          chevron={isSupabaseConfigured && !inspectionsSyncing}
          trailing={inspectionsSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={inspectionsSyncing || !isSupabaseConfigured}
          onPress={async () => {
            setInspectionsSyncing(true);
            try {
              const r = await syncInspections();
              toast({
                tone: r.error ? 'warn' : 'success',
                title: r.error
                  ? 'Cloud sync issue'
                  : `${r.pushed} pushed · ${r.pulled} pulled`,
                body: r.error,
              });
            } finally {
              setInspectionsSyncing(false);
            }
          }}
        />
        <Sep />
        <Row
          icon="images-outline"
          tone={pendingTone(pendingPhotos)}
          title="Upload photos to cloud"
          sub={syncSub(pendingPhotos)}
          chevron={isSupabaseConfigured && !photosSyncing}
          trailing={photosSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={photosSyncing || !isSupabaseConfigured}
          onPress={async () => {
            setPhotosSyncing(true);
            try {
              const r = await syncInspectionPhotos();
              toast({
                tone: r.error ? 'warn' : 'success',
                title: r.error
                  ? 'Photo upload issue'
                  : `${r.uploaded} uploaded · ${r.remaining} remaining`,
                body: r.error,
              });
            } finally {
              setPhotosSyncing(false);
            }
          }}
        />
      </Group>

      <Group index={6} label="Coming soon">
        <Row icon="options-outline" tone="quiet" title="AI thresholds: minimum confidence, auto-approve cutoffs" muted />
        <Sep />
        <Row icon="people-circle-outline" tone="quiet" title="Team & roles (Adjuster, Crew Lead, Owner)" muted />
        <Sep />
        <Row icon="link-outline" tone="quiet" title="CRM + accounting integrations (HubSpot, QuickBooks)" muted />
      </Group>

      <FadeSlideIn index={7} style={styles.section}>
        <PressableScale
          style={styles.signOutRow}
          onPress={confirmSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </PressableScale>
      </FadeSlideIn>
    </ScrollView>
  );
}

// ---------- profile header ----------

/**
 * Crafted identity module — the first thing under the title, so Settings
 * opens on the same brand language as onboarding (a gradient disc echoing
 * the aurora's royal wash) rather than a plain grouped cell. Every field is
 * read from a real store; there is no synthetic "role" — HAAG certification
 * is the one true status this product tracks per inspector, so it is the
 * pill. Tapping goes to the same Inspector profile screen as the Field row
 * below (Apple ID card pattern: a quick-glance header plus a full row).
 */
function ProfileHeader({ index }: { index: number }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const inspectorProfile = useInspectorProfileStore((s) => s.profile);

  // Same derivation Home's greeting uses: a real name from the profile,
  // else a friendly name derived from the real sign-in email — never a
  // fabricated one (Drift #5).
  const emailDerivedName = useMemo(() => {
    const email = user?.email ?? '';
    if (!email) return null;
    const local = email.split('@')[0].split(/[._-]/).filter(Boolean).join(' ');
    return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  }, [user]);

  const displayName = inspectorProfile.fullName?.trim() || emailDerivedName;

  const initials = useMemo(() => {
    if (!displayName) return null;
    const parts = displayName.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || null;
  }, [displayName]);

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  const signInLine = user?.email
    ? `Signed in as ${user.email}`
    : isSupabaseConfigured
    ? 'Not signed in'
    : 'Local only — cloud sync not configured';

  return (
    <FadeSlideIn index={index} style={styles.section}>
      <PressableScale
        style={styles.profileCard}
        onPress={() => router.push('/settings/inspector-profile')}
        accessibilityRole="button"
        accessibilityLabel={
          displayName ? `${displayName}. Edit inspector profile.` : 'Set up your inspector profile'
        }
      >
        <View style={styles.avatarShadow}>
          <LinearGradient
            colors={gradients.clearDay}
            style={styles.avatar}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <Ionicons name="person" size={26} color={colors.textInverse} />
            )}
          </LinearGradient>
        </View>

        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>
            {displayName ?? 'Add your name'}
          </Text>
          <View style={styles.profileMetaRow}>
            {inspectorProfile.haagCertified ? (
              <Pill label="HAAG Certified" tone="success" size="sm" icon="shield-checkmark" />
            ) : (
              <Pill label="Inspector" tone="brand" size="sm" />
            )}
          </View>
          <Text style={styles.profileSignIn} numberOfLines={1}>
            {signInLine}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </PressableScale>
      {joined ? <Text style={styles.footer}>Member since {joined}</Text> : null}
    </FadeSlideIn>
  );
}

// ---------- grouped-list primitives ----------

function Group({
  label,
  footer,
  index,
  children,
}: {
  label?: string;
  footer?: string;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <FadeSlideIn index={index} style={styles.section}>
      {label ? <SectionHeader title={label} style={styles.sectionHeaderSpacing} /> : null}
      <RichCard padded={false}>{children}</RichCard>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </FadeSlideIn>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

function Row({
  icon,
  tone = 'quiet',
  title,
  sub,
  trailing,
  chevron,
  onPress,
  disabled,
  muted,
}: {
  icon?: IoniconName;
  tone?: ChipTone;
  title: string;
  sub?: string;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  const body = (
    <>
      {icon ? <IconChip name={icon} tone={tone} size="sm" /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, muted && styles.rowTitleMuted]}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {trailing}
      {chevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;

  return (
    <PressableScale
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {body}
    </PressableScale>
  );
}

/** iOS-style switch visual — the enclosing 56pt row is the touch target. */
function MiniSwitch({ on }: { on: boolean }) {
  const x = useSharedValue(on ? 20 : 0);

  useEffect(() => {
    x.value = withSpring(on ? 20 : 0, motion.snappy);
  }, [on, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
      <Animated.View style={[styles.switchThumb, thumbStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xl,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },

  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  footer: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  // Profile header — gradient disc, name, status pill, sign-in line.
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    ...shadows.raised,
  },
  avatarShadow: { borderRadius: radii.pill, ...shadows.raised },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textInverse,
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  profileText: { flex: 1, gap: 5 },
  profileName: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  profileMetaRow: { flexDirection: 'row', gap: spacing.xs },
  profileSignIn: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowDisabled: { opacity: 0.5 },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: spacing.lg,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  rowTitleMuted: { color: colors.textMuted, fontWeight: fontWeight.regular },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  detail: {
    fontSize: fontSize.bodyMd,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },

  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.success },
  switchThumb: {
    width: 27,
    height: 27,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },

  signOutRow: {
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  signOutText: {
    color: colors.danger,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },
});
