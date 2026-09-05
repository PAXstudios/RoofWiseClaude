// Photo annotator — draw on an inspection photo the way a roofer marks a roof
// with chalk: an arrow at the hit, a circle round the crease, "soft here" by
// the bruise. JobNimbus's "take job photos, draw on them, and create photo
// reports in seconds at the job site", built for a gloved hand in sun.
//
// The drawing is DATA (lib/models/annotations.ts), normalised to the image
// and saved in lib/stores/annotationStore.ts keyed by the photo's URI. The
// photo's pixels are never touched; every surface that shows the photo lays
// the same items over it (components/photo/AnnotatedPhoto.tsx) and the HAAG
// report prints them as inline SVG over the <img> (lib/services/haagPdf.ts).
//
// Interaction model (Drift #1 — the one deliberate exception is the drawing
// itself, which is a fingertip on the photo; every CONTROL is 56pt):
//   one finger      draws with the active tool (pen stroke, arrow tail→tip,
//                   circle / box by dragging a corner, label by tapping)
//   two fingers     pinch to zoom, drag to pan — always, whatever the tool
//   rail (right)    Pen / Arrow / Circle / Box / Label, Clear; tucks away on
//                   the chevron, like the camera's tool rail
//   dock (bottom)   colour chips, stroke-width chips, the sticky 88pt Save
//   top bar         Back (asks before losing work), Undo, Redo
// The chrome fades while a stroke is in progress so the whole photo shows
// under the finger; reduced motion turns every fade into a cut.
//
// Same camera chrome as Quick Inspection (RailButton + smoke glass), so it
// feels like a mode of the camera rather than a different app.

