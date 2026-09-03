// Quick Inspection — the camera.
//
// A clean viewfinder by default (the iOS-17-Camera idea): the shutter, the
// last-shot thumbnail, the slope pill, a close and one chevron. Everything
// else is secondary chrome — the mode strip (what the frame is for), the
// tool rail (torch, Live, level, coach, import, pitch, settings) and the
// instrument cluster — revealed by the chevron or a tap on the roof, tucked
// away on the next tap, on capture, or after a few idle seconds. The coach
// drawer rides above the shutter dock with three detents; the thumbnail
// opens the review drawer where Done lives. See `components/capture/hud/`.
//
// Everything below the chrome is unchanged in kind: photos are attached to
// the inspection the moment they are taken, analysed per slope-batch as you
// shoot, and the slope tag is never a silent default (SlopePickerSheet).

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Alert,
  AppState,
  useWindowDimensions,
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
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import {
  importFromLibrary,
  isUnreadableAssetError,
  type LibraryImportProgress,
} from '@/lib/services/libraryImport';
import { analyzeSlope, markPhotosQueued } from '@/lib/services/analyzeSlope';
import { describeAnalysisError } from '@/lib/services/gemini';
import { isGeminiConfigured } from '@/lib/env';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from 'react-native-reanimated';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  type AreaTag,
  type CaptureMode,
  type SlopeOrientation,
  yawToOrientation,
} from '@/lib/models/types';
import { DEFAULT_CAPTURE_MODE, defaultAreaTagForSlope } from '@/lib/services/captureSession';
import { SlopePickerSheet } from '@/components/capture/SlopePickerSheet';
import { AddPhotosToSheet, type AddPhotosChoice } from '@/components/sheets/AddPhotosToSheet';
import { CustomerDetailsSheet, type AutoLocation } from '@/components/sheets/CustomerDetailsSheet';
import { resolveDeviceLocation } from '@/components/LocationField';
import {
  PLACEHOLDER_ADDRESS,
  PLACEHOLDER_CUSTOMER_NAME,
  missingJobDetails,
} from '@/lib/services/placeholderDetails';
import { coachProgress, coachSteps, nextIncompleteStep, zoneForAreaTag } from '@/lib/services/captureCoach';
import { COMPASS_USABLE_ACCURACY, useCompassHeading } from '@/lib/services/deviceMotion';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { startInspectionFromLead } from '@/lib/services/pipeline';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useCaptureSettingsStore } from '@/lib/stores/captureSettingsStore';
import {
  readChromeSafetySignal,
  setChromeArmed,
  useCaptureChromeStore,
} from '@/lib/stores/captureChromeStore';
import { CameraHUD } from '@/components/CameraHUD';
import {
  LEVEL_TOLERANCE_DEG,
  LevelGuide,
  ThirdsGrid,
  useThrottledMotion,
} from '@/components/capture/LevelGuide';
import { LiveOverlay } from '@/components/capture/LiveOverlay';
import { CaptureSettingsSheet } from '@/components/capture/CaptureSettingsSheet';
import {
  CoachDrawer,
  HudChrome,
  ModeStrip,
  RailButton,
  ReviewDrawer,
  ShotThumb,
  Shutter,
  ToolRail,
  frameModeOption,
  summarizeSession,
  type CapturedPhoto,
  type FrameMode,
  type LocalAnalysis,
  type StripState,
} from '@/components/capture/hud';
import { COACH_PEEK_HEIGHT } from '@/components/capture/hud/CoachDrawer';
import { hudPanel } from '@/components/capture/hud/glass';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const INITIAL_SLOPE: SlopeOrientation = 'S';

/** Stable options object — an inline literal re-applies on every render (#63). */
const SCREEN_OPTIONS = { headerShown: false } as const;

/**
 * How long the compass must sit in a new octant before the auto-tag follows
 * it. A roofer turning to frame a shot sweeps through neighbouring octants;
 * only a heading that HOLDS is a slope change.
 */
const AUTO_SLOPE_SETTLE_MS = 900;

/** Octants apart on the compass rose (0–4). */
function octantDistance(a: SlopeOrientation, b: SlopeOrientation): number {
  const i = SLOPES.indexOf(a);
  const j = SLOPES.indexOf(b);
  if (i < 0 || j < 0) return 4;
  const d = Math.abs(i - j) % SLOPES.length;
  return Math.min(d, SLOPES.length - d);
}

/** How long the shutter waits for the live loop to hand the camera back. */
const CAMERA_LOCK_WAIT_MS = 3000;

