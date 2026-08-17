import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { IconChip } from '@/components/ui/IconChip';
import * as Haptics from 'expo-haptics';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  DAMAGE_CATEGORIES,
  DAMAGE_CATEGORY_LABELS,
  type DamageCategory,
  type DamageMarker,
  type Severity,
} from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import { DamageMarkerLayer } from '@/components/DamageMarkerLayer';

let markerCounter = 0;
function newMarkerId(): string {
  return `mk_user_${Date.now()}_${markerCounter++}`;
}

const SEVERITIES: Severity[] = ['minor', 'moderate', 'severe'];

export default function EditDetectionView() {
  const router = useRouter();
  const { inspectionId, slopeId, photoIndex } = useLocalSearchParams<{
    inspectionId: string;
    slopeId: string;
    photoIndex: string;
  }>();
  const index = Number(photoIndex ?? 0);

  const inspection = useInspectionStore((s) =>
    s.inspections.find((i) => i.id === inspectionId),
  );
  const replacePhotoMarkers = useInspectionStore((s) => s.replacePhotoMarkers);
  const recordCorrection = useCorrectionsStore((s) => s.record);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);

  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  const photoUri = slope?.photoPaths[index];

  const photoMarkers = useMemo(() => {
    if (!slope) return [];
    return slope.damage.filter(
      (m) => m.photoIndex === index || m.photoIndex === undefined,
    );
  }, [slope, index]);

  const [draftMarkers, setDraftMarkers] = useState<DamageMarker[]>(photoMarkers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState<DamageCategory>('hail_hits');
  const [severity, setSeverity] = useState<Severity>('moderate');

  if (!inspection || !slope || !photoUri) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <IconChip name="alert-circle-outline" tone="quiet" />
          <Text style={styles.emptyText}>Photo not found.</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const dirty = JSON.stringify(draftMarkers) !== JSON.stringify(photoMarkers);

  const onAddMarker = (x: number, y: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraftMarkers((prev) => [
      ...prev,
      {
        id: newMarkerId(),
        category,
        severity,
        x,
        y,
        radius: 0.03,
        confidence: 100,
        note: 'Added by inspector',
      },
    ]);
  };

  const onSelectMarker = (id: string) => {
    Haptics.selectionAsync();
    setSelectedId(id);
  };

  const onEditSelected = () => {
    if (!selectedId) return;
    Alert.alert('Edit marker', 'Choose an action', [
      { text: 'Change severity → Severe', onPress: () => setSev(selectedId, 'severe') },
      { text: 'Change severity → Moderate', onPress: () => setSev(selectedId, 'moderate') },
      { text: 'Change severity → Minor', onPress: () => setSev(selectedId, 'minor') },
      { text: 'Delete marker', style: 'destructive', onPress: () => removeMarker(selectedId) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const setSev = (id: string, sev: Severity) => {
    setDraftMarkers((prev) => prev.map((m) => (m.id === id ? { ...m, severity: sev } : m)));
  };

  const removeMarker = (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDraftMarkers((prev) => prev.filter((m) => m.id !== id));
    setSelectedId(null);
  };

  const onSave = () => {
    const originalMarkers = photoMarkers;
    const correctedMarkers = draftMarkers;
    const categoriesAffected = uniqueCategories([...originalMarkers, ...correctedMarkers]);

    const added = correctedMarkers.filter((m) => !originalMarkers.find((o) => o.id === m.id));
    const removed = originalMarkers.filter((o) => !correctedMarkers.find((m) => m.id === o.id));
    const modified = correctedMarkers.filter((m) => {
      const o = originalMarkers.find((x) => x.id === m.id);
      return o && JSON.stringify(o) !== JSON.stringify(m);
    });

    const correctionType =
      removed.length > 0 && added.length === 0
        ? 'remove_marker'
        : added.length > 0 && removed.length === 0
        ? 'add_marker'
        : 'edit';

    replacePhotoMarkers(inspection.id, slope.id, index, correctedMarkers);

    recordCorrection({
      inspectionId: inspection.id,
      photoId: `${slope.id}#${index}`,
      slopeId: slope.id,
      correctionType,
      categoriesAffected,
      originalDetection: {
        findings: slope.aiFindings ?? [],
        markers: originalMarkers,
      },
      correctedDetection: {
        findings: slope.aiFindings ?? [],
        markers: correctedMarkers,
      },
      delta: {
        added: added.map((m) => m.id),
        removed: removed.map((m) => m.id),
        modified: modified.map((m) => m.id),
      },
      photoUrl: photoUri,
    });

    logActivity({
      kind: 'analysis_ran',
      inspectionId: inspection.id,
      message: `Edited detections on ${slope.orientation} slope (${added.length} added, ${removed.length} removed)`,
    });

    const profile = computeProfile(useCorrectionsStore.getState().corrections);
    const accuracy = overallAccuracy(profile);
    const primaryCat = categoriesAffected[0];
    const catLabel = primaryCat
      ? primaryCat.replace(/_/g, ' ')
      : 'damage detection';
    toast({
      tone: 'success',
      title: 'Thanks — calibrating AI',
      body:
        accuracy === null
          ? `Improved ${catLabel} for you.`
          : `${catLabel} accuracy is now ${accuracy}% on your jobs.`,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  const onDiscard = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard changes?', 'Your edits will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable onPress={onDiscard} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit detection</Text>
        {selectedId && (
          <Pressable onPress={onEditSelected} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="create-outline" size={22} color={colors.textInverse} />
          </Pressable>
        )}
      </View>

      <View style={styles.canvas}>
        <DamageMarkerLayer
          photoUri={photoUri}
          markers={draftMarkers}
          selectedMarkerId={selectedId}
          onTapPhoto={onAddMarker}
          onSelectMarker={onSelectMarker}
        />
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>Tap photo to add. Tap a marker to edit.</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {DAMAGE_CATEGORIES.map((c) => (
            <Pressable
              key={c}
              style={[styles.catChip, category === c && styles.catChipActive]}
              onPress={() => setCategory(c)}
            >
              <Text
                style={[styles.catChipText, category === c && styles.catChipTextActive]}
              >
                {DAMAGE_CATEGORY_LABELS[c]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sevRow}>
          {SEVERITIES.map((s) => (
            <Pressable
              key={s}
              style={[styles.sevChip, severity === s && styles.sevChipActive]}
              onPress={() => setSeverity(s)}
            >
              <Text style={[styles.sevText, severity === s && styles.sevTextActive]}>
                {s[0].toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.saveBtn, !dirty && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={!dirty}
        >
          <Text style={styles.saveBtnText}>Save corrections ({draftMarkers.length})</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function uniqueCategories(markers: DamageMarker[]): DamageCategory[] {
  const set = new Set<DamageCategory>();
  for (const m of markers) set.add(m.category);
  return Array.from(set);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  headerBtn: { padding: spacing.xs },
  headerTitle: { flex: 1, color: colors.textInverse, fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold },

  canvas: { flex: 1, backgroundColor: '#000' },

  toolbar: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  toolbarLabel: { color: colors.cream, fontSize: fontSize.bodySm, textAlign: 'center' },

  chipRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  catChip: {
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  catChipActive: { backgroundColor: colors.orange },
  catChipText: { color: colors.cream, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  catChipTextActive: { color: colors.textInverse },

  sevRow: { flexDirection: 'row', gap: spacing.sm },
  sevChip: {
    flex: 1,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sevChipActive: { backgroundColor: colors.cream },
  sevText: { color: colors.cream, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  sevTextActive: { color: colors.navy },

  saveBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.bg },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },
  backBtn: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: { color: colors.textInverse, fontWeight: fontWeight.semibold },
});
