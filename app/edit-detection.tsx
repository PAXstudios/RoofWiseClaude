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
  HIT_EVIDENCE_LABELS,
  type DamageCategory,
  type DamageMarker,
  type HitEvidence,
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

/**
 * HAAG §1 evidence classes the inspector can assign to a hail / bruise mark.
 * `unclear` leads and is the default — a hand-placed hit never defaults to a
 * functional class; the inspector has to say what they saw.
 */
const EVIDENCE_OPTIONS: HitEvidence[] = [
  'unclear',
  'exposed_substrate',
  'mat_fracture',
  'granule_loss_only',
  'cosmetic',
];

/** The two categories that carry evidence and the soft-spot confirmation. */
function isHailCategory(c: DamageCategory): boolean {
  return c === 'hail_hits' || c === 'bruising';
}

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
  // What the NEXT hand-placed hail mark carries. Never defaults to a
  // functional class (Drift #5) — `unclear` until the inspector says.
  const [evidence, setEvidence] = useState<HitEvidence>('unclear');
  const [softSpot, setSoftSpot] = useState(false);

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

  // The selected marker, when it is a hail / bruise mark: the evidence and
  // soft-spot chips then edit IT rather than the defaults for the next tap.
  const selected = selectedId ? draftMarkers.find((m) => m.id === selectedId) : undefined;
  const selectedHail = selected && isHailCategory(selected.category) ? selected : undefined;
  const chipsCategory = selectedHail ? selectedHail.category : category;
  const showEvidence = isHailCategory(chipsCategory);
  const activeEvidence: HitEvidence = selectedHail ? (selectedHail.evidence ?? 'unclear') : evidence;
  const activeSoftSpot = selectedHail ? selectedHail.softSpot === true : softSpot;

  const onAddMarker = (x: number, y: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const hail = isHailCategory(category);
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
        // Evidence rides every hand-placed hail mark so `deriveFunctional`
        // can read it; other categories carry neither field.
        ...(hail ? { evidence, softSpot: softSpot || undefined } : {}),
      },
    ]);
  };

  const setEvidenceFor = (value: HitEvidence) => {
    Haptics.selectionAsync();
    if (selectedHail) {
      setDraftMarkers((prev) =>
        prev.map((m) => (m.id === selectedHail.id ? { ...m, evidence: value } : m)),
      );
      return;
    }
    setEvidence(value);
  };

  const toggleSoftSpot = () => {
    Haptics.selectionAsync();
    if (selectedHail) {
      setDraftMarkers((prev) =>
        prev.map((m) =>
          m.id === selectedHail.id ? { ...m, softSpot: m.softSpot ? undefined : true } : m,
        ),
      );
      return;
    }
    setSoftSpot((v) => !v);
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
        <Text style={styles.toolbarLabel}>
          {selectedHail
            ? 'Editing the selected hit — what did you see? Press it: soft under your finger?'
            : 'Tap photo to add. Tap a marker to edit.'}
        </Text>

        {/* HAAG §1 for hail / bruise marks: the evidence class the inspector
            saw, and the soft-spot test only a finger on the roof can run.
            Shown for the next tap's category, or for the selected hit. */}
        {showEvidence && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <Text style={styles.rowLabel}>EVIDENCE</Text>
              {EVIDENCE_OPTIONS.map((e) => {
                const active = activeEvidence === e;
                return (
                  <Pressable
                    key={e}
                    style={[styles.evChip, active && styles.evChipActive]}
                    onPress={() => setEvidenceFor(e)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Evidence: ${HIT_EVIDENCE_LABELS[e]}`}
                  >
                    <Text style={[styles.evChipText, active && styles.evChipTextActive]}>
                      {HIT_EVIDENCE_LABELS[e]}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.evChip, styles.softChip, activeSoftSpot && styles.softChipActive]}
                onPress={toggleSoftSpot}
                accessibilityRole="button"
                accessibilityState={{ checked: activeSoftSpot }}
                accessibilityLabel="Soft spot felt under finger pressure"
              >
                <Ionicons
                  name={activeSoftSpot ? 'checkmark-circle' : 'hand-left-outline'}
                  size={18}
                  color={activeSoftSpot ? colors.textInverse : colors.cream}
                />
                <Text style={[styles.evChipText, activeSoftSpot && styles.evChipTextActive]}>
                  Soft spot (felt)
                </Text>
              </Pressable>
            </ScrollView>
          </>
        )}

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
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  // Glove-sized close / edit targets (Drift #1) — were icons in 4pt of padding.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
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

  rowLabel: {
    color: colors.cream,
    opacity: 0.6,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    marginRight: spacing.xs,
  },
  // Evidence chips: brand-blue when active so they never read as the orange
  // category selection; the soft-spot toggle goes green — it is a confirmation.
  evChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
  },
  evChipActive: { backgroundColor: colors.brand },
  evChipText: { color: colors.cream, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  evChipTextActive: { color: colors.textInverse },
  softChip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  softChipActive: { backgroundColor: colors.success, borderColor: colors.success },

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
