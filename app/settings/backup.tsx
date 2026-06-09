import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>Backup & Restore</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Ionicons name="cloud-upload-outline" size={32} color={colors.orange} />
          <Text style={styles.cardTitle}>Export everything</Text>
          <Text style={styles.cardBody}>
            One JSON file with every inspection, lead, proposal, mileage trip,
            correction, and your profile. Photos stay where they are.
          </Text>
          <Pressable
            style={[styles.primaryBtn, busy === 'export' && { opacity: 0.5 }]}
            disabled={busy !== null}
            onPress={onExport}
          >
            {busy === 'export' ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Export backup</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Ionicons name="cloud-download-outline" size={32} color={colors.navy} />
          <Text style={styles.cardTitle}>Restore from backup</Text>
          <Text style={styles.cardBody}>
            Pick a previously-exported JSON file. We'll replace all local data.
          </Text>
          <Pressable
            style={[styles.secondaryBtn, busy === 'restore' && { opacity: 0.5 }]}
            disabled={busy !== null}
            onPress={onRestore}
          >
            {busy === 'restore' ? (
              <ActivityIndicator color={colors.navy} />
            ) : (
              <Text style={styles.secondaryBtnText}>Pick backup file</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
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

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    gap: spacing.md,
    alignItems: 'flex-start',
    ...shadows.card,
  },
  cardTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  cardBody: { fontSize: fontSize.bodyMd, color: colors.slate, lineHeight: 20 },

  primaryBtn: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  secondaryBtn: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  secondaryBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
