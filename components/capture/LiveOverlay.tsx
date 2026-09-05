// Live scan overlay for the Quick Inspection viewfinder.
//
// When ON, every ~LIVE_INTERVAL_MS a reduced frame (long side ≤ LIVE_MAX_PX,
// JPEG q0.6, skipProcessing) is grabbed from the camera, sent through the same
// `analyzePhoto` the full capture uses, and the returned boxes are drawn over
// the preview with a spring. That is the honest form of "realtime overlay"
// inside Expo Go: one Flash call per frame at ~1.5–3 s latency, labelled with
// the model that answered and how long it took, so nobody mistakes it for
// on-device tracking.
//
// Live results are NEVER persisted as findings — the only thing that reaches
// a store is the model id, for the label. The loop yields while a full
// capture is being analysed, while the app is backgrounded, and while the
// screen is blurred; any error is a kill switch (the screen flips the setting
// OFF and this component shows "Live overlay paused — <reason>").

import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type LayoutChangeEvent,
} from 'react-native';
import type { CameraView } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  analyzePhoto,
  describeAnalysisError,
  getActiveGeminiModel,
} from '@/lib/services/gemini';
import { useCaptureSettingsStore } from '@/lib/stores/captureSettingsStore';
import {
  DAMAGE_CATEGORY_LABELS,
  SEVERITY_LABELS,
  type DamageMarker,
  type Severity,
  type SlopeOrientation,
} from '@/lib/models/types';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
  spacing,
} from '@/theme/tokens';

/** Target cadence between frame grabs. */
const LIVE_INTERVAL_MS = 3000;
/** Never re-grab faster than this even when the model answers instantly. */
const MIN_GAP_MS = 750;
/** Poll again this soon when the shutter holds the camera. */
const LOCK_RETRY_MS = 400;
/** Long-side ceiling for a live frame. */
const LIVE_MAX_PX = 1024;
const LIVE_JPEG_QUALITY = 0.6;
/** A live frame that takes longer than this is not "live" — treat as an error. */
const LIVE_TIMEOUT_MS = 20_000;
/** How long the "paused — reason" label stays after the kill switch fires. */
const PAUSED_LABEL_MS = 8000;
/** Smallest drawn box, so a pinhead hail hit is still visible at arm's length. */
const MIN_BOX_PT = 28;

// The live finding tag's colour, by severity (docs/DESIGN_1A.md: "recolour
// through brand.burnt/brand.royal/brand.amber by severity"). `amber`'s a
// bright yellow-orange, so it needs an INK label rather than white to stay
// sun-readable (Drift #1) — SEVERITY_INK carries that per-tint choice rather
// than assuming white always reads.
const SEVERITY_TINT: Record<Severity, string> = {
  none: colors.surfaceMuted,
  minor: brand.royal,
  moderate: brand.amber,
  severe: brand.burntDeep,
};
const SEVERITY_INK: Record<Severity, string> = {
  none: colors.text,
  minor: colors.textInverse,
  moderate: colors.text,
  severe: colors.textInverse,
};

type LiveFrame = {
  markers: DamageMarker[];
  imageW: number;
  imageH: number;
  noRoof: boolean;
  model: string;
  latencyMs: number;
  /** Model's pixels-per-inch at the roof plane for THIS frame, if it found a ruler. */
  pixelsPerInch: number | null;
  /** Whole shingles the model counted in frame, if it could. */
  shingleCount?: number;
  /** Fraction of one 10x10 square the frame shows, per the model. */
  coverage?: { visible: boolean; fraction: number; confidence: number };
};

/** A 10x10 ft test square is 120 in on a side; an exposed course is ~5.6 in. */
const SQUARE_SIDE_IN = 120;
const COURSE_IN = 5.6;