/** The crash-safety signal is read once per JS session, not per mount. */
let safetySignalChecked = false;

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
      <Stack.Screen options={SCREEN_OPTIONS} />
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
    fontFamily: fontFamily.archivo.bold,
    color: colors.navy,
    textAlign: 'center',
    maxWidth: 420,
  },
  body: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
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
    fontFamily: fontFamily.archivo.semibold,
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
  const updateDetails = useInspectionStore((s) => s.updateDetails);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const liveOverlay = useCaptureSettingsStore((s) => s.liveOverlay);
  const guides = useCaptureSettingsStore((s) => s.guides);
  const setLiveOverlay = useCaptureSettingsStore((s) => s.setLiveOverlay);
  const setGuides = useCaptureSettingsStore((s) => s.setGuides);
  const reducedMotion = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const [slope, setSlope] = useState<SlopeOrientation>(INITIAL_SLOPE);
  // 'auto': the tag follows the compass. 'pinned': the inspector chose it and
  // the compass only WARNS. South is never a silent default any more — with a
  // usable compass the tag tracks the phone; without one, the first shutter
  // asks. Filing a north photo under South corrupts the per-slope counts HAAG
  // §2/§4 decide on, so this is evidence integrity, not polish.
  const [slopeMode, setSlopeMode] = useState<'auto' | 'pinned'>('auto');
  // Non-null = the slope picker is up, with the sentence that explains why.
  const [slopePrompt, setSlopePrompt] = useState<string | null>(null);
  // A prepared photo waiting for the picker's answer before it is filed.
  const pendingCaptureRef = useRef<string | null>(null);
  const autoSlopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A library import waiting for the picker's answer before it starts.
  const pendingImportRef = useRef(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [captureMode, setCaptureMode] = useState<CaptureMode>(DEFAULT_CAPTURE_MODE);
  const [areaTag, setAreaTag] = useState<string>(() =>
    defaultAreaTagForSlope(INITIAL_SLOPE),
  );
  // Once the inspector picks a subject by hand, changing slopes stops
  // overwriting it — you shoot gutters on more than one elevation.
  const [areaTagPinned, setAreaTagPinned] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<LibraryImportProgress | null>(null);
  const multiSelectImport = useCaptureSettingsStore((s) => s.multiSelectImport);
  const coachEnabled = useCaptureSettingsStore((s) => s.coachEnabled);
  const setCoachEnabled = useCaptureSettingsStore((s) => s.setCoachEnabled);
  const coachStepByJob = useCaptureSettingsStore((s) => s.coachStepByJob);
  const setCoachStep = useCaptureSettingsStore((s) => s.setCoachStep);
  const setCollateralZone = useInspectionStore((s) => s.setCollateralZone);
  const [capturing, setCapturing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [livePausedReason, setLivePausedReason] = useState<string | null>(null);
  // "Who is this job for?" — asked on Done when the job is still the
  // placeholder the first shutter created. Prefilled from a GPS
  // reverse-geocode when one resolves; never from an invented address.
  const [namingOpen, setNamingOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [autoLocation, setAutoLocation] = useState<AutoLocation | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  // Live shingle count / coverage from the last live frame, for the cluster.
  const [liveStats, setLiveStats] = useState<{ shingleCount?: number; coverageFraction?: number; pixelsPerInch: number | null } | null>(null);
  // Measured chrome, so every absolute layer clears the others.
  const [dockHeight, setDockHeight] = useState(0);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [modeStripHeight, setModeStripHeight] = useState(0);
  // Hold-to-steady: the long-pressed shutter shows the level until release.
  const [steadying, setSteadying] = useState(false);

  // ── Chrome state (persisted preferences + crash-safety) ───────────────
  const chromeOpenSaved = useCaptureChromeStore((s) => s.chromeOpen);
  const setChromeOpenSaved = useCaptureChromeStore((s) => s.setChromeOpen);
  const keepOpen = useCaptureChromeStore((s) => s.keepOpen);
  const setKeepOpen = useCaptureChromeStore((s) => s.setKeepOpen);
  const coachDetent = useCaptureChromeStore((s) => s.coachDetent);
  const setCoachDetent = useCaptureChromeStore((s) => s.setCoachDetent);
  const squareGuide = useCaptureChromeStore((s) => s.squareGuide);
  const setSquareGuide = useCaptureChromeStore((s) => s.setSquareGuide);
  const staticReason = useCaptureChromeStore((s) => s.staticReason);
  const setStaticReason = useCaptureChromeStore((s) => s.setStaticReason);
  const [chromeOpen, setChromeOpenLocal] = useState<boolean>(chromeOpenSaved);
  const setChromeOpen = useCallback(
    (v: boolean) => {
      setChromeOpenLocal(v);
      setChromeOpenSaved(v);
    },
    [setChromeOpenSaved],
  );
  const toggleChrome = () => {
    Haptics.selectionAsync().catch(() => {});
    setChromeOpen(!chromeOpen);
  };
  // Static chrome: Reduce Motion, or the previous run died on this screen.
  const staticChrome = reducedMotion || staticReason != null;

  useEffect(() => {
    if (safetySignalChecked) return;
    safetySignalChecked = true;
    let cancelled = false;
    readChromeSafetySignal().then((signal) => {
      if (cancelled || !signal) return;
      setStaticReason(signal);
      useToastStore.getState().show({
        tone: 'info',
        title: 'Camera controls are static this session',
        body: 'RoofWise closed unexpectedly on the camera last time. Turn animation back on in capture settings.',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [setStaticReason]);

  // ── Where photos land ─────────────────────────────────────────────────
  // Photos are attached to the inspection the moment they are taken (a
  // standalone capture auto-creates a lightweight inspection on the first
  // shutter press) so the review strip can analyse them in place and hand
  // any of them to Edit Detection. Nothing is held only in screen state.
  const targetIdRef = useRef<string | null>(jobId ?? null);
  const createdHereRef = useRef(false);
  const [targetId, setTargetId] = useState<string | null>(jobId ?? null);
  // A photo has to belong to somebody. Opened without a job, the camera used
  // to create "Quick inspection / Address pending" on the first shutter and
  // the roofer found a nameless job later. Now it ASKS first — new customer,
  // one in the pipeline, or capture now and attach later — an explicit
  // choice over the live viewfinder, never a silent placeholder.
  const [addToOpen, setAddToOpen] = useState<boolean>(() => !jobId);
  const onAddToChoice = (choice: AddPhotosChoice) => {
    setAddToOpen(false);
    if (choice.kind === 'existing') {
      targetIdRef.current = choice.inspectionId;
      setTargetId(choice.inspectionId);
      return;
    }
    if (choice.kind === 'lead') {
      // The lead becomes a job right here (docs/PIPELINE.md §3) — the
      // automation engine moves it to Inspecting the same way any other
      // job-created path does.
      const ins = startInspectionFromLead(choice.leadId);
      if (ins) {
        targetIdRef.current = ins.id;
        setTargetId(ins.id);
      } else {
        toast({ tone: 'danger', title: "Couldn't start the job", body: 'That lead may have been removed.' });
      }
      return;
    }
    if (choice.kind === 'new_customer') {
      // The wizard lands on the job when saved; the job has "Take photos".
      router.replace('/new-job');
    }
    // 'later': today's standalone path — the first shutter creates the job.
  };
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

  // ── Focus / app state → sensors + live loop + the armed flag ──────────
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
  const sensorsOn = focused && appActive && permission?.granted === true;
  // Armed while the camera is on screen; cleared on blur / background /
  // unmount. Still set at the next launch ⇒ the run ended here ⇒ static chrome.
  useEffect(() => {
    setChromeArmed(sensorsOn);
    return () => setChromeArmed(false);
  }, [sensorsOn]);
  const motionSample = useThrottledMotion(sensorsOn);
  const compass = useCompassHeading(sensorsOn);
  const compassUsable = !!compass && compass.accuracy >= COMPASS_USABLE_ACCURACY;
  const compassSlope: SlopeOrientation | null = compassUsable
    ? yawToOrientation(compass.degrees)
    : null;

  // Auto-tag: follow the compass once it has HELD a new octant. Pinned mode
  // never moves the tag — it only lets the shutter warn on a mismatch.
  useEffect(() => {
    if (autoSlopeTimer.current) {
      clearTimeout(autoSlopeTimer.current);
      autoSlopeTimer.current = null;
    }
    if (slopeMode !== 'auto' || !compassSlope || compassSlope === slope) return;
    autoSlopeTimer.current = setTimeout(() => {
      autoSlopeTimer.current = null;
      setSlope(compassSlope);
      if (!areaTagPinned) setAreaTag(defaultAreaTagForSlope(compassSlope));
    }, AUTO_SLOPE_SETTLE_MS);
    return () => {
      if (autoSlopeTimer.current) clearTimeout(autoSlopeTimer.current);
    };
  }, [compassSlope, slope, slopeMode, areaTagPinned]);

  const selectSlope = (next: SlopeOrientation) => {
    setSlope(next);
    setSlopeMode('pinned');
    if (!areaTagPinned) setAreaTag(defaultAreaTagForSlope(next));
    Haptics.selectionAsync().catch(() => {});
  };

  /** Long-press on the slope pill: pin the current tag, or hand it back to the compass. */
  const togglePin = () => {
    if (slopeMode === 'auto') {
      setSlopeMode('pinned');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast({ tone: 'info', title: `Pinned ${slope}`, body: 'The compass only warns now. Hold again to follow it.' });
      return;
    }
    if (!compassSlope) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setSlopePrompt('No compass fix — pick the slope by hand.');
      return;
    }
    setSlopeMode('auto');
    setSlope(compassSlope);
    if (!areaTagPinned) setAreaTag(defaultAreaTagForSlope(compassSlope));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({ tone: 'info', title: `Following the compass — ${compassSlope}` });
  };

  // ── Guided capture ────────────────────────────────────────────────────
  // The walk for this job and how far its photos have got. Resumes on the
  // step the inspector left, else the first step still short of shots.
  const coachStepsList = useMemo(
    () => coachSteps({ kind: inspection?.kind ?? 'general' }),
    [inspection?.kind],
  );
  const coachProg = useMemo(
    () =>
      coachProgress(
        {
          kind: inspection?.kind ?? 'general',
          slopes: inspection?.slopes ?? [],
          brittlenessProtocol: inspection?.brittlenessProtocol,
        },
        coachStepsList,
      ),
    [inspection?.kind, inspection?.slopes, inspection?.brittlenessProtocol, coachStepsList],
  );
  const savedStepId = targetId ? coachStepByJob[targetId] : undefined;
  const [coachIndex, setCoachIndex] = useState<number>(() => {
    const saved = savedStepId ? coachStepsList.findIndex((st) => st.id === savedStepId) : -1;
    if (saved >= 0) return saved;
    const next = nextIncompleteStep(coachProg);
    return next ? coachStepsList.indexOf(next.step) : 0;
  });

  /** A step chosen → the camera is set up for it. Pins the slope: the coach
   *  is an explicit choice, and a compass wobble must not re-tag its photos. */
  const applyCoachStep = (i: number) => {
    const st = coachStepsList[i];
    if (!st) return;
    setCoachIndex(i);
    if (targetId) setCoachStep(targetId, st.id);
    if (st.slope) {
      setSlope(st.slope);
      setSlopeMode('pinned');
    }
    setAreaTag(st.areaTag);
    setAreaTagPinned(st.kind !== 'slope');
    setCaptureMode(st.captureMode);
  };

  /** Photos already filed per slope on this job — shown in the picker. */
  const photoCountsBySlope = (): Partial<Record<SlopeOrientation, number>> => {
    const out: Partial<Record<SlopeOrientation, number>> = {};
    for (const sl of inspection?.slopes ?? []) out[sl.orientation] = sl.photoPaths.length;
    return out;
  };

  /**
   * File a prepared photo — after making sure the slope tag is one a human or
   * a usable compass actually chose.
   *
   * Asks (and holds the photo) when:
   *  • there is no usable compass and nothing has pinned the tag yet — the
   *    default is not evidence;
   *  • the tag is pinned but the compass says the phone faces somewhere else
   *    by more than one octant — a hip corner is one octant off, the other
   *    side of the house is not.
   */
  const fileCapture = (uri: string, imported?: boolean) => {
    const untouchedDefault = slopeMode === 'auto' && !compassSlope && photosRef.current.length === 0;
    if (untouchedDefault) {
      pendingCaptureRef.current = uri;
      setSlopePrompt('No compass fix — which slope is this photo of?');
      return;
    }
    if (slopeMode === 'pinned' && compassSlope && octantDistance(slope, compassSlope) >= 2) {
      pendingCaptureRef.current = uri;
      setSlopePrompt(`Compass says you're facing ${compassSlope}, but photos are being tagged ${slope}.`);
      return;
    }
    addPhoto(uri, imported);
  };

  const onSlopePicked = (next: SlopeOrientation) => {
    selectSlope(next);
    setSlopePrompt(null);
    const uri = pendingCaptureRef.current;
    pendingCaptureRef.current = null;
    if (uri) {
      try {
        addPhoto(uri);
      } catch (e) {
        Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
      }
    }
    if (pendingImportRef.current) {
      pendingImportRef.current = false;
      // selectSlope pinned the mode, so the re-entry passes the gate.
      setTimeout(() => {
        runLibraryImport(true).catch(() => {});
      }, 0);
    }
  };

  const onSlopePickerCancel = () => {
    // A photo held for the question is dropped, not filed under a guess; a
    // pending import simply does not start.
    pendingCaptureRef.current = null;
    pendingImportRef.current = false;
    setSlopePrompt(null);
  };

  const selectAreaTag = (tag: AreaTag) => {
    setAreaTag(tag);
    setAreaTagPinned(true);
    Haptics.selectionAsync().catch(() => {});
  };

  /**
   * A frame mode is a view over (captureMode, areaTag). Test square and
   * Close-up return the tag to the slope's own plane and let it follow the
   * slope again; Edges and Collateral pin their first subject — you shoot
   * gutters on more than one elevation.
   */
  const selectFrameMode = (mode: FrameMode) => {
    const option = frameModeOption(mode);
    setCaptureMode(option.captureMode);
    if (mode === 'square' || mode === 'closeup') {
      setAreaTag(defaultAreaTagForSlope(slope));
      setAreaTagPinned(false);
    } else {
      setAreaTag(option.tags[0]);
      setAreaTagPinned(true);
    }
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
   * reason — that is what the review drawer shows.
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
    // Customer/address/roof details start as placeholders so the photo has
    // somewhere to live; Done asks for the real ones (`finish`), and the Job
    // screen keeps asking until they are real.
    const ins = createInspection({
      customerName: PLACEHOLDER_CUSTOMER_NAME,
      address: PLACEHOLDER_ADDRESS,
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
    // A collateral photo fills its claim-evidence zone by existing — the
    // checklist is never ticked by hand for a surface nobody photographed.
    const zone = zoneForAreaTag(areaTag);
    const job = useInspectionStore.getState().getById(inspectionId);
    if (zone && job?.kind === 'insurance_claim') {
      const prev = job.collateralEvidence?.[zone];
      setCollateralZone(inspectionId, zone, {
        checked: true,
        photoIds: [...(prev?.photoIds ?? []), uri],
      });
    }
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
    // The chrome gets out of the way of the shot — and stays out until asked.
    if (chromeOpen && !keepOpen) setChromeOpen(false);
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
      fileCapture(small);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCapturing(false);
    }
  };

  /** Long-press on the shutter: show the level, capture on release. */
  const onSteadyStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSteadying(true);
  };
  const onSteadyEnd = () => {
    setSteadying(false);
    void capture();
  };

  /**
   * Import existing photos from the library. Imports are first-class captures:
   * the shared `importFromLibrary` service normalizes each asset through the
   * same `prepareCapturedPhoto` pipeline as the camera, then hands it back one
   * at a time to `addPhoto`, which attaches it to this slope with the current
   * area tag / capture mode and enqueues it for analysis by exactly the
   * camera's path.
   *
   * The service tries REAL multi-select (SDK 54 / expo-image-picker 17 modern
   * PHPicker) behind a settle-once guard, and falls back to the single-asset
   * loop — the path that never tripped the #24/#25 SIGABRT — when multi-select
   * throws, returns nothing, or `multiSelectImport` is off. A per-asset read
   * failure (unreadable HEIC, iCloud not-downloaded) is reported without
   * aborting the batch.
   *
   * @param slopeChosen  the picker just answered — skip the gate. Needed
   *   because the re-entry runs before React commits the new `slopeMode`, so
   *   reading state here again would re-open the picker forever.
   */
  const runLibraryImport = async (slopeChosen = false) => {
    if (importing) return;
    // A batch import files every asset under the current tag, so the tag has
    // to be a chosen one BEFORE the picker opens. Auto mode with no compass fix
    // is the untouched default — ask first, then import. (Imports with a live
    // compass or a pinned slope go straight through; the shutter guard's
    // mismatch check does not apply because library photos were not taken
    // facing anything now.)
    if (!slopeChosen && slopeMode === 'auto' && !compassSlope) {
      pendingImportRef.current = true;
      setSlopePrompt('Which slope are the photos you are about to import of?');
      return;
    }
    setImporting(true);
    setImportProgress(null);
    try {
      const result = await importFromLibrary({
        multiSelect: multiSelectImport,
        onProgress: (p) => {
          if (mountedRef.current) setImportProgress(p);
        },
        onPhoto: (uri) => {
          // addPhoto throws if the store write fails — the service catches that
          // and records it as this asset's failure, then keeps going.
          addPhoto(uri, true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        },
      });

      if (result.permission === 'denied') {
        Alert.alert(
          'Photos access needed',
          result.permissionCanAskAgain
            ? 'RoofWise needs Photos access to import existing roof images. You can still capture with the camera.'
            : 'Enable Photos access for RoofWise in Settings to import existing images. You can still capture with the camera.',
        );
        return;
      }

      // Honest, non-aborting failure summary: what came in, what couldn't be read.
      if (result.failures.length > 0) {
        const n = result.failures.length;
        const first = result.failures[0].reason;
        const unreadable = isUnreadableAssetError(first);
        Alert.alert(
          result.imported > 0
            ? `Imported ${result.imported}, skipped ${n}`
            : n === 1
            ? "Couldn't read that photo"
            : `Couldn't read ${n} photos`,
          unreadable
            ? `${first} Try a screenshot as a test image, pick different photos, or run on a real iPhone.`
            : first,
        );
      } else if (result.reachedLimit && result.imported > 0) {
        Alert.alert(
          'Import paused',
          `Added ${result.imported} photos. Tap Import on the tool rail again to keep importing.`,
        );
      } else if (result.imported > 0) {
        toast({ tone: 'success', title: `Imported ${result.imported} photo${result.imported === 1 ? '' : 's'}` });
      }
    } catch (e) {
      // The service is defensive; this only fires on an unexpected programming
      // error, never a per-asset read failure.
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (mountedRef.current) {
        setImporting(false);
        setImportProgress(null);
      }
    }
  };

  /**
   * Done. A job still wearing the placeholder name/address gets asked for
   * the real ones FIRST — with the address prefilled from where the phone
   * is standing when a geocoder can name it. The roofer can skip; the job
   * screen then shows the "Add customer & address" banner and keeps the
   * packet and proposal off until the details are real.
   */
  const finish = () => {
    setReviewOpen(false);
    const inspectionId = targetIdRef.current;
    if (photos.length === 0 || !inspectionId) {
      router.back();
      return;
    }
    const ins = useInspectionStore.getState().getById(inspectionId);
    if (ins && missingJobDetails(ins).any) {
      setNamingOpen(true);
      setAutoLocation(null);
      setLocationNote(null);
      setLocating(true);
      resolveDeviceLocation()
        .then((r) => {
          if (!mountedRef.current) return;
          if (r.status === 'ok' && r.addressKnown) {
            setAutoLocation({ address: r.location.address, lat: r.location.lat, lng: r.location.lng });
          } else if (r.status === 'ok') {
            // A real fix nobody could name: the field stays empty and says why.
            setLocationNote(r.location.note ?? 'Couldn\'t find a street address here — type it in.');
          } else if (r.status === 'permission_denied') {
            setLocationNote('Location is off for RoofWise — type the address in.');
          } else if (r.status === 'no_fix') {
            setLocationNote('No GPS fix yet — type the address in.');
          }
        })
        .catch(() => {})
        .finally(() => {
          if (mountedRef.current) setLocating(false);
        });
      return;
    }
    continueToAnalyze(inspectionId);
  };

  /** Hand-off after Done (and after the naming sheet, saved or skipped). */
  const continueToAnalyze = (inspectionId: string) => {
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
    setReviewOpen(false);
    router.push({
      pathname: '/edit-detection',
      params: {
        inspectionId: photo.inspectionId,
        slopeId: photo.slopeId,
        photoIndex: String(photo.photoIndex),
      },
    });
  };

  // ── Rail actions ──────────────────────────────────────────────────────
  const onTorch = () => {
    Haptics.selectionAsync().catch(() => {});
    setTorch((t) => !t);
  };
  const onLive = () => {
    Haptics.selectionAsync().catch(() => {});
    if (!isGeminiConfigured) {
      // The disc cannot do anything without a key — the sheet says why.
      setSettingsOpen(true);
      return;
    }
    if (!liveOverlay) setLivePausedReason(null);
    setLiveOverlay(!liveOverlay);
  };
  const onGuides = () => {
    Haptics.selectionAsync().catch(() => {});
    setGuides(!guides);
  };
  const onCoach = () => {
    Haptics.selectionAsync().catch(() => {});
    setCoachEnabled(!coachEnabled);
  };
  const onKeepOpen = () => {
    const next = !keepOpen;
    setKeepOpen(next);
    if (next) setChromeOpen(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast({
      tone: 'info',
      title: next ? 'Controls stay open' : 'Controls tuck away again',
      body: next ? 'Hold the chevron again to let them tuck away.' : undefined,
    });
  };

  if (!permission) return <View style={styles.permRoot} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permRoot} edges={['top', 'bottom']}>
        <Stack.Screen options={SCREEN_OPTIONS} />
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

  // ── Layout math — every layer clears the ones it must not cover ───────
  const topBarTop = insets.top + spacing.sm;
  const chromeTop = topBarTop + topBarHeight + spacing.sm;
  const modeStripTop = chromeTop;
  const railTop = modeStripTop + (modeStripHeight || 0) + spacing.md;
  const dockBottom = insets.bottom + spacing.md;
  const dockClear = dockBottom + dockHeight + spacing.sm;
  const coachOn = coachEnabled && coachProg.length > 0;
  const coachBottom = dockClear;
  const aboveDock = coachOn ? coachBottom + COACH_PEEK_HEIGHT + spacing.sm : dockClear;
  const railMaxHeight = Math.max(touchTarget.standard, windowH - railTop - aboveDock - spacing.md);
  const coachMaxHeight = Math.max(0, windowH - chromeTop - coachBottom - spacing.lg);

  const targetPitch = inspection?.slopes.find((s) => s.orientation === slope)?.pitchDegrees;
  const sheetOpen = addToOpen || slopePrompt !== null || settingsOpen || namingOpen || reviewOpen;
  const livePaused = capturing || importing || analyzing || namingOpen || reviewOpen;
  const liveLabelTop = chromeTop + (chromeOpen ? (modeStripHeight || 0) + spacing.sm : 0);

  // The level's own verdict, for the shutter ring while holding to steady.
  const levelOk: boolean | null = motionSample
    ? Math.max(
        Math.abs(motionSample.rollDegrees),
        Math.abs(motionSample.pitchDegrees - (targetPitch ?? 0)),
      ) <= LEVEL_TOLERANCE_DEG
    : null;

  const session = summarizeSession(photos, inspection, localAnalysis);
  const lastPhoto = photos.length > 0 ? photos[photos.length - 1] : null;
  const importingState = importing
    ? { done: importProgress?.done ?? 0, total: importProgress?.phase === 'multi' ? importProgress.total : undefined }
    : null;

  // One caption above the shutter, only when there is something to say.
  const caption = steadying
    ? levelOk === true
      ? 'Square to roof — let go to shoot'
      : 'Hold steady — let go to shoot'
    : importing
    ? importProgress
      ? importProgress.phase === 'multi'
        ? `Importing ${importProgress.done} of ${importProgress.total}…`
        : `Imported ${importProgress.done} — tap Cancel in the picker when done.`
      : 'Opening your photo library…'
    : !isGeminiConfigured
    ? 'AI analysis isn’t set up on this build — photos save without analysis.'
    : null;

  const reviewStatus = !isGeminiConfigured
    ? "AI analysis isn't set up on this build — photos are saved without analysis. Ask your admin."
    : liveOverlay
    ? 'Live overlay reads the camera. Photos analyze as you shoot.'
    : 'Photos analyze as you shoot. Tap one to check it.';

  const onViewfinderTap = () => {
    // A tap on the roof with the coach open tucks the coach first.
    if (coachOn && coachDetent !== 'peek') {
      setCoachDetent('peek');
      return;
    }
    toggleChrome();
  };

  const slopeStatus = slopeMode === 'auto' ? (compassSlope ? 'auto' : 'not set') : 'pinned';

  const topBar = (
    <View
      style={[styles.topBar, { top: topBarTop }]}
      onLayout={(e) => setTopBarHeight(e.nativeEvent.layout.height)}
      pointerEvents="box-none"
    >
      <RailButton bare icon="close" caption="" onPress={close} accessibilityLabel="Close camera" />

      {/* The slope tag, always in view and always one tap to change. Hold to
          pin it (or hand it back to the compass). */}
      <Pressable
        style={({ pressed }) => [styles.slopePill, pressed && styles.pressed]}
        onPress={() => setSlopePrompt('Which slope are you shooting?')}
        onLongPress={togglePin}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={`Tagging ${slope} slope, ${slopeMode === 'auto' ? 'from the compass' : 'pinned'}. ${photos.length} photo${photos.length === 1 ? '' : 's'}. Tap to change. Hold to ${slopeMode === 'auto' ? 'pin' : 'follow the compass'}.`}
      >
        <Ionicons
          name={slopeMode === 'auto' ? 'compass-outline' : 'pin'}
          size={18}
          color={colors.textInverse}
        />
        <Text style={styles.slopePillSlope}>{slope}</Text>
        <Text style={styles.slopePillText} numberOfLines={1}>
          {slopeStatus}
          {photos.length > 0 ? ` · ${photos.length}` : ''}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textInverse} />
      </Pressable>

      <RailButton
        bare
        icon={chromeOpen ? 'chevron-up' : 'chevron-down'}
        caption=""
        active={chromeOpen}
        dot={keepOpen}
        onPress={toggleChrome}
        onLongPress={onKeepOpen}
        accessibilityLabel={
          chromeOpen
            ? `Hide controls. Hold to ${keepOpen ? 'let them tuck away' : 'keep them open'}.`
            : `Show controls. Hold to ${keepOpen ? 'let them tuck away' : 'keep them open'}.`
        }
      />
    </View>
  );

  const dock = (
    <View
      style={[styles.dock, { bottom: dockBottom }]}
      onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}
      pointerEvents="box-none"
    >
      {caption && (
        <View style={styles.captionPill} pointerEvents="none">
          <Text style={styles.captionText} numberOfLines={2}>
            {caption}
          </Text>
        </View>
      )}
      <View style={styles.shutterRow} pointerEvents="box-none">
        <View style={styles.dockSlot}>
          <ShotThumb
            uri={lastPhoto?.uri ?? null}
            count={photos.length}
            state={session.state}
            failedCount={session.failed}
            importing={importingState}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setReviewOpen(true);
            }}
            static={staticChrome}
          />
        </View>

        <Shutter
          onCapture={capture}
          onSteadyStart={onSteadyStart}
          onSteadyEnd={onSteadyEnd}
          busy={capturing}
          steadying={steadying}
          levelOk={levelOk}
          static={staticChrome}
        />

        <View style={[styles.dockSlot, styles.dockSlotEnd]}>
          {photos.length > 0 ? (
            <Pressable
              onPress={finish}
              style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Done. ${photos.length} photo${photos.length === 1 ? '' : 's'} captured. Review and analyze.`}
            >
              <Ionicons name="checkmark" size={22} color={colors.textInverse} />
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  const secondary = (
    <>
      <ModeStrip
        style={[styles.modeStrip, { top: modeStripTop }]}
        captureMode={captureMode}
        areaTag={areaTag}
        squareGuide={squareGuide}
        onSelectMode={selectFrameMode}
        onSelectTag={selectAreaTag}
        onToggleSquareGuide={() => {
          Haptics.selectionAsync().catch(() => {});
          setSquareGuide(!squareGuide);
        }}
        onLayout={(e) => setModeStripHeight(e.nativeEvent.layout.height)}
      />
      <ToolRail
        style={[styles.rail, { top: railTop }]}
        maxHeight={railMaxHeight}
        torch={torch}
        onTorch={onTorch}
        live={liveOverlay}
        liveAvailable={isGeminiConfigured}
        livePaused={livePausedReason != null}
        onLive={onLive}
        guides={guides}
        onGuides={onGuides}
        coach={coachEnabled}
        onCoach={onCoach}
        importing={importing}
        onImport={() => runLibraryImport()}
        onPitchGauge={() => router.push('/pitch-gauge')}
        onSettings={() => setSettingsOpen(true)}
      />
      <CameraHUD
        style={[styles.instruments, { bottom: aboveDock }]}
        selectedSlope={slope}
        slopeSource={slopeMode}
        motion={motionSample}
        heading={compass}
        liveShingleCount={liveOverlay ? liveStats?.shingleCount ?? null : null}
      />
    </>
  );

  return (
    <View style={styles.root}>
      <Stack.Screen options={SCREEN_OPTIONS} />
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
          labelTop={liveLabelTop}
          onError={onLiveError}
          // The 10x10 guide only makes sense when the shot IS a test square.
          guide={captureMode === 'square_10x10' && squareGuide}
          onFrameStats={setLiveStats}
        />
        {(guides || steadying) && (
          <LevelGuide
            motion={motionSample}
            targetPitchDegrees={targetPitch}
            reducedMotion={reducedMotion}
          />
        )}
      </View>

      <HudChrome
        open={chromeOpen}
        onViewfinderTap={onViewfinderTap}
        onIdle={() => setChromeOpen(false)}
        keepOpen={keepOpen}
        paused={sheetOpen || steadying}
        static={staticChrome}
        primary={
          <>
            {topBar}
            {dock}
          </>
        }
        secondary={secondary}
      />

      {coachOn && (
        <CoachDrawer
          progress={coachProg}
          activeIndex={Math.min(coachIndex, coachProg.length - 1)}
          onSelectStep={applyCoachStep}
          onDismiss={() => setCoachEnabled(false)}
          detent={coachDetent}
          onDetentChange={setCoachDetent}
          bottomOffset={coachBottom}
          maxHeight={coachMaxHeight}
          static={staticChrome}
        />
      )}

      <AddPhotosToSheet
        visible={addToOpen}
        onChoose={onAddToChoice}
        onCancel={() => setAddToOpen(false)}
      />

      <SlopePickerSheet
        visible={slopePrompt !== null}
        selected={slope}
        compassSuggestion={compassSlope}
        photoCounts={photoCountsBySlope()}
        reason={slopePrompt ?? undefined}
        onSelect={onSlopePicked}
        onCancel={onSlopePickerCancel}
      />

      <CaptureSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        livePausedReason={livePausedReason}
      />

      <ReviewDrawer
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        photos={photos}
        inspection={inspection}
        localAnalysis={localAnalysis}
        reducedMotion={reducedMotion}
        onOpen={openPhoto}
        onDone={finish}
        statusLine={reviewStatus}
      />

      {/* Cancel / drag-down returns to the camera (Done is abandoned); "Skip
          for now" continues without details and lets the job screen nag. */}
      <CustomerDetailsSheet
        visible={namingOpen}
        onClose={() => setNamingOpen(false)}
        title="Who is this job for?"
        subtitle="Name the customer and the property so the report can go out. The address is prefilled from where you are standing when it can be."
        initial={{
          customerName: inspection?.customerName,
          customerPhone: inspection?.customerPhone,
          customerEmail: inspection?.customerEmail,
          address: inspection?.address,
          lat: inspection?.lat,
          lng: inspection?.lng,
          material: inspection?.material,
          condition: inspection?.condition,
        }}
        roof
        locating={locating}
        autoLocation={autoLocation}
        locationNote={locationNote}
        saveLabel="Save & continue"
        skipLabel="Skip for now"
        onSave={(d) => {
          const inspectionId = targetIdRef.current;
          if (!inspectionId) return;
          updateDetails(inspectionId, {
            customerName: d.customerName,
            customerPhone: d.customerPhone,
            customerEmail: d.customerEmail,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
            ...(d.material ? { material: d.material } : {}),
            ...(d.condition ? { condition: d.condition } : {}),
          });
          setNamingOpen(false);
          continueToAnalyze(inspectionId);
        }}
        onSkip={() => {
          const inspectionId = targetIdRef.current;
          setNamingOpen(false);
          if (inspectionId) continueToAnalyze(inspectionId);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.black },
  pressed: { opacity: 0.75 },

  // ── Primary chrome ─────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  slopePill: {
    ...hudPanel,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
  },
  // The slope NAME (S, NE, …) — 1A's mono "slope name" treatment
  // (docs/DESIGN_1A.md §3), kept at body-large size rather than dropping to
  // dataLabel's caption size: this is the one thing a roofer reads at a
  // glance, not an auxiliary meta tag.
  slopePillSlope: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.mono,
    letterSpacing: 0.5,
  },
  // "auto · 3" / "pinned · 5" — the small status word next to it is the
  // literal data-label case: mono, uppercase, tracked.
  slopePillText: {
    ...dataLabel,
    color: colors.textInverse,
    opacity: 0.85,
    flexShrink: 1,
  },

  dock: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  captionPill: {
    ...hudPanel,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    maxWidth: '100%',
  },
  captionText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    textAlign: 'center',
  },
  shutterRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  // Equal slots either side keep the shutter centred whether or not Done is showing.
  dockSlot: { width: touchTarget.sticky, alignItems: 'flex-start', justifyContent: 'center' },
  dockSlotEnd: { alignItems: 'flex-end' },
  // The session's one orange moment, in the thumb zone beside the shutter.
  doneBtn: {
    height: touchTarget.preferred,
    minWidth: touchTarget.preferred,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  doneText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },

  // ── Secondary chrome ──────────────────────────────────────────────────
  modeStrip: { position: 'absolute', left: 0, right: 0 },
  rail: { position: 'absolute', right: spacing.lg },
  instruments: { position: 'absolute', left: spacing.lg, maxWidth: '60%' },

  permRoot: { flex: 1, backgroundColor: colors.navy },
  permWrap: { flex: 1, padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  permTitle: {
    color: colors.textInverse,
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    textAlign: 'center',
  },
  permBody: {
    color: colors.textInverse,
    opacity: 0.82,
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
    textAlign: 'center',
  },
  permBtn: {
    height: touchTarget.sticky,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.button,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  permBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },
  permLink: {
    minHeight: touchTarget.standard,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  linkText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular },
});
