import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
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

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

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

      <Group index={0} label="Account">
        <Row icon="mail-outline" title="Email" sub={user?.email ?? 'Not signed in'} />
        {joined ? (
          <>
            <Sep />
            <Row icon="calendar-outline" title="Joined" sub={joined} />
          </>
        ) : null}
      </Group>

      <Group index={1} label="Integrations">
        <Row
          icon={isGeminiConfigured ? 'checkmark-circle' : 'alert-circle-outline'}
          iconColor={isGeminiConfigured ? colors.success : colors.warn}
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
          iconColor={isSupabaseConfigured ? colors.info : colors.warn}
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
          title="Reports"
          sub="Revenue, funnel, mileage, AI calibration"
          chevron
          onPress={() => router.push('/reports')}
        />
        <Sep />
        <Row
          icon="archive-outline"
          title="Backup & Restore"
          sub="Export everything as JSON, restore on a new device"
          chevron
          onPress={() => router.push('/settings/backup')}
        />
        <Sep />
        <Row
          icon="information-circle-outline"
          title="About RoofWise"
          sub="Features, references, version"
          chevron
          onPress={() => router.push('/settings/about')}
        />
      </Group>

      <Group index={4} label="Safety">
        <Row
          icon={preFlightEnabled ? 'shield-checkmark' : 'shield-outline'}
          iconColor={preFlightEnabled ? colors.success : colors.textMuted}
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
          title="Corrections recorded"
          trailing={<Text style={styles.detail}>{correctionsCount}</Text>}
        />
        <Sep />
        <Row
          icon="cloud-upload-outline"
          title="Sync corrections"
          sub={pendingCorrections === 0 ? 'Up to date' : `${pendingCorrections} pending`}
          chevron={!syncing}
          trailing={syncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          onPress={onSyncNow}
          disabled={syncing}
        />
        <Sep />
        <Row
          icon="people-outline"
          title="Sync leads to cloud"
          sub={pendingLeads === 0 ? 'Up to date' : `${pendingLeads} pending`}
          chevron={!leadsSyncing}
          trailing={leadsSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={leadsSyncing}
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
          title="Sync inspections to cloud"
          sub={pendingInspections === 0 ? 'Up to date' : `${pendingInspections} pending`}
          chevron={!inspectionsSyncing}
          trailing={inspectionsSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={inspectionsSyncing}
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
          title="Upload photos to cloud"
          sub={pendingPhotos === 0 ? 'Up to date' : `${pendingPhotos} pending`}
          chevron={!photosSyncing}
          trailing={photosSyncing ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          disabled={photosSyncing}
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
        <Row title="AI thresholds: minimum confidence, auto-approve cutoffs" muted />
        <Sep />
        <Row title="Team & roles (Adjuster, Crew Lead, Owner)" muted />
        <Sep />
        <Row title="CRM + accounting integrations (HubSpot, QuickBooks)" muted />
      </Group>

      <Group index={7} footer={user?.email ? `Signed in as ${user.email}` : undefined}>
        <PressableScale
          style={styles.signOutRow}
          onPress={confirmSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </PressableScale>
      </Group>
    </ScrollView>
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
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={styles.group}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </FadeSlideIn>
  );
}

function Sep() {
  return <View style={styles.sep} />;
}

function Row({
  icon,
  iconColor = colors.textMuted,
  title,
  sub,
  trailing,
  chevron,
  onPress,
  disabled,
  muted,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
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
      {icon ? <Ionicons name={icon} size={20} color={iconColor} /> : null}
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
  sectionLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
    ...shadows.card,
  },
  footer: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
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
