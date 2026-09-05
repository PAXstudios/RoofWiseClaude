// The review drawer — what has been shot, opened from the last-shot
// thumbnail (the Pixel/iOS gateway). A glass sheet over the camera with the
// photo strip and each photo's analysis state, the plain-words reason for
// the latest failure, and the session's one orange moment: Done.
//
// Why this is the thumbnail's drawer and not a tab of the coach drawer: the
// coach is about what to shoot NEXT, this is about what was shot — two
// different moments. A roofer opens this when deciding "have I got enough?",
// which is exactly when Done belongs under the thumb.

import { useRef } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GlassCard } from '@/components/glass/GlassCard';
import { Pill } from '@/components/ui/Pill';
import type { Inspection } from '@/lib/models/types';
import { shortAreaTag } from '@/lib/services/captureSession';
import { useAnnotationStore } from '@/lib/stores/annotationStore';
import { colors, dataLabel, fontFamily, fontSize, fontWeight, glass, radii, spacing, touchTarget } from '@/theme/tokens';
import { HUD_GAP } from './glass';
import {
  pillFor,
  stripStateFor,
  captureKey,
  resolveCapturedPhoto,
  summarizeSession,
  type CapturedPhoto,
  type LocalAnalysis,
  type StripState,
} from './reviewState';

const TILE = 96;

type Props = {
  visible: boolean;
  onClose: () => void;
  photos: CapturedPhoto[];
  inspection: Inspection | undefined;
  localAnalysis: Record<string, LocalAnalysis>;
  reducedMotion: boolean;
  /** Tap a photo: open it, or retry when it failed. */
  onOpen: (photo: CapturedPhoto, state: StripState) => void;
  onDone: () => void;
  /** One line under the title — import progress, the AI-off notice, etc. */
  statusLine?: string | null;
};

