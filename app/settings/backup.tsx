import { useState } from 'react';
import { Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { exportBackup, restoreFromUri } from '@/lib/services/backup';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import {
  colors,
  fontSize,
  fontWeight,
  gradients,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function BackupScreen() {
  const router = useRouter();
  const toast = useToastStore((s) => s.show);
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);

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
  },

  btnBusy: { opacity: 0.5 },
});
