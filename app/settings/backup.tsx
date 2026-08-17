import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { exportBackup, restoreFromUri } from '@/lib/services/backup';
import { useToastStore } from '@/lib/stores/toastStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
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
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="cloud-upload-outline" size={24} color={colors.textMuted} />
              <Text style={styles.cardTitle}>Export everything</Text>
            </View>
            <PressableScale
              style={[styles.primaryBtn, busy === 'export' && styles.btnBusy]}
              disabled={busy !== null}
              onPress={onExport}
              accessibilityRole="button"
              accessibilityLabel="Export backup"
            >
              {busy === 'export' ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.primaryBtnText}>Export backup</Text>
              )}
            </PressableScale>
          </View>
          <Text style={styles.footerCaption}>
            One JSON file with every inspection, lead, proposal, mileage trip,
            correction, and your profile. Photos stay where they are.
          </Text>
        </FadeSlideIn>

        <FadeSlideIn index={1} style={styles.section}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="cloud-download-outline" size={24} color={colors.textMuted} />
              <Text style={styles.cardTitle}>Restore from backup</Text>
            </View>
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
          </View>
          <Text style={styles.footerCaption}>
            Pick a previously-exported JSON file. We'll replace all local data.
          </Text>
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

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardTitle: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  footerCaption: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  primaryBtn: {
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
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