export function ReviewDrawer({
  visible,
  onClose,
  photos,
  inspection,
  localAnalysis,
  reducedMotion,
  onOpen,
  onDone,
  statusLine,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const summary = summarizeSession(photos, inspection, localAnalysis);
  const n = photos.length;

  // Annotate is a long-press away rather than its own small target — the
  // whole 96pt thumbnail stays the touch area (Drift #1) instead of a second
  // tap-sized icon competing with it for a gloved thumb.
  const onAnnotate = (p: CapturedPhoto) => {
    Haptics.selectionAsync().catch(() => {});
    const target = resolveCapturedPhoto(p, inspection);
    if (!target) return;
    onClose();
    router.push({
      pathname: '/annotate',
      params: { uri: p.uri, inspectionId: p.inspectionId, slopeId: p.slopeId,
        attachmentId: p.attachmentId ?? target.slope.photoAttachmentIds?.[target.index], index: String(target.index) },
    });
  };

  const parts: string[] = [];
  if (summary.done > 0) parts.push(`${summary.done} analyzed`);
  if (summary.analyzing > 0) parts.push(`${summary.analyzing} analyzing`);
  if (summary.queued > 0) parts.push(`${summary.queued} queued`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  const subtitle =
    n === 0
      ? 'Nothing captured yet.'
      : `${n} photo${n === 1 ? '' : 's'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;

  const failureLine = summary.lastFailure
    ? `Analysis failed — ${summary.lastFailure.replace(/[.\s]+$/, '')}. Tap the photo to retry.`
    : null;

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Back to the camera">
        <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable onPress={() => {}}>
            <GlassCard level="high" radius={radii.xl} style={styles.sheet}>
              <View style={styles.head}>
                <View style={styles.headText}>
                  <Text style={styles.title}>Photos</Text>
                  <Text style={styles.subtitle} numberOfLines={2}>
                    {subtitle}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Back to the camera"
                >
                  <Ionicons name="close" size={26} color={colors.textInverse} />
                </Pressable>
              </View>

              {(failureLine || statusLine) && (
                <Text style={[styles.status, failureLine && styles.statusWarn]} numberOfLines={3}>
                  {failureLine ?? statusLine}
                </Text>
              )}

              <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.strip}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })}
              >
                {photos.map((p) => {
                  const state = stripStateFor(p, inspection, localAnalysis[captureKey(p)]);
                  const pill = pillFor(state);
                  const a11y =
                    state.status === 'failed'
                      ? `Photo ${p.photoIndex + 1}, ${shortAreaTag(p.areaTag)}, ${p.slope} slope. Analysis failed${state.error ? `: ${state.error}` : ''}. Tap to retry.`
                      : `Photo ${p.photoIndex + 1}, ${shortAreaTag(p.areaTag)}, ${p.slope} slope, ${pill.label}. Tap to open. Long press to draw on it.`;
                  return (
                    <Pressable
                      key={captureKey(p)}
                      style={({ pressed }) => [styles.thumbCol, pressed && styles.pressed]}
                      onPress={() => onOpen(p, state)}
                      onLongPress={() => onAnnotate(p)}
                      accessibilityRole="button"
                      accessibilityLabel={a11y}
                    >
                      <View style={[styles.thumbWrap, state.status === 'failed' && styles.thumbWrapFailed]}>
                        <Image source={{ uri: p.uri }} style={styles.thumb} />
                        <View style={styles.thumbTag}>
                          <Text style={styles.thumbTagText} numberOfLines={1}>
                            {shortAreaTag(p.areaTag)} · {p.slope}
                          </Text>
                        </View>
                        {p.captureMode === 'single_shingle' && (
                          <View style={styles.thumbModeDot}>
                            <Ionicons name="layers" size={11} color={colors.textInverse} />
                          </View>
                        )}
                        {p.imported && (
                          <View style={[styles.thumbModeDot, styles.thumbImportDot]}>
                            <Ionicons name="images" size={11} color={colors.textInverse} />
                          </View>
                        )}
                        <AnnotationCountDot uri={p.uri} attachmentId={p.attachmentId} />
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

              <Pressable
                onPress={onDone}
                disabled={n === 0}
                style={({ pressed }) => [styles.done, n === 0 && styles.doneOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Done. ${n} photo${n === 1 ? '' : 's'} captured. Review and analyze.`}
              >
                <Text style={[styles.doneText, n === 0 && styles.doneTextOff]}>Done — review and analyze</Text>
                <Text style={[styles.doneSub, n === 0 && styles.doneTextOff]}>
                  {n} photo{n === 1 ? '' : 's'}
                </Text>
              </Pressable>
            </GlassCard>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/** Pencil + count, bottom-right of a thumbnail — only when this photo has a drawing on it. */
function AnnotationCountDot({ uri, attachmentId }: { uri: string; attachmentId?: string }) {
  const n = useAnnotationStore((s) => attachmentId ? s.count(uri, attachmentId) : 0);
  if (n === 0) return null;
  return (
    <View style={styles.annotateDot} pointerEvents="none">
      <Ionicons name="brush" size={10} color={colors.textInverse} />
      <Text style={styles.annotateDotText}>{n}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheetWrap: { paddingHorizontal: spacing.md },
  sheet: { padding: spacing.lg, gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: HUD_GAP },
  headText: { flex: 1, gap: 2 },
  title: {
    color: colors.textInverse,
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },
  subtitle: {
    color: colors.textInverse,
    opacity: 0.8,
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
  },
  closeBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    color: colors.textInverse,
    opacity: 0.85,
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    lineHeight: 18,
  },
  statusWarn: { color: colors.warnSoft, opacity: 1 },
  strip: { gap: HUD_GAP, alignItems: 'flex-start', paddingVertical: spacing.xs },
  thumbCol: { alignItems: 'center', gap: spacing.xs, minWidth: TILE },
  pressed: { opacity: 0.75 },
  thumbWrap: {
    width: TILE,
    height: TILE,
    borderRadius: radii.md,
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
    backgroundColor: colors.scrim,
    paddingVertical: 2,
    alignItems: 'center',
  },
  // "Front Slope · S" — the mock's badge-chip convention: mono, uppercase,
  // tracked (docs/DESIGN_1A.md §3).
  thumbTagText: { ...dataLabel, color: colors.textInverse, letterSpacing: 0.6 },
  thumbModeDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImportDot: { right: undefined, left: 4, backgroundColor: colors.textMuted },
  // Same bottom-right pencil badge AnnotatedPhoto draws everywhere else this
  // photo shows, so a thumbnail already carries the tell before it's opened.
  annotateDot: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  annotateDotText: { color: colors.textInverse, fontSize: 9, fontWeight: fontWeight.bold, fontFamily: fontFamily.mono },
  // The session's one orange moment, at the sticky size (Drift #1).
  done: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  doneOff: { backgroundColor: colors.fillDisabled },
  doneText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },
  doneSub: {
    color: colors.textInverse,
    opacity: 0.9,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },
  doneTextOff: { color: colors.textInverse, opacity: 0.6 },
});
