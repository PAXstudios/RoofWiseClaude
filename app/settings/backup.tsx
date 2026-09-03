import { useState } from 'react';
import { Text, View, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { exportBackup, restoreFromUri } from '@/lib/services/backup';
import { KNOCKING_SQL, syncKnocks } from '@/lib/services/knockSync';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuthStore } from '@/lib/auth/authStore';
import { useKnockSyncStore } from '@/lib/stores/knockSyncStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import {
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  gradients,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/** "just now" / "4 min ago" / "3 h ago" / "2 d ago" — for the sync rows. */
function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function BackupScreen() {
  const router = useRouter();
  const toast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState<'export' | 'restore' | 'knocks' | null>(null);

  const session = useAuthStore((s) => s.session);
  const lastRun = useKnockSyncStore((s) => s.lastRun);
  const totalPushed = useKnockSyncStore((s) => s.totalPushed);
  const needsSchema = lastRun?.status === 'needs_schema';

  const onExport = async () => {
    setBusy('export');
    try {
      await exportBackup();
      toast({ tone: 'success', title: 'Backup exported' });
    } catch (e) {
      toast({ tone: 'danger', title: 'Export failed', body: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const onRestore = async () => {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/json'],
      copyToCacheDirectory: true,
    });
    if (pick.canceled) return;
    const uri = pick.assets[0]?.uri;
    if (!uri) return;

    Alert.alert(
      'Restore backup?',
      'This overwrites everything currently on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusy('restore');
            try {
              const summary = await restoreFromUri(uri);
              toast({
                tone: 'success',
                title: 'Backup restored',
                body: `${summary.inspections} inspections · ${summary.proposals} proposals`,
              });
              router.back();
            } catch (e) {
              toast({
                tone: 'danger',
                title: 'Restore failed',
                body: e instanceof Error ? e.message : undefined,
              });
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const onSyncKnocks = async () => {
    setBusy('knocks');
    try {
      const r = await syncKnocks({ reason: 'settings' });
      if (r.status === 'ok') {
        toast({
          tone: 'success',
          title: `${r.pushed} pushed · ${r.pulled} pulled`,
          body: r.skipped > 0 ? `${r.skipped} unchanged rows skipped` : undefined,
        });
      } else if (r.status === 'skipped') {
        toast({ tone: 'warn', title: 'Nothing synced', body: r.reason });
      } else {
        toast({ tone: 'warn', title: 'Cloud sync issue', body: r.error });
      }
    } finally {
      setBusy(null);
    }
  };

  const onCopySql = async () => {
    await Clipboard.setStringAsync(KNOCKING_SQL);
    toast({ tone: 'success', title: 'SQL copied', body: 'Paste it into the Supabase SQL editor and run it once.' });
  };

  // What the Knocking data row says under its title — one honest line.
  const knockSubtitle = !isSupabaseConfigured
    ? 'Backend not configured on this build'
    : !session
      ? 'Sign in to sync'
      : needsSchema
        ? 'Tables not provisioned yet'
        : lastRun?.status === 'error'
          ? 'Last sync failed'
          : lastRun
            ? `Last synced ${relativeTime(lastRun.at).toLowerCase()}`
            : 'Not synced yet';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Backup & Restore" back />

      <ScrollView contentContainerStyle={styles.scroll}>
        <FadeSlideIn index={0} style={styles.section}>
          <RichCard
            icon="cloud-upload-outline"
            iconTone="blue"
            title="Export everything"
            footer={
              <Text style={styles.footerCaption}>
                One JSON file with every inspection, lead, proposal, mileage trip,
                correction, and your profile. Photos stay where they are.
              </Text>
            }
          >
            <PressableScale
              style={styles.primaryBtnShadow}
              disabled={busy !== null}
              onPress={onExport}
              accessibilityRole="button"
              accessibilityLabel="Export backup"
            >
              <LinearGradient
                colors={gradients.accent}
                style={[styles.primaryBtn, busy === 'export' && styles.btnBusy]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                {busy === 'export' ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>Export backup</Text>
                )}
              </LinearGradient>
            </PressableScale>
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={1} style={styles.section}>
          <RichCard
            icon="cloud-download-outline"
            iconTone="purple"
            title="Restore from backup"
            footer={
              <Text style={styles.footerCaption}>
                Pick a previously-exported JSON file. We'll replace all local data.
              </Text>
            }
          >
            <PressableScale
              style={[styles.secondaryBtn, busy === 'restore' && styles.btnBusy]}
              disabled={busy !== null}
              onPress={onRestore}
              accessibilityRole="button"
              accessibilityLabel="Pick backup file"
            >
              {busy === 'restore' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.secondaryBtnText}>Pick backup file</Text>
              )}
            </PressableScale>
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={2} style={styles.section}>
          <RichCard
            icon="walk-outline"
            iconTone="green"
            title="Knocking data"
            subtitle={knockSubtitle}
            footer={
              <Text style={styles.footerCaption}>
                Every route, door, plan and do-not-knock entry syncs to your
                company's cloud so the office can map what was knocked. Names
                and numbers taken at the door go with it. Runs on its own every
                few minutes while you're signed in.
              </Text>
            }
          >
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Last synced</Text>
                <Text style={styles.statValue}>{relativeTime(lastRun?.at)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Rows synced</Text>
                <Text style={styles.statValue}>{totalPushed.toLocaleString()}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Last run</Text>
                <Text style={styles.statValue}>
                  {lastRun && lastRun.status === 'ok' ? `${lastRun.pushed} up · ${lastRun.pulled} down` : '—'}
                </Text>
              </View>
            </View>

            {needsSchema ? (
              <Text style={styles.warnText}>
                Cloud sync not provisioned — the knocking tables are missing. Copy
                the SQL below and run it once in the Supabase SQL editor; the next
                sync fills them.
              </Text>
            ) : lastRun?.status === 'error' && lastRun.error ? (
              <Text style={styles.warnText}>{lastRun.error}</Text>
            ) : null}

            <PressableScale
              style={[styles.knockBtn, busy === 'knocks' && styles.btnBusy]}
              disabled={busy !== null || !session || !isSupabaseConfigured}
              onPress={onSyncKnocks}
              accessibilityRole="button"
              accessibilityLabel="Sync knocking data now"
            >
              {busy === 'knocks' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.secondaryBtnText}>Sync now</Text>
              )}
            </PressableScale>

            {needsSchema ? (
              <PressableScale
                style={styles.knockBtn}
                onPress={onCopySql}
                accessibilityRole="button"
                accessibilityLabel="Copy the knocking-data SQL"
              >
                <Text style={styles.secondaryBtnText}>Copy SQL</Text>
              </PressableScale>
            ) : null}
          </RichCard>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
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
  section: {},

  footerCaption: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textSubtle,
    lineHeight: 18,
  },

  primaryBtnShadow: { borderRadius: radii.button },
  primaryBtn: {
    height: touchTarget.preferred,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },

  secondaryBtn: {
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },

  // Knocking data row — 56pt glove target, stacked with a 12pt gap.
  knockBtn: {
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stat: { flex: 1, gap: 2 },
  // "Last synced" / "Rows synced" — the mock's stat-label convention (§3).
  statLabel: { ...dataLabel, color: colors.textSubtle, letterSpacing: 0.6 },
  statValue: {
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },
  warnText: {
    marginTop: spacing.md,
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.warn,
    lineHeight: 18,
  },

  btnBusy: { opacity: 0.5 },
});