import { useEffect, useRef, useState } from 'react';
import {
  Image as RNImage,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
// SDK 57: expo-router no longer depends on the standalone `@react-navigation/native`
// package — it vendors React Navigation internally and re-exports it from this
// public subpath (same pattern as `expo-router/stack`, `expo-router/tabs`, etc.).
import type { NavigationAction } from 'expo-router/react-navigation';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { RailButton } from '@/components/capture/hud/RailButton';
import { HUD_GAP, hudActive, hudCaption, hudDisc, hudInk, hudInkActive, hudPanel } from '@/components/capture/hud/glass';
import type { IoniconName } from '@/components/ui/IconChip';
import { IconChip } from '@/components/ui/IconChip';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { PressableScale } from '@/components/PressableScale';
import { AnnotationLayer } from '@/components/photo/AnnotationLayer';
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_LABELS,
  ANNOTATION_TEXT_MAX,
  ANNOTATION_TEXT_SIZES,
  ANNOTATION_TEXT_SIZE_ORDER,
  ANNOTATION_WIDTHS,
  ANNOTATION_WIDTH_ORDER,
  PEN_MAX_POINTS,
  newAnnotationId,
  rectFromCorners,
  type Annotation,
  type AnnotationColor,
  type AnnotationKind,
  type AnnotationTextSizeName,
  type AnnotationWidthName,
  type NormPoint,
} from '@/lib/models/annotations';
import { ANNOTATION_COLOR_HEX, describeAnnotations, fitRect, toNorm, toPx, type PxRect } from '@/lib/services/annotationSvg';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { useAnnotationStore } from '@/lib/stores/annotationStore';
import { resolveAnnotationTarget, type AnnotationTargetInput } from '@/lib/services/annotationTarget';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { brand, colors, fontFamily, fontSize, fontWeight, hudMotion, motion, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

type Tool = AnnotationKind;

const TOOLS: { tool: Tool; icon: IoniconName; caption: string; label: string; hint: string }[] = [
  { tool: 'pen', icon: 'pencil-outline', caption: 'Pen', label: 'Pen. Draw freehand with one finger.', hint: 'Draw with one finger · two fingers zoom' },
  { tool: 'arrow', icon: 'arrow-forward-outline', caption: 'Arrow', label: 'Arrow. Drag from the tail to the tip.', hint: 'Drag from the tail to the tip' },
  { tool: 'circle', icon: 'ellipse-outline', caption: 'Circle', label: 'Circle. Drag a box around the spot.', hint: 'Drag a box around the spot' },
  { tool: 'rect', icon: 'square-outline', caption: 'Box', label: 'Box. Drag from one corner to the other.', hint: 'Drag from corner to corner' },
  { tool: 'text', icon: 'text-outline', caption: 'Label', label: 'Label. Tap where the words should go.', hint: 'Tap where the label goes' },
];

const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** Points closer than this (screen px) are not added to a pen stroke. */
const PEN_STEP_PX = 4;
/** A shape smaller than this (px) in both dimensions was a mis-touch, not a drawing. */
const MIN_SHAPE_PX = 6;
/** An arrow shorter than this (px) was a tap. */
const MIN_ARROW_PX = 8;

type History = { past: Annotation[][]; present: Annotation[]; future: Annotation[][] };

const EMPTY: Annotation[] = [];

export default function AnnotateScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const toast = useToastStore((s) => s.show);
  const params = useLocalSearchParams<{
    uri?: string;
    inspectionId?: string;
    slopeId?: string;
    photoIndex?: string;
    index?: string;
    attachmentId?: string;
  }>();

  // The photo: by URI, or by the inspection / slope / index edit-detection
  // uses. Existing damage markers come along when the slope is known.
  const indexRaw = params.photoIndex ?? params.index;
  const index = indexRaw != null && indexRaw !== '' ? Number(indexRaw) : NaN;
  const inspection = useInspectionStore((s) =>
    params.inspectionId ? s.inspections.find((i) => i.id === params.inspectionId) : undefined,
  );
  const [identity, setIdentity] = useState<AnnotationTargetInput>();
  const target = resolveAnnotationTarget(inspection, identity ?? {
    uri: params.uri, slopeId: params.slopeId, attachmentId: params.attachmentId, index,
  });
  useEffect(() => {
    if (!identity && target?.attachmentId) setIdentity({ uri: target.uri, slopeId: target.slopeId, attachmentId: target.attachmentId });
  }, [identity, target]);
  const uri = params.inspectionId ? target?.uri : params.uri;
  const markers = target?.markers ?? [];
  const slope = inspection?.slopes.find((slope) => slope.id === target?.slopeId);

  const setItems = useAnnotationStore((s) => s.set);
  const [initial] = useState<Annotation[]>(() => (uri ? [...useAnnotationStore.getState().get(uri, target?.attachmentId)] : EMPTY));
  const [stored] = useState(() => (uri ? useAnnotationStore.getState().getRecord(uri, target?.attachmentId) : undefined));

  // ── Tool state ──────────────────────────────────────────────────────────
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<AnnotationColor>('danger');
  const [widthName, setWidthName] = useState<AnnotationWidthName>('medium');
  const [toolsOpen, setToolsOpen] = useState(true);

  // ── Items + history ─────────────────────────────────────────────────────
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const present = history.present;
  const savedRef = useRef<Annotation[]>(initial);
  const presentRef = useRef(present);
  presentRef.current = present;
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const dirty = present !== savedRef.current && !(present.length === 0 && savedRef.current.length === 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Either store may finish hydration last. Subscribe to the resolved record,
  // not just the annotation hydration event; never replace an edited draft.
  const persistedItems = useAnnotationStore((s) => uri ? s.get(uri, target?.attachmentId) : EMPTY);
  const seeded = useRef(initial.length > 0);
  useEffect(() => {
    if (seeded.current || persistedItems.length === 0) return;
    seeded.current = true;
    setHistory((h) => {
      if (h.past.length > 0 || h.future.length > 0) return h;
      const fresh = [...persistedItems];
      savedRef.current = fresh;
      return { past: [], present: fresh, future: [] };
    });
  }, [persistedItems]);

  const commit = (next: Annotation[]) =>
    setHistory((h) => ({ past: [...h.past, h.present], present: next, future: [] }));
  const undo = () => {
    Haptics.selectionAsync().catch(() => {});
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
    });
  };
  const redo = () => {
    Haptics.selectionAsync().catch(() => {});
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const [next, ...rest] = h.future;
      return { past: [...h.past, h.present], present: next, future: rest };
    });
  };

  // ── Sheets ──────────────────────────────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [textAt, setTextAt] = useState<NormPoint | null>(null);
  const [textValue, setTextValue] = useState('');
  const [textColor, setTextColor] = useState<AnnotationColor>('danger');
  const [textSize, setTextSize] = useState<AnnotationTextSizeName>('medium');

  // ── Geometry ────────────────────────────────────────────────────────────
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [img, setImg] = useState<{ width: number; height: number }>(() =>
    stored && stored.imageW > 0 && stored.imageH > 0
      ? { width: stored.imageW, height: stored.imageH }
      : { width: 0, height: 0 },
  );
  useEffect(() => {
    if (!uri || img.width > 0) return;
    let live = true;
    RNImage.getSize(
      uri,
      (w, h) => { if (live && w > 0 && h > 0) setImg({ width: w, height: h }); },
      () => {},
    );
    return () => { live = false; };
  }, [uri, img.width]);

  const rect = fitRect(img.width, img.height, box.width, box.height, 'contain');
  const ready = box.width > 0 && box.height > 0 && img.width > 0 && img.height > 0;
  const rectRef = useRef<PxRect>(rect);
  rectRef.current = rect;
  const boxRef = useRef(box);
  boxRef.current = box;

  // ── Zoom + pan (two fingers) ────────────────────────────────────────────
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  boxW.value = box.width;
  boxH.value = box.height;

  const pinch = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      try {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale.value * e.scale));
        scale.value = next;
        const ox = (boxW.value * (next - 1)) / 2;
        const oy = (boxH.value * (next - 1)) / 2;
        tx.value = Math.max(-ox, Math.min(ox, tx.value));
        ty.value = Math.max(-oy, Math.min(oy, ty.value));
      } catch (error) {
        reportWorkletError(error, 'annotate.pinch');
      }
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < MIN_SCALE + 0.01) {
        scale.value = reduced ? 1 : withSpring(1, motion.snappy);
        tx.value = reduced ? 0 : withSpring(0, motion.snappy);
        ty.value = reduced ? 0 : withSpring(0, motion.snappy);
      }
    });

  const twoFingerPan = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .onStart(() => {
      'worklet';
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      'worklet';
      try {
        const s = scale.value;
        const ox = (boxW.value * (s - 1)) / 2;
        const oy = (boxH.value * (s - 1)) / 2;
        tx.value = Math.max(-ox, Math.min(ox, startTx.value + e.translationX));
        ty.value = Math.max(-oy, Math.min(oy, startTy.value + e.translationY));
      } catch (error) {
        reportWorkletError(error, 'annotate.pan');
      }
    });

  const zoomStyle = useAnimatedStyle(() => {
    try {
      const ok = (v: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return { transform: [{ translateX: ok(tx.value) }, { translateY: ok(ty.value) }, { scale: ok(scale.value) || 1 }] };
    } catch (error) {
      reportWorkletError(error, 'annotate.zoomStyle');
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
  });

  /** Screen (canvas) px → normalised image point, through the zoom transform. */
  const toImage = (x: number, y: number): NormPoint => {
    const { width: cw, height: ch } = boxRef.current;
    const s = scale.value || 1;
    const cx = cw / 2;
    const cy = ch / 2;
    const px = cx + (x - tx.value - cx) / s;
    const py = cy + (y - ty.value - cy) / s;
    return toNorm(px, py, rectRef.current);
  };

  // ── Drawing (one finger) ────────────────────────────────────────────────
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [drawing, setDrawing] = useState(false);
  const draftRef = useRef<Annotation | null>(null);
  const strokeStart = useRef<NormPoint | null>(null);
  const lastPenPx = useRef<{ x: number; y: number } | null>(null);
  const aborted = useRef(false);
  const touchDown = useRef<{ x: number; y: number } | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const widthRef = useRef(widthName);
  widthRef.current = widthName;

  const beginStroke = (x: number, y: number) => {
    if (!ready) return;
    const p = toImage(x, y);
    const t = toolRef.current;
    const base = { id: newAnnotationId(), color: colorRef.current, width: ANNOTATION_WIDTHS[widthRef.current], createdAt: new Date().toISOString() };
    let d: Annotation;
    switch (t) {
      case 'pen':
        d = { ...base, kind: 'pen', points: [p] };
        break;
      case 'arrow':
        d = { ...base, kind: 'arrow', from: p, to: p };
        break;
      case 'circle':
      case 'rect':
        d = { ...base, kind: t, rect: { x: p.x, y: p.y, w: 0, h: 0 } };
        break;
      default:
        return;
    }
    strokeStart.current = p;
    lastPenPx.current = toPx(p, rectRef.current);
    aborted.current = false;
    draftRef.current = d;
    setDraft(d);
    setDrawing(true);
  };

  const extendStroke = (x: number, y: number) => {
    const d = draftRef.current;
    if (!d || aborted.current) return;
    const p = toImage(x, y);
    let next: Annotation | null = null;
    switch (d.kind) {
      case 'pen': {
        const pts = d.points ?? [];
        if (pts.length >= PEN_MAX_POINTS) return;
        // Thin to one point per PEN_STEP_PX on screen — zoomed in, that is
        // finer on the image, which is exactly when the roofer wants detail.
        const px = toPx(p, rectRef.current);
        const last = lastPenPx.current;
        const step = PEN_STEP_PX / (scale.value || 1);
        if (last && Math.hypot(px.x - last.x, px.y - last.y) < step) return;
        lastPenPx.current = px;
        next = { ...d, points: [...pts, p] };
        break;
      }
      case 'arrow':
        next = { ...d, to: p };
        break;
      case 'circle':
      case 'rect':
        next = { ...d, rect: rectFromCorners(strokeStart.current ?? p, p) };
        break;
      default:
        return;
    }
    draftRef.current = next;
    setDraft(next);
  };

  const endStroke = () => {
    const d = draftRef.current;
    draftRef.current = null;
    strokeStart.current = null;
    lastPenPx.current = null;
    setDraft(null);
    setDrawing(false);
    if (!d || aborted.current) return;
    const r = rectRef.current;
    let keep = false;
    switch (d.kind) {
      case 'pen':
        keep = (d.points?.length ?? 0) >= 2;
        break;
      case 'arrow': {
        if (d.from && d.to) {
          const a = toPx(d.from, r);
          const b = toPx(d.to, r);
          keep = Math.hypot(b.x - a.x, b.y - a.y) >= MIN_ARROW_PX;
        }
        break;
      }
      case 'circle':
      case 'rect':
        keep = !!d.rect && Math.max(d.rect.w * r.width, d.rect.h * r.height) >= MIN_SHAPE_PX;
        break;
      default:
        keep = false;
    }
    if (!keep) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    commit([...present, d]);
  };

  const draw = Gesture.Pan()
    .enabled(tool !== 'text')
    .runOnJS(true)
    .minPointers(1)
    .maxPointers(1)
    .minDistance(2)
    .onBegin((e) => {
      touchDown.current = { x: e.x, y: e.y };
    })
    .onStart((e) => {
      const s = touchDown.current ?? { x: e.x, y: e.y };
      beginStroke(s.x, s.y);
      extendStroke(e.x, e.y);
    })
    .onUpdate((e) => {
      if (e.numberOfPointers > 1) {
        aborted.current = true;
        return;
      }
      extendStroke(e.x, e.y);
    })
    .onEnd(() => endStroke())
    .onFinalize(() => {
      if (draftRef.current) endStroke();
      touchDown.current = null;
    });

  const tapToLabel = Gesture.Tap()
    .enabled(tool === 'text')
    .runOnJS(true)
    .maxDuration(400)
    .maxDistance(12)
    .onEnd((e, success) => {
      if (!success || !ready) return;
      Haptics.selectionAsync().catch(() => {});
      setTextValue('');
      setTextColor(colorRef.current);
      setTextAt(toImage(e.x, e.y));
    });

  const composed = Gesture.Race(Gesture.Simultaneous(pinch, twoFingerPan), draw, tapToLabel);

  // ── Chrome fade while drawing ───────────────────────────────────────────
  const chrome = useSharedValue(1);
  useEffect(() => {
    const target = drawing ? 0 : 1;
    chrome.value = reduced ? target : withTiming(target, { duration: hudMotion.chromeFadeMs });
  }, [drawing, reduced, chrome]);
  const chromeStyle = useAnimatedStyle(() => {
    try {
      const v = chrome.value;
      return { opacity: typeof v === 'number' && Number.isFinite(v) ? v : 1 };
    } catch (error) {
      reportWorkletError(error, 'annotate.chrome');
      return { opacity: 1 };
    }
  });

  // ── Leaving with unsaved work ───────────────────────────────────────────
  const leavingRef = useRef(false);
  const pendingAction = useRef<NavigationAction | null>(null);
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || leavingRef.current) return;
      e.preventDefault();
      pendingAction.current = e.data.action;
      setConfirmBack(true);
    });
    return unsub;
  }, [navigation]);

  const onBack = () => {
    if (dirtyRef.current) {
      pendingAction.current = null;
      setConfirmBack(true);
      return;
    }
    router.back();
  };

  const discardAndLeave = () => {
    leavingRef.current = true;
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) navigation.dispatch(action);
    else router.back();
  };

  const onSave = async () => {
    if (!uri || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await setItems(uri, present, img.width > 0 && img.height > 0 ? { imageW: img.width, imageH: img.height } : undefined, target?.attachmentId);
      if (!saved) {
        toast({ tone: 'warn', title: 'Photo changed', body: 'This attachment is no longer available. Your drawing has not been applied to another photo.' });
        return;
      }
      savedRef.current = present;
      if (presentRef.current !== present || leavingRef.current) return;
      dirtyRef.current = false;
      leavingRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const n = present.length;
      toast({
        tone: 'success',
        title: n === 0 ? 'Annotations cleared' : `Saved ${n} annotation${n === 1 ? '' : 's'}`,
        body: n === 0 ? undefined : 'They show wherever this photo shows, and print in the report.',
      });
      router.back();
    } catch {
      toast({ tone: 'danger', title: 'Drawing not saved', body: 'Your draft is still here. Free device storage if needed, then tap Save to retry.' });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const pickTool = (t: Tool) => {
    Haptics.selectionAsync().catch(() => {});
    setTool(t);
  };
  const pickColor = (c: AnnotationColor) => {
    Haptics.selectionAsync().catch(() => {});
    setColor(c);
  };
  const pickWidth = (w: AnnotationWidthName) => {
    Haptics.selectionAsync().catch(() => {});
    setWidthName(w);
  };
  const toggleTools = () => {
    Haptics.selectionAsync().catch(() => {});
    setToolsOpen((v) => !v);
  };

  const placeLabel = () => {
    const text = textValue.trim().slice(0, ANNOTATION_TEXT_MAX);
    const at = textAt;
    setTextAt(null);
    if (!text || !at) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    commit([
      ...present,
      {
        id: newAnnotationId(),
        kind: 'text',
        color: textColor,
        width: ANNOTATION_WIDTHS.medium,
        text,
        at,
        size: ANNOTATION_TEXT_SIZES[textSize],
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const onCanvasLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  };

  // ── Not found ───────────────────────────────────────────────────────────
  if (!uri) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <IconChip name="image-outline" tone="quiet" size="md" />
          <Text style={styles.emptyTitle}>Photo not found</Text>
          <Text style={styles.emptyText}>It may have been deleted, or the link is stale.</Text>
          <PressableScale style={styles.emptyBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={styles.emptyBtnText}>Back</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  const activeTool = TOOLS.find((t) => t.tool === tool) ?? TOOLS[0];
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const where = slope
    ? `Photo ${target ? target.index + 1 : '?'} · ${slope.orientation} slope`
    : null;
  const summary = present.length === 0 ? 'Nothing drawn yet' : describeAnnotations(present);
  const subtitle = where ? `${where} · ${summary}` : summary;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />

      {/* Top bar — Back, what this is, Undo, Redo. */}
      <View style={styles.topBar}>
        <RailButton bare icon="close" caption="" accessibilityLabel="Back" onPress={onBack} />
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>Annotate</Text>
          <Text style={styles.subtitle} numberOfLines={1} testID="annotate-subtitle">{subtitle}</Text>
        </View>
        <RailButton bare icon="arrow-undo-outline" caption="" accessibilityLabel="Undo" disabled={!canUndo} onPress={undo} />
        <RailButton bare icon="arrow-redo-outline" caption="" accessibilityLabel="Redo" disabled={!canRedo} onPress={redo} />
      </View>

      {/* Canvas — the photo, letter-boxed, zoomable, with the overlay. */}
      <View style={styles.canvasWrap}>
        <GestureDetector gesture={composed}>
          <View
            style={styles.canvas}
            onLayout={onCanvasLayout}
            testID="annotate-canvas"
            accessible
            accessibilityLabel={`Photo. ${activeTool.label} Two fingers zoom.`}
          >
            <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
              <Image
                source={{ uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                onLoad={(e) => {
                  const w = e.source?.width;
                  const h = e.source?.height;
                  if (w && h && (img.width !== w || img.height !== h)) setImg({ width: w, height: h });
                }}
              />
              {ready && (
                <AnnotationLayer width={box.width} height={box.height} rect={rect} items={present} markers={markers} draft={draft} />
              )}
            </Animated.View>
          </View>
        </GestureDetector>

        {/* Hint — one line, in the tool's words. */}
        <Animated.View style={[styles.hintWrap, chromeStyle]} pointerEvents="none">
          <Text style={styles.hint} numberOfLines={1}>{activeTool.hint}</Text>
        </Animated.View>

        {/* Tool rail — right edge, tucks to the chevron. */}
        <Animated.View style={[styles.rail, chromeStyle]} pointerEvents={drawing ? 'none' : 'box-none'}>
          <RailButton
            bare
            icon={toolsOpen ? 'chevron-forward' : 'chevron-back'}
            caption=""
            accessibilityLabel={toolsOpen ? 'Hide the tools' : 'Show the tools'}
            onPress={toggleTools}
          />
          {toolsOpen && (
            <ScrollView
              style={styles.railScroll}
              contentContainerStyle={styles.railContent}
              showsVerticalScrollIndicator={false}
              accessibilityRole="toolbar"
              accessibilityLabel="Drawing tools"
            >
              {TOOLS.map((t) => (
                <RailButton
                  key={t.tool}
                  icon={t.icon}
                  caption={t.caption}
                  active={tool === t.tool}
                  accessibilityLabel={t.label}
                  onPress={() => pickTool(t.tool)}
                />
              ))}
              <View style={styles.railGap} />
              <RailButton
                icon="trash-outline"
                caption="Clear"
                disabled={present.length === 0}
                accessibilityLabel="Clear every annotation on this photo"
                onPress={() => setConfirmClear(true)}
              />
            </ScrollView>
          )}
        </Animated.View>
      </View>

      {/* Dock — colour, width, Save. */}
      <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {toolsOpen && (
          <Animated.View style={[styles.chips, chromeStyle]} pointerEvents={drawing ? 'none' : 'auto'}>
            <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Colour">
              {ANNOTATION_COLORS.map((c) => (
                <ColorChip key={c} color={c} active={color === c} onPress={() => pickColor(c)} />
              ))}
            </View>
            <View style={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Stroke width">
              {ANNOTATION_WIDTH_ORDER.map((w) => (
                <WidthChip key={w} name={w} active={widthName === w} onPress={() => pickWidth(w)} />
              ))}
            </View>
          </Animated.View>
        )}
        <PressableScale
          style={styles.save}
          onPress={onSave}
          disabled={saving}
          testID="annotate-save"
          accessibilityRole="button"
          accessibilityLabel={
            present.length === 0
              ? 'Save. Nothing is drawn — this clears any saved annotations and goes back.'
              : `Save ${present.length} annotation${present.length === 1 ? '' : 's'} and go back.`
          }
        >
          <Ionicons name="checkmark" size={24} color={colors.textInverse} />
          <View>
            <Text style={styles.saveText}>{saving ? 'Saving…' : dirty ? 'Save drawing' : 'Done'}</Text>
            <Text style={styles.saveSub}>{summary}</Text>
          </View>
        </PressableScale>
      </View>

      {/* Label sheet — placed at the tap. */}
      <BottomSheet
        visible={textAt !== null}
        onClose={() => setTextAt(null)}
        title="Add a label"
        subtitle="It goes where you tapped. Keep it short — a few words."
        accessibilityLabel="Add a label"
      >
        <TextInput
          value={textValue}
          onChangeText={(t) => setTextValue(t.slice(0, ANNOTATION_TEXT_MAX))}
          placeholder="e.g. Soft — felt under finger"
          placeholderTextColor={colors.textSubtle}
          style={styles.textInput}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={placeLabel}
          maxLength={ANNOTATION_TEXT_MAX}
          accessibilityLabel="Label text"
          testID="annotate-text-input"
        />
        <View style={styles.sheetRow} accessibilityRole="radiogroup" accessibilityLabel="Label colour">
          {ANNOTATION_COLORS.map((c) => (
            <ColorChip key={c} color={c} active={textColor === c} onLight onPress={() => { Haptics.selectionAsync().catch(() => {}); setTextColor(c); }} />
          ))}
        </View>
        <View style={styles.sheetRow} accessibilityRole="radiogroup" accessibilityLabel="Label size">
          {ANNOTATION_TEXT_SIZE_ORDER.map((s) => (
            <SizeChip key={s} name={s} active={textSize === s} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTextSize(s); }} />
          ))}
        </View>
        <PressableScale
          style={[styles.placeBtn, !textValue.trim() && styles.placeBtnOff]}
          onPress={placeLabel}
          disabled={!textValue.trim()}
          accessibilityRole="button"
          accessibilityLabel="Place the label"
          testID="annotate-text-place"
        >
          <Text style={[styles.placeText, !textValue.trim() && styles.placeTextOff]}>Place label</Text>
        </PressableScale>
      </BottomSheet>

      <ConfirmSheet
        visible={confirmClear}
        title="Clear every annotation?"
        body={`${present.length} annotation${present.length === 1 ? '' : 's'} on this photo will go. Undo brings them back until you save.`}
        confirmLabel="Clear"
        cancelLabel="Keep"
        onConfirm={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          commit([]);
        }}
        onClose={() => setConfirmClear(false)}
      />

      <ConfirmSheet
        visible={confirmBack}
        title="Leave without saving?"
        body="Your drawing on this photo has not been saved."
        confirmLabel="Discard"
        cancelLabel="Keep drawing"
        onConfirm={discardAndLeave}
        onClose={() => {
          pendingAction.current = null;
          setConfirmBack(false);
        }}
      />
    </View>
  );
}

// ── Chips ─────────────────────────────────────────────────────────────────

function ColorChip({
  color,
  active,
  onLight = false,
  onPress,
}: {
  color: AnnotationColor;
  active: boolean;
  /** On the white label sheet rather than the dark dock. */
  onLight?: boolean;
  onPress: () => void;
}) {
  const hex = ANNOTATION_COLOR_HEX[color];
  const isWhite = color === 'white';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.colorChip, { backgroundColor: hex }, isWhite && (onLight ? styles.colorChipWhiteOnLight : styles.colorChipWhite), active && styles.colorChipActive, pressed && styles.pressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, checked: active }}
      accessibilityLabel={ANNOTATION_COLOR_LABELS[color]}
      testID={`annotate-color-${color}`}
      hitSlop={spacing.xs}
    >
      {active && <Ionicons name="checkmark" size={26} color={isWhite || color === 'warn' ? colors.text : colors.textInverse} />}
    </Pressable>
  );
}

const WIDTH_DOT: Record<AnnotationWidthName, number> = { thin: 6, medium: 11, thick: 18 };
const WIDTH_LABEL: Record<AnnotationWidthName, string> = { thin: 'Thin line', medium: 'Medium line', thick: 'Thick line' };

function WidthChip({ name, active, onPress }: { name: AnnotationWidthName; active: boolean; onPress: () => void }) {
  const d = WIDTH_DOT[name];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.widthChip, active && styles.widthChipActive, pressed && styles.pressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, checked: active }}
      accessibilityLabel={WIDTH_LABEL[name]}
      testID={`annotate-width-${name}`}
      hitSlop={spacing.xs}
    >
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: active ? hudInkActive : hudInk }} />
    </Pressable>
  );
}