type Props = {
  enabled: boolean;
  cameraRef: RefObject<CameraView | null>;
  cameraReady: boolean;
  /**
   * Shared with the screen's shutter. `takePictureAsync` must never run twice
   * at once, so whoever sets this true owns the camera until they clear it;
   * the live loop skips its tick while the shutter holds it and vice versa.
   */
  cameraLock: MutableRefObject<boolean>;
  /** True while a full-resolution capture is being analysed — live yields. */
  paused: boolean;
  /** Screen focus; blur stops the loop. */
  focused: boolean;
  slope?: SlopeOrientation;
  reducedMotion?: boolean;
  /** Distance from the top of the overlay to place the status label. */
  labelTop: number;
  /** Fired once per failure; the screen turns the setting OFF (kill switch). */
  onError: (reason: string) => void;
  /**
   * Draw the 10x10 test-square guide and the shingle-course grid, sized from
   * the model's pixels-per-inch. An ESTIMATE from shingle geometry, labelled as
   * one — not a measurement. Real measurement is ARKit/LiDAR (native build).
   */
  guide?: boolean;
  /** Live shingle count + coverage, for the screen's HUD. */
  onFrameStats?: (stats: { shingleCount?: number; coverageFraction?: number; pixelsPerInch: number | null }) => void;
};

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) =>
      setActive(next === 'active'),
    );
    return () => sub.remove();
  }, []);
  return active;
}

