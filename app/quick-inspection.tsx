import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  ScrollView,
  Image,
  Alert,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import { analyzeSlope, markPhotosQueued } from '@/lib/services/analyzeSlope';
import { describeAnalysisError } from '@/lib/services/gemini';
import { isGeminiConfigured } from '@/lib/env';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  AREA_TAGS,
  type CaptureMode,
  type Inspection,
  type PhotoAnalysisStatus,
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
import { useToastStore } from '@/lib/stores/toastStore';
import { useCaptureSettingsStore } from '@/lib/stores/captureSettingsStore';
import { CameraHUD } from '@/components/CameraHUD';
import { LevelGuide, ThirdsGrid, useThrottledMotion } from '@/components/capture/LevelGuide';
import { LiveOverlay } from '@/components/capture/LiveOverlay';
import { CaptureSettingsSheet } from '@/components/capture/CaptureSettingsSheet';
import { Pill, type PillTone } from '@/components/ui/Pill';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const INITIAL_SLOPE: SlopeOrientation = 'S';

/**
 * Ceiling on one import run. expo-image-picker in Expo Go can only be driven
 * one asset at a time (see `importFromLibrary`), so "multi-select" is a loop —
 * and a loop needs a stop even if the user never taps Cancel.
 */
const IMPORT_RUN_LIMIT = 24;

/** Inner inset of the capture-mode segmented track (the thumb slides inside it). */
const MODE_TRACK_PAD = spacing.xs;

/** The shutter ring — the one control a gloved thumb must never miss. */
const SHUTTER = 80;
const SHUTTER_CORE = SHUTTER - 18;

/** How long the shutter waits for the live loop to hand the camera back. */
const CAMERA_LOCK_WAIT_MS = 3000;

type CapturedPhoto = {
  uri: string;
  slope: SlopeOrientation;
  /** One of AREA_TAGS — the subject the inspector had selected when shooting. */
  areaTag: string;
  captureMode: CaptureMode;
  /** Library imports are flagged so the strip can show where a photo came from. */
  imported?: boolean;
  /** Where the photo landed in the store the moment it was taken. */
  inspectionId: string;
  slopeId: string;
  photoIndex: number;
};

/**
 * Screen-local analysis bookkeeping for photos the store has not (yet)
 * recorded a `photoAnalysis` entry for. The store's record wins whenever it
 * exists — this only fills the gap between "attached" and "analyzeSlope
 * wrote something".
 */
type LocalAnalysis = { status: 'queued' | 'analyzing' | 'failed'; error?: string };

