import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Stack,
  useLocalSearchParams,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import * as Haptics from 'expo-haptics';
import {
  colors,
  fontSize,
  fontWeight,
  glass,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  AREA_TAGS,
  type CaptureMode,
  type SlopeOrientation,
} from '@/lib/models/types';
import {
  CAPTURE_MODE_OPTIONS,
  DEFAULT_CAPTURE_MODE,
  captureModeOption,
  defaultAreaTagForSlope,
  shortAreaTag,
} from '@/lib/services/captureSession';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import { CameraHUD } from '@/components/CameraHUD';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const INITIAL_SLOPE: SlopeOrientation = 'S';

/**
 * Ceiling on one import run. expo-image-picker in Expo Go can only be driven
 * one asset at a time (see `importFromLibrary`), so "multi-select" is a loop —
 * and a loop needs a stop even if the user never taps Cancel.
 */
const IMPORT_RUN_LIMIT = 24;

type CapturedPhoto = {
  uri: string;
  slope: SlopeOrientation;
  /** One of AREA_TAGS — the subject the inspector had selected when shooting. */
  areaTag: string;
  captureMode: CaptureMode;
  /** Library imports are flagged so the strip can show where a photo came from. */
  imported?: boolean;
};

export default function QuickInspection() {
  // The capture pipeline (expo-camera viewfinder, HEIC handling, haptics)
  // is native-only. On web, show a friendly notice instead of half-rendering
  // a dead viewfinder. Branching lives in this wrapper so the native
  // component's hooks stay unconditional.
  if (Platform.OS === 'web') return <QuickInspectionWebNotice />;
  return <QuickInspectionNative />;
}

function QuickInspectionWebNotice() {
  const router = useRouter();
  return (
    <SafeAreaView style={webStyles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={webStyles.wrap}>
        <View style={webStyles.iconWrap}>
          <Ionicons name="camera-outline" size={36} color={colors.brand} />
        </View>
        <Text style={webStyles.title}>Quick Inspection uses the phone camera</Text>
        <Text style={webStyles.body}>
          This tool runs on the RoofWise mobile app — your jobs, leads,
          reports, and map stay in sync here on the web.
        </Text>
        <Pressable style={webStyles.cta} onPress={() => router.replace('/')}>
          <Text style={webStyles.ctaText}>Back to dashboard</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const webStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
    maxWidth: 420,
  },
  body: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
    maxWidth: 420,
  },
  cta: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});