const SIZE_FONT: Record<AnnotationTextSizeName, number> = { small: fontSize.bodySm, medium: fontSize.bodyLg, large: fontSize.titleLg };
const SIZE_LABEL: Record<AnnotationTextSizeName, string> = { small: 'Small text', medium: 'Medium text', large: 'Large text' };

function SizeChip({ name, active, onPress }: { name: AnnotationTextSizeName; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sizeChip, active && styles.sizeChipActive, pressed && styles.pressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, checked: active }}
      accessibilityLabel={SIZE_LABEL[name]}
      hitSlop={spacing.xs}
    >
      <Text style={[styles.sizeChipText, { fontSize: SIZE_FONT[name] }, active && styles.sizeChipTextActive]}>A</Text>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.black },
  pressed: { opacity: 0.75 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HUD_GAP,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: brand.black2,
  },
  titleWrap: { flex: 1, gap: 1 },
  title: { color: colors.onMesh, fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleMd, fontWeight: fontWeight.bold },
  subtitle: { color: colors.onMesh, fontFamily: fontFamily.archivo.regular, opacity: 0.78, fontSize: fontSize.bodySm },

  canvasWrap: { flex: 1 },
  canvas: { flex: 1, backgroundColor: brand.black, overflow: 'hidden' },

  hintWrap: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.md,
    ...hudPanel,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  hint: { ...hudCaption, opacity: 1 },

  rail: {
    position: 'absolute',
    right: spacing.xs,
    top: spacing.sm,
    bottom: spacing.sm,
    alignItems: 'center',
    gap: HUD_GAP,
  },
  railScroll: { flexGrow: 0 },
  railContent: { gap: HUD_GAP, alignItems: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  railGap: { height: spacing.xs },

  dock: {
    backgroundColor: brand.black2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  chips: { gap: HUD_GAP },
  chipRow: { flexDirection: 'row', gap: HUD_GAP, alignItems: 'center' },

  // 56pt discs (Drift #1). Active state is carried by a checkmark glyph, not
  // by hue — four colours side by side would otherwise tell nothing.
  colorChip: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorChipWhite: { borderColor: colors.textInverse },
  colorChipWhiteOnLight: { borderColor: colors.borderStrong },
  colorChipActive: { borderWidth: 4 },
  widthChip: hudDisc,
  widthChipActive: hudActive,

  save: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    ...shadows.float,
  },
  saveText: { color: colors.textInverse, fontFamily: fontFamily.archivo.bold, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  saveSub: { color: colors.textInverse, fontFamily: fontFamily.mono, opacity: 0.9, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  // Label sheet (white surface).
  textInput: {
    minHeight: touchTarget.standard,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.bodyLg,
    fontFamily: fontFamily.archivo.regular,
    color: colors.text,
  },
  sheetRow: { flexDirection: 'row', gap: HUD_GAP, alignItems: 'center' },
  sizeChip: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeChipActive: { backgroundColor: colors.brand },
  sizeChipText: { color: colors.text, fontFamily: fontFamily.archivo.bold, fontWeight: fontWeight.bold },
  sizeChipTextActive: { color: colors.textInverse },
  placeBtn: {
    minHeight: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeBtnOff: { backgroundColor: colors.fillDisabled },
  placeText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  placeTextOff: { color: colors.textMuted },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl, backgroundColor: colors.bg },
  emptyTitle: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  emptyText: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