type StripState = {
  status: PhotoAnalysisStatus | 'no_ai';
  findingCount?: number;
  error?: string;
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
        <Ionicons name="camera-outline" size={28} color={colors.textSubtle} />
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
    borderRadius: radii.button,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function QuickInspectionNative() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const createInspection = useInspectionStore((s) => s.create);
  const removeInspection = useInspectionStore((s) => s.remove);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const liveOverlay = useCaptureSettingsStore((s) => s.liveOverlay);
  const guides = useCaptureSettingsStore((s) => s.guides);
  const setLiveOverlay = useCaptureSettingsStore((s) => s.setLiveOverlay);
  const reducedMotion = useReducedMotion();
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
  const [capturing, setCapturing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [livePausedReason, setLivePausedReason] = useState<string | null>(null);
  // The bottom dock grew several rows; the HUD's bottom-left stack tracks its
  // measured height instead of a constant that drifts every layout change.
  const [dockHeight, setDockHeight] = useState(0);
  const [topBarHeight, setTopBarHeight] = useState(0);

  // ── Where photos land ─────────────────────────────────────────────────
  // Photos are attached to the inspection the moment they are taken (a
  // standalone capture auto-creates a lightweight inspection on the first
  // shutter press) so the review strip can analyse them in place and hand
  // any of them to Edit Detection. Nothing is held only in screen state.
  const targetIdRef = useRef<string | null>(jobId ?? null);
  const createdHereRef = useRef(false);
  const [targetId, setTargetId] = useState<string | null>(jobId ?? null);
  const inspection = useInspectionStore((s) =>
    targetId ? s.inspections.find((i) => i.id === targetId) : undefined,
  );

  // ── Per-photo analysis runner ─────────────────────────────────────────
  const [localAnalysis, setLocalAnalysis] = useState<Record<string, LocalAnalysis>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const pendingRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  const photosRef = useRef<CapturedPhoto[]>([]);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Camera ownership ──────────────────────────────────────────────────
  // `takePictureAsync` must never run twice at once. The shutter and the
  // live loop share this ref: whoever sets it true owns the camera.
  const cameraLock = useRef(false);

  // ── Focus / app state → sensors + live loop ───────────────────────────
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) =>
      setAppActive(next === 'active'),
    );
    return () => sub.remove();
  }, []);
  const motionSample = useThrottledMotion(focused && appActive && permission?.granted === true);

  // iOS-17 on-glass segmented control for capture mode: a white thumb springs
  // between segments on a glass track. Purely presentational chrome — the
  // selection logic (selectCaptureMode) is untouched.
  const [modeTrackW, setModeTrackW] = useState(0);
  const modeThumbX = useSharedValue(0);
  const activeModeIndex = Math.max(
    0,
    CAPTURE_MODE_OPTIONS.findIndex((o) => o.mode === captureMode),
  );
  const modeSegW =
    modeTrackW > 0
      ? (modeTrackW - MODE_TRACK_PAD * 2) / CAPTURE_MODE_OPTIONS.length
      : 0;
  useEffect(() => {
    if (modeSegW > 0) {
      const x = MODE_TRACK_PAD + activeModeIndex * modeSegW;
      modeThumbX.value = reducedMotion ? x : withSpring(x, motion.snappy);
    }
  }, [modeSegW, activeModeIndex, modeThumbX, reducedMotion]);
  const modeThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: modeThumbX.value }],
  }));

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

  /**
   * Drain the screen's analysis queue one slope-batch at a time. Every
   * pending photo on the head photo's slope rides one `analyzeSlope` call
   * (explicit `photoIndexes`, so a Retry re-runs a photo the store already
   * counts as analysed); photos captured while it runs stay queued for the
   * next pass. The pass result names each failed photo with a plain-words
   * reason — that is what the strip and the hint line show.
   */
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    const nextUri = pendingRef.current[0];
    if (!nextUri) return;
    const head = photosRef.current.find((p) => p.uri === nextUri);
    if (!head) {
      pendingRef.current.shift();
      void pump();
      return;
    }
    const batch = photosRef.current.filter(
      (p) => p.slopeId === head.slopeId && pendingRef.current.includes(p.uri),
    );
    const batchUris = batch.map((p) => p.uri);
    pendingRef.current = pendingRef.current.filter((u) => !batchUris.includes(u));
    runningRef.current = true;
    if (mountedRef.current) {
      setAnalyzing(true);
      setLocalAnalysis((prev) => {
        const next = { ...prev };
        for (const u of batchUris) next[u] = { status: 'analyzing' };
        return next;
      });
    }

    let batchError: string | null = null;
    let failures: { uri: string; reason: string }[] = [];
    try {
      const result = await analyzeSlope(head.inspectionId, head.slopeId, {
        photoIndexes: batch.map((p) => p.photoIndex),
      });
      failures = result.failures;
    } catch (e) {
      // analyzeSlope only throws when the slope itself is gone (discarded
      // mid-pass) or on a programming error; per-photo failures come back
      // in `failures`, already toasted by the service.
      batchError = describeAnalysisError(e);
    }

    const slopeNow = useInspectionStore
      .getState()
      .inspections.find((i) => i.id === head.inspectionId)
      ?.slopes.find((s) => s.id === head.slopeId);
    const analyzed = new Set(slopeNow?.analyzedPhotoIndices ?? []);
    let ok = 0;
    let bad = 0;
    const update: Record<string, LocalAnalysis | null> = {};
    for (const p of batch) {
      const failure = failures.find((f) => f.uri === p.uri);
      if (!failure && !batchError && analyzed.has(p.photoIndex)) {
        update[p.uri] = null;
        ok++;
      } else {
        const reason =
          failure?.reason ??
          slopeNow?.photoAnalysis?.[p.uri]?.error ??
          batchError ??
          'Analysis did not finish.';
        update[p.uri] = { status: 'failed', error: reason };
        bad++;
      }
    }

    runningRef.current = false;
    if (mountedRef.current) {
      setLocalAnalysis((prev) => {
        const next = { ...prev };
        for (const [u, v] of Object.entries(update)) {
          if (v) next[u] = v;
          else delete next[u];
        }
        return next;
      });
      setAnalyzing(false);
    }

    if (bad > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      // Per-photo failures were already toasted by analyzeSlope; only a
      // pass that never ran needs its own.
      if (batchError) {
        useToastStore.getState().show({
          tone: 'danger',
          title: 'Analysis could not run',
          body: batchError,
        });
      }
    } else if (ok > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    if (mountedRef.current) void pump();
  }, []);

  const enqueueAnalysis = useCallback(
    (uri: string) => {
      if (!isGeminiConfigured) return;
      const photo = photosRef.current.find((p) => p.uri === uri);
      // The store's own "Queued" record, so the Analyze screen and the job
      // agree with this strip about the photo's state from the first moment.
      if (photo) markPhotosQueued(photo.inspectionId, photo.slopeId, [uri]);
      setLocalAnalysis((prev) => ({ ...prev, [uri]: { status: 'queued' } }));
      if (!pendingRef.current.includes(uri)) pendingRef.current.push(uri);
      void pump();
    },
    [pump],
  );

  const ensureInspection = (): string => {
    if (targetIdRef.current) return targetIdRef.current;
    // Customer/address/roof details default to placeholders the inspector
    // can edit later on the Job screen.
    const ins = createInspection({
      customerName: 'Quick inspection',
      address: 'Address pending',
      material: 'architectural_asphalt',
      ageYears: 0,
      geometry: 'gable',
      condition: 'good',
    });
    targetIdRef.current = ins.id;
    createdHereRef.current = true;
    setTargetId(ins.id);
    logActivity({
      kind: 'job_created',
      inspectionId: ins.id,
      message: `Created quick inspection ${ins.reportId}`,
    });
    return ins.id;
  };

  /**
   * Save a normalized photo to the inspection and queue it for analysis.
   * areaTag / captureMode ride each capture into Slope.photoMeta so the
   * analysis and report layers can bucket hits per mode.
   */
  const addPhoto = (uri: string, imported?: boolean) => {
    const inspectionId = ensureInspection();
    attachRawPhotos(inspectionId, [{ uri, slope, areaTag, captureMode }]);
    const stored = useInspectionStore
      .getState()
      .inspections.find((i) => i.id === inspectionId)
      ?.slopes.find((s) => s.orientation === slope);
    const photoIndex = stored ? stored.photoPaths.lastIndexOf(uri) : -1;
    if (!stored || photoIndex < 0) {
      throw new Error('The photo could not be saved to the inspection.');
    }
    const photo: CapturedPhoto = {
      uri,
      slope,
      areaTag,
      captureMode,
      imported,
      inspectionId,
      slopeId: stored.id,
      photoIndex,
    };
    photosRef.current = [...photosRef.current, photo];
    setPhotos(photosRef.current);
    enqueueAnalysis(uri);
  };

  const acquireCamera = async (): Promise<boolean> => {
    const deadline = Date.now() + CAMERA_LOCK_WAIT_MS;
    while (cameraLock.current) {
      if (Date.now() > deadline) return false;
      await sleep(50);
    }
    cameraLock.current = true;
    return true;
  };

  const capture = async () => {
    if (!camRef.current || capturing) return;
    setCapturing(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (!(await acquireCamera())) {
        throw new Error('The camera is busy — try again.');
      }
      let uri: string | undefined;
      try {
        // Capture near-lossless. The old 0.7 baked JPEG artifacts into the
        // frame before our pipeline ever saw it, permanently smearing the
        // granule texture damage calls depend on. prepareCapturedPhoto is
        // the single intentional lossy step.
        const photo = await camRef.current.takePictureAsync({ quality: 0.95 });
        uri = photo?.uri;
      } finally {
        cameraLock.current = false;
      }
      if (!uri) throw new Error('No photo data');
      const small = await prepareCapturedPhoto(uri);
      addPhoto(small);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCapturing(false);
    }
  };

  /**
   * Import existing photos from the library. Imports are first-class captures:
   * same `prepareCapturedPhoto` normalization, same area tag / capture mode,
   * same store path, so they reach analysis by exactly the camera's path.
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
        addPhoto(small, true);
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
    const inspectionId = targetIdRef.current;
    if (photos.length === 0 || !inspectionId) {
      router.back();
      return;
    }

    const singles = photos.filter((p) => p.captureMode === 'single_shingle').length;
    logActivity({
      kind: 'photo_captured',
      inspectionId,
      message:
        `Captured ${photos.length} photo${photos.length === 1 ? '' : 's'} for inspection` +
        (singles > 0 ? ` (${singles} single-shingle)` : ''),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // Jump straight into the analysis screen for the slope we were shooting
    // so the capture -> analyze loop is one continuous flow. Fall back to the
    // job screen only if no slope ended up with photos.
    const ins = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
    const slopeWithPhotos =
      ins?.slopes.find((s) => s.orientation === slope && s.photoPaths.length > 0) ??
      ins?.slopes.find((s) => s.photoPaths.length > 0);
    if (slopeWithPhotos) {
      router.replace({
        pathname: '/analyze',
        params: { inspectionId, slopeId: slopeWithPhotos.id },
      });
    } else {
      router.replace({ pathname: `/job/${inspectionId}` as any });
    }
  };

  const close = () => {
    const inspectionId = targetIdRef.current;
    if (photos.length === 0 || !inspectionId) {
      router.back();
      return;
    }
    const n = photos.length;
    if (createdHereRef.current) {
      Alert.alert(
        'Keep these photos?',
        `${n} photo${n === 1 ? ' is' : 's are'} saved to a new quick inspection.`,
        [
          {
            text: 'Discard photos',
            style: 'destructive',
            onPress: () => {
              removeInspection(inspectionId);
              router.back();
            },
          },
          { text: 'Keep and exit', onPress: () => router.back() },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }
    toast({
      tone: 'info',
      title: `${n} photo${n === 1 ? '' : 's'} saved to the job`,
    });
    router.back();
  };

  const onLiveError = useCallback(
    (reason: string) => {
      setLiveOverlay(false);
      setLivePausedReason(reason);
      toast({ tone: 'warn', title: 'Live overlay paused', body: reason });
    },
    [setLiveOverlay, toast],
  );

  const openPhoto = (photo: CapturedPhoto, state: StripState) => {
    Haptics.selectionAsync().catch(() => {});
    if (state.status === 'failed') {
      enqueueAnalysis(photo.uri);
      return;
    }
    router.push({
      pathname: '/edit-detection',
      params: {
        inspectionId: photo.inspectionId,
        slopeId: photo.slopeId,
        photoIndex: String(photo.photoIndex),
      },
    });
  };

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
          <Pressable onPress={() => router.back()} style={styles.permLink}>
            <Text style={styles.linkText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const chromeTop = insets.top + topBarHeight + spacing.sm;
  const chromeBottom = dockHeight ? dockHeight + insets.bottom + spacing.sm : undefined;
  const targetPitch = inspection?.slopes.find((s) => s.orientation === slope)?.pitchDegrees;
  const livePaused = capturing || importing || analyzing;

  // The most recent failed photo's reason, in plain words, where the roofer
  // is already looking — the pill alone only has room for "Failed · Retry".
  const lastFailure = [...photos]
    .reverse()
    .map((p) => stripStateFor(p, inspection, localAnalysis[p.uri]))
    .find((s) => s.status === 'failed');

  const hint = importing
    ? 'Keep picking photos — tap Cancel in the picker when you are done.'
    : photos.length === 0
    ? captureModeOption(captureMode).hint
    : lastFailure
    ? `Analysis failed — ${(lastFailure.error ?? 'unknown reason').replace(/[.\s]+$/, '')}. Tap the photo to retry.`
    : !isGeminiConfigured
    ? 'AI is not connected — photos are saved; analysis runs once a key is set.'
    : liveOverlay
    ? 'Live overlay reads the camera. Photos analyze as you shoot — tap Done when finished.'
    : 'Photos analyze as you shoot. Tap a thumbnail to check it, Done when finished.';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView
        ref={camRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        // Live grabs a frame every ~3 s; the preview must not blink for each
        // one. The haptic still confirms the roofer's own shutter press.
        animateShutter={!liveOverlay}
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Viewfinder layers — grid, live boxes, level — all non-interactive. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {guides && <ThirdsGrid />}
        <LiveOverlay
          enabled={liveOverlay}
          cameraRef={camRef}
          cameraReady={cameraReady}
          cameraLock={cameraLock}
          paused={livePaused}
          focused={focused}
          slope={slope}
          reducedMotion={reducedMotion}
          labelTop={chromeTop}
          onError={onLiveError}
        />
        {guides && (
          <LevelGuide
            motion={motionSample}
            targetPitchDegrees={targetPitch}
            reducedMotion={reducedMotion}
          />
        )}
      </View>

      <CameraHUD
        selectedSlope={slope}
        areaTag={areaTag}
        captureMode={captureMode}
        motion={motionSample}
        topInset={chromeTop + (liveOverlay ? touchTarget.small : 0)}
        bottomInset={chromeBottom}
      />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View
          style={styles.topRow}
          onLayout={(e) => setTopBarHeight(e.nativeEvent.layout.height)}
        >
          <Pressable
            onPress={close}
            style={styles.topBtn}
            accessibilityRole="button"
            accessibilityLabel="Close camera"
          >
            <Ionicons name="close" size={26} color={colors.textInverse} />
          </Pressable>

          <Pressable
            style={styles.topPill}
            onPress={photos.length > 0 ? finish : undefined}
            disabled={photos.length === 0}
            accessibilityRole={photos.length > 0 ? 'button' : 'text'}
            accessibilityLabel={
              photos.length > 0
                ? `${slope} slope, ${photos.length} photos. Finish and review.`
                : `${slope} slope. No photos yet.`
            }
          >
            <Text style={styles.topPillSlope}>{slope}</Text>
            <Text style={styles.topPillText} numberOfLines={1}>
              {photos.length === 0
                ? 'slope · no photos yet'
                : `slope · ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
            </Text>
          </Pressable>

          <View style={styles.topRightGroup}>
            <Pressable
              onPress={() => router.push('/pitch-gauge')}
              style={styles.topBtn}
              accessibilityRole="button"
              accessibilityLabel="Open pitch gauge"
            >
              <Ionicons name="compass-outline" size={24} color={colors.textInverse} />
            </Pressable>
            <Pressable
              onPress={() => setSettingsOpen(true)}
              style={[styles.topBtn, liveOverlay && styles.topBtnActive]}
              accessibilityRole="button"
              accessibilityLabel="Capture settings"
            >
              <Ionicons
                name="settings-outline"
                size={24}
                color={liveOverlay ? colors.text : colors.textInverse}
              />
            </Pressable>
          </View>
        </View>

        <View
          style={styles.bottomDock}
          onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
        >
          {photos.length > 0 && (
            <ReviewStrip
              photos={photos}
              inspection={inspection}
              localAnalysis={localAnalysis}
              reducedMotion={reducedMotion}
              onOpen={openPhoto}
              onDone={finish}
            />
          )}

          {/* Capture mode. Above everything else because it decides whether a
              photo's hits can ever count toward the per-square threshold.
              iOS-17 on-glass segmented: glass track, white sliding thumb. */}
          <View
            style={styles.modeTrack}
            onLayout={(e) => setModeTrackW(e.nativeEvent.layout.width)}
          >
            {modeSegW > 0 && (
              <Animated.View
                style={[styles.modeThumb, { width: modeSegW }, modeThumbStyle]}
              />
            )}
            {CAPTURE_MODE_OPTIONS.map((opt) => {
              const active = captureMode === opt.mode;
              return (
                <Pressable
                  key={opt.mode}
                  style={styles.modeSegment}
                  onPress={() => selectCaptureMode(opt.mode)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${opt.label}. ${opt.hint}`}
                >
                  <Ionicons
                    name={opt.icon}
                    size={18}
                    color={active ? colors.text : colors.textInverse}
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
                  style={[styles.chip, active && styles.chipActive]}
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
                style={[styles.chip, slope === s && styles.chipActive]}
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
            <Pressable
              onPress={importFromLibrary}
              disabled={importing}
              style={[styles.dockBtn, importing && styles.dockBtnBusy]}
              accessibilityRole="button"
              accessibilityLabel="Import photos from library. Keep picking, then tap Cancel when done."
            >
              <Ionicons name="images-outline" size={26} color={colors.textInverse} />
            </Pressable>

            <Pressable
              style={[styles.shutter, capturing && styles.shutterBusy]}
              onPress={capture}
              disabled={capturing}
              accessibilityRole="button"
              accessibilityLabel="Capture photo"
            >
              <View style={styles.shutterInner} />
            </Pressable>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setTorch((t) => !t);
              }}
              style={[styles.dockBtn, torch && styles.dockBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ checked: torch }}
              accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
            >
              <Ionicons
                name={torch ? 'flashlight' : 'flashlight-outline'}
                size={26}
                color={torch ? colors.text : colors.textInverse}
              />
            </Pressable>
          </View>

          <Text style={styles.captureHint} numberOfLines={2}>
            {hint}
          </Text>
        </View>
      </SafeAreaView>

      <CaptureSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        livePausedReason={livePausedReason}
      />
    </View>
  );
}

// ── Review strip ─────────────────────────────────────────────────────────

/** State of one thumbnail: the store's record wins, screen-local fills gaps. */
function stripStateFor(
  photo: CapturedPhoto,
  inspection: Inspection | undefined,
  local: LocalAnalysis | undefined,
): StripState {
  if (!isGeminiConfigured) return { status: 'no_ai' };
  const slope = inspection?.slopes.find((s) => s.id === photo.slopeId);
  const markersOnPhoto = slope
    ? slope.damage.filter((m) => m.photoIndex === photo.photoIndex).length
    : 0;
  const stored = slope?.photoAnalysis?.[photo.uri];
  // Done is done — the store knows before this screen's batch reconciles.
  if (stored?.status === 'done') {
    return { status: 'done', findingCount: stored.findingCount ?? markersOnPhoto };
  }
  // A fresh local queue/analyzing entry (a retry) outranks a stale stored
  // failure; otherwise the store's own record is the truth.
  if (local && local.status !== 'failed') return { status: local.status };
  if (stored) {
    return {
      status: stored.status,
      findingCount: stored.findingCount ?? markersOnPhoto,
      error: stored.error,
    };
  }
  if (slope?.analyzedPhotoIndices?.includes(photo.photoIndex)) {
    return { status: 'done', findingCount: markersOnPhoto };
  }
  if (local) return { status: local.status, error: local.error };
  return { status: 'queued' };
}

function pillFor(state: StripState): { label: string; tone: PillTone; pulse: boolean } {
  switch (state.status) {
    case 'no_ai':
      return { label: 'No AI', tone: 'warn', pulse: false };
    case 'analyzing':
      return { label: 'Analyzing', tone: 'info', pulse: true };
    case 'done':
      return { label: `Done · ${state.findingCount ?? 0}`, tone: 'success', pulse: false };
    case 'failed':
      return { label: 'Failed · Retry', tone: 'danger', pulse: false };
    default:
      return { label: 'Queued', tone: 'neutral', pulse: false };
  }
}

function ReviewStrip({
  photos,
  inspection,
  localAnalysis,
  reducedMotion,
  onOpen,
  onDone,
}: {
  photos: CapturedPhoto[];
  inspection: Inspection | undefined;
  localAnalysis: Record<string, LocalAnalysis>;
  reducedMotion: boolean;
  onOpen: (photo: CapturedPhoto, state: StripState) => void;
  onDone: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  return (
    <View style={styles.stripRow}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })}
      >
        {photos.map((p) => {
          const state = stripStateFor(p, inspection, localAnalysis[p.uri]);
          const pill = pillFor(state);
          const a11y =
            state.status === 'failed'
              ? `Photo ${p.photoIndex + 1}, ${shortAreaTag(p.areaTag)}. Analysis failed${state.error ? `: ${state.error}` : ''}. Tap to retry.`
              : `Photo ${p.photoIndex + 1}, ${shortAreaTag(p.areaTag)}, ${pill.label}. Tap to open.`;
          return (
            <Pressable
              key={p.uri}
              style={styles.thumbCol}
              onPress={() => onOpen(p, state)}
              accessibilityRole="button"
              accessibilityLabel={a11y}
            >
              <View style={[styles.thumbWrap, state.status === 'failed' && styles.thumbWrapFailed]}>
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
                {p.imported && (
                  <View style={[styles.thumbModeDot, styles.thumbImportDot]}>
                    <Ionicons name="images" size={10} color={colors.textInverse} />
                  </View>
                )}
              </View>
              <Pill
                label={pill.label}
                tone={pill.tone}
                size="sm"
                solid
                dot={pill.pulse}
                pulse={pill.pulse && !reducedMotion}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      {/* The screen's one orange moment — Done hands off to analysis. */}
      <Pressable style={styles.doneBtn} onPress={onDone} accessibilityRole="button">
        <Text style={styles.doneBtnText}>Done</Text>
        <Text style={styles.doneBtnSub}>{photos.length}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.black },
  overlay: { flex: 1, justifyContent: 'space-between' },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  // Every top-bar control is a full 56pt glass disc — the smoke pair, so it
  // reads on any roof behind it.
  topBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBtnActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  topPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  topPillSlope: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
  },
  topPillText: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  topRightGroup: { flexDirection: 'row', gap: spacing.sm },

  bottomDock: {
    paddingBottom: spacing.sm,
    backgroundColor: glass.smokeFill,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: glass.smokeBorder,
  },

  // Review strip — thumbnails with their analysis state, plus Done.
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  strip: { gap: spacing.sm, alignItems: 'flex-start', paddingRight: spacing.sm },
  thumbCol: { alignItems: 'center', gap: spacing.xs, minWidth: touchTarget.standard },
  thumbWrap: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.textInverse,
    overflow: 'hidden',
  },
  thumbWrapFailed: { borderColor: colors.danger },
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
  thumbImportDot: { right: undefined, left: 2, backgroundColor: colors.textMuted },

  doneBtn: {
    minWidth: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  doneBtnSub: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  // On-glass segmented track + sliding white thumb (iOS-17 pattern).
  modeTrack: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.md,
    backgroundColor: glass.fill,
    padding: MODE_TRACK_PAD,
  },
  modeThumb: {
    position: 'absolute',
    top: MODE_TRACK_PAD,
    bottom: MODE_TRACK_PAD,
    left: 0,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  modeSegment: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegmentText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    opacity: 0.8,
    flexShrink: 1,
    textAlign: 'center',
  },
  modeSegmentTextActive: { color: colors.text, opacity: 1, fontWeight: fontWeight.bold },

  chipRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
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
  // Picker chips share the on-glass language: glass rest state, white fill +
  // ink text when active (selection matches the segmented thumb, not orange).
  chip: {
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.surface },
  chipText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.text, fontWeight: fontWeight.bold },

  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxxl,
    paddingTop: spacing.sm,
  },
  dockBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockBtnBusy: { opacity: 0.5 },
  dockBtnActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  // 80pt shutter: thin white ring, white core with a breathing gap between.
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.textInverse,
  },
  shutterBusy: { opacity: 0.6 },
  shutterInner: {
    width: SHUTTER_CORE,
    height: SHUTTER_CORE,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },

  captureHint: {
    color: colors.textInverse,
    opacity: 0.78,
    fontSize: fontSize.caption,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  permRoot: { flex: 1, backgroundColor: colors.navy },
  permWrap: { flex: 1, padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  permTitle: { color: colors.textInverse, fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, textAlign: 'center' },
  permBody: { color: colors.textInverse, opacity: 0.82, fontSize: fontSize.bodyMd, textAlign: 'center' },
  permBtn: {
    height: touchTarget.sticky,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  permBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  permLink: {
    minHeight: touchTarget.standard,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  linkText: { color: colors.textInverse, fontSize: fontSize.bodyMd },
});