function QuickInspectionNative() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const createInspection = useInspectionStore((s) => s.create);
  const logActivity = useActivityStore((s) => s.log);
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const [slope, setSlope] = useState<SlopeOrientation>(INITIAL_SLOPE);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(DEFAULT_CAPTURE_MODE);
  const [areaTag, setAreaTag] = useState<string>(() =>
    defaultAreaTagForSlope(INITIAL_SLOPE),
  );
  // Once the inspector picks a subject by hand, changing slopes stops
  // overwriting it — you shoot gutters on more than one elevation.
  const [areaTagPinned, setAreaTagPinned] = useState(false);
  const [importing, setImporting] = useState(false);
  // The bottom dock grew three rows; the HUD's bottom-left stack tracks its
  // measured height instead of a constant that drifts every layout change.
  const [dockHeight, setDockHeight] = useState(0);

  const selectSlope = (next: SlopeOrientation) => {
    setSlope(next);
    if (!areaTagPinned) setAreaTag(defaultAreaTagForSlope(next));
    Haptics.selectionAsync().catch(() => {});
  };

  const selectAreaTag = (tag: string) => {
    setAreaTag(tag);
    setAreaTagPinned(true);
    Haptics.selectionAsync().catch(() => {});
  };

  const selectCaptureMode = (mode: CaptureMode) => {
    setCaptureMode(mode);
    Haptics.selectionAsync().catch(() => {});
  };

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Pre-flight safety check (re-runs the checklist every 4h while enabled).
  // Gated on navigator readiness: cold-launching straight into this route
  // (deep link, notification tap) used to fire router.replace before the
  // root navigator mounted, which throws "Attempted to navigate before
  // mounting the Root Layout component" and leaves a dead screen.
  const preFlightEnabled = useSafetyStore((s) => s.preFlightEnabled);
  const lastConfirmedAt = useSafetyStore((s) => s.lastConfirmedAt);
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!navReady) return;
    if (!preFlightEnabled) return;
    const fresh =
      lastConfirmedAt &&
      Date.now() - new Date(lastConfirmedAt).getTime() < 4 * 60 * 60 * 1000;
    if (fresh) return;
    router.replace({
      pathname: '/safety-check',
      params: jobId ? { jobId } : undefined,
    });
  }, [navReady, preFlightEnabled, lastConfirmedAt, router, jobId]);

  if (!permission) return <View style={styles.permRoot} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permRoot} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.permWrap}>
          <Ionicons name="camera-outline" size={40} color={colors.textInverse} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permBody}>
            RoofWise uses the camera to capture roof photos for HAAG-protocol analysis.
          </Text>
          <Pressable style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Enable camera</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md }}>
            <Text style={styles.linkText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const capture = async () => {
    if (!camRef.current) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      // Capture near-lossless. The old 0.7 baked JPEG artifacts into the
      // frame before our pipeline ever saw it, permanently smearing the
      // granule texture damage calls depend on. prepareCapturedPhoto is
      // the single intentional lossy step. (Unrelated to the ImagePicker
      // `quality` param removed in #23 — that was a multi-HEIC OOM path.)
      const photo = await camRef.current.takePictureAsync({ quality: 0.95 });
      if (!photo?.uri) throw new Error('No photo data');
      const small = await prepareCapturedPhoto(photo.uri);
      setPhotos((prev) => [...prev, { uri: small, slope, areaTag, captureMode }]);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  /**
   * Import existing photos from the library. Imports are first-class captures:
   * same `prepareCapturedPhoto` normalization, same area tag / capture mode,
   * same `photos` array, so they reach analysis by exactly the camera's path.
   *
   * Multi-photo import is a LOOP over the single-asset picker, not
   * `allowsMultipleSelection`. expo-image-picker's multi-select handler fires
   * its JS completion once per failed asset and never debounces, so two
   * unreadable assets (iCloud originals, simulator HEIC placeholders) reject
   * the same promise twice and abort the process — SIGABRT, no JS error
   * (PROMPT_LOG #24/#25). Re-presenting the single-select picker gives the
   * same "pick several" outcome on the path that settles exactly once. The
   * user taps Cancel to stop.
   */
  const importFromLibrary = async () => {
    if (importing) return;
    setImporting(true);
    let added = 0;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photos access needed',
          perm.canAskAgain
            ? 'RoofWise needs Photos access to import existing roof images. You can still capture with the camera.'
            : 'Enable Photos access for RoofWise in Settings to import existing images. You can still capture with the camera.',
        );
        return;
      }

      for (let i = 0; i < IMPORT_RUN_LIMIT; i++) {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: false,
          // Compatible (not Current) makes iOS transcode HEIC / iCloud originals
          // to a readable JPEG before handing them over. Current returns raw HEIC
          // bytes, which fail with "Cannot load representation of type public.heic"
          // — especially on the simulator and for not-yet-downloaded iCloud photos.
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });
        // Cancel is how the user says "done adding".
        if (result.canceled || result.assets.length === 0) break;

        const small = await prepareCapturedPhoto(result.assets[0].uri);
        setPhotos((prev) => [
          ...prev,
          { uri: small, slope, areaTag, captureMode, imported: true },
        ]);
        added += 1;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }

      if (added >= IMPORT_RUN_LIMIT) {
        Alert.alert(
          'Import paused',
          `Added ${added} photos. Tap the library button again to keep importing.`,
        );
      }
    } catch (e) {
      // One bad asset ends the run rather than looping the same failure.
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const readFail = /load representation|failed to read/i.test(msg);
      Alert.alert(
        readFail ? "Couldn't read that photo" : 'Import failed',
        readFail
          ? "iOS couldn't load this image's data. This is common with the iOS Simulator's built-in photos (they're HEIC placeholders) and with iCloud photos that haven't fully downloaded to the device. Try a screenshot as a test image, pick a different photo, or run on a real iPhone."
          : msg,
      );
    } finally {
      setImporting(false);
    }
  };

  const finish = () => {
    if (photos.length === 0) {
      router.back();
      return;
    }

    // Standalone capture (no job set) auto-creates a lightweight inspection so
    // photos are never lost. Customer/address/roof details default to
    // placeholders the inspector can edit later on the Job screen.
    let targetId = jobId;
    if (!targetId) {
      const ins = createInspection({
        customerName: 'Quick inspection',
        address: 'Address pending',
        material: 'architectural_asphalt',
        ageYears: 0,
        geometry: 'gable',
        condition: 'good',
      });
      targetId = ins.id;
      logActivity({
        kind: 'job_created',
        inspectionId: ins.id,
        message: `Created quick inspection ${ins.reportId}`,
      });
    }

    // areaTag / captureMode ride each capture into Slope.photoMeta so the
    // analysis and report layers can bucket hits per mode. Nothing here
    // aggregates counts — that happens once markers exist.
    attachRawPhotos(targetId, photos);
    const singles = photos.filter((p) => p.captureMode === 'single_shingle').length;
    logActivity({
      kind: 'photo_captured',
      inspectionId: targetId,
      message:
        `Captured ${photos.length} photo${photos.length === 1 ? '' : 's'} for inspection` +
        (singles > 0 ? ` (${singles} single-shingle)` : ''),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Jump straight into AI analysis for the slope we just filled so the
    // capture -> analyze loop is one continuous flow. Fall back to the job
    // screen only if no slope ended up with photos.
    const ins = useInspectionStore.getState().inspections.find((i) => i.id === targetId);
    const slopeWithPhotos = ins?.slopes.find((s) => s.photoPaths.length > 0);
    if (slopeWithPhotos) {
      router.replace({
        pathname: '/analyze',
        params: { inspectionId: targetId, slopeId: slopeWithPhotos.id },
      });
    } else {
      router.replace({ pathname: `/job/${targetId}` as any });
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
      <CameraHUD
        selectedSlope={slope}
        areaTag={areaTag}
        captureMode={captureMode}
        bottomInset={dockHeight ? dockHeight + insets.bottom + spacing.sm : undefined}
      />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.topBtn}>
            <Ionicons name="close" size={24} color={colors.textInverse} />
          </Pressable>
          <View style={styles.topPill}>
            <Text style={styles.topPillText}>
              {photos.length === 0 ? 'Tap shutter to capture' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <View style={styles.topRightGroup}>
            <Pressable
              onPress={importFromLibrary}
              hitSlop={10}
              disabled={importing}
              style={[styles.topBtn, importing && styles.topBtnBusy]}
              accessibilityLabel="Import photos from library. Keep picking, then tap Cancel when done."
            >
              <Ionicons name="images-outline" size={22} color={colors.textInverse} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/pitch-gauge')}
              hitSlop={10}
              style={styles.topBtn}
              accessibilityLabel="Open pitch gauge"
            >
              <Ionicons name="compass-outline" size={22} color={colors.textInverse} />
            </Pressable>
          </View>
        </View>

        <View
          style={styles.bottomDock}
          onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
        >
          {/* Capture mode. Above everything else because it decides whether a
              photo's hits can ever count toward the per-square threshold. */}
          <View style={styles.modeRow}>
            {CAPTURE_MODE_OPTIONS.map((opt) => {
              const active = captureMode === opt.mode;
              return (
                <Pressable
                  key={opt.mode}
                  style={[styles.modeSegment, active && styles.modeSegmentActive]}
                  onPress={() => selectCaptureMode(opt.mode)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${opt.label}. ${opt.hint}`}
                >
                  <Ionicons
                    name={opt.icon}
                    size={18}
                    color={colors.textInverse}
                    style={{ opacity: active ? 1 : 0.75 }}
                  />
                  <Text
                    style={[styles.modeSegmentText, active && styles.modeSegmentTextActive]}
                    numberOfLines={2}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modeHint} numberOfLines={1}>
            {captureModeOption(captureMode).hint}
          </Text>

          {/* Capture subject — the 19 area tags. Rides each photo into the report. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Text style={styles.rowLabel}>AREA</Text>
            {AREA_TAGS.map((tag) => {
              const active = areaTag === tag;
              return (
                <Pressable
                  key={tag}
                  style={[styles.areaChip, active && styles.chipActive]}
                  onPress={() => selectAreaTag(tag)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Text style={styles.rowLabel}>SLOPE</Text>
            {SLOPES.map((s) => (
              <Pressable
                key={s}
                style={[styles.slopeChip, slope === s && styles.chipActive]}
                onPress={() => selectSlope(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: slope === s }}
                accessibilityLabel={`Slope ${s}`}
              >
                <Text style={[styles.chipText, slope === s && styles.chipTextActive]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.shutterRow}>
            <PhotoStrip photos={photos} />
            <Pressable
              style={styles.shutter}
              onPress={capture}
              accessibilityLabel="Capture photo"
            >
              <View style={styles.shutterInner} />
            </Pressable>
            <Pressable
              style={[styles.doneBtn, photos.length === 0 && styles.doneBtnDisabled]}
              disabled={photos.length === 0}
              onPress={finish}
            >
              <Text style={styles.doneBtnText}>Done</Text>
              <Text style={styles.doneBtnSub}>{photos.length}</Text>
            </Pressable>
          </View>

          <Text style={styles.captureHint}>
            {importing
              ? 'Keep picking photos — tap Cancel in the picker when you are done.'
              : 'Capture or import, then tap Done to run AI damage analysis.'}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Recent captures with their area tag rendered as an overlay chip. The label
 * is drawn over the thumbnail, never composited into the JPEG — the stored
 * pixels stay exactly what the camera saw, which is what an adjuster (and the
 * vision model) has to be able to trust.
 */
function PhotoStrip({ photos }: { photos: CapturedPhoto[] }) {
  if (photos.length === 0) return <View style={styles.stripPlaceholder} />;
  const recent = photos.slice(-2);
  const hidden = photos.length - recent.length;
  return (
    <View style={styles.photoStrip}>
      {recent.map((p, i) => (
        <View key={`${p.uri}-${i}`} style={styles.thumbWrap}>
          <Image source={{ uri: p.uri }} style={styles.thumb} />
          <View style={styles.thumbTag}>
            <Text style={styles.thumbTagText} numberOfLines={1}>
              {shortAreaTag(p.areaTag)}
            </Text>
          </View>
          {p.captureMode === 'single_shingle' && (
            <View style={styles.thumbModeDot}>
              <Ionicons name="layers" size={10} color={colors.textInverse} />
            </View>
          )}
        </View>
      ))}
      {hidden > 0 && (
        <View style={styles.thumbMore}>
          <Text style={styles.thumbMoreText}>+{hidden}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  topBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topRightGroup: { flexDirection: 'row', gap: spacing.sm },
  topBtnBusy: { opacity: 0.5 },
  topPillText: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  bottomDock: { paddingBottom: spacing.md, backgroundColor: 'rgba(0,0,0,0.55)' },

  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  modeSegment: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegmentActive: { backgroundColor: colors.orange },
  modeSegmentText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    opacity: 0.8,
    flexShrink: 1,
    textAlign: 'center',
  },
  modeSegmentTextActive: { opacity: 1, fontWeight: fontWeight.bold },
  modeHint: {
    // Camera chrome sits on the live preview: token colour + opacity rather
    // than a baked rgba literal (Drift #11).
    color: colors.textInverse,
    opacity: 0.78,
    fontSize: fontSize.caption,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },

  chipRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  rowLabel: {
    color: colors.textInverse,
    opacity: 0.6,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    marginRight: spacing.xs,
  },
  areaChip: {
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slopeChip: {
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.orange },
  chipText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.textInverse, fontWeight: fontWeight.bold },

  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.textInverse,
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.textInverse },

  doneBtn: {
    minWidth: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnDisabled: { opacity: 0.4 },
  doneBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  doneBtnSub: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  stripPlaceholder: { width: touchTarget.standard },
  photoStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  thumbWrap: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.textInverse,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  thumbTag: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    paddingVertical: 1,
    alignItems: 'center',
  },
  thumbTagText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },
  thumbModeDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbMore: {
    minWidth: 28,
    height: touchTarget.standard,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbMoreText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
  },

  captureHint: {
    color: 'rgba(240,240,228,0.78)',
    fontSize: fontSize.caption,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  permRoot: { flex: 1, backgroundColor: colors.navy },
  permWrap: { flex: 1, padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  permTitle: { color: colors.textInverse, fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.82)', fontSize: fontSize.bodyMd, textAlign: 'center' },
  permBtn: {
    height: touchTarget.sticky,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  permBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  linkText: { color: colors.textInverse, fontSize: fontSize.bodyMd },
});