export function LiveOverlay({
  enabled,
  cameraRef,
  cameraReady,
  cameraLock,
  paused,
  focused,
  slope,
  reducedMotion,
  labelTop,
  onError,
  guide = false,
  onFrameStats,
}: Props) {
  const onFrameStatsRef = useRef(onFrameStats);
  onFrameStatsRef.current = onFrameStats;
  const appActive = useAppActive();
  const setLastLiveModel = useCaptureSettingsStore((s) => s.setLastLiveModel);
  const lastLiveModel = useCaptureSettingsStore((s) => s.lastLiveModel);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [pausedReason, setPausedReason] = useState<string | null>(null);

  // Latest callbacks/props the loop reads without restarting itself.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const slopeRef = useRef(slope);
  slopeRef.current = slope;

  const running = enabled && cameraReady && focused && appActive && !paused;

  // Stale boxes are worse than none: the moment the loop stops (capture
  // analysing, app backgrounded, switch off) the drawing goes with it.
  useEffect(() => {
    if (!running) setFrame(null);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abort = new AbortController();

    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (cancelled) return;
      const cam = cameraRef.current;
      if (!cam) {
        schedule(LOCK_RETRY_MS);
        return;
      }
      if (cameraLock.current) {
        // The shutter owns the camera right now — the roofer's photo wins.
        schedule(LOCK_RETRY_MS);
        return;
      }

      const startedAt = Date.now();
      try {
        let uri: string | undefined;
        let shotW = 0;
        let shotH = 0;
        cameraLock.current = true;
        try {
          // (The shutter flash is a CameraView prop — the screen turns
          // `animateShutter` off while live is on so a grab is invisible.)
          const shot = await cam.takePictureAsync({
            quality: LIVE_JPEG_QUALITY,
            skipProcessing: true,
            shutterSound: false,
          });
          uri = shot?.uri;
          shotW = shot?.width ?? 0;
          shotH = shot?.height ?? 0;
        } finally {
          cameraLock.current = false;
        }
        if (cancelled) return;
        if (!uri) throw new Error('The camera returned no frame.');

        // Constrain the LONG side to LIVE_MAX_PX. With skipProcessing the
        // reported dimensions can be the sensor's, so pick by whichever is
        // larger rather than assuming portrait.
        const resize = shotH > shotW ? { height: LIVE_MAX_PX } : { width: LIVE_MAX_PX };
        const small = await ImageManipulator.manipulateAsync(uri, [{ resize }], {
          compress: LIVE_JPEG_QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (cancelled) return;
        if (!small.base64) throw new Error('Could not read the live frame.');

        const t0 = Date.now();
        const r = await analyzePhoto({
          imageBase64: small.base64,
          slope: slopeRef.current,
          signal: abort.signal,
          timeoutMs: LIVE_TIMEOUT_MS,
          // Detections + no-roof verdict only — the findings table is never
          // generated for a frame that is drawn for 3 s and discarded.
          live: true,
        });
        if (cancelled) return;

        const model = r.modelUsed ?? getActiveGeminiModel();
        const pixelsPerInch = r.shingleScaleEstimate?.pixelsPerInch ?? null;
        setFrame({
          markers: r.markers,
          imageW: small.width,
          imageH: small.height,
          noRoof: r.noRoofDetected,
          model,
          latencyMs: r.latencyMs ?? Date.now() - t0,
          pixelsPerInch,
          shingleCount: r.shingleCount,
          coverage: r.squareCoverage,
        });
        onFrameStatsRef.current?.({
          shingleCount: r.shingleCount,
          coverageFraction: r.squareCoverage?.fraction,
          pixelsPerInch,
        });
        setLastLiveModel(model);
        schedule(Math.max(MIN_GAP_MS, LIVE_INTERVAL_MS - (Date.now() - startedAt)));
      } catch (e) {
        if (cancelled) return;
        const reason = describeAnalysisError(e);
        setFrame(null);
        setPausedReason(reason);
        onErrorRef.current(reason);
      }
    };

    tick();

    return () => {
      cancelled = true;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
    // cameraRef / cameraLock are stable refs; the loop restarts only on gates.
  }, [running, cameraRef, cameraLock, setLastLiveModel]);

  // The paused label clears itself — the reason is also in the settings row.
  useEffect(() => {
    if (!pausedReason) return;
    const t = setTimeout(() => setPausedReason(null), PAUSED_LABEL_MS);
    return () => clearTimeout(t);
  }, [pausedReason]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  if (!enabled && !pausedReason) return null;

  const label = pausedReason
    ? `Live overlay paused — ${pausedReason}`
    : !running
    ? paused
      ? 'LIVE · paused while your photo analyses'
      : !cameraReady
      ? 'LIVE · waiting for camera'
      : 'LIVE · paused'
    : frame
    ? `LIVE · ${frame.model} · ${(frame.latencyMs / 1000).toFixed(1)}s` +
      (frame.noRoof ? ' · no roof in frame' : ` · ${frame.markers.length} box${frame.markers.length === 1 ? '' : 'es'}`)
    : `LIVE · ${lastLiveModel ?? 'connecting'} · first frame…`;

  const rect = frame && size.width > 0 ? coverRect(size, frame.imageW, frame.imageH) : null;

  // The 10x10 guide: 120 in at the frame's pixels-per-inch, in FRAME pixels,
  // mapped through the same cover rect as the boxes. Centred; clamped so a
  // close-up (where 120 in would exceed the frame) shows the guide's edge
  // running off-screen rather than nothing — the roofer backs up until it fits.
  const guideRect = (() => {
    if (!guide || !rect || !frame || frame.noRoof || !frame.pixelsPerInch) return null;
    const ppiScreen = frame.pixelsPerInch * (rect.width / frame.imageW);
    const side = SQUARE_SIDE_IN * ppiScreen;
    const course = COURSE_IN * ppiScreen;
    const left = rect.left + rect.width / 2 - side / 2;
    const top = rect.top + rect.height / 2 - side / 2;
    const fits = side <= Math.min(rect.width, rect.height);
    return { left, top, side, course, fits };
  })();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {guideRect && (
        <View
          style={[
            styles.guide,
            { left: guideRect.left, top: guideRect.top, width: guideRect.side, height: guideRect.side },
            !guideRect.fits && styles.guideOverflow,
          ]}
        >
          {/* Course lines every ~5.6 in — the shingle rows the count rides on. */}
          {guideRect.course >= 6 &&
            Array.from({ length: Math.floor(guideRect.side / guideRect.course) - 1 }, (_, i) => (
              <View
                key={i}
                style={[styles.courseLine, { top: (i + 1) * guideRect.course }]}
              />
            ))}
          <View style={styles.guideTag}>
            <Text style={styles.guideTagText}>
              10×10 test square · est. from shingle scale
              {frame?.shingleCount != null ? ` · ~${frame.shingleCount} shingles in frame` : ''}
              {!guideRect.fits ? ' · back up to fit' : ''}
            </Text>
          </View>
        </View>
      )}
      {rect &&
        frame?.markers.map((m) => {
          if (!m.box) return null;
          let left = rect.left + m.box.xmin * rect.width;
          let top = rect.top + m.box.ymin * rect.height;
          let w = (m.box.xmax - m.box.xmin) * rect.width;
          let h = (m.box.ymax - m.box.ymin) * rect.height;
          if (w < MIN_BOX_PT) {
            left -= (MIN_BOX_PT - w) / 2;
            w = MIN_BOX_PT;
          }
          if (h < MIN_BOX_PT) {
            top -= (MIN_BOX_PT - h) / 2;
            h = MIN_BOX_PT;
          }
          return (
            <LiveBox
              key={m.id}
              left={left}
              top={top}
              width={w}
              height={h}
              marker={m}
              reducedMotion={reducedMotion}
            />
          );
        })}

      <View style={[styles.labelWrap, { top: labelTop }]}>
        <View style={[styles.labelPill, pausedReason ? styles.labelPillPaused : null]}>
          {!pausedReason && <LiveDot active={running} reducedMotion={reducedMotion} />}
          <Text style={styles.labelText} numberOfLines={2}>
            {label}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The preview fills the screen edge-to-edge (aspect-fill), so an image box
 * has to be mapped through the same crop: scale the frame up until it covers
 * the container, then centre the overflow.
 */
function coverRect(
  c: { width: number; height: number },
  iw: number,
  ih: number,
): { left: number; top: number; width: number; height: number } {
  if (iw <= 0 || ih <= 0) return { left: 0, top: 0, width: c.width, height: c.height };
  const ia = iw / ih;
  const ca = c.width / c.height;
  if (ia > ca) {
    const h = c.height;
    const w = h * ia;
    return { left: (c.width - w) / 2, top: 0, width: w, height: h };
  }
  const w = c.width;
  const h = w / ia;
  return { left: 0, top: (c.height - h) / 2, width: w, height: h };
}

function LiveBox({
  left,
  top,
  width,
  height,
  marker,
  reducedMotion,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
  marker: DamageMarker;
  reducedMotion?: boolean;
}) {
  const scale = useSharedValue(reducedMotion ? 1 : 0.7);
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    scale.value = withSpring(1, motion.bouncy);
    opacity.value = withSpring(1, motion.quick);
  }, [reducedMotion, scale, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const tint = SEVERITY_TINT[marker.severity];
  const ink = SEVERITY_INK[marker.severity];
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.box, { left, top, width, height, borderColor: tint }, style]}
    >
      <View style={[styles.boxPill, { backgroundColor: tint }]}>
        <Text style={[styles.boxPillText, { color: ink }]} numberOfLines={1}>
          {DAMAGE_CATEGORY_LABELS[marker.category]} · {SEVERITY_LABELS[marker.severity]}
        </Text>
      </View>
    </Animated.View>
  );
}

function LiveDot({ active, reducedMotion }: { active: boolean; reducedMotion?: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!active || reducedMotion) {
      o.value = 1;
      return;
    }
    o.value = withRepeat(
      withTiming(0.3, { duration: motion.pulseMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [active, reducedMotion, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: active ? colors.danger : colors.textSubtle }, style]}
    />
  );
}

const styles = StyleSheet.create({
  // The guide is a dashed outline — a chalk line, not a box the model drew.
  guide: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.textInverse,
    borderRadius: 4,
    overflow: 'visible',
  },
  // Overflow ("back up to fit") is the guide's own caution state — brand.amber,
  // the 1A moderate/caution hue, rather than the generic semantic warn.
  guideOverflow: { borderColor: brand.amber },
  courseLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.textInverse,
    opacity: 0.55,
  },
  guideTag: {
    position: 'absolute',
    left: 0,
    bottom: -26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  guideTagText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },
  labelWrap: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
  },
  labelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    maxWidth: '100%',
  },
  labelPillPaused: { borderColor: colors.warn },
  // A full sentence ("Live overlay paused — <reason>") stays Archivo, not the
  // mono/uppercase data-label treatment — that's for short tags, not prose.
  labelText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  box: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: radii.sm,
  },
  boxPill: {
    position: 'absolute',
    top: -spacing.xl,
    left: -2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    maxWidth: 220,
  },
  // The live finding tag — "HAIL BRUISE · SEVERE" (docs/DESIGN_1A.md §6),
  // the mock's data-label chip: mono, uppercase, tracked. Colour is set
  // per-box from SEVERITY_INK above.
  boxPillText: {
    ...dataLabel,
    letterSpacing: 0.6,
  },
});
